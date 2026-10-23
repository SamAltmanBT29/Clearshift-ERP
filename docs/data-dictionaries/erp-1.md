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

| Column | PostgreSQL Type | Nullable | Default | Owner | Meaning | Constraints |
|---|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | ERP-1 | Primary key | PK |
| `name` | `VARCHAR(255)` | NOT NULL | — | ERP-1 | Human-readable category name | B-tree index |
| `code` | `VARCHAR(64)` | NOT NULL | — | ERP-1 | Unique category identifier | UNIQUE `erp1_categories_code_idx` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | ERP-1 | Row creation timestamp (UTC) | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | ERP-1 | Last modification timestamp (UTC) | Trigger `categories_set_updated_at` |

**Indexes**:
- `erp1_categories_code_idx` — UNIQUE on `(code)`
- `erp1_categories_name_idx` — B-tree on `(name)`

**Seed**: `GEN` / `General` with synthetic UUID `00000000-0000-4000-8000-000000000001`.

---

## 3. `erp1.warehouses` — Warehouses

**Purpose**: Stores the warehouse holding physical inventory. V1 operates with exactly one warehouse.

**FR Reference**: FR-ERP1-05 (one warehouse in V1; stock quantity per product)

| Column | PostgreSQL Type | Nullable | Default | Owner | Meaning | Constraints |
|---|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | ERP-1 | Primary key | PK |
| `name` | `VARCHAR(255)` | NOT NULL | — | ERP-1 | Warehouse facility name | — |
| `code` | `VARCHAR(64)` | NOT NULL | — | ERP-1 | Warehouse code (e.g. `WH-01`) | UNIQUE `erp1_warehouses_code_idx` |
| `is_default` | `BOOLEAN` | NOT NULL | `true` | ERP-1 | Whether this is the operating warehouse | — |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | ERP-1 | Row creation timestamp (UTC) | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | ERP-1 | Last modification timestamp (UTC) | Trigger `warehouses_set_updated_at` |

**Indexes**:
- `erp1_warehouses_code_idx` — UNIQUE on `(code)`
- `erp1_warehouses_single_idx` — UNIQUE on the constant expression `(true)`; PostgreSQL rejects a second V1 warehouse

**Seed**: `WH-01` / `Main Warehouse` with synthetic UUID `00000000-0000-4000-8000-000000000002`.

---

## 4. `erp1.products` — Product Master Data

**Purpose**: Master records of items sold and tracked by the organization.  
**FR/BR Reference**: FR-ERP1-01, FR-ERP1-02, BR-ERP1-01

| Column | PostgreSQL Type | Nullable | Default | Owner | Meaning | Constraints |
|---|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | ERP-1 | Primary key | PK |
| `name` | `VARCHAR(255)` | NOT NULL | — | ERP-1 | Product name | B-tree index |
| `sku` | `VARCHAR(128)` | NOT NULL | — | ERP-1 | Stock Keeping Unit | UNIQUE `erp1_products_sku_idx` (BR-ERP1-01) |
| `normalized_sku` | `VARCHAR(128)` | NOT NULL | — | ERP-1 | Uppercased/trimmed SKU for exact matching | UNIQUE `erp1_products_normalized_sku_idx` |
| `category_id` | `UUID` | NULL | — | ERP-1 | Optional category link | FK → `erp1.categories(id)` ON DELETE SET NULL |
| `unit_of_measure` | `erp1.unit_of_measure` | NOT NULL | — | ERP-1 | `pcs`, `kg`, `g`, `litre`, `metre`, `box` | ENUM (FR-ERP1-04) |
| `price` | `NUMERIC(19, 4)` | NOT NULL | — | ERP-1 | Sale price in the explicit currency | CHECK `price >= 0`; SDS money precision |
| `currency` | `VARCHAR(3)` | NOT NULL | — | ERP-1 | Uppercase ISO 4217 currency code | CHECK `currency ~ '^[A-Z]{3}$'`; no implicit default |
| `tax_rate` | `NUMERIC(5, 2)` | NOT NULL | `0.00` | ERP-1 | Tax rate percentage (e.g. `5.00` for 5%) | CHECK `tax_rate >= 0` |
| `source_system` | `VARCHAR(64)` | NULL | — | ERP-1 | External migration source system | Composite B-tree index |
| `source_id` | `VARCHAR(128)` | NULL | — | ERP-1 | External migration source identifier | Composite B-tree index |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | ERP-1 | Row creation timestamp (UTC) | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | ERP-1 | Last modification timestamp (UTC) | Trigger `products_set_updated_at` |

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

