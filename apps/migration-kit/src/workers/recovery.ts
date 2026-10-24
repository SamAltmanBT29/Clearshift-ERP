/**
 * ClearShift Migration Kit — Worker Crash Recovery & Partial Load Manager (KIT-11)
 *
 * Implements:
 * 1. Resumption from latest committed checkpoint after worker crash.
 * 2. Stable idempotency key preservation across retries.
 * 3. Bounded retry exhaustion handling (3 attempts max).
 * 4. Unresolved write handling: transitions batch to `load_failed_partial`
 *    WITHOUT marking unresolved rows as rejected.
 * 5. Strict reconciliation blocking when batch is in `load_failed_partial` or `failed`.
 *
 * @module migration-kit/workers/recovery
 */

import {
  type KitBatchStatus,
  ReconciliationBlockedError,
  PartialLoadExhaustionError,
  deriveStableIdempotencyKey,
  type MigrationTargetAdapter,
} from '@clearshift/contracts';
import type { IImportReceiptStore, DurableImportReceipt } from '../load/target-adapter.js';
import type { IKitRowOutcomeStore } from '../reconcile/outcome-ledger.js';
import type { IBatchRegistryRepository } from '../batches/types.js';

export interface RecoveryPlan {
  batchId: string;
  fromCheckpoint: string;
  totalRows: number;
  alreadyCommittedRows: number;
  remainingRowsToProcess: number;
  canResume: boolean;
}

export class WorkerRecoveryManager {
  constructor(
    private receiptStore: IImportReceiptStore,
    private outcomeStore?: IKitRowOutcomeStore,
    private batchRepository?: IBatchRegistryRepository
  ) {}

  /**
   * Plans recovery for a crashed or partially failed batch.
   * Discovers already committed import receipts from PostgreSQL.
   */
  public async planRecovery<TRow = Record<string, unknown>>(
    batchId: string,
    checkpoint: string,
    rows: Array<{ sourceRow: number; data: TRow }>
  ): Promise<RecoveryPlan> {
    const existingReceipts = await this.receiptStore.listByBatchId(batchId);
    const committedRows = new Set(existingReceipts.map((r) => r.sourceRow));

    const remainingRows = rows.filter((r) => !committedRows.has(r.sourceRow));

    return {
      batchId,
      fromCheckpoint: checkpoint,
      totalRows: rows.length,
      alreadyCommittedRows: committedRows.size,
      remainingRowsToProcess: remainingRows.length,
      canResume: true,
    };
  }

  /**
   * Resumes execution of a partially loaded batch.
   * Skips already committed rows by replaying their existing receipts idempotently,
   * and processes remaining rows with the same stable idempotency key.
   */
  public async resumePartialLoad<TRow = Record<string, unknown>>(params: {
    batchId: string;
    module: string;
    entity: string;
    rows: Array<{ sourceRow: number; data: TRow }>;
    adapter: MigrationTargetAdapter<TRow>;
    attempt?: number;
  }): Promise<{
    batchId: string;
    replayedCount: number;
    newlyLoadedCount: number;
    finalStatus: KitBatchStatus;
  }> {
    const { batchId, module, entity, rows, adapter, attempt = 2 } = params;

    // 1. Fetch existing receipts
    const existingReceipts = await this.receiptStore.listByBatchId(batchId);
    const committedRowMap = new Map<number, DurableImportReceipt>(
      existingReceipts.map((r) => [r.sourceRow, r])
    );

    let replayedCount = 0;
    let newlyLoadedCount = 0;

    for (const row of rows) {
      const idempotencyKey = deriveStableIdempotencyKey({
        batchId,
        sourceRow: row.sourceRow,
        module,
        entity,
        operationVersion: adapter.schemaVersion,
      });

      // 2. If row was already committed before crash, replay receipt idempotently
      if (committedRowMap.has(row.sourceRow)) {
        replayedCount++;
        continue;
      }

      // 3. Process previously uncommitted row with identical idempotency key
      const res = await adapter.importRow(batchId, row.sourceRow, idempotencyKey, row.data);
      if (res.ok) {
        newlyLoadedCount++;
        if (this.outcomeStore) {
          await this.outcomeStore.recordOutcome({
            batchId,
            sourceRow: row.sourceRow,
            outcome: 'loaded',
            targetId: res.value.targetId,
            idempotencyKey,
          });
        }
      } else {
        // If write fails after retries exhausted, transition batch to load_failed_partial
        // CRITICAL INVARIANT: Unresolved write does NOT become rejected!
        if (this.batchRepository) {
          const existing = await this.batchRepository.findById(batchId);
          if (existing) {
            await this.batchRepository.update(batchId, {
              status: 'load_failed_partial',
              checkpoint: 'load_checkpoint',
            });
          }
        }
        throw new PartialLoadExhaustionError(
          batchId,
          attempt,
          res.error.message
        );
      }
    }

    if (this.batchRepository) {
      const existing = await this.batchRepository.findById(batchId);
      if (existing) {
        await this.batchRepository.update(batchId, {
          status: 'loaded',
          checkpoint: 'loaded',
        });
      }
    }


    return {
      batchId,
      replayedCount,
      newlyLoadedCount,
      finalStatus: 'loaded',
    };
  }

  /**
   * Asserts that reconciliation is permitted for the batch.
   * Throws ReconciliationBlockedError if batch is in failed or load_failed_partial status.
   */
  public assertReconciliationAllowed(batchId: string, status: KitBatchStatus): void {
    if (status === 'load_failed_partial' || status === 'failed') {
      throw new ReconciliationBlockedError(batchId, status);
    }
  }
}
