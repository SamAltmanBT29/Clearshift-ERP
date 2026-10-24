import { randomUUID } from 'node:crypto';
import {
  type CleanCrmRow,
  type MappingTemplate,
  type DryRunPlannedRow,
  type DryRunPlannedCounts,
  type DryRunPolicyConfig,
  type DryRunRejectionDetail,
  type DryRunPlanReport,
  type DryRunLoadPrecondition,
  DryRunPlanReportSchema,
  DryRunPolicyConfigSchema,
  DryRunPolicyViolationError,
  DryRunPreconditionError,
  DryRunTargetMutationForbiddenError,
  assertDryRunConservation,
  computeDryRunToken,
  computeTargetBaselineHash,
} from '@clearshift/contracts';
import { BatchRegistryService } from '../batches/batch-registry.js';
import { ICleanCrmRepository } from '../mapping/types.js';

export interface ITargetBaselineProvider {
  getTargetRecords(entity?: string): Promise<Record<string, unknown>[]>;
  getTargetReceipts?(): Promise<unknown[]>;
}

export interface ITargetValidatorPort {
  validateRow(
    entity: string,
    row: Record<string, unknown>,
    baselineRecords: Record<string, unknown>[],
    seenInBatch: Map<string, number>
  ): Promise<{
    valid: boolean;
    outcome?: 'loaded' | 'merged' | 'skipped' | 'rejected' | undefined;
    targetId?: string | undefined;
    existingTargetId?: string | undefined;
    duplicateOfRow?: number | undefined;
    reasonCode?: string | undefined;
    message?: string | undefined;
    field?: string | undefined;
    validationErrors?: string[] | undefined;
  }>;
}

export interface DryRunPlannerOptions {
  batchRegistry: BatchRegistryService;
  cleanCrmRepo: ICleanCrmRepository;
  baselineProvider?: ITargetBaselineProvider | undefined;
  validatorPort?: ITargetValidatorPort | undefined;
  policyConfig?: Partial<DryRunPolicyConfig> | undefined;
}

export interface ExecuteDryRunParams {
  batchId: string;
  mappingTemplate?: MappingTemplate | undefined;
  mappingChecksum?: string | undefined;
  ruleVersion?: string | undefined;
  policyConfig?: Partial<DryRunPolicyConfig> | undefined;
  targetRecords?: Record<string, unknown>[] | undefined;
  targetReceipts?: unknown[] | undefined;
  actor?: string | undefined;
  correlationId?: string | undefined;
}

const DEFAULT_POLICY: DryRunPolicyConfig = {
  maxFailureRate: 0.10, // 10% maximum failure rate (Decision C9 / STP-01)
  minAttemptedRows: 1,
  allowPartial: false,
  strictNoMutation: true,
};

const VALID_LEAD_STATUSES = new Set(['New', 'Working', 'Qualified', 'Closed']);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Default In-Memory Target Validator for ERP & CRM entities
 */
