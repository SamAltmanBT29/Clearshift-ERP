import { eq, and, or, isNull, lt, lte, inArray, gte, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { EventEnvelope, EventEnvelopeSchema } from "@clearshift/contracts";
import { outbox, consumedEvents } from "../schema/platform.js";
import { getDatabase } from "../registry.js";

export interface OutboxRecord {
  id: string;
  eventId: string;
  eventType: string;
  schemaVersion: string;
  occurredAt: Date;
  producer: string;
  correlationId: string;
  batchId?: string | null | undefined;
  entityType: string;
  entityId: string;
  payload: unknown;
  metadata?: Record<string, unknown> | null | undefined;
  publishedAt?: Date | null | undefined;
  lockedAt?: Date | null | undefined;
  lockedBy?: string | null | undefined;
  retryCount: number;
  lastError?: string | null | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface IOutboxRepository {
  writeEvent(envelope: EventEnvelope, tx?: NodePgDatabase | any): Promise<OutboxRecord>;
  claimPending(options: { limit?: number | undefined; workerId: string; lockTimeoutMs?: number | undefined }): Promise<OutboxRecord[]>;
  markPublished(eventIds: string[]): Promise<void>;
  recordFailure(eventId: string, error: string): Promise<void>;
  queryForReplay(options?: { since?: Date | undefined; maxDays?: number | undefined; eventTypes?: string[] | undefined }): Promise<OutboxRecord[]>;
  purgeOldPublished(retentionDays?: number | undefined): Promise<number>;
  countPending(): Promise<number>;
  clear(): Promise<void>;
}

/**
 * In-Memory Outbox Repository for unit tests and isolated harnesses
 */
export class InMemoryOutboxRepository implements IOutboxRepository {
  private records: Map<string, OutboxRecord> = new Map();

  async writeEvent(envelope: EventEnvelope, _tx?: any): Promise<OutboxRecord> {
    const validated = EventEnvelopeSchema.parse(envelope);
    const now = new Date();
    const record: OutboxRecord = {
      id: crypto.randomUUID(),
      eventId: validated.event_id,
      eventType: validated.event_type,
      schemaVersion: validated.schema_version,
      occurredAt: new Date(validated.occurred_at),
      producer: validated.producer,
      correlationId: validated.correlation_id,
      batchId: validated.batch_id ?? null,
      entityType: validated.entity_type,
      entityId: validated.entity_id,
      payload: validated.payload,
      metadata: (validated.metadata as Record<string, unknown>) ?? null,
      publishedAt: null,
      lockedAt: null,
      lockedBy: null,
      retryCount: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.eventId, record);
    return record;
  }

  async claimPending(options: { limit?: number | undefined; workerId: string; lockTimeoutMs?: number | undefined }): Promise<OutboxRecord[]> {
    const limit = options.limit ?? 50;
    const lockTimeoutMs = options.lockTimeoutMs ?? 30000;
    const now = new Date();
    const claimed: OutboxRecord[] = [];

    for (const record of this.records.values()) {
      if (claimed.length >= limit) break;
      if (record.publishedAt !== null && record.publishedAt !== undefined) continue;

      const isLocked = record.lockedAt && (now.getTime() - record.lockedAt.getTime() < lockTimeoutMs);
      if (!isLocked) {
        record.lockedAt = now;
        record.lockedBy = options.workerId;
        record.updatedAt = now;
        claimed.push({ ...record });
      }
    }
    return claimed;
  }

  async markPublished(eventIds: string[]): Promise<void> {
    const now = new Date();
    for (const eventId of eventIds) {
      const record = this.records.get(eventId);
      if (record) {
        record.publishedAt = now;
        record.lockedAt = null;
        record.lockedBy = null;
        record.updatedAt = now;
      }
    }
  }

  async recordFailure(eventId: string, error: string): Promise<void> {
    const record = this.records.get(eventId);
    if (record) {
      record.retryCount += 1;
      record.lastError = error;
      record.lockedAt = null;
      record.lockedBy = null;
      record.updatedAt = new Date();
    }
  }

  async queryForReplay(options?: { since?: Date | undefined; maxDays?: number | undefined; eventTypes?: string[] | undefined }): Promise<OutboxRecord[]> {
    const maxDays = Math.min(options?.maxDays ?? 30, 30);
    const earliestAllowed = new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000);
    const effectiveSince = options?.since && options.since > earliestAllowed ? options.since : earliestAllowed;

    const results: OutboxRecord[] = [];
    for (const record of this.records.values()) {
      if (record.createdAt >= effectiveSince) {
        if (!options?.eventTypes || options.eventTypes.includes(record.eventType)) {
          results.push({ ...record });
        }
      }
    }
    return results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async purgeOldPublished(retentionDays = 30): Promise<number> {
    if (retentionDays < 30) {
      throw new Error("V1 outbox retention policy forbids deleting records younger than 30 days");
    }
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let deletedCount = 0;

    for (const [eventId, record] of this.records.entries()) {
      // Non-negotiable: Never delete unpublished rows or rows younger than 30 days
      if (record.publishedAt && record.publishedAt <= cutoff && record.createdAt <= cutoff) {
        this.records.delete(eventId);
        deletedCount++;
      }
    }
    return deletedCount;
  }

  async countPending(): Promise<number> {
    let count = 0;
    for (const record of this.records.values()) {
      if (!record.publishedAt) count++;
    }
    return count;
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}

/**
 * PostgreSQL Outbox Repository implementing PLT-09 transactional durability
 */
export class PgOutboxRepository implements IOutboxRepository {
  constructor(private db: NodePgDatabase = getDatabase()) {}

  async writeEvent(envelope: EventEnvelope, tx?: NodePgDatabase): Promise<OutboxRecord> {
    const validated = EventEnvelopeSchema.parse(envelope);
    const executor = tx || this.db;

    const [inserted] = await executor.insert(outbox).values({
      eventId: validated.event_id,
      eventType: validated.event_type,
      schemaVersion: validated.schema_version,
      occurredAt: new Date(validated.occurred_at),
      producer: validated.producer,
      correlationId: validated.correlation_id,
      batchId: validated.batch_id ?? null,
      entityType: validated.entity_type,
      entityId: validated.entity_id,
      payload: validated.payload,
      metadata: validated.metadata ?? null,
      publishedAt: null,
      lockedAt: null,
      lockedBy: null,
      retryCount: 0,
      lastError: null,
    }).returning();

    return inserted as OutboxRecord;
  }

  async claimPending(options: { limit?: number | undefined; workerId: string; lockTimeoutMs?: number | undefined }): Promise<OutboxRecord[]> {
    const limit = options.limit ?? 50;
    const lockTimeoutMs = options.lockTimeoutMs ?? 30000;
    const lockExpiry = new Date(Date.now() - lockTimeoutMs);
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      // Find candidate rows with FOR UPDATE SKIP LOCKED
      const candidates = await tx
        .select()
        .from(outbox)
        .where(
          and(
            isNull(outbox.publishedAt),
            or(isNull(outbox.lockedAt), lt(outbox.lockedAt, lockExpiry))
          )
        )
        .limit(limit);

      if (candidates.length === 0) return [];

      const ids = candidates.map((c) => c.id);
      const updated = await tx
        .update(outbox)
        .set({
          lockedAt: now,
          lockedBy: options.workerId,
          updatedAt: now,
        })
        .where(inArray(outbox.id, ids))
        .returning();

      return updated as OutboxRecord[];
    });
  }

  async markPublished(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    const now = new Date();

    await this.db
      .update(outbox)
      .set({
        publishedAt: now,
        lockedAt: null,
        lockedBy: null,
        updatedAt: now,
      })
      .where(inArray(outbox.eventId, eventIds));
  }

  async recordFailure(eventId: string, error: string): Promise<void> {
    await this.db
      .update(outbox)
      .set({
        retryCount: sql`${outbox.retryCount} + 1`,
        lastError: error,
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(outbox.eventId, eventId));
  }

  async queryForReplay(options?: { since?: Date | undefined; maxDays?: number | undefined; eventTypes?: string[] | undefined }): Promise<OutboxRecord[]> {
    const maxDays = Math.min(options?.maxDays ?? 30, 30);
    const earliestAllowed = new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000);
    const effectiveSince = options?.since && options.since > earliestAllowed ? options.since : earliestAllowed;

    const conditions = [gte(outbox.createdAt, effectiveSince)];
    if (options?.eventTypes && options.eventTypes.length > 0) {
      conditions.push(inArray(outbox.eventType, options.eventTypes));
    }

    const rows = await this.db
      .select()
      .from(outbox)
      .where(and(...conditions))
      .orderBy(outbox.createdAt);

    return rows as OutboxRecord[];
  }

  async purgeOldPublished(retentionDays = 30): Promise<number> {
    if (retentionDays < 30) {
      throw new Error("V1 outbox retention policy forbids deleting records younger than 30 days");
    }
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    // Non-negotiable: Never delete unpublished rows or rows younger than 30 days
    const result = await this.db
      .delete(outbox)
      .where(
        and(
          sql`${outbox.publishedAt} IS NOT NULL`,
          lte(outbox.publishedAt, cutoff),
          lte(outbox.createdAt, cutoff)
        )
      )
      .returning({ id: outbox.id });

    return result.length;
  }

  async countPending(): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(outbox)
      .where(isNull(outbox.publishedAt));

    return Number(result?.count ?? 0);
  }

  async clear(): Promise<void> {
    await this.db.delete(outbox);
  }
}
