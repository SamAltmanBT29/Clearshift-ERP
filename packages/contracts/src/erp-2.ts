/**
 * ERP-2 Vendors and Purchasing — Public API Contract Types
 *
 * These Zod schemas are the single source of truth for:
 *   - Request/response validation (Fastify + Zod)
 *   - OpenAPI 3.1 specification generation
 *   - TypeScript type inference (no duplicate interface drift)
 *
 * Module API base: /api/v1/erp-vendors
 * Schema owner: ERP-2 (Group 7).
 * Error envelope: shared { code, message, details, correlation_id } owned by @cs/kernel.
 *
 * Traceability:
 *   - SDS ClearShift ERP v2.0 §4.3 (FR-ERP2-01..06, BR-ERP2-01)
 *   - SDS ClearShift ERP v2.0 §4.7 (erp2_vendors, erp2_purchase_orders, erp2_po_lines)
 *   - Master Architecture Spec §6.1 slot 01, Decision C7 (intra-module FKs only)
 *
 * @module contracts/erp-2
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

/** UUID primary key. */
export const VendorUuid = z.string().uuid('Must be a valid UUID');

/** ISO 4217 currency code — exactly 3 uppercase ASCII letters. */
export const VendorCurrencyCode = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 currency code (e.g. INR, USD, EUR)');

/** Calendar date — YYYY-MM-DD. */
export const VendorIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

/**
 * Monetary amount: non-negative string-encoded decimal with up to 2 decimal places.
 * Used for price, line_total, and purchase order total.
 */
export const VendorMoneyAmount = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a non-negative decimal with up to 2 decimal places');

/**
 * Quantity: positive string-encoded decimal with up to 4 decimal places, > 0.
 */
export const VendorQuantity = z
  .string()
  .regex(/^(?!0(\.0+)?$)\d+(\.\d{1,4})?$/, 'Quantity must be greater than 0 with up to 4 decimal places');

/** Purchase order number: e.g. "PO-2026-0001". */
export const PoNumberSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'PO number may contain letters, digits, hyphen and underscore only');

/** Tax number: e.g. "GSTIN-27AAAAA0000A1Z5". */
export const TaxNumberSchema = z
  .string()
  .min(1)
  .max(64)
  .trim();

/** Bank detail mask format: XXXX-XXXX-7890 (FR-ERP2-06). */
export const BankMaskedSchema = z
  .string()
  .regex(/^XXXX-XXXX-\d{4}$/, 'Bank details must be masked in XXXX-XXXX-7890 format');

/** Default currency applied when not supplied. */
export const VENDOR_DEFAULT_CURRENCY = 'INR';

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle Enums & Status Machine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Purchase Order Status Lifecycle (FR-ERP2-04).
 * Allowed V1 flow: draft -> sent -> received -> closed.
 * Backwards transitions and cancellations are rejected in V1.
 */
export const PurchaseOrderStatusEnum = z.enum([
  'draft',
  'sent',
  'received',
  'closed',
]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatusEnum>;

export const ALLOWED_PO_STATUS_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  draft: ['sent'],
  sent: ['received'],
  received: ['closed'],
  closed: [],
} as const;

/**
 * Checks if a status transition is permitted.
 */
export function isValidPoStatusTransition(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus
): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_PO_STATUS_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Asserts that a PO status transition is valid, or throws a domain error.
 */