export class DefaultTargetValidator implements ITargetValidatorPort {
  async validateRow(
    entity: string,
    row: Record<string, unknown>,
    baselineRecords: Record<string, unknown>[],
    seenInBatch: Map<string, number>
  ): Promise<{
    valid: boolean;
    outcome?: 'loaded' | 'merged' | 'skipped' | 'rejected' | undefined;
    targetId?: string | undefined;
    existingTargetId?: string | undefined;
    duplicateOfRow?: number | undefined;
    reasonCode?: string | undefined;
    message?: string | undefined;
    field?: string | undefined;
    validationErrors?: string[] | undefined;
  }> {
    const errors: string[] = [];

    // Check if this is an ERP product/item record
    const sku = typeof row['sku'] === 'string' ? row['sku'].trim() : undefined;
    const name = typeof row['name'] === 'string' ? row['name'].trim() : undefined;
    const price = typeof row['price'] === 'number' ? row['price'] : undefined;

    if (sku !== undefined || name !== undefined || entity.toLowerCase().includes('product')) {
      if (!sku || sku.length === 0) {
        errors.push('Missing required field: sku');
      }
      if (!name || name.length === 0) {
        errors.push('Missing required field: name');
      }
      if (price !== undefined && price < 0) {
        errors.push('Price cannot be negative');
      }

      if (errors.length > 0) {
        return {
          valid: false,
          outcome: 'rejected',
          reasonCode: 'TARGET_INVARIANT_VIOLATION',
          message: errors.join('; '),
          field: errors[0]?.split(':')[1]?.trim() ?? 'unknown',
          validationErrors: errors,
        };
      }

      // Check intra-batch duplicate
      if (sku) {
        const skuKey = sku.toLowerCase();
        if (seenInBatch.has(skuKey)) {
          const firstSeenRow = seenInBatch.get(skuKey)!;
          return {
            valid: true,
            outcome: 'merged',
            duplicateOfRow: firstSeenRow,
            reasonCode: 'INTRA_BATCH_DUPLICATE_MERGE',
            message: `Row duplicates SKU '${sku}' previously seen in row ${firstSeenRow}; planned for merge/deduplication`,
          };
        }
      }

      // Check baseline duplicate
      if (sku) {
        const match = baselineRecords.find(
          (r) => typeof r['sku'] === 'string' && r['sku'].trim().toLowerCase() === sku.toLowerCase()
        );
        if (match) {
          const matchId = typeof match['id'] === 'string' ? match['id'] : undefined;
          return {
            valid: true,
            outcome: 'merged',
            existingTargetId: matchId,
            reasonCode: 'TARGET_EXACT_DUPLICATE_LINK',
            message: `Row matches existing target record '${matchId ?? sku}'; planned for non-destructive link/merge`,
          };
        }
      }

      return {
        valid: true,
        outcome: 'loaded',
        targetId: randomUUID(),
      };
    }

    // Standard CRM entity validation (contacts, leads, accounts, etc.)
    const email = typeof row['email'] === 'string' ? row['email'].trim().toLowerCase() : undefined;
    const firstName = typeof row['firstName'] === 'string' ? row['firstName'].trim() : undefined;
    const lastName = typeof row['lastName'] === 'string' ? row['lastName'].trim() : undefined;
    const leadStatus = typeof row['leadStatus'] === 'string' ? row['leadStatus'].trim() : undefined;
    const companyId = typeof row['companyId'] === 'string' ? row['companyId'].trim() : undefined;

    // 1. Check required fields
    if (!firstName || firstName.length === 0) {
      errors.push('Missing required field: firstName');
    }
    if (!lastName || lastName.length === 0) {
      errors.push('Missing required field: lastName');
    }
    if (!email || email.length === 0) {
      errors.push('Missing required field: email');
    } else if (!EMAIL_REGEX.test(email)) {
      errors.push(`Invalid email format: '${email}'`);
    }

    // 2. Check lead status enum invariant
    if (leadStatus && !VALID_LEAD_STATUSES.has(leadStatus)) {
      errors.push(`Invalid lead status '${leadStatus}'. Allowed: New, Working, Qualified, Closed`);
    }

    // 3. Referential integrity: check parent company existence if referenced
    if (companyId) {
      const companyExists = baselineRecords.some(
        (r) => (r['id'] === companyId || r['companyId'] === companyId) && r['_entity'] === 'companies'
      );
      if (!companyExists) {
        return {
          valid: false,
          outcome: 'rejected',
          reasonCode: 'FOREIGN_KEY_NOT_FOUND',
          message: `Referenced company '${companyId}' does not exist in target database`,
          field: 'companyId',
          validationErrors: [`Company '${companyId}' not found in target database`],
        };
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        outcome: 'rejected',
        reasonCode: 'TARGET_INVARIANT_VIOLATION',
        message: errors.join('; '),
        field: errors[0]?.split(':')[1]?.trim() ?? 'unknown',
        validationErrors: errors,
      };
    }

    // 4. Duplicate candidate check against intra-batch duplicates
    if (email) {
      if (seenInBatch.has(email)) {
        const firstSeenRow = seenInBatch.get(email)!;
        return {
          valid: true,
          outcome: 'merged',
          duplicateOfRow: firstSeenRow,
          reasonCode: 'INTRA_BATCH_DUPLICATE_MERGE',
          message: `Row duplicates email '${email}' previously seen in row ${firstSeenRow}; planned for merge/deduplication`,
        };
      }
    }

    // 5. Duplicate candidate check against target baseline records
    if (email) {
      const match = baselineRecords.find(
        (r) => typeof r['email'] === 'string' && r['email'].trim().toLowerCase() === email
      );
      if (match) {
        const matchId = typeof match['id'] === 'string' ? match['id'] : undefined;
        return {
          valid: true,
          outcome: 'merged',
          existingTargetId: matchId,
          reasonCode: 'TARGET_EXACT_DUPLICATE_LINK',
          message: `Row matches existing target record '${matchId ?? email}'; planned for non-destructive link/merge`,
        };
      }
    }

    // 6. Valid new record -> planned loaded
    return {
      valid: true,
      outcome: 'loaded',
      targetId: randomUUID(),
    };
  }
}

