# ClearShift Redis Recovery & Outbox Operations Runbook (PLT-09)

## 1. Context & Architectural Decisions

In accordance with **ClearShift Project Plan v3.0 §§9.3–9.6, 17** and **ADR-002**, ClearShift guarantees at-least-once event delivery across microservices without relying on distributed transactions (XA):
1. **Source of Truth**: PostgreSQL is the durable source of truth for both business state and domain events.
2. **Atomic Enqueue**: Domain mutations and their corresponding `EventEnvelope` are written in the **exact same PostgreSQL transaction** via `withTransaction()` and the `outbox` table in `platformSchema`.
3. **Delivery Channel**: Redis Streams (`clearshift.events`) provides high-throughput event pub/sub.
4. **Idempotent Consumers**: Consumers deduplicate incoming events by `event_id` against `consumed_events` before executing side effects, preventing duplicate side-effects.
5. **Safe Acknowledgement**: Messages are acknowledged (`XACK`) **only after** successful execution. Failed messages remain in the Pending Entries List (PEL) for reclamation.

---

## 2. Infrastructure Configuration

Redis is configured for strict append-only persistence and zero data eviction:

```yaml
services:
  redis:
    image: redis:8.10.1-alpine
    container_name: clearshift-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--appendfsync", "everysec", "--maxmemory-policy", "noeviction"]
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
```

- `--appendonly yes`: Enables AOF (Append-Only File) logging.
- `--appendfsync everysec`: Syncs AOF buffer to disk every second, bounding data loss to at most 1 second of buffered writes on hard crash.
- `--maxmemory-policy noeviction`: Rejects writes when memory is exhausted rather than silently evicting unacknowledged stream entries.
- `redis_data:/data`: Durable Docker named volume ensuring state survives container restarts.

---

## 3. Failure Scenarios & Recovery Procedures

### Scenario A: Process Crashes After DB Commit but Before Publish
- **Problem**: Business mutation committed in PostgreSQL, but relay process dies before emitting `XADD` to Redis Streams.
- **Durability Guarantee**: The outbox record in `platform.outbox` has `published_at = NULL`.
- **Automatic Recovery**:
  1. The outbox relay uses optimistic claim locks (`locked_at`, `locked_by`) with a configurable timeout (default 30 seconds).
  2. Upon restart (or on the next poll cycle after 30s), the relay queries `claimPending()` with `(locked_at IS NULL OR locked_at < NOW() - 30s)`.
  3. The record is claimed and published to Redis Streams.
  4. On successful publish, `published_at` is set to `NOW()` and locks are cleared.

### Scenario B: Consumer Crashes Mid-Processing (PEL Recovery)
- **Problem**: A worker node receives an event via `XREADGROUP`, begins processing, and crashes before calling `XACK`.
- **Durability Guarantee**: The message is tracked in the Redis Streams Pending Entries List (PEL).
- **Automatic Recovery**:
  1. Surviving or replacement consumers run `reclaimPending()` periodically using `XAUTOCLAIM` with `minIdleTimeMs: 60000` (1 minute).
  2. Idle pending messages are reassigned to the active consumer.
  3. The consumer executes the idempotent handler. If already processed, it acknowledges and skips side effects; if unfinished, it executes side effects and acknowledges.

### Scenario C: Duplicate Delivery Handling
- **Problem**: Network retry causes the same event to be delivered twice to a consumer group.
- **Guarantee**: Consumers check `idempotencyStore.isProcessed(groupName, eventId)`.
- **Behavior**:
  - The second delivery detects `isProcessed === true`.
  - Side effects are **not executed**.
  - `XACK` is sent immediately to clear the message from the stream.

### Scenario D: Total Redis Loss & Rebuild Procedure
- **Problem**: Redis container, volume, or host is destroyed or corrupted.
- **Recovery Procedure**:
  1. Re-provision Redis container:
     ```bash
     docker compose -f infra/compose.yaml up -d redis
     ```
  2. Verify Redis health:
     ```bash
     docker exec -it clearshift-redis redis-cli ping
     # Output: PONG
     ```
  3. Initialize consumer groups:
     ```bash
     # Registered automatically on worker startup or via script:
     docker exec -it clearshift-redis redis-cli XGROUP CREATE clearshift.events crm-group $ MKSTREAM
     docker exec -it clearshift-redis redis-cli XGROUP CREATE clearshift.events hub-group $ MKSTREAM
     ```
  4. Replay retained events from PostgreSQL Outbox:
     ```typescript
     import { OutboxRelay } from "apps/hub/src/events/relay.js";
     
     const relay = new OutboxRelay(outboxRepo, redisStreams);
     const result = await relay.replayOutboxToRedis({ maxDays: 30 });
     console.log(`Replayed ${result.replayedCount} events to Redis.`);
     ```
  5. Consumers will consume the replayed events:
     - Already completed events are acknowledged with zero side-effects.
     - Unfinished/interrupted events are processed and completed.

---

## 4. Retention & Trimming Non-Negotiable Rules

1. **PostgreSQL Outbox Retention**:
   - V1 replay window is **30 days**.
   - **Never delete unpublished rows** (`published_at IS NULL`).
   - **Never delete rows younger than 30 days** (`createdAt > NOW() - 30 days`).
   - Automated purge runs:
     ```sql
     DELETE FROM platform.outbox
     WHERE published_at IS NOT NULL
       AND published_at <= NOW() - INTERVAL '30 days'
       AND created_at <= NOW() - INTERVAL '30 days';
     ```

2. **Redis Streams Trimming**:
   - `xtrimAcknowledged(streamKey, 30_DAYS, configuredGroups)`:
     - Checks all configured consumer groups.
     - Never trims messages in any group's PEL (`XPENDING`).
     - Never trims messages that have not yet been delivered to all consumer groups.
     - Trims only acknowledged messages older than 30 days.

---

## 5. Observability & Monitoring

Inspect stream status, consumer lag, and pending counts:

```bash
# Stream overview
docker exec -it clearshift-redis redis-cli XINFO STREAM clearshift.events

# Consumer groups and lag
docker exec -it clearshift-redis redis-cli XINFO GROUPS clearshift.events

# Pending messages for a group
docker exec -it clearshift-redis redis-cli XPENDING clearshift.events crm-group
```

Programmatic metrics via `IdempotentConsumer.getMetrics()`:
```typescript
const metrics = await consumer.getMetrics();
// {
//   streamKey: 'clearshift.events',
//   groupName: 'crm-group',
//   consumerName: 'worker-1',
//   streamLength: 1450,
//   pendingCount: 0,
//   lastDeliveredId: '1729000000000-0',
//   lag: 0
// }
```
