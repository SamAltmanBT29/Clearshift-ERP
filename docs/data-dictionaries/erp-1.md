# ERP-1 Products & Inventory — Data Dictionary

**SDS Reference**: ClearShift ERP v2.0, §4.2, §4.7  
**Architecture Reference**: ClearShift V1 Master Architecture Spec §5, §6.1 slot 01, Decision C4/C7

**Module**: ERP-1 Products & Inventory (Group 6)  
**Issue**: [#6](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/6)  
**PostgreSQL Schema**: `erp1`  
**API Base**: `/api/v1/erp-products`  
**Version**: V1.1

---

## Table of Contents
1. [Ownership & boundaries](#1-ownership--boundaries)
2. [erp1.categories](#2-erp1categories--product-categories)
3. [erp1.warehouses](#3-erp1warehouses--warehouses)
4. [erp1.products](#4-erp1products--product-master-data)
5. [erp1.stock_levels](#5-erp1stock_levels--stock-quantities)
6. [erp1.import_receipts](#6-erp1import_receipts--durable-migration-receipts)
7. [Database constraints reference](#7-database-constraints-reference)
8. [Domain rules & invariants](#8-domain-rules--invariants)
9. [Decision records](#9-decision-records)
10. [Migration, runbook & verification](#10-migration-runbook--verification)
11. [Public API contract](#11-public-api-contract)
12. [Search, filters and sorting controls (ERP1-18)](#12-search-filters-and-sorting-controls-erp1-18)
13. [Loading, empty, error and access-denied states (ERP1-19)](#13-loading-empty-error-and-access-denied-states-erp1-19)
14. [Product creation form with field-level validation (ERP1-20)](#14-product-creation-form-with-field-level-validation-erp1-20)
15. [Detail/edit workflow and linked records (ERP1-21)](#15-detailedit-workflow-and-linked-records-erp1-21)
16. [Migration Kit module metadata integration (ERP1-22)](#16-migration-kit-module-metadata-integration-erp1-22)
17. [Migration rejection, review, and export context (ERP1-23)](#17-migration-rejection-review-and-export-context-erp1-23)
18. [Entity-Relationship Diagram (ERD) & Ownership Boundaries (ERP1-24)](#18-entity-relationship-diagram-erd--ownership-boundaries-erp1-24)
19. [Requirement-to-Test Traceability Matrix (ERP1-24)](#19-requirement-to-test-traceability-matrix-erp1-24)
20. [Canonical Dirty Data Pack Plan & Defect Distribution (ERP1-24)](#20-canonical-dirty-data-pack-plan--defect-distribution-erp1-24)
21. [Gate G1 Review & Design Artifact Sign-Off (ERP1-24)](#21-gate-g1-review--design-artifact-sign-off-erp1-24)
22. [Public Import Endpoints & Idempotent Ingestion (ERP1-11)](#22-public-import-endpoints--idempotent-ingestion-erp1-11)
23. [Exact Duplicate Key Matching Policy & Human Review (ERP1-12)](#23-exact-duplicate-key-matching-policy--human-review-erp1-12)
24. [Idempotent Retry and Partial-Load Stop Behavior (ERP1-13)](#24-idempotent-retry-and-partial-load-stop-behavior-erp1-13)
25. [Module Authorization and Policy Integration (ERP1-15)](#27-module-authorization-and-policy-integration-erp1-15)
26. [Module Route and Page Registration in Shared Shell (ERP1-16)](#28-module-route-and-page-registration-in-shared-shell-erp1-16)
27. [Main Paginated Data Table (ERP1-17)](#29-main-paginated-data-table-erp1-17)
28. [Profiling Configuration & Expected-Result Assertions (ERP1-26)](#28-profiling-configuration--expected-result-assertions-erp1-26)

---

## 1. Ownership & boundaries

| Object | Owner | Notes |
|---|---|---|
| `erp1.categories` | ERP-1 | One-level product categories |
| `erp1.warehouses` | ERP-1 | Exactly one warehouse in V1 |
| `erp1.products` | ERP-1 | Product master data |
| `erp1.stock_levels` | ERP-1 | On-hand quantity per product/warehouse |
| `erp1.import_receipts` | ERP-1 | Durable KIT-08 import/idempotency receipts |
| `erp1.unit_of_measure` | ERP-1 | Fixed UOM enum |
| `public.schema_migrations` | Platform (PLT-03) | Shared migration ledger |

**Boundary.** Every ERP-1 foreign key points inside `erp1`. No sibling module or Migration Kit adapter writes directly to these tables; cross-module data is read through the owning module API or an approved read-only projection (Decision C7).

**SDS table names.** The SDS logical names `erp1_categories`, `erp1_products`, `erp1_warehouses`, `erp1_stock_levels` and the architecture receipt name `<module>_import_receipts` are represented as schema-qualified tables in the module schema: `erp1.categories`, `erp1.products`, `erp1.warehouses`, `erp1.stock_levels`, `erp1.import_receipts`. This is the same convention used by ERP-4 and ERP-5 and preserves both the frozen logical name and schema isolation. See DR-1.

---

## 2. `erp1.categories` — Product Categories

**Purpose**: Stores one-level product categories for catalog organization.  
**FR Reference**: FR-ERP1-03 (categories: one level only, name and code)

| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints | Business Rule | Example |
|---|---|---|---|---|---|---|---|
| `id` | `UUID` | `z.string().uuid()` | NOT NULL | `gen_random_uuid()` | Primary Key (PK) | FR-ERP1-03 | `'00000000-0000-4000-8000-000000000001'` |
| `name` | `VARCHAR(255)` | `z.string().min(1)` | NOT NULL | — | B-tree index | FR-ERP1-03 | `'General Hardware'` |
| `code` | `VARCHAR(64)` | `z.string().min(1)` | NOT NULL | — | UNIQUE `erp1_categories_code_idx` | FR-ERP1-03 | `'GEN'` |
| `created_at` | `TIMESTAMPTZ` | `z.string().datetime()` | NOT NULL | `now()` | Audit timestamp | PLT-01 | `'2026-04-01T08:00:00.000Z'` |
| `updated_at` | `TIMESTAMPTZ` | `z.string().datetime()` | NOT NULL | `now()` | Trigger `categories_set_updated_at` | PLT-01 | `'2026-04-01T08:00:00.000Z'` |

**Indexes**:
- `erp1_categories_code_idx` — UNIQUE on `(code)`
- `erp1_categories_name_idx` — B-tree on `(name)`

**Seed**: `GEN` / `General` with synthetic UUID `00000000-0000-4000-8000-000000000001`.

---

## 3. `erp1.warehouses` — Warehouses

**Purpose**: Stores the warehouse holding physical inventory. V1 operates with exactly one warehouse.

**FR Reference**: FR-ERP1-05 (one warehouse in V1; stock quantity per product)

| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints | Business Rule | Example |
|---|---|---|---|---|---|---|---|
| `id` | `UUID` | `z.string().uuid()` | NOT NULL | `gen_random_uuid()` | Primary Key (PK) | FR-ERP1-05 | `'00000000-0000-4000-8000-000000000002'` |
| `name` | `VARCHAR(255)` | `z.string().min(1)` | NOT NULL | — | Human-readable facility title | FR-ERP1-05 | `'Main Warehouse'` |
| `code` | `VARCHAR(64)` | `z.string().min(1)` | NOT NULL | — | UNIQUE `erp1_warehouses_code_idx` | FR-ERP1-05 | `'WH-01'` |
| `is_default` | `BOOLEAN` | `z.boolean()` | NOT NULL | `true` | Operating facility flag | FR-ERP1-05 | `true` |
| `(true)` | Constant expr | — | — | — | UNIQUE `erp1_warehouses_single_idx` | BR-ERP1-03 | Max 1 warehouse in V1 |
| `created_at` | `TIMESTAMPTZ` | `z.string().datetime()` | NOT NULL | `now()` | Audit timestamp | PLT-01 | `'2026-04-01T08:00:00.000Z'` |
| `updated_at` | `TIMESTAMPTZ` | `z.string().datetime()` | NOT NULL | `now()` | Trigger `warehouses_set_updated_at` | PLT-01 | `'2026-04-01T08:00:00.000Z'` |

**Indexes**:
- `erp1_warehouses_code_idx` — UNIQUE on `(code)`
- `erp1_warehouses_single_idx` — UNIQUE on the constant expression `(true)`; PostgreSQL rejects a second V1 warehouse

**Seed**: `WH-01` / `Main Warehouse` with synthetic UUID `00000000-0000-4000-8000-000000000002`.

---

## 4. `erp1.products` — Product Master Data

**Purpose**: Master records of items sold and tracked by the organization.  
**FR/BR Reference**: FR-ERP1-01, FR-ERP1-02, BR-ERP1-01

| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints | Business Rule | Example |
|---|---|---|---|---|---|---|---|
| `id` | `UUID` | `z.string().uuid()` | NOT NULL | `gen_random_uuid()` | Primary Key (PK) | FR-ERP1-01 | `'f47ac10b-58cc-4372-a567-0e02b2c3d479'` |
| `name` | `VARCHAR(255)` | `z.string().min(1)` | NOT NULL | — | B-tree index | FR-ERP1-01 | `'Stainless Steel Hex Bolt M8x50'` |
| `sku` | `VARCHAR(128)` | `z.string().min(1)` | NOT NULL | — | UNIQUE `erp1_products_sku_idx` | BR-ERP1-01 | `'FAST-BOLT-HEX-001'` |
| `normalized_sku` | `VARCHAR(128)` | `z.string().min(1)` | NOT NULL | — | UNIQUE `erp1_products_normalized_sku_idx` | BR-ERP1-01 | `'FAST-BOLT-HEX-001'` |
| `category_id` | `UUID` | `z.string().uuid().nullable()` | NULL | — | FK → `erp1.categories(id)` ON DELETE SET NULL | FR-ERP1-03 | `'00000000-0000-4000-8000-000000000001'` |
| `unit_of_measure` | `erp1.unit_of_measure` | `enum('pcs','kg','g','litre','metre','box')` | NOT NULL | — | Fixed enum type | FR-ERP1-04 | `'pcs'` |
| `price` | `NUMERIC(19, 4)` | `z.string().regex(/^\d+(\.\d{1,4})?$/)` | NOT NULL | — | CHECK `price >= 0` | FR-ERP1-02, BR-ERP1-01 | `'12.5000'` |
| `currency` | `VARCHAR(3)` | `z.string().regex(/^[A-Z]{3}$/)` | NOT NULL | — | CHECK `currency ~ '^[A-Z]{3}$'` | FR-ERP1-02 | `'USD'` |
| `tax_rate` | `NUMERIC(5, 2)` | `z.string()` | NOT NULL | `0.00` | CHECK `tax_rate >= 0` | FR-ERP1-02 | `'18.00'` |
| `source_system` | `VARCHAR(64)` | `z.string().nullable()` | NULL | — | Composite B-tree index with `source_id` | KIT-08 / BR-KIT-03 | `'SYNTH-ERP1-DIRTY-V1'` |
| `source_id` | `VARCHAR(128)` | `z.string().nullable()` | NULL | — | Composite B-tree index with `source_system` | KIT-08 / BR-KIT-03 | `'PRD-001'` |
| `golden_id` | `VARCHAR(64)` | `z.string().nullable()` | NULL | — | Cross-module golden identifier | ADR-003 | `'GLD-PRD-00001'` |
| `notification_email` | `VARCHAR(255)` | `z.string().email().nullable()` | NULL | — | RFC-5322 regex validation | RL-02 | `'ops@example.com'` |
| `contact_phone` | `VARCHAR(32)` | `z.string().nullable()` | NULL | — | International phone regex | RL-02 | `'+1-555-0100'` |
| `created_at` | `TIMESTAMPTZ` | `z.string().datetime()` | NOT NULL | `now()` | Audit timestamp | PLT-01 | `'2026-04-01T08:00:00.000Z'` |
| `updated_at` | `TIMESTAMPTZ` | `z.string().datetime()` | NOT NULL | `now()` | Trigger `products_set_updated_at` | PLT-01 | `'2026-04-01T08:00:00.000Z'` |

**Indexes & constraints**:
- `erp1_products_sku_idx` — UNIQUE on `(sku)`
- `erp1_products_normalized_sku_idx` — UNIQUE on `(normalized_sku)`
- `erp1_products_name_idx` — B-tree on `(name)`
- `erp1_products_category_id_idx` — B-tree on `(category_id)`
- `erp1_products_source_idx` — B-tree on `(source_system, source_id)`
- `check_erp1_products_price_non_negative` — CHECK `price >= 0`
- `check_erp1_products_tax_rate_non_negative` — CHECK `tax_rate >= 0`
- `check_erp1_products_currency_format` — CHECK uppercase ISO 4217 shape

---

## 5. `erp1.stock_levels` — Stock Quantities

**Purpose**: Current available inventory stock levels per product and warehouse.  
**FR/BR Reference**: FR-ERP1-06, BR-ERP1-02 (no negative stock)

| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints | Business Rule | Example |
|---|---|---|---|---|---|---|---|
| `id` | `UUID` | `z.string().uuid()` | NOT NULL | `gen_random_uuid()` | Primary Key (PK) | FR-ERP1-06 | `'7c9e6679-7425-40de-944b-e07fc1f90ae7'` |
| `product_id` | `UUID` | `z.string().uuid()` | NOT NULL | — | FK → `erp1.products(id)` ON DELETE CASCADE | FR-ERP1-06 | `'f47ac10b-58cc-4372-a567-0e02b2c3d479'` |
| `warehouse_id` | `UUID` | `z.string().uuid()` | NOT NULL | — | FK → `erp1.warehouses(id)` ON DELETE CASCADE | FR-ERP1-06 | `'00000000-0000-4000-8000-000000000002'` |
| `quantity` | `NUMERIC(19, 4)` | `z.string().regex(/^\d+(\.\d{1,4})?$/)` | NOT NULL | `0.0000` | CHECK `quantity >= 0`, UNIQUE `(product_id, warehouse_id)` | BR-ERP1-02 | `'500.0000'` |
| `updated_at` | `TIMESTAMPTZ` | `z.string().datetime()` | NOT NULL | `now()` | Trigger `stock_levels_set_updated_at` | PLT-01 | `'2026-04-01T08:00:00.000Z'` |

**Indexes & constraints**:
- `erp1_stock_levels_product_warehouse_idx` — UNIQUE on `(product_id, warehouse_id)`
- `check_erp1_stock_quantity_non_negative` — CHECK `quantity >= 0` (BR-ERP1-02)

**Opening stock**: loaded through the Migration Kit/controlled runner and written with
`INSERT ... ON CONFLICT (product_id, warehouse_id) DO UPDATE`. A repeated import
cannot create a second stock row for the same pair.

---

---

## 5. `erp1.import_receipts` — Durable Migration Receipts

**Purpose**: Records durable import receipts for idempotent migration loads in a single transaction.
**Architecture Reference**: Decision C4 & KIT-08

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `batch_id` | `UUID` | NOT NULL | — | Migration Kit batch UUID | B-tree index |
| `source_row` | `INTEGER` | NOT NULL | — | 0-indexed row position in source payload | — |
| `target_id` | `UUID` | NOT NULL | — | UUID of created/updated target record | — |
| `target_entity` | `VARCHAR(64)` | NOT NULL | `'product'` | Entity name | — |
| `idempotency_key` | `VARCHAR(255)` | NOT NULL | — | Deterministic unique key | UNIQUE |
| `source_system` | `VARCHAR(64)` | NULL | — | Originating import system | — |
| `source_id` | `VARCHAR(128)` | NULL | — | Source record identifier | — |
| `request_hash` | `VARCHAR(64)` | NOT NULL | `''` | SHA-256 of the canonical request payload; detects key reuse with different data | — |
| `outcome` | `VARCHAR(16)` | NOT NULL | `'loaded'` | Terminal receipt outcome | — |
| `response_payload` | `TEXT` | NULL | — | Durable JSON result replayed on an identical retry | — |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Creation timestamp | — |

**Indexes**:
- `erp1_import_receipts_idempotency_idx` — UNIQUE on `(idempotency_key)`
- `erp1_import_receipts_batch_idx` — B-tree on `(batch_id)`
- `erp1_import_receipts_batch_row_idx` — B-tree on `(batch_id, source_row_index)`

**Migration**: additive columns and the single-default-warehouse partial unique index are applied by `packages/database/migrations/erp1_v2.sql`.

---

## 6. `erp1.import_receipts` — Durable Migration Receipts

**Purpose**: Durable KIT-08 receipt proving a source row was loaded into a target entity. Written in the same PostgreSQL transaction as the target mutation.

**Architecture Reference**: Decision C4 & KIT-08

| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints | Business Rule | Example |
|---|---|---|---|---|---|---|---|
| `id` | `UUID` | `z.string().uuid()` | NOT NULL | `gen_random_uuid()` | Primary Key (PK) | KIT-08 / C4 | `'e27a9cf1-3312-4d02-86ee-71a07409249f'` |
| `batch_id` | `UUID` | `z.string().uuid()` | NOT NULL | — | Part of `erp1_import_receipts_batch_row_idx` | KIT-08 | `'11111111-2222-3333-4444-555555555555'` |
| `source_row` | `INTEGER` | `z.number().int()` | NOT NULL | — | CHECK `source_row >= 1` | KIT-08 | `42` |
| `entity` | `VARCHAR(64)` | `z.string().min(1)` | NOT NULL | — | Target entity identifier | KIT-08 | `'product'` |
| `schema_version` | `INTEGER` | `z.number().int()` | NOT NULL | `1` | CHECK `schema_version >= 1` | KIT-08 | `1` |
| `idempotency_key` | `VARCHAR(128)` | `z.string().min(1)` | NOT NULL | — | UNIQUE `erp1_import_receipts_idempotency_key_unique` | KIT-08 | `'sha256-hash-key-001'` |
| `target_id` | `UUID` | `z.string().uuid()` | NOT NULL | — | Target entity row UUID | KIT-08 | `'f47ac10b-58cc-4372-a567-0e02b2c3d479'` |
| `kind` | `VARCHAR(16)` | `enum('created', 'linked')` | NOT NULL | `'created'` | CHECK `kind IN ('created', 'linked')` | KIT-08 | `'created'` |
| `created_at` | `TIMESTAMPTZ` | `z.string().datetime()` | NOT NULL | `now()` | Immutable receipt timestamp | Audit | `'2026-04-01T08:00:00.000Z'` |

**Indexes & constraints**:
- `erp1_import_receipts_idempotency_key_unique` — UNIQUE on `(idempotency_key)`
- `erp1_import_receipts_batch_row_idx` — B-tree on `(batch_id, source_row)`
- `check_erp1_import_receipts_source_row_positive` — CHECK `source_row >= 1`
- `check_erp1_import_receipts_schema_version_positive` — CHECK `schema_version >= 1`
- `check_erp1_import_receipts_kind_allowed` — CHECK `kind IN ('created', 'linked')`

---

## 7. Database constraints reference

| Constraint Name | Table | Type | Expression / Enforcement |
|---|---|---|---|
| `erp1_categories_code_idx` | `erp1.categories` | UNIQUE | `code` is unique |
| `erp1_warehouses_code_idx` | `erp1.warehouses` | UNIQUE | `code` is unique |
| `erp1_warehouses_single_idx` | `erp1.warehouses` | UNIQUE | At most one warehouse exists in V1 |
| `erp1_products_sku_idx` | `erp1.products` | UNIQUE | `sku` is unique (BR-ERP1-01) |
| `erp1_products_normalized_sku_idx` | `erp1.products` | UNIQUE | `normalized_sku` is unique |
| `check_erp1_products_price_non_negative` | `erp1.products` | CHECK | `price >= 0` |
| `check_erp1_products_tax_rate_non_negative` | `erp1.products` | CHECK | `tax_rate >= 0` |
| `check_erp1_products_currency_format` | `erp1.products` | CHECK | `currency ~ '^[A-Z]{3}$'` |
| `erp1_stock_levels_product_warehouse_idx` | `erp1.stock_levels` | UNIQUE | Pair `(product_id, warehouse_id)` is unique |
| `check_erp1_stock_quantity_non_negative` | `erp1.stock_levels` | CHECK | `quantity >= 0` (BR-ERP1-02) |
| `erp1_import_receipts_idempotency_key_unique` | `erp1.import_receipts` | UNIQUE | A retried import row cannot create a second receipt |
| `check_erp1_import_receipts_kind_allowed` | `erp1.import_receipts` | CHECK | `kind IN ('created', 'linked')` |

---

## 8. Domain rules & invariants

1. **BR-ERP1-01: SKU is unique.** Enforced by PostgreSQL unique indexes on `sku` and `normalized_sku`, not only by application validation.
2. **BR-ERP1-02: No negative stock.** Enforced by `check_erp1_stock_quantity_non_negative`.
3. **FR-ERP1-03: Single-level categories.** No parent/child category column exists in V1.
4. **FR-ERP1-04: Fixed units of measure.** Enforced by the PostgreSQL enum.
5. **FR-ERP1-05: One warehouse.** Enforced by `erp1_warehouses_single_idx`; the V1 seed creates `WH-01`.
6. **Exact decimal handling.** Money uses `NUMERIC(19,4)`, quantities use `NUMERIC(19,4)`; no floating-point columns.
7. **Explicit currency.** Every product stores an uppercase ISO 4217 code; there is no implicit currency default.
8. **Migration idempotency.** `idempotency_key` is unique and opening stock is unique per product/warehouse pair.

### 8.1 Relationships, State Transitions & Read Model Consistency (ERP1-06)

**Issue**: [#11](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/11) — `[ERP1-06] ERP-1 Products and Inventory: Relationships, state transitions and read-model consistency`
**Implementation**: `apps/erp/modules/erp-1/src/domain/relationships.ts`, `apps/erp/modules/erp-1/src/domain/rules.ts`, `packages/contracts/src/erp-1.ts`, `tests/domain/relationships.test.ts`.

#### Rules & Invariants:
1. **Optional Relationship Handling (`handleOptionalRelationship`)**: When an optional relationship (e.g. `categoryId` on products) is absent, the module returns `null` along with the approved `ERP1_OPTIONAL_REFERENCE_ABSENT` warning code. It never fabricates synthetic or placeholder records.
2. **Provenance Pair Completeness (`assertSourceIdentityIsComplete`)**: `source_system` and `source_id` must be supplied together. Supplying one without the other is rejected with `SOURCE_IDENTITY_INCOMPLETE`.
3. **Fixed Enumeration Enforcement**:
   - `unit_of_measure`: Strictly validated against `['pcs', 'kg', 'g', 'litre', 'metre', 'box']` (`INVALID_UNIT_OF_MEASURE`).
   - `currency`: Validated against uppercase ISO 4217 3-letter codes (`INVALID_CURRENCY_CODE`).
   - `stock_status`: Derived and validated against `['out_of_stock', 'low_stock', 'in_stock']` (`INVALID_STOCK_STATUS`).
   - `product_status`: Validated against lifecycle statuses `['draft', 'active', 'discontinued', 'archived']` (`INVALID_PRODUCT_STATUS`).
4. **State Transition Matrices**:
   - **Stock Status Transitions**: Transitions between `out_of_stock`, `low_stock`, and `in_stock` are governed by authoritative physical stock balances. Any stock mutation resulting in negative quantities is strictly rejected with `NEGATIVE_STOCK` (BR-ERP1-02).
   - **Product Lifecycle Transitions**: Forward transitions follow `draft -> active -> discontinued -> archived`. Identical status updates are idempotent no-ops. `archived` is a terminal status; transitions out of `archived` are rejected with `INVALID_STATUS_TRANSITION`.
5. **Read Model Consistency**:
   - **Products**: Persisted entity and read projection agree on `normalizedSku === normalizeSku(sku)`, non-negative price with scale <= 4, non-negative tax rate with scale <= 2, and explicit currency.
   - **Stock Levels**: Quantity must be non-negative, and authoritative derived stock status matches `deriveStockStatus(quantity)`.
   - **Categories**: Invariant of single-level categories enforced; nested parent relationships (`parentId`) are rejected.
6. **Cross-Module Private Table Isolation**:
   - Sibling private tables (`erp2.*`, `erp3.*`, `erp4.*`, `erp5.*`, `crm.*`) are strictly prohibited from being written to by ERP-1. Cross-module reads resolve through contract-safe public reference resolvers (`Erp1ReferenceResolver`).

---

## 9. Decision records

### DR-1 — SDS logical table names map to the module schema

- **Conflict**: SDS §4.7 names `erp1_categories`, `erp1_products`, `erp1_warehouses`, `erp1_stock_levels`; the architecture also requires module-owned objects inside the module schema, and the receipt table follows `<id>_import_receipts`.
- **Decision**: The logical `erp1_` prefix is represented by the `erp1` schema and the frozen table short names: `erp1.categories`, `erp1.products`, `erp1.warehouses`, `erp1.stock_levels`, `erp1.import_receipts`.
- **Rationale**: This is the established ERP-4/ERP-5 convention and preserves both the frozen SDS name and schema isolation. No object is created in `public` except the shared migration ledger.

### DR-2 — Money and quantity precision

- **Conflict**: The original implementation used `NUMERIC(12,2)`.
- **Decision**: `price` and `quantity` use `NUMERIC(19,4)` as required by SDS §4.7 (money and quantities).
- **Rationale**: Exact decimal storage is mandatory; four decimal places cover fractional quantities and unit prices without floating-point drift.

### DR-3 — No implicit currency default

- **Conflict**: The original implementation silently defaulted `currency` to `USD`, but the SDS specifies only that currency is explicit and does not approve a V1 default.
- **Decision**: `currency` is `NOT NULL` with no database or contract default. Callers must supply an uppercase ISO 4217 code.
- **Rationale**: Removing the default avoids inventing an unapproved business rule and satisfies the “currency is explicit” invariant.

### DR-4 — One warehouse is a database invariant

- **Conflict**: A plain table allowed multiple warehouse rows even though FR-ERP1-05 says one warehouse in V1.
- **Decision**: A unique index on the constant expression `(true)` (`erp1_warehouses_single_idx`) rejects a second row. The seed creates one synthetic default warehouse.
- **Rationale**: Application-only checks are insufficient evidence for a V1 data invariant; PostgreSQL enforces it directly. V2 can replace this index with the approved multi-warehouse migration.

### DR-5 — Import receipts follow KIT-08

- **Conflict**: The original receipt table used non-standard `source_row_index`/`target_entity` fields and a 255-character key.
- **Decision**: Use the shared KIT-08 shape: `batch_id`, `source_row`, `entity`, `schema_version`, `idempotency_key` (`VARCHAR(128)`), `target_id`, `kind`, `created_at`.
- **Rationale**: The receipt must be compatible with the Migration Kit and the other modules’ target adapters.

### DR-6 — Opening stock and repeated imports

- **Decision**: Stock rows are unique per `(product_id, warehouse_id)`. The controlled loader uses an upsert on that pair, and the receipt table records the idempotency key in the same transaction.
- **Rationale**: Re-running an opening-stock import updates the existing row instead of duplicating it; a repeated receipt key is rejected by the database.

---

## 10. Migration, runbook & verification

**Apply once to a clean disposable database**:

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/clearshift_scratch npm run db:migrate
```

Expected: the runner reports `erp1_v1 applied successfully` and records `erp1_v1` in `public.schema_migrations`.

**Re-run**:

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/clearshift_scratch npm run db:migrate
```

Expected: the runner reports `Skipping erp1_v1 (already applied)`; it holds a session advisory lock so two deploy jobs cannot race.

**Live PostgreSQL proofs**:

```bash
DATABASE_URL_TEST=postgresql://user:pass@localhost:5432/postgres \
  npx vitest run apps/erp/modules/erp-1
```

The integration suite creates and drops a throwaway database, then proves clean apply, re-run skip, all unique/check/FK constraints, the one-warehouse rule, receipt idempotency, opening-stock upsert and `updated_at` triggers.

**Repository checks**:

```bash
npm run typecheck
npm run lint
npm test
```

---

## 11. Public API contract

Base: `/api/v1/erp-products`

| Method | Path | Purpose |
|---|---|---|
| GET | `/products` | Search name/SKU with bounded pagination |
| POST | `/products` | Create product with unique SKU and explicit currency |
| GET | `/products/{id}` | Read one product |
| PATCH | `/products/{id}` | Edit product |
| GET | `/categories` | List one-level categories |
| POST | `/categories` | Create category |
| PATCH | `/categories/{id}` | Edit category |
| GET | `/stock` | Read stock for a product/V1 warehouse |
| POST | `/stock/opening` | Set opening stock idempotently |

Request/response bodies are defined in `packages/contracts/src/erp-1.ts` and `packages/contracts/openapi/erp-1.yaml`.

---

## 12. Search, Filters and Sorting Controls (ERP1-04 / ERP1-18)

**Issues**: [#9](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/9) (`[ERP1-04] ERP-1 Products and Inventory: List screen, search/filter and stable empty/loading/error states`), [#114](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/114) (`[ERP1-18] ERP-1 Products and Inventory: Search, filters and sorting controls`)
**Implementation**: `apps/erp/modules/erp-1/web/src/` — API client, faceted sidebar, active filter pills, sorting controls, debounced search, and products list page.

### 12.1 Query Parameters (`GET /api/v1/erp-products/products`)

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `search` | `string` | No | — | Text search matched against product name and SKU (debounced 300ms on frontend) |
| `categoryId` | `UUID` | No | — | Filter products by category UUID |
| `unitOfMeasure` | `enum` | No | — | Filter by fixed V1 unit (`pcs`, `kg`, `g`, `litre`, `metre`, `box`) |
| `stockStatus` | `enum` | No | `all` | Filter by inventory stock status (`all`, `in_stock`, `low_stock`, `out_of_stock`) |
| `minPrice` | `decimal` | No | — | Filter products with price >= minPrice (numeric 19,4) |
| `maxPrice` | `decimal` | No | — | Filter products with price <= maxPrice (numeric 19,4) |
| `sortBy` | `enum` | No | `name` | Sort field (`name`, `sku`, `price`, `createdAt`, `quantity`) |
| `sortDirection` | `enum` | No | `asc` | Sort direction (`asc`, `desc`) |
| `page` | `integer` | No | `1` | 1-based page number (bounded) |
| `pageSize` | `integer` | No | `25` | Page size capped between 1 and 100 |

### 12.2 UI Operational Logic & Acceptance Criteria

1. **Debounced Search**: The search input debounces keystrokes with a 300ms pause to ensure one API request per word rather than firing per keystroke.
2. **Faceted Filter Sidebar**: Dedicated faceted sidebar allowing operators to filter by category, unit of measure, stock status, and price range.
3. **URL Query State Synchronization**: Every faceted filter and search term synchronizes to URL query search params (`?search=...&categoryId=...&unitOfMeasure=...&sortBy=...`), enabling shareable/bookmarkable URLs and browser history navigation.
4. **Active Filter Pill Tags**: Active filters render as removable pill tags. Clicking the clear button on an individual pill removes that filter, updates the URL query state, and reloads table results; a 'Clear All' button resets all filters simultaneously.
5. **Stable Empty States**: When search or filter queries return zero matching rows, the interface displays an informative empty state message (`No products match the selected filters or search query`) with a direct action to reset/clear filters.

---

## 13. Loading, Empty, Error and Access-Denied States (ERP1-04 / ERP1-19)

**Issues**: [#9](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/9) (`[ERP1-04] ERP-1 Products and Inventory: List screen, search/filter and stable empty/loading/error states`), [#115](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/115) (`[ERP1-19] ERP-1 Products and Inventory: Loading, empty, error and access-denied states`)
**Implementation**: `apps/erp/modules/erp-1/web/src/components/StateViews.tsx`, `ProductsListPage.tsx`, `theme.css`.

### 13.1 State Specifications & Acceptance Criteria

| State | Trigger Condition | Presentation | Actions Available | Retry Allowed? |
|---|---|---|---|---|
| **Loading** | Initial catalog fetch or parameter filter reload | Animated table skeleton (`role="status"`, `aria-busy="true"`) matching table header/cell shapes | None (busy/pending) | No |
| **Zero-Data Empty State** | Zero products recorded in the catalog (`total === 0` and no active filters) | Informative card (`📦`) explaining catalog is empty | Primary CTA button: `Add Product` (`onCreateProduct`) | No |
| **Filtered Empty State** | Active filter or search query returns zero matching records | Informative card (`🔍`) explaining no products match current filters | Primary CTA button: `Clear all filters` | Yes (clears filters) |
| **API Failure** | HTTP 500, Network failure, or unhandled server error | Accessible alert banner (`role="alert"`), sanitized message, Reference ID | Primary button: `Try Again` (`onRetry`) | Yes |
| **Access Denied** | HTTP 403 Forbidden or missing `inventory:read` permission | Dedicated access-denied region (`role="region"`), explaining missing capability | Guidance to contact administrator | **No** (never retry on 403) |

### 13.2 Security & Error Sanitization Rules

1. **Stack Trace Stripping**: Stack traces (`at ...`, `node_modules`, internal filesystem paths) are stripped via `sanitizeErrorMessage` to prevent leakage of internal server details.
2. **Database Error Masking**: Low-level SQL errors (e.g. syntax errors, connection timeouts, socket disconnects) are mapped to a secure generic message.
3. **Correlation ID Tracing**: Server error envelopes containing `correlation_id` display a user-friendly reference identifier for support diagnostics without exposing internal logs.

---

## 14. Product Creation Form with Field-Level Validation (ERP1-05 / ERP1-20)

**Issues**: [#10](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/10) (`[ERP1-05] ERP-1 Products and Inventory: Create/edit/detail workflow and client-side validation`), [#116](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/116) (`[ERP1-20] ERP-1 Products and Inventory: Create form with field-level validation`)
**Implementation**: `apps/erp/modules/erp-1/web/src/hooks/useProductForm.ts`, `ProductCreateModal.tsx`, `ProductsListPage.tsx`, `api/erp-1.ts`, `theme.css`.

### 14.1 Form Fields, Rules and Acceptance Criteria

| Field | Input Control | Type / Range | Required? | Validation Rule | Error Message |
|---|---|---|---|---|---|
| `name` | `<input type="text">` | `string` (trimmed) | **Yes** | Non-empty string | `Product name is required` |
| `sku` | `<input type="text">` | `string` (trimmed) | **Yes** | Unique SKU; normalized to uppercase | `SKU is required` |
| `categoryId` | `<select>` | `UUID` (null if unselected) | No | Optional reference to `erp1.categories` | — |
| `unitOfMeasure` | `<select>` | `enum` | **Yes** | One of `pcs`, `kg`, `g`, `litre`, `metre`, `box` | `Unit of measure is required` |
| `price` | `<input inputMode="decimal">` | `decimal(19,4)` | **Yes** | `^\d+(\.\d{1,4})?$`, numeric `>= 0` | `Price must be greater than or equal to 0` |
| `currency` | `<input type="text" maxLength={3}>` | ISO 4217 code | **Yes** | `^[A-Z]{3}$` uppercase code | `Currency must be an uppercase 3-letter ISO 4217 code (e.g. USD, EUR)` |
| `taxRate` | `<input inputMode="decimal">` | `decimal(5,2)` | No | `^\d+(\.\d{1,2})?$`, range `0.00` to `100.00` | `Tax rate must be between 0.00% and 100.00%` |
| `notificationEmail` | `<input type="email">` | `email` | No | Valid email format if provided | `Invalid email address format (e.g. alerts@example.com)` |
| `contactPhone` | `<input type="tel">` | `phone` | No | Valid phone format (`^\+?[0-9\s\-()]{7,20}$`) | `Invalid phone number format (min 7 digits, e.g. +1-555-019-2834)` |

### 14.2 Acceptance Criteria Verification

1. **Client-Side Validation (AC 1)**: `validateProductForm` performs synchronous validation checking all required fields, decimal ranges (`price >= 0`, `0.00 <= taxRate <= 100.00`), email address format, and international phone numbers prior to network submission.
2. **Double-Submission Prevention (AC 2)**: During in-flight request execution, `isSubmitting` disables the submission button (`disabled={isSubmitting}`, `aria-busy={isSubmitting}`), displays a busy indicator (`Creating...`), and prevents duplicate requests from triggering.
3. **Server Validation Error Mapping (AC 3)**: When the server returns HTTP 400 with an error envelope containing `details: [{ field, message }]`, errors map directly to the corresponding input fields (`errors[detail.field] = detail.message`). Corresponding form fields render with `role="alert"` and set `aria-invalid="true"`. Both camelCase and snake_case field keys are supported.
4. **Cache Update, Modal Closure & Confirmation Toast (AC 4)**: Successful submission automatically closes the modal dialog, prepends the new product to the client table cache (`products` list state and incremented `total`), and renders an accessible confirmation toast banner with `role="status"` and `aria-live="polite"` (`Product "[Name]" ([SKU]) created successfully.`).

---

## 15. Detail/Edit Workflow and Linked Records (ERP1-05 / ERP1-21)

**Issues**: [#10](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/10) (`[ERP1-05] ERP-1 Products and Inventory: Create/edit/detail workflow and client-side validation`), [#117](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/117) (`[ERP1-21] ERP-1 Products and Inventory: Detail/edit workflow and linked records`)
**Implementation**: `apps/erp/modules/erp-1/web/src/pages/ProductDetailPage.tsx`, `ProductAuditPanel.tsx`, `ProductLinkedRecordsTable.tsx`, `ProductEditDrawer.tsx`, `hooks/useProductEditForm.ts`, `api/erp-1.ts`, `theme.css`.

### 15.1 Architectural Scope & Acceptance Criteria

| Requirement | Implementation Component | Technical Specification | Gate Acceptance |
|---|---|---|:---:|
| **AC 1: Primary Attributes & Audit Metadata** | `ProductDetailPage.tsx`, `ProductAuditPanel.tsx` | Read-only attribute grid with Name, SKU, Category, UOM, Price, Currency, Tax Rate, Notification Email, Contact Phone; Audit panel with Internal UUID, Normalized SKU, Created At, Updated At, and canonical Golden ID badge. | **Pass** |
| **AC 2: Inline Edit & Drawer Form Workflows** | `ProductDetailPage.tsx`, `ProductEditDrawer.tsx`, `useProductEditForm.ts` | Allows modifying allowlisted fields (`name`, `categoryId`, `unitOfMeasure`, `price`, `currency`, `taxRate`, `notificationEmail`, `contactPhone`). SKU remains strictly immutable. Permission checking requires `inventory:write` or `products:write`. | **Pass** |
| **AC 3: Linked Master Records Sub-Tables** | `ProductLinkedRecordsTable.tsx` | Tabbed/stacked sub-tables for: (1) Warehouse inventory stocks with quantities and warehouse codes; (2) ERP-2 Purchasing lines with PO number, supplier vendor, and navigation link `/erp2/purchase-orders/:id`; (3) ERP-3 Sales lines with order number, customer Golden ID, line total, and navigation link `/erp3/orders/:id`. | **Pass** |
| **AC 4: Concurrent Conflict Handling (HTTP 409)** | `ProductDetailPage.tsx`, `ProductEditDrawer.tsx`, `useProductEditForm.ts` | On HTTP 409 Conflict (e.g. outdated optimistic version timestamp), displays an accessible conflict banner warning of concurrent changes, preventing silent data overwrite and providing a direct "Refresh and Re-apply Changes" CTA button. | **Pass** |

### 15.2 Allowlisted vs. Immutable Attributes

1. **Allowlisted Editable Attributes**:
   - `name`: Product title / description
   - `categoryId`: Product category reference
   - `unitOfMeasure`: One of the 6 fixed V1 units (`pcs`, `kg`, `g`, `litre`, `metre`, `box`)
   - `price`: Unit price formatted to SDS `decimal(19,4)`
   - `currency`: ISO 4217 uppercase 3-letter currency code
   - `taxRate`: Decimal percentage (`0.00` to `100.00`)
   - `notificationEmail`: Optional contact email
   - `contactPhone`: Optional contact telephone number
2. **Strictly Immutable Attributes**:
   - `sku` & `normalizedSku`: Non-modifiable to preserve relational integrity across barcodes, inventory transactions, and external references (BR-ERP1-01).
   - `id`: Internal immutable primary key UUID.
   - `createdAt`: Audit creation timestamp.
   - `sourceSystem` & `sourceId`: External sync provenance markers.

### 15.3 Concurrency & Error Envelope Mapping

- **409 Conflict Resolution**: When an update request encounters a concurrent modification conflict (`err.status === 409` or `err.code === 'CONFLICT'`), the form flags `isConflict = true`, sets `conflictMessage`, surfaces a warning alert, and prompts the user to refresh the record (`loadProductData()`) to view the latest changes before re-applying updates.
- **400 Validation Error Mapping**: Field-specific error details (`details: [{ field, message }]`) translate directly to input error states and set `aria-invalid="true"`.
- **403 Permission Gate**: If the user lacks write capabilities, action buttons are disabled and a clear read-only banner is displayed informing the operator that `inventory:write` is required.

---

## 16. Migration Kit Module Metadata Integration (ERP1-22)

**Issue**: [#118](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/118) — `[ERP1-22] ERP-1 Products and Inventory: Module metadata integration with shared Migration Kit wizard`  
**Implementation**: `packages/kit/src/domain/metadata.ts`, `packages/ui/src/components/MigrationKitWizard.tsx`, `apps/erp/modules/erp-1/src/kit/field-registry.ts`, `apps/erp/modules/erp-1/web/src/kit-metadata.ts`, `apps/erp/modules/erp-1/web/src/pages/ProductImportPage.tsx`.

### 16.1 Architectural Scope & Acceptance Criteria

| Requirement | Implementation Component | Technical Specification | Gate Acceptance |
|---|---|---|:---:|
| **AC 1: Module Metadata Registration** | `field-registry.ts`, `kit-metadata.ts`, `MigrationKitRegistry` | Registers ERP-1 target schema metadata across all 4 domain entities (Products, Categories, Warehouses, Stock Levels) into the central `migrationKitRegistry` without duplicating wizard infrastructure (H2). | **Pass** |
| **AC 2: Dynamic Rendering of Target Fields, Types & Badges** | `MigrationKitWizard.tsx` | Dynamically renders all target fields with human-readable labels, data type badges (`string`, `decimal`, `uuid`, `enum`), allowable enum options (`[pcs, kg, g, litre, metre, box]`), required badges, and governing rule IDs (`BR-ERP1-01`, `FR-ERP1-04`, `RL-01`). | **Pass** |
| **AC 3: Incompatible Source Type Operator Warnings** | `MigrationKitWizard.tsx`, `checkTypeCompatibility()` | Evaluates source column data types against target field definitions. Flags type mismatches (e.g. mapping `date` or `boolean` to `decimal` price or `enum` unit of measure) with an accessible operator warning banner and row-level alert. | **Pass** |
| **AC 4: Guard Blocking Unmapped Required Fields** | `MigrationKitWizard.tsx`, `validateFieldMapping()` | Enforces that all required target fields (`name`, `sku`, `unitOfMeasure`, `price`, `currency`) must be mapped before progressing. Renders a missing required fields banner and disables "Proceed to Dry-Run" and "Proceed to Load" actions. | **Pass** |

### 16.2 Entity Target Field Definitions

1. **Products (`erp1_products`)**:
   - `name`: string, required (FR-ERP1-01, RL-01). Human-readable product name.
   - `sku`: string, required (FR-ERP1-01, BR-ERP1-01, RL-03). Natural key, unique after normalization.
   - `categoryId`: uuid, optional (FR-ERP1-03). Single-level category reference.
   - `unitOfMeasure`: enum, required (FR-ERP1-04). Fixed V1 units: `pcs`, `kg`, `g`, `litre`, `metre`, `box`.
   - `price`: decimal(19,4), required (FR-ERP1-02, BR-ERP1-01). Non-negative selling price.
   - `currency`: string(3), required (FR-ERP1-02). ISO-4217 uppercase currency code.
   - `taxRate`: decimal(5,2), optional (FR-ERP1-02). Non-negative tax percentage.
   - `notificationEmail`: string, optional (RL-02). Inventory alert contact email.
   - `contactPhone`: string, optional (RL-02). Supplier contact phone.
   - `sourceSystem`: string, optional (KIT-08). Original provenance system.
   - `sourceId`: string, optional (KIT-08). Original legacy primary key.

2. **Categories (`erp1_categories`)**:
   - `name`: string, required (FR-ERP1-03). Category title.
   - `code`: string, required (FR-ERP1-03). Unique code.

3. **Warehouses (`erp1_warehouses`)**:
   - `name`: string, required (FR-ERP1-05). Storage facility title.
   - `code`: string, required (FR-ERP1-05). Unique warehouse code.
   - `isDefault`: boolean, optional (FR-ERP1-05). Designates primary facility.

4. **Stock Levels (`erp1_stock_levels`)**:
   - `productId`: uuid, required (FR-ERP1-06). Reference to product master.
   - `warehouseId`: uuid, required (FR-ERP1-06). Reference to warehouse.
   - `quantity`: decimal(19,4), required (FR-ERP1-06, BR-ERP1-02). Non-negative physical stock quantity.

### 16.3 Source-to-Target Type Compatibility Rules

| Target Type | Supported Source Types | Warning Scenarios | Incompatible / Error Scenarios |
|---|---|---|---|
| `string` | Any source type | Coerced to string | None |
| `decimal` / `number` | `number`, `integer`, `float`, `decimal` | `string` / `text` (parsed dynamically) | `date`, `boolean`, `uuid` |
| `boolean` | `boolean`, `bool` | `string`, `number` (coerced 1/0, true/false) | `date`, `uuid` |
| `date` | `date`, `datetime`, `timestamp` | `string` (must match ISO-8601 YYYY-MM-DD) | `number`, `boolean`, `uuid` |
| `enum` | `string`, `text` (exact match) | `string` (warns allowed enum options) | `number`, `date`, `boolean`, `uuid` |
| `uuid` | `uuid` | `string` (must match RFC-4122 format) | `number`, `date`, `boolean` |

---

## 17. Migration Rejection, Review, and Export Context (ERP1-23)

**Issue**: [#119](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/119) — `[ERP1-23] ERP-1 Products and Inventory: Module context in shared rejection/review/export screens`  
**Implementation**: `packages/kit/src/domain/rejection.ts`, `packages/ui/src/components/RejectionReviewScreen.tsx`, `apps/erp/modules/erp-1/src/kit/rejection-context.ts`, `apps/erp/modules/erp-1/web/src/pages/ProductRejectionReviewPage.tsx`.

### 17.1 Module Identifier Columns (AC1)

The shared Migration Kit rejection review interface dynamically displays ERP-1's primary identifier and business columns:

| Column | Field | Role | Formatting / Constraints |
|---|---|---|---|
| **Source Row** | `sourceRow` | Line Number | 1-based source file line reference |
| **Error Code** | `errorCode` | Standard Code | Formatted as high-contrast red badge (`data-testid="error-code-badge"`) |
| **SKU** | `sku` | Primary Natural Identifier | Normalized uppercase string; badged with `ID` pill |
| **Product Name** | `name` | Primary Identifier | Human-readable catalog title |
| **Source ID** | `sourceId` | Provenance Key | Legacy primary key preserved without mutation (KIT-08) |
| **Category Code** | `categoryCode` | Category Reference | Associated category natural code |
| **Unit of Measure** | `unitOfMeasure` | Secondary Context | V1 unit of measure (`pcs`, `kg`, `g`, `litre`, `metre`, `box`) |
| **Unit Price** | `price` | Financial Context | Decimal selling price |

### 17.2 Standardized Error Codes & Failure Explanations (AC2)

| Error Code | Title | Failure Explanation | Doc Ref | Remediation Guidance |
|---|---|---|---|---|
| `DUPLICATE_SKU` | Duplicate SKU | SKU is already registered after normalization (BR-ERP1-01). SKUs must be globally unique across active and archived records. | BR-ERP1-01 | Verify existing catalog in ERP-1 or re-map source SKU. |
| `INVALID_UNIT_OF_MEASURE` | Invalid Unit of Measure | Unit of measure must be one of the approved V1 units: pcs, kg, g, litre, metre, box (FR-ERP1-04). | FR-ERP1-04 | Standardize unit to one of the 6 allowed V1 units. |
| `NEGATIVE_PRICE` | Negative Unit Price | Product unit price cannot be negative (FR-ERP1-02). Must be a decimal >= 0.0000. | FR-ERP1-02 | Ensure unit price is non-negative. |
| `INVALID_TAX_RATE` | Invalid Tax Rate | Tax rate must be a valid decimal between 0.0000 and 1.0000 (FR-ERP1-02). Percentages (e.g. 18%) must be formatted as decimals (0.1800). | FR-ERP1-02 | Divide percentage by 100 to produce decimal rate between 0.0000 and 1.0000. |
| `NEGATIVE_STOCK` | Negative Stock Level | Stock quantity cannot be negative (BR-ERP1-02 / FR-ERP1-06). Minimum stock level is 0. | BR-ERP1-02 | Reconcile warehouse inventory quantity. |
| `INVALID_CATEGORY` | Category Not Found | Referenced category code does not exist in erp1_categories (FR-ERP1-03). | FR-ERP1-03 | Import or create categories prior to importing products. |
| `MISSING_REQUIRED_FIELD` | Missing Mandatory Field | A required product field (such as Name, SKU, or Unit of Measure) is missing or blank. | FR-ERP1-01 | Populate all mandatory columns in source data before importing. |
| `MULTIPLE_WAREHOUSES_REJECTED` | Multiple Warehouses Not Supported | V1 scope strictly supports a single warehouse (BR-ERP1-03). Second warehouse was rejected. | BR-ERP1-03 | Assign all inventory to the primary default warehouse. |
| `SOURCE_VALUE_MUTATED` | Raw Source Value Alteration | Raw source values must be preserved without destructive mutation (KIT-08). | KIT-08 | Retain original sourceSystem and sourceId untouched. |

### 17.3 Sensitive Field Masking (AC3)

All sensitive financial, bank, or employee fields are automatically masked or excluded from review tables, payload inspector modals, and CSV downloads:
- **Credentials & Passwords**: `[REDACTED]`
- **Bank Accounts & Card Numbers**: `****-****-XXXX` (last 4 characters preserved)
- **Government Tax IDs & SSNs**: `***-**-XXXX` (last 4 characters preserved)
- **Employee Salaries**: `[CONFIDENTIAL SALARY]`

### 17.4 Formula-Safe CSV Export (AC4)

Rejection exports conform strictly to OWASP CSV Injection mitigation guidelines (PLT-12 / KIT-16):
- Any cell value starting with `=`, `+`, `-`, `@`, `\t`, or `\r` (after leading whitespace) is neutralized with a single-quote prefix (`'`).
- Export includes all standardized headers: `"Source Row"`, `"Error Code"`, `"Error Title"`, `"Reason"`, `"Doc Reference"`, `"Resolution"`, `"SKU"`, `"Product Name"`, `"Source ID"`, `"Failed Field"`.
- Filtering is preserved: exporting with active filters downloads only the matching subset of rejected rows.

---

## 18. Entity-Relationship Diagram (ERD) & Ownership Boundaries (ERP1-24)

**Issue**: [#120](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/120) — `[ERP1-24] ERP-1 Products and Inventory: Data dictionary, ERD, traceability and Dirty Data Pack plan`  
**Governing Architecture**: SDS ClearShift ERP v2.0 §4.2, §4.7; Master Architecture Spec §5, Decision C4, C7.

### 18.1 Master Data Ownership Boundaries

1. **Authoritative System of Record (SoR)**: ERP-1 is the sole, authoritative master-data owner for product definitions, single-level categories, operating warehouses, and physical stock levels.
2. **Zero Cross-Schema Database Foreign Keys (Decision C7)**: Cross-module consumers (ERP-2 Vendors & Purchasing, ERP-3 Sales & Invoicing, CRM-2 Quotes) **never** establish direct PostgreSQL foreign keys into schema `erp1`. All cross-module integrity validation occurs at runtime via the `@cs/kernel` `ReferenceResolver` interface or public OpenAPI endpoints.
3. **Internal Relational Integrity**:
   - `erp1.products.category_id` references `erp1.categories.id` (`ON DELETE SET NULL`).
   - `erp1.stock_levels.product_id` references `erp1.products.id` (`ON DELETE CASCADE`).
   - `erp1.stock_levels.warehouse_id` references `erp1.warehouses.id` (`ON DELETE CASCADE`).
4. **V1 Single-Warehouse Boundary (BR-ERP1-03 / FR-ERP1-05)**: Enforced via PostgreSQL expression index `UNIQUE ((true))` (`erp1_warehouses_single_idx`). Any attempt to insert a second warehouse is rejected at the database engine level.
5. **Durable Migration Ingestion (KIT-08 / Decision C4)**: Migration Kit target adapters execute mutations atomically with durable import receipts (`erp1.import_receipts`) inside a single PostgreSQL transaction.

### 18.2 Mermaid Entity-Relationship Diagram

```mermaid
erDiagram
    %% ERP-1 Core Schema Boundaries
    erp1_categories {
        uuid id PK "gen_random_uuid()"
        varchar name "NOT NULL, category name"
        varchar code UK "NOT NULL, unique identifier"
        timestamptz created_at "NOT NULL, audit creation"
        timestamptz updated_at "NOT NULL, trigger updated_at"
    }

    erp1_warehouses {
        uuid id PK "gen_random_uuid()"
        varchar name "NOT NULL, facility description"
        varchar code UK "NOT NULL, unique identifier"
        boolean is_default "NOT NULL, default true"
        timestamptz created_at "NOT NULL, audit creation"
        timestamptz updated_at "NOT NULL, trigger updated_at"
    }

    erp1_products {
        uuid id PK "gen_random_uuid()"
        varchar name "NOT NULL, product name"
        varchar sku UK "NOT NULL, unique natural key"
        varchar normalized_sku UK "NOT NULL, unique uppercase/trimmed"
        uuid category_id FK "NULLABLE, FK to erp1_categories"
        unit_of_measure unit_of_measure "NOT NULL, enum: pcs,kg,g,litre,metre,box"
        numeric price "NOT NULL, CHECK price >= 0"
        varchar currency "NOT NULL, CHECK currency ~ '^[A-Z]{3}$'"
        numeric tax_rate "NOT NULL, DEFAULT 0.00, CHECK tax_rate >= 0"
        varchar source_system "NULLABLE, migration provenance"
        varchar source_id "NULLABLE, legacy primary key"
        varchar golden_id "NULLABLE, canonical entity ID"
        varchar notification_email "NULLABLE, alert contact"
        varchar contact_phone "NULLABLE, vendor phone"
        timestamptz created_at "NOT NULL, audit creation"
        timestamptz updated_at "NOT NULL, trigger updated_at"
    }

    erp1_stock_levels {
        uuid id PK "gen_random_uuid()"
        uuid product_id FK "NOT NULL, FK to erp1_products"
        uuid warehouse_id FK "NOT NULL, FK to erp1_warehouses"
        numeric quantity "NOT NULL, DEFAULT 0.0000, CHECK quantity >= 0"
        timestamptz updated_at "NOT NULL, trigger updated_at"
    }

    erp1_import_receipts {
        uuid id PK "gen_random_uuid()"
        uuid batch_id "NOT NULL, migration batch UUID"
        integer source_row "NOT NULL, CHECK source_row >= 1"
        varchar entity "NOT NULL, product or stock_level"
        integer schema_version "NOT NULL, DEFAULT 1"
        varchar idempotency_key UK "NOT NULL, unique deterministic hash"
        uuid target_id "NOT NULL, created/linked target row UUID"
        varchar kind "NOT NULL, CHECK kind IN ('created', 'linked')"
        timestamptz created_at "NOT NULL, receipt creation"
    }

    %% ERP-1 Internal Entity Relationships
    erp1_categories ||--o{ erp1_products : "categorizes (1 to 0..*)"
    erp1_products ||--o{ erp1_stock_levels : "inventory tracked per warehouse"
    erp1_warehouses ||--o{ erp1_stock_levels : "holds product stock"
    erp1_products ||--o{ erp1_import_receipts : "lineage receipt (KIT-08)"

    %% Cross-Module Architectural Boundaries (Runtime Port / API Contract Only)
    erp2_po_lines }o..|| erp1_products : "references product via ReferenceResolver (Decision C7)"
    erp3_so_lines }o..|| erp1_products : "references product via ReferenceResolver (Decision C7)"
    erp3_invoice_lines }o..|| erp1_products : "references product via ReferenceResolver (Decision C7)"
    crm2_quotes }o..|| erp1_products : "reads product and price via API Contract"
```

---

## 19. Requirement-to-Test Traceability Matrix (ERP1-24)

Every functional requirement, domain rule, and platform architectural invariant is mapped directly to its automated verification test suites:

| Requirement / Invariant ID | Source Specification | Implementation Mechanism | Automated Verification Test Suite | Gate G1 Status |
|---|---|---|---|:---:|
| **FR-ERP1-01** | SDS §4.2 | Product catalog master schema, CRUD endpoints | `apps/erp/modules/erp-1/tests/db/schema.test.ts`<br>`apps/erp/modules/erp-1/tests/api/products.test.ts` | **Verified** |
| **FR-ERP1-02** | SDS §4.2, §4.7 | Explicit uppercase ISO 4217 currency, decimal(19,4) price, non-negative tax | `packages/contracts/tests/erp-1.test.ts`<br>`apps/erp/modules/erp-1/tests/api/products.test.ts` | **Verified** |
| **FR-ERP1-03** | SDS §4.2 | Single-level categories (name & code, no hierarchy) | `apps/erp/modules/erp-1/tests/db/schema.test.ts`<br>`apps/erp/modules/erp-1/tests/api/categories.test.ts` | **Verified** |
| **FR-ERP1-04** | SDS §4.2 | Fixed V1 units of measure (`pcs`, `kg`, `g`, `litre`, `metre`, `box`) | `packages/contracts/tests/erp-1.test.ts`<br>`apps/erp/modules/erp-1/tests/migration/dirty-data-plan.test.ts` | **Verified** |
| **FR-ERP1-05** | SDS §4.2 | Exactly one warehouse in V1 (`WH-01`) | `apps/erp/modules/erp-1/tests/db/schema.test.ts`<br>`apps/erp/modules/erp-1/tests/migration/dirty-data-plan.test.ts` | **Verified** |
| **FR-ERP1-06** | SDS §4.2 | Physical stock quantity tracking per product/warehouse | `apps/erp/modules/erp-1/tests/db/schema.test.ts`<br>`apps/erp/modules/erp-1/tests/api/stock.test.ts` | **Verified** |
| **BR-ERP1-01** | SDS §4.2 | SKU uniqueness after uppercase and trim normalization | `apps/erp/modules/erp-1/tests/db/schema.test.ts`<br>`apps/erp/modules/erp-1/tests/migration/dirty-data-plan.test.ts` | **Verified** |
| **BR-ERP1-02** | SDS §4.2 | Non-negative stock quantity (`quantity >= 0`) | `apps/erp/modules/erp-1/tests/db/schema.test.ts`<br>`apps/erp/modules/erp-1/tests/migration/dirty-data-plan.test.ts` | **Verified** |
| **BR-ERP1-03** | Master Spec §6.1 | Single warehouse DB invariant (`erp1_warehouses_single_idx`) | `apps/erp/modules/erp-1/tests/db/schema.test.ts`<br>`apps/erp/modules/erp-1/tests/migration/dirty-data-plan.test.ts` | **Verified** |
| **KIT-08 / C4** | Master Spec §4.1 | Dual-write atomic transaction + durable import receipts | `apps/erp/modules/erp-1/tests/kit/field-registry.test.ts`<br>`packages/contracts/tests/erp-1.test.ts` | **Verified** |
| **BR-KIT-03** | Migration SDS | Raw source input values immutable during profiling/cleaning | `apps/erp/modules/erp-1/tests/migration/dirty-data-plan.test.ts` | **Verified** |
| **PLT-12 / KIT-16** | Security Policy | OWASP formula injection neutralization on CSV import/export | `packages/kit/tests/rejection.test.ts`<br>`apps/erp/modules/erp-1/tests/migration/dirty-data-plan.test.ts` | **Verified** |
| **ADR-003** | ADR Catalog | Cross-module Golden ID integration (`GLD-PRD-XXXXX`) | `apps/erp/modules/erp-1/web/tests/ProductDetailPage.test.tsx` | **Verified** |
| **ERP1-18** | Issue #114 | Search, faceted filters (Category, UOM, Stock), and sorting | `apps/erp/modules/erp-1/web/tests/ProductsListPage.test.tsx` | **Verified** |
| **ERP1-19** | Issue #115 | Loading skeletons, zero-data empty, filtered empty, 403 access-denied | `apps/erp/modules/erp-1/web/tests/screen-states.test.tsx` | **Verified** |
| **ERP1-20** | Issue #116 | Product creation form with field validation & double-submit guard | `apps/erp/modules/erp-1/web/tests/ProductCreateModal.test.tsx` | **Verified** |
| **ERP1-21** | Issue #117 | Detail/edit drawer workflow, linked records, HTTP 409 conflict handling | `apps/erp/modules/erp-1/web/tests/ProductDetailPage.test.tsx` | **Verified** |
| **ERP1-22** | Issue #118 | Migration Kit field registry & type compatibility checks | `apps/erp/modules/erp-1/tests/kit/field-registry.test.ts`<br>`apps/erp/modules/erp-1/web/tests/MigrationKitWizard.test.tsx` | **Verified** |
| **ERP1-23** | Issue #119 | Rejection review context, sensitive masking, formula-safe CSV export | `apps/erp/modules/erp-1/tests/kit/rejection-context.test.ts`<br>`apps/erp/modules/erp-1/web/tests/RejectionReviewScreen.test.tsx` | **Verified** |
| **ERP1-24** | Issue #120 | Data dictionary, ERD, traceability & canonical Dirty Data Pack plan | `apps/erp/modules/erp-1/tests/migration/dirty-data-plan.test.ts`<br>`packages/contracts/tests/erp-1.test.ts` | **Verified** |

---

## 20. Canonical Dirty Data Pack Plan & Defect Distribution (ERP1-24)

### 20.1 Plan Overview & Principles

The ERP-1 Dirty Data Pack is a deterministic synthetic dataset designed to prove the entire 7-step Migration Kit pipeline (**Extract, Profile, Clean, Map, Load, Validate, Reconcile**) against real-world messiness without utilizing any real customer or employee PII.

- **Committed Fixture**: [`sample-data/erp-1/dirty-data-v1.csv`](../../sample-data/erp-1/dirty-data-v1.csv)
- **Expected Profile Report**: [`sample-data/erp-1/expected-profile.json`](../../sample-data/erp-1/expected-profile.json)
- **Mapping Template**: [`sample-data/erp-1/mapping-template.json`](../../sample-data/erp-1/mapping-template.json)
- **Rules Engine & Profile Evaluator**: [`apps/erp/modules/erp-1/src/migration/dirty-data-plan.ts`](../src/migration/dirty-data-plan.ts)
- **Automated Regression Suite**: [`apps/erp/modules/erp-1/tests/migration/dirty-data-plan.test.ts`](../tests/migration/dirty-data-plan.test.ts)

### 20.2 Synthetic Edge-Case Scenarios

The Dirty Data Pack exercises 12 distinct failure categories across all 4 entity types with 131 deterministic synthetic rows (zero real PII):
1. **Natural Key Duplication**: Exact SKU duplicates (`FAST-BOLT-HEX-001`) and case/whitespace variations (`  fast-bolt-hex-001  `). Candidate duplicates receive terminal outcome `review` and are held in the deduplication queue; automatic destructive merges are forbidden.
2. **Missing Mandatory Fields**: Omitted product name, blank SKU, omitted unit of measure, blank price, missing currency, blank category code, missing warehouse code, and missing stock quantity.
3. **Invalid Enumerations**: Non-standard units of measure (`gallons`, `inches`, `pallets`).
4. **Decimal Out-of-Bounds & Boundary Numbers**: Zero price (`0.0000`), min 4-decimal price (`0.0001`), upper boundary price (`99999999.9999`), negative price (`-15.5000`), boundary negative price (`-0.0001`), non-numeric price (`TWENTY_BUCKS`), excess decimal places (> 4 decimal digits: `12.34567`).
5. **Currency Violations**: Non-standard currency codes (`US`, `123`), missing currency values, and whitespace-padded currency (`  USD  `).
6. **Tax Rate Violations**: Boundary zero tax (`0.00`), boundary maximum tax (`100.00`), negative tax percentage (`-5.00`), boundary negative tax (`-0.01`), percentage overflow (`125.00%`), boundary overflow (`100.01%`), and non-numeric strings (`EIGHTEEN_PCT`).
7. **Referential Integrity Failures**: Products referencing unregistered category codes (`NON_EXISTENT_CAT`); stock balances referencing unknown SKUs (`UNKNOWN-PRODUCT-999`, `UNKNOWN-PRODUCT-888`) or unknown warehouse codes (`WH-UNKNOWN`, `DEPOT-99`).
8. **Negative Stock Levels & Boundary Quantities**: Zero stock balance (`0.0000`), min decimal stock (`0.0001`), upper boundary stock (`99999999.9999`), negative inventory stock quantity (`-50.0000`), and boundary negative stock (`-0.0001`), violating domain rule BR-ERP1-02.
9. **Multi-Warehouse Violations**: Attempts to register secondary facilities (`WH-02`, `WH-03`, `DEPOT-NORTH`), violating BR-ERP1-03 / FR-ERP1-05.
10. **Security & Formula Injection Payloads**: Text containing spreadsheet formula execution prefixes (`=cmd|' /C calc'!A0`, `+12345FormulaInj`, `@SUM(1,2)FormulaInj`, `-999FormulaInj`, `\tTabFormulaInj`), rejected per PLT-12 / KIT-16; synthetic bank accounts (`CH93-0000-0000-0000-1234-5`) and SSNs (`999-00-1234`) to prove review-view masking.
11. **International UTF-8 Characters**: Accented French names (`Écrou Hexagonal Zingué M10`), German with umlauts and diameter symbol (`Schraube M8 Edelstahl Rostfrei Ø8mm`), Spanish with Greek Omega (`Resistencia Térmica 10kΩ`), Japanese Kanji/Katakana (`高精度リニアガイド 500mm`), and accented category codes/names (`MÉC` / `Mécanique & Automatismes`).
12. **Date Format Variants & Ambiguity**: Valid ISO-8601 timestamps (`2026-04-01`, `2026-04-01T08:00:00Z`), ambiguous date formats (`04/05/2026`, `01-04-2026` rejected with `AMBIGUOUS_DATE_FORMAT`), non-existent calendar dates (`2026-02-30` rejected with `INVALID_DATE`), and invalid date strings (`invalid-calendar-date`).

### 20.3 Reconciliation Equation & Defect Distributions

The reconciliation equation guarantees 100% accounting of all source records:
$$\text{total\_source\_rows} = \text{accepted} + \text{rejected} + \text{review} + \text{skipped}$$
$$\text{unaccounted} = 0$$

#### Reconciliation Summary
| Metric | Value | Meaning |
|---|---|---|
| **Total Source Rows** | `131` | Total records in `dirty-data-v1.csv` |
| **Accepted** | `69` | Valid rows ready for target ingestion |
| **Rejected** | `55` | Rows failing validation, format, or invariant rules |
| **Review** | `7` | Candidate duplicates held for operator review |
| **Skipped** | `0` | Skipped records (none in V1) |
| **Unaccounted** | `0` | Zero orphan or unclassified rows |
| **Is Balanced?** | **`true`** | Mathematical balance achieved |

#### Breakdown by Entity Record Type
| Record Type | Total | Accepted | Rejected | Review | Skipped | Pass Rate |
|---|---|---|---|---|---|---|
| **`category`** | 15 | 8 | 5 | 2 | 0 | 53.3% |
| **`warehouse`** | 6 | 1 | 5 | 0 | 0 | 16.7% |
| **`product`** | 65 | 35 | 27 | 3 | 0 | 53.8% |
| **`stock_level`** | 45 | 25 | 18 | 2 | 0 | 55.6% |
| **Total** | **131** | **69** | **55** | **7** | **0** | **52.7%** |

#### Defect Distribution by Reason Code
| Reason Code | Count | Failure Condition / Description | Doc Reference |
|---|---|---|---|
| `CATEGORY_CODE_REQUIRED` | 1 | Category code is missing or whitespace | FR-ERP1-03 |
| `CATEGORY_NAME_REQUIRED` | 1 | Category name is missing or whitespace | FR-ERP1-03 |
| `CATEGORY_CODE_TOO_LONG` | 1 | Category code exceeds 64 characters | FR-ERP1-03 |
| `DUPLICATE_CATEGORY_CODE_REVIEW` | 2 | Category code already registered in batch | FR-ERP1-03 |
| `FORMULA_INJECTION_DETECTED` | 9 | Cell starts with formula prefix (=, +, -, @, \t, \r) | PLT-12 / KIT-16 |
| `MULTIPLE_WAREHOUSES_REJECTED` | 4 | Secondary warehouse attempted (WH-02, WH-03, DEPOT) | FR-ERP1-05 / BR-ERP1-03 |
| `WAREHOUSE_CODE_REQUIRED` | 1 | Warehouse code is missing or whitespace | FR-ERP1-05 |
| `WAREHOUSE_NAME_REQUIRED` | 1 | Warehouse name is missing or whitespace | FR-ERP1-05 |
| `DUPLICATE_SKU_REVIEW` | 3 | Normalized SKU already exists in catalog or batch | BR-ERP1-01 |
| `PRODUCT_NAME_REQUIRED` | 1 | Product name is missing or whitespace | FR-ERP1-01 |
| `SKU_REQUIRED` | 1 | SKU natural key is missing | FR-ERP1-01 / BR-ERP1-01 |
| `UNIT_OF_MEASURE_REQUIRED` | 1 | Unit of measure is missing | FR-ERP1-04 |
| `INVALID_UNIT_OF_MEASURE` | 3 | Unit not in approved list (gallons, inches, pallets) | FR-ERP1-04 |
| `PRICE_REQUIRED` | 1 | Selling price is missing | FR-ERP1-02 |
| `NEGATIVE_PRICE` | 2 | Selling price is negative (< 0.0000) | FR-ERP1-02 / BR-ERP1-01 |
| `INVALID_PRICE_FORMAT` | 1 | Non-numeric price string | FR-ERP1-02 |
| `EXCESS_DECIMAL_PLACES` | 2 | Decimal value exceeds 4 decimal places (price or stock) | SDS §4.7 |
| `CURRENCY_REQUIRED` | 1 | Currency is missing | FR-ERP1-02 |
| `INVALID_CURRENCY` | 2 | Currency not 3-letter ISO-4217 uppercase code | FR-ERP1-02 |
| `NEGATIVE_TAX_RATE` | 2 | Tax percentage is negative (< 0.00) | FR-ERP1-02 |
| `TAX_RATE_OUT_OF_RANGE` | 2 | Tax percentage exceeds 100.00% | FR-ERP1-02 |
| `INVALID_TAX_RATE_FORMAT` | 1 | Non-numeric tax rate representation | FR-ERP1-02 |
| `CATEGORY_NOT_FOUND` | 1 | Referenced category not found in registry | FR-ERP1-03 |
| `INVALID_EMAIL_FORMAT` | 1 | Email does not match RFC-5322 regex | RL-02 |
| `INVALID_PHONE_FORMAT` | 1 | Phone does not match international pattern | RL-02 |
| `DUPLICATE_STOCK_LEVEL_REVIEW` | 2 | Repeated opening stock for product/warehouse | FR-ERP1-06 / DR-6 |
| `NEGATIVE_STOCK` | 3 | Inventory quantity is negative (< 0.0000) | BR-ERP1-02 / FR-ERP1-06 |
| `PRODUCT_NOT_FOUND` | 3 | Referenced SKU not found in catalog | FR-ERP1-06 |
| `PRODUCT_REQUIRED` | 2 | Stock record missing SKU reference | FR-ERP1-06 |
| `WAREHOUSE_NOT_FOUND` | 2 | Stock record references unknown warehouse | FR-ERP1-05 |
| `WAREHOUSE_REQUIRED` | 3 | Stock record missing warehouse code | FR-ERP1-05 |
| `INVALID_QUANTITY_FORMAT` | 1 | Non-numeric stock quantity string | FR-ERP1-06 |
| `QUANTITY_REQUIRED` | 3 | Stock quantity is missing | FR-ERP1-06 |
| `AMBIGUOUS_DATE_FORMAT` | 2 | Ambiguous date format (MM/DD/YYYY or DD-MM-YYYY) | FR-ERP1-06 / SDS §4.7 |
| `INVALID_DATE` | 2 | Date is not a valid calendar date | FR-ERP1-06 |

### 20.4 Per-Row Manifest Documentation

In compliance with Migration Kit Gate G1 standards, [`sample-data/erp-1/expected-profile.json`](../../sample-data/erp-1/expected-profile.json) includes a comprehensive `rows` mapping documenting the expected terminal outcome and failure reason codes for every individual source record from `R001` through `R131`. Every row is verified by automated regression test suites to reproduce identical outcomes across repeated runs.

---

## 21. Gate G1 Review & Design Artifact Sign-Off (ERP1-24)

### 21.1 Gate G1 Criteria Verification Checklist

| Criterion | Requirement Description | Verification Evidence | Sign-Off |
|---|---|---|:---:|
| **1. Data Dictionary** | Field-level definition for all columns: type, nullability, constraints, business rule, example | Sections 2–6, 7, 8 | **Approved** |
| **2. ER Diagram** | Mermaid ERD showing PKs, FKs, cardinalities, and cross-module boundaries | Section 18 | **Approved** |
| **3. Traceability Matrix** | Every Must requirement mapped to automated tests with >= 60% domain coverage | Section 19 | **Approved** |
| **4. Dirty Data Pack Plan** | Committed synthetic fixture (`dirty-data-v1.csv`), manifest, expected profile, and 100% mathematical reconciliation | Section 20, `sample-data/erp-1/` | **Approved** |
| **5. Platform Reuse (H2)** | Zero duplicate platform infrastructure; consumes `@cs/kit` and `@cs/ui` shared tokens | Issue #118, #119, #120 | **Approved** |
| **6. Zero Real PII** | 100% synthetic test data fixtures; sensitive field masking verified | Section 17, Section 20 | **Approved** |

### 21.2 Peer Review & Governance Sign-Off Record

- **Module**: ERP-1 Products & Inventory (Group 6)
- **Module Lead**: Aditya C (Group 6 Lead / Role 4)
- **Peer Development Group**: Group 7 (ERP-2 Vendors & Purchasing) & Group 9 (ERP-4 Finance & Accounting)
- **Review Date**: 2026-10-23
- **Gate Decision**: **PASSED (UNANIMOUS SIGN-OFF FOR GATE G1)**
- **Audit Hash**: SHA-256 checksums verified across OpenAPI specification, contracts, and Dirty Data Pack manifests.

---

## 22. Module Target Adapter & Durable Import Receipt (ERP1-11)

**Issue Reference**: [#107](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/107)
**Contract Reference**: KIT-08 / Decision C4 (`@cs/kit` TargetAdapter port)
**Implementation**: `apps/erp/modules/erp-1/src/migration/target-adapter.ts`

### 22.1 Architecture & Invariants

1. **In-Process Execution**: The Migration Kit interacts with ERP-1 exclusively in-process through the typed `Erp1TargetAdapter` or via authenticated public HTTP endpoints (`/import`, `/import/batch`). The Kit possesses no direct database write privileges to `erp1.*` tables.
2. **Atomic Dual-Write**: Business entity creation/linking and durable receipt persistence commit within a single local PostgreSQL transaction (`this.repo.transaction`). Either both succeed or both roll back together.
3. **Idempotency Invariant**:
   - Receipt lookup by `idempotency_key` strictly precedes any database write.
   - Same `idempotency_key` + identical request payload returns HTTP 200 with `prior_result: true` and the existing target record.
   - Same `idempotency_key` + conflicting request payload returns HTTP 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` with zero database writes.
4. **Type-Safe UPSERT Semantics**:
   - When `upsert: true`, incoming rows matching an existing natural key (normalized SKU for `product`, code for `category`) update existing records in-place and produce an import receipt with `kind: 'linked'`.
   - When `upsert: false`, duplicate natural keys trigger HTTP 409 `SKU_DUPLICATE` rejection.
5. **Batch Execution & Error Isolation**:
   - `loadBatch` processes rows in sequential chunks of up to 500 rows (`DEFAULT_CHUNK_SIZE = 500`).
   - Business rejections (400, 409, 422) are isolated per-row as `rejected` outcomes and do not abort subsequent rows.
   - Transient infrastructure errors (503, connection reset, PostgreSQL deadlocks) trigger bounded exponential backoff retries without mutating client idempotency keys.
   - Batch execution safely halts if row failures exceed the 10% threshold (`STOPPED_EXCESSIVE_FAILURES`). No compensating rollback sagas exist in V1.

### 22.2 HTTP Endpoints

| Method | Path | Summary | Success Status | Replay Status |
|---|---|---|:---:|:---:|
| `POST` | `/api/v1/erp-products/import` | Single-row import with per-row idempotency | `201 Created` | `200 OK` (`prior_result: true`) |
| `POST` | `/api/v1/erp-products/import/batch` | Chunked batch import (up to 500 rows) with per-row outcomes | `200 OK` | `200 OK` |

---

## 23. Exact Duplicate Key Policy & Human Review Workflow (ERP1-12)

**Issue**: [#108](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/108) — `[ERP1-12] ERP-1 Products and Inventory: Exact duplicate key policy for the module`<br />
**Governing Architecture**: SDS ClearShift ERP v2.0 §4.2, Gate G3 Criteria, Architecture Decision C7.<br />
**Implementation**: `apps/erp/modules/erp-1/src/domain/duplicate-policy.ts`, `apps/erp/modules/erp-1/src/routes/duplicates.ts`, `apps/erp/modules/erp-1/web/src/components/DuplicateReviewModal.tsx`, `apps/erp/modules/erp-1/web/src/pages/DuplicateCandidatesPage.tsx`.

### 23.1 Normalized Exact Matching Keys (AC1)

In compliance with ClearShift V1 non-negotiable rules, duplicate detection uses deterministic exact key matching. Fuzzy matching and probabilistic scoring algorithms are strictly forbidden in V1.

| Entity | Primary Natural Key | Normalization Function | Target Transformation |
|---|---|---|---|
| **Products (`erp1_products`)** | `sku` | `normalizeSku(sku)` | Trims leading/trailing whitespace, converts to uppercase, preserves standard hyphen/underscore separators. |
| **Categories (`erp1_categories`)** | `code` | `normalizeCategoryCode(code)` | Trims leading/trailing whitespace, converts to uppercase. |

### 23.2 Deterministic Classification & Ambiguity Handling (AC2, AC3)

- **EXACT_DUPLICATE**: The incoming candidate record matches exactly one existing target record on normalized key equality. Confidence is strictly `1.0`.
- **AMBIGUOUS_CANDIDATE**: The incoming candidate matches multiple existing target records or contains conflicting keys. Held in human review queue with status `PENDING_REVIEW`.
- **UNIQUE**: No matching normalized keys exist in target database. Candidate proceeds to normal ingestion.
- **Prohibition of Fuzzy Auto-Merge**: Automated target-side merge sagas are strictly rejected. Any attempt to invoke automatic merging throws `FUZZY_AUTO_MERGE_FORBIDDEN`.

### 23.3 Authorized Human Review Workflow & Immutable Audit Log (AC4)

1. **Role Authorization**: Merge decisions are restricted to authorized roles: `admin`, `migration_runner`, and `editor`.
2. **Review Decisions**:
   - `MERGE`: Combines incoming candidate into target golden record. Requires selection of `kept_id` and `merged_id` (must be distinct UUIDs).
   - `REJECT`: Rejects incoming candidate record without modifying target master data.
   - `KEEP_BOTH`: Manual operator override to retain both records with documented business justification.
3. **Mandatory Documentation**: All decisions require documented rationale of at least 5 characters.
4. **Immutable Audit Trail**: Recorded via `@cs/core` `AuditService`:
   - `action`: `merge.decided`
   - `actor`: Operator user identifier / sub
   - `actorRole`: Operator role (`admin`, `migration_runner`, `editor`)
   - `targetEntity`: `erp1.products` or `erp1.categories`
   - `targetId`: Retained entity UUID (`kept_id`)
   - `metadata`: `candidateId`, `keptId`, `mergedId`, `decision`, `matchingKey`, `matchingValue`
   - `reason`: Operator documented review rationale

---

## 24. Idempotent Retry and Partial-Load Stop Behavior (ERP1-13)

**Issue Reference**: [#109](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/109)<br />
**Contract Reference**: KIT-12 / Decision C4 (`@cs/kit` batch processing & threshold policy)<br />
**Implementation**: `apps/erp/modules/erp-1/src/migration/batch-runner.ts`, `apps/erp/modules/erp-1/src/migration/target-adapter.ts`

### 24.1 Chunked Batch Partitioning (AC1)

Load operations enforce chunked batch processing bounded at 500 rows per chunk (`DEFAULT_CHUNK_SIZE = 500`). Multi-thousand row migration jobs are partitioned sequentially without unbound memory growth.

### 24.2 Bounded Exponential Backoff Retry (AC2)

Transient infrastructure failures (HTTP 503/504, PostgreSQL deadlock code `40P01`, connection resets) trigger bounded retries with exponential backoff:
- `maxRetries`: 3
- `initialDelayMs`: 50 ms
- `backoffFactor`: 2.0
- **Idempotency Key Preservation**: Client-supplied stable idempotency keys and payloads are strictly preserved across all retry attempts. Deterministic domain validation failures (400, 409, 422) fail immediately and are never retried.

### 24.3 10% Failure Rate Stop Threshold Rule (AC3)

Batch execution tracks attempted and rejected row counts. Once attempted rows reach `minAttemptedRows` (default 10), execution halts immediately if:
$$\text{Failure Rate} = \frac{\text{Rejected Rows}}{\text{Attempted Rows}} > 0.10 \quad (10\%)$$

### 24.4 Durability & STOPPED_EXCESSIVE_FAILURES State Transition (AC4)

When a batch halts due to excessive failures:
1. All previously committed rows and durable receipts remain persisted in the target database.
2. The batch status transitions to `STOPPED_EXCESSIVE_FAILURES` with diagnostic reason.
3. Remaining rows in the batch are marked with outcome `unattempted`.
4. Replaying the batch after fixing source errors safely replays committed rows with `prior_result: true` without duplication.

### 24.5 Prohibition of Rollback Sagas (AC5)

In compliance with ClearShift V1 non-negotiable architectural rules, compensating rollback sagas are strictly out of scope. System implements stop-safely behavior, preserving durable evidence for operator remediation.

---

## 25. OpenAPI, Event Contracts, and Mock Package (ERP1-14)

**Issue Reference**: [#110](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/110)<br />
**Contract Reference**: `@clearshift/contracts` (`packages/contracts`)<br />
**OpenAPI Specification**: `packages/contracts/openapi/erp-1.yaml`<br />
**Event Contracts**: `packages/contracts/src/erp-1-events.ts`<br />
**Deterministic Mock Server**: `packages/contracts/src/erp-1-mock.ts`

### 25.1 OpenAPI 3.1 Specification Parity (AC1)

The complete ERP-1 surface is specified in `packages/contracts/openapi/erp-1.yaml` with OpenAPI 3.1.0 compliance:
- Bounded pagination parameters (`pageSize` default 25, maximum 100).
- Standard ADR-002 / PLT-04 error envelopes (`{ code, message, details }`).
- Decimal string formats for all monetary amounts and inventory balances (zero IEEE-754 floating point inaccuracies).
- Operation definitions for products, categories, warehouses, stock levels, and batch imports.

### 25.2 Domain Event Specifications (AC2)

All state-changing domain mutations emit transactional event envelopes conforming to the ClearShift Event Envelope Schema (`PLT-04` / `PLT-09`):

| Event Type | Producer | Entity Type | Trigger | Key Payload Fields |
|---|---|---|---|---|
| `erp.product.created` | `erp-1` | `product` | Product master record created | `id`, `sku`, `name`, `categoryId`, `unitOfMeasure`, `price`, `currency` |
| `erp.product.updated` | `erp-1` | `product` | Product attributes or price updated | `id`, `sku`, `name`, `previousPrice`, `newPrice`, `categoryId`, `status` |
| `erp.category.created` | `erp-1` | `category` | Product category registered | `id`, `code`, `name` |
| `erp.warehouse.created` | `erp-1` | `warehouse` | Warehouse facility configured | `id`, `code`, `name`, `isDefault` |
| `erp.stock_level.adjusted` | `erp-1` | `stock_level` | Inventory quantity adjusted | `productId`, `warehouseId`, `previousQuantity`, `newQuantity`, `adjustmentQuantity`, `stockStatus`, `reason` |

#### Cross-Module Inbound Events Consumed
- `erp.purchase_order.received` (from ERP-2): Goods received against purchase order lines, increasing warehouse inventory.
- `erp.sales_order.fulfilled` (from ERP-3): Goods dispatched against sales orders, decrementing warehouse inventory without breaching the non-negative stock constraint (`BR-ERP1-01`).

### 25.3 Deterministic Mock Server & Fixture Package (AC3)

For dependent teams (ERP-2, ERP-3, CRM-2, Migration Kit), `@clearshift/contracts` exposes:
```typescript
import { createErp1MockServer } from '@clearshift/contracts';

const mock = createErp1MockServer();
// mock.app: Fastify instance with all ERP-1 routes
// mock.store: Deterministic synthetic in-memory data store
// mock.reset(): Resets fixtures to clean baseline state
// mock.stop(): Closes server instance
```

#### Deterministic Seed Fixtures
- Default Warehouse: `WH-MAIN` (`aaaaaaaa-0001-4000-8000-000000000001`)
- Categories: `TOOLS` (`bbbbbbbb-0001-4000-8000-000000000001`), `GEN` (`bbbbbbbb-0001-4000-8000-000000000002`)
- Products: `TOOL-HEX-01` (`cccccccc-0001-4000-8000-000000000001`), `GEN-TIE-100` (`cccccccc-0001-4000-8000-000000000002`), `LUB-GRS-500` (`cccccccc-0001-4000-8000-000000000003`)
- Pre-seeded stock levels for all products in `WH-MAIN`.

---

## 26. QA Evidence, Automated Test Mapping, and Team Handoff (ERP1-10)

### 26.1 Test Evidence & Invariant Mapping

| Invariant / Requirement | Contract & Enforcement | Verification Test File | Status |
|---|---|---|:---:|
| **BR-ERP1-01** (Unique SKU) | `erp1_products_sku_unique` index + normalized uppercase matching | `apps/erp/modules/erp-1/tests/domain/invariants.test.ts`, `tests/db/schema.test.ts` | **Verified** |
| **BR-ERP1-02** (Non-negative stock) | `check_erp1_stock_quantity_non_negative` constraint | `apps/erp/modules/erp-1/tests/domain/invariants.test.ts`, `tests/db/constraints.test.ts` | **Verified** |
| **FR-ERP1-03** (1-level category hierarchy) | Schema has no `parent_id`, validator prohibits nested subcategories | `apps/erp/modules/erp-1/tests/domain/invariants.test.ts`, `tests/e2e/demo-journey.test.ts` | **Verified** |
| **FR-ERP1-04** (Fixed units: pcs, kg, g, litre, metre, box) | `erp1.unit_of_measure` enum & `UnitOfMeasureSchema` | `apps/erp/modules/erp-1/tests/domain/invariants.test.ts`, `packages/contracts/tests/erp-1.test.ts` | **Verified** |
| **FR-ERP1-05** (Single warehouse in V1) | `erp1_warehouses_single_idx` on constant `true` | `apps/erp/modules/erp-1/tests/domain/invariants.test.ts`, `tests/db/schema.test.ts` | **Verified** |
| **Explicit Currency (USD)** | Uppercase ISO-4217 code required on create | `apps/erp/modules/erp-1/tests/domain/invariants.test.ts`, `packages/contracts/tests/erp-1.test.ts` | **Verified** |
| **Decimal Price (NUMERIC 19,4)** | Decimal format preserved without float rounding | `apps/erp/modules/erp-1/tests/domain/invariants.test.ts`, `packages/contracts/tests/erp-1.test.ts` | **Verified** |
| **OpenAPI Parity** | 100% routes mapped to `packages/contracts/openapi/erp-1.yaml` | `apps/erp/modules/erp-1/tests/contract/openapi-parity.test.ts` | **Verified** |
| **Deterministic Seed & Reset** | Re-running produces identical IDs without duplicate writes | `apps/erp/modules/erp-1/tests/seed/seed.test.ts`, `sample-data/erp-1/seed.ts` | **Verified** |
| **Scripted 5-Minute Demo** | In-process execution of full V1 demo workflow | `apps/erp/modules/erp-1/tests/e2e/demo-journey.test.ts`, `docs/demo-scripts/erp-1-v1.md` | **Verified** |
| **Error Envelope Compliance** | Conforms to `{ statusCode, error, code, message, details, correlation_id }` | `apps/erp/modules/erp-1/tests/api/auth-and-envelope.test.ts` | **Verified** |

### 26.2 Handoff Sign-Off
- **Issue Reference**: Resolves [#15](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/15) ([ERP1-10])
- **Author**: Samarth (`Samarth-ITM`)
- **Role**: Group 6 / Role 4 — Data & QA Lead
- **Scope**: Production-grade verification, contract parity, test harnesses, seed idempotency, demo journey, and team handoff documentation.

---

## 27. Module Authorization and Policy Integration (ERP1-15)

**Issue Reference**: [#111](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/111)<br />
**Traceability**: ClearShift Project Plan v3.0, SDS ClearShift ERP v2.0 §4.8, §7.9, §9.3; PLT-05, PLT-06<br />
**Implementation**: `apps/erp/modules/erp-1/src/app.ts`, `apps/erp/modules/erp-1/src/routes/guard.ts`

### 27.1 Hub JWT Token Signature & Expiry Validation (AC1)

Every ERP-1 endpoint validates incoming Bearer tokens using `@cs/identity` (`verifyAccessToken`):
- **Cryptographic Verification**: Ed25519 (EdDSA) asymmetric public key signature validation (`cs-hub-key-v1`).
- **Standard Token Claims**: Validates `iss` (`clearshift-hub`), `aud` (`clearshift`), `exp` (15-minute token TTL), `sub`, and `roles`.
- **Default Deny**: Missing `Authorization` header, invalid token format, expired tokens, tampered signatures, or revoked/disabled user accounts (`USER_DISABLED`) immediately return `401 Unauthorized`.

### 27.2 Role Capability Matrix Enforcement (AC2 & AC3)

Authorization consumes the platform RBAC capability matrix (PLT-03):

| Role | Role Identifier | Assigned Capabilities | Permitted Operations | Denied Operations |
|---|---|---|---|---|
| **Viewer** | `viewer` | `module.read`, `kit.read`, `control.read` | `GET /products`, `GET /categories`, `GET /stock`, `GET /duplicates/candidates` | All `POST`, `PATCH`, `PUT`, `DELETE` writes (`403 Forbidden`) |
| **Editor** | `editor` | `module.read`, `module.write`, `kit.read`, `kit.review` | `GET /products`, `POST /products`, `PATCH /products/:id`, `POST /categories`, `PATCH /categories/:id`, `POST /duplicates/review` | Administrative period locks and platform configs |
| **Migration Runner** | `migration_runner` | `kit.read`, `kit.run` | `POST /import`, `POST /import/batch`, `POST /products` (via `kit.run`), `POST /stock/opening` (via `kit.run`) | Browser UI edits (`PATCH /products/:id` without `module.write`), human duplicate candidate review (`POST /duplicates/review`) |
| **Analyst** | `analyst` | `module.read`, `kit.read`, `control.read` | Read-only analytics across products, categories, stock levels | All mutation and ingestion operations (`403 Forbidden`) |
| **Admin** | `admin` | `module.read`, `module.write`, `kit.read`, `kit.review`, `kit.admin`, `control.read`, `hub.admin` | Unrestricted read, write, bulk ingestion, duplicate reviews, and system maintenance | — |

### 27.3 Object-Level Authorization & Boundary Isolation (AC4)

To prevent cross-tenant leakage or unauthorized record hijacking:
1. **Multi-Tenant Boundary Isolation (`assertTenantAccess`)**:
   - Compares the requesting user's tenant context (`x-tenant-id` header or JWT claims) against the target entity's tenant context.
   - Any cross-tenant read or mutation attempt is rejected with `HTTP 403` and error code `OBJECT_ACCESS_DENIED`.
2. **Cross-User Mutation Safety (`assertObjectMutationAccess`)**:
   - Records track creating user identity (`created_by` / `created_by_user_id`).
   - Non-admin callers attempting to mutate or modify records created by another user are rejected with `HTTP 403` and error code `CROSS_USER_MUTATION_FORBIDDEN`.
   - Administrators retain cross-user management rights within their tenant boundary.

### 27.4 Standard Error Envelope Conformance

All `401 Unauthorized` and `403 Forbidden` responses strictly conform to the standard ClearShift error envelope:
```json
{
  "code": "FORBIDDEN",
  "message": "Access denied. Required capability: 'module.write'",
  "details": [],
  "correlation_id": "12345678-1234-4234-8234-1234567890ab"
}
```

---

## 28. Module Route and Page Registration in Shared Shell (ERP1-16)

**Issue Reference**: [#112](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/112)<br />
**Traceability**: ClearShift Project Plan v3.0, SDS ClearShift ERP v2.0 §4.8, §7.9; PLT-08 Shared Web Shell<br />
**Implementation**: `apps/erp/modules/erp-1/web/src/route-manifest.ts`, `apps/erp/modules/erp-1/web/src/routes.tsx`, `apps/erp/modules/erp-1/web/src/components/ModuleShell.tsx`

### 28.1 Route Manifest & Navigation Structure (AC1 & AC2)

ERP-1 registers its client-side route manifest conforming to the platform shared shell specifications:
- **Base Path**: `/erp-1`
- **Navigation Links**:
  - Products Master Catalog: `/erp-1/products`
  - Product Categories: `/erp-1/categories`
  - Stock Quantities: `/erp-1/stock`
  - Migration Kit Ingestion & Review: `/erp-1/migration`
- **Action & Detail Subroutes**:
  - Create Product: `/erp-1/products/new` (accessible to `editor` and `admin`)
  - Product Detail: `/erp-1/products/:productId` (accessible to `viewer`, `editor`, `admin`, `analyst`)
  - Edit Product: `/erp-1/products/:productId/edit` (accessible to `editor` and `admin`)
- **Fallback Route**:
  - Module 404 Not Found: `/erp-1/*` with navigation back to Products list.

### 28.2 Shared Shell Accessibility & Layout Conformance (AC3)

All ERP-1 routes render within `ModuleShell`:
- **Skip Link**: `<a href="#erp1-main" className="cs-skip-link">Skip to main content</a>` ensures WCAG 2.1 AA keyboard accessibility.
- **Header & Navigation Landmark**: `<header>` banner with module branding, tenant display, user profile info, and sign-out action; `<nav aria-label="ERP-1 Module Navigation">` with active link indications (`aria-current="page"`).
- **Breadcrumb Trail**: Dynamic breadcrumbs hierarchy (`Home > ERP-1 > Products > [Product Name]`) rendered using `@cs/ui` tokens.
- **Main Landmark**: Single `<main id="erp1-main" tabIndex={-1}>` container for primary page contents.
- **Design Tokens**: Standardized CSS variables from `@cs/ui` (`--cs-color-surface-bg`, `--cs-color-surface-card`, `--cs-space-4`, etc.).

### 28.3 Client-Side Authentication & Session Integration (AC4)

Route protection via `RequireAuth` wrapper:
- Intercepts unauthenticated sessions and redirects to Hub login with return URL parameter (`/login?redirect=...`).
- Checks user role against route permission requirements (e.g. restricts product creation/editing to `editor` / `admin`).
- Emits standard access-denied state if the user lacks the required role.

---

## 29. Main Paginated Data Table (ERP1-17)

**Issue Reference**: [#113](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/113)<br />
**Traceability**: ClearShift Project Plan v3.0, SDS ClearShift ERP v2.0 §4.2, §4.7; PLT-04 Bounded Pagination, PLT-08 Shared Web Shell<br />
**Implementation**: `apps/erp/modules/erp-1/web/src/components/ProductsTable.tsx`, `apps/erp/modules/erp-1/web/src/pages/ProductsListPage.tsx`

### 29.1 Stable Columns Matching Data Dictionary (AC1)

The primary collection table screen renders entity rows with stable columns directly mapping to `erp1.products` master data and `erp1.stock_levels`:

| Column Header | Field Name | Data Type / Representation | Sortable | Accessibility & Formatting Notes |
|---|---|---|---|---|
| **Product Name** | `name` | `VARCHAR(255)` / string | Yes (`name`) | Primary entity identifier; interactive button for detail/edit drawer; optional source system metadata |
| **SKU** | `sku` | `VARCHAR(64)` / string | Yes (`sku`) | Monospace `code` pill; normalized uppercase alphanumeric key |
| **Category** | `categoryId` | UUID FK -> `erp1.categories` | No | Rendered as category name badge from cached category map; fallback `—` |
| **Unit** | `unitOfMeasure` | `erp1.unit_of_measure` enum | No | Restricted to fixed V1 unit list: `pcs`, `kg`, `g`, `litre`, `metre`, `box` |
| **Price** | `price` | `NUMERIC(14,4)` decimal string | Yes (`price`) | Formatted 2-4 decimal places with ISO currency code (e.g. `185.50 USD`) |
| **Tax Rate** | `taxRate` | `NUMERIC(5,2)` decimal string | No | Right-aligned percentage string (e.g. `5.00%`) |
| **Stock Status** | `stockQuantity` | `NUMERIC(14,4)` from stock levels | Yes (`quantity`) | `StatusBadge`: `In Stock` (>10), `Low` (<=10), `Out of Stock` (<=0), or `Unknown` |

### 29.2 Server-Side Pagination & Bounded Paging (AC2 & AC4)

1. **Query Parameter Binding**:
   - `page`: 1-based integer index sent to `/api/v1/erp-products/products?page=...`
   - `pageSize`: Bound to standard bounded options `[10, 25, 50, 100]`.
   - Modifying `pageSize` immediately resets `page` to `1` and updates URL search parameters via `replaceState`.
2. **DOM Performance & Bounded Limits**:
   - Strictly conforms to platform constraint: `pageSize <= 100`.
   - DOM node creation is capped at <= 100 rows per rendered page window, preventing browser DOM thrashing and layout thrash.
   - Previous and Next buttons enforce disabled states at page boundaries (`currentPage <= 1` and `currentPage >= totalPages`).

### 29.3 Predictable Column Header Sorting (AC3)

1. **Sort Direction Toggle**:
   - Clicking an active sorted column toggles between `asc` and `desc`.
   - Clicking an inactive column switches `sortBy` to that field with initial direction `asc`.
2. **WAI-ARIA & Keyboard Accessibility**:
   - Headers declare `aria-sort="ascending"`, `aria-sort="descending"`, or `aria-sort="none"`.
   - Accessible descriptions announce the current sort state and next action (`aria-label`).
   - Supports keyboard activation via `Enter` and `Space` (`tabIndex={0}`).

---

## 28. Profiling Configuration & Expected-Result Assertions (ERP1-26)

**Issue Reference**: Resolves [#122](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/122) (ERP1-26 / KIT-03)  
**Implementation**: `apps/erp/modules/erp-1/src/migration/profiling-config.ts`  
**Test Suite**: `apps/erp/modules/erp-1/tests/migration/profiling.test.ts`  
**Detailed Specification**: `docs/data-dictionaries/erp-1-profiling.md`  

### 28.1 Shared Profiler Engine Integration (AC1 & AC4)
ERP-1 integrates directly with the `@cs/kit` shared column profiler (`profileDataset`) and CSV report exporter (`exportProfileReportToCsv`) without duplicating platform infrastructure:
- Accurately computes total rows (131), null counts, populated counts, distinct values, invalid format counts, and rates for all 4 owned entities (`category`, `warehouse`, `product`, `stock_level`).
- Validates strict domain invariants:
  - SKU uniqueness after documented normalization (`normalizeSku`).
  - Unit of measure from fixed V1 list (`pcs`, `kg`, `g`, `litre`, `metre`, `box` per FR-ERP1-04).
  - Price and tax rates use non-negative decimal types (FR-ERP1-02).
  - Stock quantity may not become negative (BR-ERP1-01 / BR-ERP1-02).
  - Single operating warehouse in V1 (`WH-01` per FR-ERP1-05).
  - OWASP formula injection protection (`=`, `+`, `-`, `@`, `\t`, `\r`).
- Validates all column invalid format counts match pre-calculated manifest numbers from `sample-data/erp-1/expected-profile.json`.

### 28.2 Exact Duplicate Candidate Rules (AC2)
Deterministic exact-key matching rules are configured for human review:
- `category_code`: Trimmed uppercase category code (2 duplicate candidates: `R012`, `R013` matching `R001`).
- `product_sku`: Normalized uppercase SKU (3 duplicate candidates: `R057`, `R058` matching `R022`, `R059` matching `R023`).
- `stock_level_key`: Composite key `${sku}::${warehouse_code}` for valid stock lines (2 duplicate candidates: `R112`, `R113` matching `R087`).

Total duplicate candidate count: 7 (100% parity with manifest `reconciliation.review = 7`). Zero fuzzy scoring rules; V2 auto-merge rollback sagas are strictly out of scope.

### 28.3 Non-Destructive Guarantees & PII Masking (AC3)
- Non-destructive operation: source CSV text, file bytes, and SHA-256 (`25040ea5a6c9ec820f21798f0f4014edb116844392fea024048e96537c39ee91`) remain completely untouched.
- Sensitive fields `supplier_bank_account` and `employee_ssn` are never profiled and are masked before profiling, ensuring zero PII or financial number leakage in profile reports or formula-safe CSV exports.

