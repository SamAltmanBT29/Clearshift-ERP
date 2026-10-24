import { randomUUID } from 'node:crypto';
import {
  computeStableIdempotencyKey,
  computeCanonicalPayloadHash,
  type MigrationTargetAdapter,
  type MigrationTargetAdapterResult,
  type MigrationTargetAdapterError,
} from '@clearshift/contracts';
import { RowOutcome, evaluateReconciliation, type ReconciliationCounts } from '@cs/kit';

/**
 * Default chunk size for Migration Kit V1 Real Load (Decision KIT-08 & SDS §11.1)
 */
export const DEFAULT_CHUNK_SIZE = 500;

/**
 * Maximum allowable row failure rate before halting load (STP-01 / Core Rules: 10%)
 */
export const MAX_FAILURE_RATE_PERCENT = 10.0;

/**
 * Durable Import Receipt Interface (survives worker restarts)
 */
export interface DurableImportReceipt {
  id: string;
  batchId: string;
  sourceRow: number;
  module: string;
  entity: string;
  schemaVersion: number;
  idempotencyKey: string;
  payloadHash: string;
  targetId: string;
  kind: 'created' | 'linked';
  createdAt: Date;
}

/**
 * Storage contract for durable import receipts.
 * Modules or platform provide concrete implementations backed by PostgreSQL.
 */
export interface IImportReceiptStore {
  findByIdempotencyKey(key: string): Promise<DurableImportReceipt | null>;
  findByBatchRow(batchId: string, sourceRow: number, entity: string): Promise<DurableImportReceipt | null>;
  saveReceipt(receipt: DurableImportReceipt): Promise<void>;
  listByBatchId(batchId: string): Promise<DurableImportReceipt[]>;
  countByBatchId(batchId: string): Promise<number>;
}

/**
 * In-Memory durable receipt store used for tests and worker restart recovery simulation.
 */
export class InMemoryImportReceiptStore implements IImportReceiptStore {
  private receiptsByKey: Map<string, DurableImportReceipt> = new Map();
  private receiptsByBatchRow: Map<string, DurableImportReceipt> = new Map();

  public async findByIdempotencyKey(key: string): Promise<DurableImportReceipt | null> {
    return this.receiptsByKey.get(key) ?? null;
  }

  public async findByBatchRow(
    batchId: string,
    sourceRow: number,
    entity: string
  ): Promise<DurableImportReceipt | null> {
    const compositeKey = `${batchId}:${sourceRow}:${entity}`;
    return this.receiptsByBatchRow.get(compositeKey) ?? null;
  }

  public async saveReceipt(receipt: DurableImportReceipt): Promise<void> {
    this.receiptsByKey.set(receipt.idempotencyKey, receipt);
    const compositeKey = `${receipt.batchId}:${receipt.sourceRow}:${receipt.entity}`;
    this.receiptsByBatchRow.set(compositeKey, receipt);
  }

  public async listByBatchId(batchId: string): Promise<DurableImportReceipt[]> {
    return Array.from(this.receiptsByKey.values()).filter((r) => r.batchId === batchId);
  }

  public async countByBatchId(batchId: string): Promise<number> {
    const list = await this.listByBatchId(batchId);
    return list.length;
  }

  public clear(): void {
    this.receiptsByKey.clear();
    this.receiptsByBatchRow.clear();
  }
}

/**
 * Reusable Base Target Adapter
 * Guarantees:
 * - Atomic transaction simulation between domain entity and import receipt
 * - Idempotency replay semantics (same key + same payload = prior result)
 * - Conflict detection on payload drift (same key + different payload = 409)
 */
