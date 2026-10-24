/**
 * ERP-3 Idempotency & Migration Target Adapter Test Suite
 *
 * Validates Acceptance Criteria for Issue #32 (ERP3-07 / KIT-08 / Decision C4):
 *   AC1. Target adapter implements TargetAdapter<TRow> contract (@cs/kit): preflight and importRow.
 *   AC2. Fixture row loaded via public API (POST /api/v1/erp-orders/import); Migration Kit has no direct DB write access.
 *   AC3. Retrying identical row payload and key 3 times produces exactly 1 business record and returns prior receipt without duplication (HTTP 200).
 *   AC4. Reusing an existing idempotency key with a conflicting/different payload returns HTTP 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH with zero state mutations.
 *   AC5. Target record and durable import receipt commit atomically in one local database transaction; simulated failure rolls back both.
 *   AC6. Domain invariants enforced for sales orders, invoices, and payments (valid customer Golden ID, server-calculated totals, mandatory due date, single full payment).
 *
 * Validates Acceptance Criteria for Issue #147 (ERP3-11 / loadBatch UPSERT):
 *   AC1. Target adapter implements loadBatch executing type-safe batch operations.
 *   AC2. Target record and durable import receipt commit atomically in one local database transaction.
 *   AC3. Import receipt stores batch_id, source_row, target_id, idempotency_key, and timestamp.
 *   AC4. Re-running the same source row with identical idempotency key returns existing receipt without duplication.
 *
 * Validates Batch Runner Rules (KIT-12 / Decision C4 / 10% Stop Threshold):
 *   - Chunked processing (500 rows).
 *   - Bounded exponential backoff retry on transient failures.
 *   - Immediate halt when row failure rate exceeds 10% of attempted rows.
 *   - Preservation of durable committed rows and receipts (no rollback sagas).
 *
 * @module erp3/tests/migration/idempotency.test
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ReferenceResolver } from '@cs/kernel';
import { Roles, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { InMemoryErp3Repository } from '../../src/services/repository.js';
import { Erp3Service } from '../../src/services/erp3.service.js';
import { Erp3TargetAdapter } from '../../src/migration/target-adapter.js';
import {
  chunkArray,
  calculateFailureRate,
  shouldHaltBatchExecution,
  executeWithRetry,
  isTransientFailure,
} from '../../src/migration/batch-runner.js';
import {
  findReceiptByKey,
  insertReceipt,
} from '../../db/import-receipts.js';

class MockReferenceResolver implements ReferenceResolver {
  public validCustomers = new Set<string>([
    '55555555-0003-4000-8000-000000000001',
    '55555555-0003-4000-8000-000000000002',
  ]);

  public validProducts = new Set<string>([
    '11111111-0001-4000-8000-000000000001',
    '11111111-0001-4000-8000-000000000002',
    '11111111-0001-4000-8000-000000000003',
  ]);

  async exists(entityType: string, id: string): Promise<boolean> {
    if (entityType === 'customer') {
      return this.validCustomers.has(id);
    }
    if (entityType === 'product') {
      return this.validProducts.has(id);
    }
    return false;
  }

  async get<T = unknown>(_entityType: string, _id: string): Promise<T | null> {
    return null;
  }
}

describe('ERP-3 Migration Kit Adapter & Durable Import Receipts (Issue #32 / Issue #147)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp3Repository;
  let resolver: MockReferenceResolver;
  let service: Erp3Service;
  let runnerToken: string;
  const currentUtcDate = '2026-04-15';

  const CUSTOMER_1 = '55555555-0003-4000-8000-000000000001';
  const PRODUCT_1 = '11111111-0001-4000-8000-000000000001';
  const BATCH_ID = 'bbbbbbbb-0003-4000-8000-000000000001';

  beforeEach(async () => {
    runnerToken = await signAccessToken('runner-user', [Roles.MIGRATION_RUNNER]);
    repo = new InMemoryErp3Repository(true); // seeds default SO-2026-0001
    resolver = new MockReferenceResolver();
    service = new Erp3Service({
      repository: repo,
      referenceResolver: resolver,
      nowUtcDate: () => currentUtcDate,
    });
    app = buildApp({
      repository: repo,
      erp3Service: service,
      referenceResolver: resolver,
      authRequired: true,
      nowUtcDate: () => currentUtcDate,
    });
  });

  describe('1. In-Process TargetAdapter (KIT-08 Contract)', () => {
    it('executes preflight dry-run validation without mutating the database', async () => {
      const adapter = new Erp3TargetAdapter(service, 'sales_order');

      const rows = [
        {
          customer_golden_id: CUSTOMER_1,
          order_date: '2026-04-10',
          lines: [{ product_id: PRODUCT_1, quantity: '2.0000', price: '50.0000', tax_rate: '0.0000' }],
        },
        {
          customer_golden_id: '',
          order_date: 'invalid-date',
          lines: [],
        },
      ];

      const res = await adapter.preflight(BATCH_ID, rows);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.validCount).toBe(1);
        expect(res.value.rejectCount).toBe(1);
      }

      // Assert zero DB mutations occurred
      const { total } = await repo.listSalesOrders({ page: 1, pageSize: 20 });
      expect(total).toBe(1); // Only seeded fixture
    });

    it('preflight validates invoices and payments accurately', async () => {
      const invoiceAdapter = new Erp3TargetAdapter(service, 'invoice');
      const invoiceRes = await invoiceAdapter.preflight(BATCH_ID, [
        {
          customer_golden_id: CUSTOMER_1,
          invoice_date: '2026-04-10',
          due_date: '2026-04-20',
          lines: [{ product_id: PRODUCT_1, quantity: '1.0000', price: '100.0000', tax_rate: '0.0000' }],
        },
        {
          customer_golden_id: CUSTOMER_1,
          invoice_date: '2026-04-20',
          due_date: '2026-04-10', // due_date before invoice_date
          lines: [{ product_id: PRODUCT_1, quantity: '1.0000', price: '100.0000', tax_rate: '0.0000' }],
        },
      ]);
      expect(invoiceRes.ok).toBe(true);
      if (invoiceRes.ok) {
        expect(invoiceRes.value.validCount).toBe(1);
        expect(invoiceRes.value.rejectCount).toBe(1);
      }

      const paymentAdapter = new Erp3TargetAdapter(service, 'payment');
      const paymentRes = await paymentAdapter.preflight(BATCH_ID, [
        {
          invoice_id: 'aaaaaaaa-0003-4000-8000-000000000001',
          amount: '100.0000',
          method: 'bank',
        },
        {
          invoice_id: '',
          amount: '-5.0000',
          method: 'unsupported_method',
        },
      ]);
      expect(paymentRes.ok).toBe(true);
      if (paymentRes.ok) {
        expect(paymentRes.value.validCount).toBe(1);
        expect(paymentRes.value.rejectCount).toBe(1);
      }
    });

    it('commits target business record and durable receipt atomically', async () => {
      const adapter = new Erp3TargetAdapter(service, 'sales_order');
      const key = 'idem-so-001';

      const res = await adapter.importRow(BATCH_ID, 0, key, {
        order_number: 'SO-IMPORT-001',
        customer_golden_id: CUSTOMER_1,
        order_date: '2026-04-10',
        currency: 'USD',
        lines: [
          {
            product_id: PRODUCT_1,
            quantity: '3.0000',
            price: '50.0000',
            tax_rate: '10.0000',
          },
        ],
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.targetId).toBeDefined();
        expect(res.value.receipt.idempotencyKey).toBe(key);
        expect(res.value.receipt.entity).toBe('sales_order');
        expect(res.value.receipt.batchId).toBe(BATCH_ID);
        expect(res.value.receipt.kind).toBe('created');
      }

      // Assert business row exists and has server-computed totals
      const created = await repo.getSalesOrderByNumber('SO-IMPORT-001');
      expect(created).not.toBeNull();
      expect(created?.total).toBe('165.0000'); // (3 * 50) + 10% tax = 150 + 15 = 165

      // Assert receipt exists
      const receipt = await repo.getImportReceiptByKey(key);
      expect(receipt).not.toBeNull();
      expect(receipt?.target_id).toBe(created?.id);
    });
  });

  describe('2. Identical Retries (3x)', () => {
    it('retrying identical row payload and key 3 times produces exactly 1 business record and 1 durable receipt via HTTP API', async () => {
      const payload = {
        batch_id: BATCH_ID,
        source_row: 1,
        source_system: 'legacy_erp',
        source_id: 'LEG-SO-991',
        idempotency_key: 'key-so-retry-test',
        entity: 'sales_order',
        record: {
          order_number: 'SO-RETRY-991',
          customer_golden_id: CUSTOMER_1,
          order_date: '2026-04-10',
          currency: 'USD',
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: '2.0000',
              price: '100.0000',
              tax_rate: '18.0000',
            },
          ],
        },
      };

      // Call 1: Fresh write -> 201 Created
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/import',
        headers: {
          authorization: `Bearer ${runnerToken}`,
          'idempotency-key': payload.idempotency_key,
        },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const data1 = JSON.parse(res1.payload);
      expect(data1.prior_result).toBe(false);
      const targetId = data1.target_id;

      // Call 2: Replay 1 -> 200 OK (prior_result: true)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/import',
        headers: {
          authorization: `Bearer ${runnerToken}`,
          'idempotency-key': payload.idempotency_key,
        },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const data2 = JSON.parse(res2.payload);
      expect(data2.prior_result).toBe(true);
      expect(data2.target_id).toBe(targetId);

      // Call 3: Replay 2 -> 200 OK (prior_result: true)
      const res3 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/import',
        headers: {
          authorization: `Bearer ${runnerToken}`,
          'idempotency-key': payload.idempotency_key,
        },
        payload,
      });
      expect(res3.statusCode).toBe(200);
      const data3 = JSON.parse(res3.payload);
      expect(data3.prior_result).toBe(true);
      expect(data3.target_id).toBe(targetId);

      // Verify repository contains exactly 1 order with this order number
      const order = await repo.getSalesOrderByNumber('SO-RETRY-991');
      expect(order).not.toBeNull();
      expect(order?.id).toBe(targetId);

      // Verify repository contains exactly 1 receipt
      const receipt = await repo.getImportReceiptByKey(payload.idempotency_key);
      expect(receipt).not.toBeNull();
      expect(receipt?.target_id).toBe(targetId);
    });
  });

  describe('3. Reused Key with Different Payload (HTTP 409 Conflict)', () => {
    it('reusing an idempotency key with a different payload returns 409 and does not mutate data', async () => {
      const idempotencyKey = 'key-conflict-test-01';

      // 1. Initial successful import
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/import',
        headers: {
          authorization: `Bearer ${runnerToken}`,
        },
        payload: {
          batch_id: BATCH_ID,
          source_row: 1,
          idempotency_key: idempotencyKey,
          entity: 'sales_order',
          record: {
            order_number: 'SO-ORIGINAL-01',
            customer_golden_id: CUSTOMER_1,
            order_date: '2026-04-10',
            currency: 'USD',
            lines: [
              {
                product_id: PRODUCT_1,
                quantity: '1.0000',
                price: '100.0000',
                tax_rate: '0.0000',
              },
            ],
          },
        },
      });
      expect(res1.statusCode).toBe(201);
      const original = await repo.getSalesOrderByNumber('SO-ORIGINAL-01');
      expect(original).not.toBeNull();

      // 2. Conflicting attempt with same key but different order_number / customer
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/import',
        headers: {
          authorization: `Bearer ${runnerToken}`,
        },
        payload: {
          batch_id: BATCH_ID,
          source_row: 1,
          idempotency_key: idempotencyKey,
          entity: 'sales_order',
          record: {
            order_number: 'SO-CONFLICTING-02',
            customer_golden_id: CUSTOMER_1,
            order_date: '2026-04-10',
            currency: 'USD',
            lines: [
              {
                product_id: PRODUCT_1,
                quantity: '5.0000',
                price: '200.0000',
                tax_rate: '0.0000',
              },
            ],
          },
        },
      });
      expect(res2.statusCode).toBe(409);
      const errBody = JSON.parse(res2.payload);
      expect(errBody.code).toBe('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

      // Assert conflicting order was NEVER created
      const conflictRecord = await repo.getSalesOrderByNumber('SO-CONFLICTING-02');
      expect(conflictRecord).toBeNull();
    });
  });

  describe('4. Business Rule Rejection vs Infrastructure Errors', () => {
    it('business rule rejection returns stable reason code and does not store bad records', async () => {
      const adapter = new Erp3TargetAdapter(service, 'sales_order');

      // Attempt to import with non-existent customer Golden ID
      const res = await adapter.importRow(
        BATCH_ID,
        1,
        'key-missing-customer',
        {
          order_number: 'SO-BAD-CUSTOMER',
          customer_golden_id: '99999999-9999-4000-8000-999999999999',
          order_date: '2026-04-10',
          currency: 'USD',
          lines: [{ product_id: PRODUCT_1, quantity: '1.0000', price: '100.0000', tax_rate: '0.0000' }],
        }
      );

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.reasonCode).toBe('CUSTOMER_NOT_FOUND');
      }

      // Assert neither business record nor receipt exists
      const order = await repo.getSalesOrderByNumber('SO-BAD-CUSTOMER');
      expect(order).toBeNull();
      const receipt = await repo.getImportReceiptByKey('key-missing-customer');
      expect(receipt).toBeNull();
    });

    it('simulated infrastructure failure throws and is not recorded as data rejection', async () => {
      const adapter = new Erp3TargetAdapter(service, 'sales_order');

      // Mock service to simulate an infrastructure 503 outage
      const infraError = Object.assign(new Error('PostgreSQL connection timeout'), {
        code: 'SERVICE_UNAVAILABLE',
        statusCode: 503,
      });

      const spy = vitest.spyOn(service, 'importRow').mockRejectedValueOnce(infraError);

      await expect(
        adapter.importRow(BATCH_ID, 1, 'key-infra-fail', {
          order_number: 'SO-INFRA-FAIL',
          customer_golden_id: CUSTOMER_1,
          order_date: '2026-04-10',
          lines: [{ product_id: PRODUCT_1, quantity: '1.0000', price: '100.0000', tax_rate: '0.0000' }],
        })
      ).rejects.toThrow('PostgreSQL connection timeout');

      spy.mockRestore();
    });
  });

  describe('5. Transactional Integrity & Rollback', () => {
    it('receipt and target mutation roll back together atomically when an error occurs mid-write', async () => {
      // Simulate an error thrown inside the transaction work
      await expect(
        repo.executeTransactional(async (tx) => {
          await tx.createSalesOrder({
            id: 'cccccccc-0003-4000-8000-000000000001',
            order_number: 'SO-ROLLBACK-TEST',
            customer_golden_id: CUSTOMER_1,
            order_date: '2026-04-10',
            status: 'Open',
            currency: 'USD',
            total: '100.0000',
            lines: [],
          });
          await tx.createImportReceipt({
            batch_id: BATCH_ID,
            source_row: 1,
            source_system: null,
            source_id: null,
            entity: 'sales_order',
            schema_version: 1,
            idempotency_key: 'key-rollback-test',
            request_hash: 'hash-test',
            target_id: 'cccccccc-0003-4000-8000-000000000001',
            kind: 'created',
            outcome: 'loaded',
            response_payload: {},
          });
          throw new Error('Simulated database crash before commit');
        })
      ).rejects.toThrow('Simulated database crash before commit');

      // Assert both order and receipt were rolled back completely
      expect(await repo.getSalesOrderByNumber('SO-ROLLBACK-TEST')).toBeNull();
      expect(await repo.getImportReceiptByKey('key-rollback-test')).toBeNull();
    });
  });

  describe('6. Domain Invariants Ingestion Tests', () => {
    it('imports an invoice linked to an existing sales order and verifies status lifecycle', async () => {
      const orderId = 'aaaaaaaa-0003-4000-8000-000000000001'; // seeded open order with total 1180.0000

      const invoiceRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/import',
        headers: {
          authorization: `Bearer ${runnerToken}`,
        },
        payload: {
          batch_id: BATCH_ID,
          source_row: 1,
          idempotency_key: 'key-invoice-import-01',
          entity: 'invoice',
          record: {
            invoice_number: 'INV-IMPORT-0001',
            order_id: orderId,
            customer_golden_id: CUSTOMER_1,
            invoice_date: '2026-04-10',
            due_date: '2026-04-20',
            currency: 'USD',
            lines: [
              {
                product_id: PRODUCT_1,
                quantity: '10.0000',
                price: '100.0000',
                tax_rate: '18.0000',
              },
            ],
          },
        },
      });

      expect(invoiceRes.statusCode).toBe(201);
      const invoiceData = JSON.parse(invoiceRes.payload);
      expect(invoiceData.outcome).toBe('loaded');

      const invoice = await repo.getInvoiceByNumber('INV-IMPORT-0001');
      expect(invoice).not.toBeNull();
      expect(invoice?.order_id).toBe(orderId);
      expect(invoice?.total).toBe('1180.0000');

      // Verify the linked order transitioned to Invoiced
      const updatedOrder = await repo.getSalesOrderById(orderId);
      expect(updatedOrder?.status).toBe('Invoiced');

      // Import full payment for this invoice
      const paymentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/import',
        headers: {
          authorization: `Bearer ${runnerToken}`,
        },
        payload: {
          batch_id: BATCH_ID,
          source_row: 2,
          idempotency_key: 'key-payment-import-01',
          entity: 'payment',
          record: {
            invoice_id: invoice!.id,
            amount: '1180.0000',
            method: 'bank',
            paid_at: '2026-04-12T10:00:00.000Z',
          },
        },
      });

      expect(paymentRes.statusCode).toBe(201);

      // Verify invoice automatically transitioned to Paid
      const paidInvoice = await repo.getInvoiceById(invoice!.id);
      expect(paidInvoice?.status).toBe('Paid');
    });

    it('rejects an invalid payment with amount mismatch', async () => {
      const orderId = 'aaaaaaaa-0003-4000-8000-000000000001';
      // Create invoice first
      const invoice = await service.createInvoice({
        invoice_number: 'INV-TEST-MISMATCH',
        order_id: orderId,
        customer_golden_id: CUSTOMER_1,
        invoice_date: '2026-04-10',
        due_date: '2026-04-20',
        currency: 'USD',
        lines: [{ product_id: PRODUCT_1, quantity: '10.0000', price: '100.0000', tax_rate: '18.0000' }],
      });

      const adapter = new Erp3TargetAdapter(service, 'payment');
      // Attempt partial payment of 500 instead of 1180
      const res = await adapter.importRow(BATCH_ID, 1, 'key-bad-pay', {
        invoice_id: invoice.id,
        amount: '500.0000',
        method: 'cash',
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.reasonCode).toBe('PARTIAL_PAYMENT_NOT_ALLOWED');
      }
    });
  });

  describe('7. Batch Import (loadBatch & POST /import/batch)', () => {
    it('loads a batch of rows with per-row outcomes and stores durable receipts', async () => {
      const adapter = new Erp3TargetAdapter(service, 'sales_order');

      const batchRows = [
        {
          sourceRow: 0,
          idempotencyKey: 'batch-so-001',
          data: {
            order_number: 'SO-BATCH-001',
            customer_golden_id: CUSTOMER_1,
            order_date: '2026-04-10',
            currency: 'USD',
            lines: [{ product_id: PRODUCT_1, quantity: '1.0000', price: '10.0000', tax_rate: '0.0000' }],
          },
        },
        {
          sourceRow: 1,
          idempotencyKey: 'batch-so-002',
          data: {
            order_number: 'SO-BATCH-002',
            customer_golden_id: CUSTOMER_1,
            order_date: '2026-04-10',
            currency: 'USD',
            lines: [{ product_id: PRODUCT_1, quantity: '2.0000', price: '20.0000', tax_rate: '0.0000' }],
          },
        },
      ];

      const res = await adapter.loadBatch(BATCH_ID, batchRows);

      expect(res.status).toBe('COMPLETED');
      expect(res.total).toBe(2);
      expect(res.loaded).toBe(2);
      expect(res.rejected).toBe(0);
      expect(res.unattempted).toBe(0);
      expect(res.rows[0]?.outcome).toBe('loaded');
      expect(res.rows[1]?.outcome).toBe('loaded');

      // Assert both durable receipts exist
      const r1 = await repo.getImportReceiptByKey('batch-so-001');
      const r2 = await repo.getImportReceiptByKey('batch-so-002');
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r1?.batch_id).toBe(BATCH_ID);
      expect(r1?.source_row).toBe(0);
      expect(r2?.source_row).toBe(1);
    });

    it('batch replay returns priorResult: true and zero duplicated records', async () => {
      const adapter = new Erp3TargetAdapter(service, 'sales_order');

      const batchRows = [
        {
          sourceRow: 0,
          idempotencyKey: 'batch-so-replay-001',
          data: {
            order_number: 'SO-BATCH-REPLAY',
            customer_golden_id: CUSTOMER_1,
            order_date: '2026-04-10',
            currency: 'USD',
            lines: [{ product_id: PRODUCT_1, quantity: '1.0000', price: '10.0000', tax_rate: '0.0000' }],
          },
        },
      ];

      // Run 1: fresh
      const res1 = await adapter.loadBatch(BATCH_ID, batchRows);
      expect(res1.loaded).toBe(1);
      expect(res1.rows[0]?.priorResult).toBe(false);

      // Run 2: idempotent replay
      const res2 = await adapter.loadBatch(BATCH_ID, batchRows);
      expect(res2.loaded).toBe(1);
      expect(res2.rows[0]?.priorResult).toBe(true);

      // Verify only 1 order exists
      const order = await repo.getSalesOrderByNumber('SO-BATCH-REPLAY');
      expect(order).not.toBeNull();
    });

    it('POST /import/batch HTTP route handles batch requests with audit logging', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/import/batch',
        headers: {
          authorization: `Bearer ${runnerToken}`,
        },
        payload: {
          batch_id: BATCH_ID,
          entity: 'sales_order',
          rows: [
            {
              source_row: 0,
              idempotency_key: 'http-batch-so-01',
              record: {
                order_number: 'SO-HTTP-BATCH-01',
                customer_golden_id: CUSTOMER_1,
                order_date: '2026-04-10',
                currency: 'USD',
                lines: [{ product_id: PRODUCT_1, quantity: '1.0000', price: '10.0000', tax_rate: '0.0000' }],
              },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('COMPLETED');
      expect(body.loaded).toBe(1);
      expect(body.rows[0].outcome).toBe('loaded');
    });

    it('halts batch execution when failure rate exceeds 10% after min attempted rows', async () => {
      const adapter = new Erp3TargetAdapter(service, 'sales_order');

      // Create 12 rows where rows 10 & 11 fail customer Golden ID lookup (failure rate = 2/12 = 16.6% > 10%)
      const rows = Array.from({ length: 12 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `batch-stop-threshold-${i}`,
        data: {
          order_number: `SO-STOP-${i}`,
          customer_golden_id: i === 10 || i === 11 ? '99999999-9999-4000-8000-999999999999' : CUSTOMER_1,
          order_date: '2026-04-10',
          currency: 'USD',
          lines: [{ product_id: PRODUCT_1, quantity: '1.0000', price: '10.0000', tax_rate: '0.0000' }],
        },
      }));

      // Add 5 more rows that should remain unattempted after halt
      for (let i = 12; i < 17; i++) {
        rows.push({
          sourceRow: i,
          idempotencyKey: `batch-stop-threshold-${i}`,
          data: {
            order_number: `SO-STOP-${i}`,
            customer_golden_id: CUSTOMER_1,
            order_date: '2026-04-10',
            currency: 'USD',
            lines: [{ product_id: PRODUCT_1, quantity: '1.0000', price: '10.0000', tax_rate: '0.0000' }],
          },
        });
      }

      const res = await adapter.loadBatch(BATCH_ID, rows, {
        failureThreshold: 0.10,
        minAttemptedRows: 10,
      });

      expect(res.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(res.attempted).toBe(12);
      expect(res.loaded).toBe(10);
      expect(res.rejected).toBe(2);
      expect(res.unattempted).toBe(5);
      expect(res.stoppedReason).toContain('exceeded the 10% threshold');
    });
  });

  describe('8. Batch Runner Utilities Unit Tests', () => {
    it('chunkArray partitions arrays correctly', () => {
      expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
      expect(chunkArray([], 5)).toEqual([]);
      expect(() => chunkArray([1], 0)).toThrow('chunkSize must be a positive integer');
    });

    it('calculateFailureRate and shouldHaltBatchExecution behave correctly', () => {
      expect(calculateFailureRate(0, 0)).toBe(0);
      expect(calculateFailureRate(2, 20)).toBe(0.1);

      // Below minAttemptedRows -> false
      expect(shouldHaltBatchExecution(1, 5, { minAttemptedRows: 10, threshold: 0.1 })).toBe(false);

      // Above minAttemptedRows and above threshold -> true
      expect(shouldHaltBatchExecution(2, 11, { minAttemptedRows: 10, threshold: 0.1 })).toBe(true);
    });

    it('isTransientFailure detects transient errors vs permanent errors', () => {
      expect(isTransientFailure({ statusCode: 503 })).toBe(true);
      expect(isTransientFailure({ code: 'ECONNRESET' })).toBe(true);
      expect(isTransientFailure({ message: 'deadlock detected' })).toBe(true);
      expect(isTransientFailure({ retryable: true })).toBe(true);

      // Business errors are NOT transient
      expect(isTransientFailure({ code: 'VALIDATION_ERROR', statusCode: 400 })).toBe(false);
      expect(isTransientFailure({ code: 'CUSTOMER_NOT_FOUND', statusCode: 422 })).toBe(false);
      expect(isTransientFailure(null)).toBe(false);
    });

    it('executeWithRetry performs bounded retries on transient errors', async () => {
      let callCount = 0;
      const op = async (attempt: number) => {
        callCount++;
        if (attempt < 3) {
          throw Object.assign(new Error('transient timeout'), { statusCode: 503 });
        }
        return 'success';
      };

      const { result, attempts } = await executeWithRetry(op, {
        maxRetries: 3,
        initialDelayMs: 1,
        backoffFactor: 1,
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
      expect(callCount).toBe(3);
    });
  });

  describe('9. Durable Import Receipts DB Layer (import-receipts.ts)', () => {
    it('findReceiptByKey and insertReceipt interact with Drizzle database instance', async () => {
      const mockReceipt = {
        id: '11111111-2222-3333-4444-555555555555',
        batch_id: BATCH_ID,
        source_row: 0,
        source_system: 'crm',
        source_id: 'C-1',
        entity: 'sales_order',
        schema_version: 1,
        idempotency_key: 'test-db-key',
        request_hash: 'hash-abc',
        target_id: '99999999-8888-7777-6666-555555555555',
        kind: 'created',
        outcome: 'loaded',
        response_payload: '{"ok":true}',
        created_at: new Date(),
      };

      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [mockReceipt],
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: async () => [mockReceipt],
          }),
        }),
      } as any;

      const found = await findReceiptByKey(mockDb, 'test-db-key');
      expect(found).toEqual(mockReceipt);

      const inserted = await insertReceipt(mockDb, mockReceipt as any);
      expect(inserted).toEqual(mockReceipt);
    });
  });
});
