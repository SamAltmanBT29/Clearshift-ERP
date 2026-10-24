/**
 * ERP-3 Sales Orders & Invoices — Zod Contract & Invariant Test Suite
 *
 * Proves that:
 *   - Enum schemas match SDS V1 requirements exactly.
 *   - SalesOrderStatus FSM values (FR-ERP3-05) are correct.
 *   - InvoiceStatus values (FR-ERP3-02) are correct.
 *   - PaymentMethod values (FR-ERP3-03) are correct.
 *   - MoneyAmount rejects floats, negatives, and non-strings.
 *   - customer_golden_id is required (BR-ERP3-03 at schema level).
 *   - due_date is required on CreateInvoiceRequest.
 *   - Pagination schemas enforce page >= 1 and pageSize <= 100.
 *   - Erp3IsoDateString rejects malformed dates.
 *   - TaxRateAmount accepts valid percentage strings.
 *
 * @module contracts/tests/erp-3.contract.test
 */

import { describe, it, expect } from "vitest";
import {
  // Enums
  SalesOrderStatusEnum,
  InvoiceStatusEnum,
  PaymentMethodEnum,
  // Primitives
  Erp3IsoDateString,
  TaxRateAmount,
  // Schemas
  CreateSalesOrderRequestSchema,
  CreateSalesOrderLineRequestSchema,
  CreateInvoiceRequestSchema,
  CreateInvoiceLineRequestSchema,
  CreatePaymentRequestSchema,
  SalesOrderListQuerySchema,
  InvoiceListQuerySchema,
  SalesOrderSchema,
  InvoiceSchema,
  PaymentSchema,
  SalesOrderListResponseSchema,
  InvoiceListResponseSchema,
  UpdateSalesOrderStatusRequestSchema,
  // Canonical aliases & domain helpers
  OrdersCurrencyCode,
  OrdersUuid,
  OrdersMoneyAmount,
  CustomerGoldenIdSchema,
  CreateSalesOrderLineInputSchema,
  CreateSalesOrderInputSchema,
  UpdateSalesOrderStatusInputSchema,
  SalesOrdersFilterQuerySchema,
  PaginatedSalesOrdersResponseSchema,
  CreateInvoiceInputSchema,
  InvoicesFilterQuerySchema,
  PaginatedInvoicesResponseSchema,
  CreatePaymentInputSchema,
  ALLOWED_ORDER_STATUS_TRANSITIONS,
  ERP3_SALES_ORDER_STATUSES,
  ERP3_SALES_ORDER_TERMINAL_STATUSES,
  ERP3_SALES_ORDER_STATUS_TRANSITIONS,
  ERP3_INVOICE_STATUSES,
  ERP3_INVOICE_TERMINAL_STATUSES,
  ERP3_INVOICE_STATUS_TRANSITIONS,
  ERP3_PAYMENT_METHODS,
  ERP3_OPTIONAL_REFERENCE_ABSENT,
  ERP3_DOMAIN_RULES,
  calculateLineAmounts,
  validateOrderLineTotals,
  deriveInvoiceStatus,
  // Error codes
  ERP3_RELATIONSHIP_ERROR_CODES,
} from "../src/erp-3.js";
// Reuse MoneyAmount from erp-4 (same primitive used by erp-3)
import { MoneyAmount } from "../src/erp-4.js";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic test fixture IDs
// ─────────────────────────────────────────────────────────────────────────────
const CUSTOMER_ID = "55555555-0003-4000-8000-000000000001";
const PRODUCT_ID = "11111111-0001-4000-8000-000000000001";
const INVOICE_ID = "cccccccc-0003-4000-8000-000000000001";
const ORDER_ID = "aaaaaaaa-0003-4000-8000-000000000001";
const PAYMENT_ID = "eeeeeeee-0003-4000-8000-000000000001";

