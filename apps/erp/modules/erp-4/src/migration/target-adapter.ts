/**
 * ERP-4 Target Adapter (Decision C4 & KIT-08 / ERP4-07)
 *
 * Implements the TargetAdapter port from @cs/kit.
 * Executed in-process to guarantee atomic transaction commits between
 * the target business entity and the durable import receipt.
 *
 * Capabilities:
 *   - preflight: Zero-mutation dry run validation for chart of accounts, journal entries, and opening balances.
 *   - importRow: In-process atomic transactional dual-write of entity mutation + durable receipt.
 *   - loadBatch: Chunked batch processing (500 rows), bounded retry (transient 503/deadlock),
 *                and immediate halt if failure rate exceeds 10% after 10 rows.
 *
 * @module erp4/migration/target-adapter
 */

import { type Result, ok, err } from '@cs/kernel';
import type {
  TargetAdapter,
  TargetAdapterResult,
  TargetAdapterError,
} from '@cs/kit';
import {
  FinanceService,
  ServiceError,
  ConflictError,
  BadRequestError,
  UnprocessableError,
} from '../services/finance.service.js';
import { DomainError, assertDoubleEntryBalanced } from '../../domain/engine.js';

// ─────────────────────────────────────────────────────────────────────────────
// Batch Processing Constants & Types (KIT-08 / Decision C4 / Core Rules)
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_CHUNK_SIZE = 500;
export const DEFAULT_FAILURE_THRESHOLD = 0.10; // 10%
export const DEFAULT_MIN_ATTEMPTED_ROWS = 10;

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
  /** Size of chunks to process (default 500). */
  chunkSize?: number | undefined;
  /** Failure rate threshold that halts execution (default 0.10 / 10%). */
  failureThreshold?: number | undefined;
  /** Minimum attempted rows before threshold checks activate (default 10). */
  minAttemptedRows?: number | undefined;
  /** Maximum retry attempts for transient errors (default 3). */
  maxRetries?: number | undefined;
  /** Initial retry delay in milliseconds (default 10ms). */
  initialDelayMs?: number | undefined;
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

/** Helper: chunk an array into segments of size N */
export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Erp4TargetAdapter
// ─────────────────────────────────────────────────────────────────────────────

export class Erp4TargetAdapter<TRow = unknown> implements TargetAdapter<TRow> {
  readonly module = 'erp4';
  readonly entity: 'account' | 'journal_entry' | 'opening_balance' | string;
  readonly schemaVersion = 1;

