/**
 * ERP-2 Target Adapter (Decision C4 & KIT-08)
 *
 * Implements the TargetAdapter port from @cs/kit.
 * Executed in-process to guarantee atomic transaction commits between
 * the target business entity and the durable import receipt.
 *
 * Additions (ERP2-11):
 *   - loadBatch: type-safe UPSERT batch processing over shared importRow path.
 *   - BatchRowInput / LoadBatchResult / LoadBatchOptions types scoped to erp2.
 *
 * @module erp2/migration/target-adapter
 */

import { type Result, ok, err } from '@cs/kernel';
import type {
  TargetAdapter,
  TargetAdapterResult,
  TargetAdapterError,
} from '@cs/kit';
import {
  Erp2Service,
  DomainError,
  ConflictError,
  ValidationError,
} from '../services/erp2.service.js';

import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MIN_ATTEMPTED_ROWS,
  DEFAULT_RETRY_CONFIG,
  chunkArray,
  shouldHaltBatchExecution,
  calculateFailureRate,
  executeWithRetry,
  assertNoRollbackSaga,
} from './batch-runner.js';

// ─────────────────────────────────────────────────────────────────────────────
// loadBatch-specific types (ERP2-11, ERP2-13 / KIT-08, KIT-12)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single source row supplied to loadBatch.
 * Each row carries its own stable idempotency key so that partial-batch retries
 * can be replayed without duplicating already-committed rows.
 */
export interface BatchRowInput<TRow = unknown> {
  /** 0-based position of this row within the source file / batch. */
  sourceRow: number;
  /** Stable, client-supplied idempotency key for this specific row. */
  idempotencyKey: string;
  /** Cleaned/validated source data mapped to the target domain shape. */
  data: TRow;
  /** Optional: originating system identifier (for traceability). */
  sourceSystem?: string | undefined;
  /** Optional: original row identifier from the source system. */
  sourceId?: string | undefined;
}

/**
 * Options for loadBatch execution.
 * V1: upsert flag enables UPSERT semantics (kind='linked') for known natural keys.
 * ERP2-13: chunking, failure threshold, and bounded retry configuration.
 */
export interface LoadBatchOptions {
  /**
   * When true, a row whose natural duplicate key already exists in the target
   * will be updated and linked (kind='linked') rather than rejected.
   * The idempotency key check always precedes any write.
   */
  upsert?: boolean | undefined;
  /** Size of chunks to process (default 500). */
  chunkSize?: number | undefined;
  /** Failure rate threshold that halts execution (default 0.10 / 10%). */
  failureThreshold?: number | undefined;
  /** Minimum attempted rows before threshold checks activate (default 10). */
  minAttemptedRows?: number | undefined;
  /** Maximum retry attempts for transient errors (default 3). */
  maxRetries?: number | undefined;
  /** Initial retry delay in milliseconds (default 50ms). */
  initialDelayMs?: number | undefined;
  /** Exponential backoff multiplier (default 2). */
  backoffFactor?: number | undefined;
}

/**
 * Per-row outcome returned from loadBatch.
 */
export interface LoadBatchRowResult {
  sourceRow: number;
  idempotencyKey: string;
  outcome: 'loaded' | 'rejected' | 'unattempted';
  attempts?: number | undefined;
  priorResult?: boolean | undefined;
  result?: (TargetAdapterResult & { priorResult?: boolean | undefined }) | undefined;
  error?: TargetAdapterError | undefined;
}

/**
 * Aggregate result from loadBatch.
 */
export interface LoadBatchResult {
  batchId: string;
  status: 'COMPLETED' | 'STOPPED_EXCESSIVE_FAILURES';
  total: number;
  attempted: number;
  loaded: number;
  rejected: number;
  unattempted: number;
  chunksProcessed: number;
  stoppedReason?: string | null | undefined;
  rows: LoadBatchRowResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Erp2TargetAdapter
// ─────────────────────────────────────────────────────────────────────────────

export class Erp2TargetAdapter<TRow = unknown> implements TargetAdapter<TRow> {
  readonly module = 'erp2';
  readonly entity: string;
  readonly schemaVersion = 1;

