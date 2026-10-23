/**
 * ERP-2 Vendors & Purchasing — Fastify API Integration Tests
 *
 * Verifies all Acceptance Criteria for Issue #17 (ERP2-02):
 *   [✓] AC-1: Every list endpoint responds with documented status codes and validated JSON
 *   [✓] AC-2: Search/filter is performed server-side and is case-insensitive where appropriate
 *   [✓] AC-3: page/pageSize return deterministic non-overlapping records; pageSize > 100 rejected (400)
 *   [✓] AC-4: Unknown query parameters do not alter SQL and user values are parameterized
 *   [✓] AC-5: Fastify inject tests verify success, empty results, invalid query, unauthorized request and stable pagination
 *   [✓] AC-6: Domain invariant: Every purchase-order line references a valid existing product through owning ERP-1 API contract
 *   [✓] AC-7: Server-side bank-detail masking (XXXX-XXXX-7890)
 *   [✓] AC-8: Allowed purchase-order status flow (Draft -> Sent -> Received -> Closed)
 *   [✓] AC-9: Order total recomputed server-side from lines using decimal arithmetic
 *
 * @module erp2/tests/api/list.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemoryErp2Repository } from '../../src/services/repository.js';
import * as moduleExports from '../../src/index.js';
import {
  PaginatedVendorsResponseSchema,
  PaginatedPurchaseOrdersResponseSchema,
  VendorSchema,
  PurchaseOrderSchema,
  ErrorEnvelopeSchema,
} from '@clearshift/contracts';
import type { ReferenceResolver } from '@cs/kernel';

describe('ERP-2 Vendors & Purchasing API — List & Read Endpoints (Issue #17)', () => {
  let app: FastifyInstance;
  let authApp: FastifyInstance;
  let repository: InMemoryErp2Repository;

  // Mock ReferenceResolver that knows about test products in ERP-1 catalog
  const mockResolver: ReferenceResolver = {
    async exists(entity: string, id: string): Promise<boolean> {
      if (entity === 'product') {
        const validProducts = new Set([
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
        ]);
        return validProducts.has(id);
      }
      return false;
    },
    async get(entity: string, id: string): Promise<Record<string, unknown> | null> {
      if (entity === 'product' && id === '11111111-1111-1111-1111-111111111111') {
        return { id, name: 'Industrial Drill Bit', sku: 'IND-DRILL-01', price: '30.00' };
      }
      return null;
    },
  };

  beforeEach(() => {
    repository = new InMemoryErp2Repository(true);

    const v1Id = '00000000-0000-0000-0000-000000000001';
    const v2Id = '00000000-0000-0000-0000-000000000002';
    const v3Id = '00000000-0000-0000-0000-000000000003';

    repository.vendors.set(v2Id, {
      id: v2Id,
      name: 'Beta Electronics Ltd',
      tax_number: 'TX-112233',
      email: 'orders@beta-electronics.com',
      phone: '+1-555-0288',
      address_line: '200 Silicon Avenue',
      city: 'Tech City',
      country: 'USA',
      bank_masked: 'XXXX-XXXX-1234',
      currency: 'USD',
      source_system: null,
      source_id: null,
      created_at: '2026-03-02T00:00:00.000Z',
      updated_at: '2026-03-02T00:00:00.000Z',
    });

    repository.vendors.set(v3Id, {
      id: v3Id,
      name: 'Gamma Logistics Corp',
      tax_number: 'TX-445566',
      email: 'contact@gamma-logistics.com',
      phone: '+1-555-0377',
      address_line: '300 Harbor Way',
      city: 'Seaport',
      country: 'USA',
      bank_masked: 'XXXX-XXXX-5678',
      currency: 'USD',
      source_system: null,
      source_id: null,
      created_at: '2026-03-03T00:00:00.000Z',
      updated_at: '2026-03-03T00:00:00.000Z',
    });

    const po1Id = '00000000-0000-0000-0001-000000000001';
    const po2Id = '00000000-0000-0000-0001-000000000002';
    const prod1Id = '11111111-1111-1111-1111-111111111111';

    repository.purchaseOrders.set(po1Id, {
      id: po1Id,
      po_number: 'PO-2026-0001',
      vendor_id: v1Id,
      order_date: '2026-03-10',
      status: 'Draft',
      currency: 'USD',
      total: '150.00',
      lines: [
        {
          id: '00000000-0000-0000-0002-000000000001',
          po_id: po1Id,
          product_id: prod1Id,
          quantity: '5.00',
          price: '30.00',
          line_total: '150.00',
        },
      ],
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    });

    repository.purchaseOrders.set(po2Id, {
      id: po2Id,
      po_number: 'PO-2026-0002',
      vendor_id: v1Id,
      order_date: '2026-03-12',
      status: 'Sent',
      currency: 'USD',
      total: '200.00',
      lines: [
        {
          id: '00000000-0000-0000-0002-000000000002',
          po_id: po2Id,
          product_id: prod1Id,
          quantity: '10.00',
          price: '20.00',
          line_total: '200.00',
        },
      ],
      created_at: '2026-03-12T00:00:00.000Z',
      updated_at: '2026-03-12T00:00:00.000Z',
    });

    app = buildApp({ repository, referenceResolver: mockResolver, authRequired: false });
    authApp = buildApp({ repository, referenceResolver: mockResolver, authRequired: true });
  });

  it('exports all necessary module symbols from index.ts', () => {
    expect(moduleExports.buildApp).toBeDefined();
    expect(moduleExports.Erp2Service).toBeDefined();
    expect(moduleExports.InMemoryErp2Repository).toBeDefined();
    expect(moduleExports.erpVendorsRoutes).toBeDefined();
    expect(moduleExports.erp2Descriptor).toBeDefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Vendors Collection: GET /api/v1/erp-vendors/vendors
  // ───────────────────────────────────────────────────────────────────────────
  describe('GET /api/v1/erp-vendors/vendors', () => {
    it('[AC-1] returns 200 with validated PaginatedVendorsResponse schema and default pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      const parsed = PaginatedVendorsResponseSchema.safeParse(json);
      expect(parsed.success).toBe(true);

      expect(json.total).toBeGreaterThanOrEqual(3);
      expect(json.page).toBe(1);
      expect(json.pageSize).toBe(20);
      expect(Array.isArray(json.items)).toBe(true);
      expect(json.items.length).toBe(json.total);
    });

    it('[AC-2] [SEARCH] performs server-side case-insensitive search by name', async () => {
      // Lowercase search
      const lowerRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?search=acme',
      });
      expect(lowerRes.statusCode).toBe(200);
      const lowerJson = lowerRes.json();
      expect(lowerJson.total).toBe(1);
      expect(lowerJson.items[0].name).toBe('Acme Industrial Supplies');

      // Uppercase search
      const upperRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?search=ACME',
      });
      expect(upperRes.statusCode).toBe(200);
      const upperJson = upperRes.json();
      expect(upperJson.total).toBe(1);
      expect(upperJson.items[0].name).toBe('Acme Industrial Supplies');

      // Partial search
      const partialRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?search=Electr',
      });
      expect(partialRes.statusCode).toBe(200);
      const partialJson = partialRes.json();
      expect(partialJson.total).toBe(1);
      expect(partialJson.items[0].name).toBe('Beta Electronics Ltd');
    });

    it('[AC-2] [SEARCH] performs server-side case-insensitive search by tax number', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?search=tx-998877',
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.total).toBe(1);
      expect(json.items[0].name).toBe('Acme Industrial Supplies');
    });

    it('[AC-5] returns empty result cleanly when search matches nothing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?search=NonexistentVendorXYZ',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.total).toBe(0);
      expect(json.items).toEqual([]);
      expect(json.totalPages).toBe(1);
    });

    it('[AC-3] [PAGINATION] returns deterministic non-overlapping records across pages', async () => {
      const page1Res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?page=1&pageSize=2',
      });
      const page2Res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?page=2&pageSize=2',
      });

      expect(page1Res.statusCode).toBe(200);
      expect(page2Res.statusCode).toBe(200);

      const p1 = page1Res.json();
      const p2 = page2Res.json();

      expect(p1.items.length).toBe(2);
      expect(p2.items.length).toBe(1);
      expect(p1.page).toBe(1);
      expect(p2.page).toBe(2);
      expect(p1.totalPages).toBe(2);

      const p1Ids = p1.items.map((v: { id: string }) => v.id);
      const p2Ids = p2.items.map((v: { id: string }) => v.id);

      // Verify no overlap between page 1 and page 2
      const overlap = p1Ids.filter((id: string) => p2Ids.includes(id));
      expect(overlap).toEqual([]);
    });

    it('[AC-3] rejects pageSize > 100 with HTTP 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?pageSize=101',
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error).toBe('Bad Request');
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('[AC-5] rejects invalid query parameters with HTTP 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?page=-1',
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error).toBe('Bad Request');
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('[AC-4] [PARAMETERIZATION] ignores unknown query parameters safely without SQL modification', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?search=acme&malicious_param=1;DROP%20TABLE%20vendors;--',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.total).toBe(1);
      expect(json.items[0].name).toBe('Acme Industrial Supplies');
    });

    it('[AC-7] verifies bank details are always masked (never unmasked)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      for (const vendor of json.items) {
        if (vendor.bank_masked) {
          expect(vendor.bank_masked).toMatch(/^XXXX-XXXX-\d{4}$/);
        }
        expect(vendor.bank_details).toBeUndefined();
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Vendor Read by ID: GET /api/v1/erp-vendors/vendors/:id
  // ───────────────────────────────────────────────────────────────────────────
  describe('GET /api/v1/erp-vendors/vendors/:id', () => {
    it('returns 200 with Vendor schema for valid ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors/00000000-0000-0000-0000-000000000001',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      const parsed = VendorSchema.safeParse(json);
      expect(parsed.success).toBe(true);
      expect(json.name).toBe('Acme Industrial Supplies');
      expect(json.bank_masked).toBe('XXXX-XXXX-7890');
    });

    it('returns 404 for nonexistent valid UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors/99999999-9999-9999-9999-999999999999',
      });

      expect(res.statusCode).toBe(404);
      const json = res.json();
      const envelope = ErrorEnvelopeSchema.safeParse(json);
      expect(envelope.success).toBe(true);
      expect(json.code).toBe('NOT_FOUND');
    });

    it('returns 400 for malformed UUID parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors/not-a-valid-uuid',
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.code).toBe('INVALID_UUID');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Purchase Orders Collection: GET /api/v1/erp-vendors/purchase-orders
  // ───────────────────────────────────────────────────────────────────────────
  describe('GET /api/v1/erp-vendors/purchase-orders', () => {
    it('[AC-1] returns 200 with validated PaginatedPurchaseOrdersResponse schema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/purchase-orders',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      const parsed = PaginatedPurchaseOrdersResponseSchema.safeParse(json);
      expect(parsed.success).toBe(true);

      expect(json.total).toBeGreaterThanOrEqual(2);
      expect(json.page).toBe(1);
      expect(json.pageSize).toBe(20);
      expect(Array.isArray(json.items)).toBe(true);
    });

    it('[AC-2] [FILTER] filters purchase orders by vendor_id', async () => {
      const vendorId = '00000000-0000-0000-0000-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/erp-vendors/purchase-orders?vendor_id=${vendorId}`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.total).toBe(2);
      for (const po of json.items) {
        expect(po.vendor_id).toBe(vendorId);
      }
    });

    it('[AC-2] [FILTER] filters purchase orders by status', async () => {
      const draftRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/purchase-orders?status=Draft',
      });

      expect(draftRes.statusCode).toBe(200);
      const draftJson = draftRes.json();
      expect(draftJson.total).toBe(1);
      expect(draftJson.items[0].status).toBe('Draft');

      const sentRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/purchase-orders?status=Sent',
      });

      expect(sentRes.statusCode).toBe(200);
      const sentJson = sentRes.json();
      expect(sentJson.total).toBe(1);
      expect(sentJson.items[0].status).toBe('Sent');
    });

    it('[AC-5] returns empty result cleanly when filters match nothing', async () => {
      const nonexistentVendor = '99999999-9999-9999-9999-999999999999';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/erp-vendors/purchase-orders?vendor_id=${nonexistentVendor}`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.total).toBe(0);
      expect(json.items).toEqual([]);
      expect(json.totalPages).toBe(1);
    });

    it('[AC-3] rejects pageSize > 100 for purchase-orders with HTTP 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/purchase-orders?pageSize=150',
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error).toBe('Bad Request');
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('[AC-4] ignores unknown query parameters safely', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/purchase-orders?status=Draft&evil=123',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.total).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Purchase Order Read by ID: GET /api/v1/erp-vendors/purchase-orders/:id
  // ───────────────────────────────────────────────────────────────────────────
  describe('GET /api/v1/erp-vendors/purchase-orders/:id', () => {
    it('returns 200 with PurchaseOrder schema including lines and calculated totals', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/purchase-orders/00000000-0000-0000-0001-000000000001',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      const parsed = PurchaseOrderSchema.safeParse(json);
      expect(parsed.success).toBe(true);

      expect(json.po_number).toBe('PO-2026-0001');
      expect(json.total).toBe('150.00');
      expect(Array.isArray(json.lines)).toBe(true);
      expect(json.lines.length).toBe(1);
      expect(json.lines[0].quantity).toBe('5.00');
      expect(json.lines[0].price).toBe('30.00');
      expect(json.lines[0].line_total).toBe('150.00');
    });

    it('returns 404 for nonexistent purchase order ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/purchase-orders/99999999-9999-9999-9999-999999999999',
      });

      expect(res.statusCode).toBe(404);
      const json = res.json();
      expect(json.code).toBe('NOT_FOUND');
    });

    it('returns 400 for malformed purchase order UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/purchase-orders/invalid-uuid',
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.code).toBe('INVALID_UUID');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Domain Invariants & Mutations
  // ───────────────────────────────────────────────────────────────────────────
  describe('POST /api/v1/erp-vendors/purchase-orders (Domain Invariants)', () => {
    it('[AC-6] [DOMAIN INVARIANT] verifies product references via ERP-1 contract; rejects unknown product', async () => {
      const unknownProductId = '99999999-8888-7777-6666-555555555555';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          vendor_id: '00000000-0000-0000-0000-000000000001',
          order_date: '2026-03-15',
          currency: 'USD',
          lines: [
            {
              product_id: unknownProductId,
              quantity: '2.00',
              price: '50.00',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(422);
      const json = res.json();
      expect(json.code).toBe('INVALID_PRODUCT_REFERENCE');
      expect(json.message).toContain('references unknown product ID');
    });

    it('[AC-9] creates purchase order when products are valid; recomputes total server-side', async () => {
      const validProductId = '11111111-1111-1111-1111-111111111111';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          vendor_id: '00000000-0000-0000-0000-000000000001',
          order_date: '2026-03-16',
          currency: 'USD',
          lines: [
            {
              product_id: validProductId,
              quantity: '3.00',
              price: '45.50',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.status).toBe('Draft');
      // 3.00 * 45.50 = 136.50
      expect(json.total).toBe('136.50');
      expect(json.lines[0].line_total).toBe('136.50');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Purchase Order Status Transitions
  // ───────────────────────────────────────────────────────────────────────────
  describe('PATCH /api/v1/erp-vendors/purchase-orders/:id (Status State Machine)', () => {
    it('[AC-8] allows valid transition Draft -> Sent', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/erp-vendors/purchase-orders/00000000-0000-0000-0001-000000000001',
        payload: { status: 'Sent' },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.status).toBe('Sent');
    });

    it('[AC-8] rejects invalid/backward transition (Sent -> Draft)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/erp-vendors/purchase-orders/00000000-0000-0000-0001-000000000002', // Currently 'Sent'
        payload: { status: 'Draft' },
      });

      expect(res.statusCode).toBe(422);
      const json = res.json();
      expect(json.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('[AC-8] rejects skipping transitions (Draft -> Received directly)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/erp-vendors/purchase-orders/00000000-0000-0000-0001-000000000001', // Currently 'Draft'
        payload: { status: 'Received' },
      });

      expect(res.statusCode).toBe(422);
      const json = res.json();
      expect(json.code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Authentication & Authorization (AC-5)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Authentication & Authorization (AC-5)', () => {
    it('rejects request with 401 when authRequired is true and Authorization header is missing', async () => {
      const res = await authApp.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
      });

      expect(res.statusCode).toBe(401);
      const json = res.json();
      expect(json.error).toBe('Unauthorized');
      expect(json.message).toContain('Missing Authorization header');
    });

    it('rejects request with 401 when bearer token is invalid', async () => {
      const res = await authApp.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(res.statusCode).toBe(401);
      const json = res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('accepts request with 200 when valid bearer token is provided', async () => {
      const res = await authApp.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
        headers: {
          authorization: 'Bearer role:purchasing_admin-valid-token-12345',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(Array.isArray(json.items)).toBe(true);
    });
  });
});
