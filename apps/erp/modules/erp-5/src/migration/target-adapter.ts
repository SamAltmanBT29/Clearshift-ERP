/**
 * ERP-5 Migration Target Adapter
 *
 * Implements the KIT-08 / Decision C4 contract for atomic dual-writes
 * of target business records and durable import receipts.
 *
 * @module erp5/migration/target-adapter
 */

import type {
  MigrationTargetAdapter,
  MigrationTargetAdapterResult,
  MigrationTargetAdapterError,
} from '@clearshift/contracts';
import type {
  HrRepository,
  NewHrEmployee,
  NewHrDepartment,
  NewHrPayrollTotal,
  NewHrImportReceipt,
} from '../services/repository.js';
import { computeCanonicalPayloadHash, IdempotencyConflictError } from '@clearshift/contracts';
import { classifyEmployeeCandidate, classifyDepartmentCandidate, type MatchOutcome } from '../domain/duplicate-policy.js';

export class HrTargetAdapter implements MigrationTargetAdapter {
  constructor(
    private readonly repository: HrRepository,
    public readonly module = 'erp5',
    public readonly entity = 'employee', // Default entity, overridden per instance if needed
    public readonly schemaVersion = 1,
  ) {}

  /**
   * Overrides the entity for this adapter instance.
   * Useful when registering multiple adapters for different entities in the same module.
   */
  public setEntity(entity: string): void {
    (this as any).entity = entity;
  }

  async loadBatch(
    batchId: string,
    rows: Array<{
      sourceRow: number;
      idempotencyKey: string;
      sourceSystem?: string;
      sourceId?: string;
      data: any;
    }>,
    options: {
      upsert?: boolean;
      chunkSize?: number;
      failureThreshold?: number;
      minAttemptedRows?: number;
    }
  ): Promise<{
    totalAttempted: number;
    totalSucceeded: number;
    totalFailed: number;
    outcomes: Array<{
      sourceRow: number;
      outcome: 'created' | 'replayed' | 'failed';
      targetId?: string;
      error?: any;
    }>;
  }> {
    const outcomes: any[] = [];
    let succeeded = 0;
    let failedCount = 0;

    for (const row of rows) {
      // Check failure threshold for partial-load stop behavior (Issue #189)
      if (options.failureThreshold !== undefined && failedCount >= options.failureThreshold) {

        outcomes.push({
          sourceRow: row.sourceRow,
          outcome: 'failed',
          error: {
            reasonCode: 'FAILURE_THRESHOLD_REACHED',
            message: `Failure threshold of ${options.failureThreshold} reached. Stopping batch.`,
            retryable: false,
          },
        });
        continue;
      }

      const result = await this.importRow(
        batchId,
        row.sourceRow,
        row.idempotencyKey,
        row.data
      );

      if (result.ok) {
        succeeded++;
        outcomes.push({
          sourceRow: row.sourceRow,
          outcome: result.value.isExisting ? 'replayed' : 'created',
          targetId: result.value.targetId,
        });
      } else {
        failedCount++;
        outcomes.push({
          sourceRow: row.sourceRow,
          outcome: 'failed',
          error: result.error,
        });
      }
    }

    return {
      totalAttempted: rows.length,
      totalSucceeded: succeeded,
      totalFailed: failedCount,
      outcomes,
    };
  }

  async preflight(
    batchId: string,
    rows: unknown[]
  ): Promise<{ validCount: number; rejectCount: number } | { error: MigrationTargetAdapterError }> {
    // Simplified preflight: in a real scenario, this would validate row schemas
    // against the domain rules without writing to the DB.
    return { validCount: rows.length, rejectCount: 0 };
  }