  constructor(
    private readonly service: Erp2Service,
    entity: 'vendor' | 'purchase_order' = 'vendor'
  ) {
    this.entity = entity;
  }

  /**
   * Preflight validation during dry-run phase (zero database mutations).
   */
  async preflight(
    _batchId: string,
    rows: TRow[]
  ): Promise<Result<{ validCount: number; rejectCount: number }, TargetAdapterError>> {
    let validCount = 0;
    let rejectCount = 0;

    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        rejectCount++;
        continue;
      }
      const record = row as Record<string, unknown>;

      if (this.entity === 'vendor') {
        const hasName = typeof record['name'] === 'string' && record['name'].length > 0;
        const hasTax = typeof record['tax_number'] === 'string' && record['tax_number'].length > 0;
        const hasEmail = typeof record['email'] === 'string' && record['email'].includes('@');
        if (hasName && hasTax && hasEmail) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else if (this.entity === 'purchase_order') {
        const hasVendor = typeof record['vendor_id'] === 'string';
        const hasDate = typeof record['order_date'] === 'string';
        const hasLines = Array.isArray(record['lines']) && record['lines'].length > 0;
        if (hasVendor && hasDate && hasLines) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else {
        rejectCount++;
      }
    }

    return ok({ validCount, rejectCount });
  }

  /**
   * Commits target business record and durable import receipt atomically in one local PG transaction.
   *
   * The idempotency key check happens BEFORE any write:
   *   - Same key + same hash  → returns prior result (HTTP 200), no write.
   *   - Same key + diff hash  → ConflictError (HTTP 409), no write.
   *   - New key               → atomic dual-write (entity + receipt) in one transaction.
   */
  async importRow(
    batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    cleanData: TRow,
    options?: LoadBatchOptions
  ): Promise<Result<TargetAdapterResult & { priorResult?: boolean | undefined }, TargetAdapterError>> {
    try {
      const result = await this.service.importRow({
        batch_id: batchId,
        source_row: sourceRow,
        idempotency_key: idempotencyKey,
        entity: this.entity,
        record: cleanData as Record<string, unknown>,
        upsert: options?.upsert,
      });

      return ok({
        targetId: result.target_id,
        priorResult: result.prior_result,
        receipt: {
          batchId: result.receipt.batch_id,
          sourceRow: result.receipt.source_row,
          entity: result.receipt.entity,
          schemaVersion: result.receipt.schema_version,
          idempotencyKey: result.receipt.idempotency_key,
          targetId: result.receipt.target_id,
          kind: result.receipt.kind,
          createdAt: new Date(result.receipt.created_at),
        },
      });
    } catch (error) {
      // Business rejections: return stable reason
      if (
        error instanceof DomainError ||
        error instanceof ConflictError ||
        error instanceof ValidationError
      ) {
        const errPayload: TargetAdapterError = {
          reasonCode: error.code,
          message: error.message,
        };
        const field = error.details[0]?.field;
        if (field) {
          errPayload.field = field;
        }
        return err(errPayload);
      }

      // Unexpected / simulated infrastructure failure (e.g. 503) must NOT be misclassified as bad data
      throw error;
    }
  }

