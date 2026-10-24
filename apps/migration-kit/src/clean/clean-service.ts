import { createHash, randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import {
  type CleanLogEntry,
  type KitReject,
  type StgRow,
  type CleaningRuleId,
  BatchCleanedPayloadSchema,
  createEventEnvelope,
  type EventEnvelope,
} from '@clearshift/contracts';
import { kitCleanLog, kitRejects, stgRows, outbox } from '../db/schema.js';
import { CleaningRuleRegistry, type CleaningRegistryOptions, type RowCleaningOutcome } from '@cs/core';
import { BatchRegistryService } from '../batches/batch-registry.js';
import { IRawRowsRepository } from '../ingest/ingest-service.js';

export interface ICleanLogRepository {
  saveEntries(entries: CleanLogEntry[]): Promise<void>;
  findByBatchId(batchId: string): Promise<CleanLogEntry[]>;
}

export interface IKitRejectRepository {
  saveRejects(rejects: KitReject[]): Promise<void>;
  findByBatchId(batchId: string): Promise<KitReject[]>;
}

export interface IStgRowsRepository {
  saveRows(rows: StgRow[]): Promise<void>;
  findByBatchId(batchId: string): Promise<StgRow[]>;
}

export interface IOutboxRepository {
  append(envelope: EventEnvelope): Promise<void>;
  findByEventId(eventId: string): Promise<EventEnvelope | null>;
  listByBatchId(batchId: string): Promise<EventEnvelope[]>;
}

/**
 * In-Memory Clean Log Repository
 */
export class InMemoryCleanLogRepository implements ICleanLogRepository {
  private entries: CleanLogEntry[] = [];

  async saveEntries(entries: CleanLogEntry[]): Promise<void> {
    this.entries.push(...entries.map((e) => ({ ...e })));
  }

  async findByBatchId(batchId: string): Promise<CleanLogEntry[]> {
    return this.entries.filter((e) => e.batchId === batchId).map((e) => ({ ...e }));
  }

  clear(): void {
    this.entries = [];
  }
}

/**
 * In-Memory Reject Repository
 */
export class InMemoryKitRejectRepository implements IKitRejectRepository {
  private rejects: KitReject[] = [];

  async saveRejects(rejects: KitReject[]): Promise<void> {
    this.rejects.push(...rejects.map((r) => ({ ...r })));
  }

  async findByBatchId(batchId: string): Promise<KitReject[]> {
    return this.rejects.filter((r) => r.batchId === batchId).map((r) => ({ ...r }));
  }

  clear(): void {
    this.rejects = [];
  }
}

/**
 * In-Memory Staged Rows Repository
 */
export class InMemoryStgRowsRepository implements IStgRowsRepository {
  private rows: StgRow[] = [];

  async saveRows(rows: StgRow[]): Promise<void> {
    this.rows.push(...rows.map((r) => ({ ...r })));
  }

  async findByBatchId(batchId: string): Promise<StgRow[]> {
    return this.rows.filter((r) => r.batchId === batchId).map((r) => ({ ...r }));
  }

  clear(): void {
    this.rows = [];
  }
}

/**
 * In-Memory Outbox Repository
 */
export class InMemoryOutboxRepository implements IOutboxRepository {
  private events: EventEnvelope[] = [];

  async append(envelope: EventEnvelope): Promise<void> {
    this.events.push({ ...envelope });
  }

  async findByEventId(eventId: string): Promise<EventEnvelope | null> {
    const found = this.events.find((e) => e.event_id === eventId);
    return found ? { ...found } : null;
  }

  async listByBatchId(batchId: string): Promise<EventEnvelope[]> {
    return this.events.filter((e) => (e.batch_id ?? e.entity_id) === batchId).map((e) => ({ ...e }));
  }

  clear(): void {
    this.events = [];
  }
}

/**
 * Drizzle Clean Log Repository
 */
export class DrizzleCleanLogRepository implements ICleanLogRepository {
  constructor(private db: any) {}

  async saveEntries(entries: CleanLogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const chunkSize = 500;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      await this.db.insert(kitCleanLog).values(
        chunk.map((e) => ({
          batchId: e.batchId,
          sourceRow: e.sourceRow,
          fieldName: e.fieldName,
          oldValue: e.oldValue,
          newValue: e.newValue,
          ruleId: e.ruleId,
          ruleVersion: e.ruleVersion,
          createdAt: e.createdAt ?? new Date(),
        }))
      );
    }
  }

  async findByBatchId(batchId: string): Promise<CleanLogEntry[]> {
    const rows = await this.db.select().from(kitCleanLog).where(eq(kitCleanLog.batchId, batchId));
    return rows.map((r: any) => ({
      id: r.id,
      batchId: r.batchId,
      sourceRow: r.sourceRow,
      fieldName: r.fieldName,
      oldValue: r.oldValue,
      newValue: r.newValue,
      ruleId: r.ruleId as CleaningRuleId,
      ruleVersion: r.ruleVersion,
      createdAt: r.createdAt,
    }));
  }
}