// ─────────────────────────────────────────────────────────────────────────────
describe("ERP-3 Enum Schemas", () => {
  it("SalesOrderStatusEnum has exactly Open / Invoiced / Closed (FR-ERP3-05)", () => {
    expect(SalesOrderStatusEnum.options).toEqual([
      "Open",
      "Invoiced",
      "Closed",
    ]);
    expect(SalesOrderStatusEnum.safeParse("Open").success).toBe(true);
    expect(SalesOrderStatusEnum.safeParse("Invoiced").success).toBe(true);
    expect(SalesOrderStatusEnum.safeParse("Closed").success).toBe(true);
    expect(SalesOrderStatusEnum.safeParse("open").success).toBe(false); // case-sensitive
    expect(SalesOrderStatusEnum.safeParse("Draft").success).toBe(false); // not in ERP-3
    expect(SalesOrderStatusEnum.safeParse("Paid").success).toBe(false); // invoice status, not order
  });

  it("InvoiceStatusEnum has exactly Open / Paid / Overdue (FR-ERP3-02)", () => {
    expect(InvoiceStatusEnum.options).toEqual(["Open", "Paid", "Overdue"]);
    expect(InvoiceStatusEnum.safeParse("Open").success).toBe(true);
    expect(InvoiceStatusEnum.safeParse("Paid").success).toBe(true);
    expect(InvoiceStatusEnum.safeParse("Overdue").success).toBe(true);
    expect(InvoiceStatusEnum.safeParse("Closed").success).toBe(false);
    expect(InvoiceStatusEnum.safeParse("paid").success).toBe(false);
  });

  it("PaymentMethodEnum has exactly cash / bank / card (FR-ERP3-03)", () => {
    expect(PaymentMethodEnum.options).toEqual(["cash", "bank", "card"]);
    expect(PaymentMethodEnum.safeParse("cash").success).toBe(true);
    expect(PaymentMethodEnum.safeParse("bank").success).toBe(true);
    expect(PaymentMethodEnum.safeParse("card").success).toBe(true);
    expect(PaymentMethodEnum.safeParse("cheque").success).toBe(false);
    expect(PaymentMethodEnum.safeParse("Cash").success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ERP-3 Shared Primitives", () => {
  it("MoneyAmount accepts valid non-negative decimal strings up to 4 dp", () => {
    expect(MoneyAmount.safeParse("0").success).toBe(true);
    expect(MoneyAmount.safeParse("100").success).toBe(true);
    expect(MoneyAmount.safeParse("100.5").success).toBe(true);
    expect(MoneyAmount.safeParse("100.50").success).toBe(true);
    expect(MoneyAmount.safeParse("100.5000").success).toBe(true);
    expect(MoneyAmount.safeParse("0.0000").success).toBe(true);
  });

  it("MoneyAmount rejects more than 4 decimal places", () => {
    expect(MoneyAmount.safeParse("100.50001").success).toBe(false);
  });

  it("MoneyAmount rejects negative amounts", () => {
    expect(MoneyAmount.safeParse("-100.00").success).toBe(false);
  });

  it("MoneyAmount rejects non-string types (IEEE-754 float guard)", () => {
    expect(MoneyAmount.safeParse(100.5 as unknown as string).success).toBe(
      false,
    );
    expect(MoneyAmount.safeParse(null as unknown as string).success).toBe(
      false,
    );
  });

  it("MoneyAmount rejects non-numeric strings", () => {
    expect(MoneyAmount.safeParse("abc").success).toBe(false);
    expect(MoneyAmount.safeParse("1,000").success).toBe(false);
  });

  it("Erp3IsoDateString accepts YYYY-MM-DD and rejects malformed dates", () => {
    expect(Erp3IsoDateString.safeParse("2026-04-01").success).toBe(true);
    expect(Erp3IsoDateString.safeParse("2026-12-31").success).toBe(true);
    expect(Erp3IsoDateString.safeParse("2026-4-1").success).toBe(false); // no leading zeros
    expect(Erp3IsoDateString.safeParse("20260401").success).toBe(false); // no separators
    expect(Erp3IsoDateString.safeParse("2026/04/01").success).toBe(false); // wrong separator
    expect(Erp3IsoDateString.safeParse("").success).toBe(false);
  });

  it("TaxRateAmount accepts valid rate strings", () => {
    expect(TaxRateAmount.safeParse("0").success).toBe(true);
    expect(TaxRateAmount.safeParse("0.0000").success).toBe(true);
    expect(TaxRateAmount.safeParse("18.0000").success).toBe(true);
    expect(TaxRateAmount.safeParse("28").success).toBe(true);
    expect(TaxRateAmount.safeParse("-1").success).toBe(false); // negative not allowed
    expect(TaxRateAmount.safeParse("abc").success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ERP-3 Sales Order Contract", () => {
  it("CreateSalesOrderLineRequestSchema accepts valid line", () => {
    const result = CreateSalesOrderLineRequestSchema.safeParse({
      product_id: PRODUCT_ID,
      quantity: "2.0000",
      price: "500.0000",
      tax_rate: "18.0000",
    });
    expect(result.success).toBe(true);
  });

  it("CreateSalesOrderLineRequestSchema rejects zero quantity", () => {
    expect(
      CreateSalesOrderLineRequestSchema.safeParse({
        product_id: PRODUCT_ID,
        quantity: "0",
        price: "500.0000",
        tax_rate: "18.0000",
      }).success,
    ).toBe(false);
  });

  it("CreateSalesOrderLineRequestSchema rejects non-string product_id", () => {
    expect(
      CreateSalesOrderLineRequestSchema.safeParse({
        product_id: "not-a-uuid",
        quantity: "1.0000",
        price: "100.0000",
        tax_rate: "0.0000",
      }).success,
    ).toBe(false);
  });

  it("CreateSalesOrderRequestSchema accepts valid minimal request", () => {
    const valid = {
      customer_golden_id: CUSTOMER_ID,
      order_date: "2026-04-01",
      currency: "INR",
      lines: [
        {
          product_id: PRODUCT_ID,
          quantity: "1.0000",
          price: "100.0000",
          tax_rate: "0.0000",
        },
      ],
    };
    expect(CreateSalesOrderRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("CreateSalesOrderRequestSchema rejects missing customer_golden_id (BR-ERP3-03)", () => {
    const missing = {
      order_date: "2026-04-01",
      currency: "INR",
      lines: [
        {
          product_id: PRODUCT_ID,
          quantity: "1.0000",
          price: "100.0000",
          tax_rate: "0.0000",
        },
      ],
    };
    expect(CreateSalesOrderRequestSchema.safeParse(missing).success).toBe(
      false,
    );
  });

  it("CreateSalesOrderRequestSchema rejects invalid UUID as customer_golden_id", () => {
    expect(
      CreateSalesOrderRequestSchema.safeParse({
        customer_golden_id: "NOT-A-UUID",
        order_date: "2026-04-01",
        currency: "INR",
        lines: [
          {
            product_id: PRODUCT_ID,
            quantity: "1.0000",
            price: "100.0000",
            tax_rate: "0.0000",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("CreateSalesOrderRequestSchema rejects empty lines array", () => {
    expect(
      CreateSalesOrderRequestSchema.safeParse({
        customer_golden_id: CUSTOMER_ID,
        order_date: "2026-04-01",
        currency: "INR",
        lines: [],
      }).success,
    ).toBe(false);
  });

  it("CreateSalesOrderRequestSchema accepts optional idempotency fields", () => {
    const withIdempotency = {
      customer_golden_id: CUSTOMER_ID,
      order_date: "2026-04-01",
      currency: "USD",
      lines: [
        {
          product_id: PRODUCT_ID,
          quantity: "3.0000",
          price: "50.0000",
          tax_rate: "0.0000",
        },
      ],
      idempotency_key: "key-abc-123",
      batch_id: "22222222-0003-4000-8000-000000000001",
      source_row: 42,
    };
    expect(
      CreateSalesOrderRequestSchema.safeParse(withIdempotency).success,
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ERP-3 Invoice Contract", () => {
  it("CreateInvoiceRequestSchema accepts valid request with required due_date", () => {
    const valid = {
      customer_golden_id: CUSTOMER_ID,
      invoice_date: "2026-04-01",
      due_date: "2026-05-01",
      currency: "INR",
      lines: [
        {
          product_id: PRODUCT_ID,
          quantity: "1.0000",
          price: "500.0000",
          tax_rate: "18.0000",
        },
      ],
    };
    expect(CreateInvoiceRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("CreateInvoiceRequestSchema rejects missing due_date (V1_30 plan: mandatory)", () => {
    const noDueDate = {
      customer_golden_id: CUSTOMER_ID,
      invoice_date: "2026-04-01",
      // due_date intentionally omitted
      currency: "INR",
      lines: [
        {
          product_id: PRODUCT_ID,
          quantity: "1.0000",
          price: "500.0000",
          tax_rate: "0.0000",
        },
      ],
    };
    expect(CreateInvoiceRequestSchema.safeParse(noDueDate).success).toBe(false);
  });

  it("CreateInvoiceRequestSchema rejects malformed due_date", () => {
    expect(
      CreateInvoiceRequestSchema.safeParse({
        customer_golden_id: CUSTOMER_ID,
        invoice_date: "2026-04-01",
        due_date: "not-a-date",
        currency: "INR",
        lines: [
          {
            product_id: PRODUCT_ID,
            quantity: "1.0000",
            price: "100.0000",
            tax_rate: "0.0000",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("CreateInvoiceRequestSchema accepts optional order_id reference", () => {
    const withOrder = {
      customer_golden_id: CUSTOMER_ID,
      order_id: ORDER_ID,
      invoice_date: "2026-04-15",
      due_date: "2026-05-15",
      currency: "INR",
      lines: [
        {
          product_id: PRODUCT_ID,
          quantity: "1.0000",
          price: "1000.0000",
          tax_rate: "0.0000",
        },
      ],
    };
    expect(CreateInvoiceRequestSchema.safeParse(withOrder).success).toBe(true);
  });

  it("CreateInvoiceRequestSchema rejects empty lines array", () => {
    expect(
      CreateInvoiceRequestSchema.safeParse({
        customer_golden_id: CUSTOMER_ID,
        invoice_date: "2026-04-01",
        due_date: "2026-05-01",
        currency: "INR",
        lines: [],
      }).success,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ERP-3 Payment Contract", () => {
  it("CreatePaymentRequestSchema accepts valid payment", () => {
    const valid = {
      invoice_id: INVOICE_ID,
      amount: "590.0000",
      method: "bank",
    };
    expect(CreatePaymentRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("CreatePaymentRequestSchema rejects invalid method", () => {
    expect(
      CreatePaymentRequestSchema.safeParse({
        invoice_id: INVOICE_ID,
        amount: "100.0000",
        method: "wire",
      }).success,
    ).toBe(false);
  });

  it("CreatePaymentRequestSchema rejects negative amount", () => {
    expect(
      CreatePaymentRequestSchema.safeParse({
        invoice_id: INVOICE_ID,
        amount: "-50.0000",
        method: "cash",
      }).success,
    ).toBe(false);
  });

  it("CreatePaymentRequestSchema rejects zero amount", () => {
    expect(
      CreatePaymentRequestSchema.safeParse({
        invoice_id: INVOICE_ID,
        amount: "0.0000",
        method: "cash",
      }).success,
    ).toBe(false);
    expect(
      CreatePaymentRequestSchema.safeParse({
        invoice_id: INVOICE_ID,
        amount: "0",
        method: "bank",
      }).success,
    ).toBe(false);
  });

  it("CreatePaymentRequestSchema accepts optional paid_at datetime", () => {
    expect(
      CreatePaymentRequestSchema.safeParse({
        invoice_id: INVOICE_ID,
        amount: "100.0000",
        method: "card",
        paid_at: "2026-04-20T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("CreatePaymentRequestSchema rejects malformed paid_at", () => {
    expect(
      CreatePaymentRequestSchema.safeParse({
        invoice_id: INVOICE_ID,
        amount: "100.0000",
        method: "cash",
        paid_at: "2026-04-20", // date-only, not datetime
      }).success,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ERP-3 Pagination Query Schemas", () => {
  it("SalesOrderListQuerySchema enforces page >= 1", () => {
    expect(SalesOrderListQuerySchema.safeParse({ page: 1 }).success).toBe(true);
    expect(SalesOrderListQuerySchema.safeParse({ page: 0 }).success).toBe(
      false,
    );
    expect(SalesOrderListQuerySchema.safeParse({ page: -1 }).success).toBe(
      false,
    );
  });

  it("SalesOrderListQuerySchema enforces pageSize <= 100", () => {
    expect(SalesOrderListQuerySchema.safeParse({ pageSize: 20 }).success).toBe(
      true,
    );
    expect(SalesOrderListQuerySchema.safeParse({ pageSize: 100 }).success).toBe(
      true,
    );
    expect(SalesOrderListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(
      false,
    );
  });

  it("SalesOrderListQuerySchema defaults page=1 and pageSize=20", () => {
    const result = SalesOrderListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  it("InvoiceListQuerySchema enforces pageSize <= 100", () => {
    expect(InvoiceListQuerySchema.safeParse({ pageSize: 100 }).success).toBe(
      true,
    );
    expect(InvoiceListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(
      false,
    );
  });

  it("SalesOrderListQuerySchema accepts status filter", () => {
    const result = SalesOrderListQuerySchema.safeParse({ status: "Open" });
    expect(result.success).toBe(true);
    expect(
      SalesOrderListQuerySchema.safeParse({ status: "Draft" }).success,
    ).toBe(false);
  });

  it("InvoiceListQuerySchema accepts status filter", () => {
    expect(InvoiceListQuerySchema.safeParse({ status: "Paid" }).success).toBe(
      true,
    );
    expect(
      InvoiceListQuerySchema.safeParse({ status: "Cancelled" }).success,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ERP-3 Response Schemas", () => {
  it("SalesOrderSchema parses a complete valid order", () => {
    const order = {
      id: ORDER_ID,
      order_number: "SO-2026-0001",
      customer_golden_id: CUSTOMER_ID,
      order_date: "2026-04-01",
      status: "Open",
      currency: "INR",
      total: "1180.0000",
      lines: [
        {
          id: "10000000-0003-4000-8000-000000000001",
          order_id: ORDER_ID,
          product_id: PRODUCT_ID,
          quantity: "2.0000",
          price: "500.0000",
          tax_rate: "18.0000",
          tax_amount: "180.0000",
          line_total: "1180.0000",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      source_system: null,
      source_id: null,
      created_at: "2026-04-01T00:00:00.000Z",
      updated_at: "2026-04-01T00:00:00.000Z",
    };
    expect(SalesOrderSchema.safeParse(order).success).toBe(true);
  });

  it("InvoiceSchema requires due_date", () => {
    const baseInvoice = {
      id: INVOICE_ID,
      invoice_number: "INV-2026-0001",
      order_id: null,
      customer_golden_id: CUSTOMER_ID,
      invoice_date: "2026-04-01",
      // due_date intentionally omitted
      status: "Open",
      currency: "INR",
      total: "590.0000",
      lines: [],
      source_system: null,
      source_id: null,
      created_at: "2026-04-01T00:00:00.000Z",
      updated_at: "2026-04-01T00:00:00.000Z",
    };
    expect(InvoiceSchema.safeParse(baseInvoice).success).toBe(false);

    // With due_date it passes
    expect(
      InvoiceSchema.safeParse({ ...baseInvoice, due_date: "2026-05-01" })
        .success,
    ).toBe(true);
  });

  it("PaymentSchema parses a complete valid payment", () => {
    const payment = {
      id: PAYMENT_ID,
      invoice_id: INVOICE_ID,
      amount: "590.0000",
      paid_at: "2026-04-01T00:00:00.000Z",
      method: "bank",
      created_at: "2026-04-01T00:00:00.000Z",
    };
    expect(PaymentSchema.safeParse(payment).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ERP-3 Relationship Error Codes", () => {
  it("exports all expected error code constants", () => {
    expect(ERP3_RELATIONSHIP_ERROR_CODES.ORDER_NOT_FOUND).toBe(
      "ORDER_NOT_FOUND",
    );
    expect(ERP3_RELATIONSHIP_ERROR_CODES.ORDER_NUMBER_EXISTS).toBe(
      "ORDER_NUMBER_EXISTS",
    );
    expect(ERP3_RELATIONSHIP_ERROR_CODES.INVOICE_NOT_FOUND).toBe(
      "INVOICE_NOT_FOUND",
    );
    expect(ERP3_RELATIONSHIP_ERROR_CODES.INVOICE_NUMBER_EXISTS).toBe(
      "INVOICE_NUMBER_EXISTS",
    );
    expect(ERP3_RELATIONSHIP_ERROR_CODES.INVOICE_ALREADY_PAID).toBe(
      "INVOICE_ALREADY_PAID",
    );
    expect(ERP3_RELATIONSHIP_ERROR_CODES.PAYMENT_EXCEEDS_INVOICE_TOTAL).toBe(
      "PAYMENT_EXCEEDS_INVOICE_TOTAL",
    );
    expect(ERP3_RELATIONSHIP_ERROR_CODES.PRODUCT_NOT_FOUND).toBe(
      "PRODUCT_NOT_FOUND",
    );
    expect(ERP3_RELATIONSHIP_ERROR_CODES.MISSING_CUSTOMER_GOLDEN_ID).toBe(
      "MISSING_CUSTOMER_GOLDEN_ID",
    );
    expect(ERP3_RELATIONSHIP_ERROR_CODES.ORDER_REF_NOT_FOUND).toBe(
      "ORDER_REF_NOT_FOUND",
    );
    expect(
      ERP3_RELATIONSHIP_ERROR_CODES.INVALID_INVOICE_STATUS_TRANSITION,
    ).toBe("INVALID_INVOICE_STATUS_TRANSITION");
    expect(ERP3_RELATIONSHIP_ERROR_CODES.READ_MODEL_INCONSISTENT).toBe(
      "READ_MODEL_INCONSISTENT",
    );
    expect(ERP3_RELATIONSHIP_ERROR_CODES.SOURCE_IDENTITY_INCOMPLETE).toBe(
      "SOURCE_IDENTITY_INCOMPLETE",
    );
    expect(ERP3_RELATIONSHIP_ERROR_CODES.CURRENCY_MISMATCH).toBe(
      "CURRENCY_MISMATCH",
    );
    expect(ERP3_DOMAIN_RULES).toBe(ERP3_RELATIONSHIP_ERROR_CODES);
    expect(ERP3_OPTIONAL_REFERENCE_ABSENT).toBe(
      "ERP3_OPTIONAL_REFERENCE_ABSENT",
    );
  });

  it("exports ERP3-06 status sets, terminal statuses, and invoice transition matrix", () => {
    expect(ERP3_SALES_ORDER_STATUSES).toEqual(["Open", "Invoiced", "Closed"]);
    expect(ERP3_SALES_ORDER_TERMINAL_STATUSES).toEqual(["Closed"]);
    expect(ERP3_SALES_ORDER_STATUS_TRANSITIONS).toBe(
      ALLOWED_ORDER_STATUS_TRANSITIONS,
    );
    expect(ERP3_INVOICE_STATUSES).toEqual(["Open", "Paid", "Overdue"]);
    expect(ERP3_INVOICE_TERMINAL_STATUSES).toEqual(["Paid"]);
    expect(ERP3_INVOICE_STATUS_TRANSITIONS).toEqual({
      Open: ["Paid", "Overdue"],
      Overdue: ["Paid"],
      Paid: [],
    });
    expect(ERP3_PAYMENT_METHODS).toEqual(["cash", "bank", "card"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ERP-3 Canonical Aliases & Domain Helpers (Option 2 Strict Contract)", () => {
  it("aliases point strictly to canonical schemas and reject non-canonical shapes", () => {
    expect(CreateSalesOrderLineInputSchema).toBe(
      CreateSalesOrderLineRequestSchema,
    );
    expect(CreateSalesOrderInputSchema).toBe(CreateSalesOrderRequestSchema);
    expect(UpdateSalesOrderStatusInputSchema).toBe(
      UpdateSalesOrderStatusRequestSchema,
    );
    expect(SalesOrdersFilterQuerySchema).toBe(SalesOrderListQuerySchema);
    expect(PaginatedSalesOrdersResponseSchema).toBe(
      SalesOrderListResponseSchema,
    );
    expect(CreateInvoiceInputSchema).toBe(CreateInvoiceRequestSchema);
    expect(InvoicesFilterQuerySchema).toBe(InvoiceListQuerySchema);
    expect(PaginatedInvoicesResponseSchema).toBe(InvoiceListResponseSchema);
    expect(CreatePaymentInputSchema).toBe(CreatePaymentRequestSchema);

    expect(OrdersCurrencyCode.safeParse("USD").success).toBe(true);
    expect(OrdersUuid.safeParse(CUSTOMER_ID).success).toBe(true);
    expect(OrdersMoneyAmount.safeParse("125.0000").success).toBe(true);
  });

  it("CustomerGoldenIdSchema enforces UUID (ADR-003) and rejects gid-* strings", () => {
    expect(CustomerGoldenIdSchema.safeParse(CUSTOMER_ID).success).toBe(true);
    expect(CustomerGoldenIdSchema.safeParse("gid-cust-001").success).toBe(
      false,
    );
    expect(CustomerGoldenIdSchema.safeParse("GID-ACME-001").success).toBe(
      false,
    );
    expect(CustomerGoldenIdSchema.safeParse("").success).toBe(false);
  });

  it("ALLOWED_ORDER_STATUS_TRANSITIONS uses canonical TitleCase statuses", () => {
    expect(ALLOWED_ORDER_STATUS_TRANSITIONS.Open).toEqual([
      "Invoiced",
      "Closed",
    ]);
    expect(ALLOWED_ORDER_STATUS_TRANSITIONS.Invoiced).toEqual(["Closed"]);
    expect(ALLOWED_ORDER_STATUS_TRANSITIONS.Closed).toEqual([]);
  });

  it("calculateLineAmounts computes 4-dp subtotal, tax_amount, and line_total from percentage tax_rate", () => {
    const res = calculateLineAmounts("10", "12.5000", "10.0000");
    expect(res).toEqual({
      subtotal: "125.0000",
      tax_amount: "12.5000",
      line_total: "137.5000",
    });

    const resNumQty = calculateLineAmounts(5, "50.00", "10");
    expect(resNumQty).toEqual({
      subtotal: "250.0000",
      tax_amount: "25.0000",
      line_total: "275.0000",
    });
  });

  it("validateOrderLineTotals checks SUM(line.line_total) == orderTotal at 4-dp precision", () => {
    const lines = [{ line_total: "137.5000" }, { line_total: "262.5000" }];
    expect(validateOrderLineTotals(lines, "400.0000")).toBe(true);
    expect(validateOrderLineTotals(lines, "405.0000")).toBe(false);
  });

  it("deriveInvoiceStatus returns canonical TitleCase InvoiceStatus values", () => {
    expect(
      deriveInvoiceStatus("1375.0000", "1375.0000", "2026-11-23", "2026-10-23"),
    ).toBe("Paid");
    expect(
      deriveInvoiceStatus("1375.0000", "0.0000", "2026-10-15", "2026-10-23"),
    ).toBe("Overdue");
    expect(
      deriveInvoiceStatus("1375.0000", "0.0000", "2026-11-15", "2026-10-23"),
    ).toBe("Open");
  });
});