  /**
   * Loads a batch of rows in sequential chunks, collecting per-row outcomes
   * with bounded exponential retry and immediate halt on excessive failures (ERP2-13).
   *
   * Design rules (ERP2-11, ERP2-13 / KIT-08, KIT-12):
   *   1. Records are processed in bounded chunks of 500 rows (CHUNK_SIZE = 500).
   *   2. Transient infrastructure failures trigger bounded exponential backoff retries
   *      without altering or corrupting the stable idempotency key.
   *   3. Batch execution stops immediately if row failures exceed 10% of attempted rows
   *      (after a minimum statistical sample of 10 rows).
   *   4. Already committed rows and receipts remain durable; batch state transitions
   *      to STOPPED_EXCESSIVE_FAILURES with exact diagnostics.
   *   5. Compensating rollback sagas and destructive data loss are strictly prohibited in V1.
   *
   * @param batchId     UUID identifying the overall migration batch.
   * @param rows        Array of typed source rows, each with its own idempotency key.
   * @param options     Batch-level options (upsert mode, chunk size, threshold overrides).
   */
  async loadBatch(
    batchId: string,
    rows: BatchRowInput<TRow>[],
    options?: LoadBatchOptions
  ): Promise<LoadBatchResult> {
    assertNoRollbackSaga();

    const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const threshold = options?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    const minAttempted = options?.minAttemptedRows ?? DEFAULT_MIN_ATTEMPTED_ROWS;
    const maxRetries = options?.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries;
    const initialDelayMs = options?.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs;
    const backoffFactor = options?.backoffFactor ?? DEFAULT_RETRY_CONFIG.backoffFactor;

    const chunks = chunkArray(rows, chunkSize);
    const rowResults: LoadBatchRowResult[] = [];
    let loaded = 0;
    let rejected = 0;
    let unattempted = 0;
    let chunksProcessed = 0;
    let halted = false;
    let stoppedReason: string | null = null;

    for (let cIndex = 0; cIndex < chunks.length; cIndex++) {
      if (halted) {
        // Record all rows in remaining unexecuted chunks as unattempted
        for (const row of chunks[cIndex]!) {
          unattempted++;
          rowResults.push({
            sourceRow: row.sourceRow,
            idempotencyKey: row.idempotencyKey,
            outcome: 'unattempted',
          });
        }
        continue;
      }

      chunksProcessed++;
      const currentChunk = chunks[cIndex]!;

      for (let rIndex = 0; rIndex < currentChunk.length; rIndex++) {
        const row = currentChunk[rIndex]!;

        if (halted) {
          unattempted++;
          rowResults.push({
            sourceRow: row.sourceRow,
            idempotencyKey: row.idempotencyKey,
            outcome: 'unattempted',
          });
          continue;
        }

        // Execute row import with bounded exponential backoff retries for transient failures
        const { result: rowResult, attempts } = await executeWithRetry(
          async (_attempt) => {
            return await this.importRow(
              batchId,
              row.sourceRow,
              row.idempotencyKey,
              row.data,
              options
            );
          },
          {
            maxRetries,
            initialDelayMs,
            backoffFactor,
          }
        );

        if (rowResult.ok) {
          loaded++;
          rowResults.push({
            sourceRow: row.sourceRow,
            idempotencyKey: row.idempotencyKey,
            outcome: 'loaded',
            attempts,
            priorResult: rowResult.value.priorResult,
            result: rowResult.value,
          });
        } else {
          rejected++;
          rowResults.push({
            sourceRow: row.sourceRow,
            idempotencyKey: row.idempotencyKey,
            outcome: 'rejected',
            attempts,
            error: rowResult.error,
          });
        }

        // Check if failure rate exceeds threshold after this attempted row
        const attemptedSoFar = loaded + rejected;
        if (
          shouldHaltBatchExecution(rejected, attemptedSoFar, {
            threshold,
            minAttemptedRows: minAttempted,
          })
        ) {
          halted = true;
          const ratePercent = (calculateFailureRate(rejected, attemptedSoFar) * 100).toFixed(2);
          stoppedReason = `Row failure rate ${ratePercent}% (${rejected} failures / ${attemptedSoFar} attempted) exceeded the ${threshold * 100}% threshold. Batch execution stopped immediately.`;
        }
      }
    }

    const total = rows.length;
    const attempted = loaded + rejected;
    const status = halted ? 'STOPPED_EXCESSIVE_FAILURES' : 'COMPLETED';

    return {
      batchId,
      status,
      total,
      attempted,
      loaded,
      rejected,
      unattempted,
      chunksProcessed,
      stoppedReason,
      rows: rowResults,
    };
  }
}