/**
 * Backward compatibility alias for CRM module tests and imports
 */
export const DefaultCrmTargetValidator = DefaultTargetValidator;

/**
 * KIT-07: Dry-Run Planner with a Strict No-Target-Mutation Guarantee
 *
 * Simulates the loading phase without making any target database writes
 * or generating target import receipts.
 */
export class DryRunPlanner {
  private readonly batchRegistry: BatchRegistryService;
  private readonly cleanCrmRepo: ICleanCrmRepository;
  private readonly baselineProvider?: ITargetBaselineProvider | undefined;
  private readonly validatorPort: ITargetValidatorPort;
  private readonly defaultPolicy: DryRunPolicyConfig;

  // Stored dry-run plans keyed by batchId
  private readonly planStore = new Map<string, DryRunPlanReport>();

  constructor(options: DryRunPlannerOptions) {
    this.batchRegistry = options.batchRegistry;
    this.cleanCrmRepo = options.cleanCrmRepo;
    this.baselineProvider = options.baselineProvider;
    this.validatorPort = options.validatorPort ?? new DefaultTargetValidator();
    this.defaultPolicy = { ...DEFAULT_POLICY, ...(options.policyConfig ?? {}) };
  }

  /**
   * Guards against target mutations. Returns an object wrapped in a strict proxy
   * that will immediately throw DryRunTargetMutationForbiddenError if any write is attempted.
   */
  public createTargetMutationGuard<T extends object>(target: T): T {
    return new Proxy(target, {
      get(obj, prop, receiver) {
        const propStr = String(prop).toLowerCase();
        if (
          propStr.includes('import') ||
          propStr.includes('insert') ||
          propStr.includes('update') ||
          propStr.includes('delete') ||
          propStr.includes('write') ||
          propStr.includes('mutate') ||
          propStr.includes('receipt')
        ) {
          throw new DryRunTargetMutationForbiddenError(String(prop));
        }
        return Reflect.get(obj, prop, receiver);
      },
    });
  }

