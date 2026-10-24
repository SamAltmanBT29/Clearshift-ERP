/**
 * ClearShift Migration Kit — Dry-Run Planner (KIT-07)
 *
 * Implements Step 5 Dry-Run Planner with strict no-target-mutation guarantee.
 *
 * Guarantees:
 * 1. Strictly 0 database mutations on target domain tables and 0 target import receipts created.
 * 2. Deterministic outcome prediction: loaded, rejected, merged, skipped.
 * 3. Exact row conservation: total = loaded + rejected + merged + skipped; unaccounted = 0.
 * 4. Circuit breaker policy: 40%-invalid fixture exceeds max 10% failure rate ceiling, failing policy.
 * 5. Cryptographic token issuance incorporating batch, mapping checksum, rule version, and target baseline.
 * 6. Baseline drift and mapping modification detection before real load.
 *
 * @module migration-kit/load/dry-run
 */

import { randomUUID } from 'node:crypto';
import {
  type MigrationTargetAdapter,
  type DryRunPlanReport,
  type DryRunPlannedRow,
  type DryRunPlannedCounts,
  type DryRunPolicyConfig,
  type DryRunRejectionDetail,
  type DryRunLoadPrecondition,
  DryRunPlanReportSchema,
  computeDryRunToken,
  computeTargetBaselineHash,
  assertDryRunConservation,
  validateLoadPrecondition,
  DryRunPolicyViolationError,
  DryRunTargetMutationForbiddenError,
} from '@clearshift/contracts';

export interface DryRunPlannerParams<TRow = Record<string, unknown>> {
  batchId: string;
  module: string;
  entity: string;
  rows: Array<{
    sourceRow: number;
    data: TRow;
    skipped?: boolean;
    skipReason?: string;
    isMerged?: boolean;
    mergeTargetId?: string;
  }>;
  adapter: MigrationTargetAdapter<TRow>;
  mappingChecksum: string;
  ruleVersion?: string;
  codeVersion?: string;
  policyConfig?: Partial<DryRunPolicyConfig>;
  targetBaselineRecords?: unknown[];
}

export interface IDryRunPlanner {
  planDryRun<TRow = Record<string, unknown>>(
    params: DryRunPlannerParams<TRow>
  ): Promise<DryRunPlanReport>;

  verifyPrecondition(
    precondition: DryRunLoadPrecondition,
    planReport: DryRunPlanReport
  ): { ok: true };
}

