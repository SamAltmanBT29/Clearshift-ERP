/**
 * ClearShift Migration Kit — Resumable Compensating-Saga Rollback Engine (KIT-12)
 *
 * Implements non-distributed-ACID compensating rollback sagas:
 * 1. Conflict Preflight: verifies batch completeness, target versions, and child references.
 * 2. Stop New Writes: marks batch in-progress/locked.
 * 3. Reverse Dependency Order: executes compensation actions in reverse load position order (LIFO).
 * 4. Append-Only Journal: tracks before/after state, actor, target version, status, and idempotency key.
 * 5. Idempotent Execution: repeated requests on a completed rollback return existing status without re-compensating.
 * 6. Resumability: if halted/failed midway, re-invoking safely resumes uncompensated items without re-applying.
 * 7. Confirmed Completion: status reaches 'rolled_back' ONLY when 100% of actions are confirmed.
 *
 * @module migration-kit/rollback/saga
 */

import {
  RollbackAction,
  RollbackItemStatus,
  RollbackBatchStatus,
  type RollbackActionType,
  type RollbackBatchSummary,
  type RollbackPreflightResult,
  RollbackBlockedError,
} from '@clearshift/contracts';
import type { IImportReceiptStore, GenericTargetAdapterRegistry } from '../load/target-adapter.js';
import type { IKitRollbackJournalStore } from './journal.js';
import { RollbackPreflightChecker } from './preflight.js';

export interface RollbackBatchRequest {
  batchId: string;
  actor: string;
  reason: string;
  skipPreflight?: boolean | undefined;
}

export class CompensatingSagaEngine {
  private preflightChecker: RollbackPreflightChecker;

  constructor(
    private adapterRegistry: GenericTargetAdapterRegistry,
    private receiptStore: IImportReceiptStore,
    private journalStore: IKitRollbackJournalStore,
    preflightChecker?: RollbackPreflightChecker
  ) {
    this.preflightChecker =
      preflightChecker ?? new RollbackPreflightChecker(receiptStore, adapterRegistry, journalStore);
  }

