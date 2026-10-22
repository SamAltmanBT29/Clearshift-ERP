/**
 * ERP-2 Vendors and Purchasing — Drizzle ORM Schema
 *
 * Tables:
 *   erp2.vendors         — Supplier and vendor master records (FR-ERP2-01, FR-ERP2-02, FR-ERP2-06)
 *   erp2.purchase_orders — Purchase order headers (FR-ERP2-03, FR-ERP2-04, FR-ERP2-05)
 *   erp2.po_lines        — Purchase order line items (FR-ERP2-03, BR-ERP2-01)
 *   erp2.import_receipts — Durable import receipts for idempotency and audit (KIT-08)
 *
 * Design Decisions & Invariants:
 *   - UUID primary keys (gen_random_uuid())
 *   - Namespace isolation: all tables live in the `erp2` PostgreSQL schema
 *   - Decision C7: intra-module foreign keys only (vendors -> purchase_orders -> po_lines)
 *   - Product references (BR-ERP2-01) are logical UUIDs verified through the ERP-1 API contract,
 *     not a cross-schema database foreign key.
 *   - Bank details: masked at server-side serialization (format XXXX-XXXX-7890).
 *   - Amounts: NUMERIC(18,2) / NUMERIC(18,4) for exact arithmetic; order total calculated server-side.
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
  unique,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Module-scoped PostgreSQL Schema
// ─────────────────────────────────────────────────────────────────────────────
export const erp2Schema = pgSchema('erp2');

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Purchase Order Status Lifecycle (FR-ERP2-04).
 * Allowed V1 forward transition: draft -> sent -> received -> closed.
 */
export const purchaseOrderStatusEnum = erp2Schema.enum('purchase_order_status', [
  'draft',
  'sent',
  'received',
  'closed',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Table 1 — erp2.vendors (Vendor Master)
// ─────────────────────────────────────────────────────────────────────────────
export const erp2Vendors = erp2Schema.table(
  'vendors',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    name: varchar('name', { length: 255 }).notNull(),

    tax_number: varchar('tax_number', { length: 64 }).notNull(),

    email: varchar('email', { length: 255 }),

    phone: varchar('phone', { length: 64 }),

    address_line: varchar('address_line', { length: 255 }),

    city: varchar('city', { length: 120 }),

    country: varchar('country', { length: 64 }),

    /** Internal bank details storage, never serialized directly. */
    bank_details_raw: text('bank_details_raw'),

    /** Masked bank account display: format XXXX-XXXX-7890 (FR-ERP2-06). */
    bank_masked: varchar('bank_masked', { length: 32 }),

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
    taxNumberUnique: unique('vendors_tax_number_unique').on(table.tax_number),
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
// Table 2 — erp2.purchase_orders (Purchase Order Header)
// ─────────────────────────────────────────────────────────────────────────────
export const erp2PurchaseOrders = erp2Schema.table(
  'purchase_orders',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    po_number: varchar('po_number', { length: 64 }).notNull(),

    /** Intra-module FK to vendor (Decision C7). */
    vendor_id: uuid('vendor_id')
      .notNull()
      .references((): AnyPgColumn => erp2Vendors.id, { onDelete: 'restrict' }),

    order_date: date('order_date')
      .notNull()
      .default(sql`CURRENT_DATE`),

    status: purchaseOrderStatusEnum('status').notNull().default('draft'),

    currency: varchar('currency', { length: 3 }).notNull().default('INR'),

    /** Order total computed from line items (FR-ERP2-05). */
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
    poNumberUnique: unique('purchase_orders_po_number_unique').on(table.po_number),
    vendorIdIdx: index('purchase_orders_vendor_id_idx').on(table.vendor_id),
    statusIdx: index('purchase_orders_status_idx').on(table.status),
    orderDateIdx: index('purchase_orders_order_date_idx').on(table.order_date),

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
// Table 3 — erp2.po_lines (Purchase Order Lines)
// ─────────────────────────────────────────────────────────────────────────────
export const erp2PoLines = erp2Schema.table(
  'po_lines',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Intra-module FK cascade-deletes with purchase order. */
    po_id: uuid('po_id')
      .notNull()
      .references((): AnyPgColumn => erp2PurchaseOrders.id, { onDelete: 'cascade' }),

    /** Logical product reference verified via ERP-1 API contract (Decision C7). */
    product_id: uuid('product_id').notNull(),

    line_number: integer('line_number').notNull(),

    quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),

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
    poLineNumberUnique: unique('po_lines_po_line_number_unique').on(
      table.po_id,
      table.line_number
    ),
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
// Table 4 — erp2.import_receipts (Idempotency & Migration Audit Receipts)
// ─────────────────────────────────────────────────────────────────────────────
export const erp2ImportReceipts = erp2Schema.table(
  'import_receipts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    batch_id: uuid('batch_id').notNull(),
    source_row: integer('source_row').notNull(),
    entity: varchar('entity', { length: 64 }).notNull(),
    schema_version: integer('schema_version').notNull().default(1),
    idempotency_key: varchar('idempotency_key', { length: 128 }).notNull(),
    target_id: uuid('target_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull().default('created'),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    idempotencyKeyUnique: unique('import_receipts_idempotency_key_unique').on(
      table.idempotency_key
    ),
    batchRowIdx: index('import_receipts_batch_row_idx').on(table.batch_id, table.source_row),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Relation type helpers
// ─────────────────────────────────────────────────────────────────────────────
export type Erp2Vendor = typeof erp2Vendors.$inferSelect;
export type NewErp2Vendor = typeof erp2Vendors.$inferInsert;

export type Erp2PurchaseOrder = typeof erp2PurchaseOrders.$inferSelect;
export type NewErp2PurchaseOrder = typeof erp2PurchaseOrders.$inferInsert;

export type Erp2PoLine = typeof erp2PoLines.$inferSelect;
export type NewErp2PoLine = typeof erp2PoLines.$inferInsert;

export type Erp2ImportReceipt = typeof erp2ImportReceipts.$inferSelect;
export type NewErp2ImportReceipt = typeof erp2ImportReceipts.$inferInsert;
