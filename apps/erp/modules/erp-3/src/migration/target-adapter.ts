/**
 * ERP-3 Target Adapter (Decision C4 & KIT-08 / ERP3-07 / ERP3-11)
 *
 * Implements the TargetAdapter port from @cs/kit.
 * Executed in-process to guarantee atomic transaction commits between
 * the target business entity and the durable import receipt.
 *
 * Capabilities:
 *   - preflight: Zero-mutation dry run validation for sales orders, invoices, and payments.
 *   - importRow: In-process atomic transactional dual-write of entity mutation + receipt.
 *   - loadBatch: Chunked batch processing (500 rows), bounded retry (transient 503/deadlock),
 *                and immediate halt if failure rate exceeds 10% after 10 rows.
 *
 * @module erp3/migration/target-adapter
 */

import { type Result, ok, err } from '@cs/kernel';
import { ZodError } from 'zod';
import type {
  TargetAdapter,
  TargetAdapterResult,
  TargetAdapterError,
} from '@cs/kit';
import {
  Erp3Service,
  DomainError,
  ConflictError,
  ValidationError,
} from '../services/erp3.service.js';
import { Erp3DomainError } from '../domain/rules.js';
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
// Erp3TargetAdapter
// ─────────────────────────────────────────────────────────────────────────────

export class Erp3TargetAdapter<TRow = unknown> implements TargetAdapter<TRow> {
  readonly module = 'erp3';
  readonly entity: 'sales_order' | 'invoice' | 'payment' | string;
  readonly schemaVersion = 1;

  constructor(
    private readonly service: Erp3Service,
    entity: 'sales_order' | 'invoice' | 'payment' | string = 'sales_order'
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

      if (ent === 'sales_order' || ent === 'sales_orders' || ent === 'order') {
        const hasCustomer =
          typeof record['customer_golden_id'] === 'string' &&
          record['customer_golden_id'].length > 0;
        const hasDate =
          typeof record['order_date'] === 'string' &&
          /^\d{4}-\d{2}-\d{2}/.test(record['order_date']);
        const lines = record['lines'];
        const hasLines = Array.isArray(lines) && lines.length > 0;
        let validLines = hasLines;

        if (hasLines) {
          for (const line of lines as Array<Record<string, unknown>>) {
            if (
              !line ||
              typeof line['product_id'] !== 'string' ||
              !line['product_id'] ||
              (typeof line['quantity'] !== 'number' && typeof line['quantity'] !== 'string') ||
              Number(line['quantity']) <= 0 ||
              (typeof line['unit_price'] !== 'number' &&
                typeof line['unit_price'] !== 'string' &&
                typeof line['price'] !== 'number' &&
                typeof line['price'] !== 'string')
            ) {
              validLines = false;
              break;
            }
          }
        }

        if (hasCustomer && hasDate && validLines) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else if (ent === 'invoice' || ent === 'invoices') {
        const hasCustomer =
          typeof record['customer_golden_id'] === 'string' &&
          record['customer_golden_id'].length > 0;
        const hasInvoiceDate =
          typeof record['invoice_date'] === 'string' &&
          /^\d{4}-\d{2}-\d{2}/.test(record['invoice_date']);
        const hasDueDate =
          typeof record['due_date'] === 'string' &&
          /^\d{4}-\d{2}-\d{2}/.test(record['due_date']);
        const dueAfterInvoice =
          hasInvoiceDate &&
          hasDueDate &&
          new Date(record['due_date'] as string) >= new Date(record['invoice_date'] as string);
        const lines = record['lines'];
        const hasLines = Array.isArray(lines) && lines.length > 0;

        if (hasCustomer && hasInvoiceDate && hasDueDate && dueAfterInvoice && hasLines) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else if (ent === 'payment' || ent === 'payments') {
        const hasInvoice =
          typeof record['invoice_id'] === 'string' && record['invoice_id'].length > 0;
        const rawAmount = record['amount'];
        const validAmount =
          (typeof rawAmount === 'number' && rawAmount > 0) ||
          (typeof rawAmount === 'string' && Number(rawAmount) > 0);
        const method = record['method'] ?? record['payment_method'];
        const validMethod =
          typeof method === 'string' && ['cash', 'bank', 'card'].includes(method.toLowerCase());

        if (hasInvoice && validAmount && validMethod) {
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
          kind: (result.receipt.kind as 'created' | 'linked') ?? 'created',
          createdAt: new Date(result.receipt.created_at),
        },
      });
    } catch (error: unknown) {
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

      if (error instanceof ZodError) {
        const first = error.issues[0];
        const errPayload: TargetAdapterError = {
          reasonCode: 'VALIDATION_ERROR',
          message: first?.message ?? 'Invalid import row data',
        };
        const field = first?.path.join('.');
        if (field) {
          errPayload.field = field;
        }
        return err(errPayload);
      }

      if (error instanceof Erp3DomainError) {
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
   * with bounded exponential retry and immediate halt on excessive failures (ERP3-13 / KIT-12).
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
