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

// ─────────────────────────────────────────────────────────────────────────────
// loadBatch-specific types (ERP2-11 / KIT-08 §4.3)
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
  sourceSystem?: string;
  /** Optional: original row identifier from the source system. */
  sourceId?: string;
}

/**
 * Options for loadBatch execution.
 * V1: upsert flag enables UPSERT semantics (kind='linked') for known natural keys.
 * Fuzzy matching is strictly out of scope.
 */
export interface LoadBatchOptions {
  /**
   * When true, a row whose natural duplicate key already exists in the target
   * will be updated and linked (kind='linked') rather than rejected.
   * The idempotency key check always precedes any write.
   */
  upsert?: boolean;
}

/**
 * Per-row outcome returned from loadBatch.
 */
export interface LoadBatchRowResult {
  sourceRow: number;
  idempotencyKey: string;
  outcome: 'loaded' | 'rejected';
  result?: TargetAdapterResult;
  error?: TargetAdapterError;
}

/**
 * Aggregate result from loadBatch.
 */
export interface LoadBatchResult {
  batchId: string;
  total: number;
  loaded: number;
  rejected: number;
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
  ): Promise<Result<TargetAdapterResult, TargetAdapterError>> {
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
   * Loads a batch of rows sequentially, collecting per-row outcomes.
   *
   * Design rules (ERP2-11 / V1_30 §11):
   *   1. Each row is committed independently; a data-validation failure on one row
   *      does NOT abort subsequent rows (error isolation).
   *   2. Infrastructure failures (thrown errors that are NOT DomainError/ConflictError/
   *      ValidationError) propagate immediately — they are transient and retryable.
   *   3. Dry-run semantics are enforced by the service layer (no writes during preflight).
   *   4. The stable idempotency key makes every row replay-safe.
   *
   * @param batchId     UUID identifying the overall migration batch.
   * @param rows        Array of typed source rows, each with its own idempotency key.
   * @param options     Batch-level options (e.g. upsert mode).
   */
  async loadBatch(
    batchId: string,
    rows: BatchRowInput<TRow>[],
    options?: LoadBatchOptions
  ): Promise<LoadBatchResult> {
    const rowResults: LoadBatchRowResult[] = [];
    let loaded = 0;
    let rejected = 0;

    for (const row of rows) {
      const rowResult = await this.importRow(
        batchId,
        row.sourceRow,
        row.idempotencyKey,
        row.data,
        options
      );

      if (rowResult.ok) {
        loaded++;
        rowResults.push({
          sourceRow: row.sourceRow,
          idempotencyKey: row.idempotencyKey,
          outcome: 'loaded',
          result: rowResult.value,
        });
      } else {
        rejected++;
        rowResults.push({
          sourceRow: row.sourceRow,
          idempotencyKey: row.idempotencyKey,
          outcome: 'rejected',
          error: rowResult.error,
        });
      }
    }

    return {
      batchId,
      total: rows.length,
      loaded,
      rejected,
      rows: rowResults,
    };
  }
}
