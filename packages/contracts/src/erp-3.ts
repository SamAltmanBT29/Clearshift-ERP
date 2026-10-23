/**
 * ERP-3 Sales Orders & Invoices — Public API Contract Types
 *
 * These Zod schemas are the single source of truth for:
 *   - Request/response validation (Fastify + Zod)
 *   - OpenAPI spec generation
 *   - TypeScript type inference (no separate type files needed)
 *
 * Module API base: /api/v1/erp-orders
 *
 * Traceability:
 *   - SDS ClearShift ERP v2.0 §4.4 (FR-ERP3-01..05, BR-ERP3-01..03), §4.7, §4.8
 *   - V1_30_ISSUE_STANDARDIZATION_PLAN §8 (ERP-3/Group 8 overlay)
 *   - ADR-002: Shared Zod/OpenAPI Contract & Error Envelope
 *   - ADR-003: Hub Golden ID (customer_golden_id is a UUID, not a display GID)
 *   - Issue #150 ([ERP3-14])
 *
 * ⚠️  DECISION RECORD SUMMARY (see ADR-005):
 *   - DR-1 (Unresolved — Pending Integration Lead Confirmation):
 *     SDS §3.2 mandates numeric(19,4) storage and Master Architecture Spec Decision M2 +
 *     @cs/core Money specify ROUND_HALF_UP to currency exponent scale (2 dp for INR/USD,
 *     padded to .toFixed(4) for storage), whereas SDS §4.4 BR-ERP3-02 states "Tax per line =
 *     line amount multiplied by the product tax rate, rounded to 2 decimals." MoneyAmount
 *     (up to 4 dp) is used for all stored amounts, and the mock performs exact 4-dp arithmetic
 *     (returning 422 DR1_ROUNDING_UNRESOLVED on sub-4-dp fractions) until the Integration Lead
 *     confirms whether intermediate line_amount and tax_amount round at 2 dp (padded to 4 dp)
 *     or 4 dp.
 *   - DR-2 (Resolved by Authoritative Hierarchy — Mandatory):
 *     Invoice due_date is mandatory per V1_30_ISSUE_STANDARDIZATION_PLAN.md §8 ("due date is
 *     mandatory for overdue calculation") and CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md §5c ERD
 *     (ERP3_INVOICES.due_date), which supersede its omission from the SDS §4.7 table under
 *     Master Spec Decision C1 ("Std Plan wins on conflict").
 *   - DR-3 (Resolved by Authoritative Hierarchy — Flagged for Gate G1 Sign-Off):
 *     GET /sales-orders/{id} and GET /invoices/{id} are required by V1_30_ISSUE_STANDARDIZATION_PLAN.md
 *     §7 Slot 04 (Detail/read API) and Master Spec §6.1 / Decision H1, though omitted from the
 *     SDS §4.8 summary table.
 *
 * @module contracts/erp-3
 */

import { z } from "zod";
import { CurrencyCode, UuidSchema, MoneyAmount } from "./erp-4.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared Primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Valid calendar date in YYYY-MM-DD format. */
export const Erp3IsoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date in YYYY-MM-DD format")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(`${value}T00:00:00.000Z`);

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === day
    );
  }, "Must be a valid calendar date");

/** Tax rate: non-negative decimal percentage string, up to 4 dp (e.g. "18.0000" = 18%). */
export const TaxRateAmount = z
  .string()
  .regex(
    /^\d+(\.\d{1,4})?$/,
    "Tax rate must be a non-negative decimal string with up to 4 decimal places",
  );

// ─────────────────────────────────────────────────────────────────────────────
// Enum Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sales order lifecycle status.
 * FR-ERP3-05: Open / Invoiced / Closed.
 * Transitions are strictly forward-only: Open -> Invoiced -> Closed.
 */
export const SalesOrderStatusEnum = z.enum(["Open", "Invoiced", "Closed"]);
export type SalesOrderStatus = z.infer<typeof SalesOrderStatusEnum>;