  constructor(
    private readonly service: FinanceService,
    entity: 'account' | 'journal_entry' | 'opening_balance' | string = 'account'
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

      if (this.entity === 'account') {
        const hasCode = typeof record['code'] === 'string' && record['code'].trim().length > 0;
        const hasName = typeof record['name'] === 'string' && record['name'].trim().length > 0;
        const validTypes = ['asset', 'liability', 'income', 'expense'];
        const hasValidType = typeof record['type'] === 'string' && validTypes.includes(record['type']);
        if (hasCode && hasName && hasValidType) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else if (this.entity === 'journal_entry') {
        const hasPeriod = typeof record['period_id'] === 'string' && record['period_id'].trim().length > 0;
        const hasDate = typeof record['posting_date'] === 'string' && record['posting_date'].trim().length > 0;
        const lines = Array.isArray(record['lines']) ? record['lines'] : [];
        const hasLines = lines.length >= 2;

        let balanced = false;
        if (hasLines) {
          try {
            const currency = String(record['currency_code'] ?? 'INR').trim().toUpperCase();
            const normalizedLines = lines.map((l: any) => ({
              account_id: l.account_id ?? '',
              debit_amount: l.debit_amount !== undefined ? l.debit_amount : (l.debit ?? '0'),
              credit_amount: l.credit_amount !== undefined ? l.credit_amount : (l.credit ?? '0'),
            }));
            assertDoubleEntryBalanced(normalizedLines, currency);
            balanced = true;
          } catch {
            balanced = false;
          }
        }

        if (hasPeriod && hasDate && hasLines && balanced) {
          validCount++;
        } else {
          rejectCount++;
        }
      } else if (this.entity === 'opening_balance') {
        const hasAccount = typeof record['account_id'] === 'string' && record['account_id'].trim().length > 0;
        const hasAmount =
          (typeof record['balance_amount'] === 'string' && record['balance_amount'].trim().length > 0) ||
          typeof record['balance_amount'] === 'number';
        const hasDate = typeof record['as_of_date'] === 'string' && record['as_of_date'].trim().length > 0;
        if (hasAccount && hasAmount && hasDate) {
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
   */
  async importRow(
    batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    cleanData: TRow,
    meta?: { sourceSystem?: string | undefined; sourceId?: string | undefined; correlationId?: string | undefined }
  ): Promise<Result<TargetAdapterResult & { priorResult?: boolean | undefined }, TargetAdapterError>> {
    try {
      const result = await this.service.importRow({
        batch_id: batchId,
        source_row: sourceRow,
        source_system: meta?.sourceSystem ?? null,
        source_id: meta?.sourceId ?? null,
        idempotency_key: idempotencyKey,
        correlation_id: meta?.correlationId ?? null,
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
          kind: result.receipt.kind as 'created' | 'linked',
          createdAt: new Date(result.receipt.created_at),
        },
      });
    } catch (error: any) {
      // 1. Business & domain rejections: return stable reason code and message
      if (
        error instanceof ServiceError ||
        error instanceof DomainError ||
        error?.name === 'DomainError' ||
        error?.name === 'ServiceError'
      ) {
        // Simulated or transient infrastructure 503 errors must remain retryable and NOT recorded as rejected
        if (error.statusCode === 503 || error?.retryable === true) {
          throw error;
        }

        const reasonCode = error.code ?? (error instanceof DomainError ? 'DOMAIN_INVARIANT_VIOLATION' : 'VALIDATION_ERROR');
        const errPayload: TargetAdapterError = {
          reasonCode,
          message: error.message,
        };
        const field = error.details?.[0]?.field;
        if (field) {
          errPayload.field = field;
        }
        return err(errPayload);
      }

      // 2. Unexpected / transient infrastructure failure (503, DB timeout, etc.) must NOT be misclassified as bad data
      throw error;
    }
  }

  /**
   * Loads a batch of rows in 500-row chunks with bounded retry and failure threshold halting.
   */
  async loadBatch(
    batchId: string,
    rows: BatchRowInput<TRow>[],
    options: LoadBatchOptions = {}
  ): Promise<LoadBatchResult> {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    const minAttemptedRows = options.minAttemptedRows ?? DEFAULT_MIN_ATTEMPTED_ROWS;
    const maxRetries = options.maxRetries ?? 3;
    const initialDelayMs = options.initialDelayMs ?? 10;

    const rowResults: LoadBatchRowResult[] = [];
    let loadedCount = 0;
    let rejectedCount = 0;
    let chunksProcessed = 0;
    let stoppedEarly = false;
    let stoppedReason: string | null = null;

    const chunks = chunkArray(rows, chunkSize);

    chunkLoop: for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const currentChunk = chunks[chunkIdx]!;
      chunksProcessed++;

      for (let rIdx = 0; rIdx < currentChunk.length; rIdx++) {
        const item = currentChunk[rIdx]!;

        // Check if failure rate exceeds 10% after minAttemptedRows
        const totalAttempted = loadedCount + rejectedCount;
        if (totalAttempted >= minAttemptedRows) {
          const currentFailureRate = rejectedCount / totalAttempted;
          if (currentFailureRate > failureThreshold) {
            stoppedEarly = true;
            stoppedReason = `Failure rate ${(currentFailureRate * 100).toFixed(1)}% exceeded threshold ${(failureThreshold * 100).toFixed(1)}% after ${totalAttempted} attempted rows.`;

            // Mark this row and all remaining rows in all subsequent chunks as unattempted
            rowResults.push({
              sourceRow: item.sourceRow,
              idempotencyKey: item.idempotencyKey,
              outcome: 'unattempted',
            });

            // Mark remaining rows in this chunk
            for (let rem = rIdx + 1; rem < currentChunk.length; rem++) {
              const remItem = currentChunk[rem]!;
              rowResults.push({
                sourceRow: remItem.sourceRow,
                idempotencyKey: remItem.idempotencyKey,
                outcome: 'unattempted',
              });
            }

            // Mark all remaining chunks as unattempted
            for (let remChunk = chunkIdx + 1; remChunk < chunks.length; remChunk++) {
              for (const remItem of chunks[remChunk]!) {
                rowResults.push({
                  sourceRow: remItem.sourceRow,
                  idempotencyKey: remItem.idempotencyKey,
                  outcome: 'unattempted',
                });
              }
            }
            break chunkLoop;
          }
        }

        // Bounded retry execution for transient errors
        let attempt = 0;
        let lastError: unknown = null;
        let rowOutcome: Result<TargetAdapterResult & { priorResult?: boolean | undefined }, TargetAdapterError> | null = null;

        while (attempt < maxRetries) {
          attempt++;
          try {
            rowOutcome = await this.importRow(
              batchId,
              item.sourceRow,
              item.idempotencyKey,
              item.data,
              { sourceSystem: item.sourceSystem, sourceId: item.sourceId }
            );
            break;
          } catch (err: any) {
            lastError = err;
            if (attempt < maxRetries) {
              const delay = initialDelayMs * Math.pow(2, attempt - 1);
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }

        if (!rowOutcome && lastError) {
          // Retry exhausted for infrastructure error — rethrow to fail cleanly and preserve evidence
          throw lastError;
        }

        if (rowOutcome && rowOutcome.ok) {
          loadedCount++;
          rowResults.push({
            sourceRow: item.sourceRow,
            idempotencyKey: item.idempotencyKey,
            outcome: 'loaded',
            attempts: attempt,
            priorResult: rowOutcome.value.priorResult,
            result: rowOutcome.value,
          });
        } else if (rowOutcome && !rowOutcome.ok) {
          rejectedCount++;
          rowResults.push({
            sourceRow: item.sourceRow,
            idempotencyKey: item.idempotencyKey,
            outcome: 'rejected',
            attempts: attempt,
            error: rowOutcome.error,
          });
        }
      }
    }

    const totalRows = rows.length;
    const attemptedCount = loadedCount + rejectedCount;
    const unattemptedCount = totalRows - attemptedCount;

    return {
      batchId,
      status: stoppedEarly ? 'STOPPED_EXCESSIVE_FAILURES' : 'COMPLETED',
      total: totalRows,
      attempted: attemptedCount,
      loaded: loadedCount,
      rejected: rejectedCount,
      unattempted: unattemptedCount,
      chunksProcessed,
      stoppedReason,
      rows: rowResults,
    };
  }
}
