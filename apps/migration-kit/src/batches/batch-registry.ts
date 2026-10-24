import crypto from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, desc, and } from 'drizzle-orm';
import {
  KitBatch,
  KitBatchStep,
  KitBatchStatus,
  CreateKitBatchInput,
  CreateKitBatchInputSchema,
  TransitionKitBatchInput,
  TransitionKitBatchInputSchema,
  ResumeKitBatchInput,
  ResumeKitBatchInputSchema,
  isKitBatchTerminalStatus,
  isKitBatchResumableStatus,
  getValidResumeTarget,
  verifyReconciliationCounts,
  IllegalBatchStateTransitionError,
  ImmutableStepLedgerError,
} from '@clearshift/contracts';
import {
  validateBatchTransition,
  computeNextCheckpoint,
  resolveStepName,
} from './state-machine.js';
import type {
  IBatchRegistryRepository,
  IStepLedgerRepository,
  BatchListFilter,
} from './types.js';
import { kitBatches, kitBatchSteps } from '../db/schema.js';
import { AuditService, InMemoryAuditRepository, getCorrelationId } from '@cs/core';

/**
 * In-Memory Batch Repository
 */
export class InMemoryBatchRepository implements IBatchRegistryRepository {
  private batches = new Map<string, KitBatch>();

  async create(batch: KitBatch): Promise<KitBatch> {
    this.batches.set(batch.id, { ...batch });
    return { ...batch };
  }

  async findById(id: string): Promise<KitBatch | null> {
    const found = this.batches.get(id);
    return found ? { ...found } : null;
  }

  async findByNumber(batchNumber: string): Promise<KitBatch | null> {
    for (const b of this.batches.values()) {
      if (b.batchNumber === batchNumber) {
        return { ...b };
      }
    }
    return null;
  }

  async update(id: string, updates: Partial<KitBatch>): Promise<KitBatch> {
    const existing = this.batches.get(id);
    if (!existing) {
      throw new Error(`Batch not found: ${id}`);
    }
    const updated: KitBatch = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.batches.set(id, updated);
    return { ...updated };
  }

  async list(filter?: BatchListFilter): Promise<KitBatch[]> {
    let result = Array.from(this.batches.values());
    if (filter?.module) {
      result = result.filter((b) => b.module === filter.module);
    }
    if (filter?.status) {
      result = result.filter((b) => b.status === filter.status);
    }
    if (filter?.correlationId) {
      result = result.filter((b) => b.correlationId === filter.correlationId);
    }
    result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (filter?.offset) {
      result = result.slice(filter.offset);
    }
    if (filter?.limit) {
      result = result.slice(0, filter.limit);
    }
    return result.map((b) => ({ ...b }));
  }

  clear(): void {
    this.batches.clear();
  }
}

/**
 * In-Memory Step Ledger Repository (Strictly Append-Only)
 */
export class InMemoryStepLedgerRepository implements IStepLedgerRepository {
  private steps: KitBatchStep[] = [];

  async append(step: KitBatchStep): Promise<KitBatchStep> {
    const copy = { ...step };
    this.steps.push(copy);
    return { ...copy };
  }

  async findByBatchId(batchId: string): Promise<KitBatchStep[]> {
    return this.steps
      .filter((s) => s.batchId === batchId)
      .sort((a, b) => a.stepNumber - b.stepNumber)
      .map((s) => ({ ...s }));
  }

  async findLatestByBatchId(batchId: string): Promise<KitBatchStep | null> {
    const batchSteps = await this.findByBatchId(batchId);
    if (batchSteps.length === 0) return null;
    return batchSteps[batchSteps.length - 1] ?? null;
  }

  async countByBatchId(batchId: string): Promise<number> {
    return this.steps.filter((s) => s.batchId === batchId).length;
  }

  // Attempting to modify or delete ledger items explicitly throws
  update(): never {
    throw new ImmutableStepLedgerError();
  }

  delete(): never {
    throw new ImmutableStepLedgerError();
  }

  clear(): void {
    this.steps = [];
  }
}

/**
 * Drizzle Database Batch Repository
 */
export class DrizzleBatchRepository implements IBatchRegistryRepository {
  constructor(private db: any) {}

