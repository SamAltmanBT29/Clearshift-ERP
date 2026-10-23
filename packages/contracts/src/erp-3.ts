/**
 * ERP-3 Sales Orders and Invoices — Public API Contract Types
 *
 * Single source of truth for:
 *   - Fastify route request/response validation (Fastify + Zod)
 *   - OpenAPI 3.1 specification (packages/contracts/openapi/erp-3.yaml)
 *   - TypeScript types for frontend web application and backend handlers
 *
 * Module API base: /api/v1/erp-orders
 *
 * @module contracts/erp-3
 */

import { z } from 'zod';
import {
  BasePaginationQuerySchema,
  createPaginatedResponseSchema,
} from './common.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared Primitives & Enums (module-scoped to avoid collision with erp-4)
// ─────────────────────────────────────────────────────────────────────────────

/** ISO 4217 3-letter uppercase currency code */
export const OrdersCurrencyCode = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 currency code (e.g. USD, EUR, INR)')
  .default('USD');

/** UUID identifier */
export const OrdersUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'Must be a valid UUID'
  );

/** Monetary amount string decimal with up to 4 decimal places */
export const OrdersMoneyAmount = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a non-negative decimal with up to 4 decimal places');

/** Customer Golden ID: Hub-verified unique entity reference */
export const CustomerGoldenIdSchema = z
  .string()
  .min(1, 'Customer Golden ID cannot be empty')
  .regex(/^gid-[a-zA-Z0-9_-]+$/, 'Customer Golden ID must follow the gid-<identifier> format');

/** Sales Order Status: Open -> Invoiced -> Closed */
export const SalesOrderStatusEnum = z.enum(['open', 'invoiced', 'closed']);
export type SalesOrderStatus = z.infer<typeof SalesOrderStatusEnum>;

/** Invoice Status: Open -> Paid | Overdue */
export const InvoiceStatusEnum = z.enum(['open', 'paid', 'overdue']);
export type InvoiceStatus = z.infer<typeof InvoiceStatusEnum>;

/** Payment Method: cash | bank | card */
export const PaymentMethodEnum = z.enum(['cash', 'bank', 'card']);
export type PaymentMethod = z.infer<typeof PaymentMethodEnum>;

// ─────────────────────────────────────────────────────────────────────────────
// Sales Order Lines
// ─────────────────────────────────────────────────────────────────────────────

export const SalesOrderLineSchema = z.object({
  id: z.string(),
  orderId: z.string().optional(),
  productId: z.string().min(1, 'Product ID is required'),
  productName: z.string().optional(),
  quantity: z.number().int().positive('Quantity must be a positive integer'),
  unitPrice: OrdersMoneyAmount,
  taxRate: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Tax rate must be a valid decimal (e.g. 0.10)'),
  taxAmount: OrdersMoneyAmount,
  lineTotal: OrdersMoneyAmount,
});

export type SalesOrderLine = z.infer<typeof SalesOrderLineSchema>;

export const CreateSalesOrderLineInputSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  productName: z.string().optional(),
  quantity: z.number().int().positive('Quantity must be a positive integer'),
  unitPrice: OrdersMoneyAmount,
  taxRate: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Tax rate must be a decimal (e.g. 0.10)'),
});

export type CreateSalesOrderLineInput = z.infer<typeof CreateSalesOrderLineInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Sales Orders
// ─────────────────────────────────────────────────────────────────────────────