  async importRow(
    batchId: string,
    sourceRow: number,
    idempotencyKey: string,
    cleanData: any
  ): Promise<
    | { ok: true; value: MigrationTargetAdapterResult }
    | { ok: false; error: MigrationTargetAdapterError }
  > {
    try {
      return await this.repository.transaction(async (tx) => {
        // 1. Idempotency Check
        const existingReceipt = await tx.getImportReceiptByIdempotencyKey(idempotencyKey);
        if (existingReceipt) {
          // Check for payload conflict (KIT-08 / Decision C4)
          const currentHash = computeCanonicalPayloadHash(cleanData);
          if (existingReceipt.request_hash !== currentHash) {
            throw new IdempotencyConflictError(idempotencyKey);
          }

          return {
            ok: true,
            value: {
              targetId: existingReceipt.target_id,
              receipt: {
                batchId: existingReceipt.batch_id,
                sourceRow: existingReceipt.source_row,
                entity: existingReceipt.entity,
                schemaVersion: existingReceipt.schema_version,
                idempotencyKey: existingReceipt.idempotency_key,
                targetId: existingReceipt.target_id,
                kind: existingReceipt.kind as 'created' | 'linked',
                createdAt: new Date(existingReceipt.created_at),
              },
              isExisting: true,
            },
          };
        }

        // 2. Duplicate Detection (Issue #188)
        let duplicateOutcome: MatchOutcome | null = null;
        if (this.entity === 'employee') {
          const existing = await tx.listEmployees({ 
            page: 1, 
            pageSize: 1000, 
            sort: 'employee_no', 
            sort_dir: 'asc' 
          });
          duplicateOutcome = classifyEmployeeCandidate(cleanData, existing.items);
        } else if (this.entity === 'department') {
          const existing = await tx.listDepartments({ 
            page: 1, 
            pageSize: 1000, 
            sort: 'code', 
            sort_dir: 'asc' 
          });
          duplicateOutcome = classifyDepartmentCandidate(cleanData, existing.items);
        }

        if (duplicateOutcome && duplicateOutcome.classification !== 'UNIQUE') {
          if (duplicateOutcome.candidate) {
            await tx.createDuplicateCandidate({
              entity: duplicateOutcome.candidate.entity,
              match_kind: duplicateOutcome.candidate.match_kind,
              status: 'PENDING_REVIEW',
              matching_key: duplicateOutcome.candidate.matching_key,
              matching_value: duplicateOutcome.candidate.matching_value,
              incoming_record: JSON.stringify(cleanData),
              existing_record_id: duplicateOutcome.candidate.existing_record.id,
              confidence: duplicateOutcome.candidate.confidence,
            });
          }
          return {
            ok: false,
            error: {
              reasonCode: 'DUPLICATE_CANDIDATE',
              message: `Potential duplicate detected for ${this.entity}. Held for review.`,
              retryable: false,
            },
          };
        }

        // 3. Target Mutation
        let targetId: string;

        // Route based on entity type
        switch (this.entity) {
          case 'employee':
            const emp = await tx.createEmployee(cleanData as NewHrEmployee);
            targetId = emp.id;
            break;
          case 'department':
            const dept = await tx.createDepartment(cleanData as NewHrDepartment);
            targetId = dept.id;
            break;
          case 'payroll_total':
            const payroll = await tx.createPayrollTotal(cleanData as NewHrPayrollTotal);
            targetId = payroll.id;
            break;
          default:
            return {
              ok: false,
              error: {
                reasonCode: 'UNSUPPORTED_ENTITY',
                message: `Entity '${this.entity}' is not supported by this adapter.`,
                retryable: false,
              },
            };
        }

        // 3. Create Durable Receipt
        const requestHash = computeCanonicalPayloadHash(cleanData);
        const receipt = await tx.createImportReceipt({
          batch_id: batchId,
          source_row: sourceRow,
          entity: this.entity,
          schema_version: this.schemaVersion,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          target_id: targetId,
          kind: 'created',
        });

        return {
          ok: true,
          value: {
            targetId,
            receipt: {
              batchId: receipt.batch_id,
              sourceRow: receipt.source_row,
              entity: receipt.entity,
              schemaVersion: receipt.schema_version,
              idempotencyKey: receipt.idempotency_key,
              targetId: receipt.target_id,
              kind: receipt.kind as 'created' | 'linked',
              createdAt: new Date(receipt.created_at),
            },
          },
        };
      });
    } catch (error: any) {
      // 4. Race Condition Recovery (KIT-08 / Decision C4)
      // Handle PostgreSQL unique constraint violation on idempotency_key
      const isUniqueViolation =
        error.code === '23505' ||
        (error.message && error.message.includes('import_receipts_idempotency_key_unique'));

      if (isUniqueViolation) {
        // The transaction is now aborted. We must fetch the winning receipt in a fresh read.
        const winningReceipt = await this.repository.getImportReceiptByIdempotencyKey(idempotencyKey);

        if (winningReceipt) {
          const currentHash = computeCanonicalPayloadHash(cleanData);
          if (winningReceipt.request_hash === currentHash) {
            return {
              ok: true,
              value: {
                targetId: winningReceipt.target_id,
                receipt: {
                  batchId: winningReceipt.batch_id,
                  sourceRow: winningReceipt.source_row,
                  entity: winningReceipt.entity,
                  schemaVersion: winningReceipt.schema_version,
                  idempotencyKey: winningReceipt.idempotency_key,
                  targetId: winningReceipt.target_id,
                  kind: winningReceipt.kind as 'created' | 'linked',
                  createdAt: new Date(winningReceipt.created_at),
                },
                isExisting: true,
              },
            };
          } else {
            return {
              ok: false,
              error: {
                reasonCode: 'IDEMPOTENCY_CONFLICT',
                message: `Idempotency key ${idempotencyKey} was already used with a different payload`,
                retryable: false,
              },
            };
          }
        }
      }

      if (error instanceof IdempotencyConflictError) {
        return {
          ok: false,
          error: {
            reasonCode: 'IDEMPOTENCY_CONFLICT',
            message: error.message,
            retryable: false,
          },
        };
      }

      return {
        ok: false,
        error: {
          reasonCode: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'An unexpected error occurred',
          retryable: true,
        },
      };
    }
  }
}