  async create(batch: KitBatch): Promise<KitBatch> {
    const [inserted] = await this.db.insert(kitBatches).values({
      id: batch.id,
      batchNumber: batch.batchNumber,
      module: batch.module,
      sourceSystem: batch.sourceSystem ?? null,
      fileName: batch.fileName ?? null,
      fileSizeBytes: batch.fileSizeBytes ?? null,
      checksum: batch.checksum,
      status: batch.status,
      previousStatus: batch.previousStatus ?? null,
      checkpoint: batch.checkpoint,
      attempt: batch.attempt,
      maxAttempts: batch.maxAttempts,
      totalRows: batch.totalRows,
      loadedRows: batch.loadedRows,
      rejectedRows: batch.rejectedRows,
      mergedRows: batch.mergedRows,
      skippedRows: batch.skippedRows,
      unaccountedRows: batch.unaccountedRows,
      ruleVersion: batch.ruleVersion,
      codeVersion: batch.codeVersion,
      errorCode: batch.errorCode ?? null,
      errorMessage: batch.errorMessage ?? null,
      correlationId: batch.correlationId,
      metadata: batch.metadata as Record<string, unknown>,
      createdBy: batch.createdBy,
      startedAt: batch.startedAt ?? null,
      finishedAt: batch.finishedAt ?? null,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    }).returning();

    return inserted as unknown as KitBatch;
  }

  async findById(id: string): Promise<KitBatch | null> {
    const [found] = await this.db.select().from(kitBatches).where(eq(kitBatches.id, id));
    return (found as unknown as KitBatch) ?? null;
  }

  async findByNumber(batchNumber: string): Promise<KitBatch | null> {
    const [found] = await this.db.select().from(kitBatches).where(eq(kitBatches.batchNumber, batchNumber));
    return (found as unknown as KitBatch) ?? null;
  }

  async update(id: string, updates: Partial<KitBatch>): Promise<KitBatch> {
    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (updates.status !== undefined) updateValues['status'] = updates.status;
    if (updates.previousStatus !== undefined) updateValues['previousStatus'] = updates.previousStatus;
    if (updates.checkpoint !== undefined) updateValues['checkpoint'] = updates.checkpoint;
    if (updates.attempt !== undefined) updateValues['attempt'] = updates.attempt;
    if (updates.totalRows !== undefined) updateValues['totalRows'] = updates.totalRows;
    if (updates.loadedRows !== undefined) updateValues['loadedRows'] = updates.loadedRows;
    if (updates.rejectedRows !== undefined) updateValues['rejectedRows'] = updates.rejectedRows;
    if (updates.mergedRows !== undefined) updateValues['mergedRows'] = updates.mergedRows;
    if (updates.skippedRows !== undefined) updateValues['skippedRows'] = updates.skippedRows;
    if (updates.unaccountedRows !== undefined) updateValues['unaccountedRows'] = updates.unaccountedRows;
    if (updates.errorCode !== undefined) updateValues['errorCode'] = updates.errorCode;
    if (updates.errorMessage !== undefined) updateValues['errorMessage'] = updates.errorMessage;
    if (updates.metadata !== undefined) updateValues['metadata'] = updates.metadata;
    if (updates.finishedAt !== undefined) updateValues['finishedAt'] = updates.finishedAt;

    const [updated] = await this.db
      .update(kitBatches)
      .set(updateValues)
      .where(eq(kitBatches.id, id))
      .returning();

    if (!updated) {
      throw new Error(`Batch not found for update: ${id}`);
    }

    return updated as unknown as KitBatch;
  }

  async list(filter?: BatchListFilter): Promise<KitBatch[]> {
    let query = this.db.select().from(kitBatches).orderBy(desc(kitBatches.createdAt));
    const conditions = [];

    if (filter?.module) {
      conditions.push(eq(kitBatches.module, filter.module));
    }
    if (filter?.status) {
      conditions.push(eq(kitBatches.status, filter.status));
    }
    if (filter?.correlationId) {
      conditions.push(eq(kitBatches.correlationId, filter.correlationId));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    if (filter?.limit) {
      query = query.limit(filter.limit);
    }
    if (filter?.offset) {
      query = query.offset(filter.offset);
    }

    const rows = await query;
    return rows as unknown as KitBatch[];
  }
}

/**
 * Drizzle Database Step Ledger Repository (Append-Only)
 */
export class DrizzleStepLedgerRepository implements IStepLedgerRepository {
  constructor(private db: any) {}