export const SalesOrderSchema = z.object({
  id: z.string(),
  orderNumber: z.string().min(1, 'Order number is required'),
  customerGoldenId: CustomerGoldenIdSchema,
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Order date must be in YYYY-MM-DD format'),
  status: SalesOrderStatusEnum,
  subtotal: OrdersMoneyAmount,
  taxTotal: OrdersMoneyAmount,
  total: OrdersMoneyAmount,
  currencyCode: OrdersCurrencyCode,
  notes: z.string().optional(),
  lines: z.array(SalesOrderLineSchema).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type SalesOrder = z.infer<typeof SalesOrderSchema>;

export const SalesOrdersFilterQuerySchema = BasePaginationQuerySchema.extend({
  search: z.string().optional(),
  status: SalesOrderStatusEnum.optional(),
  customerGoldenId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  currencyCode: z.string().length(3).optional(),
});

export type SalesOrdersFilterQuery = z.infer<typeof SalesOrdersFilterQuerySchema>;

export const PaginatedSalesOrdersResponseSchema = createPaginatedResponseSchema(SalesOrderSchema);
export type PaginatedSalesOrdersResponse = z.infer<typeof PaginatedSalesOrdersResponseSchema>;

export const CreateSalesOrderInputSchema = z.object({
  customerGoldenId: CustomerGoldenIdSchema,
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Order date must be YYYY-MM-DD'),
  currencyCode: OrdersCurrencyCode.optional().default('USD'),
  notes: z.string().optional(),
  lines: z.array(CreateSalesOrderLineInputSchema).min(1, 'Sales order must have at least one line item'),
});

export type CreateSalesOrderInput = z.infer<typeof CreateSalesOrderInputSchema>;

export const UpdateSalesOrderStatusInputSchema = z.object({
  status: SalesOrderStatusEnum,
  reason: z.string().optional(),
});

export type UpdateSalesOrderStatusInput = z.infer<typeof UpdateSalesOrderStatusInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Invoices
// ─────────────────────────────────────────────────────────────────────────────

export const InvoiceSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string().min(1, 'Invoice number is required'),
  orderId: z.string().min(1, 'Order ID is required'),
  customerGoldenId: CustomerGoldenIdSchema,
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Invoice date must be YYYY-MM-DD'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Due date is required and must be YYYY-MM-DD'),
  total: OrdersMoneyAmount,
  paidAmount: OrdersMoneyAmount.default('0.00'),
  currencyCode: OrdersCurrencyCode,
  status: InvoiceStatusEnum,
  notes: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Invoice = z.infer<typeof InvoiceSchema>;

export const InvoicesFilterQuerySchema = BasePaginationQuerySchema.extend({
  search: z.string().optional(),
  status: InvoiceStatusEnum.optional(),
  customerGoldenId: z.string().optional(),
  orderId: z.string().optional(),
  dueDateFrom: z.string().optional(),
  dueDateTo: z.string().optional(),
});

export type InvoicesFilterQuery = z.infer<typeof InvoicesFilterQuerySchema>;

export const PaginatedInvoicesResponseSchema = createPaginatedResponseSchema(InvoiceSchema);
export type PaginatedInvoicesResponse = z.infer<typeof PaginatedInvoicesResponseSchema>;

export const CreateInvoiceInputSchema = z.object({
  orderId: z.string().min(1, 'Order ID is required'),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Invoice date must be YYYY-MM-DD'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Due date must be YYYY-MM-DD'),
  notes: z.string().optional(),
});

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Payments
// ─────────────────────────────────────────────────────────────────────────────

export const PaymentSchema = z.object({
  id: z.string(),
  invoiceId: z.string().min(1, 'Invoice ID is required'),
  amount: OrdersMoneyAmount,
  currencyCode: OrdersCurrencyCode,
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Payment date must be in YYYY-MM-DD format'),
  method: PaymentMethodEnum,
  reference: z.string().optional(),
  createdAt: z.string().optional(),
});

export type Payment = z.infer<typeof PaymentSchema>;

export const PaymentsFilterQuerySchema = BasePaginationQuerySchema.extend({
  invoiceId: z.string().optional(),
  method: PaymentMethodEnum.optional(),
});

export type PaymentsFilterQuery = z.infer<typeof PaymentsFilterQuerySchema>;

export const PaginatedPaymentsResponseSchema = createPaginatedResponseSchema(PaymentSchema);
export type PaginatedPaymentsResponse = z.infer<typeof PaginatedPaymentsResponseSchema>;

export const CreatePaymentInputSchema = z.object({
  invoiceId: z.string().min(1, 'Invoice ID is required'),
  amount: OrdersMoneyAmount,
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Payment date must be YYYY-MM-DD'),
  method: PaymentMethodEnum,
  reference: z.string().optional(),
});

export type CreatePaymentInput = z.infer<typeof CreatePaymentInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Domain Invariant Calculations & Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates line tax and total per BR-ERP3-02:
 * Tax per line = line amount * product tax rate, rounded to 2 decimals.
 */
export function calculateLineAmounts(
  quantity: number,
  unitPrice: string,
  taxRate: string
): { subtotal: string; taxAmount: string; lineTotal: string } {
  const q = Number(quantity);
  const p = parseFloat(unitPrice);
  const r = parseFloat(taxRate);

  const sub = q * p;
  const tax = Math.round(sub * r * 100) / 100;
  const total = Math.round((sub + tax) * 100) / 100;

  return {
    subtotal: sub.toFixed(2),
    taxAmount: tax.toFixed(2),
    lineTotal: total.toFixed(2),
  };
}

/**
 * Validates that sum of line totals equals order total per BR-ERP3-01
 */
export function validateOrderLineTotals(
  lines: Array<{ lineTotal: string; subtotal?: string; taxAmount?: string }>,
  orderTotal: string
): boolean {
  const sum = lines.reduce((acc, line) => acc + parseFloat(line.lineTotal), 0);
  const roundedSum = Math.round(sum * 100) / 100;
  const target = Math.round(parseFloat(orderTotal) * 100) / 100;
  return Math.abs(roundedSum - target) < 0.001;
}

/**
 * Derives invoice status per SDS & Issue #29 rules:
 * - Paid if sum of accepted payments equals invoice total
 * - Overdue if unpaid/open and current UTC calendar date > due_date
 * - Otherwise Open
 */
export function deriveInvoiceStatus(
  invoiceTotal: string,
  totalPaid: string,
  dueDate: string,
  nowUtcDateString: string = new Date().toISOString().slice(0, 10)
): InvoiceStatus {
  const total = parseFloat(invoiceTotal);
  const paid = parseFloat(totalPaid);

  if (paid >= total && total > 0) {
    return 'paid';
  }

  if (nowUtcDateString > dueDate) {
    return 'overdue';
  }

  return 'open';
}