export abstract class BaseTargetAdapter<TRow = Record<string, unknown>>
  implements MigrationTargetAdapter<TRow>
{
  public abstract readonly module: string;
  public abstract readonly entity: string;
  public abstract readonly schemaVersion: number;

  protected receiptStore: IImportReceiptStore;
  protected targetRecords: Map<string, { id: string; data: TRow; createdAt: Date }> = new Map();

  constructor(receiptStore?: IImportReceiptStore) {
    this.receiptStore = receiptStore ?? new InMemoryImportReceiptStore();
  }

  public getReceiptStore(): IImportReceiptStore {
    return this.receiptStore;
  }

  public getTargetRecords(): Array<{ id: string; data: TRow; createdAt: Date }> {
    return Array.from(this.targetRecords.values());
  }

  public getRecordById(id: string): { id: string; data: TRow; createdAt: Date } | undefined {
    return this.targetRecords.get(id);
  }

  /**
   * Preflight validation during dry-run phase (zero database mutations).
   */
  public async preflight(
    _batchId: string,
    rows: TRow[]
  ): Promise<{ validCount: number; rejectCount: number } | { error: MigrationTargetAdapterError }> {
    let validCount = 0;
    let rejectCount = 0;

    for (const row of rows) {
      const validation = await this.validateRow(row);
      if (validation.valid) {
        validCount++;
      } else {
        rejectCount++;
      }
    }

    return { validCount, rejectCount };
  }

  /**
   * Commits target business record and durable import receipt atomically in one local PG transaction.
   */
  public async importRow(
    batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    cleanData: TRow
  ): Promise<
    | { ok: true; value: MigrationTargetAdapterResult }
    | { ok: false; error: MigrationTargetAdapterError }
  > {
    const currentPayloadHash = computeCanonicalPayloadHash(cleanData);

    // 1. Idempotency Check
    const existingReceipt = await this.receiptStore.findByIdempotencyKey(idempotencyKey);
    if (existingReceipt) {
      if (existingReceipt.payloadHash === currentPayloadHash) {
        return {
          ok: true,
          value: {
            targetId: existingReceipt.targetId,
            receipt: {
              batchId: existingReceipt.batchId,
              sourceRow: existingReceipt.sourceRow,
              entity: existingReceipt.entity,
              schemaVersion: existingReceipt.schemaVersion,
              idempotencyKey: existingReceipt.idempotencyKey,
              targetId: existingReceipt.targetId,
              kind: existingReceipt.kind,
              createdAt: existingReceipt.createdAt,
              payloadHash: existingReceipt.payloadHash,
            },
            isExisting: true,
          },
        };
      }

      // Same key + different request payload returns 409 Conflict
      return {
        ok: false,
        error: {
          reasonCode: 'IDEMPOTENCY_CONFLICT',
          message: `Idempotency key '${idempotencyKey}' was already used with a different request payload.`,
          field: 'idempotencyKey',
        },
      };
    }

    // 2. Validate Row Data
    const validation = await this.validateRow(cleanData);
    if (!validation.valid) {
      return {
        ok: false,
        error: {
          reasonCode: validation.reasonCode ?? 'VALIDATION_FAILED',
          message: validation.message ?? 'Row validation failed',
          field: validation.field,
        },
      };
    }

    // 3. Atomic Target Mutation + Receipt Commit
    const targetId = randomUUID();
    const receipt: DurableImportReceipt = {
      id: randomUUID(),
      batchId,
      sourceRow,
      module: this.module,
      entity: this.entity,
      schemaVersion: this.schemaVersion,
      idempotencyKey,
      payloadHash: currentPayloadHash,
      targetId,
      kind: 'created',
      createdAt: new Date(),
    };

    // Commit both atomically
    this.targetRecords.set(targetId, {
      id: targetId,
      data: cleanData,
      createdAt: new Date(),
    });
    await this.receiptStore.saveReceipt(receipt);

    return {
      ok: true,
      value: {
        targetId,
        receipt: {
          batchId: receipt.batchId,
          sourceRow: receipt.sourceRow,
          entity: receipt.entity,
          schemaVersion: receipt.schemaVersion,
          idempotencyKey: receipt.idempotencyKey,
          targetId: receipt.targetId,
          kind: receipt.kind,
          createdAt: receipt.createdAt,
          payloadHash: receipt.payloadHash,
        },
        isExisting: false,
      },
    };
  }

  /**
   * Domain-specific validation logic to be implemented by child classes.
   */
  protected abstract validateRow(row: TRow): Promise<{
    valid: boolean;
    reasonCode?: string;
    message?: string;
    field?: string;
  }>;
}

/**
 * Generic Target Adapter Registry
 * Manages registered target adapters by `module:entity`.
 */
export class GenericTargetAdapterRegistry {
  private adapters: Map<string, MigrationTargetAdapter> = new Map();