/**
 * Drizzle Reject Repository
 */
export class DrizzleKitRejectRepository implements IKitRejectRepository {
  constructor(private db: any) {}

  async saveRejects(rejects: KitReject[]): Promise<void> {
    if (rejects.length === 0) return;
    const chunkSize = 500;
    for (let i = 0; i < rejects.length; i += chunkSize) {
      const chunk = rejects.slice(i, i + chunkSize);
      await this.db.insert(kitRejects).values(
        chunk.map((r) => ({
          batchId: r.batchId,
          sourceRow: r.sourceRow,
          entity: r.entity,
          reasonCode: r.reasonCode,
          reasonText: r.reasonText,
          rawJson: r.rawJson,
          createdAt: r.createdAt ?? new Date(),
        }))
      );
    }
  }

  async findByBatchId(batchId: string): Promise<KitReject[]> {
    const rows = await this.db.select().from(kitRejects).where(eq(kitRejects.batchId, batchId));
    return rows.map((r: any) => ({
      id: r.id,
      batchId: r.batchId,
      sourceRow: r.sourceRow,
      entity: r.entity,
      reasonCode: r.reasonCode,
      reasonText: r.reasonText,
      rawJson: (r.rawJson as Record<string, unknown>) ?? {},
      createdAt: r.createdAt,
    }));
  }
}

/**
 * Drizzle Staged Rows Repository
 */
export class DrizzleStgRowsRepository implements IStgRowsRepository {
  constructor(private db: any) {}

  async saveRows(rows: StgRow[]): Promise<void> {
    if (rows.length === 0) return;
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await this.db.insert(stgRows).values(
        chunk.map((r) => ({
          batchId: r.batchId,
          sourceRow: r.sourceRow,
          status: r.status,
          payload: r.cleanedPayload,
          rejectReason: r.rejectReason ?? null,
          goldenId: r.goldenId ?? null,
          createdAt: r.createdAt ?? new Date(),
        }))
      );
    }
  }

  async findByBatchId(batchId: string): Promise<StgRow[]> {
    const rows = await this.db.select().from(stgRows).where(eq(stgRows.batchId, batchId));
    return rows.map((r: any) => ({
      id: r.id,
      batchId: r.batchId,
      sourceRow: r.sourceRow,
      status: r.status as 'cleaned' | 'rejected',
      cleanedPayload: (r.payload as Record<string, unknown>) ?? {},
      rejectReason: r.rejectReason,
      goldenId: r.goldenId,
      createdAt: r.createdAt,
    }));
  }
}

/**
 * Drizzle Outbox Repository
 */
export class DrizzleOutboxRepository implements IOutboxRepository {
  constructor(private db: any) {}

  async append(envelope: EventEnvelope): Promise<void> {
    await this.db.insert(outbox).values({
      eventId: envelope.event_id,
      eventType: envelope.event_type,
      correlationId: envelope.correlation_id,
      producer: envelope.producer,
      entityType: envelope.entity_type,
      entityId: envelope.entity_id,
      batchId: envelope.batch_id ?? null,
      payload: envelope.payload as Record<string, unknown>,
      createdAt: new Date(envelope.occurred_at),
    });
  }

  async findByEventId(eventId: string): Promise<EventEnvelope | null> {
    const rows = await this.db.select().from(outbox).where(eq(outbox.eventId, eventId));
    const r = rows[0];
    if (!r) return null;
    return {
      event_id: r.eventId,
      event_type: r.eventType,
      entity_type: r.entityType ?? 'kit_batch',
      entity_id: r.entityId ?? '',
      batch_id: r.batchId ?? undefined,
      correlation_id: r.correlationId ?? '',
      occurred_at: r.createdAt.toISOString(),
      schema_version: '1.0.0',
      producer: r.producer ?? 'clearshift',
      payload: r.payload as Record<string, unknown>,
    };
  }

  async listByBatchId(): Promise<EventEnvelope[]> {
    return [];
  }
}

export interface CleanBatchOptions extends CleaningRegistryOptions {
  batchId?: string;
}

export interface CleanBatchResult {
  batchId: string;
  module: string;
  totalRows: number;
  cleanedRows: number;
  rejectedRows: number;
  fieldAuditsCount: number;
  durationMs: number;
}

export class CleanService {
  constructor(
    private batchRegistry: BatchRegistryService,
    private rawRowsRepo: IRawRowsRepository,
    private cleanLogRepo: ICleanLogRepository,
    private rejectRepo: IKitRejectRepository,
    private stgRowsRepo: IStgRowsRepository,
    private outboxRepo: IOutboxRepository
  ) {}

