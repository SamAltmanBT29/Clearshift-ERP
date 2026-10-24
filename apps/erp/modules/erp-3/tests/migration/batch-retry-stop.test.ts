/**
 * ERP-3 Sales Orders and Invoices — Idempotent Retry & Partial-Load Stop Test Suite
 *
 * Verifies Acceptance Criteria for Issue #149 (ERP3-13 / KIT-12 / Sprint 4 Gate G4):
 *   1. Load operations process records in bounded chunks of 500 rows (CHUNK_SIZE = 500).
 *   2. Transient failures trigger bounded exponential backoff retries without corrupting idempotency keys.
 *   3. Batch execution stops immediately if row failures exceed 10% of attempted rows (> 0.10).
 *   4. Already committed rows and receipts remain durable; batch state transitions to STOPPED_EXCESSIVE_FAILURES.
 *   5. No rollback saga or destructive uncommitted data loss occurs.
 *
 * @module erp3/tests/migration/batch-retry-stop.test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ReferenceResolver } from "@cs/kernel";
import { Roles, signAccessToken } from "@cs/identity";
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MIN_ATTEMPTED_ROWS,
  DEFAULT_RETRY_CONFIG,
  assertNoRollbackSaga,
} from "@clearshift/contracts";
import { buildApp } from "../../src/app.js";
import { InMemoryErp3Repository } from "../../src/services/repository.js";
import { Erp3Service } from "../../src/services/erp3.service.js";
import {
  Erp3TargetAdapter,
  type BatchRowInput,
} from "../../src/migration/target-adapter.js";
import {
  chunkArray,
  calculateFailureRate,
  shouldHaltBatchExecution,
  isTransientFailure,
  executeWithRetry,
} from "../../src/migration/batch-runner.js";

const CUSTOMER_1 = "55555555-0003-4000-8000-000000000001";
const PRODUCT_1 = "11111111-0001-4000-8000-000000000001";

class MockErp1Crm1Resolver implements ReferenceResolver {
  public validCustomers = new Set<string>([CUSTOMER_1]);
  public validProducts = new Set<string>([PRODUCT_1]);

  async exists(entityType: string, id: string): Promise<boolean> {
    if (entityType === "customer") {
      return this.validCustomers.has(id);
    }
    if (entityType === "product") {
      return this.validProducts.has(id);
    }
    return false;
  }

  async get<T = unknown>(_entityType: string, _id: string): Promise<T | null> {
    return null;
  }
}

describe("ERP-3 Idempotent Retry and Partial-Load Stop Behavior (ERP3-13 / Issue #149)", () => {
  let app: FastifyInstance;
  let repo: InMemoryErp3Repository;
  let resolver: MockErp1Crm1Resolver;
  let service: Erp3Service;
  let runnerToken: string;

  beforeEach(async () => {
    runnerToken = await signAccessToken("runner-user", [Roles.MIGRATION_RUNNER]);
    repo = new InMemoryErp3Repository(false);
    resolver = new MockErp1Crm1Resolver();
    service = new Erp3Service({
      repository: repo,
      referenceResolver: resolver,
    });
    app = buildApp({
      repository: repo,
      erp3Service: service,
      referenceResolver: resolver,
      authRequired: true,
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Chunking Behavior (CHUNK_SIZE = 500)
  // ───────────────────────────────────────────────────────────────────────────
  describe("1. 500-Row Chunk Partition Boundaries", () => {
    it("partitions arrays into chunks of specified or default size", () => {
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

    it("rejects non-positive chunk size", () => {
      expect(() => chunkArray([1, 2], 0)).toThrow(/positive integer/);
      expect(() => chunkArray([1, 2], -10)).toThrow(/positive integer/);
    });

    it("tracks chunksProcessed accurately during loadBatch", async () => {
      const adapter = new Erp3TargetAdapter(service, "sales_order");
      const batchId = "00000000-0000-0000-0000-000000000301";

      // 7 rows chunked into groups of 3 -> 3 chunks (3, 3, 1)
      const rows: BatchRowInput[] = Array.from({ length: 7 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `erp3-batch-chunk-key-${i}`,
        data: {
          order_number: `SO-CHUNK-${String(i).padStart(3, "0")}`,
          customer_golden_id: CUSTOMER_1,
          order_date: "2026-03-01",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "2.0000",
              price: "50.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      }));

      const result = await adapter.loadBatch(batchId, rows, { chunkSize: 3 });
      expect(result.status).toBe("COMPLETED");
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
  describe("2. Transient Failure Retry & Idempotency Key Preservation", () => {
    it("classifies transient errors accurately", () => {
      expect(isTransientFailure({ retryable: true })).toBe(true);
      expect(isTransientFailure({ statusCode: 503 })).toBe(true);
      expect(isTransientFailure({ statusCode: 504 })).toBe(true);
      expect(isTransientFailure({ code: "ECONNRESET" })).toBe(true);
      expect(isTransientFailure({ code: "ETIMEDOUT" })).toBe(true);
      expect(isTransientFailure({ code: "40P01" })).toBe(true); // PostgreSQL deadlock
      expect(isTransientFailure({ code: "57P01" })).toBe(true); // PostgreSQL admin shutdown
      expect(isTransientFailure(new Error("Connection econnreset by peer"))).toBe(true);
      expect(isTransientFailure(new Error("deadlock detected"))).toBe(true);

      // Deterministic domain errors MUST NOT be classified as transient
      expect(isTransientFailure({ statusCode: 400 })).toBe(false);
      expect(isTransientFailure({ statusCode: 409 })).toBe(false);
      expect(isTransientFailure({ statusCode: 422 })).toBe(false);
      expect(isTransientFailure({ code: "VALIDATION_ERROR" })).toBe(false);
      expect(isTransientFailure(new Error("Invalid total calculation"))).toBe(false);
      expect(isTransientFailure(null)).toBe(false);
    });

    it("retries transient failures with exponential backoff up to maxRetries", async () => {
      let callCount = 0;
      const retryDelays: number[] = [];

      const operation = vi.fn(async (attempt: number) => {
        callCount++;
        if (attempt < 3) {
          const err = new Error("Service Unavailable temporary glitch");
          (err as Record<string, unknown>).statusCode = 503;
          throw err;
        }
        return "success";
      });

      const { result, attempts } = await executeWithRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffFactor: 2,
        onRetry: (_att, delay) => {
          retryDelays.push(delay);
        },
      });

      expect(result).toBe("success");
      expect(attempts).toBe(3);
      expect(callCount).toBe(3);
      expect(retryDelays).toEqual([10, 20]); // 10ms (attempt 1), 20ms (attempt 2)
    });

    it("does not retry deterministic validation or business errors", async () => {
      let callCount = 0;
      const operation = vi.fn(async (_attempt: number) => {
        callCount++;
        const err = new Error("Validation failed");
        (err as Record<string, unknown>).statusCode = 400;
        throw err;
      });

      await expect(
        executeWithRetry(operation, {
          maxRetries: 3,
          initialDelayMs: 10,
        })
      ).rejects.toThrow("Validation failed");

      expect(callCount).toBe(1);
    });

    it("preserves the client idempotency key across transient retries in target adapter", async () => {
      const adapter = new Erp3TargetAdapter(service, "sales_order");
      const batchId = "00000000-0000-0000-0000-000000000302";
      const rowIdempotencyKey = "erp3-stable-idempotency-key-xyz-777";

      let attemptCounter = 0;
      const capturedKeys: string[] = [];

      const originalImportRow = adapter.importRow.bind(adapter);
      vi.spyOn(adapter, "importRow").mockImplementation(
        async (bId, rowNum, key, data, opts) => {
          attemptCounter++;
          capturedKeys.push(key);
          if (attemptCounter === 1) {
            const transientErr = new Error("Database deadlock detected 40P01");
            (transientErr as Record<string, unknown>).code = "40P01";
            throw transientErr;
          }
          return originalImportRow(bId, rowNum, key, data, opts);
        }
      );

      const rows: BatchRowInput[] = [
        {
          sourceRow: 0,
          idempotencyKey: rowIdempotencyKey,
          data: {
            order_number: "SO-RETRY-001",
            customer_golden_id: CUSTOMER_1,
            order_date: "2026-03-01",
            currency: "USD",
            lines: [
              {
                product_id: PRODUCT_1,
                quantity: "1.0000",
                price: "150.0000",
                tax_rate: "0.0000",
              },
            ],
          },
        },
      ];

      const result = await adapter.loadBatch(batchId, rows, {
        maxRetries: 3,
        initialDelayMs: 5,
        backoffFactor: 2,
      });

      expect(result.status).toBe("COMPLETED");
      expect(result.loaded).toBe(1);
      expect(result.rows[0]?.outcome).toBe("loaded");
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
  describe("3. 10% Stop Threshold Rule (> 0.10 of Attempted Rows)", () => {
    it("calculates failure rate correctly", () => {
      expect(calculateFailureRate(0, 10)).toBe(0);
      expect(calculateFailureRate(1, 10)).toBe(0.1);
      expect(calculateFailureRate(2, 10)).toBe(0.2);
      expect(calculateFailureRate(0, 0)).toBe(0);
    });

    it("requires minimum 10 attempted rows before evaluating stop threshold", () => {
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

    it("halts batch execution immediately when row failure rate exceeds 10%", async () => {
      const adapter = new Erp3TargetAdapter(service, "sales_order");
      const batchId = "00000000-0000-0000-0000-000000000303";

      // 12 rows where rows 10 & 11 fail customer Golden ID lookup (failure rate = 2/12 = 16.6% > 10%)
      const rows: BatchRowInput[] = Array.from({ length: 12 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `halt-erp3-key-${i}`,
        data: {
          order_number: `SO-HALT-${String(i).padStart(3, "0")}`,
          customer_golden_id:
            i === 10 || i === 11
              ? "99999999-9999-4000-8000-999999999999"
              : CUSTOMER_1,
          order_date: "2026-03-01",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "25.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      }));

      // Add 5 more rows that should remain unattempted after halt
      for (let i = 12; i < 17; i++) {
        rows.push({
          sourceRow: i,
          idempotencyKey: `halt-erp3-key-${i}`,
          data: {
            order_number: `SO-HALT-${String(i).padStart(3, "0")}`,
            customer_golden_id: CUSTOMER_1,
            order_date: "2026-03-01",
            currency: "USD",
            lines: [
              {
                product_id: PRODUCT_1,
                quantity: "1.0000",
                price: "25.0000",
                tax_rate: "0.0000",
              },
            ],
          },
        });
      }

      const result = await adapter.loadBatch(batchId, rows, {
        chunkSize: 500,
        failureThreshold: 0.1,
        minAttemptedRows: 10,
      });

      expect(result.status).toBe("STOPPED_EXCESSIVE_FAILURES");
      expect(result.total).toBe(17);
      expect(result.attempted).toBe(12);
      expect(result.loaded).toBe(10);
      expect(result.rejected).toBe(2);
      expect(result.unattempted).toBe(5);
      expect(result.stoppedReason).toContain("exceeded the 10% threshold");

      // Reconciliation Invariant: total = loaded + rejected + unattempted
      expect(result.total).toBe(
        result.loaded + result.rejected + result.unattempted
      );

      // Verify row outcomes
      for (let i = 0; i < 10; i++) {
        expect(result.rows[i]?.outcome).toBe("loaded");
      }
      expect(result.rows[10]?.outcome).toBe("rejected");
      expect(result.rows[11]?.outcome).toBe("rejected");

      for (let i = 12; i < 17; i++) {
        expect(result.rows[i]?.outcome).toBe("unattempted");
        expect(result.rows[i]?.result).toBeUndefined();
      }
    });

    it("halts across chunk boundaries without attempting subsequent chunks", async () => {
      const adapter = new Erp3TargetAdapter(service, "sales_order");
      const batchId = "00000000-0000-0000-0000-000000000304";

      // 15 rows total, chunkSize = 6 (3 chunks: 6, 6, 3)
      // Chunk 1 (rows 0-5): 6 valid
      // Chunk 2 (rows 6-11): rows 10 & 11 fail customer lookup
      // At row 11: attempted = 12, rejected = 2 (16.6% > 10%) -> HALT!
      // Chunk 3 (rows 12-14): should NEVER be processed (remains unattempted)
      const rows: BatchRowInput[] = Array.from({ length: 15 }, (_, i) => {
        const isInvalid = i === 10 || i === 11;
        return {
          sourceRow: i,
          idempotencyKey: `chunk-halt-erp3-key-${i}`,
          data: {
            order_number: `SO-C-${String(i).padStart(3, "0")}`,
            customer_golden_id: isInvalid
              ? "99999999-9999-4000-8000-999999999999"
              : CUSTOMER_1,
            order_date: "2026-03-01",
            currency: "USD",
            lines: [
              {
                product_id: PRODUCT_1,
                quantity: "1.0000",
                price: "10.0000",
                tax_rate: "0.0000",
              },
            ],
          },
        };
      });

      const result = await adapter.loadBatch(batchId, rows, {
        chunkSize: 6,
        minAttemptedRows: 10,
        failureThreshold: 0.1,
      });

      expect(result.status).toBe("STOPPED_EXCESSIVE_FAILURES");
      expect(result.chunksProcessed).toBe(2); // Only chunk 1 and chunk 2 were touched
      expect(result.attempted).toBe(12);
      expect(result.loaded).toBe(10);
      expect(result.rejected).toBe(2);
      expect(result.unattempted).toBe(3);
      expect(result.total).toBe(15);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Durability & Idempotent Resumption
  // ───────────────────────────────────────────────────────────────────────────
  describe("4. Durable Committed Records & Idempotent Replay / Resumption", () => {
    it("guarantees committed records remain durable after a batch halts", async () => {
      const adapter = new Erp3TargetAdapter(service, "sales_order");
      const batchId = "00000000-0000-0000-0000-000000000305";

      const rows: BatchRowInput[] = Array.from({ length: 14 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `durable-erp3-key-${i}`,
        data: {
          order_number: `SO-DUR-${String(i).padStart(3, "0")}`,
          customer_golden_id:
            i === 10 || i === 11
              ? "99999999-9999-4000-8000-999999999999"
              : CUSTOMER_1,
          order_date: "2026-03-01",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      }));

      const result = await adapter.loadBatch(batchId, rows, {
        minAttemptedRows: 10,
        failureThreshold: 0.1,
      });

      expect(result.status).toBe("STOPPED_EXCESSIVE_FAILURES");
      expect(result.loaded).toBe(10);

      // Verify that all 10 committed sales orders exist in the repository
      const { data: orders, total } = await repo.listSalesOrders({
        page: 1,
        pageSize: 20,
      });
      expect(total).toBe(10);
      for (let i = 0; i < 10; i++) {
        const found = orders.find(
          (o) => o.order_number === `SO-DUR-${String(i).padStart(3, "0")}`
        );
        expect(found).toBeDefined();

        // Durable receipt also exists
        const receipt = await repo.getImportReceiptByKey(
          `durable-erp3-key-${i}`
        );
        expect(receipt).not.toBeNull();
      }
    });

    it("supports idempotent resumption: replaying the batch skips committed rows safely", async () => {
      const adapter = new Erp3TargetAdapter(service, "sales_order");
      const batchId = "00000000-0000-0000-0000-000000000306";

      // 14 rows: initial run halts at row 11 because rows 10 and 11 fail (2/12 = 16.6%)
      const initialRows: BatchRowInput[] = Array.from({ length: 14 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `resumption-erp3-key-${i}`,
        data: {
          order_number: `SO-RES-${String(i).padStart(3, "0")}`,
          customer_golden_id:
            i === 10 || i === 11
              ? "99999999-9999-4000-8000-999999999999"
              : CUSTOMER_1,
          order_date: "2026-03-01",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "2.0000",
              price: "30.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      }));

      // Initial run halts
      const run1 = await adapter.loadBatch(batchId, initialRows, {
        minAttemptedRows: 10,
        failureThreshold: 0.1,
      });
      expect(run1.status).toBe("STOPPED_EXCESSIVE_FAILURES");
      expect(run1.loaded).toBe(10);

      // Correct rows 10 and 11 in source data
      const correctedRows: BatchRowInput[] = Array.from({ length: 14 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `resumption-erp3-key-${i}`, // exact same keys
        data: {
          order_number: `SO-RES-${String(i).padStart(3, "0")}`,
          customer_golden_id: CUSTOMER_1,
          order_date: "2026-03-01",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "2.0000",
              price: "30.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      }));

      // Second run: replay batch
      const run2 = await adapter.loadBatch(batchId, correctedRows, {
        minAttemptedRows: 10,
        failureThreshold: 0.1,
      });

      expect(run2.status).toBe("COMPLETED");
      expect(run2.loaded).toBe(14);
      expect(run2.rejected).toBe(0);
      expect(run2.unattempted).toBe(0);

      // Verify that rows 0-9 returned prior_result = true
      for (let i = 0; i < 10; i++) {
        expect(run2.rows[i]?.outcome).toBe("loaded");
        expect(run2.rows[i]?.result?.priorResult).toBe(true);
      }
      // Verify rows 10-13 were freshly loaded
      for (let i = 10; i < 14; i++) {
        expect(run2.rows[i]?.outcome).toBe("loaded");
        expect(run2.rows[i]?.result?.priorResult).toBe(false);
      }

      // Assert no duplicate sales order records: total must be exactly 14
      const { total } = await repo.listSalesOrders({ page: 1, pageSize: 50 });
      expect(total).toBe(14);
    });

    it("strictly forbids compensating rollback sagas in V1", () => {
      // assertNoRollbackSaga() succeeds in normal execution
      expect(() => assertNoRollbackSaga()).not.toThrow();

      // Ensure that when called with an invalid flag, it throws an error
      expect(() => assertNoRollbackSaga("ROLLBACK" as any)).toThrow(
        /Compensating rollback sagas are strictly out of scope/
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Fastify Route Integration: POST /api/v1/erp-orders/import/batch
  // ───────────────────────────────────────────────────────────────────────────
  describe("5. Fastify HTTP POST /import/batch Integration", () => {
    it("executes batch import with chunking and stops on excessive failure threshold", async () => {
      const batchId = "bbbbbbbb-0003-4000-8000-000000000307";

      // 14 rows: 10 valid, 2 invalid, 2 unattempted
      const rows = Array.from({ length: 14 }, (_, i) => ({
        source_row: i,
        idempotency_key: `http-erp3-key-${i}`,
        record: {
          order_number: `SO-HTTP-${String(i).padStart(3, "0")}`,
          customer_golden_id:
            i === 10 || i === 11
              ? "99999999-9999-4000-8000-999999999999"
              : CUSTOMER_1,
          order_date: "2026-03-01",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "50.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      }));

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/import/batch",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${runnerToken}`,
        },
        payload: {
          batch_id: batchId,
          entity: "sales_order",
          chunk_size: 500,
          failure_threshold: 0.1,
          min_attempted_rows: 10,
          rows,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.batchId).toBe(batchId);
      expect(body.status).toBe("STOPPED_EXCESSIVE_FAILURES");
      expect(body.total).toBe(14);
      expect(body.attempted).toBe(12);
      expect(body.loaded).toBe(10);
      expect(body.rejected).toBe(2);
      expect(body.unattempted).toBe(2);
      expect(body.stoppedReason).toContain("exceeded the 10% threshold");
      expect(body.rows.length).toBe(14);

      // Verify unattempted rows
      expect(body.rows[12].outcome).toBe("unattempted");
      expect(body.rows[13].outcome).toBe("unattempted");
    });

    it("completes successfully when failure rate remains within threshold", async () => {
      const batchId = "bbbbbbbb-0003-4000-8000-000000000308";

      // 12 rows: 11 valid, 1 invalid (1/12 = 8.33% <= 10%)
      const rows = Array.from({ length: 12 }, (_, i) => ({
        source_row: i,
        idempotency_key: `http-pass-erp3-key-${i}`,
        record: {
          order_number: `SO-PASS-${String(i).padStart(3, "0")}`,
          customer_golden_id:
            i === 11
              ? "99999999-9999-4000-8000-999999999999"
              : CUSTOMER_1,
          order_date: "2026-03-01",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "20.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      }));

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/import/batch",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${runnerToken}`,
        },
        payload: {
          batch_id: batchId,
          entity: "sales_order",
          failure_threshold: 0.1,
          min_attempted_rows: 10,
          rows,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.status).toBe("COMPLETED");
      expect(body.total).toBe(12);
      expect(body.attempted).toBe(12);
      expect(body.loaded).toBe(11);
      expect(body.rejected).toBe(1);
      expect(body.unattempted).toBe(0);
      expect(body.stoppedReason).toBeNull();
    });
  });
});
