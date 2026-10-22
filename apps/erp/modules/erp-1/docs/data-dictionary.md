# ERP-1 Products & Inventory — Data Dictionary

**SDS Reference**: ClearShift ERP v2.0, §4.2, §4.7  
**Module**: ERP-1 Products & Inventory (Group 6)  
**Issue**: [#6](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/6)  
**PostgreSQL Schema**: `erp1`  
**API Base**: `/api/v1/erp-products`  
**Version**: V1.0  

---

## Table of Contents
1. [erp1.categories](#1-erp1categories--product-categories)
2. [erp1.warehouses](#2-erp1warehouses--warehouses)
3. [erp1.products](#3-erp1products--product-master-data)
4. [erp1.stock_levels](#4-erp1stock_levels--stock-quantities)
5. [erp1.import_receipts](#5-erp1import_receipts--durable-migration-receipts)
6. [Database Constraints Reference](#6-database-constraints-reference)
7. [Domain Rules & Invariants](#7-domain-rules--invariants)

---

## 1. `erp1.categories` — Product Categories

**Purpose**: Stores one-level product categories for catalog organization.  
**FR Reference**: FR-ERP1-03 (Categories: one level only, name and code)  

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `name` | `VARCHAR(255)` | NOT NULL | — | Human-readable category name | B-tree index |
| `code` | `VARCHAR(64)` | NOT NULL | — | Unique category identifier code | UNIQUE |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last modification timestamp | — |

**Indexes**:
- `erp1_categories_code_idx` — UNIQUE on `(code)`
- `erp1_categories_name_idx` — B-tree on `(name)`

---

## 2. `erp1.warehouses` — Warehouses

**Purpose**: Stores warehouses holding physical inventory. V1 operates with one default warehouse.  
**FR Reference**: FR-ERP1-05 (One warehouse in V1; stock quantity per product)  

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `name` | `VARCHAR(255)` | NOT NULL | — | Warehouse facility name | — |
| `code` | `VARCHAR(64)` | NOT NULL | — | Warehouse code (e.g. `WH-01`) | UNIQUE |
| `is_default` | `BOOLEAN` | NOT NULL | `true` | True if this is the default operating warehouse | — |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last modification timestamp | — |

**Indexes**:
- `erp1_warehouses_code_idx` — UNIQUE on `(code)`

---

## 3. `erp1.products` — Product Master Data

**Purpose**: Master records of items sold and tracked by the organization.  
**FR/BR Reference**: FR-ERP1-01, FR-ERP1-02, BR-ERP1-01  

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `name` | `VARCHAR(255)` | NOT NULL | — | Product name | B-tree index |
| `sku` | `VARCHAR(128)` | NOT NULL | — | Stock Keeping Unit | UNIQUE (BR-ERP1-01) |
| `normalized_sku` | `VARCHAR(128)` | NOT NULL | — | Uppercased/trimmed SKU for exact matching | UNIQUE |
| `category_id` | `UUID` | NULL | — | Category foreign key | FK → `erp1.categories(id)` ON DELETE SET NULL |
| `unit_of_measure` | `erp1.unit_of_measure` | NOT NULL | — | Unit: `pcs`, `kg`, `g`, `litre`, `metre`, `box` | ENUM constraint (FR-ERP1-04) |
| `price` | `NUMERIC(12, 2)` | NOT NULL | — | Sale price in currency | CHECK (`price >= 0`) |
| `currency` | `VARCHAR(3)` | NOT NULL | `'USD'` | ISO 4217 3-letter currency code | — |
| `tax_rate` | `NUMERIC(5, 2)` | NOT NULL | `0.00` | Tax rate percentage (e.g. 5.00 for 5%) | CHECK (`tax_rate >= 0`) |
| `source_system` | `VARCHAR(64)` | NULL | — | External migration source system | Composite B-tree index |
| `source_id` | `VARCHAR(128)` | NULL | — | External migration source ID | Composite B-tree index |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last modification timestamp | — |

**Indexes & Constraints**:
- `erp1_products_sku_idx` — UNIQUE on `(sku)`
- `erp1_products_normalized_sku_idx` — UNIQUE on `(normalized_sku)`
- `check_erp1_products_price_non_negative` — CHECK `price >= 0`
- `check_erp1_products_tax_rate_non_negative` — CHECK `tax_rate >= 0`

---

## 4. `erp1.stock_levels` — Stock Quantities

**Purpose**: Current available inventory stock levels per product and warehouse.  
**FR/BR Reference**: FR-ERP1-06, BR-ERP1-02 (No negative stock)  

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `product_id` | `UUID` | NOT NULL | — | Product foreign key | FK → `erp1.products(id)` ON DELETE CASCADE |
| `warehouse_id` | `UUID` | NOT NULL | — | Warehouse foreign key | FK → `erp1.warehouses(id)` ON DELETE CASCADE |
| `quantity` | `NUMERIC(12, 2)` | NOT NULL | `0.00` | Current on-hand stock quantity | CHECK (`quantity >= 0`) |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last stock update timestamp | — |

**Indexes & Constraints**:
- `erp1_stock_levels_product_warehouse_idx` — UNIQUE on `(product_id, warehouse_id)`
- `check_erp1_stock_quantity_non_negative` — CHECK `quantity >= 0` (BR-ERP1-02)

---

## 5. `erp1.import_receipts` — Durable Migration Receipts

**Purpose**: Records durable import receipts for idempotent migration loads in a single transaction.  
**Architecture Reference**: Decision C4 & KIT-08  

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `batch_id` | `UUID` | NOT NULL | — | Migration Kit batch UUID | B-tree index |
| `source_row_index` | `INTEGER` | NOT NULL | — | 0-indexed row position in source payload | — |
| `target_id` | `UUID` | NOT NULL | — | UUID of created/updated target record | — |
| `target_entity` | `VARCHAR(64)` | NOT NULL | `'product'` | Entity name | — |
| `idempotency_key` | `VARCHAR(255)` | NOT NULL | — | Deterministic unique key | UNIQUE |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Creation timestamp | — |

---

## 6. Database Constraints Reference

| Constraint Name | Table | Type | Expression / Enforcement |
|---|---|---|---|
| `erp1_products_sku_idx` | `erp1.products` | UNIQUE | `sku` must be unique across all products |
| `check_erp1_products_price_non_negative` | `erp1.products` | CHECK | `price >= 0` |
| `check_erp1_products_tax_rate_non_negative` | `erp1.products` | CHECK | `tax_rate >= 0` |
| `check_erp1_stock_quantity_non_negative` | `erp1.stock_levels` | CHECK | `quantity >= 0` (BR-ERP1-02) |
| `erp1_stock_levels_product_warehouse_idx` | `erp1.stock_levels` | UNIQUE | Pair `(product_id, warehouse_id)` must be unique |

---

## 7. Domain Rules & Invariants

1. **BR-ERP1-01: SKU is unique.** No two products can share the same SKU. Enforced in both PostgreSQL and application boundary.
2. **BR-ERP1-02: No negative stock.** Stock quantities can never decrease below zero. Enforced via DB CHECK constraint `quantity >= 0` and domain validations.
3. **FR-ERP1-03: Single-level categories.** Categories do not support recursive parent-child hierarchy in V1.
4. **FR-ERP1-04: Fixed Units of Measure.** Only `pcs`, `kg`, `g`, `litre`, `metre`, `box` are allowed.
5. **Exact Decimal Arithmetic.** Prices, tax rates, and stock quantities use PostgreSQL `NUMERIC` decimal representation to avoid floating-point errors.