  /**
   * Executes the dry-run planning simulation for a mapped batch.
   * Guarantees 0 target database mutations and 0 target import receipts.
   */
  public async executeDryRun(params: ExecuteDryRunParams): Promise<DryRunPlanReport> {
    const { batchId } = params;

    // 1. Fetch batch state and verify it exists and is ready for dry-run
    const batch = await this.batchRegistry.getBatch(batchId);
    if (!batch) {
      throw new Error(`Batch '${batchId}' not found`);
    }

    // 2. Fetch mapped rows from Staging Clean CRM / ERP store
    const mappedRows = await this.cleanCrmRepo.findByBatchId(batchId);

    // 3. Obtain target baseline records (snapshot)
    let baselineRecords: Record<string, unknown>[] = params.targetRecords ?? [];
    if (baselineRecords.length === 0 && this.baselineProvider) {
      baselineRecords = await this.baselineProvider.getTargetRecords(batch.module);
    }
    const targetBaselineHash = computeTargetBaselineHash(baselineRecords);

    // 4. Resolve mapping checksum and rule version
    const mappingChecksum =
      params.mappingChecksum ??
      (params.mappingTemplate
        ? params.mappingTemplate.version
        : '0000000000000000000000000000000000000000000000000000000000000000');
    const ruleVersion = params.ruleVersion ?? batch.ruleVersion ?? '1.0.0';

    // 5. Merge policy configuration
    const policyConfig: DryRunPolicyConfig = DryRunPolicyConfigSchema.parse({
      ...this.defaultPolicy,
      ...(params.policyConfig ?? {}),
    });

    // 6. Evaluate each mapped row without mutating target
    const plannedRows: DryRunPlannedRow[] = [];
    const rejections: DryRunRejectionDetail[] = [];
    const seenInBatch = new Map<string, number>();

    let loadedCount = 0;
    let rejectedCount = 0;
    let mergedCount = 0;
    let skippedCount = 0;

    for (const cleanRow of mappedRows) {
      const sourceRow = cleanRow.sourceRow;
      const rowPayload = cleanRow.payload as Record<string, unknown>;

      const validation = await this.validatorPort.validateRow(
        batch.module,
        rowPayload,
        baselineRecords,
        seenInBatch
      );

      const plannedOutcome = validation.outcome ?? (validation.valid ? 'loaded' : 'rejected');

      const plannedRow: DryRunPlannedRow = {
        sourceRow,
        entity: batch.module,
        plannedOutcome,
        validationErrors: validation.validationErrors ?? [],
      };

      if (validation.targetId) plannedRow.targetId = validation.targetId;
      if (validation.existingTargetId) plannedRow.existingTargetId = validation.existingTargetId;
      if (validation.duplicateOfRow) plannedRow.duplicateOfRow = validation.duplicateOfRow;
      if (validation.reasonCode) plannedRow.reasonCode = validation.reasonCode;
      if (validation.message) plannedRow.reasonMessage = validation.message;
      if (validation.field) plannedRow.field = validation.field;

      plannedRows.push(plannedRow);

      if (plannedOutcome === 'loaded') {
        loadedCount++;
        const key =
          typeof rowPayload['email'] === 'string'
            ? rowPayload['email'].trim().toLowerCase()
            : typeof rowPayload['sku'] === 'string'
              ? rowPayload['sku'].trim().toLowerCase()
              : undefined;
        if (key) seenInBatch.set(key, sourceRow);
      } else if (plannedOutcome === 'rejected') {
        rejectedCount++;
        rejections.push({
          sourceRow,
          reasonCode: validation.reasonCode ?? 'VALIDATION_FAILED',
          message: validation.message ?? 'Row failed target invariants',
          field: validation.field,
        });
      } else if (plannedOutcome === 'merged') {
        mergedCount++;
      } else if (plannedOutcome === 'skipped') {
        skippedCount++;
      }
    }

    // 7. Strict row conservation assertion: total = loaded + rejected + merged + skipped; unaccounted = 0
    const total = mappedRows.length;
    assertDryRunConservation({
      total,
      loaded: loadedCount,
      rejected: rejectedCount,
      merged: mergedCount,
      skipped: skippedCount,
    });

    const plannedCounts: DryRunPlannedCounts = {
      total,
      loaded: loadedCount,
      rejected: rejectedCount,
      merged: mergedCount,
      skipped: skippedCount,
      unaccounted: 0,
    };

    // 8. Policy Evaluation (Decision C9 & 40%-invalid fixture requirement)
    const failureRate = total > 0 ? rejectedCount / total : 0;
    const policyPassed = failureRate <= policyConfig.maxFailureRate;
    const canProceedToLoad = policyPassed;

    // 9. Deterministic token generation
    const token = computeDryRunToken({
      batchId,
      mappingChecksum,
      ruleVersion,
      targetBaselineHash,
      plannedCounts,
      policyConfig,
    });

    // 10. Assemble Plan Report
    const report: DryRunPlanReport = {
      planId: randomUUID(),
      batchId,
      module: batch.module,
      targetEntity: params.mappingTemplate?.targetEntity ?? 'contacts',
      token,
      planVersion: '1.0.0',
      ruleVersion,
      codeVersion: batch.codeVersion ?? '1.0.0',
      mappingChecksum,
      targetBaselineHash,
      policyConfig,
      policyPassed,
      failureRate,
      canProceedToLoad,
      plannedCounts,
      plannedRows,
      rejections,
      targetWriteCalls: 0, // Invariant: 0 mutations
      targetReceiptsCreated: 0, // Invariant: 0 receipts
      metadata: {
        totalRows: total,
        policyThreshold: policyConfig.maxFailureRate,
        actor: params.actor ?? 'system',
        correlationId: params.correlationId ?? batch.correlationId,
      },
      createdAt: new Date(),
    };

    // Validate with Zod contract
    DryRunPlanReportSchema.parse(report);

    // 11. Persist plan in internal memory store
    this.planStore.set(batchId, report);

    // 12. State Machine Transition & Immutable Step Ledger Update
    const targetStatus = policyPassed ? 'dry_run_passed' : 'failed';
    const errorCode = policyPassed ? null : 'POLICY_VIOLATION_THRESHOLD_EXCEEDED';
    const errorMessage = policyPassed
      ? null
      : `Dry-run failure rate ${(failureRate * 100).toFixed(1)}% exceeds maximum allowable threshold ${(policyConfig.maxFailureRate * 100).toFixed(1)}%`;

    await this.batchRegistry.transitionBatch(batchId, {
      targetStatus,
      stepName: 'dry_run',
      checkpoint: policyPassed ? 'dry_run_passed' : 'mapped',
      recordsIn: total,
      recordsOut: loadedCount + mergedCount,
      recordsRejected: rejectedCount,
      recordsMerged: mergedCount,
      recordsSkipped: skippedCount,
      errorCode,
      errorMessage,
      actor: params.actor ?? 'system',
      correlationId: params.correlationId ?? batch.correlationId,
      metadata: {
        planId: report.planId,
        token: report.token,
        policyPassed: report.policyPassed,
        failureRate: report.failureRate,
        targetBaselineHash: report.targetBaselineHash,
        mappingChecksum: report.mappingChecksum,
      },
    });

    return report;
  }