  async append(step: KitBatchStep): Promise<KitBatchStep> {
    const [inserted] = await this.db.insert(kitBatchSteps).values({
      id: step.id,
      batchId: step.batchId,
      stepNumber: step.stepNumber,
      stepName: step.stepName,
      fromStatus: step.fromStatus,
      toStatus: step.toStatus,
      attempt: step.attempt,
      checkpoint: step.checkpoint,
      recordsIn: step.recordsIn,
      recordsOut: step.recordsOut,
      recordsRejected: step.recordsRejected,
      recordsMerged: step.recordsMerged,
      recordsSkipped: step.recordsSkipped,
      ruleVersion: step.ruleVersion,
      codeVersion: step.codeVersion,
      errorCode: step.errorCode ?? null,
      errorMessage: step.errorMessage ?? null,
      correlationId: step.correlationId,
      actor: step.actor,
      durationMs: step.durationMs ?? null,
      metadata: step.metadata as Record<string, unknown>,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt ?? null,
      createdAt: step.createdAt,
    }).returning();

    return inserted as unknown as KitBatchStep;
  }

  async findByBatchId(batchId: string): Promise<KitBatchStep[]> {
    const rows = await this.db
      .select()
      .from(kitBatchSteps)
      .where(eq(kitBatchSteps.batchId, batchId))
      .orderBy(kitBatchSteps.stepNumber);
    return rows as unknown as KitBatchStep[];
  }

  async findLatestByBatchId(batchId: string): Promise<KitBatchStep | null> {
    const [latest] = await this.db
      .select()
      .from(kitBatchSteps)
      .where(eq(kitBatchSteps.batchId, batchId))
      .orderBy(desc(kitBatchSteps.stepNumber))
      .limit(1);
    return (latest as unknown as KitBatchStep) ?? null;
  }

  async countByBatchId(batchId: string): Promise<number> {
    const rows = await this.db
      .select({ id: kitBatchSteps.id })
      .from(kitBatchSteps)
      .where(eq(kitBatchSteps.batchId, batchId));
    return rows.length;
  }
}

/**
 * Batch Registry Service (KIT-01)
 * Enforces state machine transitions, immutable step ledger, audit logging,
 * and checkpoint-based resumption.
 */
export class BatchRegistryService {
  constructor(
    private batchRepo: IBatchRegistryRepository = new InMemoryBatchRepository(),
    private ledgerRepo: IStepLedgerRepository = new InMemoryStepLedgerRepository(),
    private auditService: AuditService = new AuditService(new InMemoryAuditRepository())
  ) {}

