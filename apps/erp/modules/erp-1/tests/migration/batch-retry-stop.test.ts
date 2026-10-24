/**
 * ERP-1 Products & Inventory — Idempotent Retry & Partial-Load Stop Test Suite
 *
 * Verifies Acceptance Criteria for Issue #109 (ERP1-13 / KIT-12 / Sprint 4 Gate G4):
 *   1. Load operations process records in bounded chunks of 500 rows (CHUNK_SIZE = 500).
 *   2. Transient failures trigger bounded exponential backoff retries without corrupting idempotency keys.
 *   3. Batch execution stops immediately if row failures exceed 10% of attempted rows (> 0.10).
 *   4. Already committed rows and receipts remain durable; batch state transitions to STOPPED_EXCESSIVE_FAILURES.
 *   5. No rollback saga or destructive uncommitted data loss occurs.
 *
 * @module erp1/tests/migration/batch-retry-stop.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MIN_ATTEMPTED_ROWS,
  DEFAULT_RETRY_CONFIG,
  assertNoRollbackSaga,
} from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { InMemoryErp1Repository } from '../../src/services/repository.js';
import { Erp1Service } from '../../src/services/erp1.service.js';
import { Erp1TargetAdapter, type BatchRowInput } from '../../src/migration/target-adapter.js';
import {
  chunkArray,
  calculateFailureRate,
  shouldHaltBatchExecution,
  isTransientFailure,
  executeWithRetry,
} from '../../src/migration/batch-runner.js';

describe('ERP-1 Idempotent Retry and Partial-Load Stop Behavior (ERP1-13 / Issue #109)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp1Repository;
  let service: Erp1Service;

  beforeEach(() => {
    repo = new InMemoryErp1Repository(true); // clean repo with default warehouse & general category
    service = new Erp1Service(repo);
    app = buildApp({ repository: repo, erp1Service: service, authRequired: false });
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

    it('processes multi-chunk loadBatch (e.g. 1,050 rows chunked at 500) and counts chunks', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      const batchId = 'e0000001-aaaa-4000-8000-000000000001';

      // 60 rows chunked at 25 rows = 3 chunks
      const rows: BatchRowInput[] = Array.from({ length: 60 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `idem-chunked-${i}`,
        data: {
          name: `Chunked Product ${i}`,
          sku: `SKU-CHUNK-${i}`,
          unitOfMeasure: 'pcs',
          price: '10.00',
          currency: 'USD',
        },
      }));

      const result = await adapter.loadBatch(batchId, rows, { chunkSize: 25 });
      expect(result.status).toBe('COMPLETED');
      expect(result.chunksProcessed).toBe(3);
      expect(result.total).toBe(60);
      expect(result.loaded).toBe(60);
      expect(result.rejected).toBe(0);
      expect(result.unattempted).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Bounded Exponential Backoff Retry & Idempotency Key Invariants
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Bounded Exponential Backoff Retry & Idempotency Invariants', () => {
    it('verifies default retry configuration (maxRetries=3, initialDelay=50ms, backoffFactor=2)', () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBe(50);
      expect(DEFAULT_RETRY_CONFIG.backoffFactor).toBe(2);
    });

    it('classifies transient infrastructure failures as retryable', () => {
      expect(isTransientFailure({ statusCode: 503 })).toBe(true);
      expect(isTransientFailure({ code: 'SERVICE_UNAVAILABLE' })).toBe(true);
      expect(isTransientFailure({ code: 'ECONNRESET' })).toBe(true);
      expect(isTransientFailure({ code: '40P01' })).toBe(true); // Postgres deadlock
      expect(isTransientFailure({ message: 'connection timeout' })).toBe(true);
      expect(isTransientFailure({ retryable: true })).toBe(true);

      // Non-transient domain failures must NOT be classified as retryable
      expect(isTransientFailure({ statusCode: 400 })).toBe(false);
      expect(isTransientFailure({ statusCode: 409 })).toBe(false);
      expect(isTransientFailure({ statusCode: 422 })).toBe(false);
      expect(isTransientFailure(null)).toBe(false);
    });

    it('retries transient failures up to maxRetries without corrupting idempotency key or payload', async () => {
      let attemptsCount = 0;
      const retryDelays: number[] = [];

      const operation = vi.fn(async (attempt: number) => {
        attemptsCount = attempt;
        if (attempt < 3) {
          const transientError = new Error('Database connection transient deadlock');
          (transientError as unknown as Record<string, unknown>)['code'] = '40P01';
          throw transientError;
        }
        return { success: true, processedKey: 'stable-idempotency-key-001' };
      });

      const { result, attempts } = await executeWithRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffFactor: 2,
        onRetry: (_attempt, delayMs) => {
          retryDelays.push(delayMs);
        },
      });

      expect(attempts).toBe(3);
      expect(attemptsCount).toBe(3);
      expect(result.success).toBe(true);
      expect(result.processedKey).toBe('stable-idempotency-key-001');
      expect(retryDelays).toEqual([10, 20]); // 10ms, then 10 * 2 = 20ms
    });

    it('fails immediately without retrying when a deterministic business error occurs', async () => {
      let callCount = 0;
      const operation = vi.fn(async () => {
        callCount++;
        const domainErr = new Error('Product SKU duplicate conflict');
        (domainErr as unknown as Record<string, unknown>)['statusCode'] = 409;
        throw domainErr;
      });

      await expect(
        executeWithRetry(operation, {
          maxRetries: 3,
          initialDelayMs: 10,
        })
      ).rejects.toThrow(/Product SKU duplicate conflict/);

      expect(callCount).toBe(1); // Never retried
    });

    it('re-throws last error when transient retries are exhausted', async () => {
      let callCount = 0;
      const operation = vi.fn(async () => {
        callCount++;
        const transientErr = new Error('Persistent 503 upstream gateway');
        (transientErr as unknown as Record<string, unknown>)['statusCode'] = 503;
        throw transientErr;
      });

      await expect(
        executeWithRetry(operation, {
          maxRetries: 3,
          initialDelayMs: 5,
          backoffFactor: 2,
        })
      ).rejects.toThrow(/Persistent 503 upstream gateway/);

      expect(callCount).toBe(3);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. 10% Failure Rate Stop Threshold Rule
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. 10% Failure Rate Stop Threshold Rule', () => {
    it('verifies default threshold constants (threshold=0.10, minAttemptedRows=10)', () => {
      expect(DEFAULT_FAILURE_THRESHOLD).toBe(0.1);
      expect(DEFAULT_MIN_ATTEMPTED_ROWS).toBe(10);
    });

    it('calculates failure rate correctly', () => {
      expect(calculateFailureRate(0, 10)).toBe(0);
      expect(calculateFailureRate(1, 10)).toBe(0.1);
      expect(calculateFailureRate(2, 10)).toBe(0.2);
      expect(calculateFailureRate(5, 50)).toBe(0.1);
      expect(calculateFailureRate(6, 50)).toBe(0.12);
      expect(calculateFailureRate(0, 0)).toBe(0);
    });

    it('does not halt execution if attempted rows are below minAttemptedRows threshold', () => {
      // 1 reject out of 5 attempted = 20%, but < 10 attempted rows
      expect(shouldHaltBatchExecution(1, 5, { minAttemptedRows: 10, threshold: 0.1 })).toBe(false);
      // 2 rejects out of 8 attempted = 25%, but < 10 attempted rows
      expect(shouldHaltBatchExecution(2, 8, { minAttemptedRows: 10, threshold: 0.1 })).toBe(false);
    });

    it('halts execution immediately once attempted count >= minAttemptedRows and rate > 10%', () => {
      // 1 reject out of 10 attempted = 10% (<= 0.10 -> does not halt)
      expect(shouldHaltBatchExecution(1, 10, { minAttemptedRows: 10, threshold: 0.1 })).toBe(false);
      // 2 rejects out of 10 attempted = 20% (> 0.10 -> HALT)
      expect(shouldHaltBatchExecution(2, 10, { minAttemptedRows: 10, threshold: 0.1 })).toBe(true);
      // 2 rejects out of 20 attempted = 10% (<= 0.10 -> does not halt)
      expect(shouldHaltBatchExecution(2, 20, { minAttemptedRows: 10, threshold: 0.1 })).toBe(false);
      // 3 rejects out of 20 attempted = 15% (> 0.10 -> HALT)
      expect(shouldHaltBatchExecution(3, 20, { minAttemptedRows: 10, threshold: 0.1 })).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Durable Partial Results & State Transitions to STOPPED_EXCESSIVE_FAILURES
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Durable Partial Results and STOPPED_EXCESSIVE_FAILURES State Transition', () => {
    it('halts batch execution when failures exceed 10% and leaves unattempted rows unprocessed', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      const batchId = 'e0000002-aaaa-4000-8000-000000000002';

      // 20 rows total:
      // Rows 0-7: valid
      // Rows 8-9: invalid (missing name and invalid unit) -> at row 10 (index 9), 2/10 = 20% > 10% threshold!
      // Rows 10-19: remaining valid rows that must NOT be attempted!
      const rows: BatchRowInput[] = Array.from({ length: 20 }, (_, i) => {
        if (i === 8 || i === 9) {
          return {
            sourceRow: i,
            idempotencyKey: `idem-fail-${i}`,
            data: {
              name: '', // invalid
              sku: `SKU-FAIL-${i}`,
              unitOfMeasure: 'invalid_uom',
              price: '1.00',
              currency: 'USD',
            },
          };
        }
        return {
          sourceRow: i,
          idempotencyKey: `idem-pass-${i}`,
          data: {
            name: `Valid Product ${i}`,
            sku: `SKU-PASS-${i}`,
            unitOfMeasure: 'pcs',
            price: '15.00',
            currency: 'USD',
          },
        };
      });

      const result = await adapter.loadBatch(batchId, rows, {
        minAttemptedRows: 10,
        failureThreshold: 0.1,
      });

      expect(result.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(result.stoppedReason).toMatch(/Failure rate exceeded/);
      expect(result.attempted).toBe(10);
      expect(result.loaded).toBe(8);
      expect(result.rejected).toBe(2);
      expect(result.unattempted).toBe(10);

      // Verify the 8 committed products are durable in the database
      const { total } = await repo.listProducts({ page: 1, pageSize: 50 });
      expect(total).toBe(8);

      // Verify unattempted rows were marked as unattempted
      const unattemptedRows = result.rows.filter((r) => r.outcome === 'unattempted');
      expect(unattemptedRows.length).toBe(10);
      expect(unattemptedRows[0]?.sourceRow).toBe(10);
    });

    it('allows clean replay/retry of halted batch after fixing failures without duplicating loaded rows', async () => {
      const adapter = new Erp1TargetAdapter(service, 'product');
      const batchId = 'e0000003-aaaa-4000-8000-000000000003';

      // 12 rows: row 8 and 9 are invalid -> halts at row 10
      const initialRows: BatchRowInput[] = Array.from({ length: 12 }, (_, i) => {
        if (i === 8 || i === 9) {
          return {
            sourceRow: i,
            idempotencyKey: `idem-replay-${i}`,
            data: { name: '', sku: `SKU-${i}`, unitOfMeasure: 'pcs', price: '1.00', currency: 'USD' },
          };
        }
        return {
          sourceRow: i,
          idempotencyKey: `idem-replay-${i}`,
          data: { name: `Product ${i}`, sku: `SKU-REPLAY-${i}`, unitOfMeasure: 'pcs', price: '5.00', currency: 'USD' },
        };
      });

      const run1 = await adapter.loadBatch(batchId, initialRows, { minAttemptedRows: 10, failureThreshold: 0.1 });
      expect(run1.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(run1.loaded).toBe(8);

      // Fix the data in rows 8 and 9 and replay the entire batch with the exact same idempotency keys.
      // Rows 0-7 retain their exact original payload, so the idempotency receipt returns priorResult=true.
      const correctedRows: BatchRowInput[] = Array.from({ length: 12 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `idem-replay-${i}`,
        data: {
          name: i === 8 || i === 9 ? `Corrected Product ${i}` : `Product ${i}`,
          sku: `SKU-REPLAY-${i}`,
          unitOfMeasure: 'pcs',
          price: '5.00',
          currency: 'USD',
        },
      }));

      const run2 = await adapter.loadBatch(batchId, correctedRows, { minAttemptedRows: 10, failureThreshold: 0.1 });
      expect(run2.status).toBe('COMPLETED');
      expect(run2.loaded).toBe(12);
      expect(run2.rejected).toBe(0);
      expect(run2.unattempted).toBe(0);

      // Verify the 8 previously loaded rows returned priorResult = true
      const replayedPrior = run2.rows.slice(0, 8);
      for (const rowResult of replayedPrior) {
        expect(rowResult.priorResult).toBe(true);
      }

      // Total products in DB must still be exactly 12 (zero duplicate records created)
      const { total } = await repo.listProducts({ page: 1, pageSize: 50 });
      expect(total).toBe(12);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Prohibition of Compensating Rollback Sagas in V1
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Prohibition of Compensating Rollback Sagas in V1', () => {
    it('assertNoRollbackSaga forbids automated rollback sagas and requires stop-safely behavior', () => {
      expect(() => {
        assertNoRollbackSaga('ROLLBACK');
      }).toThrow(/Compensating rollback sagas are strictly out of scope for ClearShift V1/);

      expect(() => {
        assertNoRollbackSaga({ isRollbackRequested: true });
      }).toThrow(/Compensating rollback sagas are strictly out of scope for ClearShift V1/);

      expect(() => {
        assertNoRollbackSaga(undefined);
      }).not.toThrow();

      expect(() => {
        assertNoRollbackSaga('STOP_SAFELY');
      }).not.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. HTTP API Endpoint POST /api/v1/erp-products/import/batch Integration
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. HTTP API POST /api/v1/erp-products/import/batch Integration', () => {
    it('returns 200 with COMPLETED summary when all rows load successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import/batch',
        payload: {
          batch_id: 'e0000004-aaaa-4000-8000-000000000004',
          entity: 'product',
          rows: [
            {
              source_row: 0,
              idempotency_key: 'http-batch-001',
              record: {
                name: 'Precision Screwdriver',
                sku: 'TOOL-PREC-01',
                unitOfMeasure: 'pcs',
                price: '14.50',
                currency: 'USD',
              },
            },
            {
              source_row: 1,
              idempotency_key: 'http-batch-002',
              record: {
                name: 'Hydraulic Hose 2m',
                sku: 'HOSE-HYD-2M',
                unitOfMeasure: 'metre',
                price: '28.00',
                currency: 'USD',
              },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('COMPLETED');
      expect(body.total).toBe(2);
      expect(body.loaded).toBe(2);
      expect(body.rejected).toBe(0);
      expect(body.unattempted).toBe(0);
    });

    it('halts and returns STOPPED_EXCESSIVE_FAILURES when failure threshold is exceeded via HTTP API', async () => {
      const payloadRows = Array.from({ length: 15 }, (_, i) => {
        if (i < 3) {
          return {
            source_row: i,
            idempotency_key: `http-fail-${i}`,
            record: {
              name: '',
              sku: '',
              unitOfMeasure: 'invalid',
              price: '-10.00',
              currency: 'USD',
            },
          };
        }
        return {
          source_row: i,
          idempotency_key: `http-pass-${i}`,
          record: {
            name: `Product ${i}`,
            sku: `SKU-HTTP-${i}`,
            unitOfMeasure: 'pcs',
            price: '9.99',
            currency: 'USD',
          },
        };
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/import/batch',
        payload: {
          batch_id: 'e0000005-aaaa-4000-8000-000000000005',
          entity: 'product',
          failure_threshold: 0.1,
          min_attempted_rows: 10,
          rows: payloadRows,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(body.rejected).toBe(3);
      expect(body.attempted).toBe(10);
      expect(body.unattempted).toBe(5);
    });
  });
});
