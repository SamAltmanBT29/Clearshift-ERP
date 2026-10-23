/**
 * ERP-2 Vendors & Purchasing — Idempotent Retry & Partial-Load Stop Test Suite
 *
 * Verifies Acceptance Criteria for Issue #129 (ERP2-13 / KIT-12 / Sprint 4 Gate G4):
 *   1. Load operations process records in bounded chunks of 500 rows (CHUNK_SIZE = 500).
 *   2. Transient failures trigger bounded exponential backoff retries without corrupting idempotency keys.
 *   3. Batch execution stops immediately if row failures exceed 10% of attempted rows (> 0.10).
 *   4. Already committed rows and receipts remain durable; batch state transitions to STOPPED_EXCESSIVE_FAILURES.
 *   5. No rollback saga or destructive uncommitted data loss occurs.
 *
 * @module erp2/tests/migration/batch-retry-stop.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ReferenceResolver } from '@cs/kernel';
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MIN_ATTEMPTED_ROWS,
  DEFAULT_RETRY_CONFIG,
  assertNoRollbackSaga,
} from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { InMemoryErp2Repository } from '../../src/services/repository.js';
import { Erp2Service } from '../../src/services/erp2.service.js';
import { Erp2TargetAdapter, type BatchRowInput } from '../../src/migration/target-adapter.js';
import {
  chunkArray,
  calculateFailureRate,
  shouldHaltBatchExecution,
  isTransientFailure,
  executeWithRetry,
} from '../../src/migration/batch-runner.js';

class MockErp1Resolver implements ReferenceResolver {
  public validProducts = new Set<string>([
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
  ]);

  async exists(entityType: string, id: string): Promise<boolean> {
    if (entityType === 'product') {
      return this.validProducts.has(id);
    }
    return false;
  }

  async get<T = unknown>(_entityType: string, _id: string): Promise<T | null> {
    return null;
  }
}

describe('ERP-2 Idempotent Retry and Partial-Load Stop Behavior (ERP2-13 / Issue #129)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp2Repository;
  let resolver: MockErp1Resolver;
  let service: Erp2Service;

  beforeEach(() => {
    repo = new InMemoryErp2Repository(false); // clean repo with no seeded vendors
    resolver = new MockErp1Resolver();
    service = new Erp2Service({ repository: repo, referenceResolver: resolver });
    app = buildApp({ repository: repo, erp2Service: service, referenceResolver: resolver });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Chunking Behavior (CHUNK_SIZE = 500)
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. 500-Row Chunk Partition Boundaries', () => {
    it('partitions arrays into chunks of specified or default size', () => {
      expect(DEFAULT_CHUNK_SIZE).toBe(500);

      // Empty array
      expect(chunkArray([])).toEqual([]);

      // Array smaller than chunk size
      const small = [1, 2, 3];
      expect(chunkArray(small, 500)).toEqual([[1, 2, 3]]);

      // Exactly 500 elements
      const exact500 = Array.from({ length: 500 }, (_, i) => i);
      const exactChunks = chunkArray(exact500, 500);
      expect(exactChunks.length).toBe(1);
      expect(exactChunks[0]?.length).toBe(500);

      // 1,250 elements: partitions into [500, 500, 250]
      const items1250 = Array.from({ length: 1250 }, (_, i) => i);
      const chunks1250 = chunkArray(items1250, 500);
      expect(chunks1250.length).toBe(3);
      expect(chunks1250[0]?.length).toBe(500);
      expect(chunks1250[1]?.length).toBe(500);
      expect(chunks1250[2]?.length).toBe(250);
    });

    it('rejects non-positive chunk size', () => {
      expect(() => chunkArray([1, 2], 0)).toThrow(/positive integer/);
      expect(() => chunkArray([1, 2], -10)).toThrow(/positive integer/);
    });

    it('tracks chunksProcessed accurately during loadBatch', async () => {
      const adapter = new Erp2TargetAdapter(service, 'vendor');
      const batchId = '00000000-0000-0000-0000-000000000101';

      // 7 rows chunked into groups of 3 -> 3 chunks (3, 3, 1)
      const rows: BatchRowInput[] = Array.from({ length: 7 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `batch-chunk-key-${i}`,
        data: {
          name: `Vendor Chunk ${i}`,
          tax_number: `TAX-CHUNK-${i}`,
          email: `chunk${i}@example.com`,
          currency: 'USD',
        },
      }));

      const result = await adapter.loadBatch(batchId, rows, { chunkSize: 3 });
      expect(result.status).toBe('COMPLETED');
      expect(result.chunksProcessed).toBe(3);
      expect(result.total).toBe(7);
      expect(result.loaded).toBe(7);
      expect(result.rejected).toBe(0);
      expect(result.unattempted).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Transient Failure Detection & Bounded Exponential Retry
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Transient Failure Retry & Idempotency Key Preservation', () => {
    it('classifies transient errors accurately', () => {
      expect(isTransientFailure({ retryable: true })).toBe(true);
      expect(isTransientFailure({ statusCode: 503 })).toBe(true);
      expect(isTransientFailure({ statusCode: 504 })).toBe(true);
      expect(isTransientFailure({ code: 'ECONNRESET' })).toBe(true);
      expect(isTransientFailure({ code: 'ETIMEDOUT' })).toBe(true);
      expect(isTransientFailure({ code: '40P01' })).toBe(true); // PostgreSQL deadlock
      expect(isTransientFailure({ code: '57P01' })).toBe(true); // PostgreSQL admin shutdown
      expect(isTransientFailure(new Error('Connection econnreset by peer'))).toBe(true);
      expect(isTransientFailure(new Error('deadlock detected'))).toBe(true);

      // Deterministic domain errors MUST NOT be classified as transient
      expect(isTransientFailure({ statusCode: 400 })).toBe(false);
      expect(isTransientFailure({ statusCode: 409 })).toBe(false);
      expect(isTransientFailure({ statusCode: 422 })).toBe(false);
      expect(isTransientFailure({ code: 'VALIDATION_ERROR' })).toBe(false);
      expect(isTransientFailure(new Error('Invalid tax number'))).toBe(false);
      expect(isTransientFailure(null)).toBe(false);
    });

    it('retries transient failures with exponential backoff up to maxRetries', async () => {
      let callCount = 0;
      const retryDelays: number[] = [];

      const operation = vi.fn(async (attempt: number) => {
        callCount++;
        if (attempt < 3) {
          const err = new Error('Service Unavailable temporary glitch');
          (err as any).statusCode = 503;
          throw err;
        }
        return 'success';
      });

      const { result, attempts } = await executeWithRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffFactor: 2,
        onRetry: (_att, delay) => {
          retryDelays.push(delay);
        },
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
      expect(callCount).toBe(3);
      expect(retryDelays).toEqual([10, 20]); // 10ms (attempt 1), 20ms (attempt 2)
    });

    it('does not retry deterministic validation or business errors', async () => {
      let callCount = 0;
      const operation = vi.fn(async (_attempt: number) => {
        callCount++;
        const err = new Error('Validation failed');
        (err as any).statusCode = 400;
        throw err;
      });

      await expect(
        executeWithRetry(operation, {
          maxRetries: 3,
          initialDelayMs: 10,
        })
      ).rejects.toThrow('Validation failed');

      expect(callCount).toBe(1);
    });

    it('preserves the client idempotency key across transient retries in target adapter', async () => {
      const adapter = new Erp2TargetAdapter(service, 'vendor');
      const batchId = '00000000-0000-0000-0000-000000000102';
      const rowIdempotencyKey = 'stable-idempotency-key-xyz-123';

      let attemptCounter = 0;
      const capturedKeys: string[] = [];

      // Spy on importRow to verify key stability
      const originalImportRow = adapter.importRow.bind(adapter);
      vi.spyOn(adapter, 'importRow').mockImplementation(async (bId, rowNum, key, data, opts) => {
        attemptCounter++;
        capturedKeys.push(key);
        if (attemptCounter === 1) {
          const transientErr = new Error('Database deadlock detected 40P01');
          (transientErr as any).code = '40P01';
          throw transientErr;
        }
        return originalImportRow(bId, rowNum, key, data, opts);
      });

      const rows: BatchRowInput[] = [
        {
          sourceRow: 0,
          idempotencyKey: rowIdempotencyKey,
          data: {
            name: 'Transient Retried Vendor',
            tax_number: 'TAX-RETRY-01',
            email: 'retry@example.com',
          },
        },
      ];

      const result = await adapter.loadBatch(batchId, rows, {
        maxRetries: 3,
        initialDelayMs: 5,
        backoffFactor: 2,
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.loaded).toBe(1);
      expect(result.rows[0]?.outcome).toBe('loaded');
      expect(result.rows[0]?.attempts).toBe(2);

      // Verify that every attempt used the exact same unmutated idempotency key
      expect(capturedKeys).toEqual([rowIdempotencyKey, rowIdempotencyKey]);

      // Verify durable receipt exists with that exact idempotency key
      const receipt = await repo.getImportReceiptByKey(rowIdempotencyKey);
      expect(receipt).not.toBeNull();
      expect(receipt?.idempotency_key).toBe(rowIdempotencyKey);
      expect(receipt?.batch_id).toBe(batchId);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. 10% Failure Rate Stop Threshold Rule
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. 10% Stop Threshold Rule (> 0.10 of Attempted Rows)', () => {
    it('calculates failure rate correctly', () => {
      expect(calculateFailureRate(0, 10)).toBe(0);
      expect(calculateFailureRate(1, 10)).toBe(0.10);
      expect(calculateFailureRate(2, 10)).toBe(0.20);
      expect(calculateFailureRate(0, 0)).toBe(0);
    });

    it('requires minimum 10 attempted rows before evaluating stop threshold', () => {
      // 1 failure out of 2 attempted rows is 50%, but attempted=2 < 10 -> do not halt
      expect(shouldHaltBatchExecution(1, 2)).toBe(false);
      // 1 failure out of 9 attempted rows is 11.1%, but attempted=9 < 10 -> do not halt
      expect(shouldHaltBatchExecution(1, 9)).toBe(false);

      // Exactly 10 attempted: 1 failure / 10 = 10.0% -> <= 10% -> do not halt
      expect(shouldHaltBatchExecution(1, 10)).toBe(false);

      // Exactly 10 attempted: 2 failures / 10 = 20.0% -> > 10% -> HALT!
      expect(shouldHaltBatchExecution(2, 10)).toBe(true);

      // 11 attempted: 2 failures / 11 = 18.18% -> > 10% -> HALT!
      expect(shouldHaltBatchExecution(2, 11)).toBe(true);
    });

    it('halts batch execution immediately when row failure rate exceeds 10%', async () => {
      const adapter = new Erp2TargetAdapter(service, 'vendor');
      const batchId = '00000000-0000-0000-0000-000000000103';

      // Construct 20 rows:
      // Rows 0-7: valid (8 loaded)
      // Rows 8-9: invalid (2 rejected)
      // At row 9: attempted = 10, rejected = 2 (20% > 10%) -> HALT!
      // Rows 10-19: remaining unattempted (10 unattempted)
      const rows: BatchRowInput[] = Array.from({ length: 20 }, (_, i) => {
        const isInvalid = i === 8 || i === 9;
        return {
          sourceRow: i,
          idempotencyKey: `halt-test-key-${i}`,
          data: isInvalid
            ? {
                name: '', // triggers ValidationError (name min 1 char)
                tax_number: 'INVALID',
                email: 'not-an-email',
              }
            : {
                name: `Valid Vendor ${i}`,
                tax_number: `TAX-VALID-${i}`,
                email: `vendor${i}@example.com`,
              },
        };
      });

      const result = await adapter.loadBatch(batchId, rows, {
        chunkSize: 500,
        failureThreshold: 0.10,
        minAttemptedRows: 10,
      });

      expect(result.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(result.total).toBe(20);
      expect(result.attempted).toBe(10);
      expect(result.loaded).toBe(8);
      expect(result.rejected).toBe(2);
      expect(result.unattempted).toBe(10);
      expect(result.stoppedReason).toContain('exceeded the 10% threshold');

      // Reconciliation Invariant: total = loaded + rejected + unattempted
      expect(result.total).toBe(result.loaded + result.rejected + result.unattempted);

      // Verify row-level outcomes:
      // First 8 rows loaded
      for (let i = 0; i < 8; i++) {
        expect(result.rows[i]?.outcome).toBe('loaded');
      }
      // Rows 8 and 9 rejected
      expect(result.rows[8]?.outcome).toBe('rejected');
      expect(result.rows[9]?.outcome).toBe('rejected');

      // Rows 10-19 unattempted
      for (let i = 10; i < 20; i++) {
        expect(result.rows[i]?.outcome).toBe('unattempted');
        expect(result.rows[i]?.result).toBeUndefined();
      }
    });

    it('halts across chunk boundaries without attempting subsequent chunks', async () => {
      const adapter = new Erp2TargetAdapter(service, 'vendor');
      const batchId = '00000000-0000-0000-0000-000000000104';

      // 15 rows total, chunkSize = 5 (3 chunks total)
      // Chunk 1 (rows 0-4): 5 valid
      // Chunk 2 (rows 5-9): 3 valid, 2 invalid (rows 8, 9).
      // At row 9: attempted = 10, rejected = 2 (20% > 10%) -> HALT!
      // Chunk 3 (rows 10-14): should NEVER be processed (remains unattempted)
      const rows: BatchRowInput[] = Array.from({ length: 15 }, (_, i) => {
        const isInvalid = i === 8 || i === 9;
        return {
          sourceRow: i,
          idempotencyKey: `chunk-halt-key-${i}`,
          data: isInvalid
            ? { name: '', tax_number: 'BAD', email: 'bad' }
            : { name: `Chunk Vendor ${i}`, tax_number: `TAX-C-${i}`, email: `c${i}@example.com` },
        };
      });

      const result = await adapter.loadBatch(batchId, rows, {
        chunkSize: 5,
        minAttemptedRows: 10,
        failureThreshold: 0.10,
      });

      expect(result.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(result.chunksProcessed).toBe(2); // Only chunk 1 and chunk 2 were touched
      expect(result.loaded).toBe(8);
      expect(result.rejected).toBe(2);
      expect(result.unattempted).toBe(5);
      expect(result.total).toBe(15);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Durability & Idempotent Resumption
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Durable Committed Records & Idempotent Replay / Resumption', () => {
    it('guarantees committed records remain durable after a batch halts', async () => {
      const adapter = new Erp2TargetAdapter(service, 'vendor');
      const batchId = '00000000-0000-0000-0000-000000000105';

      const rows: BatchRowInput[] = Array.from({ length: 12 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `durable-test-key-${i}`,
        data:
          i >= 8
            ? { name: '', tax_number: 'BAD', email: 'bad' } // rows 8, 9, 10, 11 invalid
            : { name: `Durable Vendor ${i}`, tax_number: `TAX-DUR-${i}`, email: `d${i}@test.com` },
      }));

      const result = await adapter.loadBatch(batchId, rows, {
        minAttemptedRows: 10,
        failureThreshold: 0.10,
      });

      expect(result.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(result.loaded).toBe(8);

      // Verify that all 8 committed vendors exist in the repository
      const { vendors, total } = await repo.listVendors({ page: 1, pageSize: 20 });
      expect(total).toBe(8);
      for (let i = 0; i < 8; i++) {
        const found = vendors.find((v) => v.tax_number === `TAX-DUR-${i}`);
        expect(found).toBeDefined();
        expect(found?.name).toBe(`Durable Vendor ${i}`);

        // Durable receipt also exists
        const receipt = await repo.getImportReceiptByKey(`durable-test-key-${i}`);
        expect(receipt).not.toBeNull();
      }
    });

    it('supports idempotent resumption: replaying the batch skips committed rows safely', async () => {
      const adapter = new Erp2TargetAdapter(service, 'vendor');
      const batchId = '00000000-0000-0000-0000-000000000106';

      // 12 rows: initial run halts at row 9 because rows 8 and 9 fail
      const initialRows: BatchRowInput[] = Array.from({ length: 12 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `resumption-key-${i}`,
        data:
          i === 8 || i === 9
            ? { name: '', tax_number: 'BAD', email: 'bad' }
            : { name: `Resumed Vendor ${i}`, tax_number: `TAX-RES-${i}`, email: `res${i}@test.com` },
      }));

      // Initial run halts
      const run1 = await adapter.loadBatch(batchId, initialRows, {
        minAttemptedRows: 10,
        failureThreshold: 0.10,
      });
      expect(run1.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(run1.loaded).toBe(8);

      // Correct rows 8 and 9 in source data
      const correctedRows: BatchRowInput[] = Array.from({ length: 12 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `resumption-key-${i}`, // exact same keys
        data: {
          name: `Resumed Vendor ${i}`,
          tax_number: `TAX-RES-${i}`,
          email: `res${i}@test.com`,
        },
      }));

      // Second run: replay batch
      const run2 = await adapter.loadBatch(batchId, correctedRows, {
        minAttemptedRows: 10,
        failureThreshold: 0.10,
      });

      expect(run2.status).toBe('COMPLETED');
      expect(run2.loaded).toBe(12);
      expect(run2.rejected).toBe(0);
      expect(run2.unattempted).toBe(0);

      // Verify that rows 0-7 returned prior_result = true
      for (let i = 0; i < 8; i++) {
        expect(run2.rows[i]?.outcome).toBe('loaded');
        expect(run2.rows[i]?.result?.priorResult).toBe(true);
      }
      // Verify rows 8-11 were freshly loaded
      for (let i = 8; i < 12; i++) {
        expect(run2.rows[i]?.outcome).toBe('loaded');
        expect(run2.rows[i]?.result?.priorResult).toBe(false);
      }

      // Assert no duplicate vendor records in repository: total must be exactly 12
      const { total } = await repo.listVendors({ page: 1, pageSize: 50 });
      expect(total).toBe(12);
    });

    it('strictly forbids compensating rollback sagas in V1', () => {
      // assertNoRollbackSaga() succeeds in normal execution
      expect(() => assertNoRollbackSaga()).not.toThrow();

      // Ensure that when called with an invalid flag, it throws an error
      expect(() => assertNoRollbackSaga('ROLLBACK' as any)).toThrow(
        /Compensating rollback sagas are strictly out of scope/
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Fastify Route Integration: POST /api/v1/erp-vendors/import/batch
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Fastify HTTP POST /import/batch Integration', () => {
    it('executes batch import with chunking and stops on excessive failure threshold', async () => {
      const batchId = '00000000-0000-0000-0000-000000000107';

      // 12 rows: 8 valid, 2 invalid, 2 unattempted
      const rows = Array.from({ length: 12 }, (_, i) => ({
        source_row: i,
        idempotency_key: `http-batch-key-${i}`,
        record:
          i === 8 || i === 9
            ? { name: '', tax_number: 'BAD', email: 'bad' }
            : { name: `HTTP Vendor ${i}`, tax_number: `TAX-HTTP-${i}`, email: `http${i}@test.com` },
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import/batch',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer valid-test-token',
        },
        payload: {
          batch_id: batchId,
          entity: 'vendor',
          chunk_size: 500,
          failure_threshold: 0.10,
          min_attempted_rows: 10,
          rows,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.batchId).toBe(batchId);
      expect(body.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(body.total).toBe(12);
      expect(body.attempted).toBe(10);
      expect(body.loaded).toBe(8);
      expect(body.rejected).toBe(2);
      expect(body.unattempted).toBe(2);
      expect(body.stoppedReason).toContain('exceeded the 10% threshold');
      expect(body.rows.length).toBe(12);

      // Verify unattempted rows
      expect(body.rows[10].outcome).toBe('unattempted');
      expect(body.rows[11].outcome).toBe('unattempted');
    });

    it('completes successfully when failure rate remains within threshold', async () => {
      const batchId = '00000000-0000-0000-0000-000000000108';

      // 12 rows: 11 valid, 1 invalid (1/12 = 8.33% <= 10%)
      const rows = Array.from({ length: 12 }, (_, i) => ({
        source_row: i,
        idempotency_key: `http-pass-key-${i}`,
        record:
          i === 11
            ? { name: '', tax_number: 'BAD', email: 'bad' }
            : { name: `Pass Vendor ${i}`, tax_number: `TAX-PASS-${i}`, email: `pass${i}@test.com` },
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import/batch',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer valid-test-token',
        },
        payload: {
          batch_id: batchId,
          entity: 'vendor',
          failure_threshold: 0.10,
          min_attempted_rows: 10,
          rows,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.status).toBe('COMPLETED');
      expect(body.total).toBe(12);
      expect(body.attempted).toBe(12);
      expect(body.loaded).toBe(11);
      expect(body.rejected).toBe(1);
      expect(body.unattempted).toBe(0);
      expect(body.stoppedReason).toBeNull();
    });
  });
});
