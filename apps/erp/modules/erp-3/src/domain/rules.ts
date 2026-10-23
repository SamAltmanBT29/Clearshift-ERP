/**
 * ERP-3 Sales Orders & Invoices — Pure Domain Rules & Invariant Validation
 *
 * Implements side-effect-free domain invariants for Issue #28 (ERP3-03):
 *   - BR-ERP3-01: Server-computed line totals and order/invoice totals must match.
 *   - BR-ERP3-02: Line tax = line amount * tax_rate / 100 (provisional 4-dp helper via
 *     `@clearshift/contracts` `calculateLineAmounts`; DR-1 rounding policy remains
 *     explicitly pending Integration Lead sign-off).
 *   - BR-ERP3-03: Every sales order and invoice requires a valid customer Golden ID (UUID).
 *   - FR-ERP3-02: Invoice requires `due_date` (>= `invoice_date`), derives status
 *     (`Open` / `Overdue` / `Paid`), and each sales order has at most one V1 invoice.
 *   - FR-ERP3-03 / FR-ERP3-04: V1 accepts one full payment per invoice (`amount == invoice.total`);
 *     partial payments, overpayments, and payments on already-Paid invoices are rejected;
 *     accepted full payment transitions the invoice to `Paid` automatically.
 *   - FR-ERP3-05: Forward-only sales order status transitions (`ALLOWED_ORDER_STATUS_TRANSITIONS`).
 *
 * @module erp3/domain/rules
 */

import {
  ALLOWED_ORDER_STATUS_TRANSITIONS,
  ERP3_RELATIONSHIP_ERROR_CODES,
  UuidSchema,
  calculateLineAmounts,
  deriveInvoiceStatus,
  validateOrderLineTotals,
  type CreateInvoiceLineRequest,
  type CreateSalesOrderLineRequest,
  type InvoiceStatus,
  type SalesOrderStatus,
} from "@clearshift/contracts";

export const ERP3_DOMAIN_ERROR_CODES = {
  ...ERP3_RELATIONSHIP_ERROR_CODES,
  ORDER_ALREADY_INVOICED: "ORDER_ALREADY_INVOICED",
  PARTIAL_PAYMENT_NOT_ALLOWED: "PARTIAL_PAYMENT_NOT_ALLOWED",
  INVALID_DUE_DATE: "INVALID_DUE_DATE",
  CUSTOMER_MISMATCH: "CUSTOMER_MISMATCH",
  EMPTY_LINES: "EMPTY_LINES",
  INVALID_LINE_AMOUNT: "INVALID_LINE_AMOUNT",
  DR1_ROUNDING_UNRESOLVED: "DR1_ROUNDING_UNRESOLVED",
} as const;

export type Erp3DomainErrorCode =
  (typeof ERP3_DOMAIN_ERROR_CODES)[keyof typeof ERP3_DOMAIN_ERROR_CODES];

export class Erp3DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
    public readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "Erp3DomainError";
  }
}

const SCALE_4DP = 10_000n;

/**
 * Parses a decimal string with up to 4 fractional digits into a scaled BigInt (`value * 10_000`).
 */
export function parseScaledDecimal4Dp(value: string | number): bigint {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVALID_LINE_AMOUNT,
      `Invalid non-negative 4-dp decimal value: '${value}'`,
    );
  }
  const [intPart = "0", fracPart = ""] = normalized.split(".");
  const paddedFrac = (fracPart + "0000").slice(0, 4);
  return BigInt(intPart) * SCALE_4DP + BigInt(paddedFrac);
}

/**
 * Formats a scaled BigInt (`value * 10_000`) into a 4-dp string (`"0.0000"`).
 */
