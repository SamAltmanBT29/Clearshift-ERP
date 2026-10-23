/**
 * ERP-1 Products & Inventory — Drizzle ORM Schema
 *
 * Logical SDS tables:
 *   erp1_categories      — Product categories (one-level hierarchy per FR-ERP1-03)
 *   erp1_warehouses      — Warehouses (one warehouse in V1 per FR-ERP1-05)
 *   erp1_products        — Product master data with unique SKU & decimal price (FR-ERP1-01, FR-ERP1-02, BR-ERP1-01)
 *   erp1_stock_levels    — Non-negative stock quantities per product/warehouse (FR-ERP1-06, BR-ERP1-02)
 *   erp1_import_receipts — Durable idempotency receipts for migration loads (Decision C4 & KIT-08)
 *
 * Physical tables live in the module schema: erp1.categories, erp1.warehouses,
 * erp1.products, erp1.stock_levels and erp1.import_receipts. This is the same
 * schema convention used by ERP-4 and ERP-5 (see the ERP-1 data dictionary DR-1).
 *
 * @module erp1/db/schema
 */

import {
  pgSchema,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  numeric,
  integer,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Module-scoped PostgreSQL schema (namespace isolation)
// ─────────────────────────────────────────────────────────────────────────────
export const erp1Schema = pgSchema('erp1');

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixed list of units of measure per FR-ERP1-04.
 */
export const unitOfMeasureEnum = erp1Schema.enum('unit_of_measure', [
  'pcs',
  'kg',
  'g',
  'litre',
  'metre',
  'box',
]);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Categories (FR-ERP1-03: one level only, name & code)
// ─────────────────────────────────────────────────────────────────────────────
export const erp1Categories = erp1Schema.table(
  'categories',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('erp1_categories_code_idx').on(table.code),
    index('erp1_categories_name_idx').on(table.name),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Warehouses (FR-ERP1-05: one warehouse in V1)
// ─────────────────────────────────────────────────────────────────────────────
export const erp1Warehouses = erp1Schema.table(
  'warehouses',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 64 }).notNull(),
    isDefault: boolean('is_default').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('erp1_warehouses_code_idx').on(table.code),
    // FR-ERP1-05: V1 operates exactly one warehouse. A unique index on a
    // constant expression makes a second warehouse impossible at the database
    // boundary, not only in the application layer.
    uniqueIndex('erp1_warehouses_single_idx').on(sql`(true)`),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Products (FR-ERP1-01, FR-ERP1-02, BR-ERP1-01: unique SKU, decimal price)
// ─────────────────────────────────────────────────────────────────────────────
export const erp1Products = erp1Schema.table(
  'products',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: varchar('name', { length: 255 }).notNull(),
    sku: varchar('sku', { length: 128 }).notNull(),
    normalizedSku: varchar('normalized_sku', { length: 128 }).notNull(),
    categoryId: uuid('category_id').references(() => erp1Categories.id, {
      onDelete: 'set null',
    }),
    unitOfMeasure: unitOfMeasureEnum('unit_of_measure').notNull(),
    price: numeric('price', { precision: 19, scale: 4 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
    sourceSystem: varchar('source_system', { length: 64 }),
    sourceId: varchar('source_id', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('erp1_products_sku_idx').on(table.sku),
    uniqueIndex('erp1_products_normalized_sku_idx').on(table.normalizedSku),
    index('erp1_products_name_idx').on(table.name),
    index('erp1_products_category_id_idx').on(table.categoryId),
    index('erp1_products_source_idx').on(table.sourceSystem, table.sourceId),
    check('check_erp1_products_price_non_negative', sql`price >= 0`),
    check('check_erp1_products_tax_rate_non_negative', sql`tax_rate >= 0`),
    check('check_erp1_products_currency_format', sql`currency ~ '^[A-Z]{3}$'`),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Stock Levels (FR-ERP1-06, BR-ERP1-02: No negative stock)
// ─────────────────────────────────────────────────────────────────────────────
export const erp1StockLevels = erp1Schema.table(
  'stock_levels',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    productId: uuid('product_id')
      .notNull()
      .references(() => erp1Products.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => erp1Warehouses.id, { onDelete: 'cascade' }),
    quantity: numeric('quantity', { precision: 19, scale: 4 })
      .notNull()
      .default('0.0000'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('erp1_stock_levels_product_warehouse_idx').on(
      table.productId,
      table.warehouseId
    ),
    check('check_erp1_stock_quantity_non_negative', sql`quantity >= 0`),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Import Receipts (Decision C4 & KIT-08)
// ─────────────────────────────────────────────────────────────────────────────
export const erp1ImportReceipts = erp1Schema.table(
  'import_receipts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    batchId: uuid('batch_id').notNull(),
    sourceRow: integer('source_row').notNull(),
    entity: varchar('entity', { length: 64 }).notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    targetId: uuid('target_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull().default('created'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('erp1_import_receipts_idempotency_key_unique').on(
      table.idempotencyKey
    ),
    index('erp1_import_receipts_batch_row_idx').on(
      table.batchId,
      table.sourceRow
    ),
    check('check_erp1_import_receipts_source_row_positive', sql`source_row >= 1`),
    check(
      'check_erp1_import_receipts_schema_version_positive',
      sql`schema_version >= 1`
    ),
    check(
      'check_erp1_import_receipts_kind_allowed',
      sql`kind IN ('created', 'linked')`
    ),
  ]
);

// Type inference exports
export type Erp1Category = typeof erp1Categories.$inferSelect;
export type Erp1NewCategory = typeof erp1Categories.$inferInsert;
export type Erp1Warehouse = typeof erp1Warehouses.$inferSelect;
export type Erp1NewWarehouse = typeof erp1Warehouses.$inferInsert;
export type Erp1Product = typeof erp1Products.$inferSelect;
export type Erp1NewProduct = typeof erp1Products.$inferInsert;
export type Erp1StockLevel = typeof erp1StockLevels.$inferSelect;
export type Erp1NewStockLevel = typeof erp1StockLevels.$inferInsert;
export type Erp1ImportReceipt = typeof erp1ImportReceipts.$inferSelect;
export type Erp1NewImportReceipt = typeof erp1ImportReceipts.$inferInsert;
