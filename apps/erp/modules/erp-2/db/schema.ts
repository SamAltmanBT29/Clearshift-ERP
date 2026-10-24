/**
 * ERP-2 Vendors & Purchasing — Drizzle ORM Schema
 *
 * Tables:
 *   erp2_vendors          — Vendor master catalog with masked bank details
 *   erp2_purchase_orders  — Purchase order headers with status lifecycle & totals
 *   erp2_po_lines         — Purchase order line items linked to ERP-1 products
 *   erp2_import_receipts  — Durable import receipts for idempotent ingestion (KIT-08 / C4)
 *
 * Design decisions:
 *   - Monetary and quantity values: numeric(18, 2) / numeric(12, 2)
 *   - All objects live inside the `erp2` PostgreSQL schema
 *   - No direct foreign keys into ERP-1 (Decision C7: cross-module referential integrity via ReferenceResolver)
 *   - Bank details masked server-side to XXXX-XXXX-7890
 *
 * @module erp2/db/schema
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
  unique,
  check,
  index,
  text,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Module-scoped PostgreSQL schema (namespace isolation)
// ─────────────────────────────────────────────────────────────────────────────
export const erp2Schema = pgSchema('erp2');

// ─────────────────────────────────────────────────────────────────────────────
// Enum types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Purchase order lifecycle states.
 * FR-ERP2-04: Draft -> Sent -> Received -> Closed.
 * Strict unidirectional flow.
 */
export const poStatusEnum = erp2Schema.enum('po_status', [
  'Draft',
  'Sent',
  'Received',
  'Closed',
]);

export const purchaseOrderStatusEnum = {
  enumValues: ['draft', 'sent', 'received', 'closed'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Table 1 — erp2_vendors (Vendor Master)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Vendor master record.
 * FR-ERP2-01, FR-ERP2-02, FR-ERP2-06.
 */
export const erp2Vendors = erp2Schema.table(
  'vendors',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    name: varchar('name', { length: 255 }).notNull(),
    tax_number: varchar('tax_number', { length: 64 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    address_line: varchar('address_line', { length: 255 }),
    city: varchar('city', { length: 100 }),
    country: varchar('country', { length: 64 }),
    bank_masked: varchar('bank_masked', { length: 64 }),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),

    source_system: varchar('source_system', { length: 64 }),
    source_id: varchar('source_id', { length: 128 }),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    taxNumberUniqueIdx: uniqueIndex('vendors_tax_number_unique').on(table.tax_number),
    nameIdx: index('vendors_name_idx').on(table.name),
    sourceIdx: index('vendors_source_idx').on(table.source_system, table.source_id),

    nameNotEmptyCheck: check('vendors_name_not_empty', sql`length(trim(${table.name})) > 0`),
    taxNumberNotEmptyCheck: check(
      'vendors_tax_number_not_empty',
      sql`length(trim(${table.tax_number})) > 0`
    ),
    bankMaskedFormatCheck: check(
      'vendors_bank_masked_format',
      sql`${table.bank_masked} IS NULL OR ${table.bank_masked} ~ '^XXXX-XXXX-[0-9]{4}$'`
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 2 — erp2_purchase_orders (Purchase Order Headers)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Purchase order header.
 * FR-ERP2-03, FR-ERP2-04, FR-ERP2-05.
 */
export const erp2PurchaseOrders = erp2Schema.table(
  'purchase_orders',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    po_number: varchar('po_number', { length: 64 }).notNull(),
    vendor_id: uuid('vendor_id')
      .notNull()
      .references(() => erp2Vendors.id),
    order_date: date('order_date').notNull(),
    status: poStatusEnum('status').notNull().default('Draft'),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    total: numeric('total', { precision: 18, scale: 2 }).notNull().default('0.00'),
    notes: text('notes'),
    source_system: varchar('source_system', { length: 64 }),
    source_id: varchar('source_id', { length: 128 }),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    poNumberUniqueIdx: uniqueIndex('purchase_orders_po_number_unique').on(table.po_number),
    vendorIdIdx: index('purchase_orders_vendor_id_idx').on(table.vendor_id),
    statusIdx: index('purchase_orders_status_idx').on(table.status),

    poNumberNotEmptyCheck: check(
      'purchase_orders_po_number_not_empty',
      sql`length(trim(${table.po_number})) > 0`
    ),
    currencyFormatCheck: check(
      'purchase_orders_currency_format',
      sql`${table.currency} ~ '^[A-Z]{3}$'`
    ),
    totalNonNegativeCheck: check(
      'purchase_orders_total_non_negative',
      sql`${table.total} >= 0`
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 3 — erp2_po_lines (Purchase Order Lines)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Line items belonging to a purchase order.
 * Links to ERP-1 product_id (logical reference, verified via ReferenceResolver).
 * FR-ERP2-03, FR-ERP2-05, BR-ERP2-01.
 */
export const erp2PoLines = erp2Schema.table(
  'po_lines',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    po_id: uuid('po_id')
      .notNull()
      .references(() => erp2PurchaseOrders.id, { onDelete: 'cascade' }),
    product_id: uuid('product_id').notNull(),
    line_number: integer('line_number').notNull().default(1),
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(),
    price: numeric('price', { precision: 18, scale: 2 }).notNull(),
    line_total: numeric('line_total', { precision: 18, scale: 2 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    poLineNumberUnique: unique('po_lines_po_line_number_unique').on(table.po_id, table.line_number),
    poIdIdx: index('po_lines_po_id_idx').on(table.po_id),
    productIdIdx: index('po_lines_product_id_idx').on(table.product_id),

    quantityPositiveCheck: check('po_lines_quantity_positive', sql`${table.quantity} > 0`),
    priceNonNegativeCheck: check('po_lines_price_non_negative', sql`${table.price} >= 0`),
    lineTotalNonNegativeCheck: check(
      'po_lines_line_total_non_negative',
      sql`${table.line_total} >= 0`
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 4 — erp2_import_receipts (Idempotency & Durable Import Receipts)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Durable import receipts table (KIT-08 / Decision C4).
 * Persisted in the same local transaction as the target mutation.
 */
export const erp2ImportReceipts = erp2Schema.table(
  'import_receipts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

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

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    idempotencyKeyUnique: unique('import_receipts_idempotency_key_unique').on(
      table.idempotency_key
    ),
    idempotencyKeyUniqueIdx: uniqueIndex('erp2_import_receipts_key_unique').on(
      table.idempotency_key
    ),
    batchRowIdx: index('erp2_import_receipts_batch_row_idx').on(
      table.batch_id,
      table.source_row
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Type inference helpers
// ─────────────────────────────────────────────────────────────────────────────
export type Erp2Vendor = typeof erp2Vendors.$inferSelect;
export type NewErp2Vendor = typeof erp2Vendors.$inferInsert;

export type Erp2PurchaseOrder = typeof erp2PurchaseOrders.$inferSelect;
export type NewErp2PurchaseOrder = typeof erp2PurchaseOrders.$inferInsert;

export type Erp2PoLine = typeof erp2PoLines.$inferSelect;
export type NewErp2PoLine = typeof erp2PoLines.$inferInsert;

export type Erp2ImportReceipt = typeof erp2ImportReceipts.$inferSelect;
export type NewErp2ImportReceipt = typeof erp2ImportReceipts.$inferInsert;