  async cleanBatch(batchId: string, options?: CleanBatchOptions): Promise<CleanBatchResult> {
    const startTime = Date.now();

    // 1. Fetch batch & verify state
    const batch = await this.batchRegistry.getBatchById(batchId);
    if (!batch) {
      throw new Error(`Batch '${batchId}' not found`);
    }

    if (batch.status !== 'profiled') {
      throw new Error(`Batch '${batchId}' is in status '${batch.status}', expected 'profiled' to clean`);
    }

    // 2. Load raw rows in deterministic order
    const rawRowsList = await this.rawRowsRepo.findByBatchId(batchId);
    if (rawRowsList.length === 0) {
      throw new Error(`Batch '${batchId}' has 0 raw rows loaded; cannot clean`);
    }

    // 3. Compute baseline raw row hash for immutability verification
    const preCleaningHash = this.computeRawRowsChecksum(rawRowsList);

    // 4. Instantiate cleaning rule registry
    const registry = new CleaningRuleRegistry(options);

    const cleanLogEntries: CleanLogEntry[] = [];
    const rejects: KitReject[] = [];
    const staged: StgRow[] = [];

    let cleanedCount = 0;
    let rejectedCount = 0;

    // 5. Clean each raw row
    for (const raw of rawRowsList) {
      const outcome: RowCleaningOutcome = registry.cleanRow(
        raw.sourceRow,
        raw.payload,
        {
          batchId,
          ...options,
        }
      );

      if (outcome.status === 'rejected') {
        rejectedCount++;
        rejects.push({
          batchId,
          sourceRow: raw.sourceRow,
          entity: batch.module,
          reasonCode: outcome.rejectReasonCode || 'CLEANING_REJECT',
          reasonText: outcome.rejectReasonText || 'Rejected during cleaning',
          rawJson: raw.payload,
          createdAt: new Date(),
        });
        staged.push({
          batchId,
          sourceRow: raw.sourceRow,
          status: 'rejected',
          cleanedPayload: raw.payload,
          rejectReason: outcome.rejectReasonText,
          createdAt: new Date(),
        });
      } else {
        cleanedCount++;
        staged.push({
          batchId,
          sourceRow: raw.sourceRow,
          status: 'cleaned',
          cleanedPayload: outcome.cleanedPayload,
          createdAt: new Date(),
        });
      }

      // Record any field change audits
      for (const audit of outcome.fieldAudits) {
        cleanLogEntries.push({
          batchId,
          sourceRow: audit.sourceRow,
          fieldName: audit.fieldName,
          oldValue: audit.oldValue,
          newValue: audit.newValue,
          ruleId: audit.ruleId,
          ruleVersion: audit.ruleVersion,
          createdAt: new Date(),
        });
      }
    }

    // 6. Persist clean logs, rejects, and staged rows
    await this.cleanLogRepo.saveEntries(cleanLogEntries);
    await this.rejectRepo.saveRejects(rejects);
    await this.stgRowsRepo.saveRows(staged);

    // 7. Verify raw row immutability
    const postCleaningRows = await this.rawRowsRepo.findByBatchId(batchId);
    const postCleaningHash = this.computeRawRowsChecksum(postCleaningRows);
    if (preCleaningHash !== postCleaningHash) {
      throw new Error(`CRITICAL INVARIANT VIOLATION: Raw rows were mutated during cleaning!`);
    }

    const durationMs = Date.now() - startTime;

    // 8. Transition batch state to 'cleaned' & record step in ledger
    await this.batchRegistry.transitionBatch(batchId, {
      targetStatus: 'cleaned',
      stepName: 'clean',
      recordsIn: rawRowsList.length,
      recordsOut: cleanedCount,
      recordsRejected: rejectedCount,
      actor: batch.createdBy || 'system',
      correlationId: batch.correlationId,
      metadata: {
        cleanedRows: cleanedCount,
        rejectedRows: rejectedCount,
        fieldAuditsCount: cleanLogEntries.length,
        durationMs,
      },
    });

    // 9. Emit domain event 'batch.cleaned' to transactional outbox
    const payload = BatchCleanedPayloadSchema.parse({
      batchId,
      module: batch.module,
      cleanedRows: cleanedCount,
      rejectedRows: rejectedCount,
      totalRows: rawRowsList.length,
      durationMs,
      ruleVersion: '1.0.0',
    });

    const envelope = createEventEnvelope({
      event_id: randomUUID(),
      event_type: 'batch.cleaned',
      entity_type: 'kit_batch',
      entity_id: batchId,
      batch_id: batchId,
      correlation_id: batch.correlationId,
      producer: 'migration-kit.clean',
      payload,
    });

    await this.outboxRepo.append(envelope);

    return {
      batchId,
      module: batch.module,
      totalRows: rawRowsList.length,
      cleanedRows: cleanedCount,
      rejectedRows: rejectedCount,
      fieldAuditsCount: cleanLogEntries.length,
      durationMs,
    };
  }

  private computeRawRowsChecksum(rows: { sourceRow: number; rowHash: string }[]): string {
    const hasher = createHash('sha256');
    for (const r of rows) {
      hasher.update(`${r.sourceRow}:${r.rowHash}\n`);
    }
    return hasher.digest('hex');
  }
}