export function assertValidPoStatusTransition(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus
): void {
  if (!isValidPoStatusTransition(from, to)) {
    throw new Error(
      `Invalid purchase order status transition from '${from}' to '${to}'. Allowed transitions: ${
        ALLOWED_PO_STATUS_TRANSITIONS[from]?.join(', ') || 'none (terminal state)'
      }`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bank Details Masking Helper (FR-ERP2-06)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Masks bank details so only the last 4 digits are visible, formatted as XXXX-XXXX-7890.
 * If input is already in XXXX-XXXX-#### format, preserves it.
 * If fewer than 4 digits exist, pads with zeroes.
 */
export function maskBankDetails(raw: string): string {
  const trimmed = raw.trim();
  if (/^XXXX-XXXX-\d{4}$/.test(trimmed)) {
    return trimmed;
  }
  const digits = trimmed.replace(/\D/g, '');
  const last4 = digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, '0');
  return `XXXX-XXXX-${last4}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixed-Precision Decimal Arithmetic Helpers (FR-ERP2-05)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses numeric amount to integer minor units (cents / paise) to prevent IEEE-754 drift.
 */
export function parseToCents(amount: string | number): bigint {
  const str = String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error(`Invalid monetary amount: ${amount}`);
  }
  const [whole = '0', fraction = ''] = str.split('.');
  const paddedFraction = fraction.padEnd(2, '0').slice(0, 2);
  return BigInt(whole) * 100n + BigInt(paddedFraction);
}

/**
 * Formats integer minor units back to 2dp string.
 */
export function formatFromCents(cents: bigint): string {
  if (cents < 0n) throw new Error('Monetary amount cannot be negative');
  const whole = cents / 100n;
  const fraction = cents % 100n;
  return `${whole}.${fraction.toString().padStart(2, '0')}`;
}

/**
 * Computes line_total = quantity * price (FR-ERP2-05).
 * Rounded to 2 decimal places.
 */
export function calculateLineTotal(quantity: string | number, price: string | number): string {
  const qNum = parseFloat(String(quantity));
  const pCents = parseToCents(price);
  if (isNaN(qNum) || qNum <= 0) {
    throw new Error(`Quantity must be greater than 0: ${quantity}`);
  }
  // Compute using BigInt with 4 decimal places scaling
  const qScaled = BigInt(Math.round(qNum * 10000));
  const totalCents = (qScaled * pCents + 5000n) / 10000n;
  return formatFromCents(totalCents);
}

/**
 * Computes order total by summing line_totals.
 */
export function calculateOrderTotal(
  lines: Array<{ quantity: string | number; price: string | number; line_total?: string }>
): string {
  let sumCents = 0n;
  for (const line of lines) {
    const lineTotalStr = line.line_total ?? calculateLineTotal(line.quantity, line.price);
    sumCents += parseToCents(lineTotalStr);
  }
  return formatFromCents(sumCents);
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain Rule Constants & Error Codes
// ─────────────────────────────────────────────────────────────────────────────

export const VENDOR_DOMAIN_RULES = {
  /** BR-ERP2-01: Purchase line must reference an existing product */
  PRODUCT_REQUIRED: 'ERP2_PRODUCT_REQUIRED',
  /** Tax number must be unique */
  TAX_NUMBER_DUPLICATE: 'ERP2_TAX_NUMBER_DUPLICATE',
  /** PO number must be unique */
  PO_NUMBER_DUPLICATE: 'ERP2_PO_NUMBER_DUPLICATE',
  /** Vendor reference required */
  VENDOR_REQUIRED: 'ERP2_VENDOR_REQUIRED',
  /** Invalid status transition */
  INVALID_STATUS_TRANSITION: 'ERP2_INVALID_STATUS_TRANSITION',
  /** Quantity must be greater than zero */
  QUANTITY_POSITIVE: 'ERP2_QUANTITY_POSITIVE',
  /** Price cannot be negative */
  PRICE_NON_NEGATIVE: 'ERP2_PRICE_NON_NEGATIVE',
  /** Bank details masking invariant */
  BANK_DETAILS_MASKED: 'ERP2_BANK_DETAILS_MASKED',
  /** Server-side total calculation mismatch */
  TOTAL_CALCULATION_MISMATCH: 'ERP2_TOTAL_CALCULATION_MISMATCH',
  /** Protected system fields cannot be modified */
  PROTECTED_FIELD: 'ERP2_PROTECTED_FIELD',
  /** Idempotency key conflict */
  IDEMPOTENCY_CONFLICT: 'ERP2_IDEMPOTENCY_CONFLICT',
} as const;

export type VendorDomainRule = (typeof VENDOR_DOMAIN_RULES)[keyof typeof VENDOR_DOMAIN_RULES];

// ─────────────────────────────────────────────────────────────────────────────
// Entity Schemas
// ─────────────────────────────────────────────────────────────────────────────

/** Vendor Entity (FR-ERP2-01..02). */
export const VendorSchema = z.object({
  id: VendorUuid,
  name: z.string().min(1).max(255),
  tax_number: TaxNumberSchema,
  email: z.string().email().nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  address_line: z.string().max(255).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  country: z.string().max(64).nullable().optional(),
  bank_masked: BankMaskedSchema.nullable().optional(),
  source_system: z.string().max(64).nullable().optional(),
  source_id: z.string().max(128).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Vendor = z.infer<typeof VendorSchema>;

/** Purchase Order Line Entity (FR-ERP2-03, BR-ERP2-01). */
export const PurchaseOrderLineSchema = z.object({
  id: VendorUuid,
  po_id: VendorUuid,
  product_id: VendorUuid, // Logical reference to ERP-1 product contract
  line_number: z.number().int().min(1),
  quantity: VendorQuantity,
  price: VendorMoneyAmount,
  line_total: VendorMoneyAmount,
  created_at: z.string(),
  updated_at: z.string(),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;

/** Purchase Order Entity with embedded Lines (FR-ERP2-03..05). */
export const PurchaseOrderSchema = z.object({
  id: VendorUuid,
  po_number: PoNumberSchema,
  vendor_id: VendorUuid,
  order_date: VendorIsoDate,
  status: PurchaseOrderStatusEnum,
  currency: VendorCurrencyCode,
  total: VendorMoneyAmount,
  notes: z.string().max(1000).nullable().optional(),
  source_system: z.string().max(64).nullable().optional(),
  source_id: z.string().max(128).nullable().optional(),
  lines: z.array(PurchaseOrderLineSchema).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Request & Response Schemas
// ─────────────────────────────────────────────────────────────────────────────

/** Create Vendor Request. */
export const CreateVendorRequestSchema = z
  .object({
    name: z.string().min(1, 'Vendor name is required').max(255),
    tax_number: TaxNumberSchema,
    email: z.string().email('Invalid email address').nullable().optional(),
    phone: z.string().max(64).nullable().optional(),
    address_line: z.string().max(255).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    country: z.string().max(64).nullable().optional(),
    bank_details: z.string().max(128).optional(), // Raw bank account, masked on save
    source_system: z.string().max(64).optional(),
    source_id: z.string().max(128).optional(),
  })
  .strict();
export type CreateVendorRequest = z.infer<typeof CreateVendorRequestSchema>;

/** Patch Vendor Request. */
export const PatchVendorRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    tax_number: TaxNumberSchema.optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().max(64).nullable().optional(),
    address_line: z.string().max(255).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    country: z.string().max(64).nullable().optional(),
    bank_details: z.string().max(128).optional(),
  })
  .strict();
export type PatchVendorRequest = z.infer<typeof PatchVendorRequestSchema>;

/** Create Purchase Order Line Item Input. */
export const CreatePoLineInputSchema = z
  .object({
    product_id: VendorUuid,
    quantity: VendorQuantity,
    price: VendorMoneyAmount,
  })
  .strict();
export type CreatePoLineInput = z.infer<typeof CreatePoLineInputSchema>;

/** Create Purchase Order Request. */
export const CreatePurchaseOrderRequestSchema = z
  .object({
    po_number: PoNumberSchema,
    vendor_id: VendorUuid,
    order_date: VendorIsoDate,
    currency: VendorCurrencyCode.default(VENDOR_DEFAULT_CURRENCY),
    notes: z.string().max(1000).optional(),
    lines: z.array(CreatePoLineInputSchema).min(1, 'At least one line item is required'),
    source_system: z.string().max(64).optional(),
    source_id: z.string().max(128).optional(),
  })
  .strict();
export type CreatePurchaseOrderRequest = z.infer<typeof CreatePurchaseOrderRequestSchema>;

/** Patch Purchase Order Request (Allowed status transition only in V1). */
export const PatchPurchaseOrderStatusRequestSchema = z
  .object({
    status: PurchaseOrderStatusEnum,
  })
  .strict();
export type PatchPurchaseOrderStatusRequest = z.infer<typeof PatchPurchaseOrderStatusRequestSchema>;

/** Vendor List Query. */
export const VendorListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
});
export type VendorListQuery = z.infer<typeof VendorListQuerySchema>;

/** Purchase Order List Query. */
export const PurchaseOrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  vendor_id: VendorUuid.optional(),
  status: PurchaseOrderStatusEnum.optional(),
  search: z.string().max(100).optional(),
});
export type PurchaseOrderListQuery = z.infer<typeof PurchaseOrderListQuerySchema>;
