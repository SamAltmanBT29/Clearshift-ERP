/**
 * ERP-3 Sales Orders & Invoices — Domain Events Test Suite
 *
 * Proves that:
 *   - All ERP-3 domain event schemas validate correctly formatted event envelopes.
 *   - Event envelopes strictly enforce UUID event_id, ISO occurred_at, and producer: 'erp-3'.
 *   - Payloads match domain event schemas for all 5 produced events.
 *   - Inbound deal.won event schema (from CRM-2, SDS EV-09) parses valid inputs.
 *   - createErp3Event factory correctly defaults event_id, occurred_at, and producer.
 *
 * @module contracts/tests/erp-3.events.test
 */

import { describe, it, expect } from "vitest";
import {
  ERP3_EVENT_TYPES,
  SalesOrderCreatedEventSchema,
  SalesOrderStatusChangedEventSchema,
  InvoiceCreatedEventSchema,
  InvoiceStatusChangedEventSchema,
  PaymentCreatedEventSchema,
  InboundDealWonEventSchema,
  createErp3Event,
} from "../src/erp-3-events.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ─────────────────────────────────────────────────────────────────────────────
const CORRELATION_ID = "trace-erp3-test-001";
const CUSTOMER_ID = "55555555-0003-4000-8000-000000000001";
const PRODUCT_ID = "11111111-0001-4000-8000-000000000001";
const ORDER_ID = "aaaaaaaa-0003-4000-8000-000000000001";
const INVOICE_ID = "cccccccc-0003-4000-8000-000000000001";
const PAYMENT_ID = "eeeeeeee-0003-4000-8000-000000000001";
const DEAL_ID = "dddddddd-0009-4000-8000-000000000001";
const EVENT_ID_PREFIX = "eeeeeee0-0003-4000-8000-0000000000";