/**
 * Invoice status.
 * FR-ERP3-02: Open / Paid / Overdue.
 * FR-ERP3-04: Auto-transitions to Paid when SUM(payments) == invoice.total.
 */
export const InvoiceStatusEnum = z.enum(["Open", "Paid", "Overdue"]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusEnum>;

/**
 * Payment method.
 * FR-ERP3-03: cash / bank / card.
 */
export const PaymentMethodEnum = z.enum(["cash", "bank", "card"]);
export type PaymentMethod = z.infer<typeof PaymentMethodEnum>;

// ─────────────────────────────────────────────────────────────────────────────
// Common Param Schema
// ─────────────────────────────────────────────────────────────────────────────

/** Common URL path id parameter. */
export const Erp3IdParamSchema = z.object({
  id: UuidSchema,
});
export type Erp3IdParam = z.infer<typeof Erp3IdParamSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Sales Order Line Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Response shape for a single Sales Order Line.
 * SDS §4.7 erp3_so_lines: id, order_id, product_id, quantity, price, tax_rate, line_total
 *
 * ⚠️ DR-1: tax_amount is server-computed from price × tax_rate. Rounding rule unresolved.
 */
export const SalesOrderLineSchema = z.object({
  id: UuidSchema,
  order_id: UuidSchema,
  /** UUID reference to ERP-1 product. Never stored or mutated locally. */
  product_id: UuidSchema,
  /** Quantity as string-encoded decimal (up to 4 dp). */
  quantity: MoneyAmount,
  /** Unit price as string-encoded decimal (up to 4 dp). */
  price: MoneyAmount,
  /** Tax rate percentage as string-encoded decimal (e.g. "18.0000"). */
  tax_rate: TaxRateAmount,
  /**
   * Server-computed tax amount (price × quantity × tax_rate ÷ 100).
   * ⚠️ DR-1: Rounding rule not confirmed — stored as 4 dp string pending specification.
   */
  tax_amount: MoneyAmount,
  /**
   * Server-computed line total (price × quantity + tax_amount).
   * BR-ERP3-01 enforces that SUM(line_total) == order.total.
   * ⚠️ DR-1: Rounding rule not confirmed.
   */
  line_total: MoneyAmount,
  created_at: z.string().datetime(),
});
export type SalesOrderLine = z.infer<typeof SalesOrderLineSchema>;

/**
 * One line in a CreateSalesOrderRequest.
 * Clients provide product_id, quantity, price, and tax_rate.
 * Server computes tax_amount and line_total.
 */
export const CreateSalesOrderLineRequestSchema = z.object({
  product_id: UuidSchema,
  quantity: z
    .string()
    .regex(
      /^\d+(\.\d{1,4})?$/,
      "quantity must be a positive decimal string with up to 4 decimal places",
    )
    .refine((v) => Number(v) > 0, {
      message: "quantity must be greater than zero",
    }),
  price: MoneyAmount,
  /** Tax rate percentage as string-encoded decimal (e.g. "18.0000" = 18%). */
  tax_rate: TaxRateAmount,
});
export type CreateSalesOrderLineRequest = z.infer<
  typeof CreateSalesOrderLineRequestSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// Sales Order Schemas
// GET  /api/v1/erp-orders/sales-orders
// POST /api/v1/erp-orders/sales-orders
// GET  /api/v1/erp-orders/sales-orders/{id}    ⚠️ Implied — not in SDS §4.8 table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Response shape for a Sales Order with embedded lines.
 * SDS §4.7 erp3_sales_orders: id, order_number, customer_golden_id, order_date, status, total
 */
export const SalesOrderSchema = z.object({
  id: UuidSchema,
  /** Human-readable order number. Unique per BR-ERP3-01 (duplicate order number is rejected). */
  order_number: z.string().min(1).max(64),
  /**
   * Customer Golden ID (UUID). References Hub Identity / CRM-1 customer.
   * BR-ERP3-03: mandatory — an order without a customer is rejected.
   * ADR-003: This is the UUID PK, not the display GID string.
   */
  customer_golden_id: UuidSchema,
  order_date: Erp3IsoDateString,
  status: SalesOrderStatusEnum,
  currency: CurrencyCode,
  /**
   * Server-computed order total. Must equal SUM(line.line_total) per BR-ERP3-01.
   * ⚠️ DR-1: Rounding rule for total not confirmed.
   */
  total: MoneyAmount,
  lines: z.array(SalesOrderLineSchema),
  source_system: z.string().max(64).nullable(),
  source_id: z.string().max(128).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type SalesOrder = z.infer<typeof SalesOrderSchema>;

/**
 * POST /api/v1/erp-orders/sales-orders — request body.
 *
 * BR-ERP3-01: SUM(line_total submitted or implied) == total.
 * Since line_total is server-computed (server multiplies price × qty + tax),
 * the schema refine on create cannot verify this at request time without
 * the tax calculation. The refine below validates the client-supplied total
 * only when explicitly provided — server remains authoritative.
 *
 * ⚠️ DR-1: Rounding rule unresolved. Refine is intentionally absent for
 * line arithmetic. The mock enforces a deterministic check using raw integer
 * comparison at 4 dp precision.
 */
export const CreateSalesOrderRequestSchema = z.object({
  order_number: z.string().min(1).max(64).optional(),
  /** BR-ERP3-03: mandatory. */
  customer_golden_id: UuidSchema,
  order_date: Erp3IsoDateString,
  currency: CurrencyCode,
  lines: z
    .array(CreateSalesOrderLineRequestSchema)
    .min(1, "A sales order must contain at least one line"),
  source_system: z.string().max(64).optional().nullable(),
  source_id: z.string().max(128).optional().nullable(),
  idempotency_key: z.string().max(128).optional().nullable(),
  batch_id: UuidSchema.optional().nullable(),
  source_row: z.number().int().nonnegative().optional().nullable(),
});
export type CreateSalesOrderRequest = z.infer<
  typeof CreateSalesOrderRequestSchema
>;

/**
 * PATCH /api/v1/erp-orders/sales-orders/{id} — status transition only.
 * FR-ERP3-05: Open -> Invoiced -> Closed (forward-only FSM).
 */
export const UpdateSalesOrderStatusRequestSchema = z.object({
  status: SalesOrderStatusEnum,
});
export type UpdateSalesOrderStatusRequest = z.infer<
  typeof UpdateSalesOrderStatusRequestSchema
>;

/** GET /api/v1/erp-orders/sales-orders — query parameters. */
export const SalesOrderListQuerySchema = z.object({
  page: z.coerce
    .number()
    .int({ message: "page must be an integer" })
    .min(1, "page must be >= 1")
    .default(1),
  pageSize: z.coerce
    .number()
    .int({ message: "pageSize must be an integer" })
    .min(1, "pageSize must be >= 1")
    .max(100, "pageSize cannot exceed 100")
    .default(20),
  search: z.string().trim().max(100).optional(),
  status: SalesOrderStatusEnum.optional(),
  customer_golden_id: UuidSchema.optional(),
  currency: CurrencyCode.optional(),
  from_date: Erp3IsoDateString.optional(),
  to_date: Erp3IsoDateString.optional(),
});
export type SalesOrderListQuery = z.infer<typeof SalesOrderListQuerySchema>;

/** GET /api/v1/erp-orders/sales-orders — paginated response. */
export const SalesOrderListResponseSchema = z.object({
  data: z.array(SalesOrderSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type SalesOrderListResponse = z.infer<
  typeof SalesOrderListResponseSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// Invoice Line Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Response shape for a single Invoice Line.
 * Invoice lines mirror order lines for FR-ERP3-02 (invoice has lines, total).
 *
 * ⚠️ DR-1: tax_amount rounding rule unresolved.
 */
export const InvoiceLineSchema = z.object({
  id: UuidSchema,
  invoice_id: UuidSchema,
  product_id: UuidSchema,
  quantity: MoneyAmount,
  price: MoneyAmount,
  tax_rate: TaxRateAmount,
  /** ⚠️ DR-1: Rounding rule not confirmed. */
  tax_amount: MoneyAmount,
  /** Server-computed line total. */
  line_total: MoneyAmount,
  created_at: z.string().datetime(),
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

/** One line in CreateInvoiceRequest. */
export const CreateInvoiceLineRequestSchema = z.object({
  product_id: UuidSchema,
  quantity: z
    .string()
    .regex(
      /^\d+(\.\d{1,4})?$/,
      "quantity must be a positive decimal string with up to 4 decimal places",
    )
    .refine((v) => Number(v) > 0, {
      message: "quantity must be greater than zero",
    }),
  price: MoneyAmount,
  tax_rate: TaxRateAmount,
});
export type CreateInvoiceLineRequest = z.infer<
  typeof CreateInvoiceLineRequestSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// Invoice Schemas
// GET  /api/v1/erp-orders/invoices
// POST /api/v1/erp-orders/invoices
// GET  /api/v1/erp-orders/invoices/{id}    ⚠️ Implied — not in SDS §4.8 table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Response shape for an Invoice.
 * SDS §4.7 erp3_invoices: id, invoice_number, order_id, customer_golden_id, invoice_date, total, status
 *
 * Additional fields:
 *   - due_date: V1_30 plan states "due date is mandatory for overdue calculation."
 *   - lines: embedded for detail responses.
 */
export const InvoiceSchema = z.object({
  id: UuidSchema,
  /** Human-readable invoice number. Unique — duplicate is rejected. */
  invoice_number: z.string().min(1).max(64),
  /** Links to the originating sales order. Nullable to allow invoices without an order (migration scenario). */
  order_id: UuidSchema.nullable(),
  customer_golden_id: UuidSchema,
  invoice_date: Erp3IsoDateString,
  /**
   * Due date. Mandatory per V1_30 plan: "due date is mandatory for overdue calculation."
   * ⚠️ Not listed in SDS §4.7 erp3_invoices table — included based on V1_30 plan rule.
   */
  due_date: Erp3IsoDateString,
  status: InvoiceStatusEnum,
  currency: CurrencyCode,
  /** Server-computed total. Must equal SUM(line.line_total). ⚠️ DR-1: Rounding rule unresolved. */
  total: MoneyAmount,
  lines: z.array(InvoiceLineSchema),
  source_system: z.string().max(64).nullable(),
  source_id: z.string().max(128).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

/** POST /api/v1/erp-orders/invoices — request body. */
export const CreateInvoiceRequestSchema = z.object({
  invoice_number: z.string().min(1).max(64).optional(),
  /** Links to an existing sales order. Optional to allow standalone invoices in migration. */
  order_id: UuidSchema.optional().nullable(),
  customer_golden_id: UuidSchema,
  invoice_date: Erp3IsoDateString,
  /**
   * Due date. Mandatory per V1_30 plan.
   */
  due_date: Erp3IsoDateString,
  currency: CurrencyCode,
  lines: z
    .array(CreateInvoiceLineRequestSchema)
    .min(1, "An invoice must contain at least one line"),
  source_system: z.string().max(64).optional().nullable(),
  source_id: z.string().max(128).optional().nullable(),
  idempotency_key: z.string().max(128).optional().nullable(),
  batch_id: UuidSchema.optional().nullable(),
  source_row: z.number().int().nonnegative().optional().nullable(),
});
export type CreateInvoiceRequest = z.infer<typeof CreateInvoiceRequestSchema>;

/** GET /api/v1/erp-orders/invoices — query parameters. */
export const InvoiceListQuerySchema = z.object({
  page: z.coerce
    .number()
    .int({ message: "page must be an integer" })
    .min(1, "page must be >= 1")
    .default(1),
  pageSize: z.coerce
    .number()
    .int({ message: "pageSize must be an integer" })
    .min(1, "pageSize must be >= 1")
    .max(100, "pageSize cannot exceed 100")
    .default(20),
  search: z.string().trim().max(100).optional(),
  status: InvoiceStatusEnum.optional(),
  customer_golden_id: UuidSchema.optional(),
  order_id: UuidSchema.optional(),
  currency: CurrencyCode.optional(),
  from_date: Erp3IsoDateString.optional(),
  to_date: Erp3IsoDateString.optional(),
});
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;

/** GET /api/v1/erp-orders/invoices — paginated response. */
export const InvoiceListResponseSchema = z.object({
  data: z.array(InvoiceSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type InvoiceListResponse = z.infer<typeof InvoiceListResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Payment Schemas
// POST /api/v1/erp-orders/payments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Response shape for a Payment record.
 * SDS §4.7 erp3_payments: id, invoice_id, amount, paid_at, method
 */
export const PaymentSchema = z.object({
  id: UuidSchema,
  invoice_id: UuidSchema,
  amount: MoneyAmount,
  paid_at: z.string().datetime(),
  method: PaymentMethodEnum,
  created_at: z.string().datetime(),
});
export type Payment = z.infer<typeof PaymentSchema>;

/**
 * POST /api/v1/erp-orders/payments — request body.
 * FR-ERP3-03: invoice link, amount, date, method (cash / bank / card).
 * FR-ERP3-04: When SUM(payments) >= invoice.total, invoice becomes Paid automatically (server-side).
 */
export const CreatePaymentRequestSchema = z.object({
  invoice_id: UuidSchema,
  amount: MoneyAmount.refine((v) => Number(v) > 0, {
    message: "amount must be greater than zero",
  }),
  paid_at: z.string().datetime().optional(),
  method: PaymentMethodEnum,
  idempotency_key: z.string().max(128).optional().nullable(),
  batch_id: UuidSchema.optional().nullable(),
  source_row: z.number().int().nonnegative().optional().nullable(),
});
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Domain Error Codes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ERP-3 relationship and domain error codes.
 * These are returned in the `code` field of the standard error envelope (ADR-002).
 */
export const ERP3_RELATIONSHIP_ERROR_CODES = {
  // Sales Order errors
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  ORDER_NUMBER_EXISTS: "ORDER_NUMBER_EXISTS",
  INVALID_ORDER_STATUS_TRANSITION: "INVALID_ORDER_STATUS_TRANSITION",
  ORDER_LINE_TOTAL_MISMATCH: "ORDER_LINE_TOTAL_MISMATCH",
  MISSING_CUSTOMER_GOLDEN_ID: "MISSING_CUSTOMER_GOLDEN_ID",
  // Invoice errors
  INVOICE_NOT_FOUND: "INVOICE_NOT_FOUND",
  INVOICE_NUMBER_EXISTS: "INVOICE_NUMBER_EXISTS",
  INVOICE_ALREADY_PAID: "INVOICE_ALREADY_PAID",
  INVOICE_LINE_TOTAL_MISMATCH: "INVOICE_LINE_TOTAL_MISMATCH",
  // Payment errors
  PAYMENT_NOT_FOUND: "PAYMENT_NOT_FOUND",
  PAYMENT_EXCEEDS_INVOICE_TOTAL: "PAYMENT_EXCEEDS_INVOICE_TOTAL",
  // Cross-module reference errors
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  CUSTOMER_NOT_FOUND: "CUSTOMER_NOT_FOUND",
  ORDER_REF_NOT_FOUND: "ORDER_REF_NOT_FOUND",
  // Generic
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  MISSING_REQUIRED_REFERENCE: "MISSING_REQUIRED_REFERENCE",
  INVALID_REFERENCE: "INVALID_REFERENCE",
} as const;

export type Erp3RelationshipErrorCode =
  (typeof ERP3_RELATIONSHIP_ERROR_CODES)[keyof typeof ERP3_RELATIONSHIP_ERROR_CODES];

// ─────────────────────────────────────────────────────────────────────────────
// Shared Error Response (mirrors ERP-4 ApiErrorSchema)
// ─────────────────────────────────────────────────────────────────────────────

export const Erp3ApiErrorSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  code: z.string().optional(),
  message: z.string(),
  details: z.array(z.unknown()).optional(),
  correlation_id: z.string().optional(),
});
export type Erp3ApiError = z.infer<typeof Erp3ApiErrorSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Schema & Type Aliases (for ERP-3 Web / Downstream Consumers)
// Strictly point to canonical snake_case / UUID / TitleCase schemas.
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical ISO 4217 currency code schema alias. */
export const OrdersCurrencyCode = CurrencyCode;

/** Canonical UUID schema alias. */
export const OrdersUuid = UuidSchema;

/** Canonical monetary amount schema alias (up to 4 dp). */
export const OrdersMoneyAmount = MoneyAmount;

/**
 * Customer Golden ID schema (ADR-003).
 * Strictly validates a canonical UUID v4 reference to hub_golden_records.golden_id.
 * Non-UUID display strings (such as `gid-*`) are rejected.
 */
export const CustomerGoldenIdSchema = UuidSchema;

export const CreateSalesOrderLineInputSchema = CreateSalesOrderLineRequestSchema;
export type CreateSalesOrderLineInput = CreateSalesOrderLineRequest;

export const CreateSalesOrderInputSchema = CreateSalesOrderRequestSchema;
export type CreateSalesOrderInput = CreateSalesOrderRequest;

export const UpdateSalesOrderStatusInputSchema =
  UpdateSalesOrderStatusRequestSchema;
export type UpdateSalesOrderStatusInput = UpdateSalesOrderStatusRequest;

export const SalesOrdersFilterQuerySchema = SalesOrderListQuerySchema;
export type SalesOrdersFilterQuery = SalesOrderListQuery;

export const PaginatedSalesOrdersResponseSchema = SalesOrderListResponseSchema;
export type PaginatedSalesOrdersResponse = SalesOrderListResponse;

export const CreateInvoiceInputSchema = CreateInvoiceRequestSchema;
export type CreateInvoiceInput = CreateInvoiceRequest;

export const InvoicesFilterQuerySchema = InvoiceListQuerySchema;
export type InvoicesFilterQuery = InvoiceListQuery;

export const PaginatedInvoicesResponseSchema = InvoiceListResponseSchema;
export type PaginatedInvoicesResponse = InvoiceListResponse;

export const CreatePaymentInputSchema = CreatePaymentRequestSchema;
export type CreatePaymentInput = CreatePaymentRequest;

// ─────────────────────────────────────────────────────────────────────────────
// Domain Invariant Calculations & Helpers (Canonical Contract)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Forward-only Sales Order status transitions (FR-ERP3-05).
 * Open -> Invoiced -> Closed (or Open -> Closed).
 * ⚠️ Note: PATCH /sales-orders/{id} is not part of the 7-route OpenAPI/mock baseline (DR-3).
 */
export const ALLOWED_ORDER_STATUS_TRANSITIONS: Record<
  SalesOrderStatus,
  readonly SalesOrderStatus[]
> = {
  Open: ["Invoiced", "Closed"],
  Invoiced: ["Closed"],
  Closed: [],
};

const HELPER_SCALE = 10_000n;

function parseScaled4Dp(value: string | number): bigint {
  const normalized = String(value).trim();
  const [intPart = "0", fracPart = ""] = normalized.split(".");
  const sign = intPart.startsWith("-") ? -1n : 1n;
  const cleanInt = intPart.replace(/^[+-]/, "") || "0";
  const paddedFrac = (fracPart + "0000").slice(0, 4);
  return sign * (BigInt(cleanInt) * HELPER_SCALE + BigInt(paddedFrac));
}

function formatScaled4Dp(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const intPart = abs / HELPER_SCALE;
  const fracPart = (abs % HELPER_SCALE).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${intPart}.${fracPart}`;
}

function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n >= denominator) {
    return quotient + 1n;
  }
  return quotient;
}

/**
 * Calculates line subtotal, tax_amount, and line_total from canonical inputs:
 * - `quantity`: positive decimal string or number (up to 4 dp)
 * - `price`: unit price decimal string (up to 4 dp)
 * - `tax_rate`: percentage string (e.g. `"18.0000"` = 18%, `"10.0000"` = 10%)
 *
 * Returns 4-dp monetary strings (`subtotal`, `tax_amount`, `line_total`).
 *
 * ⚠️ DR-1 (Pending Integration Lead Confirmation):
 * SDS §3.2 mandates `numeric(19,4)` storage while SDS §4.4 `BR-ERP3-02` states
 * "rounded to 2 decimals". Until DR-1 is ratified, the mock server enforces exact
 * 4-dp arithmetic (returning `422 DR1_ROUNDING_UNRESOLVED` on sub-4-dp remainders),
 * whereas this UI/domain helper formats to 4 dp using HALF_UP at 4-dp scale.
 */
export function calculateLineAmounts(
  quantity: string | number,
  price: string,
  tax_rate: string,
): { subtotal: string; tax_amount: string; line_total: string } {
  const qtyScaled = parseScaled4Dp(quantity);
  const priceScaled = parseScaled4Dp(price);
  const rateScaled = parseScaled4Dp(tax_rate);

  const subtotalScaled = roundHalfUpDiv(qtyScaled * priceScaled, HELPER_SCALE);
  const taxScaled = roundHalfUpDiv(
    subtotalScaled * rateScaled,
    HELPER_SCALE * 100n,
  );
  const totalScaled = subtotalScaled + taxScaled;

  return {
    subtotal: formatScaled4Dp(subtotalScaled),
    tax_amount: formatScaled4Dp(taxScaled),
    line_total: formatScaled4Dp(totalScaled),
  };
}

/**
 * Validates that `SUM(line.line_total) == orderTotal` at 4-dp precision (BR-ERP3-01).
 */
export function validateOrderLineTotals(
  lines: ReadonlyArray<{ line_total: string }>,
  orderTotal: string,
): boolean {
  const sumScaled = lines.reduce(
    (acc, line) => acc + parseScaled4Dp(line.line_total),
    0n,
  );
  return sumScaled === parseScaled4Dp(orderTotal);
}

/**
 * Derives canonical InvoiceStatus (`"Open" | "Paid" | "Overdue"`) per FR-ERP3-02 / FR-ERP3-04:
 * - `"Paid"` when `totalPaid >= invoiceTotal` (and `invoiceTotal > 0`)
 * - `"Overdue"` when unpaid and `nowUtcDateString > dueDate`
 * - `"Open"` otherwise
 */
export function deriveInvoiceStatus(
  invoiceTotal: string,
  totalPaid: string,
  dueDate: string,
  nowUtcDateString: string = new Date().toISOString().slice(0, 10),
): InvoiceStatus {
  const totalScaled = parseScaled4Dp(invoiceTotal);
  const paidScaled = parseScaled4Dp(totalPaid);

  if (paidScaled >= totalScaled && totalScaled > 0n) {
    return "Paid";
  }

  if (nowUtcDateString > dueDate) {
    return "Overdue";
  }

  return "Open";
}
