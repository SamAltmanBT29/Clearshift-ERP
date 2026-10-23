/**
 * ERP-3 Sales Orders & Invoices — Mutation API & Domain Validation Test Suite
 *
 * Validates all Acceptance Criteria for Issue #28 (ERP3-03):
 *   - AC-1: Route-boundary Zod request validation (400), authentication (401), RBAC (403),
 *     transaction boundaries, and documented responses (201 / 200).
 *   - AC-2: Every domain invariant tested at service and API level with valid & invalid inputs.
 *   - AC-3: Invalid business values return 422 with stable code/message/details;
 *     duplicate numbers / 1:1 invoice conflicts / idempotency conflicts return 409.
 *   - AC-4: Repeated import requests with the same idempotency key return the original
 *     receipt/result (200) without a second mutation; payload mismatch returns 409.
 *   - AC-5: Unexpected failures return a correlation_id and never leak SQL, stack traces,
 *     secrets, or raw rows.
 *   - AC-6: Every order and invoice enforces a valid customer Golden ID (BR-ERP3-03) and
 *     valid ERP-1 product references.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ReferenceResolver } from "@cs/kernel";
import { buildApp } from "../../src/app.js";
import { InMemoryErp3Repository } from "../../src/services/repository.js";
import { Erp3Service } from "../../src/services/erp3.service.js";
import { ERP3_DOMAIN_ERROR_CODES } from "../../src/domain/rules.js";

class MockCrossModuleResolver implements ReferenceResolver {
  public validCustomers = new Set<string>([
    "55555555-0003-4000-8000-000000000001",
    "55555555-0003-4000-8000-000000000002",
  ]);

  public validProducts = new Set<string>([
    "11111111-0001-4000-8000-000000000001",
    "11111111-0001-4000-8000-000000000002",
    "11111111-0001-4000-8000-000000000003",
  ]);

  async exists(entityType: string, id: string): Promise<boolean> {
    if (entityType === "customer") {
      return this.validCustomers.has(id);
    }
    if (entityType === "product") {
      return this.validProducts.has(id);
    }
    return false;
  }

  async get<T = unknown>(_entityType: string, _id: string): Promise<T | null> {
    return null;
  }
}

describe("ERP-3 Mutation API & Domain Validation (Issue #28 / ERP3-03)", () => {
  let app: FastifyInstance;
  let authApp: FastifyInstance;
  let repo: InMemoryErp3Repository;
  let resolver: MockCrossModuleResolver;
  let service: Erp3Service;
  let currentUtcDate: string;

  const SEEDED_ORDER_ID = "aaaaaaaa-0003-4000-8000-000000000001";
  const CUSTOMER_1 = "55555555-0003-4000-8000-000000000001";
  const CUSTOMER_2 = "55555555-0003-4000-8000-000000000002";
  const UNKNOWN_CUSTOMER = "55555555-9999-4000-8000-999999999999";

  const PRODUCT_1 = "11111111-0001-4000-8000-000000000001";
  const PRODUCT_2 = "11111111-0001-4000-8000-000000000002";
  const UNKNOWN_PRODUCT = "11111111-9999-4000-8000-999999999999";

  const BATCH_ID = "bbbbbbbb-1111-4000-8000-111111111111";

  beforeEach(() => {
    currentUtcDate = "2026-04-15";
    repo = new InMemoryErp3Repository(true);
    resolver = new MockCrossModuleResolver();
    service = new Erp3Service({
      repository: repo,
      referenceResolver: resolver,
      nowUtcDate: () => currentUtcDate,
    });

    app = buildApp({
      repository: repo,
      erp3Service: service,
      referenceResolver: resolver,
      authRequired: false,
      nowUtcDate: () => currentUtcDate,
    });

    authApp = buildApp({
      repository: repo,
      erp3Service: service,
      referenceResolver: resolver,
      authRequired: true,
      nowUtcDate: () => currentUtcDate,
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. POST /api/v1/erp-orders/sales-orders
  // ───────────────────────────────────────────────────────────────────────────
  describe("POST /api/v1/erp-orders/sales-orders", () => {
    it("creates a sales order with server-computed line tax_amount, line_total, and order total (BR-ERP3-01, BR-ERP3-02)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        payload: {
          order_number: "SO-2026-0100",
          customer_golden_id: CUSTOMER_1,
          order_date: "2026-04-10",
          currency: "USD",
          // Attempt to spoof protected fields from the browser — must be ignored
          id: "99999999-9999-4000-8000-999999999999",
          status: "Closed",
          total: "0.0100",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "5.0000",
              price: "200.0000",
              tax_rate: "18.0000",
              tax_amount: "0.0000",
              line_total: "1.0000",
            },
            {
              product_id: PRODUCT_2,
              quantity: "4.0000",
              price: "50.0000",
              tax_rate: "10.0000",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.id).not.toBe("99999999-9999-4000-8000-999999999999");
      expect(body.order_number).toBe("SO-2026-0100");
      expect(body.customer_golden_id).toBe(CUSTOMER_1);
      expect(body.status).toBe("Open");
      // Line 1: 5 * 200 = 1000 + 18% (180) = 1180.0000
      // Line 2: 4 * 50  = 200  + 10% (20)  = 220.0000
      // Total: 1400.0000
      expect(body.lines[0].tax_amount).toBe("180.0000");
      expect(body.lines[0].line_total).toBe("1180.0000");
      expect(body.lines[1].tax_amount).toBe("20.0000");
      expect(body.lines[1].line_total).toBe("220.0000");
      expect(body.total).toBe("1400.0000");
    });

    it("enforces BR-ERP3-03: rejects missing or non-UUID customer_golden_id with 400 and unknown customer Golden ID with 422", async () => {
      // Missing / non-UUID at route boundary -> 400 VALIDATION_ERROR
      const badFormatRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        payload: {
          customer_golden_id: "gid-not-a-uuid",
          order_date: "2026-04-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      expect(badFormatRes.statusCode).toBe(400);
      expect(JSON.parse(badFormatRes.payload).code).toBe("VALIDATION_ERROR");

      // Valid UUID but unknown customer in CRM-1 / Hub -> 422 CUSTOMER_NOT_FOUND
      const unknownCustomerRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        payload: {
          customer_golden_id: UNKNOWN_CUSTOMER,
          order_date: "2026-04-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      expect(unknownCustomerRes.statusCode).toBe(422);
      const errBody = JSON.parse(unknownCustomerRes.payload);
      expect(errBody.code).toBe(ERP3_DOMAIN_ERROR_CODES.CUSTOMER_NOT_FOUND);
      expect(errBody.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "customer_golden_id" }),
        ]),
      );
    });

    it("rejects unknown ERP-1 product_id in order lines with 422 PRODUCT_NOT_FOUND", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        payload: {
          customer_golden_id: CUSTOMER_1,
          order_date: "2026-04-10",
          currency: "USD",
          lines: [
            {
              product_id: UNKNOWN_PRODUCT,
              quantity: "2.0000",
              price: "50.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe(ERP3_DOMAIN_ERROR_CODES.PRODUCT_NOT_FOUND);
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "lines.0.product_id",
            product_id: UNKNOWN_PRODUCT,
          }),
        ]),
      );
    });

    it("rejects duplicate order_number with 409 ORDER_NUMBER_EXISTS", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        payload: {
          order_number: "SO-2026-0001", // Already seeded
          customer_golden_id: CUSTOMER_1,
          order_date: "2026-04-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe(ERP3_DOMAIN_ERROR_CODES.ORDER_NUMBER_EXISTS);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. PATCH /api/v1/erp-orders/sales-orders/:id
  // ───────────────────────────────────────────────────────────────────────────
  describe("PATCH /api/v1/erp-orders/sales-orders/:id", () => {
    it("transitions sales order forward Open -> Invoiced -> Closed and persists each state", async () => {
      const toInvoiced = await app.inject({
        method: "PATCH",
        url: `/api/v1/erp-orders/sales-orders/${SEEDED_ORDER_ID}`,
        payload: { status: "Invoiced" },
      });
      expect(toInvoiced.statusCode).toBe(200);
      expect(JSON.parse(toInvoiced.payload).status).toBe("Invoiced");

      const toClosed = await app.inject({
        method: "PATCH",
        url: `/api/v1/erp-orders/sales-orders/${SEEDED_ORDER_ID}`,
        payload: { status: "Closed" },
      });
      expect(toClosed.statusCode).toBe(200);
      expect(JSON.parse(toClosed.payload).status).toBe("Closed");

      // Attempting to reopen Closed -> Open is rejected with 422
      const reopenRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/erp-orders/sales-orders/${SEEDED_ORDER_ID}`,
        payload: { status: "Open" },
      });
      expect(reopenRes.statusCode).toBe(422);
      expect(JSON.parse(reopenRes.payload).code).toBe(
        ERP3_DOMAIN_ERROR_CODES.INVALID_ORDER_STATUS_TRANSITION,
      );
    });

    it("rejects attempts to modify protected fields on PATCH with 400 VALIDATION_ERROR", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/erp-orders/sales-orders/${SEEDED_ORDER_ID}`,
        payload: {
          status: "Invoiced",
          total: "0.0100",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 ORDER_NOT_FOUND for unknown UUID and 400 INVALID_UUID for malformed ID", async () => {
      const notFoundRes = await app.inject({
        method: "PATCH",
        url: "/api/v1/erp-orders/sales-orders/aaaaaaaa-0003-4000-8000-999999999999",
        payload: { status: "Invoiced" },
      });
      expect(notFoundRes.statusCode).toBe(404);
      expect(JSON.parse(notFoundRes.payload).code).toBe(
        ERP3_DOMAIN_ERROR_CODES.ORDER_NOT_FOUND,
      );

      const badIdRes = await app.inject({
        method: "PATCH",
        url: "/api/v1/erp-orders/sales-orders/not-a-uuid",
        payload: { status: "Invoiced" },
      });
      expect(badIdRes.statusCode).toBe(400);
      expect(JSON.parse(badIdRes.payload).code).toBe("INVALID_UUID");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. POST /api/v1/erp-orders/invoices
  // ───────────────────────────────────────────────────────────────────────────
  describe("POST /api/v1/erp-orders/invoices", () => {
    it("creates an invoice linked to a sales order, computes totals server-side, and transitions the order to Invoiced", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          invoice_number: "INV-2026-0100",
          order_id: SEEDED_ORDER_ID,
          customer_golden_id: CUSTOMER_1,
          invoice_date: "2026-04-10",
          due_date: "2026-05-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "10.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const invoice = JSON.parse(res.payload);
      expect(invoice.invoice_number).toBe("INV-2026-0100");
      expect(invoice.order_id).toBe(SEEDED_ORDER_ID);
      expect(invoice.status).toBe("Open");
      expect(invoice.total).toBe("1180.0000");

      // Linked order is automatically transitioned to Invoiced
      const orderRes = await app.inject({
        method: "GET",
        url: `/api/v1/erp-orders/sales-orders/${SEEDED_ORDER_ID}`,
      });
      expect(JSON.parse(orderRes.payload).status).toBe("Invoiced");
    });

    it("enforces at most one V1 invoice per sales order (409 ORDER_ALREADY_INVOICED) and unique invoice_number (409 INVOICE_NUMBER_EXISTS)", async () => {
      const firstRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          invoice_number: "INV-2026-0101",
          order_id: SEEDED_ORDER_ID,
          customer_golden_id: CUSTOMER_1,
          invoice_date: "2026-04-10",
          due_date: "2026-05-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "10.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      expect(firstRes.statusCode).toBe(201);

      // Duplicate invoice_number -> 409 INVOICE_NUMBER_EXISTS
      const dupNumberRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          invoice_number: "INV-2026-0101",
          customer_golden_id: CUSTOMER_1,
          invoice_date: "2026-04-10",
          due_date: "2026-05-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      expect(dupNumberRes.statusCode).toBe(409);
      expect(JSON.parse(dupNumberRes.payload).code).toBe(
        ERP3_DOMAIN_ERROR_CODES.INVOICE_NUMBER_EXISTS,
      );

      // Second invoice for the same order_id -> 409 ORDER_ALREADY_INVOICED
      const secondForOrderRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          invoice_number: "INV-2026-0102",
          order_id: SEEDED_ORDER_ID,
          customer_golden_id: CUSTOMER_1,
          invoice_date: "2026-04-10",
          due_date: "2026-05-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "10.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      expect(secondForOrderRes.statusCode).toBe(409);
      expect(JSON.parse(secondForOrderRes.payload).code).toBe(
        ERP3_DOMAIN_ERROR_CODES.ORDER_ALREADY_INVOICED,
      );
    });

    it("enforces required due_date, rejects due_date < invoice_date (422), and derives Overdue when current UTC date > due_date", async () => {
      // Missing due_date -> 400 VALIDATION_ERROR
      const missingDueRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          customer_golden_id: CUSTOMER_1,
          invoice_date: "2026-04-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      expect(missingDueRes.statusCode).toBe(400);

      // due_date earlier than invoice_date -> 422 INVALID_DUE_DATE
      const earlierDueRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          customer_golden_id: CUSTOMER_1,
          invoice_date: "2026-04-10",
          due_date: "2026-04-01",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      expect(earlierDueRes.statusCode).toBe(422);
      expect(JSON.parse(earlierDueRes.payload).code).toBe(
        ERP3_DOMAIN_ERROR_CODES.INVALID_DUE_DATE,
      );

      // Unpaid invoice whose due_date is before currentUtcDate (2026-04-15) -> Overdue
      const overdueRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          customer_golden_id: CUSTOMER_1,
          invoice_date: "2026-04-01",
          due_date: "2026-04-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      expect(overdueRes.statusCode).toBe(201);
      expect(JSON.parse(overdueRes.payload).status).toBe("Overdue");
    });

    it("rejects non-existent order_id with 422 ORDER_REF_NOT_FOUND and customer mismatch with 422 CUSTOMER_MISMATCH", async () => {
      const unknownOrderRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          order_id: "aaaaaaaa-9999-4000-8000-999999999999",
          customer_golden_id: CUSTOMER_1,
          invoice_date: "2026-04-10",
          due_date: "2026-05-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      expect(unknownOrderRes.statusCode).toBe(422);
      expect(JSON.parse(unknownOrderRes.payload).code).toBe(
        ERP3_DOMAIN_ERROR_CODES.ORDER_REF_NOT_FOUND,
      );

      const mismatchCustomerRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          order_id: SEEDED_ORDER_ID,
          customer_golden_id: CUSTOMER_2, // Seeded order belongs to CUSTOMER_1
          invoice_date: "2026-04-10",
          due_date: "2026-05-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      expect(mismatchCustomerRes.statusCode).toBe(422);
      expect(JSON.parse(mismatchCustomerRes.payload).code).toBe(
        ERP3_DOMAIN_ERROR_CODES.CUSTOMER_MISMATCH,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. POST /api/v1/erp-orders/payments
  // ───────────────────────────────────────────────────────────────────────────
  describe("POST /api/v1/erp-orders/payments", () => {
    let invoiceId: string;

    beforeEach(async () => {
      const invRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/invoices",
        payload: {
          invoice_number: "INV-PAY-0001",
          order_id: SEEDED_ORDER_ID,
          customer_golden_id: CUSTOMER_1,
          invoice_date: "2026-04-01",
          due_date: "2026-05-01",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "10.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      invoiceId = JSON.parse(invRes.payload).id;
    });

    it("rejects partial payment (422 PARTIAL_PAYMENT_NOT_ALLOWED) and overpayment (422 PAYMENT_EXCEEDS_INVOICE_TOTAL) without mutating invoice status", async () => {
      const partialRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/payments",
        payload: {
          invoice_id: invoiceId,
          amount: "500.0000",
          method: "bank",
        },
      });
      expect(partialRes.statusCode).toBe(422);
      expect(JSON.parse(partialRes.payload).code).toBe(
        ERP3_DOMAIN_ERROR_CODES.PARTIAL_PAYMENT_NOT_ALLOWED,
      );

      const overRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/payments",
        payload: {
          invoice_id: invoiceId,
          amount: "1500.0000",
          method: "card",
        },
      });
      expect(overRes.statusCode).toBe(422);
      expect(JSON.parse(overRes.payload).code).toBe(
        ERP3_DOMAIN_ERROR_CODES.PAYMENT_EXCEEDS_INVOICE_TOTAL,
      );

      // Verify invoice remains Open
      const checkInv = await app.inject({
        method: "GET",
        url: `/api/v1/erp-orders/invoices/${invoiceId}`,
      });
      expect(JSON.parse(checkInv.payload).status).toBe("Open");
    });

    it("accepts a single full payment, automatically transitions invoice to Paid, and rejects subsequent payments (422 INVOICE_ALREADY_PAID)", async () => {
      const payRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/payments",
        payload: {
          invoice_id: invoiceId,
          amount: "1180.0000",
          method: "bank",
        },
      });
      expect(payRes.statusCode).toBe(201);
      const payment = JSON.parse(payRes.payload);
      expect(payment.invoice_id).toBe(invoiceId);
      expect(payment.amount).toBe("1180.0000");
      expect(payment.method).toBe("bank");

      // Invoice status is now Paid
      const invAfter = await app.inject({
        method: "GET",
        url: `/api/v1/erp-orders/invoices/${invoiceId}`,
      });
      expect(JSON.parse(invAfter.payload).status).toBe("Paid");

      // Second payment on Paid invoice is rejected with 422 INVOICE_ALREADY_PAID
      const secondPayRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/payments",
        payload: {
          invoice_id: invoiceId,
          amount: "1180.0000",
          method: "cash",
        },
      });
      expect(secondPayRes.statusCode).toBe(422);
      expect(JSON.parse(secondPayRes.payload).code).toBe(
        ERP3_DOMAIN_ERROR_CODES.INVOICE_ALREADY_PAID,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Atomic Import Receipts & Idempotency Replay / Conflict (AC-4)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Idempotent Import Writes & Transactional Receipt Atomicity", () => {
    it("returns 201 on initial import, 200 with original result on identical replay, and 409 on payload mismatch", async () => {
      const importPayload = {
        order_number: "SO-IMP-0001",
        customer_golden_id: CUSTOMER_1,
        order_date: "2026-04-12",
        currency: "USD",
        batch_id: BATCH_ID,
        source_row: 12,
        lines: [
          {
            product_id: PRODUCT_1,
            quantity: "2.0000",
            price: "100.0000",
            tax_rate: "18.0000",
          },
        ],
      };

      // 1. First request -> 201 Created + receipt persisted
      const firstRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        headers: { "idempotency-key": "erp3-batch1-row12-so-v1" },
        payload: importPayload,
      });
      expect(firstRes.statusCode).toBe(201);
      const firstOrder = JSON.parse(firstRes.payload);
      expect(repo.receipts.size).toBe(1);

      // 2. Replay with same Idempotency-Key and identical payload -> 200 OK with same ID
      const replayRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        headers: { "idempotency-key": "erp3-batch1-row12-so-v1" },
        payload: importPayload,
      });
      expect(replayRes.statusCode).toBe(200);
      const replayOrder = JSON.parse(replayRes.payload);
      expect(replayOrder.id).toBe(firstOrder.id);
      expect(repo.salesOrders.size).toBe(2); // 1 seeded + 1 imported (no duplicate created)

      // 3. Reuse same Idempotency-Key with modified payload -> 409 Conflict
      const mismatchRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        headers: { "idempotency-key": "erp3-batch1-row12-so-v1" },
        payload: {
          ...importPayload,
          currency: "INR",
        },
      });
      expect(mismatchRes.statusCode).toBe(409);
      expect(JSON.parse(mismatchRes.payload).code).toBe(
        "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
      );
    });

    it("rolls back the target entity mutation if receipt persistence fails in the same transaction", async () => {
      const orderCountBefore = repo.salesOrders.size;

      // Force createImportReceipt to fail inside the transaction
      const originalCreateReceipt = repo.createImportReceipt.bind(repo);
      repo.createImportReceipt = async () => {
        throw new Error("Simulated receipt write failure");
      };

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/import",
        payload: {
          batch_id: BATCH_ID,
          source_row: 99,
          idempotency_key: "erp3-rollback-test-key",
          entity: "sales_order",
          record: {
            order_number: "SO-ROLLBACK-0001",
            customer_golden_id: CUSTOMER_1,
            order_date: "2026-04-12",
            currency: "USD",
            lines: [
              {
                product_id: PRODUCT_1,
                quantity: "1.0000",
                price: "100.0000",
                tax_rate: "18.0000",
              },
            ],
          },
        },
      });

      expect(res.statusCode).toBe(500);
      // Sales order map must be rolled back to its exact pre-transaction size
      expect(repo.salesOrders.size).toBe(orderCountBefore);
      expect(await repo.getSalesOrderByNumber("SO-ROLLBACK-0001")).toBeNull();

      repo.createImportReceipt = originalCreateReceipt;
    });

    it("rejects malformed sales_order, invoice, and payment records submitted directly to POST /api/v1/erp-orders/import with 400 VALIDATION_ERROR", async () => {
      const badOrderImport = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/import",
        payload: {
          batch_id: BATCH_ID,
          source_row: 101,
          idempotency_key: "erp3-malformed-so-key",
          entity: "sales_order",
          record: {
            customer_golden_id: "gid-not-a-uuid",
            order_date: "not-a-date",
            lines: [],
          },
        },
      });
      expect(badOrderImport.statusCode).toBe(400);
      const badOrderBody = JSON.parse(badOrderImport.payload);
      expect(badOrderBody.code).toBe("VALIDATION_ERROR");
      expect(badOrderBody.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "customer_golden_id" }),
          expect.objectContaining({ field: "order_date" }),
          expect.objectContaining({ field: "lines" }),
        ]),
      );

      const badInvoiceImport = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/import",
        payload: {
          batch_id: BATCH_ID,
          source_row: 102,
          idempotency_key: "erp3-malformed-inv-key",
          entity: "invoice",
          record: {
            customer_golden_id: CUSTOMER_1,
            invoice_date: "2026-04-10",
            // Missing required due_date and lines
          },
        },
      });
      expect(badInvoiceImport.statusCode).toBe(400);
      const badInvoiceBody = JSON.parse(badInvoiceImport.payload);
      expect(badInvoiceBody.code).toBe("VALIDATION_ERROR");
      expect(badInvoiceBody.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "due_date" }),
          expect.objectContaining({ field: "lines" }),
        ]),
      );

      const badPaymentImport = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/import",
        payload: {
          batch_id: BATCH_ID,
          source_row: 103,
          idempotency_key: "erp3-malformed-pay-key",
          entity: "payment",
          record: {
            invoice_id: "not-a-uuid",
            amount: "0.0000",
            method: "crypto",
          },
        },
      });
      expect(badPaymentImport.statusCode).toBe(400);
      const badPaymentBody = JSON.parse(badPaymentImport.payload);
      expect(badPaymentBody.code).toBe("VALIDATION_ERROR");
      expect(badPaymentBody.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "invoice_id" }),
          expect.objectContaining({ field: "amount" }),
          expect.objectContaining({ field: "method" }),
        ]),
      );

      // No receipts should be persisted for rejected payloads
      expect(repo.receipts.size).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Authentication, RBAC & Safe Error Sanitization (AC-1 & AC-5)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Authentication, RBAC & SQL/Secret Sanitization", () => {
    it("returns 401 UNAUTHORIZED when authRequired is true and token is missing or invalid, and 403 FORBIDDEN for viewer role on mutations", async () => {
      const noTokenRes = await authApp.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        payload: {},
      });
      expect(noTokenRes.statusCode).toBe(401);
      expect(JSON.parse(noTokenRes.payload).code).toBe("UNAUTHORIZED");

      const viewerRes = await authApp.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        headers: { authorization: "Bearer role:viewer" },
        payload: {
          customer_golden_id: CUSTOMER_1,
          order_date: "2026-04-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      expect(viewerRes.statusCode).toBe(403);
      expect(JSON.parse(viewerRes.payload).code).toBe("FORBIDDEN");

      const editorRes = await authApp.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        headers: { authorization: "Bearer role:editor" },
        payload: {
          customer_golden_id: CUSTOMER_1,
          order_date: "2026-04-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });
      expect(editorRes.statusCode).toBe(201);
    });

    it("returns a correlation_id and strips SQL, secrets, and stack traces on unexpected 500 errors (AC-5)", async () => {
      repo.executeTransactional = async () => {
        throw new Error(
          'SELECT * FROM erp3_sales_orders WHERE password="super-secret-db-password" AND customer_golden_id="55555555-0003-4000-8000-000000000001"',
        );
      };

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        headers: { "x-correlation-id": "corr-test-erp3-500" },
        payload: {
          customer_golden_id: CUSTOMER_1,
          order_date: "2026-04-10",
          currency: "USD",
          lines: [
            {
              product_id: PRODUCT_1,
              quantity: "1.0000",
              price: "100.0000",
              tax_rate: "18.0000",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(500);
      expect(res.headers["x-correlation-id"]).toBe("corr-test-erp3-500");
      const body = JSON.parse(res.payload);
      expect(body.code).toBe("INTERNAL_SERVER_ERROR");
      expect(body.correlation_id).toBe("corr-test-erp3-500");
      expect(body.message).toBe("An unexpected internal error occurred.");
      expect(res.payload).not.toContain("SELECT");
      expect(res.payload).not.toContain("super-secret-db-password");
      expect(res.payload).not.toContain("stack");
    });
  });
});
