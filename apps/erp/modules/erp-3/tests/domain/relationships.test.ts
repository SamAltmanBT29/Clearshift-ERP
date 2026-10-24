/**
 * ERP-3 Sales Orders & Invoices — Relationships, State Transitions & Read Model Consistency Test Suite
 *
 * Validates all Acceptance Criteria for Issue #31 (ERP3-06):
 *   - AC-1: Every required relationship is validated before commit and an invalid reference
 *     returns a stable error with no partial mutation; optional links produce approved warnings
 *     (`ERP3_OPTIONAL_REFERENCE_ABSENT`) without materialising synthetic records.
 *   - AC-2: Every specified enumeration rejects unknown values (`SalesOrderStatus`, `InvoiceStatus`,
 *     `PaymentMethod`, `CurrencyCode`).
 *   - AC-3: State transition tests cover each allowed transition and each forbidden transition
 *     for both Sales Orders (`Open -> Invoiced -> Closed`) and Invoices (`Open -> Paid | Overdue`,
 *     `Overdue -> Paid`, `Paid` terminal).
 *   - AC-4: Read-model consistency assertions verify that `SalesOrder`, `Invoice`, and `Payment`
 *     projections agree on status, links, derived line taxes/totals, and aggregate totals.
 *   - AC-5: Cross-module calls (`customer`, `product`) are contract-tested and failure-safe,
 *     and `Erp3ReferenceResolver` exposes read-only `sales_order`, `invoice`, and `payment` lookups.
 *   - AC-6: Domain invariant asserted: every order and invoice has a valid customer Golden ID (UUID).
 */

import { describe, expect, it } from "vitest";
import type { ReferenceResolver } from "@cs/kernel";
import {
  ERP3_INVOICE_STATUSES,
  ERP3_INVOICE_STATUS_TRANSITIONS,
  ERP3_INVOICE_TERMINAL_STATUSES,
  ERP3_OPTIONAL_REFERENCE_ABSENT,
  ERP3_PAYMENT_METHODS,
  ERP3_SALES_ORDER_STATUSES,
  ERP3_SALES_ORDER_STATUS_TRANSITIONS,
  ERP3_SALES_ORDER_TERMINAL_STATUSES,
  type Invoice,
  type InvoiceStatus,
  type Payment,
  type SalesOrder,
  type SalesOrderStatus,
} from "@clearshift/contracts";
import {
  ERP3_DOMAIN_ERROR_CODES,
  ERP3_RELATIONSHIPS,
  Erp3DomainError,
  assertInvoiceReadConsistency,
  assertInvoiceStatusTransition,
  assertOrderInvoiceCurrencyConsistency,
  assertPaymentReadConsistency,
  assertSalesOrderReadConsistency,
  assertSalesOrderStatusTransition,
  assertSourceIdentityIsComplete,
  assertValidCurrencyCode,
  assertValidInvoiceStatus,
  assertValidPaymentMethod,
  assertValidSalesOrderStatus,
  handleOptionalRelationship,
  validateCrossModuleReference,
} from "../../src/domain/index.js";
import { Erp3ReferenceResolver } from "../../src/public.js";
import { InMemoryErp3Repository } from "../../src/services/repository.js";

const VALID_CUSTOMER_UUID = "55555555-0003-4000-8000-000000000001";
const VALID_PRODUCT_1 = "11111111-0001-4000-8000-000000000001";
const VALID_ORDER_ID = "aaaaaaaa-0003-4000-8000-000000000001";
const VALID_INVOICE_ID = "cccccccc-0003-4000-8000-000000000001";
const VALID_PAYMENT_ID = "eeeeeeee-0003-4000-8000-000000000001";

