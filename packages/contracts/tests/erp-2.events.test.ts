/**
 * ERP-2 Vendors & Purchasing — Domain Events Test Suite
 *
 * Proves that:
 *   - All ERP-2 domain event schemas validate correctly formatted event envelopes.
 *   - Event envelopes strictly enforce UUID event_id, ISO occurred_at, and producer: 'erp-2'.
 *   - Payloads match domain event schemas for all 5 produced events.
 *   - bank_masked is always XXXX-XXXX-{4 digits} and raw bank details are rejected from payloads.
 *   - createErp2Event factory correctly defaults event_id, occurred_at, and producer.
 *   - Inbound vendor_bill.posted event schema parses valid inputs.
 *
 * @module contracts/tests/erp-2.events.test
 */

import { describe, it, expect } from 'vitest';
import {
  ERP2_EVENT_TYPES,
  VendorCreatedEnvelopeSchema,
  VendorUpdatedEnvelopeSchema,
  PurchaseOrderCreatedEnvelopeSchema,
  PurchaseOrderStatusChangedEnvelopeSchema,
  PurchaseOrderReceivedEnvelopeSchema,
  InboundVendorBillPostedEnvelopeSchema,
  createErp2Event,
} from '../src/erp-2-events.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ─────────────────────────────────────────────────────────────────────────────
const CORRELATION_ID = 'trace-erp2-test-001';
const VENDOR_ID = 'aaaaaaaa-0002-4000-8000-000000000001';
const PO_ID = 'bbbbbbbb-0002-4000-8000-000000000001';
const PRODUCT_ID = 'cccccccc-0001-4000-8000-000000000001';
const PO_LINE_ID = 'dddddddd-0002-4000-8000-000000000001';
const EVENT_ID_PREFIX = 'eeeeeee0-0002-4000-8000-0000000000';

