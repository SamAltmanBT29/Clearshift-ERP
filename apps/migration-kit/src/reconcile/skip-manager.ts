/**
 * ClearShift Migration Kit — Operator Skip Authorization & Lifecycle (KIT-09)
 *
 * Implements strict operator-approved skip authorization per SDS §11.1 and Issue #76:
 * - A skipped outcome is permitted only before real load.
 * - An Editor or Admin confirms the Skip row action.
 * - Reason of at least 10 non-whitespace characters is supplied.
 * - Kit records actor, time, policy code 'operator_approved_skip'.
 * - Migration Runner cannot approve its own skip (separation of duties).
 * - Any skip after dry-run invalidates the dry-run token and requires a new dry-run.
 * - Ignored columns never mean skipped rows.
 *
 * @module migration-kit/reconcile/skip-manager
 */

import {
  TerminalOutcome,
  SKIP_POLICY_CODE,
  hasMinNonWhitespaceChars,
  SkipApprovalForbiddenError,
  InvalidSkipReasonError,
  type SkipRowRequest,
  type KitRowOutcomeRecord,
} from '@clearshift/contracts';
import { BatchStatus, type BatchStatusType } from '@cs/kit';
import type { IKitRowOutcomeStore } from './outcome-ledger.js';
import type { IDryRunTokenManager } from './dry-run-token.js';

export interface SkipRowResult {
  record: KitRowOutcomeRecord;
  dryRunInvalidated: boolean;
  message: string;
}

export class SkipManager {
  constructor(
    private readonly outcomeStore: IKitRowOutcomeStore,
    private readonly tokenManager?: IDryRunTokenManager | undefined
  ) {}

  /**
   * Evaluates and records an operator-approved skip for a source row.
   *
   * @param req SkipRowRequest containing batchId, sourceRow, actor, actorRoles, reason, batchRunner
   * @param currentBatchStatus Current batch lifecycle state
   */
  public async approveSkip(
    req: SkipRowRequest,
    currentBatchStatus: BatchStatusType
  ): Promise<SkipRowResult> {
    // 1. Invariant: Skipped outcome permitted only BEFORE real load
    const allowedPreLoadStatuses: readonly string[] = [
      BatchStatus.CREATED,
      BatchStatus.EXTRACTED,
      BatchStatus.PROFILED,
      BatchStatus.CLEANED,
      BatchStatus.MAPPED,
      BatchStatus.DRY_RUN_OK,
    ];

    if (!allowedPreLoadStatuses.includes(currentBatchStatus)) {
      throw new SkipApprovalForbiddenError(
        `Skip row action is permitted only before real load (current state: '${currentBatchStatus}'). Cannot skip rows during or after load.`
      );
    }

    // 2. Invariant: Editor or Admin confirms the Skip row action
    const normalizedRoles = req.actorRoles.map((r) => r.toLowerCase().trim());
    const isEditorOrAdmin =
      normalizedRoles.includes('editor') ||
      normalizedRoles.includes('admin');

    if (!isEditorOrAdmin) {
      throw new SkipApprovalForbiddenError(
        `Operator '${req.actor}' lacks authorization to skip rows. Requires 'editor' or 'admin' role (provided: [${req.actorRoles.join(', ')}]).`
      );
    }

    // 3. Invariant: Migration Runner cannot approve its own skip (separation of duties)
    if (req.batchRunner) {
      const actorNormalized = req.actor.toLowerCase().trim();
      const runnerNormalized = req.batchRunner.toLowerCase().trim();

      if (actorNormalized === runnerNormalized) {
        throw new SkipApprovalForbiddenError(
          `Separation of duties violation: Migration Runner '${req.actor}' cannot approve its own row skip.`
        );
      }
    }

    // 4. Invariant: Reason must be at least 10 non-whitespace characters
    const trimmedReason = req.reason ? req.reason.trim() : '';
    if (!hasMinNonWhitespaceChars(trimmedReason, 10)) {
      const nonWhitespaceCount = trimmedReason.replace(/\s+/g, '').length;
      throw new InvalidSkipReasonError(
        nonWhitespaceCount,
        `Skip reason must contain at least 10 non-whitespace characters (received ${nonWhitespaceCount}).`
      );
    }

    // 5. Invariant: Any skip after dry-run invalidates the dry-run token and requires a new dry-run
    let dryRunInvalidated = false;
    if (this.tokenManager) {
      const activeToken = await this.tokenManager.getToken(req.batchId);
      if (activeToken && !activeToken.invalidated) {
        await this.tokenManager.invalidateToken(
          req.batchId,
          `Dry-run token invalidated because row ${req.sourceRow} was skipped by '${req.actor}' post-dry-run.`
        );
        dryRunInvalidated = true;
      }
    }

    // 6. Record append-only outcome in the ledger
    const record = await this.outcomeStore.recordOutcome({
      batchId: req.batchId,
      sourceRow: req.sourceRow,
      outcome: TerminalOutcome.SKIPPED,
      policyCode: SKIP_POLICY_CODE,
      operator: req.actor,
      operatorRole: normalizedRoles.includes('admin') ? 'admin' : 'editor',
      reasonCode: 'OPERATOR_APPROVED_SKIP',
      reasonText: trimmedReason,
      metadata: {
        batchStatusAtSkip: currentBatchStatus,
        dryRunTokenInvalidated: dryRunInvalidated,
      },
      createdAt: new Date(),
    });

    return {
      record,
      dryRunInvalidated,
      message: dryRunInvalidated
        ? `Row ${req.sourceRow} successfully marked as skipped. Warning: Dry-run token was invalidated; a new dry-run is required before real load.`
        : `Row ${req.sourceRow} successfully marked as skipped.`,
    };
  }
}