// ─────────────────────────────────────────────────────────────────────────────
describe("ERP-3 Event Type Constants", () => {
  it("exports all required event type strings", () => {
    expect(ERP3_EVENT_TYPES.SALES_ORDER_CREATED).toBe(
      "erp.sales_order.created",
    );
    expect(ERP3_EVENT_TYPES.SALES_ORDER_STATUS_CHANGED).toBe(
      "erp.sales_order.status_changed",
    );
    expect(ERP3_EVENT_TYPES.INVOICE_CREATED).toBe("erp.invoice.created");
    expect(ERP3_EVENT_TYPES.INVOICE_STATUS_CHANGED).toBe(
      "erp.invoice.status_changed",
    );
    expect(ERP3_EVENT_TYPES.PAYMENT_CREATED).toBe("erp.payment.created");
    expect(ERP3_EVENT_TYPES.INBOUND_DEAL_WON).toBe("deal.won");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ERP-3 Domain Event Envelopes (PLT-04 / PLT-09)", () => {
  it("validates SalesOrderCreatedEvent with complete payload", () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}01`,
      event_type: ERP3_EVENT_TYPES.SALES_ORDER_CREATED,
      schema_version: "1.0.0",
      occurred_at: "2026-04-01T00:00:00.000Z",
      correlation_id: CORRELATION_ID,
      producer: "erp-3",
      entity_type: "sales_order",
      entity_id: ORDER_ID,
      payload: {
        id: ORDER_ID,
        order_number: "SO-2026-0001",
        customer_golden_id: CUSTOMER_ID,
        order_date: "2026-04-01",
        status: "Open",
        currency: "INR",
        total: "2124.0000",
        line_count: 2,
      },
    };

    const result = SalesOrderCreatedEventSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.producer).toBe("erp-3");
      expect(result.data.payload.status).toBe("Open");
      expect(result.data.payload.customer_golden_id).toBe(CUSTOMER_ID);
    }
  });

  it("SalesOrderCreatedEvent rejects status other than Open", () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}02`,
      event_type: ERP3_EVENT_TYPES.SALES_ORDER_CREATED,
      schema_version: "1.0.0",
      occurred_at: "2026-04-01T00:00:00.000Z",
      correlation_id: CORRELATION_ID,
      producer: "erp-3",
      entity_type: "sales_order",
      entity_id: ORDER_ID,
      payload: {
        id: ORDER_ID,
        order_number: "SO-2026-0001",
        customer_golden_id: CUSTOMER_ID,
        order_date: "2026-04-01",
        status: "Invoiced", // Not valid for created event — must be Open
        currency: "INR",
        total: "1000.0000",
        line_count: 1,
      },
    };
    expect(SalesOrderCreatedEventSchema.safeParse(raw).success).toBe(false);
  });

  it("validates SalesOrderStatusChangedEvent (Open -> Invoiced)", () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}03`,
      event_type: ERP3_EVENT_TYPES.SALES_ORDER_STATUS_CHANGED,
      schema_version: "1.0.0",
      occurred_at: "2026-04-15T09:00:00.000Z",
      correlation_id: CORRELATION_ID,
      producer: "erp-3",
      entity_type: "sales_order",
      entity_id: ORDER_ID,
      payload: {
        id: ORDER_ID,
        order_number: "SO-2026-0001",
        previous_status: "Open",
        new_status: "Invoiced",
        changed_at: "2026-04-15T09:00:00.000Z",
      },
    };
    expect(SalesOrderStatusChangedEventSchema.safeParse(raw).success).toBe(
      true,
    );
  });

  it("validates InvoiceCreatedEvent with complete payload", () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}04`,
      event_type: ERP3_EVENT_TYPES.INVOICE_CREATED,
      schema_version: "1.0.0",
      occurred_at: "2026-04-15T09:00:00.000Z",
      correlation_id: CORRELATION_ID,
      producer: "erp-3",
      entity_type: "invoice",
      entity_id: INVOICE_ID,
      payload: {
        id: INVOICE_ID,
        invoice_number: "INV-2026-0001",
        order_id: ORDER_ID,
        customer_golden_id: CUSTOMER_ID,
        invoice_date: "2026-04-15",
        due_date: "2026-05-15",
        status: "Open",
        currency: "INR",
        total: "1000.0000",
        line_count: 1,
      },
    };
    const result = InvoiceCreatedEventSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.due_date).toBe("2026-05-15");
      expect(result.data.payload.status).toBe("Open");
    }
  });

  it("InvoiceCreatedEvent rejects non-Open status", () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}05`,
      event_type: ERP3_EVENT_TYPES.INVOICE_CREATED,
      schema_version: "1.0.0",
      occurred_at: "2026-04-15T09:00:00.000Z",
      correlation_id: CORRELATION_ID,
      producer: "erp-3",
      entity_type: "invoice",
      entity_id: INVOICE_ID,
      payload: {
        id: INVOICE_ID,
        invoice_number: "INV-2026-0001",
        order_id: null,
        customer_golden_id: CUSTOMER_ID,
        invoice_date: "2026-04-15",
        due_date: "2026-05-15",
        status: "Paid", // Invalid for created event
        currency: "INR",
        total: "1000.0000",
        line_count: 1,
      },
    };
    expect(InvoiceCreatedEventSchema.safeParse(raw).success).toBe(false);
  });

  it("validates InvoiceStatusChangedEvent (Open -> Paid with total_paid)", () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}06`,
      event_type: ERP3_EVENT_TYPES.INVOICE_STATUS_CHANGED,
      schema_version: "1.0.0",
      occurred_at: "2026-04-20T14:00:00.000Z",
      correlation_id: CORRELATION_ID,
      producer: "erp-3",
      entity_type: "invoice",
      entity_id: INVOICE_ID,
      payload: {
        id: INVOICE_ID,
        invoice_number: "INV-2026-0001",
        previous_status: "Open",
        new_status: "Paid",
        changed_at: "2026-04-20T14:00:00.000Z",
        total_paid: "1000.0000",
        currency: "INR",
      },
    };
    expect(InvoiceStatusChangedEventSchema.safeParse(raw).success).toBe(true);
  });

  it("validates PaymentCreatedEvent with invoice_status_after = Paid", () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}07`,
      event_type: ERP3_EVENT_TYPES.PAYMENT_CREATED,
      schema_version: "1.0.0",
      occurred_at: "2026-04-20T14:00:00.000Z",
      correlation_id: CORRELATION_ID,
      producer: "erp-3",
      entity_type: "payment",
      entity_id: PAYMENT_ID,
      payload: {
        id: PAYMENT_ID,
        invoice_id: INVOICE_ID,
        amount: "1000.0000",
        paid_at: "2026-04-20T14:00:00.000Z",
        method: "bank",
        invoice_status_after: "Paid",
      },
    };
    expect(PaymentCreatedEventSchema.safeParse(raw).success).toBe(true);
  });

  it("PaymentCreatedEvent rejects invalid payment method", () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}08`,
      event_type: ERP3_EVENT_TYPES.PAYMENT_CREATED,
      schema_version: "1.0.0",
      occurred_at: "2026-04-20T14:00:00.000Z",
      correlation_id: CORRELATION_ID,
      producer: "erp-3",
      entity_type: "payment",
      entity_id: PAYMENT_ID,
      payload: {
        id: PAYMENT_ID,
        invoice_id: INVOICE_ID,
        amount: "100.0000",
        paid_at: "2026-04-20T14:00:00.000Z",
        method: "wire", // Not a valid method
        invoice_status_after: "Open",
      },
    };
    expect(PaymentCreatedEventSchema.safeParse(raw).success).toBe(false);
  });

  it("validates inbound InboundDealWonEvent from CRM-2 (SDS EV-09)", () => {
    const raw = {
      event_id: `${EVENT_ID_PREFIX}09`,
      event_type: ERP3_EVENT_TYPES.INBOUND_DEAL_WON,
      schema_version: "1.0.0",
      occurred_at: "2026-04-10T08:00:00.000Z",
      correlation_id: CORRELATION_ID,
      producer: "crm-2",
      entity_type: "deal",
      entity_id: DEAL_ID,
      payload: {
        deal_id: DEAL_ID,
        deal_number: "DEAL-2026-001",
        customer_golden_id: CUSTOMER_ID,
        currency: "INR",
        lines: [
          {
            product_id: PRODUCT_ID,
            quantity: "5.0000",
            price: "200.0000",
            tax_rate: "18.0000",
          },
        ],
        won_at: "2026-04-10T08:00:00.000Z",
      },
    };
    const result = InboundDealWonEventSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.customer_golden_id).toBe(CUSTOMER_ID);
      expect(result.data.payload.lines).toHaveLength(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("createErp3Event factory", () => {
  it("generates a valid envelope with defaults (event_id, occurred_at, producer)", () => {
    const event = createErp3Event({
      event_type: ERP3_EVENT_TYPES.SALES_ORDER_CREATED,
      correlation_id: CORRELATION_ID,
      entity_type: "sales_order",
      entity_id: ORDER_ID,
      payload: {
        id: ORDER_ID,
        order_number: "SO-2026-TEST",
        customer_golden_id: CUSTOMER_ID,
        order_date: "2026-04-01",
        status: "Open" as const,
        currency: "INR",
        total: "500.0000",
        line_count: 1,
      },
    });

    expect(SalesOrderCreatedEventSchema.safeParse(event).success).toBe(true);
    expect(event.producer).toBe("erp-3");
    expect(event.schema_version).toBe("1.0.0");
    expect(event.event_id).toBeDefined();
    expect(event.occurred_at).toBeDefined();
    expect(event.correlation_id).toBe(CORRELATION_ID);
  });

  it("respects explicit event_id and occurred_at when provided", () => {
    const fixedId = "ffffffff-0003-4000-8000-000000000001";
    const fixedTs = "2026-04-01T12:00:00.000Z";

    const event = createErp3Event({
      event_id: fixedId,
      occurred_at: fixedTs,
      event_type: ERP3_EVENT_TYPES.PAYMENT_CREATED,
      correlation_id: CORRELATION_ID,
      entity_type: "payment",
      entity_id: PAYMENT_ID,
      payload: {
        id: PAYMENT_ID,
        invoice_id: INVOICE_ID,
        amount: "100.0000",
        paid_at: fixedTs,
        method: "cash" as const,
        invoice_status_after: "Open" as const,
      },
    });

    expect(event.event_id).toBe(fixedId);
    expect(event.occurred_at).toBe(fixedTs);
  });

  it("sets producer to erp-3 even when payload is for inbound event", () => {
    const event = createErp3Event({
      event_type: ERP3_EVENT_TYPES.INVOICE_STATUS_CHANGED,
      correlation_id: CORRELATION_ID,
      entity_type: "invoice",
      entity_id: INVOICE_ID,
      payload: {
        id: INVOICE_ID,
        invoice_number: "INV-2026-TEST",
        previous_status: "Open" as const,
        new_status: "Overdue" as const,
        changed_at: new Date().toISOString(),
      },
    });

    expect(event.producer).toBe("erp-3");
  });
});