| Column | PostgreSQL Type | Nullable | Default | Owner | Meaning | Constraints |
|---|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | ERP-1 | Primary key | PK |
| `product_id` | `UUID` | NOT NULL | — | ERP-1 | Product reference | FK → `erp1.products(id)` ON DELETE CASCADE |
| `warehouse_id` | `UUID` | NOT NULL | — | ERP-1 | Warehouse reference | FK → `erp1.warehouses(id)` ON DELETE CASCADE |
| `quantity` | `NUMERIC(19, 4)` | NOT NULL | `0.0000` | ERP-1 | Current on-hand quantity | CHECK `quantity >= 0`; SDS quantity precision |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | ERP-1 | Last stock update timestamp (UTC) | Trigger `stock_levels_set_updated_at` |

**Indexes & constraints**:
- `erp1_stock_levels_product_warehouse_idx` — UNIQUE on `(product_id, warehouse_id)`
- `check_erp1_stock_quantity_non_negative` — CHECK `quantity >= 0` (BR-ERP1-02)

**Opening stock**: loaded through the Migration Kit/controlled runner and written with
`INSERT ... ON CONFLICT (product_id, warehouse_id) DO UPDATE`. A repeated import
cannot create a second stock row for the same pair.

---

## 6. `erp1.import_receipts` — Durable Migration Receipts

**Purpose**: Durable KIT-08 receipt proving a source row was loaded into a target entity. Written in the same PostgreSQL transaction as the target mutation.

**Architecture Reference**: Decision C4 & KIT-08

| Column | PostgreSQL Type | Nullable | Default | Owner | Meaning | Constraints |
|---|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | ERP-1 | Primary key | PK |
| `batch_id` | `UUID` | NOT NULL | — | ERP-1 | Migration Kit batch UUID | Part of `erp1_import_receipts_batch_row_idx` |
| `source_row` | `INTEGER` | NOT NULL | — | ERP-1 | 1-based source row inside the batch | CHECK `source_row >= 1` |
| `entity` | `VARCHAR(64)` | NOT NULL | — | ERP-1 | Target entity, e.g. `product` or `stock_level` | — |
| `schema_version` | `INTEGER` | NOT NULL | `1` | ERP-1 | Target schema version of the load | CHECK `schema_version >= 1` |
| `idempotency_key` | `VARCHAR(128)` | NOT NULL | — | ERP-1 | `sha256(batch_id, source_row, entity, schema_version)` | UNIQUE `erp1_import_receipts_idempotency_key_unique` |
| `target_id` | `UUID` | NOT NULL | — | ERP-1 | Identifier of the created/linked target row | — |
| `kind` | `VARCHAR(16)` | NOT NULL | `'created'` | ERP-1 | `created` or `linked` | CHECK `check_erp1_import_receipts_kind_allowed` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | ERP-1 | Receipt creation timestamp (UTC) | — |

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

## 12. Search, Filters and Sorting Controls (ERP1-18)

**Issue**: [#114](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/114) — `[ERP1-18] ERP-1 Products and Inventory: Search, filters and sorting controls`  
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

## 13. Loading, Empty, Error and Access-Denied States (ERP1-19)

**Issue**: [#115](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/115) — `[ERP1-19] ERP-1 Products and Inventory: Loading, empty, error and access-denied states`  
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

## 14. Product Creation Form with Field-Level Validation (ERP1-20)

**Issue**: [#116](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/116) — `[ERP1-20] ERP-1 Products and Inventory: Create form with field-level validation`  
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



