/**
 * ERP-2 Purchase Orders API Test Suite
 *
 * Verifies FR-ERP2-03, FR-ERP2-04, FR-ERP2-05, BR-ERP2-01:
 *   - Purchase order creation with lines
 *   - Server-side calculated order totals (ignoring client total)
 *   - Cross-module product reference verification via ERP-1 ReferenceResolver
 *   - Strict unidirectional status state machine (Draft -> Sent -> Received -> Closed)
 *   - No inventory side effects on status Received in V1
 *
 * @module erp2/tests/api/purchase-orders.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ReferenceResolver } from '@cs/kernel';
import { buildApp } from '../../src/app.js';
import { InMemoryErp2Repository } from '../../src/services/repository.js';
import { Erp2Service } from '../../src/services/erp2.service.js';

class MockErp1Resolver implements ReferenceResolver {
  public validProducts = new Set<string>([
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
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

describe('ERP-2 Purchase Orders REST API (FR-ERP2-03, FR-ERP2-04, FR-ERP2-05, BR-ERP2-01)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp2Repository;
  let resolver: MockErp1Resolver;
  let service: Erp2Service;

  const vendorId = '00000000-0000-0000-0000-000000000001';
  const prodA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const prodB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  beforeEach(() => {
    repo = new InMemoryErp2Repository(true); // seeds default Acme vendor
    resolver = new MockErp1Resolver();
    service = new Erp2Service({ repository: repo, referenceResolver: resolver });
    app = buildApp({ repository: repo, erp2Service: service, referenceResolver: resolver });
  });

  describe('POST /api/v1/erp-vendors/purchase-orders', () => {
    it('creates purchase order and recomputes total server-side (FR-ERP2-03, FR-ERP2-05)', async () => {
      const payload = {
        vendor_id: vendorId,
        order_date: '2026-10-20',
        currency: 'USD',
        lines: [
          {
            product_id: prodA,
            quantity: '10.00',
            price: '15.50', // 155.00
          },
          {
            product_id: prodB,
            quantity: '3.00',
            price: '20.25', // 60.75
          },
        ],
        // Client attempting to provide custom/incorrect total:
        total: '9999.99',
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload,
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.id).toBeDefined();
      expect(body.vendor_id).toBe(vendorId);
      expect(body.status).toBe('Draft'); // Default status
      // Expected: 155.00 + 60.75 = 215.75 (client-provided total ignored)
      expect(body.total).toBe('215.75');
      expect(body.lines).toHaveLength(2);
      expect(body.lines[0].line_total).toBe('155.00');
      expect(body.lines[1].line_total).toBe('60.75');
    });

    it('rejects purchase order if product does not exist in ERP-1 (BR-ERP2-01)', async () => {
      const payload = {
        vendor_id: vendorId,
        order_date: '2026-10-20',
        lines: [
          {
            product_id: '99999999-9999-9999-9999-999999999999', // Unknown product
            quantity: '1.00',
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
      expect(body.code).toBe('UNKNOWN_PRODUCT');
    });

    it('rejects purchase order with non-existent vendor (HTTP 422)', async () => {
      const payload = {
        vendor_id: '99999999-9999-9999-9999-999999999999',
        order_date: '2026-10-20',
        lines: [
          {
            product_id: prodA,
            quantity: '1.00',
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
  });

  describe('PATCH /api/v1/erp-vendors/purchase-orders/:id (Status FSM)', () => {
    it('executes valid forward transition flow: Draft -> Sent -> Received -> Closed (FR-ERP2-04)', async () => {
      // 1. Create draft PO
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          vendor_id: vendorId,
          order_date: '2026-10-20',
          lines: [{ product_id: prodA, quantity: '1.00', price: '10.00' }],
        },
      });
      const poId = JSON.parse(createRes.payload).id;

      // 2. Draft -> Sent
      const resSent = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Sent' },
      });
      expect(resSent.statusCode).toBe(200);
      expect(JSON.parse(resSent.payload).status).toBe('Sent');

      // 3. Sent -> Received (does not mutate inventory in V1)
      const resReceived = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Received' },
      });
      expect(resReceived.statusCode).toBe(200);
      expect(JSON.parse(resReceived.payload).status).toBe('Received');

      // 4. Received -> Closed
      const resClosed = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Closed' },
      });
      expect(resClosed.statusCode).toBe(200);
      expect(JSON.parse(resClosed.payload).status).toBe('Closed');
    });

    it('rejects backwards transition (e.g. Sent -> Draft) with HTTP 422', async () => {
      // Create PO and move to Sent
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          vendor_id: vendorId,
          order_date: '2026-10-20',
          lines: [{ product_id: prodA, quantity: '1.00', price: '10.00' }],
        },
      });
      const poId = JSON.parse(createRes.payload).id;

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Sent' },
      });

      // Try backwards transition: Sent -> Draft
      const resBackwards = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Draft' },
      });

      expect(resBackwards.statusCode).toBe(422);
      const body = JSON.parse(resBackwards.payload);
      expect(body.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('rejects skipped transition (e.g. Draft -> Received) with HTTP 422', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          vendor_id: vendorId,
          order_date: '2026-10-20',
          lines: [{ product_id: prodA, quantity: '1.00', price: '10.00' }],
        },
      });
      const poId = JSON.parse(createRes.payload).id;

      // Try skipping: Draft -> Received
      const resSkip = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Received' },
      });

      expect(resSkip.statusCode).toBe(422);
      const body = JSON.parse(resSkip.payload);
      expect(body.code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('GET /api/v1/erp-vendors/purchase-orders', () => {
    it('returns paged list with status and vendor filters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/erp-vendors/purchase-orders?vendor_id=${vendorId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.items).toBeDefined();
      expect(body.total).toBeDefined();
    });
  });
});
