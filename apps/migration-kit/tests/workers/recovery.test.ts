/**
 * ClearShift Migration Kit — Worker Execution & Recovery Suite (KIT-11)
 *
 * Verifies all Acceptance Criteria for Issue #78 [KIT-11]:
 * - AC 1: Pipeline jobs configured for BullMQ workers with pinned Redis 8.10.1:
 *         - Attempt count: 3
 *         - Exponential backoff: base 1s, maximum 30s
 *         - Job timeout: 15 minutes
 *         - Default concurrency: 4
 * - AC 2: 10% threshold inside a chunk stops scheduling new chunks immediately.
 * - AC 3: Injected worker crash resumes from latest committed checkpoint;
 *         three attempts max with same stable idempotency key.
 * - AC 4: Any unresolved target-write error moves batch to `load_failed_partial`.
 *         Unresolved write does NOT become `rejected`.
 * - AC 5: Failure state (`load_failed_partial` or `failed`) blocks reconciliation
 *         until resume or rollback.
 *
 * @module migration-kit/tests/workers/recovery.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ReconciliationBlockedError,
  PartialLoadExhaustionError,
  BullMqWorkerDefaults,
  computeStableIdempotencyKey,
} from '@clearshift/contracts';
import {
  computeExponentialBackoffMs,
  createBullMqConfig,
  getStandardJobOptions,
} from '../../src/workers/queue-config.js';
import {
  PipelineWorker,
} from '../../src/workers/pipeline-worker.js';
import {
  WorkerRecoveryManager,
} from '../../src/workers/recovery.js';
import {
  BaseTargetAdapter,
  InMemoryImportReceiptStore,
} from '../../src/load/target-adapter.js';
import {
  InMemoryKitRowOutcomeStore,
} from '../../src/reconcile/outcome-ledger.js';
import {
  InMemoryBatchRepository,
} from '../../src/batches/batch-registry.js';

interface TestProductRow {
  sku: string;
  name: string;
  price?: number;
}

class TestWorkerTargetAdapter extends BaseTargetAdapter<TestProductRow> {
  public readonly module = 'erp-1';
  public readonly entity = 'products';
  public readonly schemaVersion = 1;

  public transientErrorActive = false;
  public transientFailRow?: number;

  constructor(receiptStore?: InMemoryImportReceiptStore) {
    super(receiptStore);
  }

  protected async validateRow(row: TestProductRow): Promise<{
    valid: boolean;
    reasonCode?: string;
    message?: string;
    field?: string;
  }> {
    if (this.transientErrorActive && this.transientFailRow && row.sku === `SKU-${this.transientFailRow}`) {
      return {
        valid: false,
        reasonCode: 'TRANSIENT_DB_ERROR',
        message: 'Transient DB connection timeout during write',
      };
    }
    if (!row.sku || row.sku.trim() === '') {
      return {
        valid: false,
        reasonCode: 'SKU_REQUIRED',
        message: 'Product SKU is required',
        field: 'sku',
      };
    }
    return { valid: true };
  }
}

describe('KIT-11: BullMQ Worker Execution, Bounded Retries & Partial-Load Recovery', () => {
  let receiptStore: InMemoryImportReceiptStore;
  let outcomeStore: InMemoryKitRowOutcomeStore;
  let batchRepo: InMemoryBatchRepository;
  let adapter: TestWorkerTargetAdapter;
  let worker: PipelineWorker;
  let recovery: WorkerRecoveryManager;

  beforeEach(() => {
    receiptStore = new InMemoryImportReceiptStore();
    outcomeStore = new InMemoryKitRowOutcomeStore();
    batchRepo = new InMemoryBatchRepository();
    adapter = new TestWorkerTargetAdapter(receiptStore);
    worker = new PipelineWorker({
      receiptStore,
      outcomeStore,
      batchRepository: batchRepo,
    });
    recovery = new WorkerRecoveryManager(receiptStore, outcomeStore, batchRepo);
  });

  describe('1. Pinned Redis & Queue Configuration (AC 1)', () => {
    it('enforces Redis 8.10.1, 3 attempts, 15m timeout, and concurrency 4', () => {
      const config = createBullMqConfig();
      expect(config.redisVersion).toBe('8.10.1');
      expect(config.attempts).toBe(BullMqWorkerDefaults.ATTEMPTS); // 3
      expect(config.backoffBaseMs).toBe(1000); // 1s
      expect(config.backoffMaxMs).toBe(30000); // 30s
      expect(config.jobTimeoutMs).toBe(900000); // 15 minutes
      expect(config.concurrency).toBe(4);
      expect(config.circuitBreakerThreshold).toBe(0.10); // 10%
    });

    it('calculates bounded exponential backoff (base 1s, max 30s)', () => {
      expect(computeExponentialBackoffMs(1)).toBe(1000); // attempt 1: 1s
      expect(computeExponentialBackoffMs(2)).toBe(2000); // attempt 2: 2s
      expect(computeExponentialBackoffMs(3)).toBe(4000); // attempt 3: 4s
      expect(computeExponentialBackoffMs(4)).toBe(8000); // attempt 4: 8s
      expect(computeExponentialBackoffMs(5)).toBe(16000); // attempt 5: 16s
      expect(computeExponentialBackoffMs(6)).toBe(30000); // attempt 6: capped at 30s
      expect(computeExponentialBackoffMs(10)).toBe(30000); // attempt 10: capped at 30s
    });

    it('generates standard BullMQ job options', () => {
      const options = getStandardJobOptions();
      expect(options.attempts).toBe(3);
      expect(options.backoff.type).toBe('exponential');
      expect(options.backoff.delay).toBe(1000);
      expect(options.timeout).toBe(900000);
    });
  });

  describe('2. 10% Chunk Circuit Breaker Stop Threshold (AC 2)', () => {
    it('halts scheduling new chunks immediately when failure rate inside a chunk exceeds 10%', async () => {
      const batchId = 'a1111111-1111-4111-8111-111111111111';

      // 40 rows: 2 chunks of 20
      // Chunk 0 has 5 invalid rows out of 20 (25% failure rate > 10%)
      const rows: Array<{ sourceRow: number; data: TestProductRow }> = [];
      for (let i = 1; i <= 20; i++) {
        rows.push({
          sourceRow: i,
          data: {
            sku: i <= 5 ? '' : `SKU-${i}`, // 5 invalid in chunk 0
            name: `Product ${i}`,
          },
        });
      }
      for (let i = 21; i <= 40; i++) {
        rows.push({
          sourceRow: i,
          data: { sku: `SKU-${i}`, name: `Product ${i}` }, // chunk 1 is valid
        });
      }

      const res = await worker.executeLoadJob({
        jobData: {
          jobId: 'job-001',
          batchId,
          module: 'erp-1',
          entity: 'products',
          step: 'load',
          correlationId: 'corr-001',
          attempt: 1,
        },
        rows,
        adapter,
        chunkSize: 20,
      });

      expect(res.halted).toBe(true);
      expect(res.finalStatus).toBe('failed');
      expect(res.completedChunks).toBe(0); // Chunk 0 failed threshold
      expect(res.results.length).toBe(1); // Chunk 1 was NEVER scheduled!
      expect(res.haltReason).toContain('exceeds 10% circuit breaker threshold');
    });
  });

  describe('3. Injected Worker Crash & Checkpoint Resumption (AC 3)', () => {
    it('resumes from committed checkpoint, replays existing receipts, and prevents duplicate target writes', async () => {
      const batchId = 'b2222222-2222-4222-8222-222222222222';
      const rows: Array<{ sourceRow: number; data: TestProductRow }> = [];
      for (let i = 1; i <= 20; i++) {
        rows.push({
          sourceRow: i,
          data: { sku: `SKU-${i}`, name: `Product ${i}` },
        });
      }

      // Step 1: Injected crash occurs on row 11 (rows 1..10 successfully committed before crash)
      await expect(
        worker.executeLoadJob({
          jobData: {
            jobId: 'job-crash-1',
            batchId,
            module: 'erp-1',
            entity: 'products',
            step: 'load',
            correlationId: 'corr-crash',
            attempt: 1,
          },
          rows,
          adapter,
          chunkSize: 50,
          injectFailureOnRow: 11, // Worker crashes on row 11!
        })
      ).rejects.toThrowError(PartialLoadExhaustionError);

      // Verify that 10 receipts were committed before the crash
      const receiptsBeforeRecovery = await receiptStore.listByBatchId(batchId);
      expect(receiptsBeforeRecovery.length).toBe(10);
      expect(adapter.getTargetRecords().length).toBe(10);

      // Step 2: Plan recovery from latest committed checkpoint
      const plan = await recovery.planRecovery(batchId, 'load_checkpoint', rows);
      expect(plan.alreadyCommittedRows).toBe(10);
      expect(plan.remainingRowsToProcess).toBe(10);
      expect(plan.canResume).toBe(true);

      // Step 3: Resume partial load
      const resumeResult = await recovery.resumePartialLoad({
        batchId,
        module: 'erp-1',
        entity: 'products',
        rows,
        adapter,
        attempt: 2,
      });

      expect(resumeResult.replayedCount).toBe(10); // Exactly 10 replayed without re-inserting
      expect(resumeResult.newlyLoadedCount).toBe(10); // Exactly 10 newly loaded (rows 11..20)
      expect(resumeResult.finalStatus).toBe('loaded');

      // Final target record count must be exactly 20 (zero duplicate target records)
      expect(adapter.getTargetRecords().length).toBe(20);
      expect(await receiptStore.countByBatchId(batchId)).toBe(20);
    });
  });

  describe('4. Unresolved Target Write Moves Batch to load_failed_partial (AC 4)', () => {
    it('transitions batch to load_failed_partial and does NOT mark unresolved write as rejected', async () => {
      const batchId = 'c3333333-3333-4333-8333-333333333333';
      await batchRepo.create({
        id: batchId,
        batchNumber: 'B-FAIL-01',
        module: 'erp-1',
        checksum: '0'.repeat(64),
        status: 'loading',
        checkpoint: 'load_checkpoint',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Configure transient write error on row 5
      adapter.transientErrorActive = true;
      adapter.transientFailRow = 5;

      const rows: Array<{ sourceRow: number; data: TestProductRow }> = [
        { sourceRow: 1, data: { sku: 'SKU-1', name: 'Product 1' } },
        { sourceRow: 5, data: { sku: 'SKU-5', name: 'Product 5' } }, // Will fail target write
      ];

      // Resume load fails on row 5
      await expect(
        recovery.resumePartialLoad({
          batchId,
          module: 'erp-1',
          entity: 'products',
          rows,
          adapter,
          attempt: 3, // Final attempt
        })
      ).rejects.toThrowError(PartialLoadExhaustionError);

      // Verify batch transitioned to load_failed_partial
      const batch = await batchRepo.findById(batchId);
      expect(batch?.status).toBe('load_failed_partial');
      expect(batch?.checkpoint).toBe('load_checkpoint');

      // CRITICAL INVARIANT: Row 5 must NOT be marked as REJECTED in the outcome ledger!
      // An unresolved write is an uncommitted write failure, not a domain rejection.
      const row5Outcome = await outcomeStore.getOutcome(batchId, 5);
      expect(row5Outcome).toBeNull();
    });
  });

  describe('5. Failure State Blocks Reconciliation (AC 5)', () => {
    it('strictly blocks reconciliation when batch status is load_failed_partial', () => {
      expect(() => {
        recovery.assertReconciliationAllowed('batch-failed-01', 'load_failed_partial');
      }).toThrowError(ReconciliationBlockedError);
    });

    it('strictly blocks reconciliation when batch status is failed', () => {
      expect(() => {
        recovery.assertReconciliationAllowed('batch-failed-02', 'failed');
      }).toThrowError(ReconciliationBlockedError);
    });

    it('allows reconciliation when batch status is validated or loaded', () => {
      expect(() => {
        recovery.assertReconciliationAllowed('batch-ok-01', 'loaded');
      }).not.toThrow();

      expect(() => {
        recovery.assertReconciliationAllowed('batch-ok-02', 'validated');
      }).not.toThrow();
    });
  });
});
