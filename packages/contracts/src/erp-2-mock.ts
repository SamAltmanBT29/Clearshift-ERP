/**
 * ERP-2 Vendors & Purchasing — Deterministic Mock Server & Contract Package
 *
 * Provides a production-grade, zero-external-dependency mock server and
 * deterministic fixture dataset for dependent teams (ERP-1, ERP-4, Migration Kit).
 *
 * Conforms strictly to:
 *   - SDS ClearShift ERP v2.0 §4.3 (FR-ERP2-01..06, BR-ERP2-01)
 *   - ADR-002: Shared Zod/OpenAPI Contract & Error Envelope
 *   - PLT-04 / PLT-09: Bounded Pagination & Transactional Event Envelopes
 *   - Issue #130 ([ERP2-14])
 *
 * Interface:
 *   - createErp2MockServer()  → { app, store, reset, stop }
 *
 * Deterministic seed data:
 *   - 3 synthetic vendors (all bank details pre-masked)
 *   - 3 purchase orders referencing ERP-1 seed product IDs
 *   - Fixed UUIDs to guarantee reproducible integration and contract test assertions
 *
 * Business rules enforced in the mock:
 *   - Bank details masked server-side (XXXX-XXXX-7890) before any persistence/response
 *   - PO status transitions: Draft -> Sent -> Received -> Closed (strictly unidirectional)
 *   - PO line totals and order total computed using integer (cent) arithmetic
 *   - Product IDs validated against an in-process ERP-1 product registry
 *   - Duplicate tax_number rejected with 409 CONFLICT
 *   - Idempotency key replay returns 200 (not 201) with original body
 *
 * @module contracts/erp-2-mock
 */

import fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  VendorListQuerySchema,
  CreateVendorRequestSchema,
  UpdateVendorRequestSchema,
  PurchaseOrderListQuerySchema,
  CreatePurchaseOrderRequestSchema,
  UpdatePurchaseOrderStatusRequestSchema,
  maskBankDetails,
  calculateLineTotal,
  calculateOrderTotal,
  normalizeTaxNumber,
  ALLOWED_PO_STATUS_TRANSITIONS,
  ERP2_PURCHASE_ORDER_STATUS_TRANSITIONS,
  type Vendor,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseOrderStatus,
} from './erp-2.js';
import { ERP2_EVENT_TYPES, createErp2Event } from './erp-2-events.js';
import type { EventEnvelope } from './events.js';

export const ERP2_MOCK_DEFAULT_PORT = 4012;

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Seed IDs
// Fixed UUIDs to guarantee reproducible integration and contract test assertions.
// ─────────────────────────────────────────────────────────────────────────────

export const SEED_VENDOR_1 = 'aaaaaaaa-0002-4000-8000-000000000001';
export const SEED_VENDOR_2 = 'aaaaaaaa-0002-4000-8000-000000000002';
export const SEED_VENDOR_3 = 'aaaaaaaa-0002-4000-8000-000000000003';

export const SEED_PO_1 = 'bbbbbbbb-0002-4000-8000-000000000001';
export const SEED_PO_2 = 'bbbbbbbb-0002-4000-8000-000000000002';
export const SEED_PO_3 = 'bbbbbbbb-0002-4000-8000-000000000003';

export const SEED_PO_LINE_1 = 'cccccccc-0002-4000-8000-000000000001';
export const SEED_PO_LINE_2 = 'cccccccc-0002-4000-8000-000000000002';
export const SEED_PO_LINE_3 = 'cccccccc-0002-4000-8000-000000000003';
export const SEED_PO_LINE_4 = 'cccccccc-0002-4000-8000-000000000004';

/** ERP-1 seed product IDs (from erp-1-mock SEED_PRODUCT_*). */
export const KNOWN_ERP1_PRODUCT_IDS = new Set([
  'cccccccc-0001-4000-8000-000000000001', // TOOL-HEX-01  @ 18.5000
  'cccccccc-0001-4000-8000-000000000002', // GEN-TIE-100  @ 6.2500
  'cccccccc-0001-4000-8000-000000000003', // LUB-GRS-500  @ 12.0000
]);

