import { randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import {
  ProfileReport,
  ColumnProfile,
  BatchProfiledPayloadSchema,
  createEventEnvelope,
  type EventEnvelope,
} from '@clearshift/contracts';
import { kitProfileReports, outbox } from '../db/schema.js';
import { profileColumn } from './column-profiler.js';
import { detectExactDuplicates } from './duplicate-detector.js';
import { BatchRegistryService } from '../batches/batch-registry.js';
import { IRawRowsRepository } from '../ingest/ingest-service.js';

/**
 * Profile Report Repository Interface
 */
export interface IProfileReportRepository {
  saveReport(report: ProfileReport): Promise<void>;
  findByBatchId(batchId: string): Promise<ProfileReport | null>;
}

/**
 * Outbox Event Repository Interface
 */
export interface IOutboxRepository {
  append(envelope: EventEnvelope): Promise<void>;
  findByEventId(eventId: string): Promise<EventEnvelope | null>;
  listByBatchId(batchId: string): Promise<EventEnvelope[]>;
}

/**
 * In-Memory Profile Report Repository
 */
export class InMemoryProfileReportRepository implements IProfileReportRepository {
  private reports = new Map<string, ProfileReport>();

  async saveReport(report: ProfileReport): Promise<void> {
    this.reports.set(report.batchId, { ...report });
  }

  async findByBatchId(batchId: string): Promise<ProfileReport | null> {
    const found = this.reports.get(batchId);
    return found ? { ...found } : null;
  }

  clear(): void {
    this.reports.clear();
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

  getAllEvents(): EventEnvelope[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

/**
 * Drizzle Database Profile Report Repository
 */
export class DrizzleProfileReportRepository implements IProfileReportRepository {
  constructor(private db: any) {}

  async saveReport(report: ProfileReport): Promise<void> {
    for (const col of report.columns) {
      await this.db
        .insert(kitProfileReports)
        .values({
          batchId: report.batchId,
          columnName: col.columnName,
          emptyCount: col.emptyCount,
          invalidCount: col.invalidCount,
          distinctCount: col.distinctCount,
          inferredType: col.inferredType,
          topValuesJson: col.topValues,
          minValue: col.minValue ?? null,
          maxValue: col.maxValue ?? null,
          createdAt: report.generatedAt,
        })
        .onConflictDoUpdate({
          target: [kitProfileReports.batchId, kitProfileReports.columnName],
          set: {
            emptyCount: col.emptyCount,
            invalidCount: col.invalidCount,
            distinctCount: col.distinctCount,
            inferredType: col.inferredType,
            topValuesJson: col.topValues,
            minValue: col.minValue ?? null,
            maxValue: col.maxValue ?? null,
          },
        });
    }
  }

  async findByBatchId(batchId: string): Promise<ProfileReport | null> {
    const results = await this.db
      .select()
      .from(kitProfileReports)
      .where(eq(kitProfileReports.batchId, batchId));

    if (results.length === 0) return null;

    const columns: ColumnProfile[] = results.map((r: any) => ({
      columnName: r.columnName,
      totalRows: 0, // aggregate if needed
      emptyCount: r.emptyCount,
      invalidCount: r.invalidCount,
      distinctCount: r.distinctCount,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inferredType: r.inferredType as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      topValues: (r.topValuesJson as any) || [],
      minValue: r.minValue,
      maxValue: r.maxValue,
    }));

    return {
      batchId,
      module: 'unknown',
      rulesetVersion: 1,
      totalRows: 0,
      totalColumns: columns.length,
      columns,
      duplicates: {
        keyFields: [],
        totalDuplicates: 0,
        uniqueDuplicateKeys: 0,
        sampleDuplicateKeys: [],
      },
      summary: {
        emptyCount: columns.reduce((acc, c) => acc + c.emptyCount, 0),
        invalidCount: columns.reduce((acc, c) => acc + c.invalidCount, 0),
        duplicateCount: 0,
      },
      generatedAt: results[0]?.createdAt || new Date(),
    };
  }
}

/**
 * Drizzle Database Outbox Repository
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
    const results = await this.db
      .select()
      .from(outbox)
      .where(eq(outbox.eventId, eventId));

    const r = results[0];
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

export interface ProfileBatchOptions {
  keyFields?: string[];
  actor?: string;
  correlationId?: string;
}

/**
 * Migration Kit Column Profiling Service (KIT-03)
 * Coordinates data profiling without mutating raw rows, generates health metrics,
 * transitions batch state, and emits outbox events.
 */
export class ProfileService {
  constructor(
    private batchService: BatchRegistryService,
    private rawRowsRepo: IRawRowsRepository,
    private reportRepo: IProfileReportRepository = new InMemoryProfileReportRepository(),
    private outboxRepo: IOutboxRepository = new InMemoryOutboxRepository()
  ) {}

  /**
   * Profiles raw rows for a batch, generates health report, advances batch to 'profiled',
   * and writes outbox event 'batch.profiled'.
   */
  async profileBatch(
    batchId: string,
    options: ProfileBatchOptions = {}
  ): Promise<ProfileReport> {
    const batch = await this.batchService.getBatch(batchId);
    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    // Retrieve all raw rows from repository (immutable source)
    const rawRows = await this.rawRowsRepo.findByBatchId(batchId);
    if (!rawRows || rawRows.length === 0) {
      throw new Error(`Cannot profile batch '${batchId}': no raw source rows found`);
    }

    const firstRow = rawRows[0];
    if (!firstRow) {
      throw new Error(`Cannot profile batch '${batchId}': empty row set`);
    }

    const totalRows = rawRows.length;
    const headers = firstRow.headers;
    const columns: ColumnProfile[] = [];

    // 1. Profile each column
    for (const col of headers) {
      const values = rawRows.map((r) => r.payload[col] || '');
      const profile = profileColumn(col, values);
      columns.push(profile);
    }

    // 2. Exact duplicate candidate detection across declared key fields (default: 'email' or first column)
    const firstCol = headers[0] || 'id';
    const keyFields: string[] = options.keyFields && options.keyFields.length > 0
      ? options.keyFields
      : (headers.includes('email') ? ['email'] : [firstCol]);

    const duplicateDetection = detectExactDuplicates(rawRows, { keyFields });

    const totalEmptyCount = columns.reduce((acc, c) => acc + c.emptyCount, 0);
    const totalInvalidCount = columns.reduce((acc, c) => acc + c.invalidCount, 0);
    const totalDuplicateCount = duplicateDetection.report.totalDuplicates;

    const report: ProfileReport = {
      batchId,
      module: batch.module,
      rulesetVersion: 1,
      totalRows,
      totalColumns: headers.length,
      columns,
      duplicates: duplicateDetection.report,
      summary: {
        emptyCount: totalEmptyCount,
        invalidCount: totalInvalidCount,
        duplicateCount: totalDuplicateCount,
      },
      generatedAt: new Date(),
    };

    // 3. Persist profile report
    await this.reportRepo.saveReport(report);

    // 4. Transition batch state to 'profiled' (Step 2 completion)
    await this.batchService.transitionBatch(batchId, {
      targetStatus: 'profiled',
      stepName: 'profile',
      recordsIn: totalRows,
      recordsOut: totalRows,
      recordsRejected: 0,
      actor: options.actor || 'system',
      correlationId: options.correlationId || batch.correlationId,
      metadata: {
        totalColumns: headers.length,
        emptyCount: totalEmptyCount,
        invalidCount: totalInvalidCount,
        duplicateCount: totalDuplicateCount,
      },
    });

    // 5. Emit 'batch.profiled' domain event to transactional outbox
    const payload = BatchProfiledPayloadSchema.parse({
      batchId,
      module: batch.module,
      emptyCount: totalEmptyCount,
      invalidCount: totalInvalidCount,
      duplicateCount: totalDuplicateCount,
      totalRows,
      columnsCount: headers.length,
      rulesetVersion: 1,
    });

    const eventEnvelope = createEventEnvelope({
      event_id: randomUUID(),
      event_type: 'batch.profiled',
      entity_type: 'kit_batch',
      entity_id: batchId,
      batch_id: batchId,
      payload,
      correlation_id: options.correlationId || batch.correlationId,
      producer: 'migration-kit.profile',
    });

    await this.outboxRepo.append(eventEnvelope);

    return report;
  }

  async getProfileReport(batchId: string): Promise<ProfileReport | null> {
    return await this.reportRepo.findByBatchId(batchId);
  }
}