  /**
   * Orchestrates the compensating saga for a migration batch.
   */
  public async rollbackBatch(request: RollbackBatchRequest): Promise<RollbackBatchSummary> {
    const { batchId, actor, reason, skipPreflight = false } = request;

    // 1. Idempotency Check: if already rolled back, return previous completed execution
    const existingExec = await this.journalStore.getExecution(batchId);
    if (existingExec && existingExec.status === RollbackBatchStatus.ROLLED_BACK) {
      return {
        ...existingExec,
        isExisting: true,
      };
    }

    // 2. Conflict Preflight Check
    let preflightResult: RollbackPreflightResult | undefined;
    if (!skipPreflight) {
      preflightResult = await this.preflightChecker.checkBatch(batchId);

      if (!preflightResult.passed) {
        const blockedSummary: RollbackBatchSummary = {
          batchId,
          status: RollbackBatchStatus.ROLLBACK_BLOCKED,
          requestedBy: actor,
          reason,
          preflightPassed: false,
          totalItems: preflightResult.totalReceipts,
          compensatedItems: 0,
          blockedItems: preflightResult.conflictCount,
          failedItems: 0,
          conflicts: preflightResult.conflicts,
          startedAt: existingExec?.startedAt ?? new Date(),
        };

        // Record conflict entries into journal as BLOCKED for audit durability
        for (const conflict of preflightResult.conflicts) {
          await this.journalStore.recordAction({
            batchId,
            module: conflict.module,
            entity: conflict.entity,
            targetId: conflict.targetId,
            sourceRow: conflict.sourceRow,
            action: RollbackAction.REMOVE_CREATED,
            targetVersion: conflict.currentVersion ?? 1,
            actor,
            status: RollbackItemStatus.BLOCKED,
            idempotencyKey: `blocked:${batchId}:${conflict.targetId}`,
            errorReason: conflict.message,
            position: 0,
          });
        }

        await this.journalStore.saveExecution(blockedSummary);
        return blockedSummary;
      }
    }

    // 3. Gather durable receipts and establish Reverse Dependency / Position Order
    const receipts = await this.receiptStore.listByBatchId(batchId);
    if (receipts.length === 0) {
      throw new RollbackBlockedError(batchId, [], `No receipts found for batch '${batchId}'`);
    }

    // Sort receipts descending by sourceRow (LIFO order: last loaded is compensated first)
    const sortedReceipts = [...receipts].sort((a, b) => b.sourceRow - a.sourceRow);

    // Seed or retrieve actions in the journal for each receipt
    for (let i = 0; i < sortedReceipts.length; i++) {
      const receipt = sortedReceipts[i]!;
      const actionType: RollbackActionType =
        receipt.kind === 'created'
          ? RollbackAction.REMOVE_CREATED
          : RollbackAction.RESTORE_UPDATED;

      const existingAction = await this.journalStore.getAction(
        batchId,
        receipt.idempotencyKey,
        actionType
      );

      if (!existingAction) {
        await this.journalStore.recordAction({
          batchId,
          module: receipt.module,
          entity: receipt.entity,
          targetId: receipt.targetId,
          sourceRow: receipt.sourceRow,
          action: actionType,
          targetVersion: receipt.schemaVersion,
          actor,
          status: RollbackItemStatus.PENDING,
          idempotencyKey: receipt.idempotencyKey,
          position: i + 1, // 1-indexed descending position
        });
      }
    }

    // 4. Mark execution IN_PROGRESS
    const currentExecution: RollbackBatchSummary = {
      batchId,
      status: RollbackBatchStatus.IN_PROGRESS,
      requestedBy: actor,
      reason,
      preflightPassed: true,
      totalItems: sortedReceipts.length,
      compensatedItems: 0,
      blockedItems: 0,
      failedItems: 0,
      conflicts: [],
      startedAt: existingExec?.startedAt ?? new Date(),
    };
    await this.journalStore.saveExecution(currentExecution);

    // 5. Compensate actions in Reverse Order (Resumable)
    const journalEntries = await this.journalStore.getJournalByBatchId(batchId);
    let compensatedCount = 0;
    let failedCount = 0;

    for (const entry of journalEntries) {
      // If already compensated in a previous run, do not re-apply (Resumability)
      if (entry.status === RollbackItemStatus.COMPENSATED) {
        compensatedCount++;
        continue;
      }

      const adapter = this.adapterRegistry.get(entry.module, entry.entity);
      if (!adapter || typeof adapter.compensateRow !== 'function') {
        const errorMsg = `Adapter for '${entry.module}:${entry.entity}' does not support compensateRow.`;
        await this.journalStore.updateActionStatus(
          batchId,
          entry.idempotencyKey,
          entry.action,
          RollbackItemStatus.FAILED,
          { errorReason: errorMsg }
        );
        failedCount++;
        break;
      }

      // Execute compensation via adapter port
      const compensationOptions: {
        beforeState?: Record<string, unknown> | null;
        expectedVersion?: number;
      } = {
        expectedVersion: entry.targetVersion,
      };
      if (entry.beforeState !== undefined) {
        compensationOptions.beforeState = entry.beforeState;
      }

      const compensationResult = await adapter.compensateRow(
        entry.targetId,
        entry.action,
        compensationOptions
      );

      if (compensationResult.ok) {
        await this.journalStore.updateActionStatus(
          batchId,
          entry.idempotencyKey,
          entry.action,
          RollbackItemStatus.COMPENSATED,
          { executedAt: new Date() }
        );
        compensatedCount++;
      } else {
        const updateOptions: { errorReason?: string } = {};
        if (compensationResult.error !== undefined) {
          updateOptions.errorReason = compensationResult.error;
        }
        await this.journalStore.updateActionStatus(
          batchId,
          entry.idempotencyKey,
          entry.action,
          RollbackItemStatus.FAILED,
          updateOptions
        );
        failedCount++;
        // Halt on failure: saga preserves progress and leaves remaining items resumable
        break;
      }
    }

    // 6. Confirmed Completion Status
    const isComplete = compensatedCount === journalEntries.length && failedCount === 0;
    const finalStatus = isComplete
      ? RollbackBatchStatus.ROLLED_BACK
      : failedCount > 0
      ? RollbackBatchStatus.FAILED
      : RollbackBatchStatus.IN_PROGRESS;

    const finalSummary: RollbackBatchSummary = {
      batchId,
      status: finalStatus,
      requestedBy: actor,
      reason,
      preflightPassed: true,
      totalItems: journalEntries.length,
      compensatedItems: compensatedCount,
      blockedItems: 0,
      failedItems: failedCount,
      conflicts: [],
      startedAt: currentExecution.startedAt,
      completedAt: isComplete ? new Date() : undefined,
    };

    await this.journalStore.saveExecution(finalSummary);
    return finalSummary;
  }
}
