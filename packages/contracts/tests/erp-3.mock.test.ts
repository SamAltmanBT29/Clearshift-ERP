/**
 * ERP-3 Sales Orders & Invoices — Deterministic Mock Server Test Suite
 *
 * Proves that:
 *   - The mock server boots and provides representative, schema-valid payloads.
 *   - GET /sales-orders returns seeded data with bounded pagination.
 *   - POST /sales-orders creates an order, computes lines, emits a domain event.
 *   - GET /sales-orders/:id returns 200 for known ID and 404 for unknown.
 *   - Duplicate order_number returns 409.
 *   - GET /invoices returns seeded invoices with pagination.
 *   - POST /invoices creates an invoice with due_date, emits event.
 *   - GET /invoices/:id returns 200 / 404 as expected.
 *   - Duplicate invoice_number returns 409.
 *   - Invalid order_id reference returns 422.
 *   - POST /payments records payment, emits event, and auto-transitions to Paid (FR-ERP3-04).
 *   - POST /payments on already-Paid invoice returns 422 INVOICE_ALREADY_PAID.
 *   - POST /payments with excess amount returns 422 PAYMENT_EXCEEDS_INVOICE_TOTAL.
 *   - pageSize > 100 returns 400 VALIDATION_ERROR.
 *   - reset() restores deterministic seed state.
 *
 * @module contracts/tests/erp-3.mock.test
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  createErp3MockServer,
  DR1_ROUNDING_UNRESOLVED,
  type Erp3MockServerInstance,
} from "../src/erp-3-mock.js";
import {
  SalesOrderSchema,
  SalesOrderListResponseSchema,
  InvoiceSchema,
  InvoiceListResponseSchema,
  PaymentSchema,
  ERP3_RELATIONSHIP_ERROR_CODES,
} from "../src/erp-3.js";
import { ErrorEnvelopeSchema } from "../src/common.js";

// ─────────────────────────────────────────────────────────────────────────────
// Seed IDs (must match erp-3-mock.ts deterministic seed)
// ─────────────────────────────────────────────────────────────────────────────
const SEED_CUSTOMER_1 = "55555555-0003-4000-8000-000000000001";
const SEED_CUSTOMER_2 = "55555555-0003-4000-8000-000000000002";
const SEED_PRODUCT_1 = "11111111-0001-4000-8000-000000000001";
const SEED_PRODUCT_2 = "11111111-0001-4000-8000-000000000002";
const SEED_PRODUCT_3 = "11111111-0001-4000-8000-000000000003";
const SEED_ORDER_1 = "aaaaaaaa-0003-4000-8000-000000000001";
const SEED_INVOICE_1 = "cccccccc-0003-4000-8000-000000000001";
const SEED_INVOICE_2 = "cccccccc-0003-4000-8000-000000000002";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

// ─────────────────────────────────────────────────────────────────────────────
describe("ERP-3 Deterministic Mock Server", () => {
  let mock: Erp3MockServerInstance;

  beforeEach(() => {
    mock = createErp3MockServer();
  });

  afterAll(async () => {
    await mock.stop();
  });

  // ── 1. SALES ORDERS ─────────────────────────────────────────────────────────

  describe("Sales Orders", () => {
    it("GET /api/v1/erp-orders/sales-orders returns seeded data", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: "/api/v1/erp-orders/sales-orders?page=1&pageSize=10",
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(SalesOrderListResponseSchema.safeParse(json).success).toBe(true);
      expect(json.total).toBeGreaterThanOrEqual(2);
      expect(json.page).toBe(1);
      expect(json.pageSize).toBe(10);
      expect(json.data[0]?.order_number).toBeDefined();
    });

    it("GET /api/v1/erp-orders/sales-orders applies status filter", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: "/api/v1/erp-orders/sales-orders?status=Open",
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      for (const order of json.data) {
        expect(order.status).toBe("Open");
      }
    });

    it("GET /api/v1/erp-orders/sales-orders applies customer_golden_id filter", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: `/api/v1/erp-orders/sales-orders?customer_golden_id=${SEED_CUSTOMER_1}`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      for (const order of json.data) {
        expect(order.customer_golden_id).toBe(SEED_CUSTOMER_1);
      }
    });

    it("GET /api/v1/erp-orders/sales-orders rejects pageSize > 100", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: "/api/v1/erp-orders/sales-orders?pageSize=101",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_ERROR");
      expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
    });

    it("GET /api/v1/erp-orders/sales-orders applies currency, from_date, and to_date filters", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: "/api/v1/erp-orders/sales-orders?currency=INR&from_date=2026-04-10&to_date=2026-04-20",
      });

      expect(res.statusCode).toBe(200);
      const json = SalesOrderListResponseSchema.parse(res.json());
      expect(json.total).toBe(1);
      expect(json.data[0]?.order_number).toBe("SO-2026-0002");

      const emptyRes = await mock.app.inject({
        method: "GET",
        url: "/api/v1/erp-orders/sales-orders?currency=USD",
      });
      expect(emptyRes.statusCode).toBe(200);
      expect(SalesOrderListResponseSchema.parse(emptyRes.json()).total).toBe(0);
    });

    it("POST /api/v1/erp-orders/sales-orders creates an order and emits domain event", async () => {
      const payload = {
        customer_golden_id: SEED_CUSTOMER_1,
        order_date: "2026-04-20",
        currency: "INR",
        lines: [
          {
            product_id: SEED_PRODUCT_1,
            quantity: "3.0000",
            price: "100.0000",
            tax_rate: "0.0000",
          },
        ],
      };

      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        payload,
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(SalesOrderSchema.safeParse(json).success).toBe(true);
      expect(json.status).toBe("Open");
      expect(json.customer_golden_id).toBe(SEED_CUSTOMER_1);
      expect(json.lines).toHaveLength(1);
      expect(json.order_number).toBeDefined();
      // line_total = 3 × 100 + 0 tax = 300
      expect(json.total).toBe("300.0000");

      // Domain event emitted
      const events = mock.store.emittedEvents.filter(
        (e) => e.event_type === "erp.sales_order.created",
      );
      expect(events.length).toBe(1);
      expect(
        (events[0]?.payload as { customer_golden_id: string })
          .customer_golden_id,
      ).toBe(SEED_CUSTOMER_1);
    });

    it("POST /api/v1/erp-orders/sales-orders returns 409 on duplicate order_number", async () => {
      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        payload: {
          order_number: "SO-2026-0001", // Already in seed
          customer_golden_id: SEED_CUSTOMER_1,
          order_date: "2026-04-20",
          currency: "INR",
          lines: [
            {
              product_id: SEED_PRODUCT_2,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe(
        ERP3_RELATIONSHIP_ERROR_CODES.ORDER_NUMBER_EXISTS,
      );
    });

    it("POST /api/v1/erp-orders/sales-orders returns 400 on missing customer_golden_id", async () => {
      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        payload: {
          order_date: "2026-04-20",
          currency: "INR",
          lines: [
            {
              product_id: SEED_PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_ERROR");
    });

    it("GET /api/v1/erp-orders/sales-orders/:id returns 200 for seeded order", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: `/api/v1/erp-orders/sales-orders/${SEED_ORDER_1}`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(SalesOrderSchema.safeParse(json).success).toBe(true);
      expect(json.id).toBe(SEED_ORDER_1);
      expect(json.order_number).toBe("SO-2026-0001");
    });

    it("GET /api/v1/erp-orders/sales-orders/:id returns 404 for unknown ID", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: `/api/v1/erp-orders/sales-orders/${UNKNOWN_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe(
        ERP3_RELATIONSHIP_ERROR_CODES.ORDER_NOT_FOUND,
      );
    });
  });

  // ── 2. INVOICES ──────────────────────────────────────────────────────────────

  describe("Invoices", () => {
    it("GET /api/v1/erp-orders/invoices returns seeded invoices", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: "/api/v1/erp-orders/invoices?page=1&pageSize=10",
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(InvoiceListResponseSchema.safeParse(json).success).toBe(true);
      expect(json.total).toBeGreaterThanOrEqual(2);
    });

    it("GET /api/v1/erp-orders/invoices applies status filter", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: "/api/v1/erp-orders/invoices?status=Paid",
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      for (const invoice of json.data) {
        expect(invoice.status).toBe("Paid");
      }
    });

    it("GET /api/v1/erp-orders/invoices rejects pageSize > 100", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: "/api/v1/erp-orders/invoices?pageSize=200",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_ERROR");
      expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
    });

    it("GET /api/v1/erp-orders/invoices applies currency, from_date, and to_date filters", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: "/api/v1/erp-orders/invoices?currency=INR&from_date=2026-04-12&to_date=2026-04-20",
      });

      expect(res.statusCode).toBe(200);
      const json = InvoiceListResponseSchema.parse(res.json());
      expect(json.total).toBe(1);
      expect(json.data[0]?.invoice_number).toBe("INV-2026-0001");
    });

    it("POST /api/v1/erp-orders/invoices creates invoice with due_date and emits event", async () => {
      const payload = {
        customer_golden_id: SEED_CUSTOMER_2,
        invoice_date: "2026-04-20",
        due_date: "2026-05-20",
        currency: "INR",
        lines: [
          {
            product_id: SEED_PRODUCT_3,
            quantity: "2.0000",
            price: "250.0000",
            tax_rate: "0.0000",
          },
        ],
      };

      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload,
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(InvoiceSchema.safeParse(json).success).toBe(true);
      expect(json.status).toBe("Open");
      expect(json.due_date).toBe("2026-05-20");
      expect(json.total).toBe("500.0000"); // 2 × 250 = 500, no tax

      // Domain event
      const events = mock.store.emittedEvents.filter(
        (e) => e.event_type === "erp.invoice.created",
      );
      expect(events.length).toBe(1);
    });

    it("POST /api/v1/erp-orders/invoices returns 400 when due_date is missing", async () => {
      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          customer_golden_id: SEED_CUSTOMER_1,
          invoice_date: "2026-04-20",
          // due_date intentionally omitted
          currency: "INR",
          lines: [
            {
              product_id: SEED_PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_ERROR");
    });

    it("POST /api/v1/erp-orders/invoices returns 409 on duplicate invoice_number", async () => {
      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          invoice_number: "INV-2026-0001", // Already in seed
          customer_golden_id: SEED_CUSTOMER_2,
          invoice_date: "2026-04-20",
          due_date: "2026-05-20",
          currency: "INR",
          lines: [
            {
              product_id: SEED_PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe(
        ERP3_RELATIONSHIP_ERROR_CODES.INVOICE_NUMBER_EXISTS,
      );
    });

    it("POST /api/v1/erp-orders/invoices returns 422 on unknown order_id reference", async () => {
      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          customer_golden_id: SEED_CUSTOMER_1,
          order_id: UNKNOWN_ID, // Doesn't exist
          invoice_date: "2026-04-20",
          due_date: "2026-05-20",
          currency: "INR",
          lines: [
            {
              product_id: SEED_PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(
        ERP3_RELATIONSHIP_ERROR_CODES.ORDER_REF_NOT_FOUND,
      );
    });

    it("GET /api/v1/erp-orders/invoices/:id returns 200 for seeded invoice", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: `/api/v1/erp-orders/invoices/${SEED_INVOICE_1}`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(InvoiceSchema.safeParse(json).success).toBe(true);
      expect(json.id).toBe(SEED_INVOICE_1);
      expect(json.due_date).toBe("2026-05-15"); // Seeded value
    });

    it("GET /api/v1/erp-orders/invoices/:id returns 404 for unknown ID", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: `/api/v1/erp-orders/invoices/${UNKNOWN_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe(
        ERP3_RELATIONSHIP_ERROR_CODES.INVOICE_NOT_FOUND,
      );
    });
  });

  // ── 3. PAYMENTS ──────────────────────────────────────────────────────────────

  describe("Payments & FR-ERP3-04 Auto-Paid Transition", () => {
    it("POST /api/v1/erp-orders/payments records payment and returns 201", async () => {
      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/payments",
        payload: {
          invoice_id: SEED_INVOICE_1, // Open invoice, total 1000
          amount: "500.0000",
          method: "bank",
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(PaymentSchema.safeParse(json).success).toBe(true);
      expect(json.amount).toBe("500.0000");
      expect(json.method).toBe("bank");

      // Payment event emitted
      const events = mock.store.emittedEvents.filter(
        (e) => e.event_type === "erp.payment.created",
      );
      expect(events.length).toBe(1);
    });

    it("FR-ERP3-04: Full payment auto-transitions invoice to Paid", async () => {
      // SEED_INVOICE_1 total = 1000.0000
      const fullPayment = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/payments",
        payload: {
          invoice_id: SEED_INVOICE_1,
          amount: "1000.0000",
          method: "bank",
        },
      });

      expect(fullPayment.statusCode).toBe(201);
      const payResult = fullPayment.json();
      expect(payResult.invoice_status_after ?? payResult.method).toBeDefined();

      // Check invoice status has changed to Paid
      const invoiceRes = await mock.app.inject({
        method: "GET",
        url: `/api/v1/erp-orders/invoices/${SEED_INVOICE_1}`,
      });
      expect(invoiceRes.statusCode).toBe(200);
      expect(invoiceRes.json().status).toBe("Paid");

      // Status changed event emitted
      const events = mock.store.emittedEvents.filter(
        (e) => e.event_type === "erp.invoice.status_changed",
      );
      expect(events.length).toBe(1);
      expect((events[0]?.payload as { new_status: string }).new_status).toBe(
        "Paid",
      );
    });

    it("POST /api/v1/erp-orders/payments returns 422 on already-Paid invoice", async () => {
      // SEED_INVOICE_2 is already Paid in seed
      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/payments",
        payload: {
          invoice_id: SEED_INVOICE_2,
          amount: "100.0000",
          method: "cash",
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(
        ERP3_RELATIONSHIP_ERROR_CODES.INVOICE_ALREADY_PAID,
      );
    });

    it("POST /api/v1/erp-orders/payments returns 422 when amount exceeds invoice total", async () => {
      // SEED_INVOICE_1 total = 1000.0000
      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/payments",
        payload: {
          invoice_id: SEED_INVOICE_1,
          amount: "9999.0000", // Far exceeds total
          method: "bank",
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(
        ERP3_RELATIONSHIP_ERROR_CODES.PAYMENT_EXCEEDS_INVOICE_TOTAL,
      );
    });

    it("POST /api/v1/erp-orders/payments returns 404 on unknown invoice_id", async () => {
      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/payments",
        payload: {
          invoice_id: UNKNOWN_ID,
          amount: "100.0000",
          method: "card",
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe(
        ERP3_RELATIONSHIP_ERROR_CODES.INVOICE_NOT_FOUND,
      );
    });

    it("POST /api/v1/erp-orders/payments returns 400 on invalid method", async () => {
      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/payments",
        payload: {
          invoice_id: SEED_INVOICE_1,
          amount: "100.0000",
          method: "wire", // Not a valid method
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── 4. STORE RESET ───────────────────────────────────────────────────────────

  describe("Mock Store Reset", () => {
    it("reset() restores store to deterministic seed state", async () => {
      // Create an order
      await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        payload: {
          order_number: "SO-RESET-TEST",
          customer_golden_id: SEED_CUSTOMER_1,
          order_date: "2026-04-20",
          currency: "INR",
          lines: [
            {
              product_id: SEED_PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      });

      expect(
        Array.from(mock.store.salesOrders.values()).some(
          (o) => o.order_number === "SO-RESET-TEST",
        ),
      ).toBe(true);

      // Reset
      mock.reset();

      // Seed is restored
      expect(
        Array.from(mock.store.salesOrders.values()).some(
          (o) => o.order_number === "SO-RESET-TEST",
        ),
      ).toBe(false);
      expect(mock.store.salesOrders.size).toBe(2);
      expect(mock.store.invoices.size).toBe(2);
      expect(mock.store.payments.size).toBe(1);
      expect(mock.store.emittedEvents.length).toBe(0);
    });
  });

  // ── 5. UNKNOWN ROUTE ─────────────────────────────────────────────────────────

  // ── DR-1: NO ROUNDING ──────────────────────────────────────────────────────

  describe("DR-1 Unresolved Rounding Guard", () => {
    it("computes exact 4-dp totals without rounding", async () => {
      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        payload: {
          customer_golden_id: SEED_CUSTOMER_1,
          order_date: "2026-05-01",
          currency: "INR",
          lines: [
            {
              product_id: SEED_PRODUCT_1,
              quantity: "3",
              price: "0.1",
              tax_rate: "18",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      const json = SalesOrderSchema.parse(res.json());
      expect(json.lines[0]?.tax_amount).toBe("0.0540");
      expect(json.lines[0]?.line_total).toBe("0.3540");
      expect(json.total).toBe("0.3540");
    });

    it("rejects with 422 DR1_ROUNDING_UNRESOLVED instead of rounding", async () => {
      const res = await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          customer_golden_id: SEED_CUSTOMER_1,
          invoice_date: "2026-05-01",
          due_date: "2026-05-31",
          currency: "INR",
          // 0.0001 × 18% = 0.000018 → not representable at 4 dp
          lines: [
            {
              product_id: SEED_PRODUCT_1,
              quantity: "1",
              price: "0.0001",
              tax_rate: "18",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(DR1_ROUNDING_UNRESOLVED);
      expect(mock.store.invoices.size).toBe(2);
      expect(mock.store.emittedEvents.length).toBe(0);
    });
  });

  describe("Reset visible to routes", () => {
    it("route handlers observe the reset store", async () => {
      await mock.app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        payload: {
          customer_golden_id: SEED_CUSTOMER_1,
          order_date: "2026-05-01",
          currency: "INR",
          lines: [
            {
              product_id: SEED_PRODUCT_1,
              quantity: "1",
              price: "10",
              tax_rate: "0",
            },
          ],
        },
      });
      mock.reset();
      const res = await mock.app.inject({
        method: "GET",
        url: "/api/v1/erp-orders/sales-orders",
      });
      expect(SalesOrderListResponseSchema.parse(res.json()).total).toBe(2);
    });
  });

  describe("Shared error envelope (ADR-002 / PLT-04)", () => {
    it("error responses carry statusCode, error, code and message", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: `/api/v1/erp-orders/invoices/${UNKNOWN_ID}`,
      });
      const body = res.json();
      expect(body.statusCode).toBe(404);
      expect(typeof body.error).toBe("string");
      expect(typeof body.code).toBe("string");
      expect(typeof body.message).toBe("string");
    });
  });

  describe("404 Fallback", () => {
    it("returns 404 for completely unknown route", async () => {
      const res = await mock.app.inject({
        method: "GET",
        url: "/api/v1/erp-orders/unknown-resource",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("ROUTE_NOT_FOUND");
    });
  });
});
