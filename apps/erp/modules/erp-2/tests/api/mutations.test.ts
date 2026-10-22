/**
 * ERP-2 Vendors & Purchasing — Mutation API and Domain Validation Test Suite
 *
 * Exhaustively validates the write surface for Issue #18 (ERP2-03):
 *   - AC-1: Route-boundary Zod validation & authorization (400 / 401)
 *   - AC-2: Domain invariant enforcement at service & API level (422 / 409 / 404)
 *   - AC-3: Invalid business values return 422; duplicate tax numbers / key conflicts return 409
 *   - AC-4: Repeated import request with same idempotency key returns original receipt (200)
 *   - AC-5: Unexpected failures return correlation ID and do not leak SQL, secrets or stack traces
 *   - AC-6: Product reference validation via ERP-1 contract (BR-ERP2-01)
 *   - AC-7: Order total server-side recomputation from lines via Decimal arithmetic (FR-ERP2-05)
 *   - AC-8: Strict unidirectional PO status transition Draft -> Sent -> Received -> Closed (FR-ERP2-04)
 *   - AC-9: Server-side bank detail masking XXXX-XXXX-7890 (FR-ERP2-02, FR-ERP2-06)
 *   - AC-10: Protected/system-maintained fields are never accepted from browser
 *
 * @module erp2/tests/api/mutations.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ReferenceResolver } from '@cs/kernel';
import { buildApp } from '../../src/app.js';
import { InMemoryErp2Repository } from '../../src/services/repository.js';
import { Erp2Service } from '../../src/services/erp2.service.js';

class MockErp1Resolver implements ReferenceResolver {
  public validProducts = new Set<string>([
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
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

describe('ERP-2 Mutation API & Domain Validation (Issue #18 / ERP2-03)', () => {
  let app: FastifyInstance;
  let authApp: FastifyInstance;
  let repo: InMemoryErp2Repository;
  let resolver: MockErp1Resolver;
  let service: Erp2Service;

  const VENDOR_ID = '00000000-0000-0000-0000-000000000001';
  const VALID_PRODUCT_1 = '11111111-1111-1111-1111-111111111111';
  const VALID_PRODUCT_2 = '22222222-2222-2222-2222-222222222222';
  const UNKNOWN_PRODUCT = '99999999-9999-9999-9999-999999999999';

  const AUTH_HEADER = { authorization: 'Bearer role:editor' };

  beforeEach(() => {
    repo = new InMemoryErp2Repository(true); // seeds default Acme vendor
    resolver = new MockErp1Resolver();
    service = new Erp2Service({ repository: repo, referenceResolver: resolver });

    app = buildApp({
      repository: repo,
      erp2Service: service,
      referenceResolver: resolver,
      authRequired: false,
    });

    authApp = buildApp({
      repository: repo,
      erp2Service: service,
      referenceResolver: resolver,
      authRequired: true,
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. POST /api/v1/erp-vendors/vendors (Vendor Creation & Masking)
  // ───────────────────────────────────────────────────────────────────────────
  describe('POST /api/v1/erp-vendors/vendors', () => {
    it('creates a vendor and masks bank details server-side (FR-ERP2-02, FR-ERP2-06)', async () => {
      const payload = {
        name: 'Apex Industrial Parts',
        tax_number: 'TX-APEX-001',
        email: 'orders@apex-parts.com',
        phone: '+1-555-0144',
        address_line: '420 Manufacturing Blvd',
        city: 'Detroit',
        country: 'USA',
        bank_details: '1234567890123456', // Raw sensitive bank account
        currency: 'USD',
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload,
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Apex Industrial Parts');
      expect(body.tax_number).toBe('TX-APEX-001');
      expect(body.email).toBe('orders@apex-parts.com');
      // Bank details MUST be masked, raw account never returned
      expect(body.bank_masked).toBe('XXXX-XXXX-3456');
      expect(body).not.toHaveProperty('bank_details');
    });

    it('rejects invalid request body with 400 and field details', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: '', // Empty name
          tax_number: 'TX-1',
          email: 'not-an-email', // Invalid email
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'name' }),
          expect.objectContaining({ field: 'email' }),
        ])
      );
    });

    it('rejects duplicate tax number with 409 Conflict', async () => {
      const payload = {
        name: 'Duplicate Vendor Co',
        tax_number: 'TX-998877', // Same tax number as seed Acme vendor
        email: 'dup@example.com',
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload,
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('DUPLICATE_TAX_NUMBER');
      expect(body.message).toContain('TX-998877');
    });

    it('enforces authentication when authRequired is active (AC-1)', async () => {
      const res = await authApp.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'Secure Vendor',
          tax_number: 'TX-SEC-01',
          email: 'sec@example.com',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('allows authenticated requests with valid Bearer token', async () => {
      const res = await authApp.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        headers: AUTH_HEADER,
        payload: {
          name: 'Authenticated Vendor',
          tax_number: 'TX-AUTH-01',
          email: 'auth@example.com',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.name).toBe('Authenticated Vendor');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. PATCH /api/v1/erp-vendors/vendors/:id (Vendor Updates & Field Protection)
  // ───────────────────────────────────────────────────────────────────────────
  describe('PATCH /api/v1/erp-vendors/vendors/:id', () => {
    it('updates allowed editable fields and masks updated bank details', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/vendors/${VENDOR_ID}`,
        payload: {
          name: 'Acme Industrial Supplies International',
          phone: '+1-555-9999',
          bank_details: '9876543210987654', // Update sensitive bank details
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.id).toBe(VENDOR_ID);
      expect(body.name).toBe('Acme Industrial Supplies International');
      expect(body.phone).toBe('+1-555-9999');
      expect(body.bank_masked).toBe('XXXX-XXXX-7654');
    });

    it('returns 404 for nonexistent vendor ID', async () => {
      const nonExistent = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/vendors/${nonExistent}`,
        payload: { name: 'New Name' },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('returns 400 for malformed UUID in route parameter', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/erp-vendors/vendors/invalid-uuid-123',
        payload: { name: 'New Name' },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INVALID_UUID');
    });

    it('rejects duplicate tax number update with 409 Conflict', async () => {
      // Create second vendor
      const v2 = await repo.createVendor(
        {
          name: 'Second Vendor',
          tax_number: 'TX-V2-UNIQUE',
          email: 'v2@example.com',
        },
        null
      );

      // Attempt to update Acme's tax number to Second Vendor's tax number
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/vendors/${VENDOR_ID}`,
        payload: { tax_number: 'TX-V2-UNIQUE' },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('DUPLICATE_TAX_NUMBER');
    });

    it('ignores protected/system fields submitted by client (AC-10)', async () => {
      const original = await repo.getVendorById(VENDOR_ID);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/vendors/${VENDOR_ID}`,
        payload: {
          name: 'Acme Protected Test',
          // Client attempts to overwrite protected fields:
          id: '99999999-9999-9999-9999-999999999999',
          created_at: '2020-01-01T00:00:00.000Z',
          bank_masked: 'XXXX-XXXX-0000',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      // ID and bank_masked remain protected from direct overwrite
      expect(body.id).toBe(VENDOR_ID);
      expect(body.bank_masked).toBe(original?.bank_masked);
      expect(body.name).toBe('Acme Protected Test');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. POST /api/v1/erp-vendors/purchase-orders (PO Creation, Totals, ERP-1)
  // ───────────────────────────────────────────────────────────────────────────
  describe('POST /api/v1/erp-vendors/purchase-orders', () => {
    it('creates a PO with lines, default Draft status, and server-recomputed totals (FR-ERP2-03, FR-ERP2-05)', async () => {
      const payload = {
        vendor_id: VENDOR_ID,
        order_date: '2026-10-25',
        currency: 'USD',
        lines: [
          {
            product_id: VALID_PRODUCT_1,
            quantity: '10.00',
            price: '15.50', // 155.00
          },
          {
            product_id: VALID_PRODUCT_2,
            quantity: '3.00',
            price: '20.25', // 60.75
          },
        ],
        // Client attempts to provide incorrect total:
        total: '10.00',
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload,
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.id).toBeDefined();
      expect(body.vendor_id).toBe(VENDOR_ID);
      expect(body.status).toBe('Draft');
      // Server-side recomputed: 155.00 + 60.75 = 215.75 (client total ignored)
      expect(body.total).toBe('215.75');
      expect(body.lines).toHaveLength(2);
      expect(body.lines[0].line_total).toBe('155.00');
      expect(body.lines[1].line_total).toBe('60.75');
    });

    it('rejects purchase order if product does not exist in ERP-1 (BR-ERP2-01, AC-6)', async () => {
      const payload = {
        vendor_id: VENDOR_ID,
        order_date: '2026-10-25',
        lines: [
          {
            product_id: UNKNOWN_PRODUCT, // Nonexistent product ID
            quantity: '5.00',
            price: '10.00',
          },
        ],
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload,
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNKNOWN_PRODUCT');
      expect(body.message).toContain(UNKNOWN_PRODUCT);
    });

    it('rejects purchase order if vendor does not exist (AC-3)', async () => {
      const nonExistentVendor = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const payload = {
        vendor_id: nonExistentVendor,
        order_date: '2026-10-25',
        lines: [
          {
            product_id: VALID_PRODUCT_1,
            quantity: '2.00',
            price: '50.00',
          },
        ],
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload,
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('VENDOR_NOT_FOUND');
    });

    it('rejects empty lines array with 400 Bad Request', async () => {
      const payload = {
        vendor_id: VENDOR_ID,
        order_date: '2026-10-25',
        lines: [],
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. PATCH /api/v1/erp-vendors/purchase-orders/:id (Status FSM Invariants)
  // ───────────────────────────────────────────────────────────────────────────
  describe('PATCH /api/v1/erp-vendors/purchase-orders/:id (Status Transitions)', () => {
    let poId: string;

    beforeEach(async () => {
      const po = await service.createPurchaseOrder({
        vendor_id: VENDOR_ID,
        order_date: '2026-10-20',
        currency: 'USD',
        lines: [
          {
            product_id: VALID_PRODUCT_1,
            quantity: '1.00',
            price: '100.00',
          },
        ],
      });
      poId = po.id;
    });

    it('allows sequential forward progression Draft -> Sent -> Received -> Closed (FR-ERP2-04)', async () => {
      // 1. Draft -> Sent
      const r1 = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Sent' },
      });
      expect(r1.statusCode).toBe(200);
      expect(JSON.parse(r1.payload).status).toBe('Sent');

      // 2. Sent -> Received
      const r2 = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Received' },
      });
      expect(r2.statusCode).toBe(200);
      expect(JSON.parse(r2.payload).status).toBe('Received');

      // 3. Received -> Closed
      const r3 = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Closed' },
      });
      expect(r3.statusCode).toBe(200);
      expect(JSON.parse(r3.payload).status).toBe('Closed');
    });

    it('rejects skipping states (Draft -> Received) with 422 Unprocessable Entity', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Received' },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INVALID_STATUS_TRANSITION');
      expect(body.message).toContain("Allowed forward flow is Draft -> Sent -> Received -> Closed");
    });

    it('rejects skipping states (Draft -> Closed) with 422', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Closed' },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('rejects backward transitions (Sent -> Draft) with 422', async () => {
      // Move to Sent first
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Sent' },
      });

      // Attempt backward to Draft
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Draft' },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('rejects transitions from Closed terminal state with 422', async () => {
      // Move Draft -> Sent -> Received -> Closed
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Sent' },
      });
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Received' },
      });
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Closed' },
      });

      // Attempt transition from Closed to any state
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Received' },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('returns 404 for nonexistent purchase order', async () => {
      const nonExistent = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${nonExistent}`,
        payload: { status: 'Sent' },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Idempotent Import Mutations & Dual-Write Receipts (AC-4, KIT-08)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Migration Import & Idempotency Dual-Write (AC-4, KIT-08)', () => {
    it('creates vendor with durable receipt and returns original on replay without re-mutating', async () => {
      const batchId = randomUUID();
      const idempotencyKey = `batch-${batchId}-row-1`;

      const payload = {
        name: 'Imported Vendor LLC',
        tax_number: 'TX-IMPORT-001',
        email: 'imported@llc.com',
        batch_id: batchId,
        source_row: 1,
        idempotency_key: idempotencyKey,
      };

      // 1. Initial request: 201 Created
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload,
      });

      expect(res1.statusCode).toBe(201);
      const vendor1 = JSON.parse(res1.payload);
      expect(vendor1.name).toBe('Imported Vendor LLC');

      // Verify receipt stored
      const receipt = await repo.getImportReceiptByKey(idempotencyKey);
      expect(receipt).not.toBeNull();
      expect(receipt?.target_id).toBe(vendor1.id);
      expect(receipt?.outcome).toBe('loaded');

      // 2. Replay with exact same idempotency key and payload: 200 OK (prior result)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload,
      });

      expect(res2.statusCode).toBe(200);
      const vendor2 = JSON.parse(res2.payload);
      expect(vendor2.id).toBe(vendor1.id);

      // Verify no duplicate vendor was created in repository
      const allVendors = await repo.listVendors({ page: 1, pageSize: 100 });
      const matches = allVendors.vendors.filter((v) => v.tax_number === 'TX-IMPORT-001');
      expect(matches).toHaveLength(1);
    });

    it('rejects idempotency key reuse with mismatched payload with 409 Conflict', async () => {
      const batchId = randomUUID();
      const idempotencyKey = `batch-${batchId}-row-2`;

      // 1. First request
      await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'First Payload Corp',
          tax_number: 'TX-PAYLOAD-1',
          email: 'first@corp.com',
          batch_id: batchId,
          source_row: 2,
          idempotency_key: idempotencyKey,
        },
      });

      // 2. Second request reusing key with altered payload
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'Completely Different Company',
          tax_number: 'TX-PAYLOAD-DIFFERENT',
          email: 'diff@corp.com',
          batch_id: batchId,
          source_row: 2,
          idempotency_key: idempotencyKey,
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    });

    it('accepts idempotency key provided via Idempotency-Key HTTP header', async () => {
      const batchId = randomUUID();
      const keyHeader = `hdr-key-${randomUUID()}`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        headers: {
          'idempotency-key': keyHeader,
        },
        payload: {
          name: 'Header Idempotency Inc',
          tax_number: 'TX-HDR-KEY-1',
          email: 'hdr@example.com',
          batch_id: batchId,
          source_row: 5,
        },
      });

      expect(res.statusCode).toBe(201);
      const receipt = await repo.getImportReceiptByKey(keyHeader);
      expect(receipt).not.toBeNull();
      expect(receipt?.idempotency_key).toBe(keyHeader);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Security, Correlation IDs & Unexpected Failures (AC-5)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Error Envelope & Security Protections (AC-5)', () => {
    it('propagates x-correlation-id in header and payload on all errors', async () => {
      const testCorrelationId = 'test-corr-id-12345';
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors/invalid-uuid-syntax',
        headers: {
          'x-correlation-id': testCorrelationId,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.headers['x-correlation-id']).toBe(testCorrelationId);
      const body = JSON.parse(res.payload);
      expect(body.correlation_id).toBe(testCorrelationId);
      expect(body.code).toBe('INVALID_UUID');
    });

    it('masks internal server errors to 500 without leaking SQL or stack traces', async () => {
      // Force repository failure by throwing unexpected Error
      repo.getVendorById = async () => {
        throw new Error('SELECT * FROM secret_erp_table WHERE password_hash = "secret"');
      };

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/erp-vendors/vendors/${VENDOR_ID}`,
      });

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INTERNAL_SERVER_ERROR');
      // Must not leak SQL or secret text
      expect(body.message).not.toContain('secret_erp_table');
      expect(body.message).not.toContain('password_hash');
      expect(body).not.toHaveProperty('stack');
      expect(body.correlation_id).toBeDefined();
    });
  });
});