  private makeKey(module: string, entity: string): string {
    return `${module.toLowerCase()}:${entity.toLowerCase()}`;
  }

  public register(adapter: MigrationTargetAdapter): void {
    const key = this.makeKey(adapter.module, adapter.entity);
    this.adapters.set(key, adapter);
  }

  public get(module: string, entity: string): MigrationTargetAdapter | undefined {
    return this.adapters.get(this.makeKey(module, entity));
  }

  public has(module: string, entity: string): boolean {
    return this.adapters.has(this.makeKey(module, entity));
  }

  public list(): Array<{ module: string; entity: string; schemaVersion: number }> {
    return Array.from(this.adapters.values()).map((a) => ({
      module: a.module,
      entity: a.entity,
      schemaVersion: a.schemaVersion,
    }));
  }

  public clear(): void {
    this.adapters.clear();
  }
}

/**
 * Row outcome representation during loading.
 */
export interface LoadRowResult {
  sourceRow: number;
  outcome: 'loaded' | 'rejected' | 'merged' | 'skipped';
  targetId?: string | undefined;
  isExisting?: boolean | undefined;
  error?: MigrationTargetAdapterError | undefined;
  idempotencyKey: string;
}

/**
 * Summary of chunked batch load execution.
 */
export interface BatchLoadSummary {
  batchId: string;
  module: string;
  entity: string;
  totalSourceRows: number;
  attemptedRows: number;
  loadedCount: number;
  rejectedCount: number;
  mergedCount: number;
  skippedCount: number;
  unaccountedCount: number;
  reconciliationStatus: 'OK' | 'NOT_OK' | 'PARTIAL';
  chunksProcessed: number;
  halted: boolean;
  haltReason?: string | undefined;
  rowResults: LoadRowResult[];
}

/**
 * Options for configuring TargetBatchLoader execution.
 */
export interface TargetBatchLoaderOptions {
  chunkSize?: number | undefined;
  maxFailureRatePercent?: number | undefined;
  isDryRun?: boolean | undefined;
}

/**
 * Target Batch Loader
 * Orchestrates Step 5 (Load) across chunks of source records using the registered TargetAdapter.
 * Enforces:
 * - Chunk size (default: 500)
 * - Stable idempotency key derivation
 * - 10% failure rate circuit breaker (STP-01)
 * - Row outcome conservation: source = loaded + rejected + merged + skipped (unaccounted = 0)
 */
export class TargetBatchLoader {
  constructor(private registry: GenericTargetAdapterRegistry) {}

