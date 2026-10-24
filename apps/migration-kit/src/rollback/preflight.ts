/**
 * ClearShift Migration Kit — Rollback Conflict Preflight (KIT-12)
 *
 * Implements preflight validation prior to executing compensating sagas:
 * - Checks batch and receipt completeness.
 * - Asserts target version matches post-load version (no later edits).
 * - Checks for downstream child entity references (e.g., invoices referencing sales orders).
 *
 * Invariants:
 * - Preflight NEVER mutates business records or import receipts.
 * - Any detected conflict (child refs, version mismatch) marks preflight as failed and blocks rollback.
 *
 * @module migration-kit/rollback/preflight
 */

import {
  RollbackAction,
  RollbackItemStatus,
  RollbackConflictReason,
  type RollbackActionType,
  type RollbackConflictDetail,
  type RollbackPreflightResult,
} from '@clearshift/contracts';
import type { IImportReceiptStore, GenericTargetAdapterRegistry } from '../load/target-adapter.js';
import type { IKitRollbackJournalStore } from './journal.js';

export class RollbackPreflightChecker {
  constructor(
    private receiptStore: IImportReceiptStore,
    private adapterRegistry: GenericTargetAdapterRegistry,
    private journalStore?: IKitRollbackJournalStore | undefined
  ) {}

  /**
   * Executes conflict preflight checks across all durable receipts for a batch.
   */
  public async checkBatch(batchId: string): Promise<RollbackPreflightResult> {
    const receipts = await this.receiptStore.listByBatchId(batchId);
    const conflicts: RollbackConflictDetail[] = [];

    // 1. Receipt Completeness Check
    if (receipts.length === 0) {
      conflicts.push({
        targetId: 'batch-receipts',
        module: 'unknown',
        entity: 'unknown',
        reasonCode: RollbackConflictReason.RECEIPT_NOT_FOUND,
        message: `No durable import receipts found for batch '${batchId}'. Cannot verify rollback safety.`,
      });

      return {
        batchId,
        passed: false,
        totalReceipts: 0,
        conflictCount: 1,
        conflicts,
      };
    }

    // 2. Inspect each loaded target record via its owning adapter
    for (const receipt of receipts) {
      // If already compensated in a prior partial run of this saga, skip conflict check
      if (this.journalStore) {
        const actionType: RollbackActionType =
          receipt.kind === 'created'
            ? RollbackAction.REMOVE_CREATED
            : RollbackAction.RESTORE_UPDATED;
        const priorAction = await this.journalStore.getAction(
          batchId,
          receipt.idempotencyKey,
          actionType
        );
        if (priorAction && priorAction.status === RollbackItemStatus.COMPENSATED) {
          continue;
        }
      }
      const adapter = this.adapterRegistry.get(receipt.module, receipt.entity);
      if (!adapter) {
        conflicts.push({
          targetId: receipt.targetId,
          module: receipt.module,
          entity: receipt.entity,
          sourceRow: receipt.sourceRow,
          reasonCode: RollbackConflictReason.RECORD_NOT_FOUND,
          message: `No registered TargetAdapter found for module '${receipt.module}', entity '${receipt.entity}'.`,
        });
        continue;
      }

      if (typeof adapter.checkRollbackConflict === 'function') {
        const check = await adapter.checkRollbackConflict(receipt.targetId, receipt.schemaVersion);

        if (!check.canRollback) {
          if (check.hasChildReferences) {
            conflicts.push({
              targetId: receipt.targetId,
              module: receipt.module,
              entity: receipt.entity,
              sourceRow: receipt.sourceRow,
              reasonCode: RollbackConflictReason.CHILD_REFERENCES_EXIST,
              message:
                check.reason ??
                `Record '${receipt.targetId}' cannot be rolled back because downstream child references exist.`,
              currentVersion: check.currentVersion,
              postLoadVersion: receipt.schemaVersion,
              childReferences: check.childReferences,
            });
          } else if (check.currentVersion !== receipt.schemaVersion) {
            conflicts.push({
              targetId: receipt.targetId,
              module: receipt.module,
              entity: receipt.entity,
              sourceRow: receipt.sourceRow,
              reasonCode: RollbackConflictReason.TARGET_VERSION_MISMATCH,
              message:
                check.reason ??
                `Record '${receipt.targetId}' has version ${check.currentVersion}, differing from post-load version ${receipt.schemaVersion} (later edits detected).`,
              currentVersion: check.currentVersion,
              postLoadVersion: receipt.schemaVersion,
            });
          } else {
            conflicts.push({
              targetId: receipt.targetId,
              module: receipt.module,
              entity: receipt.entity,
              sourceRow: receipt.sourceRow,
              reasonCode: RollbackConflictReason.LATER_EDITS_DETECTED,
              message: check.reason ?? `Record '${receipt.targetId}' cannot be rolled back safely.`,
              currentVersion: check.currentVersion,
              postLoadVersion: receipt.schemaVersion,
            });
          }
        }
      }
    }

    return {
      batchId,
      passed: conflicts.length === 0,
      totalReceipts: receipts.length,
      conflictCount: conflicts.length,
      conflicts,
    };
  }
}
