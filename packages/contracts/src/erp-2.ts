/**
 * ERP-2 Vendors & Purchasing — Public API Contract Types
 *
 * Single source of truth for:
 *   - Request/response validation (Fastify + Zod)
 *   - OpenAPI spec generation & documentation
 *   - TypeScript type inference across API, frontend, and tests
 *
 * Module API base: /api/v1/erp-vendors
 *
 * Traceability:
 *   - SDS ClearShift ERP v2.0 §4.3 (FR-ERP2-01..06, BR-ERP2-01), §4.7, §4.8
 *   - Project Plan §7.7
 *
 * @module contracts/erp-2
 */

import { z } from 'zod';
import { CurrencyCode, UuidSchema } from './erp-4.js';
import {
  ImportReceiptRecordSchema,
  ImportRowRequestSchema,
  ImportRowResponseSchema,
  TargetAdapterErrorSchema,
} from './import-target.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared Primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Monetary amount: string-encoded decimal with up to 2 decimal places. */
export const MoneyAmount2Dp = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a non-negative decimal with up to 2 decimal places');

/** Date format YYYY-MM-DD. */
export const IsoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format');

// ─────────────────────────────────────────────────────────────────────────────
// Enum Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Purchase order lifecycle status.
 * FR-ERP2-04: Draft / Sent / Received / Closed.
 * Allowed transitions are strictly unidirectional: Draft -> Sent -> Received -> Closed.
 */
export const PurchaseOrderStatusEnum = z.enum([
  'Draft',
  'Sent',
  'Received',
  'Closed',
]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatusEnum>;

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Schemas
// GET /api/v1/erp-vendors/vendors
// POST /api/v1/erp-vendors/vendors
// PATCH /api/v1/erp-vendors/vendors/{id}
// ─────────────────────────────────────────────────────────────────────────────

/** Response shape for a single Vendor record. */
export const VendorSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(255),
  tax_number: z.string().min(1).max(64),
  email: z.string().email(),
  phone: z.string().max(32).nullable(),
  address_line: z.string().max(255).nullable(),
  city: z.string().max(100).nullable(),
  country: z.string().max(64).nullable(),
  bank_masked: z
    .string()
    .regex(/^XXXX-XXXX-\d{4}$/, 'Masked bank format must match XXXX-XXXX-7890')
    .nullable(),
  currency: CurrencyCode.default('USD'),
  source_system: z.string().max(64).nullable(),
  source_id: z.string().max(128).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Vendor = z.infer<typeof VendorSchema>;

/** POST /api/v1/erp-vendors/vendors — request body. */
export const CreateVendorRequestSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  tax_number: z.string().min(1, 'Tax number is required').max(64),
  email: z.string().email('Valid email is required'),
  phone: z.string().max(32).optional().nullable(),
  address_line: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(64).optional().nullable(),
  bank_details: z.string().min(4).max(64).optional().nullable(),
  currency: CurrencyCode.default('USD'),
  source_system: z.string().max(64).optional().nullable(),
  source_id: z.string().max(128).optional().nullable(),
  idempotency_key: z.string().max(128).optional().nullable(),
  batch_id: UuidSchema.optional().nullable(),
  source_row: z.number().int().nonnegative().optional().nullable(),
});
export type CreateVendorRequest = z.infer<typeof CreateVendorRequestSchema>;

/** PATCH /api/v1/erp-vendors/vendors/{id} — request body. */
export const UpdateVendorRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  tax_number: z.string().min(1).max(64).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(32).optional().nullable(),
  address_line: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(64).optional().nullable(),
  bank_details: z.string().min(4).max(64).optional().nullable(),
  currency: CurrencyCode.optional(),
});
export type UpdateVendorRequest = z.infer<typeof UpdateVendorRequestSchema>;