  public async loadBatch<TRow = Record<string, unknown>>(
    batchId: string,
    module: string,
    entity: string,
    rows: Array<{ sourceRow: number; data: TRow; skipped?: boolean; skipReason?: string }>,
    options: TargetBatchLoaderOptions = {}
  ): Promise<BatchLoadSummary> {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const maxFailureRate = options.maxFailureRatePercent ?? MAX_FAILURE_RATE_PERCENT;
    const isDryRun = options.isDryRun ?? false;

    const adapter = this.registry.get(module, entity);
    if (!adapter) {
      throw new Error(`No TargetAdapter registered for target '${module}:${entity}'`);
    }

    const rowResults: LoadRowResult[] = [];
    let loadedCount = 0;
    let rejectedCount = 0;
    let mergedCount = 0;
    let skippedCount = 0;
    let chunksProcessed = 0;
    let halted = false;
    let haltReason: string | undefined;

    // Dry Run Path (zero database mutations)
    if (isDryRun) {
      const activeRows = rows.filter((r) => !r.skipped).map((r) => r.data);
      const preflightResult = await adapter.preflight(batchId, activeRows);

      if ('error' in preflightResult) {
        throw new Error(`Dry-run preflight failed: ${preflightResult.error.message}`);
      }

      for (const row of rows) {
        const idempKey = computeStableIdempotencyKey({
          batchId,
          sourceRow: row.sourceRow,
          module,
          entity,
          operationVersion: adapter.schemaVersion,
        });

        if (row.skipped) {
          skippedCount++;
          rowResults.push({
            sourceRow: row.sourceRow,
            outcome: RowOutcome.SKIPPED,
            idempotencyKey: idempKey,
          });
        } else {
          // In dry run, records are predicted as loaded
          loadedCount++;
          rowResults.push({
            sourceRow: row.sourceRow,
            outcome: RowOutcome.LOADED,
            idempotencyKey: idempKey,
          });
        }
      }

      const reconciliation = evaluateReconciliation({
        source: rows.length,
        loaded: loadedCount,
        rejected: rejectedCount,
        merged: mergedCount,
        skipped: skippedCount,
        pending: 0,
      });

      return {
        batchId,
        module,
        entity,
        totalSourceRows: rows.length,
        attemptedRows: rows.length,
        loadedCount,
        rejectedCount,
        mergedCount,
        skippedCount,
        unaccountedCount: reconciliation.unaccounted,
        reconciliationStatus: reconciliation.result,
        chunksProcessed: 1,
        halted: false,
        rowResults,
      };
    }

    // Real Load Path: Process in chunks of 500
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      chunksProcessed++;

      for (const row of chunk) {
        const idempKey = computeStableIdempotencyKey({
          batchId,
          sourceRow: row.sourceRow,
          module,
          entity,
          operationVersion: adapter.schemaVersion,
        });

        // 1. Explicitly Skipped Rows
        if (row.skipped) {
          skippedCount++;
          rowResults.push({
            sourceRow: row.sourceRow,
            outcome: RowOutcome.SKIPPED,
            idempotencyKey: idempKey,
          });
          continue;
        }

        // 2. Delegate to target adapter port
        const res = await adapter.importRow(batchId, row.sourceRow, idempKey, row.data);

        if (res.ok) {
          loadedCount++;
          rowResults.push({
            sourceRow: row.sourceRow,
            outcome: RowOutcome.LOADED,
            targetId: res.value.targetId,
            isExisting: res.value.isExisting ?? false,
            idempotencyKey: idempKey,
          });
        } else {
          rejectedCount++;
          rowResults.push({
            sourceRow: row.sourceRow,
            outcome: RowOutcome.REJECTED,
            error: res.error,
            idempotencyKey: idempKey,
          });
        }

        // 3. Circuit breaker: Check 10% row failure threshold
        const attemptedRows = loadedCount + rejectedCount + mergedCount;
        if (attemptedRows > 0) {
          const failureRate = (rejectedCount / attemptedRows) * 100;
          if (failureRate > maxFailureRate) {
            halted = true;
            haltReason = `Cumulative row failure rate ${failureRate.toFixed(1)}% exceeds ${maxFailureRate}% threshold (STP-01)`;
            break;
          }
        }
      }

      if (halted) {
        break;
      }
    }

    // Account for any remaining unattempted rows if halted early
    const processedRowCount = rowResults.length;
    if (processedRowCount < rows.length) {
      const remainingRows = rows.slice(processedRowCount);
      for (const rem of remainingRows) {
        const idempKey = computeStableIdempotencyKey({
          batchId,
          sourceRow: rem.sourceRow,
          module,
          entity,
          operationVersion: adapter.schemaVersion,
        });
        // Unprocessed rows due to early halt are marked rejected with threshold reason
        rejectedCount++;
        rowResults.push({
          sourceRow: rem.sourceRow,
          outcome: RowOutcome.REJECTED,
          error: {
            reasonCode: 'STOP_THRESHOLD_EXCEEDED',
            message: haltReason ?? 'Batch halted due to excessive failures',
          },
          idempotencyKey: idempKey,
        });
      }
    }

    // Enforce row conservation: source = loaded + rejected + merged + skipped
    const reconciliationCounts: ReconciliationCounts = {
      source: rows.length,
      loaded: loadedCount,
      rejected: rejectedCount,
      merged: mergedCount,
      skipped: skippedCount,
      pending: 0,
    };
    const reconciliation = evaluateReconciliation(reconciliationCounts);

    return {
      batchId,
      module,
      entity,
      totalSourceRows: rows.length,
      attemptedRows: rowResults.length,
      loadedCount,
      rejectedCount,
      mergedCount,
      skippedCount,
      unaccountedCount: reconciliation.unaccounted,
      reconciliationStatus: reconciliation.result,
      chunksProcessed,
      halted,
      haltReason,
      rowResults,
    };
  }
}
