/**
 * ERP-3 Sales Orders & Invoices — Drizzle ORM Schema
 *
 * Tables:
 *   erp3.sales_orders      — Sales order headers with status lifecycle & totals
 *   erp3.so_lines          — Sales order lines linked to ERP-1 products
 *   erp3.invoices          — Invoice records linked to sales orders
 *   erp3.invoice_lines     — Invoice line items
 *   erp3.payments          — Invoice settlement payment records
 *   erp3.import_receipts   — Durable import receipts for idempotent ingestion (KIT-08 / C4)
 *
 * Design decisions:
 *   - Monetary values stored as numeric(19, 4) with explicit ISO currency code
 *   - All objects live inside the `erp3` PostgreSQL schema
 *   - Cross-module referential integrity via ReferenceResolver (CRM-1 golden ID, ERP-1 product)
 *   - Strict constraints on order_number and invoice_number uniqueness
 *
 * @module erp3/db/schema
 */

import {
  pgSchema,
  uuid,
  varchar,
  timestamp,
  date,
  numeric,
  integer,
  uniqueIndex,
  index,
  text,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Module-scoped PostgreSQL schema (namespace isolation)
// ─────────────────────────────────────────────────────────────────────────────
export const erp3Schema = pgSchema('erp3');

// ─────────────────────────────────────────────────────────────────────────────
// Enum types
// ─────────────────────────────────────────────────────────────────────────────

export const salesOrderStatusEnum = erp3Schema.enum('sales_order_status', [
  'Open',
  'Invoiced',
  'Closed',
]);

export const invoiceStatusEnum = erp3Schema.enum('invoice_status', [
  'Open',
  'Paid',
  'Overdue',
]);

export const paymentMethodEnum = erp3Schema.enum('payment_method', [
  'cash',
  'bank',
  'card',
]);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Table: erp3.sales_orders (Sales Order Headers)
// ─────────────────────────────────────────────────────────────────────────────
export const salesOrders = erp3Schema.table(
  'sales_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    order_number: varchar('order_number', { length: 64 }).notNull(),
    customer_golden_id: uuid('customer_golden_id').notNull(),
    order_date: date('order_date').notNull(),
    status: salesOrderStatusEnum('status').notNull().default('Open'),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    subtotal: numeric('subtotal', { precision: 19, scale: 4 }).notNull().default('0.0000'),
    tax_total: numeric('tax_total', { precision: 19, scale: 4 }).notNull().default('0.0000'),
    total: numeric('total', { precision: 19, scale: 4 }).notNull().default('0.0000'),
    source_system: varchar('source_system', { length: 64 }),
    source_id: varchar('source_id', { length: 128 }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_orders_order_number_unique').on(table.order_number),
    index('sales_orders_customer_idx').on(table.customer_golden_id),
    index('sales_orders_status_idx').on(table.status),
    index('sales_orders_date_idx').on(table.order_date),
    check('sales_orders_number_not_empty', sql`length(trim(${table.order_number})) > 0`),
    check('sales_orders_subtotal_non_negative', sql`${table.subtotal} >= 0`),
    check('sales_orders_tax_total_non_negative', sql`${table.tax_total} >= 0`),
    check('sales_orders_total_non_negative', sql`${table.total} >= 0`),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Table: erp3.so_lines (Sales Order Lines)
// ─────────────────────────────────────────────────────────────────────────────
export const soLines = erp3Schema.table(
  'so_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    order_id: uuid('order_id')
      .notNull()
      .references(() => salesOrders.id, { onDelete: 'cascade' }),
    line_number: integer('line_number').notNull(),
    product_id: uuid('product_id').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 4 }).notNull(),
    unit_price: numeric('unit_price', { precision: 19, scale: 4 }).notNull(),
    tax_rate: numeric('tax_rate', { precision: 6, scale: 4 }).notNull().default('0.0000'),
    tax_amount: numeric('tax_amount', { precision: 19, scale: 4 }).notNull().default('0.0000'),
    line_total: numeric('line_total', { precision: 19, scale: 4 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('so_lines_order_line_unique').on(table.order_id, table.line_number),
    index('so_lines_order_id_idx').on(table.order_id),
    check('so_lines_quantity_positive', sql`${table.quantity} > 0`),
    check('so_lines_unit_price_non_negative', sql`${table.unit_price} >= 0`),
    check('so_lines_tax_rate_range', sql`${table.tax_rate} >= 0 AND ${table.tax_rate} <= 100`),
    check('so_lines_tax_amount_non_negative', sql`${table.tax_amount} >= 0`),
    check('so_lines_line_total_non_negative', sql`${table.line_total} >= 0`),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Table: erp3.invoices (Invoices)
// ─────────────────────────────────────────────────────────────────────────────
export const invoices = erp3Schema.table(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoice_number: varchar('invoice_number', { length: 64 }).notNull(),
    order_id: uuid('order_id')
      .references(() => salesOrders.id),
    customer_golden_id: uuid('customer_golden_id').notNull(),
    invoice_date: date('invoice_date').notNull(),
    due_date: date('due_date').notNull(),
    status: invoiceStatusEnum('status').notNull().default('Open'),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    subtotal: numeric('subtotal', { precision: 19, scale: 4 }).notNull().default('0.0000'),
    tax_total: numeric('tax_total', { precision: 19, scale: 4 }).notNull().default('0.0000'),
    total: numeric('total', { precision: 19, scale: 4 }).notNull().default('0.0000'),
    source_system: varchar('source_system', { length: 64 }),
    source_id: varchar('source_id', { length: 128 }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoices_invoice_number_unique').on(table.invoice_number),
    uniqueIndex('invoices_order_id_unique').on(table.order_id),
    index('invoices_customer_idx').on(table.customer_golden_id),
    index('invoices_status_idx').on(table.status),
    index('invoices_due_date_idx').on(table.due_date),
    check('invoices_number_not_empty', sql`length(trim(${table.invoice_number})) > 0`),
    check('invoices_due_date_after_or_equal_invoice_date', sql`${table.due_date} >= ${table.invoice_date}`),
    check('invoices_subtotal_non_negative', sql`${table.subtotal} >= 0`),
    check('invoices_tax_total_non_negative', sql`${table.tax_total} >= 0`),
    check('invoices_total_non_negative', sql`${table.total} >= 0`),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Table: erp3.invoice_lines (Invoice Lines)
// ─────────────────────────────────────────────────────────────────────────────
export const invoiceLines = erp3Schema.table(
  'invoice_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoice_id: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    line_number: integer('line_number').notNull(),
    product_id: uuid('product_id').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 4 }).notNull(),
    unit_price: numeric('unit_price', { precision: 19, scale: 4 }).notNull(),
    tax_rate: numeric('tax_rate', { precision: 6, scale: 4 }).notNull().default('0.0000'),
    tax_amount: numeric('tax_amount', { precision: 19, scale: 4 }).notNull().default('0.0000'),
    line_total: numeric('line_total', { precision: 19, scale: 4 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoice_lines_invoice_line_unique').on(table.invoice_id, table.line_number),
    index('invoice_lines_invoice_id_idx').on(table.invoice_id),
    check('invoice_lines_quantity_positive', sql`${table.quantity} > 0`),
    check('invoice_lines_unit_price_non_negative', sql`${table.unit_price} >= 0`),
    check('invoice_lines_tax_rate_range', sql`${table.tax_rate} >= 0 AND ${table.tax_rate} <= 100`),
    check('invoice_lines_tax_amount_non_negative', sql`${table.tax_amount} >= 0`),
    check('invoice_lines_line_total_non_negative', sql`${table.line_total} >= 0`),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Table: erp3.payments (Payments)
// ─────────────────────────────────────────────────────────────────────────────
export const payments = erp3Schema.table(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoice_id: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    payment_date: date('payment_date').notNull(),
    payment_method: paymentMethodEnum('payment_method').notNull(),
    reference: varchar('reference', { length: 128 }),
    idempotency_key: varchar('idempotency_key', { length: 128 }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payments_invoice_id_idx').on(table.invoice_id),
    index('payments_date_idx').on(table.payment_date),
    check('payments_amount_positive', sql`${table.amount} > 0`),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Table: erp3.import_receipts (Idempotency Ledger)
// ─────────────────────────────────────────────────────────────────────────────
export const importReceipts = erp3Schema.table(
  'import_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batch_id: uuid('batch_id').notNull(),
    source_row: integer('source_row').notNull(),
    source_system: varchar('source_system', { length: 64 }),
    source_id: varchar('source_id', { length: 128 }),
    entity: varchar('entity', { length: 64 }).notNull(),
    schema_version: integer('schema_version').notNull().default(1),
    idempotency_key: varchar('idempotency_key', { length: 128 }).notNull(),
    request_hash: varchar('request_hash', { length: 64 }).notNull(),
    target_id: uuid('target_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull().default('created'),
    outcome: varchar('outcome', { length: 16 }).notNull().default('loaded'),
    response_payload: text('response_payload'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('import_receipts_erp3_idempotency_key_unique').on(table.idempotency_key),
    index('import_receipts_erp3_batch_row_idx').on(table.batch_id, table.source_row),
  ],
);

// Aliases for consistent naming across modules (erp2Vendors, erp5Employees, etc.)
export const erp3SalesOrders = salesOrders;
export const erp3SoLines = soLines;
export const erp3Invoices = invoices;
export const erp3InvoiceLines = invoiceLines;
export const erp3Payments = payments;
export const erp3ImportReceipts = importReceipts;

export type SalesOrderRecord = typeof salesOrders.$inferSelect;
export type SoLineRecord = typeof soLines.$inferSelect;
export type InvoiceRecord = typeof invoices.$inferSelect;
export type InvoiceLineRecord = typeof invoiceLines.$inferSelect;
export type PaymentRecord = typeof payments.$inferSelect;
export type ImportReceiptRecord = typeof importReceipts.$inferSelect;
