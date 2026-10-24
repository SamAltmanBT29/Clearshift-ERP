import { createHash } from 'node:crypto';
import {
  ValidationFailure,
  ValidationReport,
  BatchValidatedEventPayload,
  ValidationPhase,
} from '@clearshift/contracts';
import { ValidationRegistry, validationRegistry } from './validation-registry.js';
import { ValidationContext } from './types.js';

export interface ValidateBatchRecordsParams<T = any> {
  batchId: string;
  module: string;
  entity: string;
  phase: ValidationPhase;
  records: Array<{
    sourceRow: number;
    targetId?: string;
    data: T;
  }>;
  db?: any;
  lookupTargetEntity?: (entity: string, id: string) => Promise<boolean>;
  registry?: ValidationRegistry;
}

export class ValidationService {
  constructor(private readonly registry: ValidationRegistry = validationRegistry) {}

  /**
   * Executes declared validation rules against a collection of records.
   * Produces a deterministic ValidationReport.
   */
  public async validateRecords<T = any>(
    params: ValidateBatchRecordsParams<T>
  ): Promise<ValidationReport> {
    const activeRegistry = params.registry || this.registry;
    const rules = activeRegistry.getRules({
      module: params.module,
      entity: params.entity,
      phase: params.phase,
    });

    const failures: ValidationFailure[] = [];
    const failedRowsSet = new Set<number>();

    for (const record of params.records) {
      const ctx: ValidationContext<T> = {
        batchId: params.batchId,
        module: params.module,
        entity: params.entity,
        phase: params.phase,
        record: record.data,
        sourceRow: record.sourceRow,
        targetId: record.targetId,
        db: params.db,
        lookupTargetEntity: params.lookupTargetEntity,
      };

      for (const rule of rules) {
        try {
          const res = await rule.validate(ctx);
          if (!res.valid) {
            failedRowsSet.add(record.sourceRow);
            failures.push({
              ruleId: rule.ruleId,
              sourceRow: record.sourceRow,
              targetId: record.targetId || res.targetId,
              entity: params.entity,
              field: res.field || rule.field,
              reasonCode: res.reasonCode || 'VALIDATION_FAILED',
              message: res.message || `Validation rule '${rule.ruleId}' failed.`,
              severity: rule.severity || 'error',
              receivedValue: res.receivedValue,
            });
          }
        } catch (err: any) {
          failedRowsSet.add(record.sourceRow);
          failures.push({
            ruleId: rule.ruleId,
            sourceRow: record.sourceRow,
            targetId: record.targetId,
            entity: params.entity,
            field: rule.field,
            reasonCode: 'VALIDATION_EXCEPTION',
            message: `Unexpected exception in rule '${rule.ruleId}': ${err.message}`,
            severity: 'error',
          });
        }
      }
    }

    // Sort failures deterministically: sourceRow ASC, ruleId ASC, field ASC
    failures.sort((a, b) => {
      if (a.sourceRow !== b.sourceRow) {
        return a.sourceRow - b.sourceRow;
      }
      if (a.ruleId !== b.ruleId) {
        return a.ruleId.localeCompare(b.ruleId);
      }
      return (a.field || '').localeCompare(b.field || '');
    });

    // Deterministic checksum of all failures
    const failuresJson = JSON.stringify(failures);
    const checksum = createHash('sha256').update(failuresJson).digest('hex');

    const totalChecked = params.records.length;
    const failedCount = failedRowsSet.size;
    const passedCount = totalChecked - failedCount;

    // Check if any error-level failures exist
    const hasBlockingErrors = failures.some((f) => f.severity === 'error');
    const isValid = !hasBlockingErrors;

    const report: ValidationReport = {
      batchId: params.batchId,
      module: params.module,
      phase: params.phase,
      totalChecked,
      passedCount,
      failedCount,
      failures,
      isValid,
      timestamp: new Date().toISOString(),
      checksum,
    };

    return report;
  }

  /**
   * Generates the `batch.validated` event payload once validation is completed
   */
  public createBatchValidatedEvent(report: ValidationReport): BatchValidatedEventPayload {
    return {
      batch_id: report.batchId,
      module: report.module,
      total_checked: report.totalChecked,
      validation_failures: report.failures.length,
      is_valid: report.isValid,
      checksum: report.checksum,
      timestamp: report.timestamp,
    };
  }

  /**
   * Persists validation result to database step ledger (kit_batch_steps) and updates batch status.
   * If validation fails (e.g. link integrity check failure), transitions batch to 'failed'.
   */
  public async persistValidationResult(
    report: ValidationReport,
    db: any,
    options: { correlationId?: string; actor?: string } = {}
  ): Promise<{ status: string; stepId?: string }> {
    if (!db) {
      return { status: report.isValid ? 'validated' : 'failed' };
    }

    const correlationId = options.correlationId || `val-corr-${Date.now()}`;
    const actor = options.actor || 'system';
    const toStatus = report.isValid ? 'validated' : 'failed';
    const errorCode = report.isValid ? null : 'VALIDATION_FAILED';
    const errorMessage = report.isValid
      ? null
      : `Batch validation failed with ${report.failures.length} integrity/business rule failure(s).`;

    // 1. Record step in kit_batch_steps
    const stepQuery = `
      INSERT INTO public.kit_batch_steps (
        batch_id, step_number, step_name, from_status, to_status,
        checkpoint, records_in, records_out, records_rejected,
        error_code, error_message, correlation_id, actor, metadata
      ) VALUES (
        $1, 7, 'validate', 'loaded', $2,
        $3, $4, $5, $6,
        $7, $8, $9, $10, $11
      ) RETURNING id
    `;

    const stepRes = await db.query(stepQuery, [
      report.batchId,
      toStatus,
      toStatus,
      report.totalChecked,
      report.passedCount,
      report.failedCount,
      errorCode,
      errorMessage,
      correlationId,
      actor,
      JSON.stringify({
        checksum: report.checksum,
        failureCount: report.failures.length,
        failures: report.failures.slice(0, 100), // Persist top 100 failures in metadata
      }),
    ]);

    // 2. Update kit_batches status
    const updateBatchQuery = `
      UPDATE public.kit_batches
      SET
        status = $1,
        checkpoint = $1,
        error_code = $2,
        error_message = $3,
        updated_at = now()
      WHERE id = $4
    `;

    await db.query(updateBatchQuery, [
      toStatus,
      errorCode,
      errorMessage,
      report.batchId,
    ]);

    return {
      status: toStatus,
      stepId: stepRes.rows?.[0]?.id,
    };
  }

  /**
   * Enforces non-negotiable reconciliation gate constraint:
   * "link integrity failure makes validation fail and downstream reconciliation/signoff cannot report success."
   */
  public assertBatchCanReconcile(report: ValidationReport): void {
    if (!report.isValid) {
      throw new Error(
        `[RECONCILIATION GATE] Batch '${report.batchId}' cannot proceed to reconciliation! ` +
          `Validation failed with ${report.failures.length} failure(s) (checksum: ${report.checksum}). ` +
          `Link integrity / business rule failures strictly block downstream signoff.`
      );
    }
  }
}

/**
 * Singleton instance of the default ValidationService
 */
export const validationService = new ValidationService();
