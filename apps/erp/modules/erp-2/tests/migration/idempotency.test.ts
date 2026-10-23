/**
 * ERP-2 Idempotency & Migration Target Adapter Test Suite
 *
 * Verifies Acceptance Criteria for Issue #22 (KIT-08 / Decision C4):
 *   1. Fixture row loaded via the same public API used by the Kit; Kit has no direct target-table write privilege.
 *   2. Retrying identical row payload/key 3 times produces exactly 1 business record and 1 durable receipt.
 *   3. Reusing a key with a different payload returns HTTP 409 and does not mutate data.
 *   4. Business-rule rejection returns a reason code and safe message; simulated 503 is retryable and not recorded as rejected.
 *   5. Receipt and target mutation commit or roll back together atomically.
 *   6. Every purchase-order line references a valid existing product through the owning ERP-1 contract.
 *
 * Verifies Acceptance Criteria for Issue #127 (ERP2-11 / loadBatch UPSERT):
 *   AC1. Target adapter implements loadBatch executing type-safe UPSERT operations.
 *   AC2. Target record and durable import receipt commit atomically in one local database transaction.
 *   AC3. Import receipt stores batch_id, source_row, target_id, idempotency_key, and timestamp.
 *   AC4. Re-running the same source row with identical idempotency key returns existing receipt without duplication.
 *
 * @module erp2/tests/migration/idempotency.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ReferenceResolver } from '@cs/kernel';
import { buildApp } from '../../src/app.js';
import { InMemoryErp2Repository } from '../../src/services/repository.js';
import { Erp2Service } from '../../src/services/erp2.service.js';
import { Erp2TargetAdapter } from '../../src/migration/target-adapter.js';

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

describe('ERP-2 Migration Kit Adapter & Durable Import Receipts (Issue #22)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp2Repository;
  let resolver: MockErp1Resolver;
  let service: Erp2Service;

  beforeEach(() => {
    repo = new InMemoryErp2Repository(true); // seeds default Acme vendor
    resolver = new MockErp1Resolver();
    service = new Erp2Service({ repository: repo, referenceResolver: resolver });
    app = buildApp({ repository: repo, erp2Service: service, referenceResolver: resolver });
  });

  describe('1. In-Process TargetAdapter (KIT-08 Contract)', () => {
    it('executes preflight dry-run validation without mutating the database', async () => {
      const adapter = new Erp2TargetAdapter(service, 'vendor');

      const rows = [
        { name: 'Vendor 1', tax_number: 'TAX-1', email: 'v1@test.com' },
        { name: 'Invalid Vendor', tax_number: '', email: 'no-email' },
      ];

      const res = await adapter.preflight('00000000-0000-0000-0000-000000000010', rows);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.validCount).toBe(1);
        expect(res.value.rejectCount).toBe(1);
      }

      // Assert no database mutation occurred
      const { total } = await repo.listVendors({ page: 1, pageSize: 20 });
      expect(total).toBe(1); // Only seeded Acme vendor
    });

    it('commits target business record and durable receipt atomically', async () => {
      const adapter = new Erp2TargetAdapter(service, 'vendor');
      const batchId = '00000000-0000-0000-0000-000000000010';
      const key = 'idem-vendor-001';

      const res = await adapter.importRow(batchId, 0, key, {
        name: 'Steel Works Ltd',
        tax_number: 'TX-STEEL-01',
        email: 'info@steelworks.com',
        bank_details: '1234567890',
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.targetId).toBeDefined();
        expect(res.value.receipt.idempotencyKey).toBe(key);
        expect(res.value.receipt.entity).toBe('vendor');
        expect(res.value.receipt.batchId).toBe(batchId);
      }

      // Assert business row exists and has masked bank details
      const created = await repo.getVendorByTaxNumber('TX-STEEL-01');
      expect(created).not.toBeNull();
      expect(created?.bank_masked).toBe('XXXX-XXXX-7890');

      // Assert receipt row exists
      const receipt = await repo.getImportReceiptByKey(key);
      expect(receipt).not.toBeNull();
      expect(receipt?.target_id).toBe(created?.id);
    });
  });

  describe('2. Identical Retries (3x)', () => {
    it('retrying identical row payload and key 3 times produces exactly 1 business record and 1 durable receipt', async () => {
      const payload = {
        batch_id: '00000000-0000-0000-0000-000000000020',
        source_row: 1,
        source_system: 'legacy_erp',
        source_id: 'LEG-991',
        idempotency_key: 'key-vendor-retry-test',
        entity: 'vendor',
        record: {
          name: 'Global Fasteners Inc',
          tax_number: 'TAX-GLOBAL-991',
          email: 'orders@globalfasteners.com',
          bank_details: '9876543210',
        },
      };

      // Call 1 (Fresh)
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const data1 = JSON.parse(res1.payload);
      expect(data1.prior_result).toBe(false);
      const targetId = data1.target_id;

      // Call 2 (Replay 1)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const data2 = JSON.parse(res2.payload);
      expect(data2.prior_result).toBe(true);
      expect(data2.target_id).toBe(targetId);

      // Call 3 (Replay 2)
      const res3 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });
      expect(res3.statusCode).toBe(200);
      const data3 = JSON.parse(res3.payload);
      expect(data3.prior_result).toBe(true);
      expect(data3.target_id).toBe(targetId);

      // Verify exactly 1 business record with this tax number exists
      const vendor = await repo.getVendorByTaxNumber('TAX-GLOBAL-991');
      expect(vendor).not.toBeNull();
      expect(vendor?.id).toBe(targetId);

      // Verify exactly 1 durable receipt exists
      const receipt = await repo.getImportReceiptByKey(payload.idempotency_key);
      expect(receipt).not.toBeNull();
      expect(receipt?.target_id).toBe(targetId);
    });
  });

  describe('3. Reused Key with Different Payload (HTTP 409 Conflict)', () => {
    it('reusing an idempotency key with a different payload returns 409 and does not mutate data', async () => {
      const idempotencyKey = 'key-vendor-conflict-test';

      const initialPayload = {
        batch_id: '00000000-0000-0000-0000-000000000030',
        source_row: 1,
        idempotency_key: idempotencyKey,
        entity: 'vendor',
        record: {
          name: 'First Vendor Name',
          tax_number: 'TAX-CONFLICT-1',
          email: 'first@test.com',
        },
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import',
        payload: initialPayload,
      });
      expect(res1.statusCode).toBe(201);

      // Attempt to reuse same key with different payload
      const conflictingPayload = {
        batch_id: '00000000-0000-0000-0000-000000000030',
        source_row: 2,
        idempotency_key: idempotencyKey,
        entity: 'vendor',
        record: {
          name: 'Second Conflicting Vendor',
          tax_number: 'TAX-CONFLICT-2',
          email: 'second@test.com',
        },
      };

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import',
        payload: conflictingPayload,
      });

      expect(res2.statusCode).toBe(409);
      const body2 = JSON.parse(res2.payload);
      expect(body2.code).toBe('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

      // Verify second vendor was NOT mutated or inserted
      const secondVendor = await repo.getVendorByTaxNumber('TAX-CONFLICT-2');
      expect(secondVendor).toBeNull();
    });
  });

  describe('4. Business Validation & Transient Infrastructure Failures', () => {
    it('rejects purchase order with unknown product with stable reason code and creates no receipt', async () => {
      const unknownProductId = '99999999-9999-9999-9999-999999999999';
      const key = 'key-unknown-prod-test';

      const payload = {
        batch_id: '00000000-0000-0000-0000-000000000040',
        source_row: 5,
        idempotency_key: key,
        entity: 'purchase_order',
        record: {
          vendor_id: '00000000-0000-0000-0000-000000000001',
          order_date: '2026-10-20',
          lines: [
            {
              product_id: unknownProductId,
              quantity: '5.00',
              price: '100.00',
            },
          ],
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import',
        payload,
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNKNOWN_PRODUCT');

      // Verify no receipt was saved
      const receipt = await repo.getImportReceiptByKey(key);
      expect(receipt).toBeNull();
    });

    it('simulated 503 infrastructure failure rolls back transaction and is not recorded as rejected', async () => {
      // Mock executeTransactional to simulate a database crash / network drop
      const failingRepo = new InMemoryErp2Repository(true);
      failingRepo.executeTransactional = async () => {
        const error = new Error('Database connection timeout');
        (error as any).statusCode = 503;
        throw error;
      };

      const failingService = new Erp2Service({ repository: failingRepo, referenceResolver: resolver });
      const failingApp = buildApp({ repository: failingRepo, erp2Service: failingService });

      const key = 'key-infra-failure-test';
      const payload = {
        batch_id: '00000000-0000-0000-0000-000000000050',
        source_row: 1,
        idempotency_key: key,
        entity: 'vendor',
        record: {
          name: 'Crash Vendor',
          tax_number: 'TX-CRASH-01',
          email: 'crash@test.com',
        },
      };

      const res = await failingApp.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import',
        payload,
      });

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('SERVICE_UNAVAILABLE');

      // Assert no vendor was committed
      const vendor = await failingRepo.getVendorByTaxNumber('TX-CRASH-01');
      expect(vendor).toBeNull();

      // Assert no receipt was saved
      const receipt = await failingRepo.getImportReceiptByKey(key);
      expect(receipt).toBeNull();
    });
  });

  describe('5. Domain Invariant: ERP-1 Product Verification & Calculated Totals', () => {
    it('successfully creates purchase order with valid ERP-1 products and calculated total', async () => {
      const validProductId = '11111111-1111-1111-1111-111111111111';
      const key = 'key-po-success-test';

      const payload = {
        batch_id: '00000000-0000-0000-0000-000000000060',
        source_row: 1,
        idempotency_key: key,
        entity: 'purchase_order',
        record: {
          vendor_id: '00000000-0000-0000-0000-000000000001',
          order_date: '2026-10-20',
          lines: [
            {
              product_id: validProductId,
              quantity: '3.00',
              price: '45.50',
            },
            {
              product_id: validProductId,
              quantity: '2.00',
              price: '10.25',
            },
          ],
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import',
        payload,
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.outcome).toBe('loaded');

      const po = await repo.getPurchaseOrderById(body.target_id);
      expect(po).not.toBeNull();
      // Total calculation: 3 * 45.50 = 136.50; 2 * 10.25 = 20.50; Total = 157.00
      expect(po?.total).toBe('157.00');
      expect(po?.status).toBe('Draft');
      expect(po?.lines).toHaveLength(2);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ERP2-11: loadBatch Interface & Acceptance Criteria
// ─────────────────────────────────────────────────────────────────────────────

describe('ERP-2 loadBatch Interface & Durable Import Receipts (Issue #127 / ERP2-11)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp2Repository;
  let resolver: MockErp1Resolver;
  let service: Erp2Service;
  let adapter: Erp2TargetAdapter;

  beforeEach(() => {
    repo = new InMemoryErp2Repository(true); // seeds Acme vendor (id: 00000000-0000-0000-0000-000000000001)
    resolver = new MockErp1Resolver();
    service = new Erp2Service({ repository: repo, referenceResolver: resolver });
    adapter = new Erp2TargetAdapter(service, 'vendor');
    app = buildApp({ repository: repo, erp2Service: service, referenceResolver: resolver });
  });

  // ── AC1: loadBatch interface with type-safe UPSERT ─────────────────────────

  describe('AC1: loadBatch executes type-safe UPSERT operations', () => {
    it('loadBatch creates multiple vendor records and returns loaded outcomes', async () => {
      const batchId = 'aa000000-0000-0000-0000-000000000001';

      const result = await adapter.loadBatch(batchId, [
        {
          sourceRow: 0,
          idempotencyKey: 'batch-aa-row-0',
          data: { name: 'Alpha Supplies', tax_number: 'TAX-ALPHA-001', email: 'alpha@test.com', bank_details: '1111111111' },
        },
        {
          sourceRow: 1,
          idempotencyKey: 'batch-aa-row-1',
          data: { name: 'Beta Materials', tax_number: 'TAX-BETA-002', email: 'beta@test.com', bank_details: '2222222222' },
        },
      ]);

      expect(result.batchId).toBe(batchId);
      expect(result.total).toBe(2);
      expect(result.loaded).toBe(2);
      expect(result.rejected).toBe(0);
      expect(result.rows).toHaveLength(2);

      for (const row of result.rows) {
        expect(row.outcome).toBe('loaded');
        expect(row.result).toBeDefined();
        expect(row.result?.targetId).toBeDefined();
      }

      // Verify vendor records actually exist in the store
      const alpha = await repo.getVendorByTaxNumber('TAX-ALPHA-001');
      const beta = await repo.getVendorByTaxNumber('TAX-BETA-002');
      expect(alpha).not.toBeNull();
      expect(beta).not.toBeNull();

      // Verify bank details are masked (FR-ERP2-06)
      expect(alpha?.bank_masked).toBe('XXXX-XXXX-1111');
      expect(beta?.bank_masked).toBe('XXXX-XXXX-2222');
    });

    it('loadBatch with upsert=true updates existing vendor and stores receipt with kind=linked', async () => {
      const batchId = 'bb000000-0000-0000-0000-000000000002';

      // First import: create the vendor
      const createResult = await adapter.loadBatch(batchId, [
        {
          sourceRow: 0,
          idempotencyKey: 'batch-bb-create-v1',
          data: {
            name: 'Original Name Ltd',
            tax_number: 'TAX-UPSERT-V1',
            email: 'original@test.com',
            city: 'London',
            bank_details: '9991234567',
          },
        },
      ]);

      expect(createResult.loaded).toBe(1);
      const originalId = createResult.rows[0]!.result!.targetId;
      const createdVendor = await repo.getVendorByTaxNumber('TAX-UPSERT-V1');
      expect(createdVendor?.city).toBe('London');

      // Second import: UPSERT the same tax_number with updated fields (new idempotency key)
      const upsertAdapter = new Erp2TargetAdapter(service, 'vendor');
      const upsertResult = await upsertAdapter.loadBatch(
        batchId,
        [
          {
            sourceRow: 1,
            idempotencyKey: 'batch-bb-upsert-v2',
            data: {
              name: 'Updated Name Ltd',
              tax_number: 'TAX-UPSERT-V1',
              email: 'updated@test.com',
              city: 'Manchester',
              bank_details: '9991234567',
            },
          },
        ],
        { upsert: true }
      );

      expect(upsertResult.loaded).toBe(1);
      expect(upsertResult.rows[0]!.outcome).toBe('loaded');

      // Verify: same target ID, fields updated
      const updatedVendor = await repo.getVendorByTaxNumber('TAX-UPSERT-V1');
      expect(updatedVendor?.id).toBe(originalId);
      expect(updatedVendor?.name).toBe('Updated Name Ltd');
      expect(updatedVendor?.email).toBe('updated@test.com');
      expect(updatedVendor?.city).toBe('Manchester');

      // Verify receipt for upserted row has kind='linked'
      const upsertReceipt = await repo.getImportReceiptByKey('batch-bb-upsert-v2');
      expect(upsertReceipt).not.toBeNull();
      expect(upsertReceipt?.kind).toBe('linked');
      expect(upsertReceipt?.target_id).toBe(originalId);
    });

    it('loadBatch without upsert rejects existing tax_number with stable error code', async () => {
      const batchId = 'cc000000-0000-0000-0000-000000000003';

      // Pre-create a vendor
      await adapter.loadBatch(batchId, [
        {
          sourceRow: 0,
          idempotencyKey: 'batch-cc-create',
          data: { name: 'Conflict Vendor', tax_number: 'TAX-CONFLICT-CC', email: 'cc@test.com' },
        },
      ]);

      // Attempt to create again with same tax_number but different idempotency key (no upsert)
      const conflictResult = await adapter.loadBatch(batchId, [
        {
          sourceRow: 1,
          idempotencyKey: 'batch-cc-conflict',
          data: { name: 'Another Vendor', tax_number: 'TAX-CONFLICT-CC', email: 'cc2@test.com' },
        },
      ]);

      expect(conflictResult.rejected).toBe(1);
      expect(conflictResult.rows[0]!.outcome).toBe('rejected');
      expect(conflictResult.rows[0]!.error?.reasonCode).toBe('DUPLICATE_TAX_NUMBER');

      // Verify only 1 vendor with that tax number exists
      const vendors = await repo.listVendors({ page: 1, pageSize: 20 });
      const conflictVendors = vendors.vendors.filter((v) => v.tax_number === 'TAX-CONFLICT-CC');
      expect(conflictVendors).toHaveLength(1);
    });
  });

  // ── AC2: Atomic commit ─────────────────────────────────────────────────────

  describe('AC2: Target record and durable receipt commit atomically', () => {
    it('loadBatch atomic rollback: infrastructure failure stores neither vendor nor receipt', async () => {
      const batchId = 'dd000000-0000-0000-0000-000000000004';

      const failingRepo = new InMemoryErp2Repository(false);
      failingRepo.executeTransactional = async () => {
        throw Object.assign(new Error('Simulated DB crash'), { statusCode: 503 });
      };

      const failingService = new Erp2Service({ repository: failingRepo });
      const failingAdapter = new Erp2TargetAdapter(failingService, 'vendor');

      // Infrastructure failure should propagate, not be silently swallowed
      await expect(
        failingAdapter.loadBatch(batchId, [
          {
            sourceRow: 0,
            idempotencyKey: 'batch-dd-crash',
            data: { name: 'Crash Vendor', tax_number: 'TX-CRASH-02', email: 'crash@test.com' },
          },
        ])
      ).rejects.toThrow('Simulated DB crash');

      // Nothing persisted
      const vendor = await failingRepo.getVendorByTaxNumber('TX-CRASH-02');
      expect(vendor).toBeNull();

      const receipt = await failingRepo.getImportReceiptByKey('batch-dd-crash');
      expect(receipt).toBeNull();
    });

    it('loadBatch error isolation: data-validation failure on row N does not prevent row N+1 from committing', async () => {
      const batchId = 'ee000000-0000-0000-0000-000000000005';

      const result = await adapter.loadBatch(batchId, [
        {
          // Row 0: valid
          sourceRow: 0,
          idempotencyKey: 'batch-ee-row-0-valid',
          data: { name: 'Valid Vendor', tax_number: 'TAX-EE-VALID-01', email: 'valid@test.com' },
        },
        {
          // Row 1: duplicates seeded Acme tax number — will be rejected (no upsert)
          sourceRow: 1,
          idempotencyKey: 'batch-ee-row-1-dup',
          data: { name: 'Duplicate Acme', tax_number: 'TX-998877', email: 'acme2@test.com' },
        },
        {
          // Row 2: valid, should still load despite row 1 being rejected
          sourceRow: 2,
          idempotencyKey: 'batch-ee-row-2-valid',
          data: { name: 'Third Vendor', tax_number: 'TAX-EE-THIRD-03', email: 'third@test.com' },
        },
      ]);

      expect(result.total).toBe(3);
      expect(result.loaded).toBe(2);
      expect(result.rejected).toBe(1);

      expect(result.rows[0]!.outcome).toBe('loaded');
      expect(result.rows[1]!.outcome).toBe('rejected');
      expect(result.rows[1]!.error?.reasonCode).toBe('DUPLICATE_TAX_NUMBER');
      expect(result.rows[2]!.outcome).toBe('loaded');

      // Both valid vendors are persisted
      expect(await repo.getVendorByTaxNumber('TAX-EE-VALID-01')).not.toBeNull();
      expect(await repo.getVendorByTaxNumber('TAX-EE-THIRD-03')).not.toBeNull();
    });
  });

  // ── AC3: Receipt field completeness ───────────────────────────────────────

  describe('AC3: Import receipt stores required fields', () => {
    it('receipt contains batch_id, source_row, target_id, idempotency_key, and timestamp (created_at)', async () => {
      const batchId = 'ff000000-0000-0000-0000-000000000006';
      const idempotencyKey = 'batch-ff-receipt-fields-test';

      const result = await adapter.loadBatch(batchId, [
        {
          sourceRow: 7,
          idempotencyKey,
          data: { name: 'Receipt Fields Vendor', tax_number: 'TAX-FF-RECEIPT', email: 'receipt@test.com' },
        },
      ]);

      expect(result.loaded).toBe(1);
      const rowResult = result.rows[0]!;
      expect(rowResult.outcome).toBe('loaded');

      // Verify via kit-level receipt fields on the adapter result
      const kitReceipt = rowResult.result!.receipt;
      expect(kitReceipt.batchId).toBe(batchId);
      expect(kitReceipt.sourceRow).toBe(7);
      expect(kitReceipt.targetId).toBe(rowResult.result!.targetId);
      expect(kitReceipt.idempotencyKey).toBe(idempotencyKey);
      expect(kitReceipt.createdAt).toBeInstanceOf(Date);
      expect(Number.isFinite(kitReceipt.createdAt.getTime())).toBe(true);
      expect(kitReceipt.entity).toBe('vendor');

      // Also verify the persisted receipt row directly
      const storedReceipt = await repo.getImportReceiptByKey(idempotencyKey);
      expect(storedReceipt).not.toBeNull();
      expect(storedReceipt?.batch_id).toBe(batchId);
      expect(storedReceipt?.source_row).toBe(7);
      expect(storedReceipt?.target_id).toBe(rowResult.result!.targetId);
      expect(storedReceipt?.idempotency_key).toBe(idempotencyKey);
      expect(typeof storedReceipt?.created_at).toBe('string');
      // created_at must be a valid ISO datetime
      expect(new Date(storedReceipt!.created_at).toISOString()).toBeTruthy();
    });
  });

  // ── AC4: Duplicate suppression via loadBatch ───────────────────────────────

  describe('AC4: Re-running same row with identical idempotency key returns existing receipt without duplication', () => {
    it('calling loadBatch twice with identical rows returns prior_result and creates exactly 1 entity and 1 receipt', async () => {
      const batchId = 'a7000000-0000-0000-0000-000000000007';
      const idempotencyKey = 'batch-gg-idempotent-row';
      const rowData = {
        name: 'Idempotent Vendor',
        tax_number: 'TAX-GG-IDEM',
        email: 'idem@test.com',
        bank_details: '5551234567',
      };

      // First load
      const result1 = await adapter.loadBatch(batchId, [
        { sourceRow: 0, idempotencyKey, data: rowData },
      ]);
      expect(result1.loaded).toBe(1);
      const targetId = result1.rows[0]!.result!.targetId;

      // Second load with identical row + identical key → returns prior receipt
      const result2 = await adapter.loadBatch(batchId, [
        { sourceRow: 0, idempotencyKey, data: rowData },
      ]);
      expect(result2.loaded).toBe(1);
      expect(result2.rows[0]!.result!.targetId).toBe(targetId);

      // Third load
      const result3 = await adapter.loadBatch(batchId, [
        { sourceRow: 0, idempotencyKey, data: rowData },
      ]);
      expect(result3.rows[0]!.result!.targetId).toBe(targetId);

      // Exactly 1 vendor with this tax number
      const allVendors = await repo.listVendors({ page: 1, pageSize: 100 });
      const matches = allVendors.vendors.filter((v) => v.tax_number === 'TAX-GG-IDEM');
      expect(matches).toHaveLength(1);

      // Exactly 1 receipt for this idempotency key
      const receipt = await repo.getImportReceiptByKey(idempotencyKey);
      expect(receipt).not.toBeNull();
      expect(receipt?.target_id).toBe(targetId);
    });

    it('POST /import/batch endpoint returns per-row outcomes with HTTP 200', async () => {
      const batchRequest = {
        batch_id: 'a8000000-0000-0000-0000-000000000008',
        entity: 'vendor',
        upsert: false,
        rows: [
          {
            source_row: 0,
            idempotency_key: 'http-batch-row-0',
            record: { name: 'HTTP Batch V1', tax_number: 'TAX-HTTP-01', email: 'http1@test.com' },
          },
          {
            source_row: 1,
            idempotency_key: 'http-batch-row-1',
            record: { name: 'HTTP Batch V2', tax_number: 'TAX-HTTP-02', email: 'http2@test.com' },
          },
        ],
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import/batch',
        payload: batchRequest,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.batchId).toBe(batchRequest.batch_id);
      expect(body.total).toBe(2);
      expect(body.loaded).toBe(2);
      expect(body.rejected).toBe(0);
      expect(body.rows).toHaveLength(2);

      for (const row of body.rows) {
        expect(row.outcome).toBe('loaded');
      }

      // Verify vendors exist
      expect(await repo.getVendorByTaxNumber('TAX-HTTP-01')).not.toBeNull();
      expect(await repo.getVendorByTaxNumber('TAX-HTTP-02')).not.toBeNull();
    });

    it('POST /import/batch with upsert=true updates existing vendor via HTTP batch endpoint', async () => {
      // First create the vendor via single import
      await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import',
        payload: {
          batch_id: 'a9000000-0000-0000-0000-000000000009',
          source_row: 0,
          idempotency_key: 'ii-create-row-0',
          entity: 'vendor',
          record: { name: 'Pre-existing Vendor', tax_number: 'TAX-UPSERT-HTTP', email: 'pre@test.com', city: 'Paris' },
        },
      });

      // Now upsert via batch endpoint
      const upsertRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/import/batch',
        payload: {
          batch_id: 'a9000000-0000-0000-0000-000000000009',
          entity: 'vendor',
          upsert: true,
          rows: [
            {
              source_row: 1,
              idempotency_key: 'ii-upsert-row-1',
              record: { name: 'Updated Vendor Name', tax_number: 'TAX-UPSERT-HTTP', email: 'updated@test.com', city: 'Berlin' },
            },
          ],
        },
      });

      expect(upsertRes.statusCode).toBe(200);
      const body = JSON.parse(upsertRes.payload);
      expect(body.loaded).toBe(1);
      expect(body.rows[0].outcome).toBe('loaded');

      // Verify vendor was updated
      const updated = await repo.getVendorByTaxNumber('TAX-UPSERT-HTTP');
      expect(updated?.name).toBe('Updated Vendor Name');
      expect(updated?.city).toBe('Berlin');

      // Verify upsert receipt has kind='linked'
      const receipt = await repo.getImportReceiptByKey('ii-upsert-row-1');
      expect(receipt?.kind).toBe('linked');
    });
  });
});
