/**
 * ERP-3 Sales Orders & Invoices — Domain Rules Unit Test Suite (Issue #28 / ERP3-03)
 *
 * Tests pure domain invariants in `src/domain/rules.ts`:
 *   - BR-ERP3-03: Customer Golden ID UUID validation
 *   - BR-ERP3-01 & BR-ERP3-02: Server-side line tax & total calculation (and DR-1 strict check)
 *   - FR-ERP3-05: Forward-only sales order status transitions
 *   - FR-ERP3-02: Invoice due_date validation and Open / Overdue / Paid derivation
 *   - FR-ERP3-03 & FR-ERP3-04: Single full-payment validation and Paid transition
 */

import { describe, expect, it } from "vitest";
import {
  ERP3_DOMAIN_ERROR_CODES,
  Erp3DomainError,
  assertValidCustomerGoldenId,
  assertValidFullPayment,
  assertValidInvoiceDates,
  assertValidOrderStatusTransition,
  calculateDocumentLinesAndTotal,
  isLineCalculationExactAt4Dp,
  resolveInvoiceStatus,
} from "../../src/domain/rules.js";

const VALID_CUSTOMER_UUID = "55555555-0003-4000-8000-000000000001";
const VALID_PRODUCT_1 = "11111111-0001-4000-8000-000000000001";
const VALID_PRODUCT_2 = "11111111-0001-4000-8000-000000000002";