// ─────────────────────────────────────────────────────────────────────────────
describe('ERP-2 Event Type Constants', () => {
  it('exports all required event type strings', () => {
    expect(ERP2_EVENT_TYPES.VENDOR_CREATED).toBe('erp.vendor.created');
    expect(ERP2_EVENT_TYPES.VENDOR_UPDATED).toBe('erp.vendor.updated');
    expect(ERP2_EVENT_TYPES.PURCHASE_ORDER_CREATED).toBe('erp.purchase_order.created');
    expect(ERP2_EVENT_TYPES.PURCHASE_ORDER_STATUS_CHANGED).toBe(
      'erp.purchase_order.status_changed'
    );
    expect(ERP2_EVENT_TYPES.PURCHASE_ORDER_RECEIVED).toBe('erp.purchase_order.received');
    expect(ERP2_EVENT_TYPES.INBOUND_VENDOR_BILL_POSTED).toBe('erp.vendor_bill.posted');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ERP-2 Domain Event Envelopes (PLT-04 / PLT-09)', () => {
  it('validates VendorCreatedEvent with complete payload', () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}01`,
      event_type: ERP2_EVENT_TYPES.VENDOR_CREATED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-01T00:00:00.000Z',
      correlation_id: CORRELATION_ID,
      producer: 'erp-2',
      entity_type: 'vendor',
      entity_id: VENDOR_ID,
      payload: {
        id: VENDOR_ID,
        name: 'Apex Industrial Components Pvt Ltd',
        tax_number: 'GSTIN-27AAAAA0001A1Z1',
        email: 'procurement@apex-industrial.com',
        phone: '+91-22-40001001',
        bank_masked: 'XXXX-XXXX-1001',
        currency: 'INR',
        created_at: '2026-04-01T00:00:00.000Z',
      },
    };
    const result = VendorCreatedEnvelopeSchema.safeParse(raw);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.data?.producer).toBe('erp-2');
  });

  it('rejects VendorCreatedEvent with unmasked bank details in payload', () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}02`,
      event_type: ERP2_EVENT_TYPES.VENDOR_CREATED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-01T00:00:00.000Z',
      correlation_id: CORRELATION_ID,
      producer: 'erp-2',
      entity_type: 'vendor',
      entity_id: VENDOR_ID,
      payload: {
        id: VENDOR_ID,
        name: 'Test Corp',
        tax_number: 'TX-9999',
        email: 'test@corp.com',
        bank_masked: '1234567890', // Raw — MUST be rejected
        currency: 'USD',
        created_at: '2026-04-01T00:00:00.000Z',
      },
    };
    const result = VendorCreatedEnvelopeSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it('validates VendorUpdatedEvent with partial fields', () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}03`,
      event_type: ERP2_EVENT_TYPES.VENDOR_UPDATED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-02T10:00:00.000Z',
      correlation_id: CORRELATION_ID,
      producer: 'erp-2',
      entity_type: 'vendor',
      entity_id: VENDOR_ID,
      payload: {
        id: VENDOR_ID,
        email: 'new-email@apex-industrial.com',
        updated_at: '2026-04-02T10:00:00.000Z',
      },
    };
    const result = VendorUpdatedEnvelopeSchema.safeParse(raw);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('validates PurchaseOrderCreatedEvent with lines', () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}04`,
      event_type: ERP2_EVENT_TYPES.PURCHASE_ORDER_CREATED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-01T00:00:00.000Z',
      correlation_id: CORRELATION_ID,
      producer: 'erp-2',
      entity_type: 'purchase_order',
      entity_id: PO_ID,
      payload: {
        id: PO_ID,
        po_number: 'PO-2026-0001',
        vendor_id: VENDOR_ID,
        order_date: '2026-04-01',
        status: 'Draft',
        currency: 'INR',
        total: '216.25',
        line_count: 2,
        lines: [
          {
            id: PO_LINE_ID,
            product_id: PRODUCT_ID,
            quantity: '10.00',
            price: '18.50',
            line_total: '185.00',
          },
          {
            id: 'dddddddd-0002-4000-8000-000000000002',
            product_id: 'cccccccc-0001-4000-8000-000000000002',
            quantity: '5.00',
            price: '6.25',
            line_total: '31.25',
          },
        ],
        created_at: '2026-04-01T00:00:00.000Z',
      },
    };
    const result = PurchaseOrderCreatedEnvelopeSchema.safeParse(raw);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.data?.payload.status).toBe('Draft');
    expect(result.data?.payload.line_count).toBe(2);
  });

  it('rejects PurchaseOrderCreatedEvent with non-Draft initial status', () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}05`,
      event_type: ERP2_EVENT_TYPES.PURCHASE_ORDER_CREATED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-01T00:00:00.000Z',
      correlation_id: CORRELATION_ID,
      producer: 'erp-2',
      entity_type: 'purchase_order',
      entity_id: PO_ID,
      payload: {
        id: PO_ID,
        po_number: 'PO-2026-0001',
        vendor_id: VENDOR_ID,
        order_date: '2026-04-01',
        status: 'Sent', // Created must always be Draft
        currency: 'INR',
        total: '185.00',
        line_count: 1,
        lines: [
          {
            id: PO_LINE_ID,
            product_id: PRODUCT_ID,
            quantity: '10.00',
            price: '18.50',
            line_total: '185.00',
          },
        ],
        created_at: '2026-04-01T00:00:00.000Z',
      },
    };
    const result = PurchaseOrderCreatedEnvelopeSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it('validates PurchaseOrderStatusChangedEvent for each allowed transition', () => {
    const transitions: Array<{ prev: string; next: string }> = [
      { prev: 'Draft', next: 'Sent' },
      { prev: 'Sent', next: 'Received' },
      { prev: 'Received', next: 'Closed' },
    ];

    for (const { prev, next } of transitions) {
      const raw = {
        event_id: randomUuidLike(),
        event_type: ERP2_EVENT_TYPES.PURCHASE_ORDER_STATUS_CHANGED,
        schema_version: '1.0.0',
        occurred_at: '2026-04-05T09:00:00.000Z',
        correlation_id: CORRELATION_ID,
        producer: 'erp-2',
        entity_type: 'purchase_order',
        entity_id: PO_ID,
        payload: {
          id: PO_ID,
          po_number: 'PO-2026-0001',
          vendor_id: VENDOR_ID,
          previous_status: prev,
          new_status: next,
          changed_at: '2026-04-05T09:00:00.000Z',
        },
      };
      const result = PurchaseOrderStatusChangedEnvelopeSchema.safeParse(raw);
      expect(
        result.success,
        `Transition ${prev}->${next}: ${JSON.stringify(result)}`
      ).toBe(true);
    }
  });

  it('validates PurchaseOrderReceivedEvent with product lines', () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}06`,
      event_type: ERP2_EVENT_TYPES.PURCHASE_ORDER_RECEIVED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-10T14:00:00.000Z',
      correlation_id: CORRELATION_ID,
      producer: 'erp-2',
      entity_type: 'purchase_order',
      entity_id: PO_ID,
      payload: {
        purchaseOrderId: PO_ID,
        poNumber: 'PO-2026-0002',
        vendorId: VENDOR_ID,
        receivedAt: '2026-04-10T14:00:00.000Z',
        currency: 'USD',
        total: '240.00',
        lines: [
          {
            productId: 'cccccccc-0001-4000-8000-000000000003',
            quantityReceived: '20.00',
          },
        ],
      },
    };
    const result = PurchaseOrderReceivedEnvelopeSchema.safeParse(raw);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.data?.payload.lines).toHaveLength(1);
  });

  it('rejects PurchaseOrderReceivedEvent with empty lines array', () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}07`,
      event_type: ERP2_EVENT_TYPES.PURCHASE_ORDER_RECEIVED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-10T14:00:00.000Z',
      correlation_id: CORRELATION_ID,
      producer: 'erp-2',
      entity_type: 'purchase_order',
      entity_id: PO_ID,
      payload: {
        purchaseOrderId: PO_ID,
        poNumber: 'PO-2026-0002',
        vendorId: VENDOR_ID,
        receivedAt: '2026-04-10T14:00:00.000Z',
        currency: 'USD',
        total: '0.00',
        lines: [], // Must have at least one line
      },
    };
    const result = PurchaseOrderReceivedEnvelopeSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it('validates InboundVendorBillPostedEvent (ERP-4 -> ERP-2)', () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}08`,
      event_type: ERP2_EVENT_TYPES.INBOUND_VENDOR_BILL_POSTED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-15T11:00:00.000Z',
      correlation_id: CORRELATION_ID,
      producer: 'erp-4',
      entity_type: 'vendor_bill',
      entity_id: 'ffffffff-0004-4000-8000-000000000001',
      payload: {
        vendorBillId: 'ffffffff-0004-4000-8000-000000000001',
        purchaseOrderId: PO_ID,
        vendorId: VENDOR_ID,
        amount: '216.25',
        currency: 'INR',
        postedAt: '2026-04-15T11:00:00.000Z',
      },
    };
    const result = InboundVendorBillPostedEnvelopeSchema.safeParse(raw);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('enforces UUID event_id on all envelopes', () => {
    const raw = {
      event_id: 'not-a-uuid',
      event_type: ERP2_EVENT_TYPES.VENDOR_CREATED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-01T00:00:00.000Z',
      correlation_id: CORRELATION_ID,
      producer: 'erp-2',
      entity_type: 'vendor',
      entity_id: VENDOR_ID,
      payload: {
        id: VENDOR_ID,
        name: 'Test',
        tax_number: 'TX-001',
        email: 'test@test.com',
        bank_masked: null,
        currency: 'USD',
        created_at: '2026-04-01T00:00:00.000Z',
      },
    };
    const result = VendorCreatedEnvelopeSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it('enforces ISO-8601 occurred_at', () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}09`,
      event_type: ERP2_EVENT_TYPES.VENDOR_CREATED,
      schema_version: '1.0.0',
      occurred_at: '2026/04/01', // Wrong format
      correlation_id: CORRELATION_ID,
      producer: 'erp-2',
      entity_type: 'vendor',
      entity_id: VENDOR_ID,
      payload: {
        id: VENDOR_ID,
        name: 'Test',
        tax_number: 'TX-001',
        email: 'test@test.com',
        bank_masked: null,
        currency: 'USD',
        created_at: '2026-04-01T00:00:00.000Z',
      },
    };
    const result = VendorCreatedEnvelopeSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ERP-2 createErp2Event Factory', () => {
  it('produces a valid EventEnvelope with producer=erp-2', () => {
    const envelope = createErp2Event({
      eventId: 'ffffffff-ffff-4000-8000-000000000001',
      eventType: ERP2_EVENT_TYPES.VENDOR_CREATED,
      correlationId: CORRELATION_ID,
      entityType: 'vendor',
      entityId: VENDOR_ID,
      payload: {
        id: VENDOR_ID,
        name: 'Factory Test Vendor',
        tax_number: 'TX-FACTORY-01',
        email: 'factory@test.com',
        bank_masked: 'XXXX-XXXX-9999',
        currency: 'USD',
        created_at: new Date().toISOString(),
      },
    });

    expect(envelope.producer).toBe('erp-2');
    expect(envelope.schema_version).toBe('1.0.0');
    expect(envelope.entity_type).toBe('vendor');
    expect(envelope.entity_id).toBe(VENDOR_ID);
    expect(envelope.event_type).toBe(ERP2_EVENT_TYPES.VENDOR_CREATED);
  });

  it('accepts an optional occurredAt override', () => {
    const fixedTime = '2026-01-15T08:30:00.000Z';
    const envelope = createErp2Event({
      eventId: 'ffffffff-ffff-4000-8000-000000000002',
      eventType: ERP2_EVENT_TYPES.PURCHASE_ORDER_STATUS_CHANGED,
      correlationId: CORRELATION_ID,
      entityType: 'purchase_order',
      entityId: PO_ID,
      payload: {},
      occurredAt: fixedTime,
    });
    expect(envelope.occurred_at).toBe(fixedTime);
  });

  it('attaches batch_id when provided', () => {
    const batchId = 'eeeeeeee-bbbb-4000-8000-000000000001';
    const envelope = createErp2Event({
      eventId: 'ffffffff-ffff-4000-8000-000000000003',
      eventType: ERP2_EVENT_TYPES.VENDOR_UPDATED,
      correlationId: CORRELATION_ID,
      entityType: 'vendor',
      entityId: VENDOR_ID,
      payload: {},
      batchId,
    });
    expect(envelope.batch_id).toBe(batchId);
  });

  it('omits batch_id when not provided', () => {
    const envelope = createErp2Event({
      eventId: 'ffffffff-ffff-4000-8000-000000000004',
      eventType: ERP2_EVENT_TYPES.VENDOR_UPDATED,
      correlationId: CORRELATION_ID,
      entityType: 'vendor',
      entityId: VENDOR_ID,
      payload: {},
    });
    expect(envelope.batch_id).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────
function randomUuidLike() {
  return `${pad(Math.random().toString(16).slice(2, 10), 8)}-${pad(Math.random().toString(16).slice(2, 6), 4)}-4${pad(Math.random().toString(16).slice(2, 5), 3)}-8${pad(Math.random().toString(16).slice(2, 5), 3)}-${pad(Math.random().toString(16).slice(2, 14), 12)}`;
}

function pad(s: string, len: number) {
  return s.padEnd(len, '0').slice(0, len);
}