/** GET /api/v1/erp-vendors/vendors — query params with search and bounded pagination. */
export const VendorListQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page must be >= 1').default(1),
  pageSize: z.coerce.number().int().min(1, 'pageSize must be >= 1').max(100, 'pageSize <= 100').default(20),
  search: z.string().max(100).optional(),
});
export type VendorListQuery = z.infer<typeof VendorListQuerySchema>;

/** Paginated vendor list response. */
export const PaginatedVendorsResponseSchema = z.object({
  items: z.array(VendorSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type PaginatedVendorsResponse = z.infer<typeof PaginatedVendorsResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Purchase Order Line Schemas
// ─────────────────────────────────────────────────────────────────────────────

/** Single purchase order line response. */
export const PurchaseOrderLineSchema = z.object({
  id: UuidSchema,
  po_id: UuidSchema,
  product_id: UuidSchema,
  quantity: MoneyAmount2Dp,
  price: MoneyAmount2Dp,
  line_total: MoneyAmount2Dp,
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;

/** One line in CreatePurchaseOrderRequest. */
export const CreatePurchaseOrderLineRequestSchema = z.object({
  product_id: UuidSchema,
  quantity: z
    .union([z.string(), z.number()])
    .pipe(z.coerce.string())
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0, {
      message: 'Quantity must be a positive decimal with up to 2 decimal places',
    }),
  price: z
    .union([z.string(), z.number()])
    .pipe(z.coerce.string())
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) >= 0, {
      message: 'Price must be a non-negative decimal with up to 2 decimal places',
    }),
});
export type CreatePurchaseOrderLineRequest = z.infer<typeof CreatePurchaseOrderLineRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Purchase Order Schemas
// GET /api/v1/erp-vendors/purchase-orders
// GET /api/v1/erp-vendors/purchase-orders/{id}
// POST /api/v1/erp-vendors/purchase-orders
// PATCH /api/v1/erp-vendors/purchase-orders/{id}
// ─────────────────────────────────────────────────────────────────────────────

/** Response shape for a Purchase Order with lines. */
export const PurchaseOrderSchema = z.object({
  id: UuidSchema,
  po_number: z.string().min(1).max(64),
  vendor_id: UuidSchema,
  order_date: IsoDateString,
  status: PurchaseOrderStatusEnum,
  currency: CurrencyCode,
  total: MoneyAmount2Dp,
  lines: z.array(PurchaseOrderLineSchema),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

/** POST /api/v1/erp-vendors/purchase-orders — request body. */
export const CreatePurchaseOrderRequestSchema = z.object({
  po_number: z.string().min(1).max(64).optional(),
  vendor_id: UuidSchema,
  order_date: IsoDateString,
  currency: CurrencyCode.default('USD'),
  lines: z
    .array(CreatePurchaseOrderLineRequestSchema)
    .min(1, 'A purchase order must contain at least one line'),
  idempotency_key: z.string().max(128).optional().nullable(),
  batch_id: UuidSchema.optional().nullable(),
  source_row: z.number().int().nonnegative().optional().nullable(),
});
export type CreatePurchaseOrderRequest = z.infer<typeof CreatePurchaseOrderRequestSchema>;

/** PATCH /api/v1/erp-vendors/purchase-orders/{id} — request body (allowed status transition only). */
export const UpdatePurchaseOrderStatusRequestSchema = z.object({
  status: PurchaseOrderStatusEnum,
});
export type UpdatePurchaseOrderStatusRequest = z.infer<typeof UpdatePurchaseOrderStatusRequestSchema>;

/** GET /api/v1/erp-vendors/purchase-orders — query params. */
export const PurchaseOrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  vendor_id: UuidSchema.optional(),
  status: PurchaseOrderStatusEnum.optional(),
});
export type PurchaseOrderListQuery = z.infer<typeof PurchaseOrderListQuerySchema>;

/** Paginated purchase order list response. */
export const PaginatedPurchaseOrdersResponseSchema = z.object({
  items: z.array(PurchaseOrderSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type PaginatedPurchaseOrdersResponse = z.infer<typeof PaginatedPurchaseOrdersResponseSchema>;