const SEED_TS = '2026-04-01T00:00:00.000Z';

// ─────────────────────────────────────────────────────────────────────────────
// Mock Store Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Erp2MockStore {
  vendors: Map<string, Vendor>;
  /** Normalized tax_number -> vendor id index for duplicate detection. */
  vendorsByTaxNumber: Map<string, string>;
  purchaseOrders: Map<string, PurchaseOrder>;
  /** po_number -> PO id index for duplicate detection. */
  poByNumber: Map<string, string>;
  /** Idempotency-Key -> { targetId, payloadHash, response } */
  receipts: Map<string, { targetId: string; payloadHash: string; response: unknown }>;
  emittedEvents: EventEnvelope[];
}

export function createInitialErp2MockStore(): Erp2MockStore {
  const vendors = new Map<string, Vendor>();

  vendors.set(SEED_VENDOR_1, {
    id: SEED_VENDOR_1,
    name: 'Apex Industrial Components Pvt Ltd',
    tax_number: 'GSTIN-27AAAAA0001A1Z1',
    email: 'procurement@apex-industrial.com',
    phone: '+91-22-40001001',
    address_line: '12 Maker Chambers IV',
    city: 'Mumbai',
    country: 'India',
    bank_masked: 'XXXX-XXXX-1001',
    currency: 'INR',
    source_system: null,
    source_id: null,
    created_at: SEED_TS,
    updated_at: SEED_TS,
  });

  vendors.set(SEED_VENDOR_2, {
    id: SEED_VENDOR_2,
    name: 'Riverdale Supply Co',
    tax_number: 'EIN-22-4000002',
    email: 'orders@riverdale-supply.com',
    phone: '+1-415-555-0102',
    address_line: '500 Market St Suite 200',
    city: 'San Francisco',
    country: 'United States',
    bank_masked: 'XXXX-XXXX-0102',
    currency: 'USD',
    source_system: null,
    source_id: null,
    created_at: SEED_TS,
    updated_at: SEED_TS,
  });

  vendors.set(SEED_VENDOR_3, {
    id: SEED_VENDOR_3,
    name: 'Deutsche Werkzeuge GmbH',
    tax_number: 'DE-USt-300003003',
    email: 'vertrieb@dw-gmbh.de',
    phone: '+49-89-30003003',
    address_line: 'Industriestrasse 42',
    city: 'Munich',
    country: 'Germany',
    bank_masked: 'XXXX-XXXX-3003',
    currency: 'EUR',
    source_system: null,
    source_id: null,
    created_at: SEED_TS,
    updated_at: SEED_TS,
  });

  const vendorsByTaxNumber = new Map<string, string>([
    [normalizeTaxNumber('GSTIN-27AAAAA0001A1Z1'), SEED_VENDOR_1],
    [normalizeTaxNumber('EIN-22-4000002'), SEED_VENDOR_2],
    [normalizeTaxNumber('DE-USt-300003003'), SEED_VENDOR_3],
  ]);

  const purchaseOrders = new Map<string, PurchaseOrder>();

  const po1Lines: PurchaseOrderLine[] = [
    {
      id: SEED_PO_LINE_1,
      po_id: SEED_PO_1,
      product_id: 'cccccccc-0001-4000-8000-000000000001',
      quantity: '10.00',
      price: '18.50',
      line_total: calculateLineTotal('10', '18.50'), // 185.00
    },
    {
      id: SEED_PO_LINE_2,
      po_id: SEED_PO_1,
      product_id: 'cccccccc-0001-4000-8000-000000000002',
      quantity: '5.00',
      price: '6.25',
      line_total: calculateLineTotal('5', '6.25'), // 31.25
    },
  ];

  purchaseOrders.set(SEED_PO_1, {
    id: SEED_PO_1,
    po_number: 'PO-2026-0001',
    vendor_id: SEED_VENDOR_1,
    order_date: '2026-04-01',
    status: 'Sent',
    currency: 'INR',
    total: calculateOrderTotal(po1Lines.map((l) => ({ quantity: l.quantity, price: l.price }))),
    lines: po1Lines,
    created_at: SEED_TS,
    updated_at: SEED_TS,
  });

  const po2Lines: PurchaseOrderLine[] = [
    {
      id: SEED_PO_LINE_3,
      po_id: SEED_PO_2,
      product_id: 'cccccccc-0001-4000-8000-000000000003',
      quantity: '20.00',
      price: '12.00',
      line_total: calculateLineTotal('20', '12.00'), // 240.00
    },
  ];

  purchaseOrders.set(SEED_PO_2, {
    id: SEED_PO_2,
    po_number: 'PO-2026-0002',
    vendor_id: SEED_VENDOR_2,
    order_date: '2026-04-05',
    status: 'Received',
    currency: 'USD',
    total: calculateOrderTotal(po2Lines.map((l) => ({ quantity: l.quantity, price: l.price }))),
    lines: po2Lines,
    created_at: SEED_TS,
    updated_at: SEED_TS,
  });

  const po3Lines: PurchaseOrderLine[] = [
    {
      id: SEED_PO_LINE_4,
      po_id: SEED_PO_3,
      product_id: 'cccccccc-0001-4000-8000-000000000001',
      quantity: '3.00',
      price: '18.50',
      line_total: calculateLineTotal('3', '18.50'), // 55.50
    },
  ];

  purchaseOrders.set(SEED_PO_3, {
    id: SEED_PO_3,
    po_number: 'PO-2026-0003',
    vendor_id: SEED_VENDOR_3,
    order_date: '2026-04-10',
    status: 'Closed',
    currency: 'EUR',
    total: calculateOrderTotal(po3Lines.map((l) => ({ quantity: l.quantity, price: l.price }))),
    lines: po3Lines,
    created_at: SEED_TS,
    updated_at: SEED_TS,
  });

  const poByNumber = new Map<string, string>([
    ['PO-2026-0001', SEED_PO_1],
    ['PO-2026-0002', SEED_PO_2],
    ['PO-2026-0003', SEED_PO_3],
  ]);

  return {
    vendors,
    vendorsByTaxNumber,
    purchaseOrders,
    poByNumber,
    receipts: new Map(),
    emittedEvents: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Envelope Helper (ADR-002)
// ─────────────────────────────────────────────────────────────────────────────

function standardError(
  reply: any,
  statusCode: number,
  code: string,
  message: string,
  details: Array<{ field?: string; message: string; code?: string }> = []
) {
  return reply.status(statusCode).send({
    statusCode,
    error: code,
    code,
    message,
    details,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Server Factory
// ─────────────────────────────────────────────────────────────────────────────

export interface Erp2MockServerInstance {
  app: FastifyInstance;
  store: Erp2MockStore;
  reset: () => void;
  stop: () => Promise<void>;
}

export function createErp2MockServer(): Erp2MockServerInstance {
  let store = createInitialErp2MockStore();

  const app = fastify({ logger: false });

  // ── Vendors ──────────────────────────────────────────────────────────────

  // GET /api/v1/erp-vendors/vendors
  app.get('/api/v1/erp-vendors/vendors', async (request, reply) => {
    const parse = VendorListQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Invalid query parameters',
        parse.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      );
    }

    const { page = 1, pageSize = 20, search } = parse.data;

    let items = Array.from(store.vendors.values());

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.email.toLowerCase().includes(q) ||
          v.tax_number.toLowerCase().includes(q)
      );
    }

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;
    const paginatedItems = items.slice(offset, offset + pageSize);

    return reply.status(200).send({
      items: paginatedItems,
      total,
      page,
      pageSize,
      totalPages,
    });
  });

  // POST /api/v1/erp-vendors/vendors
  app.post('/api/v1/erp-vendors/vendors', async (request, reply) => {
    const parse = CreateVendorRequestSchema.safeParse(request.body);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Validation failed',
        parse.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      );
    }

    const data = parse.data;

    // Idempotency key replay
    const idempKey = data.idempotency_key;
    if (idempKey) {
      const prior = store.receipts.get(idempKey);
      if (prior) {
        return reply.status(200).send(prior.response);
      }
    }

    // Duplicate tax_number check (deterministic exact match)
    const normalizedTax = normalizeTaxNumber(data.tax_number);
    if (store.vendorsByTaxNumber.has(normalizedTax)) {
      return standardError(
        reply,
        409,
        'CONFLICT',
        `Vendor with tax_number '${data.tax_number}' already exists`,
        [{ field: 'tax_number', message: 'Duplicate tax number', code: 'DUPLICATE_TAX_NUMBER' }]
      );
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    const vendor: Vendor = {
      id,
      name: data.name,
      tax_number: data.tax_number,
      email: data.email,
      phone: data.phone ?? null,
      address_line: data.address_line ?? null,
      city: data.city ?? null,
      country: data.country ?? null,
      // Mask bank details server-side; raw value never stored or returned
      bank_masked: data.bank_details ? maskBankDetails(data.bank_details) : null,
      currency: data.currency ?? 'USD',
      source_system: data.source_system ?? null,
      source_id: data.source_id ?? null,
      created_at: now,
      updated_at: now,
    };

    store.vendors.set(id, vendor);
    store.vendorsByTaxNumber.set(normalizedTax, id);

    // Emit domain event
    store.emittedEvents.push(
      createErp2Event({
        eventId: randomUUID(),
        eventType: ERP2_EVENT_TYPES.VENDOR_CREATED,
        correlationId: randomUUID(),
        entityType: 'vendor',
        entityId: id,
        payload: {
          ...vendor,
        },
      })
    );

    if (idempKey) {
      store.receipts.set(idempKey, { targetId: id, payloadHash: '', response: vendor });
    }

    return reply.status(201).send(vendor);
  });

  // GET /api/v1/erp-vendors/vendors/:id
  app.get('/api/v1/erp-vendors/vendors/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const vendor = store.vendors.get(id);
    if (!vendor) {
      return standardError(reply, 404, 'NOT_FOUND', `Vendor '${id}' not found`);
    }
    return reply.status(200).send(vendor);
  });

  // PATCH /api/v1/erp-vendors/vendors/:id
  app.patch('/api/v1/erp-vendors/vendors/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = store.vendors.get(id);
    if (!existing) {
      return standardError(reply, 404, 'NOT_FOUND', `Vendor '${id}' not found`);
    }

    const parse = UpdateVendorRequestSchema.safeParse(request.body);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Validation failed',
        parse.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      );
    }

    const data = parse.data;

    // Duplicate tax_number check if being changed
    if (data.tax_number && data.tax_number !== existing.tax_number) {
      const normalizedTax = normalizeTaxNumber(data.tax_number);
      if (store.vendorsByTaxNumber.has(normalizedTax)) {
        return standardError(
          reply,
          409,
          'CONFLICT',
          `Vendor with tax_number '${data.tax_number}' already exists`,
          [{ field: 'tax_number', message: 'Duplicate tax number', code: 'DUPLICATE_TAX_NUMBER' }]
        );
      }
      // Update index
      store.vendorsByTaxNumber.delete(normalizeTaxNumber(existing.tax_number));
      store.vendorsByTaxNumber.set(normalizedTax, id);
    }

    const now = new Date().toISOString();

    const updated: Vendor = {
      ...existing,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.tax_number !== undefined && { tax_number: data.tax_number }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.phone !== undefined && { phone: data.phone ?? null }),
      ...(data.address_line !== undefined && { address_line: data.address_line ?? null }),
      ...(data.city !== undefined && { city: data.city ?? null }),
      ...(data.country !== undefined && { country: data.country ?? null }),
      ...(data.bank_details !== undefined && {
        bank_masked: data.bank_details ? maskBankDetails(data.bank_details) : null,
      }),
      ...(data.currency !== undefined && { currency: data.currency }),
      updated_at: now,
    };

    store.vendors.set(id, updated);

    // Emit domain event
    store.emittedEvents.push(
      createErp2Event({
        eventId: randomUUID(),
        eventType: ERP2_EVENT_TYPES.VENDOR_UPDATED,
        correlationId: randomUUID(),
        entityType: 'vendor',
        entityId: id,
        payload: {
          id,
          ...data,
          bank_masked: updated.bank_masked,
          updated_at: now,
        },
      })
    );

    return reply.status(200).send(updated);
  });

  // ── Purchase Orders ───────────────────────────────────────────────────────

  // GET /api/v1/erp-vendors/purchase-orders
  app.get('/api/v1/erp-vendors/purchase-orders', async (request, reply) => {
    const parse = PurchaseOrderListQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Invalid query parameters',
        parse.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      );
    }

    const { page = 1, pageSize = 20, vendor_id, status } = parse.data;

    let items = Array.from(store.purchaseOrders.values());

    if (vendor_id) {
      items = items.filter((po) => po.vendor_id === vendor_id);
    }
    if (status) {
      items = items.filter((po) => po.status === status);
    }

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;
    const paginatedItems = items.slice(offset, offset + pageSize);

    return reply.status(200).send({
      items: paginatedItems,
      total,
      page,
      pageSize,
      totalPages,
    });
  });

  // POST /api/v1/erp-vendors/purchase-orders
  app.post('/api/v1/erp-vendors/purchase-orders', async (request, reply) => {
    const parse = CreatePurchaseOrderRequestSchema.safeParse(request.body);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Validation failed',
        parse.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      );
    }

    const data = parse.data;

    // Idempotency key replay
    const idempKey = data.idempotency_key;
    if (idempKey) {
      const prior = store.receipts.get(idempKey);
      if (prior) {
        return reply.status(200).send(prior.response);
      }
    }

    // Validate vendor exists
    const vendor = store.vendors.get(data.vendor_id);
    if (!vendor) {
      return standardError(
        reply,
        422,
        'UNPROCESSABLE_ENTITY',
        `Vendor '${data.vendor_id}' not found`,
        [{ field: 'vendor_id', message: 'Unknown vendor', code: 'VENDOR_NOT_FOUND' }]
      );
    }

    // Validate all product_ids are known ERP-1 products (BR-ERP2-01)
    for (const line of data.lines) {
      if (!KNOWN_ERP1_PRODUCT_IDS.has(line.product_id)) {
        return standardError(
          reply,
          422,
          'UNPROCESSABLE_ENTITY',
          `Product '${line.product_id}' not found in ERP-1 catalog (BR-ERP2-01)`,
          [
            {
              field: 'lines.product_id',
              message: `Unknown product: ${line.product_id}`,
              code: 'UNKNOWN_PRODUCT',
            },
          ]
        );
      }
    }

    // Duplicate PO number check
    const poNum = data.po_number ?? `PO-AUTO-${randomUUID().slice(0, 8).toUpperCase()}`;
    if (store.poByNumber.has(poNum)) {
      return standardError(
        reply,
        409,
        'CONFLICT',
        `Purchase order with po_number '${poNum}' already exists`,
        [{ field: 'po_number', message: 'Duplicate PO number', code: 'PO_NUMBER_DUPLICATE' }]
      );
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    // Compute line totals using integer (cent) arithmetic
    const lines: PurchaseOrderLine[] = data.lines.map((l) => ({
      id: randomUUID(),
      po_id: id,
      product_id: l.product_id,
      quantity: String(l.quantity),
      price: String(l.price),
      line_total: calculateLineTotal(l.quantity, l.price),
    }));

    const total = calculateOrderTotal(
      lines.map((l) => ({ quantity: l.quantity, price: l.price, line_total: l.line_total }))
    );

    const po: PurchaseOrder = {
      id,
      po_number: poNum,
      vendor_id: data.vendor_id,
      order_date: data.order_date,
      status: 'Draft',
      currency: data.currency ?? 'USD',
      total,
      lines,
      created_at: now,
      updated_at: now,
    };

    store.purchaseOrders.set(id, po);
    store.poByNumber.set(poNum, id);

    // Emit domain event
    store.emittedEvents.push(
      createErp2Event({
        eventId: randomUUID(),
        eventType: ERP2_EVENT_TYPES.PURCHASE_ORDER_CREATED,
        correlationId: randomUUID(),
        entityType: 'purchase_order',
        entityId: id,
        payload: {
          id,
          po_number: poNum,
          vendor_id: data.vendor_id,
          order_date: data.order_date,
          status: 'Draft',
          currency: data.currency ?? 'USD',
          total,
          line_count: lines.length,
          lines: lines.map((l) => ({
            id: l.id,
            product_id: l.product_id,
            quantity: l.quantity,
            price: l.price,
            line_total: l.line_total,
          })),
          created_at: now,
        },
      })
    );

    if (idempKey) {
      store.receipts.set(idempKey, { targetId: id, payloadHash: '', response: po });
    }

    return reply.status(201).send(po);
  });

  // GET /api/v1/erp-vendors/purchase-orders/:id
  app.get('/api/v1/erp-vendors/purchase-orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const po = store.purchaseOrders.get(id);
    if (!po) {
      return standardError(reply, 404, 'NOT_FOUND', `Purchase order '${id}' not found`);
    }
    return reply.status(200).send(po);
  });

  // PATCH /api/v1/erp-vendors/purchase-orders/:id  (status transition only)
  app.patch('/api/v1/erp-vendors/purchase-orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const po = store.purchaseOrders.get(id);
    if (!po) {
      return standardError(reply, 404, 'NOT_FOUND', `Purchase order '${id}' not found`);
    }

    const parse = UpdatePurchaseOrderStatusRequestSchema.safeParse(request.body);
    if (!parse.success) {
      return standardError(
        reply,
        400,
        'VALIDATION_ERROR',
        parse.error.issues[0]?.message ?? 'Validation failed',
        parse.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      );
    }

    const { status: newStatus } = parse.data;
    const prevStatus = po.status as PurchaseOrderStatus;

    // Enforce strict unidirectional state machine
    const allowed = ALLOWED_PO_STATUS_TRANSITIONS[prevStatus] ?? [];
    if (newStatus !== prevStatus && !allowed.includes(newStatus)) {
      return standardError(
        reply,
        422,
        'UNPROCESSABLE_ENTITY',
        `Invalid PO status transition from '${prevStatus}' to '${newStatus}'. Allowed: ${allowed.join(', ') || 'none (terminal)'}`,
        [
          {
            field: 'status',
            message: 'Invalid status transition',
            code: 'INVALID_STATUS_TRANSITION',
          },
        ]
      );
    }

    const now = new Date().toISOString();
    const updated: PurchaseOrder = { ...po, status: newStatus, updated_at: now };
    store.purchaseOrders.set(id, updated);

    // Emit status_changed event
    if (newStatus !== prevStatus) {
      store.emittedEvents.push(
        createErp2Event({
          eventId: randomUUID(),
          eventType: ERP2_EVENT_TYPES.PURCHASE_ORDER_STATUS_CHANGED,
          correlationId: randomUUID(),
          entityType: 'purchase_order',
          entityId: id,
          payload: {
            id,
            po_number: po.po_number,
            vendor_id: po.vendor_id,
            previous_status: prevStatus,
            new_status: newStatus,
            changed_at: now,
          },
        })
      );

      // If transitioning to Received, also emit purchase_order.received
      if (newStatus === 'Received') {
        store.emittedEvents.push(
          createErp2Event({
            eventId: randomUUID(),
            eventType: ERP2_EVENT_TYPES.PURCHASE_ORDER_RECEIVED,
            correlationId: randomUUID(),
            entityType: 'purchase_order',
            entityId: id,
            payload: {
              purchaseOrderId: id,
              poNumber: po.po_number,
              vendorId: po.vendor_id,
              receivedAt: now,
              currency: po.currency,
              total: po.total,
              lines: po.lines.map((l) => ({
                productId: l.product_id,
                quantityReceived: l.quantity,
              })),
            },
          })
        );
      }
    }

    return reply.status(200).send(updated);
  });

  // ── 404 catch-all ─────────────────────────────────────────────────────────
  app.setNotFoundHandler((_request, reply) => {
    return standardError(reply, 404, 'NOT_FOUND', 'Route not found');
  });

  return {
    app,
    get store() {
      return store;
    },
    reset() {
      store = createInitialErp2MockStore();
    },
    async stop() {
      await app.close();
    },
  };
}
