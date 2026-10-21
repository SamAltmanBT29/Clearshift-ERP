/**
 * ERP-2 Vendors & Purchasing — Drizzle ORM Schema
 *
 * Tables:
 *   erp2_vendors          — Vendor master data (masked bank details)
 *   erp2_purchase_orders  — Purchase order headers
 *   erp2_po_lines         — Purchase order line items
 *   erp2_import_receipts  — Idempotent mutation & batch import tracking
 *
 * PostgreSQL schema: `erp2`
 *
 * @module erp2/db/schema
 */

import {
  pgSchema,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  numeric,
  integer,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const erp2Schema = pgSchema('erp2');

// ─────────────────────────────────────────────────────────────────────────────
// Vendors
// ─────────────────────────────────────────────────────────────────────────────

export const erp2Vendors = erp2Schema.table(
  'erp2_vendors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    taxNumber: varchar('tax_number', { length: 64 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 32 }).notNull(),
    addressLine: varchar('address_line', { length: 255 }).notNull(),
    city: varchar('city', { length: 100 }).notNull(),
    country: varchar('country', { length: 100 }).notNull(),
    // Sensitive field masked everywhere (FR-ERP2-06)
    bankMasked: varchar('bank_masked', { length: 32 }).notNull().default('XXXX-XXXX-7890'),
    sourceSystem: varchar('source_system', { length: 64 }),
    sourceId: varchar('source_id', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_erp2_vendors_tax_number').on(table.taxNumber),
    index('idx_erp2_vendors_name').on(table.name),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Purchase Orders
// ─────────────────────────────────────────────────────────────────────────────

export const erp2PurchaseOrders = erp2Schema.table(
  'erp2_purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    poNumber: varchar('po_number', { length: 64 }).notNull(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => erp2Vendors.id, { onDelete: 'restrict' }),
    orderDate: date('order_date').notNull(),
    // Status FSM: Draft -> Sent -> Received -> Closed (FR-ERP2-04)
    status: varchar('status', { length: 32 }).notNull().default('Draft'),
    currencyCode: varchar('currency_code', { length: 3 }).notNull().default('USD'),
    total: numeric('total', { precision: 18, scale: 2 }).notNull().default('0.00'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_erp2_po_number').on(table.poNumber),
    index('idx_erp2_po_vendor_id').on(table.vendorId),
    index('idx_erp2_po_status').on(table.status),
    check('chk_erp2_po_status', sql`${table.status} IN ('Draft', 'Sent', 'Received', 'Closed')`),
    check('chk_erp2_po_total_non_negative', sql`${table.total} >= 0`),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Purchase Order Lines
// ─────────────────────────────────────────────────────────────────────────────

export const erp2PoLines = erp2Schema.table(
  'erp2_po_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    poId: uuid('po_id')
      .notNull()
      .references(() => erp2PurchaseOrders.id, { onDelete: 'cascade' }),
    // Product ID verified via ERP-1 ReferenceResolver (BR-ERP2-01)
    productId: uuid('product_id').notNull(),
    quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
    price: numeric('price', { precision: 18, scale: 2 }).notNull(),
    lineTotal: numeric('line_total', { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_erp2_po_lines_po_id').on(table.poId),
    index('idx_erp2_po_lines_product_id').on(table.productId),
    check('chk_erp2_po_line_qty_positive', sql`${table.quantity} > 0`),
    check('chk_erp2_po_line_price_non_negative', sql`${table.price} >= 0`),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Import Receipts (Idempotency Tracking)
// ─────────────────────────────────────────────────────────────────────────────

export const erp2ImportReceipts = erp2Schema.table(
  'erp2_import_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    batchId: uuid('batch_id'),
    sourceRow: integer('source_row'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_erp2_import_receipts_key').on(table.idempotencyKey),
  ]
);
