# Failure-Injection & Reliability Verification Report (PLT-09)

**Issue**: [#64 [PLT-09] Transactional outbox, Redis Streams relay and consumer recovery](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/64)  
**Date**: 2026-10-22  
**Test Suite**: `apps/hub/tests/events/recovery.test.ts`  
**Execution Status**: PASSED (6/6 tests passing)

---

## 1. Test Objectives & Non-Negotiable Requirements

Validate the transactional outbox pattern, Redis Streams relay, and idempotent consumer failure recovery under simulated process crashes, network duplications, consumer pod death, and catastrophic Redis data loss.

---

## 2. Failure-Injection Test Results

| Test Scenario | Injection Method | Expected Behavior | Observed Result | Status |
|---------------|------------------|-------------------|-----------------|--------|
| **1. Crash after DB commit before publish** | Transaction commits outbox record with `published_at = NULL`; relay process halted. | On restart, relay claims unpublished record with optimistic lock and publishes to Redis Streams. | Record published to `clearshift.events`, `published_at` set to timestamp, pending count drops to 0. | **PASSED** |
| **2. Duplicate event delivery** | Same `event_id` and envelope injected twice into Redis Stream. | Consumer checks `idempotencyStore.isProcessed(group, id)`. Second message acknowledged without executing side effects. | Side effect execution count remained exactly 1; second message acknowledged as `skipped_duplicate`. | **PASSED** |
| **3. Consumer crash mid-processing** | Consumer handler throws simulated crash error. | Message NOT acknowledged; remains in Redis Streams PEL (`pendingCount = 1`). Reclaimed after idle timeout and acknowledged upon recovery. | Initial batch failed; PEL retained message; `reclaimPending()` re-processed and successfully acknowledged; PEL cleared to 0. | **PASSED** |
| **4. Catastrophic Redis wipe & Rebuild** | `redis.clear()` wiped all Redis Streams memory. | `OutboxRelay.replayOutboxToRedis({ maxDays: 30 })` queries PostgreSQL outbox and restores stream with original `event_id`s. | All retained events replayed with original IDs; consumer consumed stream cleanly with zero data loss. | **PASSED** |
| **5. Stream retention & pending protection** | Stream contains unacknowledged/pending messages; `trimStream()` invoked. | Trimming must NEVER prune pending or undelivered entries. | 0 entries trimmed; all pending entries retained intact in stream. | **PASSED** |
| **6. PostgreSQL outbox retention policy** | Purge attempted with `< 30 days` or on unpublished rows. | Rejects purge younger than 30 days; preserves unpublished rows indefinitely. | Threw explicit error on `< 30 days`; preserved unpublished rows without deletion. | **PASSED** |

---

## 3. Toolchain & Infrastructure Verification

- **Node.js**: 24 LTS pinned patch.
- **TypeScript**: Strict mode with `exactOptionalPropertyTypes: true` passing with 0 errors.
- **Redis Configuration**:
  - Image: `redis:8.10.1-alpine`
  - Parameters: `--appendonly yes --appendfsync everysec --maxmemory-policy noeviction`
  - Mount: `redis_data:/data` (named volume).
- **PostgreSQL**: PostgreSQL 18.6 schema with `platform.outbox` and `platform.consumed_events`.
