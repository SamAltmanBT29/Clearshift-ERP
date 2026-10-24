/**
 * ERP-2 Vendors & Purchasing — Deterministic Mock Server Test Suite
 *
 * Proves that:
 *   - The mock server boots and provides representative, schema-valid payloads.
 *   - GET /vendors returns seeded vendors with bounded pagination.
 *   - GET /vendors applies search filter correctly.
 *   - POST /vendors creates a vendor, masks bank details, emits domain event.
 *   - POST /vendors returns 409 on duplicate tax_number.
 *   - POST /vendors returns 200 (not 201) on idempotency-key replay.
 *   - GET /vendors/:id returns 200 for known ID and 404 for unknown.
 *   - PATCH /vendors/:id updates editable fields, masks bank details on update.
 *   - GET /purchase-orders returns seeded POs with bounded pagination.
 *   - GET /purchase-orders applies vendor_id and status filters correctly.
 *   - POST /purchase-orders creates PO, server-computes totals, emits event.
 *   - POST /purchase-orders validates product_ids against ERP-1 registry (BR-ERP2-01).
 *   - POST /purchase-orders rejects unknown vendor_id with 422.
 *   - POST /purchase-orders returns 409 on duplicate po_number.
 *   - POST /purchase-orders returns 200 on idempotency-key replay.
 *   - GET /purchase-orders/:id returns 200 / 404 as expected.
 *   - PATCH /purchase-orders/:id enforces strict status machine: Draft->Sent->Received->Closed.
 *   - PATCH /purchase-orders/:id emits status_changed event.
 *   - PATCH /purchase-orders/:id emits purchase_order.received when transitioning to Received.
 *   - Backwards or skip transitions return 422 INVALID_STATUS_TRANSITION.
 *   - pageSize > 100 returns 400 VALIDATION_ERROR.
 *   - reset() restores deterministic seed state.
 *
 * @module contracts/tests/erp-2.mock.test
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createErp2MockServer,
  SEED_VENDOR_1,
  SEED_VENDOR_2,
  SEED_VENDOR_3,
  SEED_PO_1,
  SEED_PO_2,
  SEED_PO_3,
  type Erp2MockServerInstance,
} from '../src/erp-2-mock.js';
import {
  VendorSchema,
  PurchaseOrderSchema,
  PaginatedVendorsResponseSchema,
  PaginatedPurchaseOrdersResponseSchema,
} from '../src/erp-2.js';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
// ERP-1 known product IDs (from KNOWN_ERP1_PRODUCT_IDS in mock)
const ERP1_PRODUCT_1 = 'cccccccc-0001-4000-8000-000000000001';
const ERP1_PRODUCT_2 = 'cccccccc-0001-4000-8000-000000000002';
const ERP1_PRODUCT_UNKNOWN = '99999999-9999-4000-8000-999999999999';

// ─────────────────────────────────────────────────────────────────────────────
describe('ERP-2 Deterministic Mock Server', () => {
  let mock: Erp2MockServerInstance;

  beforeEach(() => {
    mock = createErp2MockServer();
  });

  afterAll(async () => {
    await mock.stop();
  });

  // ── 1. VENDORS ─────────────────────────────────────────────────────────────

  describe('Vendors', () => {
    it('GET /api/v1/erp-vendors/vendors returns seeded data with pagination', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?page=1&pageSize=10',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(PaginatedVendorsResponseSchema.safeParse(json).success).toBe(true);
      expect(json.total).toBeGreaterThanOrEqual(3);
      expect(json.page).toBe(1);
      expect(json.pageSize).toBe(10);
      expect(json.items[0]?.id).toBeDefined();
    });

    it('GET /api/v1/erp-vendors/vendors applies search filter on name', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?search=Apex',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.items.length).toBeGreaterThan(0);
      for (const v of json.items) {
        expect(v.name.toLowerCase()).toContain('apex');
      }
    });

    it('GET /api/v1/erp-vendors/vendors rejects pageSize > 100', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?pageSize=200',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('GET /api/v1/erp-vendors/vendors/:id returns 200 for seeded vendor', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: `/api/v1/erp-vendors/vendors/${SEED_VENDOR_1}`,
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(VendorSchema.safeParse(json).success).toBe(true);
      expect(json.id).toBe(SEED_VENDOR_1);
      // Bank details must always be masked
      expect(json.bank_masked).toMatch(/^XXXX-XXXX-\d{4}$/);
    });

    it('GET /api/v1/erp-vendors/vendors/:id returns 404 for unknown ID', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: `/api/v1/erp-vendors/vendors/${UNKNOWN_ID}`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    it('POST /api/v1/erp-vendors/vendors creates vendor and masks bank details (FR-ERP2-06)', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'New Vendor Ltd',
          tax_number: 'TX-NEW-9999',
          email: 'contact@new-vendor.com',
          bank_details: '9876543210', // Raw — must be masked in response
          currency: 'USD',
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(VendorSchema.safeParse(json).success).toBe(true);
      expect(json.bank_masked).toBe('XXXX-XXXX-3210');
      // Raw bank details must never appear in response
      expect(JSON.stringify(json)).not.toContain('9876543210');
    });

    it('POST /api/v1/erp-vendors/vendors emits vendor.created domain event', async () => {
      const before = mock.store.emittedEvents.length;
      await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'Event Test Vendor',
          tax_number: 'TX-EVT-0001',
          email: 'evt@vendor.com',
          currency: 'EUR',
        },
      });
      expect(mock.store.emittedEvents.length).toBe(before + 1);
      const lastEvent = mock.store.emittedEvents[mock.store.emittedEvents.length - 1]!;
      expect(lastEvent.event_type).toBe('erp.vendor.created');
      expect(lastEvent.producer).toBe('erp-2');
    });

    it('POST /api/v1/erp-vendors/vendors returns 409 on duplicate tax_number', async () => {
      // First insert succeeds
      await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'Duplicate Vendor A',
          tax_number: 'TX-DUP-0001',
          email: 'dup-a@vendor.com',
          currency: 'USD',
        },
      });

      // Second with same tax_number (different casing, same normalized key) must be 409
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'Duplicate Vendor B',
          tax_number: 'tx-dup-0001', // same normalized key
          email: 'dup-b@vendor.com',
          currency: 'USD',
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('CONFLICT');
    });

    it('POST /api/v1/erp-vendors/vendors returns 409 on seed vendor tax_number', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'Duplicate of seed vendor',
          tax_number: 'GSTIN-27AAAAA0001A1Z1', // seed vendor 1 tax number
          email: 'dup@vendor.com',
          currency: 'INR',
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it('POST /api/v1/erp-vendors/vendors replays on idempotency key (200 not 201)', async () => {
      const first = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'Idempotent Vendor',
          tax_number: 'TX-IDEMP-0001',
          email: 'idemp@vendor.com',
          currency: 'USD',
          idempotency_key: 'vendor-idemp-key-001',
        },
      });
      expect(first.statusCode).toBe(201);

      const second = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'Idempotent Vendor',
          tax_number: 'TX-IDEMP-0001',
          email: 'idemp@vendor.com',
          currency: 'USD',
          idempotency_key: 'vendor-idemp-key-001',
        },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(first.json().id);
    });

    it('POST /api/v1/erp-vendors/vendors returns 400 on missing required fields', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'No Email No Tax',
          // missing tax_number and email
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('PATCH /api/v1/erp-vendors/vendors/:id updates fields and masks bank on update', async () => {
      const res = await mock.app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/vendors/${SEED_VENDOR_2}`,
        payload: {
          city: 'Oakland',
          bank_details: '1111222233334444',
        },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.city).toBe('Oakland');
      expect(json.bank_masked).toBe('XXXX-XXXX-4444');
      // Raw account number must never appear
      expect(JSON.stringify(json)).not.toContain('1111222233334444');
    });

    it('PATCH /api/v1/erp-vendors/vendors/:id returns 404 for unknown vendor', async () => {
      const res = await mock.app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/vendors/${UNKNOWN_ID}`,
        payload: { city: 'Nowhere' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('seeded vendors never expose raw bank account numbers', () => {
      for (const vendor of mock.store.vendors.values()) {
        if (vendor.bank_masked !== null) {
          expect(vendor.bank_masked).toMatch(/^XXXX-XXXX-\d{4}$/);
        }
      }
    });
  });

  // ── 2. PURCHASE ORDERS ─────────────────────────────────────────────────────

  describe('Purchase Orders', () => {
    it('GET /api/v1/erp-vendors/purchase-orders returns seeded data', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/purchase-orders?page=1&pageSize=10',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(PaginatedPurchaseOrdersResponseSchema.safeParse(json).success).toBe(true);
      expect(json.total).toBeGreaterThanOrEqual(3);
      expect(json.items[0]?.po_number).toBeDefined();
    });

    it('GET /api/v1/erp-vendors/purchase-orders applies vendor_id filter', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: `/api/v1/erp-vendors/purchase-orders?vendor_id=${SEED_VENDOR_1}`,
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      for (const po of json.items) {
        expect(po.vendor_id).toBe(SEED_VENDOR_1);
      }
    });

    it('GET /api/v1/erp-vendors/purchase-orders applies status filter', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/purchase-orders?status=Sent',
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      for (const po of json.items) {
        expect(po.status).toBe('Sent');
      }
    });

    it('GET /api/v1/erp-vendors/purchase-orders rejects pageSize > 100', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/purchase-orders?pageSize=200',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('GET /api/v1/erp-vendors/purchase-orders/:id returns 200 for seeded PO', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: `/api/v1/erp-vendors/purchase-orders/${SEED_PO_1}`,
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(PurchaseOrderSchema.safeParse(json).success).toBe(true);
      expect(json.id).toBe(SEED_PO_1);
      expect(json.lines.length).toBeGreaterThan(0);
    });

    it('GET /api/v1/erp-vendors/purchase-orders/:id returns 404 for unknown ID', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: `/api/v1/erp-vendors/purchase-orders/${UNKNOWN_ID}`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    it('POST /api/v1/erp-vendors/purchase-orders creates PO with server-computed total (FR-ERP2-05)', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          po_number: 'PO-TEST-0001',
          vendor_id: SEED_VENDOR_1,
          order_date: '2026-04-20',
          currency: 'INR',
          lines: [
            { product_id: ERP1_PRODUCT_1, quantity: '10', price: '18.50' }, // 185.00
            { product_id: ERP1_PRODUCT_2, quantity: '5', price: '6.25' },   // 31.25
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(PurchaseOrderSchema.safeParse(json).success).toBe(true);
      expect(json.status).toBe('Draft');
      // Server must compute the total
      expect(json.total).toBe('216.25'); // 185.00 + 31.25
      expect(json.lines).toHaveLength(2);
      expect(json.lines[0]?.line_total).toBe('185.00');
      expect(json.lines[1]?.line_total).toBe('31.25');
    });

    it('POST /api/v1/erp-vendors/purchase-orders emits purchase_order.created event', async () => {
      const before = mock.store.emittedEvents.length;
      await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          po_number: 'PO-EVT-0001',
          vendor_id: SEED_VENDOR_2,
          order_date: '2026-04-21',
          currency: 'USD',
          lines: [{ product_id: ERP1_PRODUCT_1, quantity: '1', price: '18.50' }],
        },
      });
      expect(mock.store.emittedEvents.length).toBe(before + 1);
      const lastEvent = mock.store.emittedEvents[mock.store.emittedEvents.length - 1]!;
      expect(lastEvent.event_type).toBe('erp.purchase_order.created');
      expect(lastEvent.producer).toBe('erp-2');
    });

    it('POST /api/v1/erp-vendors/purchase-orders rejects unknown product_id (BR-ERP2-01)', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          po_number: 'PO-PROD-FAIL-0001',
          vendor_id: SEED_VENDOR_1,
          order_date: '2026-04-22',
          currency: 'INR',
          lines: [
            { product_id: ERP1_PRODUCT_UNKNOWN, quantity: '5', price: '10.00' },
          ],
        },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('UNPROCESSABLE_ENTITY');
    });

    it('POST /api/v1/erp-vendors/purchase-orders rejects unknown vendor_id', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          vendor_id: UNKNOWN_ID,
          order_date: '2026-04-22',
          currency: 'USD',
          lines: [{ product_id: ERP1_PRODUCT_1, quantity: '2', price: '18.50' }],
        },
      });
      expect(res.statusCode).toBe(422);
    });

    it('POST /api/v1/erp-vendors/purchase-orders returns 409 on duplicate po_number', async () => {
      await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          po_number: 'PO-DUP-0001',
          vendor_id: SEED_VENDOR_1,
          order_date: '2026-04-22',
          currency: 'INR',
          lines: [{ product_id: ERP1_PRODUCT_1, quantity: '1', price: '18.50' }],
        },
      });

      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          po_number: 'PO-DUP-0001',
          vendor_id: SEED_VENDOR_1,
          order_date: '2026-04-22',
          currency: 'INR',
          lines: [{ product_id: ERP1_PRODUCT_1, quantity: '1', price: '18.50' }],
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('CONFLICT');
    });

    it('POST /api/v1/erp-vendors/purchase-orders returns 200 on idempotency replay', async () => {
      const first = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          po_number: 'PO-IDEMP-0001',
          vendor_id: SEED_VENDOR_1,
          order_date: '2026-04-22',
          currency: 'INR',
          lines: [{ product_id: ERP1_PRODUCT_1, quantity: '1', price: '18.50' }],
          idempotency_key: 'po-idemp-key-001',
        },
      });
      expect(first.statusCode).toBe(201);

      const second = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          po_number: 'PO-IDEMP-0001',
          vendor_id: SEED_VENDOR_1,
          order_date: '2026-04-22',
          currency: 'INR',
          lines: [{ product_id: ERP1_PRODUCT_1, quantity: '1', price: '18.50' }],
          idempotency_key: 'po-idemp-key-001',
        },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(first.json().id);
    });

    it('POST /api/v1/erp-vendors/purchase-orders returns 400 on empty lines array', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          vendor_id: SEED_VENDOR_1,
          order_date: '2026-04-22',
          currency: 'INR',
          lines: [],
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 3. PO STATUS MACHINE ───────────────────────────────────────────────────

  describe('Purchase Order Status Machine (FR-ERP2-04)', () => {
    it('allows Draft -> Sent transition and emits status_changed event', async () => {
      // Create a Draft PO first
      const createRes = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          po_number: 'PO-SM-0001',
          vendor_id: SEED_VENDOR_1,
          order_date: '2026-04-23',
          currency: 'INR',
          lines: [{ product_id: ERP1_PRODUCT_1, quantity: '2', price: '18.50' }],
        },
      });
      const poId = createRes.json().id;
      const before = mock.store.emittedEvents.length;

      const res = await mock.app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Sent' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('Sent');
      expect(mock.store.emittedEvents.length).toBe(before + 1);
      const event = mock.store.emittedEvents[mock.store.emittedEvents.length - 1]!;
      expect(event.event_type).toBe('erp.purchase_order.status_changed');
      expect((event.payload as any).previous_status).toBe('Draft');
      expect((event.payload as any).new_status).toBe('Sent');
    });

    it('Sent -> Received emits both status_changed and purchase_order.received events', async () => {
      // Use seed PO-2026-0001 which is in Sent status
      const before = mock.store.emittedEvents.length;

      const res = await mock.app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${SEED_PO_1}`,
        payload: { status: 'Received' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('Received');
      // Should emit 2 events: status_changed + purchase_order.received
      expect(mock.store.emittedEvents.length).toBe(before + 2);
      const statusChangedEvent = mock.store.emittedEvents[mock.store.emittedEvents.length - 2]!;
      const receivedEvent = mock.store.emittedEvents[mock.store.emittedEvents.length - 1]!;
      expect(statusChangedEvent.event_type).toBe('erp.purchase_order.status_changed');
      expect(receivedEvent.event_type).toBe('erp.purchase_order.received');
      expect((receivedEvent.payload as any).purchaseOrderId).toBe(SEED_PO_1);
    });

    it('Received -> Closed is allowed (terminal transition)', async () => {
      // SEED_PO_2 is in Received status
      const res = await mock.app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${SEED_PO_2}`,
        payload: { status: 'Closed' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('Closed');
    });

    it('rejects backwards transition Sent -> Draft with 422', async () => {
      // SEED_PO_1 is in Sent status
      const res = await mock.app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${SEED_PO_1}`,
        payload: { status: 'Draft' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('UNPROCESSABLE_ENTITY');
    });

    it('rejects skipping steps Draft -> Received with 422', async () => {
      const createRes = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          po_number: 'PO-SM-SKIP-0001',
          vendor_id: SEED_VENDOR_1,
          order_date: '2026-04-24',
          currency: 'INR',
          lines: [{ product_id: ERP1_PRODUCT_1, quantity: '1', price: '18.50' }],
        },
      });
      const poId = createRes.json().id;

      const res = await mock.app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        payload: { status: 'Received' },
      });
      expect(res.statusCode).toBe(422);
    });

    it('rejects any transition out of Closed (terminal state)', async () => {
      // SEED_PO_3 is Closed
      for (const targetStatus of ['Draft', 'Sent', 'Received']) {
        const res = await mock.app.inject({
          method: 'PATCH',
          url: `/api/v1/erp-vendors/purchase-orders/${SEED_PO_3}`,
          payload: { status: targetStatus },
        });
        expect(res.statusCode, `Closed -> ${targetStatus} must be 422`).toBe(422);
      }
    });

    it('PATCH /purchase-orders/:id returns 404 for unknown PO', async () => {
      const res = await mock.app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${UNKNOWN_ID}`,
        payload: { status: 'Sent' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('PATCH /purchase-orders/:id returns 400 for invalid status value', async () => {
      const res = await mock.app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${SEED_PO_1}`,
        payload: { status: 'Cancelled' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });
  });

  // ── 4. MOCK STORE RESET ────────────────────────────────────────────────────

  describe('Mock Store Reset', () => {
    it('reset() restores store to deterministic seed state', async () => {
      // Mutate state
      await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'Temp Vendor',
          tax_number: 'TX-TEMP-0001',
          email: 'temp@vendor.com',
          currency: 'USD',
        },
      });

      expect(mock.store.vendors.size).toBeGreaterThan(3);

      mock.reset();

      expect(mock.store.vendors.size).toBe(3);
      expect(mock.store.purchaseOrders.size).toBe(3);
      expect(mock.store.emittedEvents.length).toBe(0);
      // Seed vendor must be present post-reset
      expect(mock.store.vendors.get(SEED_VENDOR_1)?.name).toBe(
        'Apex Industrial Components Pvt Ltd'
      );
    });

    it('route handlers observe the reset store', async () => {
      await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload: {
          name: 'Pre-reset Vendor',
          tax_number: 'TX-PRE-RESET-01',
          email: 'pre@reset.com',
          currency: 'USD',
        },
      });

      mock.reset();

      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
      });
      expect(res.json().total).toBe(3);
    });
  });

  // ── 5. FIXED DECIMAL ARITHMETIC ───────────────────────────────────────────

  describe('Decimal Arithmetic for Totals (FR-ERP2-05)', () => {
    it('avoids IEEE-754 0.1 + 0.2 floating point error in computed totals', async () => {
      const res = await mock.app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        payload: {
          po_number: 'PO-ARITH-0001',
          vendor_id: SEED_VENDOR_2,
          order_date: '2026-04-25',
          currency: 'USD',
          lines: [
            { product_id: ERP1_PRODUCT_1, quantity: '1', price: '0.10' },
            { product_id: ERP1_PRODUCT_2, quantity: '1', price: '0.20' },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().total).toBe('0.30');
    });

    it('seeded PO totals match sum of their line totals', () => {
      for (const po of mock.store.purchaseOrders.values()) {
        const sumOfLines = po.lines.reduce(
          (acc, l) => acc + Math.round(parseFloat(l.line_total) * 100),
          0
        );
        const reportedTotal = Math.round(parseFloat(po.total) * 100);
        expect(reportedTotal).toBe(sumOfLines);
      }
    });
  });

  // ── 6. ERROR ENVELOPE (ADR-002) ────────────────────────────────────────────

  describe('Error Envelope (ADR-002)', () => {
    it('error responses carry statusCode, error, code and message', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: `/api/v1/erp-vendors/vendors/${UNKNOWN_ID}`,
      });
      expect(res.statusCode).toBe(404);
      const json = res.json();
      expect(typeof json.statusCode).toBe('number');
      expect(typeof json.code).toBe('string');
      expect(typeof json.message).toBe('string');
    });
  });

  // ── 7. 404 FALLBACK ────────────────────────────────────────────────────────

  describe('404 Fallback', () => {
    it('returns 404 for completely unknown route', async () => {
      const res = await mock.app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/completely-unknown-route',
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
