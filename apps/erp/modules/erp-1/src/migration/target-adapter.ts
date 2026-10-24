/**
 * ERP-1 Target Adapter (Decision C4 & KIT-08 / ERP1-07 / ERP1-11)
 *
 * Implements the TargetAdapter port from @cs/kit.
 * Executed in-process to guarantee atomic transaction commits between
 * the target business entity and the durable import receipt.
 *
 * Capabilities:
 *   - preflight: Zero-mutation dry run validation.
 *   - importRow: In-process atomic transactional dual-write of entity mutation + receipt.
 *   - loadBatch: Chunked batch processing (500 rows), bounded retry (transient 503/deadlock),
 *                and immediate halt if failure rate exceeds 10% after 10 rows.
 *
 * @module erp1/migration/target-adapter
 */

import { type Result, ok, err, AppError } from '@cs/kernel';
import type {
  TargetAdapter,
  TargetAdapterResult,
  TargetAdapterError,
} from '@cs/kit';
import {
  Erp1Service,
  type ImportRowRequestExtended,
} from '../services/erp1.service.js';
import {
  Erp1ServiceError,
} from '../services/errors.js';
import {
  Erp1DomainError,
} from '../domain/rules.js';
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

export type { ImportRowRequestExtended };

// ─────────────────────────────────────────────────────────────────────────────
// loadBatch Types (KIT-08 / KIT-12 / Decision C4)
// ─────────────────────────────────────────────────────────────────────────────

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

export interface LoadBatchOptions {
  /**
   * When true, duplicate natural keys will update/link rather than reject.
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

export interface LoadBatchRowResult {
  sourceRow: number;
  idempotencyKey: string;
  outcome: 'loaded' | 'rejected' | 'unattempted';
  attempts?: number | undefined;
  priorResult?: boolean | undefined;
  result?: (TargetAdapterResult & { priorResult?: boolean | undefined }) | undefined;
  error?: TargetAdapterError | undefined;
}

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
// Erp1TargetAdapter
// ─────────────────────────────────────────────────────────────────────────────

const VALID_UNITS = new Set(['pcs', 'kg', 'g', 'litre', 'metre', 'box']);

export class Erp1TargetAdapter<TRow = unknown> implements TargetAdapter<TRow> {
  readonly module = 'erp1';
  readonly entity: 'product' | 'category' | 'stock_level' | string;
  readonly schemaVersion = 1;

  constructor(
    private readonly service: Erp1Service,
    entity: 'product' | 'category' | 'stock_level' | string = 'product'
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
      const ent = this.entity.toLowerCase();

      if (ent === 'product' || ent === 'products') {
        const hasName = typeof record['name'] === 'string' && record['name'].trim().length > 0;
        const hasSku = typeof record['sku'] === 'string' && record['sku'].trim().length > 0;
        const uom = String(record['unitOfMeasure'] ?? record['unit_of_measure'] ?? record['uom'] ?? '').trim();
        const validUom = VALID_UNITS.has(uom);
        const rawPrice = record['price'];
        const validPrice =
          (typeof rawPrice === 'number' && rawPrice >= 0) ||
          (typeof rawPrice === 'string' && /^\d+(\.\d{1,4})?$/.test(rawPrice.trim()) && Number(rawPrice) >= 0);

        if (hasName && hasSku && validUom && validPrice) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else if (ent === 'category' || ent === 'categories') {
        const hasName = typeof record['name'] === 'string' && record['name'].trim().length > 0;
        const hasCode = typeof record['code'] === 'string' && record['code'].trim().length > 0;
        if (hasName && hasCode) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else if (ent === 'stock_level' || ent === 'stock' || ent === 'opening_stock') {
        const hasProduct =
          typeof (record['productId'] ?? record['product_id']) === 'string' &&
          String(record['productId'] ?? record['product_id']).trim().length > 0;
        const rawQty = record['quantity'];
        const validQty =
          (typeof rawQty === 'number' && rawQty >= 0) ||
          (typeof rawQty === 'string' && /^\d+(\.\d{1,4})?$/.test(rawQty.trim()) && Number(rawQty) >= 0);

        if (hasProduct && validQty) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else if (ent === 'warehouse' || ent === 'warehouses') {
        validCount++;
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
      if (error instanceof Erp1ServiceError || error instanceof AppError) {
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

      if (error instanceof Erp1DomainError) {
        const errPayload: TargetAdapterError = {
          reasonCode: error.code,
          message: error.message,
        };
        if (error.field) {
          errPayload.field = error.field;
        }
        return err(errPayload);
      }

      // Unexpected / simulated infrastructure failure (e.g. 503) must NOT be misclassified as bad data
      throw error;
    }
  }

  /**
   * Loads a batch of rows in sequential chunks, collecting per-row outcomes
   * with bounded exponential retry and immediate halt on excessive failures (ERP1-11, ERP1-13).
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

        const attemptedSoFar = loaded + rejected;
        if (
          shouldHaltBatchExecution(rejected, attemptedSoFar, {
            threshold,
            minAttemptedRows: minAttempted,
          })
        ) {
          halted = true;
          const currentRate = (calculateFailureRate(rejected, attemptedSoFar) * 100).toFixed(1);
          const thresholdPct = (threshold * 100).toFixed(0);
          stoppedReason = `Failure rate exceeded ${thresholdPct}% threshold (${rejected}/${attemptedSoFar} = ${currentRate}% rejected). Execution halted safely without rollback saga.`;
        }
      }
    }

    return {
      batchId,
      status: halted ? 'STOPPED_EXCESSIVE_FAILURES' : 'COMPLETED',
      total: rows.length,
      attempted: loaded + rejected,
      loaded,
      rejected,
      unattempted,
      chunksProcessed,
      ...(stoppedReason ? { stoppedReason } : {}),
      rows: rowResults,
    };
  }
}