describe("ERP-3 Domain Rules (Issue #28 / ERP3-03)", () => {
  describe("BR-ERP3-03: assertValidCustomerGoldenId", () => {
    it("accepts a canonical UUID v4 customer_golden_id", () => {
      expect(assertValidCustomerGoldenId(VALID_CUSTOMER_UUID)).toBe(
        VALID_CUSTOMER_UUID,
      );
    });

    it("rejects empty or non-UUID customer_golden_id values (including legacy gid-* strings)", () => {
      expect(() => assertValidCustomerGoldenId("")).toThrowError(
        Erp3DomainError,
      );
      expect(() => assertValidCustomerGoldenId("gid-1001")).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.MISSING_CUSTOMER_GOLDEN_ID,
        }),
      );
    });
  });

  describe("BR-ERP3-01 & BR-ERP3-02: calculateDocumentLinesAndTotal", () => {
    it("calculates line tax_amount, line_total, and document total server-side at 4-dp precision", () => {
      const result = calculateDocumentLinesAndTotal([
        {
          product_id: VALID_PRODUCT_1,
          quantity: "10.0000",
          price: "100.0000",
          tax_rate: "18.0000",
        },
        {
          product_id: VALID_PRODUCT_2,
          quantity: "2.0000",
          price: "250.0000",
          tax_rate: "12.0000",
        },
      ]);

      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]).toEqual({
        product_id: VALID_PRODUCT_1,
        quantity: "10.0000",
        price: "100.0000",
        tax_rate: "18.0000",
        subtotal: "1000.0000",
        tax_amount: "180.0000",
        line_total: "1180.0000",
      });
      expect(result.lines[1]).toEqual({
        product_id: VALID_PRODUCT_2,
        quantity: "2.0000",
        price: "250.0000",
        tax_rate: "12.0000",
        subtotal: "500.0000",
        tax_amount: "60.0000",
        line_total: "560.0000",
      });
      expect(result.total).toBe("1740.0000");
    });

    it("rejects empty lines array with EMPTY_LINES", () => {
      expect(() => calculateDocumentLinesAndTotal([])).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.EMPTY_LINES,
        }),
      );
    });

    it("detects sub-4-dp remainder when strictDr1Exact4Dp mode is enabled", () => {
      // qty=1.0001, price=1.0001 -> product has 8 decimal places (not exact at 4 dp)
      expect(isLineCalculationExactAt4Dp("1.0001", "1.0001", "18.0000")).toBe(
        false,
      );
      expect(() =>
        calculateDocumentLinesAndTotal(
          [
            {
              product_id: VALID_PRODUCT_1,
              quantity: "1.0001",
              price: "1.0001",
              tax_rate: "18.0000",
            },
          ],
          { strictDr1Exact4Dp: true },
        ),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.DR1_ROUNDING_UNRESOLVED,
        }),
      );
    });
  });

  describe("FR-ERP3-05: assertValidOrderStatusTransition", () => {
    it("allows legal forward transitions Open -> Invoiced, Invoiced -> Closed, and Open -> Closed", () => {
      expect(() =>
        assertValidOrderStatusTransition("Open", "Invoiced"),
      ).not.toThrow();
      expect(() =>
        assertValidOrderStatusTransition("Invoiced", "Closed"),
      ).not.toThrow();
      expect(() =>
        assertValidOrderStatusTransition("Open", "Closed"),
      ).not.toThrow();
    });

    it("rejects backward and self transitions with INVALID_ORDER_STATUS_TRANSITION", () => {
      const illegal: Array<["Open" | "Invoiced" | "Closed", "Open" | "Invoiced" | "Closed"]> = [
        ["Open", "Open"],
        ["Invoiced", "Open"],
        ["Invoiced", "Invoiced"],
        ["Closed", "Open"],
        ["Closed", "Invoiced"],
        ["Closed", "Closed"],
      ];

      for (const [from, to] of illegal) {
        expect(() => assertValidOrderStatusTransition(from, to)).toThrowError(
          expect.objectContaining({
            code: ERP3_DOMAIN_ERROR_CODES.INVALID_ORDER_STATUS_TRANSITION,
          }),
        );
      }
    });

    it("blocks direct Open -> Closed when allowDirectOpenToClosed is false", () => {
      expect(() =>
        assertValidOrderStatusTransition("Open", "Closed", {
          allowDirectOpenToClosed: false,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.INVALID_ORDER_STATUS_TRANSITION,
        }),
      );
    });
  });

  describe("FR-ERP3-02: assertValidInvoiceDates & resolveInvoiceStatus", () => {
    it("accepts due_date equal to or after invoice_date", () => {
      expect(() =>
        assertValidInvoiceDates("2026-04-01", "2026-04-01"),
      ).not.toThrow();
      expect(() =>
        assertValidInvoiceDates("2026-04-01", "2026-05-01"),
      ).not.toThrow();
    });

    it("rejects due_date earlier than invoice_date with INVALID_DUE_DATE", () => {
      expect(() =>
        assertValidInvoiceDates("2026-04-15", "2026-04-01"),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.INVALID_DUE_DATE,
        }),
      );
    });

    it("derives Open when unpaid and current UTC date <= due_date, Overdue when > due_date, and Paid when settled", () => {
      expect(
        resolveInvoiceStatus("1180.0000", "0.0000", "2026-05-01", "2026-05-01"),
      ).toBe("Open");
      expect(
        resolveInvoiceStatus("1180.0000", "0.0000", "2026-05-01", "2026-05-02"),
      ).toBe("Overdue");
      expect(
        resolveInvoiceStatus(
          "1180.0000",
          "1180.0000",
          "2026-05-01",
          "2026-06-01",
        ),
      ).toBe("Paid");
    });
  });

  describe("FR-ERP3-03 & FR-ERP3-04: assertValidFullPayment", () => {
    it("accepts a single full payment equal to invoice.total and transitions status to Paid", () => {
      const res = assertValidFullPayment({
        invoiceStatus: "Open",
        invoiceTotal: "1180.0000",
        existingPaidTotal: "0.0000",
        paymentAmount: "1180.0000",
      });

      expect(res).toEqual({
        newPaidTotal: "1180.0000",
        nextInvoiceStatus: "Paid",
      });
    });

    it("rejects partial payment (< invoice.total) with PARTIAL_PAYMENT_NOT_ALLOWED", () => {
      expect(() =>
        assertValidFullPayment({
          invoiceStatus: "Open",
          invoiceTotal: "1180.0000",
          existingPaidTotal: "0.0000",
          paymentAmount: "500.0000",
        }),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.PARTIAL_PAYMENT_NOT_ALLOWED,
        }),
      );
    });

    it("rejects overpayment (> invoice.total) with PAYMENT_EXCEEDS_INVOICE_TOTAL", () => {
      expect(() =>
        assertValidFullPayment({
          invoiceStatus: "Open",
          invoiceTotal: "1180.0000",
          existingPaidTotal: "0.0000",
          paymentAmount: "1200.0000",
        }),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.PAYMENT_EXCEEDS_INVOICE_TOTAL,
        }),
      );
    });

    it("rejects payment on an already-Paid invoice with INVOICE_ALREADY_PAID", () => {
      expect(() =>
        assertValidFullPayment({
          invoiceStatus: "Paid",
          invoiceTotal: "1180.0000",
          existingPaidTotal: "1180.0000",
          paymentAmount: "1180.0000",
        }),
      ).toThrowError(
        expect.objectContaining({
          code: ERP3_DOMAIN_ERROR_CODES.INVOICE_ALREADY_PAID,
        }),
      );
    });
  });
});