  /**
   * Registers a new migration batch in 'created' state
   */
  async createBatch(rawInput: CreateKitBatchInput): Promise<KitBatch> {
    const input = CreateKitBatchInputSchema.parse(rawInput);

    const id = input.id || crypto.randomUUID();
    const batchNumber =
      input.batchNumber ||
      `B-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const correlationId = input.correlationId || getCorrelationId();
    const now = new Date();

    const newBatch: KitBatch = {
      id,
      batchNumber,
      module: input.module,
      sourceSystem: input.sourceSystem ?? null,
      fileName: input.fileName ?? null,
      fileSizeBytes: input.fileSizeBytes ?? null,
      checksum: input.checksum,
      status: 'created',
      previousStatus: null,
      checkpoint: 'created',
      attempt: 1,
      maxAttempts: 3,
      totalRows: input.totalRows,
      loadedRows: 0,
      rejectedRows: 0,
      mergedRows: 0,
      skippedRows: 0,
      unaccountedRows: input.totalRows,
      ruleVersion: input.ruleVersion,
      codeVersion: input.codeVersion,
      errorCode: null,
      errorMessage: null,
      correlationId,
      metadata: input.metadata,
      createdBy: input.createdBy,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const batch = await this.batchRepo.create(newBatch);

    // Record initial step in immutable ledger
    const initialStep: KitBatchStep = {
      id: crypto.randomUUID(),
      batchId: batch.id,
      stepNumber: 1,
      stepName: 'extract',
      fromStatus: 'created',
      toStatus: 'created',
      attempt: 1,
      checkpoint: 'created',
      recordsIn: input.totalRows,
      recordsOut: 0,
      recordsRejected: 0,
      recordsMerged: 0,
      recordsSkipped: 0,
      ruleVersion: input.ruleVersion,
      codeVersion: input.codeVersion,
      errorCode: null,
      errorMessage: null,
      correlationId,
      actor: input.createdBy,
      durationMs: 0,
      metadata: { initial: true },
      startedAt: now,
      finishedAt: now,
      createdAt: now,
    };

    await this.ledgerRepo.append(initialStep);

    // Audit creation
    await this.auditService.log({
      actor: input.createdBy,
      action: 'kit.batch.created',
      targetEntity: 'kit_batch',
      targetId: batch.id,
      correlationId,
      batchId: batch.id,
      result: 'success',
      metadata: {
        batchNumber: batch.batchNumber,
        module: batch.module,
        totalRows: batch.totalRows,
        checksum: batch.checksum,
      },
    });

    return batch;
  }

  /**
   * Retrieves a batch by unique ID
   */
  async getBatchById(id: string): Promise<KitBatch | null> {
    return await this.batchRepo.findById(id);
  }

  /**
   * Retrieves a batch by batch number
   */
  async getBatchByNumber(batchNumber: string): Promise<KitBatch | null> {
    return await this.batchRepo.findByNumber(batchNumber);
  }

  /**
   * Transitions a batch to target status, evaluating guards and recording immutable ledger entry.
   */
  async transitionBatch(batchId: string, rawInput: TransitionKitBatchInput): Promise<KitBatch> {
    const input = TransitionKitBatchInputSchema.parse(rawInput);
    const batch = await this.batchRepo.findById(batchId);
    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    // 1. Guard check
    validateBatchTransition(batch, input.targetStatus);

    // 2. Validate reconciliation invariants if transitioning to reconciled
    if (input.targetStatus === 'reconciled') {
      const loaded = input.recordsOut ?? batch.loadedRows;
      const rejected = input.recordsRejected ?? batch.rejectedRows;
      const merged = input.recordsMerged ?? batch.mergedRows;
      const skipped = input.recordsSkipped ?? batch.skippedRows;
      const total = batch.totalRows;

      const recon = verifyReconciliationCounts({
        totalRows: total,
        loadedRows: loaded,
        rejectedRows: rejected,
        mergedRows: merged,
        skippedRows: skipped,
      });

      if (!recon.ok) {
        throw new IllegalBatchStateTransitionError(
          batch.status,
          input.targetStatus,
          batch.id,
          `Reconciliation invariant violated: source (${total}) != loaded (${loaded}) + rejected (${rejected}) + merged (${merged}) + skipped (${skipped}); unaccounted = ${recon.unaccounted}`
        );
      }
    }

    // 3. Compute new checkpoint & step data
    const nextCheckpoint = computeNextCheckpoint(input.targetStatus, batch.checkpoint);
    const stepName = resolveStepName(input.targetStatus, input.stepName);
    const existingStepCount = await this.ledgerRepo.countByBatchId(batchId);
    const stepNumber = existingStepCount + 1;
    const now = new Date();
    const correlationId = input.correlationId || batch.correlationId;

    // 4. Append to immutable step ledger
    const ledgerStep: KitBatchStep = {
      id: crypto.randomUUID(),
      batchId: batch.id,
      stepNumber,
      stepName,
      fromStatus: batch.status,
      toStatus: input.targetStatus,
      attempt: batch.attempt,
      checkpoint: nextCheckpoint,
      recordsIn: input.recordsIn ?? 0,
      recordsOut: input.recordsOut ?? 0,
      recordsRejected: input.recordsRejected ?? 0,
      recordsMerged: input.recordsMerged ?? 0,
      recordsSkipped: input.recordsSkipped ?? 0,
      ruleVersion: batch.ruleVersion,
      codeVersion: batch.codeVersion,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      correlationId,
      actor: input.actor,
      durationMs: input.durationMs ?? null,
      metadata: input.metadata,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
    };

    await this.ledgerRepo.append(ledgerStep);

    // 5. Update batch state
    const loadedRows = input.recordsOut !== undefined ? input.recordsOut : batch.loadedRows;
    const rejectedRows = input.recordsRejected !== undefined ? input.recordsRejected : batch.rejectedRows;
    const mergedRows = input.recordsMerged !== undefined ? input.recordsMerged : batch.mergedRows;
    const skippedRows = input.recordsSkipped !== undefined ? input.recordsSkipped : batch.skippedRows;
    const unaccountedRows = Math.max(0, batch.totalRows - (loadedRows + rejectedRows + mergedRows + skippedRows));

    const updates: Partial<KitBatch> = {
      status: input.targetStatus,
      previousStatus: batch.status,
      checkpoint: nextCheckpoint,
      loadedRows,
      rejectedRows,
      mergedRows,
      skippedRows,
      unaccountedRows,
      errorCode: input.errorCode ?? (input.targetStatus === 'failed' ? batch.errorCode : null),
      errorMessage: input.errorMessage ?? (input.targetStatus === 'failed' ? batch.errorMessage : null),
      finishedAt: isKitBatchTerminalStatus(input.targetStatus) ? now : batch.finishedAt,
    };

    const updatedBatch = await this.batchRepo.update(batchId, updates);

    // 6. Append audit log
    await this.auditService.log({
      actor: input.actor,
      action: input.targetStatus === 'failed' ? 'kit.batch.failed' : 'kit.batch.transitioned',
      targetEntity: 'kit_batch',
      targetId: batch.id,
      correlationId,
      batchId: batch.id,
      result: input.targetStatus === 'failed' ? 'failure' : 'success',
      reason: input.errorMessage ?? undefined,
      metadata: {
        fromStatus: batch.status,
        toStatus: input.targetStatus,
        stepName,
        stepNumber,
        checkpoint: nextCheckpoint,
        attempt: batch.attempt,
      },
    });

    return updatedBatch;
  }

  /**
   * Resumes a failed or partially halted batch from its committed checkpoint.
   * Enforces that retries cannot restart from 'created' implicitly.
   */
  async resumeBatch(batchId: string, rawInput: ResumeKitBatchInput = {}): Promise<KitBatch> {
    const input = ResumeKitBatchInputSchema.parse(rawInput);
    const batch = await this.batchRepo.findById(batchId);
    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    if (!isKitBatchResumableStatus(batch.status)) {
      throw new IllegalBatchStateTransitionError(
        batch.status,
        'resumed',
        batch.id,
        `Cannot resume batch in non-resumable status '${batch.status}'`
      );
    }

    if (batch.attempt >= batch.maxAttempts) {
      throw new Error(
        `Batch '${batch.id}' has exceeded maximum allowed attempts (${batch.maxAttempts}). Manual intervention required.`
      );
    }

    // Determine target from committed checkpoint
    const targetStatus = getValidResumeTarget(batch.checkpoint);
    if (!targetStatus) {
      throw new Error(
        `Cannot determine valid resume target from checkpoint '${batch.checkpoint}' for batch '${batch.id}'`
      );
    }

    // Advance attempt counter
    const nextAttempt = batch.attempt + 1;
    await this.batchRepo.update(batchId, {
      attempt: nextAttempt,
      errorCode: null,
      errorMessage: null,
    });

    // Execute transition to checkpoint target
    return await this.transitionBatch(batchId, {
      targetStatus,
      actor: input.actor,
      correlationId: input.correlationId || batch.correlationId,
      metadata: {
        resumedFromCheckpoint: batch.checkpoint,
        resumedFromStatus: batch.status,
        attempt: nextAttempt,
        reason: input.reason || 'operator_resume',
      },
    });
  }

  /**
   * Retrieves the full immutable step ledger for a batch
   */
  async getStepLedger(batchId: string): Promise<KitBatchStep[]> {
    return await this.ledgerRepo.findByBatchId(batchId);
  }

  /**
   * Retrieves a batch by its ID
   */
  async getBatch(batchId: string): Promise<KitBatch | null> {
    return await this.batchRepo.findById(batchId);
  }

  /**
   * Lists batches with optional filtering
   */
  async listBatches(filter?: BatchListFilter): Promise<KitBatch[]> {
    return await this.batchRepo.list(filter);
  }
}