  /**
   * Retrieves a previously computed dry-run plan by batch ID.
   */
  public getPlan(batchId: string): DryRunPlanReport | undefined {
    return this.planStore.get(batchId);
  }

  /**
   * Validates load preconditions before Step 6 (Load).
   * Throws DryRunPreconditionError or DryRunPolicyViolationError if any check fails.
   */
  public assertCanExecuteLoad(
    plan: DryRunPlanReport,
    precondition: DryRunLoadPrecondition
  ): { ok: true; planId: string; token: string } {
    // 1. Verify policy passage
    if (!plan.policyPassed || !plan.canProceedToLoad) {
      throw new DryRunPolicyViolationError(
        plan.failureRate,
        plan.policyConfig.maxFailureRate,
        `Cannot execute load: dry-run plan failed policy (failure rate ${(plan.failureRate * 100).toFixed(1)}% exceeds threshold ${(plan.policyConfig.maxFailureRate * 100).toFixed(1)}%)`
      );
    }

    // 2. Verify token matches
    if (precondition.token !== plan.token) {
      throw new DryRunPreconditionError(
        'TOKEN_INVALID',
        `Invalid dry-run token: provided token '${precondition.token}' does not match plan token '${plan.token}'`
      );
    }

    // 3. Verify target baseline has not drifted
    if (precondition.currentTargetBaselineHash !== plan.targetBaselineHash) {
      throw new DryRunPreconditionError(
        'BASELINE_DRIFT',
        `Target baseline drift detected: target data has changed since dry-run plan was generated (baseline hash changed from '${plan.targetBaselineHash}' to '${precondition.currentTargetBaselineHash}'). Prior dry-run token is invalidated.`
      );
    }

    // 4. Verify mapping rules have not changed
    if (precondition.currentMappingChecksum !== plan.mappingChecksum) {
      throw new DryRunPreconditionError(
        'MAPPING_CHANGED',
        `Mapping rules or template changed: mapping checksum changed from '${plan.mappingChecksum}' to '${precondition.currentMappingChecksum}'. Prior dry-run token is invalidated.`
      );
    }

    // 5. Verify rule version has not changed
    if (precondition.currentRuleVersion !== plan.ruleVersion) {
      throw new DryRunPreconditionError(
        'RULE_VERSION_CHANGED',
        `Rule version changed from '${plan.ruleVersion}' to '${precondition.currentRuleVersion}'. Prior dry-run token is invalidated.`
      );
    }

    // 6. Verify row conservation
    assertDryRunConservation({
      total: plan.plannedCounts.total,
      loaded: plan.plannedCounts.loaded,
      rejected: plan.plannedCounts.rejected,
      merged: plan.plannedCounts.merged,
      skipped: plan.plannedCounts.skipped,
    });

    return { ok: true, planId: plan.planId, token: plan.token };
  }
}
