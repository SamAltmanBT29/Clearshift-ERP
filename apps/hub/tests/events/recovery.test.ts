import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryOutboxRepository } from "@clearshift/database";
import {
  InMemoryRedisStreams,
  IdempotentConsumer,
  InMemoryIdempotencyStore,
} from "@cs/core";
import { OutboxRelay } from "../../src/events/relay.js";
import { createEventEnvelope } from "@clearshift/contracts";

describe("[PLT-09] Transactional Outbox, Redis Streams Relay and Consumer Recovery", () => {
  let outboxRepo: InMemoryOutboxRepository;
  let redis: InMemoryRedisStreams;
  let relay: OutboxRelay;
  let idempotencyStore: InMemoryIdempotencyStore;

  const STREAM_KEY = "clearshift.events";
  const GROUP_NAME = "hub-test-consumer-group";
  const CONSUMER_NAME = "worker-1";

  beforeEach(async () => {
    outboxRepo = new InMemoryOutboxRepository();
    redis = new InMemoryRedisStreams();
    idempotencyStore = new InMemoryIdempotencyStore();

    relay = new OutboxRelay(outboxRepo, redis, {
      streamKey: STREAM_KEY,
      batchSize: 10,
      lockTimeoutMs: 100, // fast lock expiry for tests
      retentionDays: 30,
    });
  });

  it("recovers unpublished events after simulated DB commit and relay process crash", async () => {
    // 1. Transaction commits business state + outbox envelope atomically
    const eventId = crypto.randomUUID();
    const envelope = createEventEnvelope({
      event_id: eventId,
      event_type: "erp.invoice.posted",
      correlation_id: "corr-101",
      producer: "erp-finance",
      entity_type: "invoice",
      entity_id: "inv-999",
      batch_id: "batch-1",
      payload: { invoiceId: "inv-999", totalAmount: "12500.00" },
    });

    const outboxRecord = await outboxRepo.writeEvent(envelope);
    expect(outboxRecord.publishedAt).toBeNull();
    expect(await outboxRepo.countPending()).toBe(1);

    // 2. Simulated process crash: relay was not running at commit time
    // 3. New relay process spins up and runs pollAndRelay()
    const pollResult = await relay.pollAndRelay();
    expect(pollResult.polled).toBe(1);
    expect(pollResult.published).toBe(1);
    expect(pollResult.eventIds).toContain(eventId);

    // 4. Verify outbox state is now published and stream has received message
    expect(await outboxRepo.countPending()).toBe(0);
    const streamInfo = await redis.xinfo(STREAM_KEY);
    expect(streamInfo.length).toBe(1);
  });

  it("ensures duplicate event delivery does not duplicate side effects", async () => {
    let sideEffectExecutionCount = 0;
    const handledEventIds: string[] = [];

    const consumer = new IdempotentConsumer(
      redis,
      STREAM_KEY,
      GROUP_NAME,
      CONSUMER_NAME,
      idempotencyStore,
      async (env) => {
        sideEffectExecutionCount++;
        handledEventIds.push(env.event_id);
      }
    );
    await consumer.initialize();

    const eventId = crypto.randomUUID();
    const envelope = createEventEnvelope({
      event_id: eventId,
      event_type: "crm.deal.won",
      correlation_id: "corr-202",
      producer: "crm-deals",
      entity_type: "deal",
      entity_id: "deal-42",
      payload: { dealId: "deal-42", value: "50000" },
    });

    // Write to outbox and relay to Redis
    await outboxRepo.writeEvent(envelope);
    await relay.pollAndRelay();

    // 1. First delivery
    const firstBatch = await consumer.processNextBatch();
    expect(firstBatch).toHaveLength(1);
    expect(firstBatch[0]?.status).toBe("processed");
    expect(sideEffectExecutionCount).toBe(1);
    expect(handledEventIds).toContain(eventId);

    // 2. Simulate duplicate delivery (e.g. re-enqueued or redelivered message)
    await redis.xadd(STREAM_KEY, {
      event_id: eventId,
      event_type: envelope.event_type,
      payload: JSON.stringify(envelope),
    });

    // 3. Second delivery attempt
    const secondBatch = await consumer.processNextBatch();
    expect(secondBatch).toHaveLength(1);
    expect(secondBatch[0]?.status).toBe("skipped_duplicate");
    // CRITICAL: Side effects must NOT duplicate!
    expect(sideEffectExecutionCount).toBe(1);
  });

  it("reclaims pending consumer messages from PEL and only acknowledges after success", async () => {
    let shouldFail = true;
    let successfulExecutions = 0;

    const consumer = new IdempotentConsumer(
      redis,
      STREAM_KEY,
      GROUP_NAME,
      CONSUMER_NAME,
      idempotencyStore,
      async () => {
        if (shouldFail) {
          throw new Error("Simulated worker crash during handler processing");
        }
        successfulExecutions++;
      },
      { minIdleTimeMs: 50 } // short idle time for test
    );
    await consumer.initialize();

    const eventId = crypto.randomUUID();
    const envelope = createEventEnvelope({
      event_id: eventId,
      event_type: "erp.inventory.adjusted",
      correlation_id: "corr-303",
      producer: "erp-inventory",
      entity_type: "item",
      entity_id: "sku-888",
      payload: { sku: "sku-888", delta: -5 },
    });

    await outboxRepo.writeEvent(envelope);
    await relay.pollAndRelay();

    // 1. Initial attempt fails
    const failBatch = await consumer.processNextBatch();
    expect(failBatch[0]?.status).toBe("failed");
    expect(successfulExecutions).toBe(0);

    // Message must remain in PEL (unacknowledged)
    const metricsBefore = await consumer.getMetrics();
    expect(metricsBefore.pendingCount).toBe(1);

    // 2. Wait for idle timeout and recover
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Recovery worker now healthy
    shouldFail = false;
    const recoveryBatch = await consumer.reclaimPending(50);
    expect(recoveryBatch).toHaveLength(1);
    expect(recoveryBatch[0]?.status).toBe("processed");
    expect(successfulExecutions).toBe(1);

    // Message is now acknowledged and cleared from PEL
    const metricsAfter = await consumer.getMetrics();
    expect(metricsAfter.pendingCount).toBe(0);
  });

  it("replays retained outbox events from PostgreSQL after Redis rebuild with original IDs", async () => {
    // 1. Produce 3 events into PostgreSQL outbox and relay
    const eventIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const eid = crypto.randomUUID();
      eventIds.push(eid);
      const env = createEventEnvelope({
        event_id: eid,
        event_type: "erp.batch.processed",
        correlation_id: `corr-batch-${i}`,
        producer: "erp-batch",
        entity_type: "batch",
        entity_id: `b-${i}`,
        batch_id: `batch-${i}`,
        payload: { rowCount: i * 100 },
      });
      await outboxRepo.writeEvent(env);
    }
    await relay.pollAndRelay();

    // 2. Total disaster: Redis is wiped out (e.g. volume rebuild)
    await redis.clear();
    const emptyInfo = await redis.xinfo(STREAM_KEY);
    expect(emptyInfo.length).toBe(0);

    // 3. Run Rebuild Replay Command
    const replayResult = await relay.replayOutboxToRedis({ maxDays: 30 });
    expect(replayResult.replayedCount).toBe(3);
    expect(replayResult.eventIds).toEqual(eventIds);

    // 4. Verify Redis Stream is restored with identical original event IDs
    const restoredInfo = await redis.xinfo(STREAM_KEY);
    expect(restoredInfo.length).toBe(3);

    // 5. Verify consumer reads restored stream cleanly
    const processedEvents: string[] = [];
    const consumer = new IdempotentConsumer(
      redis,
      STREAM_KEY,
      "rebuilt-group",
      "rebuilt-worker",
      new InMemoryIdempotencyStore(),
      async (env) => {
        processedEvents.push(env.event_id);
      }
    );
    await consumer.initialize();
    await consumer.processNextBatch();

    expect(processedEvents).toHaveLength(3);
    expect(processedEvents).toEqual(eventIds);
  });

  it("observes consumer lag and prevents trimming pending/unacknowledged stream entries", async () => {
    const consumer = new IdempotentConsumer(
      redis,
      STREAM_KEY,
      GROUP_NAME,
      CONSUMER_NAME,
      idempotencyStore,
      async () => {} // healthy handler
    );
    await consumer.initialize();

    // Produce 2 events
    for (let i = 0; i < 2; i++) {
      await redis.xadd(STREAM_KEY, {
        event_id: crypto.randomUUID(),
        event_type: "audit.action",
        payload: JSON.stringify({ action: "test" }),
      });
    }

    const metricsInitial = await consumer.getMetrics();
    expect(metricsInitial.streamLength).toBe(2);

    // Attempt to trim stream while entries have not been delivered or acknowledged
    const trimResult = await relay.trimStream([GROUP_NAME]);
    // Non-negotiable constraint: Never trim pending or undelivered entries
    expect(trimResult.trimmedCount).toBe(0);
    expect(trimResult.remainingCount).toBe(2);
  });

  it("strictly enforces PostgreSQL outbox retention constraints (30 days minimum)", async () => {
    // Attempting to configure purge younger than 30 days must be rejected
    await expect(outboxRepo.purgeOldPublished(15)).rejects.toThrow(
      "V1 outbox retention policy forbids deleting records younger than 30 days"
    );

    // Unpublished rows must never be deleted
    const unpublishedEnvelope = createEventEnvelope({
      event_id: crypto.randomUUID(),
      event_type: "erp.critical.event",
      correlation_id: "corr-unpub",
      producer: "erp-test",
      entity_type: "test",
      entity_id: "t-1",
      payload: {},
    });
    await outboxRepo.writeEvent(unpublishedEnvelope);

    const deleted = await outboxRepo.purgeOldPublished(30);
    expect(deleted).toBe(0);
    expect(await outboxRepo.countPending()).toBe(1);
  });
});
