/**
 * ERP-2 Vendors & Purchasing — Public API Contract Types
 *
 * These Zod schemas are the single source of truth for:
 *   - Request/response validation (Fastify + Zod)
 *   - OpenAPI spec generation and compliance
 *   - TypeScript type inference (no separate type files needed)
 *
 * Module API base: /api/v1/erp-vendors
 *
 * @module contracts/erp-2
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Shared Primitives & Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** ISO 4217 currency code — exactly 3 uppercase letters. */
export const CurrencyCode = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 currency code (e.g. USD, EUR, INR)');

/** UUID v4 format. */
export const UuidSchema = z.string().uuid('Must be a valid UUID v4');

/** Monetary amount: string-encoded decimal with exactly 2 or up to 4 decimal places. */
export const MoneyAmount = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a non-negative decimal with up to 4 decimal places');

/** Masked bank account pattern: XXXX-XXXX-7890 (or alphanumeric last 4). */
export const MaskedBankSchema = z
  .string()
  .regex(/^X{4}-X{4}-[A-Za-z0-9]{4}$/, 'Masked bank details must match pattern XXXX-XXXX-####');

/** Pagination page index: 1-based positive integer. */
export const PageSchema = z.coerce.number().int().min(1).default(1);

/** Pagination page size: between 1 and 100. */
export const PageSizeSchema = z.coerce.number().int().min(1).max(100).default(20);

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Purchase order lifecycle status.
 * FR-ERP2-04: Draft -> Sent -> Received -> Closed.
 */
export const PurchaseOrderStatusEnum = z.enum(['Draft', 'Sent', 'Received', 'Closed']);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatusEnum>;

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const VendorSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(255),
  tax_number: z.string().min(1).max(64),
  email: z.string().email(),
  phone: z.string().min(1).max(32),
  address_line: z.string().min(1).max(255),
  city: z.string().min(1).max(100),
  country: z.string().min(1).max(100),
  bank_masked: MaskedBankSchema,
  source_system: z.string().max(64).nullable().optional(),
  source_id: z.string().max(128).nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Vendor = z.infer<typeof VendorSchema>;

/** POST /api/v1/erp-vendors/vendors — create vendor */
export const CreateVendorRequestSchema = z.object({
  name: z.string().min(1).max(255),
  tax_number: z.string().min(1).max(64),
  email: z.string().email(),
  phone: z.string().min(1).max(32),
  address_line: z.string().min(1).max(255),
  city: z.string().min(1).max(100),
  country: z.string().min(1).max(100),
  // Bank details: raw or masked input; server always normalizes and masks to XXXX-XXXX-####
  bank_details: z.string().min(4).max(64).optional(),
  bank_masked: MaskedBankSchema.optional(),
  source_system: z.string().max(64).optional().nullable(),
  source_id: z.string().max(128).optional().nullable(),
  idempotency_key: z.string().max(128).optional().nullable(),
  batch_id: UuidSchema.optional().nullable(),
  source_row: z.number().int().nonnegative().optional().nullable(),
});
export type CreateVendorRequest = z.infer<typeof CreateVendorRequestSchema>;

/** PATCH /api/v1/erp-vendors/vendors/:id — edit vendor */
export const UpdateVendorRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  tax_number: z.string().min(1).max(64).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(1).max(32).optional(),
  address_line: z.string().min(1).max(255).optional(),
  city: z.string().min(1).max(100).optional(),
  country: z.string().min(1).max(100).optional(),
  bank_details: z.string().min(4).max(64).optional(),
  bank_masked: MaskedBankSchema.optional(),
});
export type UpdateVendorRequest = z.infer<typeof UpdateVendorRequestSchema>;

/** GET /api/v1/erp-vendors/vendors query params */
export const VendorListQuerySchema = z.object({
  search: z.string().max(255).optional(),
  page: PageSchema,
  pageSize: PageSizeSchema,
});
export type VendorListQuery = z.infer<typeof VendorListQuerySchema>;

/** GET /api/v1/erp-vendors/vendors response */
export const VendorListResponseSchema = z.object({
  items: z.array(VendorSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  hasMore: z.boolean(),
});
export type VendorListResponse = z.infer<typeof VendorListResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Purchase Order Line Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const PurchaseOrderLineSchema = z.object({
  id: UuidSchema,
  po_id: UuidSchema,
  product_id: UuidSchema,
  quantity: z.number().positive(),
  price: MoneyAmount,
  line_total: MoneyAmount,
  created_at: z.string().datetime(),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;

export const CreatePurchaseOrderLineRequestSchema = z.object({
  product_id: UuidSchema,
  quantity: z.number().positive('Quantity must be greater than 0'),
  price: MoneyAmount,
});
export type CreatePurchaseOrderLineRequest = z.infer<typeof CreatePurchaseOrderLineRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Purchase Order Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const PurchaseOrderSchema = z.object({
  id: UuidSchema,
  po_number: z.string().min(1).max(64),
  vendor_id: UuidSchema,
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  status: PurchaseOrderStatusEnum,
  currency_code: CurrencyCode,
  total: MoneyAmount,
  lines: z.array(PurchaseOrderLineSchema),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

/** POST /api/v1/erp-vendors/purchase-orders — create PO */
export const CreatePurchaseOrderRequestSchema = z.object({
  vendor_id: UuidSchema,
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  currency_code: CurrencyCode.default('USD'),
  lines: z.array(CreatePurchaseOrderLineRequestSchema).min(1, 'Purchase order must have at least one line'),
  idempotency_key: z.string().max(128).optional().nullable(),
  batch_id: UuidSchema.optional().nullable(),
  source_row: z.number().int().nonnegative().optional().nullable(),
});
export type CreatePurchaseOrderRequest = z.infer<typeof CreatePurchaseOrderRequestSchema>;

/** PATCH /api/v1/erp-vendors/purchase-orders/:id — status transition only */
export const UpdatePurchaseOrderStatusRequestSchema = z.object({
  status: PurchaseOrderStatusEnum,
});
export type UpdatePurchaseOrderStatusRequest = z.infer<typeof UpdatePurchaseOrderStatusRequestSchema>;

/** GET /api/v1/erp-vendors/purchase-orders query params */
export const PurchaseOrderListQuerySchema = z.object({
  vendor_id: UuidSchema.optional(),
  status: PurchaseOrderStatusEnum.optional(),
  page: PageSchema,
  pageSize: PageSizeSchema,
});
export type PurchaseOrderListQuery = z.infer<typeof PurchaseOrderListQuerySchema>;

/** GET /api/v1/erp-vendors/purchase-orders response */
export const PurchaseOrderListResponseSchema = z.object({
  items: z.array(PurchaseOrderSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  hasMore: z.boolean(),
});
export type PurchaseOrderListResponse = z.infer<typeof PurchaseOrderListResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Error Envelope Schema
// ─────────────────────────────────────────────────────────────────────────────

export const ApiErrorDetailSchema = z.object({
  field: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
});

export const ApiErrorSchema = z.object({
  statusCode: z.number().int().optional(),
  error: z.string().optional(),
  code: z.string(),
  message: z.string(),
  details: z.array(ApiErrorDetailSchema).default([]),
  correlation_id: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