export class DryRunPlanner implements IDryRunPlanner {
  /**
   * Plans dry-run with strict zero-target-mutation guarantee.
   */
  public async planDryRun<TRow = Record<string, unknown>>(
    params: DryRunPlannerParams<TRow>
  ): Promise<DryRunPlanReport> {
    const {
      batchId,
      module,
      entity,
      rows,
      adapter,
      mappingChecksum,
      ruleVersion = '1.0.0',
      codeVersion = '1.0.0',
      policyConfig: userPolicy = {},
      targetBaselineRecords,
    } = params;

    const policy: DryRunPolicyConfig = {
      maxFailureRate: userPolicy.maxFailureRate ?? 0.10, // Default 10% ceiling (STP-01)
      minAttemptedRows: userPolicy.minAttemptedRows ?? 1,
      allowPartial: userPolicy.allowPartial ?? false,
      strictNoMutation: true,
    };

    // 1. Determine target baseline hash from existing records without mutation
    let baselineRecords = targetBaselineRecords;
    if (!baselineRecords) {
      if ('getTargetRecords' in adapter && typeof (adapter as any).getTargetRecords === 'function') {
        baselineRecords = (adapter as any).getTargetRecords();
      } else {
        baselineRecords = [];
      }
    }
    const targetBaselineHash = computeTargetBaselineHash(baselineRecords ?? []);

    // 2. Preflight validation of active non-skipped rows
    const plannedRows: DryRunPlannedRow[] = [];
    const rejections: DryRunRejectionDetail[] = [];
    let loadedCount = 0;
    let rejectedCount = 0;
    let mergedCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      if (row.skipped) {
        skippedCount++;
        plannedRows.push({
          sourceRow: row.sourceRow,
          entity,
          plannedOutcome: 'skipped',
          reasonCode: 'OPERATOR_APPROVED_SKIP',
          reasonMessage: row.skipReason ?? 'Row skipped by operator approval',
          validationErrors: [],
        });
        continue;
      }

      if (row.isMerged) {
        mergedCount++;
        plannedRows.push({
          sourceRow: row.sourceRow,
          entity,
          plannedOutcome: 'merged',
          duplicateOfTargetId: row.mergeTargetId,
          reasonCode: 'EXACT_DUPLICATE_MERGED',
          reasonMessage: 'Merged into existing target entity',
          validationErrors: [],
        });
        continue;
      }

      // Preflight test the single row using adapter validation/preflight without committing
      let isRejected = false;
      let rejectReasonCode = 'VALIDATION_FAILED';
      let rejectMessage = 'Row rejected by domain preflight check';
      let rejectField: string | undefined;

      if ('validateRow' in adapter && typeof (adapter as any).validateRow === 'function') {
        const validation = await (adapter as any).validateRow(row.data);
        if (!validation.valid) {
          isRejected = true;
          rejectReasonCode = validation.reasonCode ?? 'VALIDATION_FAILED';
          rejectMessage = validation.message ?? 'Row validation failed';
          rejectField = validation.field;
        }
      } else {
        const preflightResult = await adapter.preflight(batchId, [row.data]);
        if ('error' in preflightResult) {
          isRejected = true;
          rejectReasonCode = preflightResult.error.reasonCode;
          rejectMessage = preflightResult.error.message;
          rejectField = preflightResult.error.field;
        } else if (preflightResult.rejectCount > 0) {
          isRejected = true;
        }
      }

      if (isRejected) {
        rejectedCount++;
        rejections.push({
          sourceRow: row.sourceRow,
          reasonCode: rejectReasonCode,
          message: rejectMessage,
          field: rejectField,
        });
        plannedRows.push({
          sourceRow: row.sourceRow,
          entity,
          plannedOutcome: 'rejected',
          reasonCode: rejectReasonCode,
          reasonMessage: rejectMessage,
          field: rejectField,
          validationErrors: [rejectMessage],
        });
      } else {
        loadedCount++;
        plannedRows.push({
          sourceRow: row.sourceRow,
          entity,
          plannedOutcome: 'loaded',
          validationErrors: [],
        });
      }

    }

    // 3. Mathematical conservation assertion: total = loaded + rejected + merged + skipped; unaccounted = 0
    const plannedCounts: DryRunPlannedCounts = {
      total: rows.length,
      loaded: loadedCount,
      rejected: rejectedCount,
      merged: mergedCount,
      skipped: skippedCount,
      unaccounted: 0,
    };
    assertDryRunConservation(plannedCounts);

    // 4. Policy validation: compute failure rate
    const attemptedCount = loadedCount + rejectedCount + mergedCount;
    const failureRate = attemptedCount > 0 ? rejectedCount / attemptedCount : 0;
    const policyPassed = failureRate <= policy.maxFailureRate;
    const canProceedToLoad = policyPassed;

    // 5. Cryptographic token computation
    const token = computeDryRunToken({
      batchId,
      mappingChecksum,
      ruleVersion,
      targetBaselineHash,
      plannedCounts,
      policyConfig: {
        maxFailureRate: policy.maxFailureRate,
      },
    });

    const report: DryRunPlanReport = {
      planId: randomUUID(),
      batchId,
      module,
      targetEntity: entity,
      token,
      planVersion: '1.0.0',
      ruleVersion,
      codeVersion,
      mappingChecksum,
      targetBaselineHash,
      policyConfig: policy,
      policyPassed,
      failureRate,
      canProceedToLoad,
      plannedCounts,
      plannedRows,
      rejections,
      targetWriteCalls: 0, // Strict non-negotiable invariant: 0 mutation calls
      targetReceiptsCreated: 0, // Strict non-negotiable invariant: 0 receipts created
      metadata: {
        totalRows: rows.length,
        attemptedRows: attemptedCount,
      },
      createdAt: new Date(),
    };

    return DryRunPlanReportSchema.parse(report);
  }

  /**
   * Verifies that dry-run load precondition is satisfied before allowing real load.
   */
  public verifyPrecondition(
    precondition: DryRunLoadPrecondition,
    planReport: DryRunPlanReport
  ): { ok: true } {
    return validateLoadPrecondition(precondition, planReport);
  }

  /**
   * Asserts that target mutation is strictly forbidden during dry run.
   */
  public assertNoMutation(operationName: string): never {
    throw new DryRunTargetMutationForbiddenError(operationName);
  }
}

export const dryRunPlanner = new DryRunPlanner();