export function formatScaledDecimal4Dp(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const intPart = abs / SCALE_4DP;
  const fracPart = (abs % SCALE_4DP).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${intPart}.${fracPart}`;
}

/**
 * Checks whether a single line's subtotal (`quantity * price`) and tax (`subtotal * tax_rate / 100`)
 * are both exact at 4 decimal places without requiring rounding.
 *
 * Used when strict DR-1 mode is enabled so unresolved sub-4-dp rounding cases are flagged
 * rather than silently rounded.
 */
export function isLineCalculationExactAt4Dp(
  quantity: string,
  price: string,
  taxRate: string,
): boolean {
  const qtyScaled = parseScaledDecimal4Dp(quantity);
  const priceScaled = parseScaledDecimal4Dp(price);
  const rateScaled = parseScaledDecimal4Dp(taxRate);

  const rawProduct = qtyScaled * priceScaled;
  if (rawProduct % SCALE_4DP !== 0n) {
    return false;
  }
  const baseScaled = rawProduct / SCALE_4DP;
  const rawTax = baseScaled * rateScaled;
  return rawTax % (SCALE_4DP * 100n) === 0n;
}

/**
 * BR-ERP3-03: Every order and invoice must have a valid customer Golden ID (UUID).
 */
export function assertValidCustomerGoldenId(customerGoldenId: unknown): string {
  if (
    typeof customerGoldenId !== "string" ||
    customerGoldenId.trim().length === 0
  ) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.MISSING_CUSTOMER_GOLDEN_ID,
      "Sales order and invoice require a mandatory customer_golden_id (BR-ERP3-03).",
      "customer_golden_id",
    );
  }
  const parsed = UuidSchema.safeParse(customerGoldenId);
  if (!parsed.success) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.MISSING_CUSTOMER_GOLDEN_ID,
      "customer_golden_id must be a valid UUID v4 per ADR-003 (BR-ERP3-03).",
      "customer_golden_id",
      { value: customerGoldenId },
    );
  }
  return parsed.data;
}

export interface CalculatedErp3Line {
  product_id: string;
  quantity: string;
  price: string;
  tax_rate: string;
  subtotal: string;
  tax_amount: string;
  line_total: string;
}

export interface CalculateLinesOptions {
  /**
   * When true, rejects inputs whose `quantity * price` or `tax_amount` is not
   * exactly representable at 4 decimal places with `DR1_ROUNDING_UNRESOLVED`.
   * When false (default), uses the canonical provisional helper `calculateLineAmounts`
   * from `@clearshift/contracts`.
   */
  strictDr1Exact4Dp?: boolean;
}

/**
 * BR-ERP3-01 & BR-ERP3-02: Server-side calculation of line tax amounts, line totals,
 * and aggregate document total. Client-supplied totals are never trusted.
 */
export function calculateDocumentLinesAndTotal(
  lines: ReadonlyArray<CreateSalesOrderLineRequest | CreateInvoiceLineRequest>,
  options: CalculateLinesOptions = {},
): {
  lines: CalculatedErp3Line[];
  total: string;
} {
  if (!lines || lines.length === 0) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.EMPTY_LINES,
      "Document must contain at least one line item.",
      "lines",
    );
  }

  let totalScaled = 0n;

  const calculatedLines: CalculatedErp3Line[] = lines.map((line, index) => {
    const qtyScaled = parseScaledDecimal4Dp(line.quantity);
    if (qtyScaled <= 0n) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.INVALID_LINE_AMOUNT,
        `Line ${index + 1} quantity must be greater than zero.`,
        `lines.${index}.quantity`,
      );
    }

    const priceScaled = parseScaledDecimal4Dp(line.price);
    const rateScaled = parseScaledDecimal4Dp(line.tax_rate);

    if (
      options.strictDr1Exact4Dp &&
      !isLineCalculationExactAt4Dp(line.quantity, line.price, line.tax_rate)
    ) {
      throw new Erp3DomainError(
        ERP3_DOMAIN_ERROR_CODES.DR1_ROUNDING_UNRESOLVED,
        `Line ${index + 1} requires sub-4-dp rounding, which is pending DR-1 confirmation.`,
        `lines.${index}`,
      );
    }

    const computed = calculateLineAmounts(
      line.quantity,
      line.price,
      line.tax_rate,
    );
    const lineTotalScaled = parseScaledDecimal4Dp(computed.line_total);
    totalScaled += lineTotalScaled;

    return {
      product_id: line.product_id,
      quantity: formatScaledDecimal4Dp(qtyScaled),
      price: formatScaledDecimal4Dp(priceScaled),
      tax_rate: formatScaledDecimal4Dp(rateScaled),
      subtotal: computed.subtotal,
      tax_amount: computed.tax_amount,
      line_total: computed.line_total,
    };
  });

  const total = formatScaledDecimal4Dp(totalScaled);

  if (!validateOrderLineTotals(calculatedLines, total)) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.ORDER_LINE_TOTAL_MISMATCH,
      "Sum of calculated line totals does not equal document total (BR-ERP3-01).",
      "total",
    );
  }

  return {
    lines: calculatedLines,
    total,
  };
}

/**
 * FR-ERP3-05: Validates forward-only Sales Order status transitions using the
 * canonical `ALLOWED_ORDER_STATUS_TRANSITIONS` map from `@clearshift/contracts`.
 *
 * Note: `ALLOWED_ORDER_STATUS_TRANSITIONS` permits `Open -> Invoiced`, `Open -> Closed`,
 * and `Invoiced -> Closed`. If `allowDirectOpenToClosed` is set to `false`, only strict
 * sequential `Open -> Invoiced -> Closed` is permitted.
 */
export function assertValidOrderStatusTransition(
  currentStatus: SalesOrderStatus,
  targetStatus: SalesOrderStatus,
  options: { allowDirectOpenToClosed?: boolean } = {},
): void {
  const allowDirectOpenToClosed = options.allowDirectOpenToClosed ?? true;
  const baseAllowed = ALLOWED_ORDER_STATUS_TRANSITIONS[currentStatus] ?? [];
  const allowed =
    currentStatus === "Open" && !allowDirectOpenToClosed
      ? baseAllowed.filter((s) => s !== "Closed")
      : baseAllowed;

  if (!allowed.includes(targetStatus)) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVALID_ORDER_STATUS_TRANSITION,
      `Cannot transition sales order from '${currentStatus}' to '${targetStatus}'.`,
      "status",
      { currentStatus, targetStatus, allowed },
    );
  }
}

/**
 * FR-ERP3-02: Validates invoice date and mandatory `due_date`.
 * Rejects `due_date < invoice_date`.
 */
export function assertValidInvoiceDates(
  invoiceDate: string,
  dueDate: string,
): void {
  if (!dueDate || dueDate.trim().length === 0) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVALID_DUE_DATE,
      "Invoice due_date is required for overdue determination (FR-ERP3-02).",
      "due_date",
    );
  }
  if (dueDate < invoiceDate) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVALID_DUE_DATE,
      `Invoice due_date ('${dueDate}') cannot be earlier than invoice_date ('${invoiceDate}').`,
      "due_date",
      { invoice_date: invoiceDate, due_date: dueDate },
    );
  }
}

/**
 * FR-ERP3-02 & FR-ERP3-04: Derives canonical invoice status (`Open` | `Paid` | `Overdue`)
 * using the canonical helper from `@clearshift/contracts`.
 */
export function resolveInvoiceStatus(
  invoiceTotal: string,
  totalPaid: string,
  dueDate: string,
  nowUtcDateString?: string,
): InvoiceStatus {
  return deriveInvoiceStatus(
    invoiceTotal,
    totalPaid,
    dueDate,
    nowUtcDateString,
  );
}

/**
 * FR-ERP3-03 & FR-ERP3-04: Enforces V1 payment settlement rules:
 *   1. Payments against an already-Paid invoice are rejected (`INVOICE_ALREADY_PAID`).
 *   2. Overpayments (`existingPaid + amount > invoiceTotal`) are rejected (`PAYMENT_EXCEEDS_INVOICE_TOTAL`).
 *   3. Partial payments (`existingPaid + amount < invoiceTotal`) are rejected in V1 (`PARTIAL_PAYMENT_NOT_ALLOWED`).
 *   4. When `existingPaid + amount == invoiceTotal`, returns the new total paid and derived status `"Paid"`.
 */
export function assertValidFullPayment(params: {
  invoiceStatus: InvoiceStatus;
  invoiceTotal: string;
  existingPaidTotal: string;
  paymentAmount: string;
}): {
  newPaidTotal: string;
  nextInvoiceStatus: InvoiceStatus;
} {
  const { invoiceStatus, invoiceTotal, existingPaidTotal, paymentAmount } =
    params;

  const totalScaled = parseScaledDecimal4Dp(invoiceTotal);
  const existingScaled = parseScaledDecimal4Dp(existingPaidTotal);
  const amountScaled = parseScaledDecimal4Dp(paymentAmount);

  if (invoiceStatus === "Paid" || existingScaled >= totalScaled) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVOICE_ALREADY_PAID,
      "Invoice is already paid. No further payments are accepted.",
      "invoice_id",
      { invoice_total: invoiceTotal, paid_total: existingPaidTotal },
    );
  }

  if (amountScaled <= 0n) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.INVALID_LINE_AMOUNT,
      "Payment amount must be greater than zero.",
      "amount",
    );
  }

  const newPaidScaled = existingScaled + amountScaled;

  if (newPaidScaled > totalScaled) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.PAYMENT_EXCEEDS_INVOICE_TOTAL,
      "Payment amount would exceed the invoice total.",
      "amount",
      {
        invoice_total: invoiceTotal,
        existing_paid: existingPaidTotal,
        attempted_amount: paymentAmount,
      },
    );
  }

  if (newPaidScaled < totalScaled) {
    throw new Erp3DomainError(
      ERP3_DOMAIN_ERROR_CODES.PARTIAL_PAYMENT_NOT_ALLOWED,
      "V1 requires a single full payment equal to the invoice total; partial payments are not supported.",
      "amount",
      {
        invoice_total: invoiceTotal,
        attempted_amount: paymentAmount,
      },
    );
  }

  return {
    newPaidTotal: formatScaledDecimal4Dp(newPaidScaled),
    nextInvoiceStatus: "Paid",
  };
}
