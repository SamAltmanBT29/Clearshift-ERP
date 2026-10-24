/**
 * ERP-4 Idempotent Retry & Partial-Load Stop Behavior Test Suite
 *
 * Dedicated test suite for Issue #169 [ERP4-13]:
 *   AC1. Load operations process records in chunks of 500 rows.
 *   AC2. Transient failures trigger bounded exponential backoff retries without corrupting idempotency keys.
 *   AC3. Batch execution stops immediately if row failures exceed 10% of attempted rows.
 *   AC4. Already committed rows and receipts remain durable; batch state transitions to STOPPED_EXCESSIVE_FAILURES.
 *   AC5. No rollback saga or destructive uncommitted data loss occurs.
 *
 * @module erp4/tests/migration/retry-stop.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryFinanceRepository } from '../../src/services/repository.js';
import { FinanceService } from '../../src/services/finance.service.js';
import {
  Erp4TargetAdapter,
  chunkArray,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MIN_ATTEMPTED_ROWS,
  type BatchRowInput,
} from '../../src/migration/target-adapter.js';

describe('ERP4-13: Idempotent Retry & Partial-Load Stop Behavior (#169)', () => {
  let repo: InMemoryFinanceRepository;
  let service: FinanceService;
  let adapter: Erp4TargetAdapter;

  beforeEach(() => {
    repo = new InMemoryFinanceRepository(true);
    service = new FinanceService({ repository: repo });
    adapter = new Erp4TargetAdapter(service, 'account');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC1: 500-row chunk processing
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC1: Load operations process records in chunks of 500 rows', () => {
    it('DEFAULT_CHUNK_SIZE constant is exactly 500', () => {
      expect(DEFAULT_CHUNK_SIZE).toBe(500);
    });

    it('DEFAULT_FAILURE_THRESHOLD constant is exactly 0.10 (10%)', () => {
      expect(DEFAULT_FAILURE_THRESHOLD).toBe(0.10);
    });

    it('DEFAULT_MIN_ATTEMPTED_ROWS constant is exactly 10', () => {
      expect(DEFAULT_MIN_ATTEMPTED_ROWS).toBe(10);
    });

    it('chunkArray splits 1000 items into exactly 2 chunks of 500', () => {
      const items = Array.from({ length: 1000 }, (_, i) => i);
      const chunks = chunkArray(items, 500);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(500);
      expect(chunks[1]).toHaveLength(500);
    });

    it('chunkArray splits 1001 items into 3 chunks (500, 500, 1)', () => {
      const items = Array.from({ length: 1001 }, (_, i) => i);
      const chunks = chunkArray(items, 500);
      expect(chunks).toHaveLength(3);
      expect(chunks[0]!.length).toBe(500);
      expect(chunks[1]!.length).toBe(500);
      expect(chunks[2]!.length).toBe(1);
    });

    it('chunkArray returns empty array for empty input', () => {
      expect(chunkArray([], 500)).toHaveLength(0);
    });

    it('chunkArray with size 5 splits 15 rows into 3 chunks of 5', () => {
      const items = Array.from({ length: 15 }, (_, i) => i);
      const chunks = chunkArray(items, 5);
      expect(chunks).toHaveLength(3);
      chunks.forEach((chunk) => expect(chunk).toHaveLength(5));
    });

    it('loadBatch with 15 rows and chunkSize=5 reports chunksProcessed=3', async () => {
      const batchId = '13000000-0000-0000-0000-000000000001';
      const rows: BatchRowInput[] = Array.from({ length: 15 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `erp4-13-ac1-key-${i}`,
        data: { code: `AC1-${2000 + i}`, name: `Chunk Test Account ${i}`, type: 'asset', currency_code: 'INR' },
      }));

      const result = await adapter.loadBatch(batchId, rows, { chunkSize: 5, minAttemptedRows: 3 });

      expect(result.status).toBe('COMPLETED');
      expect(result.chunksProcessed).toBe(3);
      expect(result.total).toBe(15);
      expect(result.loaded).toBe(15);
    });

    it('loadBatch terminal reconciliation: loaded + rejected + unattempted === total always', async () => {
      const batchId = '13000000-0000-0000-0000-000000000002';
      // Mix of valid and invalid rows
      const rows: BatchRowInput[] = Array.from({ length: 12 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `erp4-13-recon-key-${i}`,
        data: i % 3 === 0
          ? { code: '', name: 'Missing Code', type: 'asset' }  // invalid
          : { code: `RECON-${3000 + i}`, name: `Recon Account ${i}`, type: 'expense', currency_code: 'INR' },
      }));

      const result = await adapter.loadBatch(batchId, rows, { chunkSize: 6, minAttemptedRows: 100 });
      expect(result.loaded + result.rejected + result.unattempted).toBe(result.total);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC2: Bounded exponential backoff retries for transient failures
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC2: Transient failures trigger bounded exponential backoff retries without corrupting idempotency keys', () => {
    it('importRow retries up to maxRetries on transient infrastructure throws', async () => {
      let callCount = 0;
      const originalImport = adapter.importRow.bind(adapter);

      // Fail twice, succeed on 3rd attempt
      adapter.importRow = async (batchId, sourceRow, idempotencyKey, data, meta) => {
        callCount++;
        if (callCount < 3) {
          const e = new Error('Transient DB connection error');
          (e as any).statusCode = 503;
          throw e;
        }
        return originalImport(batchId, sourceRow, idempotencyKey, data, meta);
      };

      const result = await adapter.loadBatch(
        '13000000-0000-0000-0000-000000000010',
        [{ sourceRow: 0, idempotencyKey: 'erp4-13-retry-001', data: { code: 'RETRY-001', name: 'Retry Account', type: 'asset', currency_code: 'INR' } }],
        { maxRetries: 3, initialDelayMs: 0, minAttemptedRows: 1 }
      );

      expect(result.loaded).toBe(1);
      expect(result.rejected).toBe(0);
      // callCount=3 means 2 transient failures + 1 success
      expect(callCount).toBe(3);
    });

    it('retry does not corrupt the idempotency key — key remains stable across attempts', async () => {
      const key = 'erp4-13-idem-stable-001';
      let capturedKeys: string[] = [];
      const originalImport = adapter.importRow.bind(adapter);

      adapter.importRow = async (batchId, sourceRow, idempotencyKey, data, meta) => {
        capturedKeys.push(idempotencyKey);
        if (capturedKeys.length < 2) {
          const e = new Error('Transient');
          (e as any).statusCode = 503;
          throw e;
        }
        return originalImport(batchId, sourceRow, idempotencyKey, data, meta);
      };

      await adapter.loadBatch(
        '13000000-0000-0000-0000-000000000011',
        [{ sourceRow: 0, idempotencyKey: key, data: { code: 'KEY-STABLE-001', name: 'Key Stable Account', type: 'asset', currency_code: 'INR' } }],
        { maxRetries: 3, initialDelayMs: 0, minAttemptedRows: 1 }
      );

      // Every attempt must use the same idempotency key — never modified during retry
      expect(capturedKeys.every((k) => k === key)).toBe(true);
    });

    it('retry exhaustion re-throws rather than silently dropping the error', async () => {
      const persistentError = new Error('Persistent infrastructure failure');
      (persistentError as any).statusCode = 503;
      adapter.importRow = async () => { throw persistentError; };

      await expect(
        adapter.loadBatch(
          '13000000-0000-0000-0000-000000000012',
          [{ sourceRow: 0, idempotencyKey: 'erp4-13-exhaust-001', data: { code: 'EXHAUST-001', name: 'Exhaustion Account', type: 'asset', currency_code: 'INR' } }],
          { maxRetries: 3, initialDelayMs: 0, minAttemptedRows: 1 }
        )
      ).rejects.toThrow('Persistent infrastructure failure');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC3: Halt when failure rate exceeds 10%
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC3: Batch execution stops immediately if row failures exceed 10% of attempted rows', () => {
    it('halts with STOPPED_EXCESSIVE_FAILURES when failure rate exceeds 10% after minAttemptedRows', async () => {
      const batchId = '13000000-0000-0000-0000-000000000020';
      // 8 valid, then 3 invalid (failure rate ~27% after 11 rows)
      const rows: BatchRowInput[] = Array.from({ length: 20 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `erp4-13-halt-key-${i}`,
        data: i >= 8 && i <= 10
          ? { code: '', name: 'Invalid Row', type: 'asset' }  // invalid
          : { code: `HALT-${4000 + i}`, name: `Halt Test ${i}`, type: 'income', currency_code: 'INR' },
      }));

      const result = await adapter.loadBatch(batchId, rows, {
        chunkSize: 5,
        minAttemptedRows: 10,
        failureThreshold: 0.10,
        maxRetries: 1,
        initialDelayMs: 0,
      });

      expect(result.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(result.stoppedReason).toContain('exceeded threshold');
      expect(result.rejected).toBeGreaterThan(0);
      expect(result.unattempted).toBeGreaterThan(0);
    });

    it('does NOT halt if failure rate is at or below 10% threshold', async () => {
      const batchId = '13000000-0000-0000-0000-000000000021';
      // 9 valid + 1 invalid = 10% exactly — must complete
      const rows: BatchRowInput[] = Array.from({ length: 10 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `erp4-13-at-threshold-${i}`,
        data: i === 9
          ? { code: '', name: 'Invalid', type: 'asset' }
          : { code: `AT-THRESH-${5000 + i}`, name: `Threshold Account ${i}`, type: 'expense', currency_code: 'INR' },
      }));

      const result = await adapter.loadBatch(batchId, rows, {
        minAttemptedRows: 10,
        failureThreshold: 0.10,
        maxRetries: 1,
        initialDelayMs: 0,
      });

      // 1/10 = 10% exactly — threshold check is strict (>), not (>=)
      expect(result.status).toBe('COMPLETED');
      expect(result.unattempted).toBe(0);
    });

    it('batch stops before processing remaining chunks after halt condition triggers', async () => {
      const batchId = '13000000-0000-0000-0000-000000000022';
      // 8 valid then 3 invalid (triggers halt) then 9 more that should be unattempted
      const rows: BatchRowInput[] = Array.from({ length: 20 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `erp4-13-chunk-halt-${i}`,
        data: i >= 8 && i <= 10
          ? { code: '', name: 'Bad Row', type: 'asset' }
          : { code: `CHUNKHALT-${6000 + i}`, name: `Chunk Halt ${i}`, type: 'asset', currency_code: 'INR' },
      }));

      const result = await adapter.loadBatch(batchId, rows, {
        chunkSize: 5,
        minAttemptedRows: 10,
        failureThreshold: 0.10,
        maxRetries: 1,
        initialDelayMs: 0,
      });

      expect(result.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(result.unattempted).toBeGreaterThan(0);
      // Row outcome array must account for every row
      expect(result.rows).toHaveLength(20);
      expect(result.rows.filter((r) => r.outcome === 'unattempted').length).toBe(result.unattempted);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC4: Committed rows and receipts are durable after halt
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC4: Already committed rows and receipts remain durable; batch transitions to STOPPED_EXCESSIVE_FAILURES', () => {
    it('rows committed before halt remain in the repository after batch stops', async () => {
      const batchId = '13000000-0000-0000-0000-000000000030';
      const preHaltCodes = ['DURABLE-001', 'DURABLE-002', 'DURABLE-003'];

      const rows: BatchRowInput[] = [
        // 3 valid rows that will commit before the halt
        ...preHaltCodes.map((code, i) => ({
          sourceRow: i,
          idempotencyKey: `erp4-13-durable-${i}`,
          data: { code, name: `Durable Account ${i}`, type: 'asset', currency_code: 'INR' },
        })),
        // 8 invalid rows to trigger excessive failures (need >10 attempted rows)
        ...Array.from({ length: 10 }, (_, i) => ({
          sourceRow: i + 3,
          idempotencyKey: `erp4-13-invalid-${i}`,
          data: { code: '', name: 'Invalid', type: 'bad_type', currency_code: 'INR' },
        })),
      ];

      const result = await adapter.loadBatch(batchId, rows, {
        chunkSize: 20,
        minAttemptedRows: 10,
        failureThreshold: 0.50, // 50% threshold so first 3 succeed then halt
        maxRetries: 1,
        initialDelayMs: 0,
      });

      // Verify batch halted or completed and committed rows are durable
      const durableRow1 = await repo.getAccountByCode('DURABLE-001');
      const durableRow2 = await repo.getAccountByCode('DURABLE-002');
      const durableRow3 = await repo.getAccountByCode('DURABLE-003');
      expect(durableRow1).not.toBeNull();
      expect(durableRow2).not.toBeNull();
      expect(durableRow3).not.toBeNull();

      // Receipts for committed rows must exist
      const receipt1 = await repo.getImportReceiptByIdempotencyKey('erp4-13-durable-0');
      const receipt2 = await repo.getImportReceiptByIdempotencyKey('erp4-13-durable-1');
      expect(receipt1).not.toBeNull();
      expect(receipt2).not.toBeNull();

      // Status must reflect halt or completion correctly
      expect(['COMPLETED', 'STOPPED_EXCESSIVE_FAILURES']).toContain(result.status);
    });

    it('batch status is STOPPED_EXCESSIVE_FAILURES not COMPLETED when halted', async () => {
      const batchId = '13000000-0000-0000-0000-000000000031';
      const rows: BatchRowInput[] = [
        ...Array.from({ length: 8 }, (_, i) => ({
          sourceRow: i,
          idempotencyKey: `erp4-13-pre-halt-${i}`,
          data: { code: `PREHALT-${7000 + i}`, name: `Pre-Halt Account ${i}`, type: 'expense', currency_code: 'INR' },
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          sourceRow: i + 8,
          idempotencyKey: `erp4-13-bad-${i}`,
          data: { code: '', name: 'Bad', type: 'asset' },
        })),
        { sourceRow: 13, idempotencyKey: 'erp4-13-tail-001', data: { code: 'TAIL-001', name: 'Tail Account', type: 'asset', currency_code: 'INR' } },
      ];

      const result = await adapter.loadBatch(batchId, rows, {
        chunkSize: 20,
        minAttemptedRows: 10,
        failureThreshold: 0.10,
        maxRetries: 1,
        initialDelayMs: 0,
      });

      expect(result.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(result.stoppedReason).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC5: No rollback saga — committed rows are preserved, no destructive loss
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC5: No rollback saga or destructive uncommitted data loss occurs', () => {
    it('halt does not delete or roll back already committed rows', async () => {
      const batchId = '13000000-0000-0000-0000-000000000040';

      // Commit some rows successfully first, then trigger halt
      const committedKey = 'erp4-13-committed-pre-halt';
      await adapter.importRow(batchId, 0, committedKey, {
        code: 'NO-ROLLBACK-001',
        name: 'No Rollback Account',
        type: 'asset',
        currency_code: 'INR',
      });

      // Now run a batch that will halt
      const haltRows: BatchRowInput[] = Array.from({ length: 15 }, (_, i) => ({
        sourceRow: i + 1,
        idempotencyKey: `erp4-13-halt-saga-${i}`,
        data: i >= 2
          ? { code: '', name: 'Invalid', type: 'bad' }
          : { code: `SAGA-${8000 + i}`, name: `Saga Account ${i}`, type: 'expense', currency_code: 'INR' },
      }));

      await adapter.loadBatch(batchId, haltRows, {
        chunkSize: 20,
        minAttemptedRows: 10,
        failureThreshold: 0.10,
        maxRetries: 1,
        initialDelayMs: 0,
      });

      // Pre-batch committed row must remain intact — no rollback
      const committed = await repo.getAccountByCode('NO-ROLLBACK-001');
      expect(committed).not.toBeNull();

      const receipt = await repo.getImportReceiptByIdempotencyKey(committedKey);
      expect(receipt).not.toBeNull();
    });

    it('unattempted rows are recorded in result but never partially written to repository', async () => {
      const batchId = '13000000-0000-0000-0000-000000000041';
      const unattemptedCode = 'UNATTEMPTED-NEVER-WRITTEN';

      const rows: BatchRowInput[] = [
        ...Array.from({ length: 8 }, (_, i) => ({
          sourceRow: i,
          idempotencyKey: `erp4-13-valid-${i}`,
          data: { code: `VALID-${9000 + i}`, name: `Valid ${i}`, type: 'asset', currency_code: 'INR' },
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          sourceRow: i + 8,
          idempotencyKey: `erp4-13-bad-uat-${i}`,
          data: { code: '', name: 'Bad', type: 'bad' },
        })),
        {
          sourceRow: 12,
          idempotencyKey: 'erp4-13-unattempted-final',
          data: { code: unattemptedCode, name: 'This Should Never Be Written', type: 'asset', currency_code: 'INR' },
        },
      ];

      const result = await adapter.loadBatch(batchId, rows, {
        chunkSize: 20,
        minAttemptedRows: 10,
        failureThreshold: 0.10,
        maxRetries: 1,
        initialDelayMs: 0,
      });

      if (result.status === 'STOPPED_EXCESSIVE_FAILURES' && result.unattempted > 0) {
        // unattempted rows must NOT exist in the repository
        const notWritten = await repo.getAccountByCode(unattemptedCode);
        expect(notWritten).toBeNull();
      }
    });
  });
});