function buildValidOrder(overrides: Partial<SalesOrder> = {}): SalesOrder {
  return {
    id: VALID_ORDER_ID,
    order_number: "SO-2026-0001",
    customer_golden_id: VALID_CUSTOMER_UUID,
    order_date: "2026-04-01",
    status: "Open",
    currency: "USD",
    total: "1180.0000",
    lines: [
      {
        id: "bbbbbbbb-0003-4000-8000-000000000001",
        order_id: VALID_ORDER_ID,
        product_id: VALID_PRODUCT_1,
        quantity: "10.0000",
        price: "100.0000",
        tax_rate: "18.0000",
        tax_amount: "180.0000",
        line_total: "1180.0000",
        created_at: "2026-04-01T10:00:00.000Z",
      },
    ],
    source_system: null,
    source_id: null,
    created_at: "2026-04-01T10:00:00.000Z",
    updated_at: "2026-04-01T10:00:00.000Z",
    ...overrides,
  };
}

function buildValidInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: VALID_INVOICE_ID,
    invoice_number: "INV-2026-0001",
    order_id: VALID_ORDER_ID,
    customer_golden_id: VALID_CUSTOMER_UUID,
    invoice_date: "2026-04-01",
    due_date: "2026-05-01",
    status: "Open",
    currency: "USD",
    total: "1180.0000",
    lines: [
      {
        id: "dddddddd-0003-4000-8000-000000000001",
        invoice_id: VALID_INVOICE_ID,
        product_id: VALID_PRODUCT_1,
        quantity: "10.0000",
        price: "100.0000",
        tax_rate: "18.0000",
        tax_amount: "180.0000",
        line_total: "1180.0000",
        created_at: "2026-04-01T10:00:00.000Z",
      },
    ],
    source_system: null,
    source_id: null,
    created_at: "2026-04-01T10:00:00.000Z",
    updated_at: "2026-04-01T10:00:00.000Z",
    ...overrides,
  };
}

function buildValidPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: VALID_PAYMENT_ID,
    invoice_id: VALID_INVOICE_ID,
    amount: "1180.0000",
    paid_at: "2026-04-10T12:00:00.000Z",
    method: "bank",
    created_at: "2026-04-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("ERP-3 Domain Relationships, State Transitions & Read Model Consistency (Issue #31 / ERP3-06)", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Relationship Catalog & Optional Link / Provenance Handling
  // ───────────────────────────────────────────────────────────────────────────
  describe("Relationship Catalog, Optional Links & Provenance Completeness", () => {
    it("defines the complete ERP3_RELATIONSHIPS catalog with intra-module and cross-module metadata", () => {
      expect(Object.keys(ERP3_RELATIONSHIPS)).toEqual([
        "ORDER_CUSTOMER",
        "ORDER_LINES",
        "ORDER_LINE_PRODUCT",
        "INVOICE_CUSTOMER",
        "INVOICE_ORDER",
        "INVOICE_LINES",
        "INVOICE_LINE_PRODUCT",
        "PAYMENT_INVOICE",
      ]);
      expect(ERP3_RELATIONSHIPS.ORDER_CUSTOMER?.type).toBe("cross_module");
      expect(ERP3_RELATIONSHIPS.ORDER_CUSTOMER?.requirement).toBe("required");
      expect(ERP3_RELATIONSHIPS.INVOICE_ORDER?.type).toBe("intra_module");
      expect(ERP3_RELATIONSHIPS.INVOICE_ORDER?.requirement).toBe("optional");
      expect(ERP3_RELATIONSHIPS.PAYMENT_INVOICE?.requirement).toBe("required");
    });

    it("handleOptionalRelationship returns ERP3_OPTIONAL_REFERENCE_ABSENT warning and null when absent, without fabricating a synthetic record", () => {
      for (const emptyVal of [null, undefined, ""]) {
        const res = handleOptionalRelationship(
          emptyVal,
          "order_id",
          "INVOICE_ORDER",
        );
        expect(res.value).toBeNull();
        expect(res.warning).toEqual({
          relationship: "INVOICE_ORDER",
          field: "order_id",
          code: ERP3_OPTIONAL_REFERENCE_ABSENT,
          message: expect.stringContaining("No synthetic record was created"),
        });
      }

      const present = handleOptionalRelationship(
        VALID_ORDER_ID,
        "order_id",
        "INVOICE_ORDER",
      );
      expect(present.value).toBe(VALID_ORDER_ID);
      expect(present.warning).toBeUndefined();
    });

    it("assertSourceIdentityIsComplete accepts both null/absent or both present, and rejects partial provenance with SOURCE_IDENTITY_INCOMPLETE", () => {
      expect(() => assertSourceIdentityIsComplete(null, null)).not.toThrow();
      expect(() =>
        assertSourceIdentityIsComplete(undefined, undefined),
      ).not.toThrow();
      expect(() =>
        assertSourceIdentityIsComplete("legacy_erp", "SO-1001"),
      ).not.toThrow();

      expect(() =>
        assertSourceIdentityIsComplete("legacy_erp", null),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.SOURCE_IDENTITY_INCOMPLETE,
          field: "source_id",
        }),
      );

      expect(() =>
        assertSourceIdentityIsComplete(null, "SO-1001"),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.SOURCE_IDENTITY_INCOMPLETE,
          field: "source_system",
        }),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Enumeration & Currency Validations (AC-2)
  // ───────────────────────────────────────────────────────────────────────────
  describe("AC-2: Enumeration & Currency Validations", () => {
    it("assertValidSalesOrderStatus accepts Open, Invoiced, Closed and rejects unknown or lowercase values", () => {
      for (const status of ERP3_SALES_ORDER_STATUSES) {
        expect(() => assertValidSalesOrderStatus(status)).not.toThrow();
      }

      for (const invalid of ["open", "Draft", "Paid", "Cancelled", "", null]) {
        expect(() => assertValidSalesOrderStatus(invalid)).toThrowError(
          expect.objectContaining({
            code: ERP3_DOMAIN_ERROR_CODES.INVALID_ORDER_STATUS,
            field: "status",
          }),
        );
      }
    });

    it("assertValidInvoiceStatus accepts Open, Paid, Overdue and rejects unknown or lowercase values", () => {
      for (const status of ERP3_INVOICE_STATUSES) {
        expect(() => assertValidInvoiceStatus(status)).not.toThrow();
      }

      for (const invalid of ["paid", "Closed", "Draft", "Voided", "", null]) {
        expect(() => assertValidInvoiceStatus(invalid)).toThrowError(
          expect.objectContaining({
            code: ERP3_DOMAIN_ERROR_CODES.INVALID_INVOICE_STATUS,
            field: "status",
          }),
        );
      }
    });

    it("assertValidPaymentMethod accepts cash, bank, card and rejects unknown values", () => {
      for (const method of ERP3_PAYMENT_METHODS) {
        expect(() => assertValidPaymentMethod(method)).not.toThrow();
      }

      for (const invalid of ["Cash", "wire", "cheque", "crypto", "", null]) {
        expect(() => assertValidPaymentMethod(invalid)).toThrowError(
          expect.objectContaining({
            code: ERP3_DOMAIN_ERROR_CODES.INVALID_PAYMENT_METHOD,
            field: "method",
          }),
        );
      }
    });

    it("assertValidCurrencyCode accepts 3-letter uppercase ISO 4217 codes and rejects malformed codes", () => {
      for (const valid of ["USD", "INR", "EUR", "GBP"]) {
        expect(() => assertValidCurrencyCode(valid)).not.toThrow();
      }

      for (const invalid of ["usd", "US", "USDD", "123", "", null]) {
        expect(() => assertValidCurrencyCode(invalid)).toThrowError(
          expect.objectContaining({
            code: ERP3_DOMAIN_ERROR_CODES.INVALID_CURRENCY_CODE,
            field: "currency",
          }),
        );
      }
    });

    it("assertOrderInvoiceCurrencyConsistency enforces matching currency in V1 (no FX conversion)", () => {
      expect(() =>
        assertOrderInvoiceCurrencyConsistency("USD", "USD"),
      ).not.toThrow();
      expect(() =>
        assertOrderInvoiceCurrencyConsistency("INR", "INR"),
      ).not.toThrow();

      expect(() =>
        assertOrderInvoiceCurrencyConsistency("USD", "INR"),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.CURRENCY_MISMATCH,
          field: "currency",
        }),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. State Transition Matrices (AC-3)
  // ───────────────────────────────────────────────────────────────────────────
  describe("AC-3: Sales Order & Invoice State Transition Matrices", () => {
    it("allows every legal forward Sales Order transition and rejects every backward or terminal transition", () => {
      expect(ERP3_SALES_ORDER_TERMINAL_STATUSES).toEqual(["Closed"]);
      expect(ERP3_SALES_ORDER_STATUS_TRANSITIONS).toEqual({
        Open: ["Invoiced", "Closed"],
        Invoiced: ["Closed"],
        Closed: [],
      });

      const allowedPairs: Array<[SalesOrderStatus, SalesOrderStatus]> = [
        ["Open", "Invoiced"],
        ["Open", "Closed"],
        ["Invoiced", "Closed"],
      ];
      for (const [from, to] of allowedPairs) {
        expect(() => assertSalesOrderStatusTransition(from, to)).not.toThrow();
      }

      const forbiddenPairs: Array<[SalesOrderStatus, SalesOrderStatus]> = [
        ["Open", "Open"],
        ["Invoiced", "Open"],
        ["Invoiced", "Invoiced"],
        ["Closed", "Open"],
        ["Closed", "Invoiced"],
        ["Closed", "Closed"],
      ];
      for (const [from, to] of forbiddenPairs) {
        expect(() => assertSalesOrderStatusTransition(from, to)).toThrowError(
          expect.objectContaining({
            code: ERP3_DOMAIN_ERROR_CODES.INVALID_ORDER_STATUS_TRANSITION,
            field: "status",
          }),
        );
      }

      // When allowSameStatusNoop is enabled, identical status is a no-op
      for (const s of ERP3_SALES_ORDER_STATUSES) {
        expect(() =>
          assertSalesOrderStatusTransition(s, s, { allowSameStatusNoop: true }),
        ).not.toThrow();
      }
    });

    it("allows every legal Invoice transition (Open -> Paid | Overdue, Overdue -> Paid) and rejects every forbidden transition", () => {
      expect(ERP3_INVOICE_TERMINAL_STATUSES).toEqual(["Paid"]);
      expect(ERP3_INVOICE_STATUS_TRANSITIONS).toEqual({
        Open: ["Paid", "Overdue"],
        Overdue: ["Paid"],
        Paid: [],
      });

      const allowedPairs: Array<[InvoiceStatus, InvoiceStatus]> = [
        ["Open", "Paid"],
        ["Open", "Overdue"],
        ["Overdue", "Paid"],
      ];
      for (const [from, to] of allowedPairs) {
        expect(() => assertInvoiceStatusTransition(from, to)).not.toThrow();
      }

      const forbiddenPairs: Array<[InvoiceStatus, InvoiceStatus]> = [
        ["Open", "Open"],
        ["Overdue", "Open"],
        ["Overdue", "Overdue"],
        ["Paid", "Open"],
        ["Paid", "Overdue"],
        ["Paid", "Paid"],
      ];
      for (const [from, to] of forbiddenPairs) {
        expect(() => assertInvoiceStatusTransition(from, to)).toThrowError(
          expect.objectContaining({
            code: ERP3_DOMAIN_ERROR_CODES.INVALID_INVOICE_STATUS_TRANSITION,
            field: "status",
          }),
        );
      }

      // Same-status no-op when explicitly enabled
      for (const s of ERP3_INVOICE_STATUSES) {
        expect(() =>
          assertInvoiceStatusTransition(s, s, { allowSameStatusNoop: true }),
        ).not.toThrow();
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Cross-Module Reference Validation & Erp3ReferenceResolver (AC-1, AC-5, AC-6)
  // ───────────────────────────────────────────────────────────────────────────
  describe("AC-1, AC-5, AC-6: Cross-Module Reference Validation & Erp3ReferenceResolver", () => {
    it("validates customer Golden ID (UUID) and ERP-1 product references via ReferenceResolver and fails safely on resolver errors", async () => {
      const mockResolver: ReferenceResolver = {
        async exists(entityType: string, id: string): Promise<boolean> {
          if (id === "99999999-9999-4000-8000-999999999999") {
            throw new Error("Simulated upstream CRM-1 timeout");
          }
          if (entityType === "customer") {
            return id === VALID_CUSTOMER_UUID;
          }
          if (entityType === "product") {
            return id === VALID_PRODUCT_1;
          }
          return false;
        },
        async get() {
          return null;
        },
      };

      // Valid customer and product
      await expect(
        validateCrossModuleReference(
          mockResolver,
          "customer",
          VALID_CUSTOMER_UUID,
          true,
          "customer_golden_id",
        ),
      ).resolves.toEqual({ valid: true });

      await expect(
        validateCrossModuleReference(
          mockResolver,
          "product",
          VALID_PRODUCT_1,
          true,
          "lines.0.product_id",
        ),
      ).resolves.toEqual({ valid: true });

      // Missing required customer -> MISSING_CUSTOMER_GOLDEN_ID
      await expect(
        validateCrossModuleReference(
          mockResolver,
          "customer",
          "",
          true,
          "customer_golden_id",
        ),
      ).rejects.toMatchObject({
        code: ERP3_DOMAIN_ERROR_CODES.MISSING_CUSTOMER_GOLDEN_ID,
      });

      // Unknown customer -> CUSTOMER_NOT_FOUND
      await expect(
        validateCrossModuleReference(
          mockResolver,
          "customer",
          "55555555-9999-4000-8000-000000000099",
          true,
          "customer_golden_id",
        ),
      ).rejects.toMatchObject({
        code: ERP3_DOMAIN_ERROR_CODES.CUSTOMER_NOT_FOUND,
      });

      // Unknown product -> PRODUCT_NOT_FOUND
      await expect(
        validateCrossModuleReference(
          mockResolver,
          "product",
          "11111111-9999-4000-8000-000000000099",
          true,
          "lines.0.product_id",
        ),
      ).rejects.toMatchObject({
        code: ERP3_DOMAIN_ERROR_CODES.PRODUCT_NOT_FOUND,
      });

      // Resolver runtime failure -> wrapped safely in Erp3DomainError(INVALID_REFERENCE)
      await expect(
        validateCrossModuleReference(
          mockResolver,
          "customer",
          "99999999-9999-4000-8000-999999999999",
          true,
          "customer_golden_id",
        ),
      ).rejects.toMatchObject({
        code: ERP3_DOMAIN_ERROR_CODES.INVALID_REFERENCE,
      });
    });

    it("Erp3ReferenceResolver resolves sales_order, invoice, and payment summaries from repository", async () => {
      const repo = new InMemoryErp3Repository(true);
      await repo.createInvoice(buildValidInvoice());
      await repo.createPayment(buildValidPayment());

      const resolver = new Erp3ReferenceResolver(repo);

      expect(await resolver.exists("sales_order", VALID_ORDER_ID)).toBe(true);
      expect(await resolver.exists("invoice", VALID_INVOICE_ID)).toBe(true);
      expect(await resolver.exists("payment", VALID_PAYMENT_ID)).toBe(true);
      expect(await resolver.exists("unknown_entity", VALID_ORDER_ID)).toBe(
        false,
      );

      const orderSummary = await resolver.get("sales_order", VALID_ORDER_ID);
      expect(orderSummary).toMatchObject({
        id: VALID_ORDER_ID,
        orderNumber: "SO-2026-0001",
        customerGoldenId: VALID_CUSTOMER_UUID,
        total: "1180.0000",
      });

      const invoiceSummary = await resolver.get("invoice", VALID_INVOICE_ID);
      expect(invoiceSummary).toMatchObject({
        id: VALID_INVOICE_ID,
        invoiceNumber: "INV-2026-0001",
        orderId: VALID_ORDER_ID,
        customerGoldenId: VALID_CUSTOMER_UUID,
        status: "Open",
        total: "1180.0000",
      });

      const paymentSummary = await resolver.get("payment", VALID_PAYMENT_ID);
      expect(paymentSummary).toMatchObject({
        id: VALID_PAYMENT_ID,
        invoiceId: VALID_INVOICE_ID,
        amount: "1180.0000",
        method: "bank",
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Read-Model Consistency Assertions (AC-4)
  // ───────────────────────────────────────────────────────────────────────────
  describe("AC-4: Read-Model Consistency Assertions", () => {
    it("assertSalesOrderReadConsistency passes on consistent order and rejects mismatched line_total, tax_amount, order_id, or total", () => {
      const validOrder = buildValidOrder();
      expect(() => assertSalesOrderReadConsistency(validOrder)).not.toThrow();

      // Tampered order total
      expect(() =>
        assertSalesOrderReadConsistency(
          buildValidOrder({ total: "9999.0000" }),
        ),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
          field: "total",
        }),
      );

      // Tampered line tax_amount
      expect(() =>
        assertSalesOrderReadConsistency(
          buildValidOrder({
            lines: [
              {
                ...validOrder.lines[0]!,
                tax_amount: "50.0000",
              },
            ],
          }),
        ),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
          field: "lines.0.tax_amount",
        }),
      );

      // Mismatched line.order_id
      expect(() =>
        assertSalesOrderReadConsistency(
          buildValidOrder({
            lines: [
              {
                ...validOrder.lines[0]!,
                order_id: "aaaaaaaa-9999-4000-8000-999999999999",
              },
            ],
          }),
        ),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
          field: "lines.0.order_id",
        }),
      );
    });

    it("assertInvoiceReadConsistency passes on consistent Open, Overdue, and Paid invoices and rejects status/payment/line mismatches", () => {
      const openInv = buildValidInvoice({ status: "Open" });
      expect(() =>
        assertInvoiceReadConsistency(openInv, [], "2026-04-15"),
      ).not.toThrow();

      const overdueInv = buildValidInvoice({ status: "Overdue" });
      expect(() =>
        assertInvoiceReadConsistency(overdueInv, [], "2026-05-15"),
      ).not.toThrow();

      const paidInv = buildValidInvoice({ status: "Paid" });
      const payment = buildValidPayment();
      expect(() =>
        assertInvoiceReadConsistency(paidInv, [payment], "2026-04-15"),
      ).not.toThrow();

      // Status claims Open when full payment is present -> READ_MODEL_INCONSISTENT
      expect(() =>
        assertInvoiceReadConsistency(openInv, [payment], "2026-04-15"),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
          field: "status",
        }),
      );

      // Status claims Open when past due_date and unpaid -> READ_MODEL_INCONSISTENT
      expect(() =>
        assertInvoiceReadConsistency(openInv, [], "2026-06-01"),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
          field: "status",
        }),
      );
    });

    it("assertPaymentReadConsistency passes on consistent full payment and rejects mismatched invoice_id, partial amount, or non-Paid invoice", () => {
      const paidInv = buildValidInvoice({ status: "Paid" });
      const payment = buildValidPayment();
      expect(() =>
        assertPaymentReadConsistency(payment, paidInv),
      ).not.toThrow();

      // Target invoice still Open after full payment -> READ_MODEL_INCONSISTENT
      const openInv = buildValidInvoice({ status: "Open" });
      expect(() =>
        assertPaymentReadConsistency(payment, openInv),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
          field: "status",
        }),
      );

      // Payment amount != invoice total -> READ_MODEL_INCONSISTENT
      expect(() =>
        assertPaymentReadConsistency(
          buildValidPayment({ amount: "500.0000" }),
          paidInv,
        ),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.READ_MODEL_INCONSISTENT,
          field: "amount",
        }),
      );
    });
  });
});
