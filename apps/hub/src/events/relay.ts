import { IOutboxRepository, OutboxRecord } from "@clearshift/database";
import { IRedisStreams } from "@cs/core";
import { EventEnvelope } from "@clearshift/contracts";

export interface OutboxRelayConfig {
  workerId?: string | undefined;
  streamKey?: string | undefined;
  batchSize?: number | undefined;
  lockTimeoutMs?: number | undefined;
  retentionDays?: number | undefined;
}

export interface RelayPollResult {
  polled: number;
  published: number;
  failed: number;
  eventIds: string[];
}

export class OutboxRelay {
  private workerId: string;
  private streamKey: string;
  private batchSize: number;
  private lockTimeoutMs: number;
  private retentionDays: number;
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private outboxRepo: IOutboxRepository,
    private redis: IRedisStreams,
    config?: OutboxRelayConfig
  ) {
    this.workerId = config?.workerId ?? `relay-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    this.streamKey = config?.streamKey ?? "clearshift.events";
    this.batchSize = config?.batchSize ?? 50;
    this.lockTimeoutMs = config?.lockTimeoutMs ?? 30000;
    this.retentionDays = config?.retentionDays ?? 30;
  }

  /**
   * Constructs standard EventEnvelope from database OutboxRecord
   */
  private toEnvelope(record: OutboxRecord): EventEnvelope {
    return {
      event_id: record.eventId,
      event_type: record.eventType,
      schema_version: record.schemaVersion,
      occurred_at: record.occurredAt instanceof Date ? record.occurredAt.toISOString() : String(record.occurredAt),
      producer: record.producer,
      correlation_id: record.correlationId,
      entity_type: record.entityType,
      entity_id: record.entityId,
      ...(record.batchId ? { batch_id: record.batchId } : {}),
      payload: record.payload,
      ...(record.metadata ? { metadata: record.metadata } : {}),
    };
  }

  /**
   * Polls unpublished outbox rows, locks them, publishes to Redis Streams,
   * and marks them published. Provides crash recovery for failed publishes.
   */
  async pollAndRelay(): Promise<RelayPollResult> {
    const claimed = await this.outboxRepo.claimPending({
      limit: this.batchSize,
      workerId: this.workerId,
      lockTimeoutMs: this.lockTimeoutMs,
    });

    if (claimed.length === 0) {
      return { polled: 0, published: 0, failed: 0, eventIds: [] };
    }

    const publishedIds: string[] = [];
    let failedCount = 0;

    for (const record of claimed) {
      try {
        const envelope = this.toEnvelope(record);
        await this.redis.xadd(this.streamKey, {
          event_id: record.eventId,
          event_type: record.eventType,
          payload: JSON.stringify(envelope),
        });
        publishedIds.push(record.eventId);
      } catch (err) {
        failedCount++;
        await this.outboxRepo.recordFailure(record.eventId, (err as Error).message);
      }
    }

    if (publishedIds.length > 0) {
      await this.outboxRepo.markPublished(publishedIds);
    }

    return {
      polled: claimed.length,
      published: publishedIds.length,
      failed: failedCount,
      eventIds: publishedIds,
    };
  }

  /**
   * Disaster recovery & rebuild replay command:
   * Replays retained outbox events from PostgreSQL back to Redis Streams with original IDs.
   */
  async replayOutboxToRedis(options?: {
    since?: Date;
    maxDays?: number;
    eventTypes?: string[];
  }): Promise<{ replayedCount: number; eventIds: string[] }> {
    const records = await this.outboxRepo.queryForReplay({
      since: options?.since,
      maxDays: options?.maxDays ?? this.retentionDays,
      eventTypes: options?.eventTypes,
    });

    const replayedIds: string[] = [];

    for (const record of records) {
      const envelope = this.toEnvelope(record);
      await this.redis.xadd(this.streamKey, {
        event_id: record.eventId,
        event_type: record.eventType,
        payload: JSON.stringify(envelope),
      });
      replayedIds.push(record.eventId);
    }

    return {
      replayedCount: replayedIds.length,
      eventIds: replayedIds,
    };
  }

  /**
   * Safely trims Redis stream:
   * Non-negotiable constraint:
   * "Trim only stream entries older than 30 days that are acknowledged by all configured consumer groups;
   * never trim pending/unacknowledged entries."
   */
  async trimStream(configuredConsumerGroups: string[]): Promise<{ trimmedCount: number; remainingCount: number }> {
    const maxAgeMs = this.retentionDays * 24 * 60 * 60 * 1000;
    return await this.redis.xtrimAcknowledged(this.streamKey, maxAgeMs, configuredConsumerGroups);
  }

  /**
   * Safely purges outbox entries in PostgreSQL older than 30 days.
   * Non-negotiable constraint: Never delete unpublished rows or rows younger than 30 days.
   */
  async purgeOldOutbox(): Promise<number> {
    return await this.outboxRepo.purgeOldPublished(this.retentionDays);
  }

  start(intervalMs = 1000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(async () => {
      try {
        await this.pollAndRelay();
      } catch (err) {
        // Log or handle relay poll error safely
      }
    }, intervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
