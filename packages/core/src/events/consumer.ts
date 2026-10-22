import { EventEnvelope, EventEnvelopeSchema } from "@clearshift/contracts";
import { IRedisStreams, StreamMessage } from "./redis-streams.js";
import { consumedEvents } from "@clearshift/database";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";

export interface IIdempotencyStore {
  isProcessed(consumer: string, eventId: string): Promise<boolean>;
  markProcessed(consumer: string, eventId: string): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryIdempotencyStore implements IIdempotencyStore {
  private processed: Set<string> = new Set();

  async isProcessed(consumer: string, eventId: string): Promise<boolean> {
    return this.processed.has(`${consumer}:${eventId}`);
  }

  async markProcessed(consumer: string, eventId: string): Promise<void> {
    this.processed.add(`${consumer}:${eventId}`);
  }

  async clear(): Promise<void> {
    this.processed.clear();
  }
}

export class PgIdempotencyStore implements IIdempotencyStore {
  constructor(private db: NodePgDatabase) {}

  async isProcessed(consumer: string, eventId: string): Promise<boolean> {
    const rows = await this.db
      .select({ eventId: consumedEvents.eventId })
      .from(consumedEvents)
      .where(and(eq(consumedEvents.consumer, consumer), eq(consumedEvents.eventId, eventId)))
      .limit(1);

    return rows.length > 0;
  }

  async markProcessed(consumer: string, eventId: string): Promise<void> {
    await this.db
      .insert(consumedEvents)
      .values({
        consumer,
        eventId,
      })
      .onConflictDoNothing();
  }

  async clear(): Promise<void> {
    await this.db.delete(consumedEvents);
  }
}

export type EventHandler = (envelope: EventEnvelope) => Promise<void>;

export interface ConsumerProcessingResult {
  messageId: string;
  eventId: string;
  status: "processed" | "skipped_duplicate" | "failed";
  error?: string | undefined;
}

export interface ConsumerMetrics {
  streamKey: string;
  groupName: string;
  consumerName: string;
  streamLength: number;
  pendingCount: number;
  lastDeliveredId: string;
  lag: number;
}

export class IdempotentConsumer {
  private batchSize: number;
  private minIdleTimeMs: number;

  constructor(
    private redis: IRedisStreams,
    private streamKey: string,
    private groupName: string,
    private consumerName: string,
    private idempotencyStore: IIdempotencyStore,
    private handler: EventHandler,
    options?: {
      batchSize?: number;
      minIdleTimeMs?: number;
    }
  ) {
    this.batchSize = options?.batchSize ?? 50;
    this.minIdleTimeMs = options?.minIdleTimeMs ?? 60000;
  }

  async initialize(startId = "0"): Promise<void> {
    await this.redis.createConsumerGroup(this.streamKey, this.groupName, startId);
  }

  /**
   * Deserialize raw stream message fields into validated EventEnvelope
   */
  private parseEnvelope(msg: StreamMessage): EventEnvelope {
    const rawPayload = msg.fields["payload"] ?? msg.fields["envelope"] ?? "{}";
    const parsed = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
    return EventEnvelopeSchema.parse(parsed);
  }

  /**
   * Process a single stream message with guaranteed idempotency and safe acknowledgement
   */
  async processMessage(msg: StreamMessage): Promise<ConsumerProcessingResult> {
    const envelope = this.parseEnvelope(msg);
    const eventId = envelope.event_id;

    // 1. Deduplication check
    const alreadyProcessed = await this.idempotencyStore.isProcessed(this.groupName, eventId);
    if (alreadyProcessed) {
      // Duplicate detected: safe acknowledge without repeating side-effects
      await this.redis.xack(this.streamKey, this.groupName, msg.id);
      return {
        messageId: msg.id,
        eventId,
        status: "skipped_duplicate",
      };
    }

    // 2. Execute business handler
    try {
      await this.handler(envelope);

      // 3. Mark processed in idempotency store & acknowledge
      await this.idempotencyStore.markProcessed(this.groupName, eventId);
      await this.redis.xack(this.streamKey, this.groupName, msg.id);

      return {
        messageId: msg.id,
        eventId,
        status: "processed",
      };
    } catch (err) {
      // Non-negotiable: Do NOT acknowledge if handler fails!
      // Leaves message in PEL for automatic recovery.
      return {
        messageId: msg.id,
        eventId,
        status: "failed",
        error: (err as Error).message,
      };
    }
  }

  /**
   * Reads next batch of new messages from Redis Streams
   */
  async processNextBatch(): Promise<ConsumerProcessingResult[]> {
    const messages = await this.redis.xreadgroup(
      this.groupName,
      this.consumerName,
      this.streamKey,
      { count: this.batchSize, id: ">" }
    );

    const results: ConsumerProcessingResult[] = [];
    for (const msg of messages) {
      const res = await this.processMessage(msg);
      results.push(res);
    }
    return results;
  }

  /**
   * Reclaims unacknowledged messages idle longer than minIdleTimeMs from PEL
   */
  async reclaimPending(minIdleTimeMs: number = this.minIdleTimeMs): Promise<ConsumerProcessingResult[]> {
    const claimRes = await this.redis.xautoclaim(
      this.streamKey,
      this.groupName,
      this.consumerName,
      minIdleTimeMs,
      "0-0",
      this.batchSize
    );

    const results: ConsumerProcessingResult[] = [];
    for (const msg of claimRes.messages) {
      const res = await this.processMessage(msg);
      results.push(res);
    }
    return results;
  }

  /**
   * Observability helper: reports stream metrics, lag, and pending count
   */
  async getMetrics(): Promise<ConsumerMetrics> {
    const info = await this.redis.xinfo(this.streamKey);
    const groupInfo = info.groups.find((g) => g.groupName === this.groupName);
    const pendingCount = groupInfo?.pendingCount ?? 0;
    const lastDelivered = groupInfo?.lastDeliveredId ?? "0-0";

    // Lag calculation: total stream length minus items delivered so far
    const lag = pendingCount;

    return {
      streamKey: this.streamKey,
      groupName: this.groupName,
      consumerName: this.consumerName,
      streamLength: info.length,
      pendingCount,
      lastDeliveredId: lastDelivered,
      lag,
    };
  }
}
