# ERP-2 Vendors & Purchasing: Field-Level Data Dictionary

**Issue**: [ERP2-24 / #140](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/140), Gate G1 design artifact
**Module**: ERP-2 Vendors & Purchasing (Group 7, Role 4 Data / QA Lead)
**PostgreSQL schema**: `erp2`
**Requirement sources**: SDS ClearShift ERP v2.0 §4.3 (FR-ERP2-01..06, BR-ERP2-01), Master Architecture Spec (Decision C7, KIT-08)

This file complements, and does not replace, `docs/data-dictionaries/erp-2.md` and `apps/erp/modules/erp-2/docs/data-dictionary.md`. Those two document the API, state machine and QA evidence of earlier issues. This file is the exhaustive per-column reference required by the ERP2-24 acceptance criteria.

## 1. How to read this document

- **Runtime truth** is `packages/database/migrations/erp2_v1.sql` (what the migration runner actually creates).
- **TypeScript model** is `apps/erp/modules/erp-2/db/schema.ts` (Drizzle).
- The two disagree in places. Every disagreement is marked with `⚠` in the tables and listed in [section 6 (Drift register)](#6-drift-register-sql-migration-vs-drizzle-model). Tables show the **SQL migration** value first.
- All examples are synthetic (`*.example` domains, `TX-SEED-*` tax numbers, fake account digits).

## 2. `erp2.vendors`: Vendor master

Owned by ERP-2 (FR-ERP2-01, FR-ERP2-02, FR-ERP2-06). Vendor master is owned here and nowhere else.

| Column | Type | Null | Constraint / default | Business rule | Example |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | PK, default `gen_random_uuid()` | Server-generated. Client-supplied value is ignored (mutation test "ignores protected/system fields"). | `7c1a9e52-3f0b-4d6a-9a41-5b2e8d0c1f11` |
| `name` | `varchar(255)` | NO | `CHECK length(trim(name)) > 0` | Legal business name. Searchable (FR-ERP2-01), case-insensitive, server-side. | `Northwind Industrial Supply` |
| `tax_number` | `varchar(64)` | NO | `UNIQUE (vendors_tax_number_unique)`, `CHECK length(trim(tax_number)) > 0` | Deterministic exact-duplicate key. Normalised for matching by trim, uppercase and separator removal. Duplicate create or update returns HTTP 409. | `TX-SEED-001` |
| `email` | `varchar(255)` | YES ⚠ | none | Secondary exact-duplicate key (lowercased, trimmed). ⚠ Drizzle declares NOT NULL. | `orders@northwind.example` |
| `phone` | `varchar(64)` ⚠ | YES | none | Free text, no format rule in V1. ⚠ Drizzle length is 32. | `+1-555-0101` |
| `address_line` | `varchar(255)` | YES | none | Free text. | `1 Harbor Road` |
| `city` | `varchar(120)` ⚠ | YES | none | Free text. ⚠ Drizzle length is 100. | `Portland` |
| `country` | `varchar(64)` | YES | none | Seed data uses ISO alpha-3 codes. No DB check. | `USA` |
| `bank_masked` | `varchar(32)` ⚠ | YES | `CHECK bank_masked IS NULL OR bank_masked ~ '^XXXX-XXXX-[0-9]{4}$'` | **Only the masked value is ever stored.** API input `bank_details` (min 4 chars) is reduced to `XXXX-XXXX-<last4>` server-side. Raw value is never persisted, returned, logged or exported (FR-ERP2-06). ⚠ Drizzle length is 64. | `XXXX-XXXX-7890` |
| `currency` | `varchar(3)` | NO | default `'USD'` | ISO-4217 style, 3 uppercase letters (validated in domain layer; **no DB CHECK on this table**). A purchase order for this vendor must use the same currency. | `EUR` |
| `source_system` | `varchar(64)` | YES | none | Migration Kit lineage. Must be supplied together with `source_id` (both or neither). | `erp2-seed` |
| `source_id` | `varchar(128)` | YES | none | Legacy primary key. See `source_system`. | `seed-vendor-1` |
| `created_at` | `timestamptz` | NO | default `now()` | Set once. | `2026-10-01T09:30:00Z` |
| `updated_at` | `timestamptz` | NO | default `now()`, trigger `trg_vendors_updated_at` (SQL only ⚠) | Refreshed on every UPDATE by the trigger. | `2026-10-02T11:00:00Z` |

**Indexes**: `vendors_name_idx (name)`, `vendors_source_idx (source_system, source_id)`, unique on `tax_number`.

## 3. `erp2.purchase_orders`: Purchase order header

Owned by ERP-2 (FR-ERP2-03, FR-ERP2-04, FR-ERP2-05).

| Column | Type | Null | Constraint / default | Business rule | Example |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | PK, default `gen_random_uuid()` | Server-generated. | `a3d5f1c2-8e77-4b10-b6c9-0d2e44f7a801` |
| `po_number` | `varchar(64)` | NO | `UNIQUE`, `CHECK length(trim(po_number)) > 0` | Business identifier. Exact-duplicate key (trim and uppercase). | `PO-SEED-0001` |
| `vendor_id` | `uuid` | NO | FK to `erp2.vendors(id)` `ON DELETE RESTRICT` ⚠ | Must reference an existing vendor, otherwise HTTP 422. A vendor with orders cannot be deleted. ⚠ Drizzle FK has no explicit delete action (NO ACTION). | `7c1a9e52-3f0b-4d6a-9a41-5b2e8d0c1f11` |
| `order_date` | `date` | NO | SQL default `CURRENT_DATE` ⚠ | ISO date `YYYY-MM-DD`. ⚠ Drizzle has no default. | `2026-10-01` |
| `status` | enum, see §7.2 ⚠ | NO | default `'draft'` in SQL, `'Draft'` in Drizzle ⚠ | Lifecycle `Draft -> Sent -> Received -> Closed`. Forward only, no skips, no reversal, `Closed` is terminal. Invalid transition returns HTTP 422 `INVALID_STATUS_TRANSITION`. | `Draft` |
| `currency` | `varchar(3)` | NO | `CHECK currency ~ '^[A-Z]{3}$'`, default `'INR'` in SQL, `'USD'` in Drizzle ⚠ | Must equal the vendor currency (domain rule). | `USD` |
| `total` | `numeric(18,2)` | NO | `CHECK total >= 0`, default `0.00` | **Computed server-side** as the sum of `po_lines.line_total` (FR-ERP2-05). Client-supplied totals are ignored. See §7.1. | `218.38` |
| `notes` | `text` | YES | none | Free text. | `Deliver to dock 2` |
| `source_system` | `varchar(64)` | YES | none | Migration Kit lineage (both or neither with `source_id`). | `legacy-erp` |
| `source_id` | `varchar(128)` | YES | none | Legacy primary key. | `PO-1042` |
| `created_at` | `timestamptz` | NO | default `now()` | Set once. | `2026-10-01T09:31:00Z` |
| `updated_at` | `timestamptz` | NO | default `now()`, trigger `trg_purchase_orders_updated_at` (SQL only ⚠) | Refreshed on UPDATE. | `2026-10-03T08:00:00Z` |

**Indexes**: unique `po_number`, `purchase_orders_vendor_id_idx`, `purchase_orders_status_idx`, `purchase_orders_order_date_idx` (SQL only ⚠).

## 4. `erp2.po_lines`: Purchase order lines

Owned by ERP-2 (FR-ERP2-03, FR-ERP2-05, BR-ERP2-01).

| Column | Type | Null | Constraint / default | Business rule | Example |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | PK, default `gen_random_uuid()` | Server-generated. | `c91e07a4-52d8-4f3b-8a6e-17b3d2e9c455` |
| `po_id` | `uuid` | NO | FK to `erp2.purchase_orders(id)` `ON DELETE CASCADE` | Deleting a header removes its lines. Header and lines are written atomically (no orphan header after a bad line). | `a3d5f1c2-8e77-4b10-b6c9-0d2e44f7a801` |
| `product_id` | `uuid` | NO | **No foreign key** (Decision C7) | **BR-ERP2-01**: must reference an existing ERP-1 product, verified through the ERP-1 public contract / `ReferenceResolver`. Unknown product means the row or request is rejected. | `5eed0000-0000-4000-8000-0000000000a1` |
| `line_number` | `integer` | NO | `UNIQUE (po_id, line_number)`, no default in SQL, default `1` in Drizzle ⚠ | 1-based position inside the order. | `1` |
| `quantity` | `numeric(18,4)` ⚠ | NO | `CHECK quantity > 0` | Must be strictly positive. Domain layer normalises to 2 decimals (see §7.1). ⚠ Drizzle is `numeric(12,2)`. | `10.00` |
| `price` | `numeric(18,2)` | NO | `CHECK price >= 0` | Unit price, zero allowed, negative rejected. | `15.50` |
| `line_total` | `numeric(18,2)` | NO | `CHECK line_total >= 0` | Computed server-side: `ROUND_HALF_UP(quantity x price, 2)`. | `155.00` |
| `created_at` | `timestamptz` | NO | default `now()` | Set once. | `2026-10-01T09:31:00Z` |
| `updated_at` | `timestamptz` | NO | default `now()`, trigger `trg_po_lines_updated_at` (SQL only ⚠) | Refreshed on UPDATE. | `2026-10-01T09:31:00Z` |

**Indexes**: `po_lines_po_id_idx`, `po_lines_product_id_idx`, unique `(po_id, line_number)`.

## 5. `erp2.import_receipts`: Idempotency and migration audit

Owned by ERP-2 (KIT-08 / Decision C4). A receipt is written in the **same transaction** as the target mutation, so a rollback leaves neither.

| Column | Type | Null | Constraint / default | Business rule | Example |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | PK, default `gen_random_uuid()` | Server-generated. | `e2b7a6d0-1c44-4a9f-8f0e-6a5d9c3b7712` |
| `batch_id` | `uuid` | NO | none | Groups rows of one Migration Kit run. | `b4700000-0000-4000-8000-000000000001` |
| `source_row` | `integer` | NO | none | 1-based row in the source file. Used for the reconciliation `Source = Loaded + Rejected + Merged`. | `42` |
| `source_system` | `varchar(64)` | YES | none | Lineage. | `erp2-seed` |
| `source_id` | `varchar(128)` | YES | none | Lineage. | `seed-vendor-1` |
| `entity` | `varchar(64)` | NO | none | Target entity name. | `vendor` |
| `schema_version` | `integer` | NO | default `1` | Version of the import payload schema. | `1` |
| `idempotency_key` | `varchar(128)` | NO | `UNIQUE (import_receipts_idempotency_key_unique)` | Same key + same payload replays the original result (HTTP 200, one record, one receipt). Same key + different payload returns HTTP 409 and writes nothing. | `erp2-seed-vendor-1` |
| `request_hash` | `varchar(64)` | NO | none | Hash of the normalised payload, used to detect key reuse with a different payload. | `9f86d081884c7d65...` |
| `target_id` | `uuid` | NO | none (logical reference, polymorphic) | Id of the created or linked vendor or purchase order. No FK because it can point at two tables. | `7c1a9e52-3f0b-4d6a-9a41-5b2e8d0c1f11` |
| `kind` | `varchar(16)` | NO | default `'created'` | Observed in tests: `created`, `linked` (upsert of an existing vendor). | `created` |
| `outcome` | `varchar(16)` | NO | default `'loaded'` | Row result. Rejected rows with a business error create **no** receipt; infrastructure errors (e.g. 503) roll back and are not recorded as rejected. | `loaded` |
| `response_payload` | `text` | YES | none | Stored response used for replay. Must contain masked bank data only. | `{"id":"7c1a..."}` |
| `created_at` | `timestamptz` | NO | default `now()` | Set once. | `2026-10-01T09:30:00Z` |

**Indexes**: unique `idempotency_key`, `import_receipts_batch_row_idx (batch_id, source_row)`.

## 6. Drift register: SQL migration vs Drizzle model

These are real differences found while building this dictionary. They do not change what ERP2-24 documents, but Gate G1 reviewers should decide which side is authoritative. A planned drift test is listed in the traceability matrix (TC-GAP-05).

| # | Object | SQL migration (`erp2_v1.sql`) | Drizzle (`db/schema.ts`) | Risk |
|---|---|---|---|---|
| D1 | `purchase_orders.status` type | enum `erp2.purchase_order_status` = `draft, sent, received, closed` (lowercase) | enum `erp2.po_status` = `Draft, Sent, Received, Closed`; plus a second lowercase constant `purchaseOrderStatusEnum` that is not a DB type | **High**: two different enum names and casings; the app contract uses capitalised values |
| D2 | `vendors.email` | nullable | `NOT NULL` | Medium: inserts valid in SQL can fail in the model |
| D3 | `vendors.phone` / `city` / `bank_masked` length | 64 / 120 / 32 | 32 / 100 / 64 | Low |
| D4 | `purchase_orders.currency` default | `'INR'` | `'USD'` | Medium |
| D5 | `purchase_orders.order_date` default | `CURRENT_DATE` | none | Low |
| D6 | `purchase_orders.vendor_id` FK action | `ON DELETE RESTRICT` | default (NO ACTION) | Low |
| D7 | `po_lines.quantity` | `numeric(18,4)` | `numeric(12,2)` | Medium |
| D8 | `po_lines.line_number` default | none | `1` | Low |
| D9 | `import_receipts` unique on `idempotency_key` | one constraint | constraint **and** a second unique index on the same column (redundant) | Low |
| D10 | `updated_at` triggers and `purchase_orders_order_date_idx` | present | absent | Low (SQL is what runs) |

## 7. Documented rules referenced above

### 7.1 Totals and rounding (FR-ERP2-05)

Implemented in `src/domain/rules.ts` (`calculatePoLinesAndTotal`) with `decimal.js`, never floating point.

1. `line_total = ROUND_HALF_UP(quantity x price, 2 decimal places)`
2. `total = sum of the already-rounded line_total values`, held at 2 decimals
3. `quantity` and `price` are returned as 2-decimal strings
4. A purchase order with zero lines is rejected (`EMPTY_ORDER_LINES`)
5. Worked example from the seed: 10.00 x 15.50 = 155.00 and 3.00 x 20.25 = 60.75 give a total of 215.75
6. Rounding example from the test suite: 3 x 0.335 = 1.005 rounds to 1.01 (half-up, not banker's rounding)

**Open finding R1**: step 1 multiplies the *unrounded* inputs, while step 3 stores the *rounded* quantity and price. For inputs with more than 2 decimals the stored `line_total` may not equal stored `quantity x price` (for example price `0.335` is stored as `0.34`, but 3 x 0.335 yields 1.01 instead of 3 x 0.34 = 1.02). Planned test TC-GAP-04 pins the intended behaviour. Decision needed from the ERP-2 domain owner.

### 7.2 Status values and transitions (FR-ERP2-04)

| From | Allowed next |
|---|---|
| Draft | Sent |
| Sent | Received |
| Received | Closed |
| Closed | none (terminal) |

`assertValidPoStatusTransition` rejects skips (Draft to Received), reversals (Sent to Draft) and self-transitions. Note: the contract and relationships tests describe a same-state request as an allowed no-op at the API/contract layer, while `rules.test.ts` rejects self-transition at the pure-domain layer. Both are tested; the reviewer should confirm that is intended.

### 7.3 Bank detail masking (FR-ERP2-06)

`maskBankDetails` keeps digits only and returns `XXXX-XXXX-<last 4 digits>`. Input shorter than 4 characters is rejected by `assertValidBankDetails` (`INVALID_BANK_DETAILS`). The database CHECK is a second line of defence: nothing but the masked pattern can be stored.

### 7.4 Cross-module boundaries (Decision C7)

- `po_lines.product_id` points at `erp1.products` **logically** only. No cross-schema FK.
- ERP-4 (vendor bills / accounting) references ERP-2 vendors and orders through public contracts and outbox events, never through direct table access.
- No sibling module and no Migration Kit adapter writes to the `erp2` schema directly.

### 7.5 Error envelope

All errors use `{ code, message, details }`. Observed HTTP mapping: 400 validation, 401 missing or invalid auth, 403 role not permitted, 404 missing record, 409 duplicate or idempotency conflict, **422** domain-rule failures (unknown vendor, invalid status transition). The issue text lists 400/401/403/404/409 only; 422 is used in practice and should be acknowledged at G1.
