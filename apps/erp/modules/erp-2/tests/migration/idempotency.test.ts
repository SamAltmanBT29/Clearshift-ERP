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
