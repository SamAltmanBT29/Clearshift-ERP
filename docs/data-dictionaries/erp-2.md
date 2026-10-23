# ERP-2 Vendors & Purchasing — Data Dictionary

This document is the global reference copy of the data dictionary for ERP-2 Vendors & Purchasing.

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-2 Vendors and Purchasing |
| **Issues** | #17: ERP2-02 (List/Read API with Bounded Paging & OpenAPI), #18: ERP2-03 (Mutation API and Domain Validation), #22: ERP2-07 (Migration Kit Adapter) |
| **PostgreSQL Schema** | `erp2` |
| **API Base** | `/api/v1/erp-vendors` |
| **OpenAPI Contract** | `packages/contracts/openapi/erp-2.yaml` |
| **TypeScript Contracts** | `packages/contracts/src/erp-2.ts`, `packages/contracts/src/import-target.ts` |
| **Tables** | `erp2.vendors`, `erp2.purchase_orders`, `erp2.po_lines`, `erp2.import_receipts` |
| **Version** | V1.0 |
| **SDS Reference** | ClearShift ERP v2.0 §4.3, §4.7, §4.8, §7.7, FR-ERP2-01..06, BR-ERP2-01 |

---

## Table Index

| Table | Purpose | Key Constraints |
|---|---|---|
| `erp2.vendors` | Supplier / vendor master catalog with masked bank details | UNIQUE(`tax_number`), INDEX(`name`) |
| `erp2.purchase_orders` | Purchase order headers with status lifecycle & total | UNIQUE(`po_number`), FK(`vendor_id` $\rightarrow$ `vendors.id`) |
| `erp2.po_lines` | Line items linked to purchase order and ERP-1 product | FK(`po_id` $\rightarrow$ `purchase_orders.id`), INDEX(`product_id`) |
| `erp2.import_receipts` | Durable idempotency receipts for migration & integration | UNIQUE(`idempotency_key`), INDEX(`batch_id`, `source_row`) |

---

## 1. `erp2.vendors` — Vendor Master Catalog

**Purpose**: Stores supplier and vendor company profiles.  
**Functional Requirements**: FR-ERP2-01, FR-ERP2-02, FR-ERP2-06.

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `name` | `VARCHAR(255)` | NOT NULL | — | Legal business name of vendor | INDEX(`name`) |
| `tax_number` | `VARCHAR(64)` | NOT NULL | — | Unique taxpayer identification number | UNIQUE |
| `email` | `VARCHAR(255)` | NOT NULL | — | Primary procurement contact email | — |
| `phone` | `VARCHAR(32)` | NULL | — | Vendor contact phone number | — |
| `address_line` | `VARCHAR(255)` | NULL | — | Street address | — |
| `city` | `VARCHAR(100)` | NULL | — | City | — |
| `country` | `VARCHAR(64)` | NULL | — | Country of incorporation / residence | — |
| `bank_masked` | `VARCHAR(64)` | NULL | — | Masked banking details (`XXXX-XXXX-7890`) | Serialized masked only |
| `currency` | `VARCHAR(3)` | NOT NULL | `'USD'` | ISO 4217 currency code | 3 uppercase letters |
| `source_system` | `VARCHAR(64)` | NULL | — | Migration Kit provenance: source system | — |
| `source_id` | `VARCHAR(128)` | NULL | — | Migration Kit provenance: source entity ID | — |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last modification timestamp | — |

---

## 2. `erp2.purchase_orders` — Purchase Order Headers

**Purpose**: Stores purchasing headers, status progression, and computed order total.  
**Functional Requirements**: FR-ERP2-03, FR-ERP2-04, FR-ERP2-05.

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `po_number` | `VARCHAR(64)` | NOT NULL | — | Canonical human-readable PO number | UNIQUE |
| `vendor_id` | `UUID` | NOT NULL | — | Foreign key to `erp2.vendors.id` | FK $\rightarrow$ `vendors(id)` |
| `order_date` | `DATE` | NOT NULL | — | Transaction date of order | — |
| `status` | `erp2.po_status` | NOT NULL | `'Draft'` | Status: `Draft`, `Sent`, `Received`, `Closed` | Strict unidirectional FSM |
| `currency` | `VARCHAR(3)` | NOT NULL | `'USD'` | ISO 4217 currency code | — |
| `total` | `NUMERIC(18,2)` | NOT NULL | `0.00` | Server-recomputed order total | Non-negative decimal |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last modification timestamp | — |

---

## 3. `erp2.po_lines` — Purchase Order Lines

**Purpose**: Line items referencing catalog products from ERP-1.  
**Functional Requirements**: FR-ERP2-03, FR-ERP2-05, BR-ERP2-01.

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `po_id` | `UUID` | NOT NULL | — | Owning purchase order | FK $\rightarrow$ `purchase_orders(id)` ON DELETE CASCADE |
| `product_id` | `UUID` | NOT NULL | — | Product identifier owned by ERP-1 | Logical ref; verified via `ReferenceResolver` |
| `quantity` | `NUMERIC(12,2)` | NOT NULL | — | Purchased quantity | $> 0` |
| `price` | `NUMERIC(18,2)` | NOT NULL | — | Unit purchase price | $\ge 0` |
| `line_total` | `NUMERIC(18,2)` | NOT NULL | — | Server computed: `round(qty * price, 2)` | Decimal half-up rounding |

---

## 4. `erp2.import_receipts` — Durable Import Receipts

**Purpose**: Tracks mutation provenance, idempotency keys, and canonical payload hashes for KIT-08 / Decision C4.  
**Functional Requirements**: KIT-08, Decision C4.

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `batch_id` | `UUID` | NOT NULL | — | Migration batch identifier | — |
| `source_row` | `INTEGER` | NOT NULL | — | 0-indexed row position in migration batch | — |
| `source_system`| `VARCHAR(64)` | NULL | — | Source system name (e.g. legacy ERP) | — |
| `source_id` | `VARCHAR(128)` | NULL | — | Primary key in source system | — |
| `entity` | `VARCHAR(64)` | NOT NULL | — | Imported entity type (`vendor`, `purchase_order`) | — |
| `schema_version`| `INTEGER` | NOT NULL | `1` | Migration schema version | — |
| `idempotency_key`| `VARCHAR(128)` | NOT NULL | — | Stable idempotency key from caller | UNIQUE |
| `request_hash` | `VARCHAR(64)` | NOT NULL | — | SHA-256 hash of canonicalized JSON request | Mismatch detection (HTTP 409) |
| `target_id` | `UUID` | NOT NULL | — | Created target record primary key | — |
| `kind` | `VARCHAR(16)` | NOT NULL | `'created'` | Operation kind: `created`, `linked` | — |
| `outcome` | `VARCHAR(16)` | NOT NULL | `'loaded'` | Outcome: `loaded`, `rejected`, `merged`, `skipped` | — |
| `response_payload`| `TEXT` | NULL | — | Serialized target response payload | — |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Timestamp receipt was committed | — |

---

## 5. API Endpoints

| Method | Endpoint | Description | Constraints / Behaviors |
|---|---|---|---|
| `GET` | `/api/v1/erp-vendors/vendors` | List vendors | Paged (`page`, `pageSize <= 100`), search by name, returns `bank_masked` |
| `POST` | `/api/v1/erp-vendors/vendors` | Create vendor | Validates tax number uniqueness, masks bank details, optional idempotency key |
| `GET` | `/api/v1/erp-vendors/vendors/:id` | Get vendor by UUID | Returns single vendor with masked bank details |
| `PATCH` | `/api/v1/erp-vendors/vendors/:id` | Update vendor | Updates mutable fields; bank details masked server-side |
| `GET` | `/api/v1/erp-vendors/purchase-orders` | List purchase orders | Bounded pagination, filter by `vendor_id` and `status` |
| `GET` | `/api/v1/erp-vendors/purchase-orders/:id` | Get purchase order | Returns purchase order with line items |
| `POST` | `/api/v1/erp-vendors/purchase-orders` | Create purchase order | Validates vendor and products via ERP-1, computes order total server-side |
| `PATCH` | `/api/v1/erp-vendors/purchase-orders/:id` | Update PO status | Allowed forward transitions only: `Draft` $\rightarrow$ `Sent` $\rightarrow$ `Received` $\rightarrow$ `Closed` |
| `POST` | `/api/v1/erp-vendors/import` | Import row | KIT-08 adapter endpoint; atomic dual-write of target entity + receipt |

---

## 6. Core Domain Invariants & Business Rules

1. **Bank Details Privacy (FR-ERP2-06)**: Raw bank account numbers are never exposed in any list or detail query response, error message, or log. Serialized representation strictly follows the mask format `XXXX-XXXX-7890`.
2. **Server-Side Calculated Total (FR-ERP2-05)**: Line total is calculated as `round(quantity * price, 2)` using decimal half-up rounding. The order total is calculated as the sum of line totals. Any client-submitted total is ignored and overwritten.
3. **Cross-Module Referential Integrity (BR-ERP2-01 / Decision C7)**: Each purchase order line product reference is verified via the `ReferenceResolver` port provided by the kernel. If a product does not exist in ERP-1, the request is rejected with `UNKNOWN_PRODUCT` (HTTP 422).
4. **Strict State Machine (FR-ERP2-04)**: Status transitions must follow `Draft` $\rightarrow$ `Sent` $\rightarrow$ `Received` $\rightarrow$ `Closed`. Backwards transitions or cancellations are rejected with `INVALID_STATUS_TRANSITION` (HTTP 422). Marking status as `Received` does not alter inventory in V1.
5. **Idempotency & Atomic Dual-Write (KIT-08 / Decision C4)**:
   - Target row mutation and receipt insertion execute inside a single local PostgreSQL transaction.
   - Identical 3x replays produce 1 business row and 1 receipt (HTTP 200/201).
   - Key reuse with mismatched payload returns HTTP 409 Conflict with zero database mutation.
   - Unexpected infrastructure failure (HTTP 503) rolls back the transaction and is not recorded as a rejected business record.

---

## 6A. V1 Data-Quality & Migration Rules

Full catalogue: `apps/erp/modules/erp-2/docs/data-quality-rules.md` (rule catalogue version 1.0.0, 62 rules).

| Item | Value |
|---|---|
| Synthetic Dirty Data Pack | `sample-data/erp-2/dirty-data-v1.csv` (86 rows), SHA-256 `754c2740163de9d9ec8e8bdd5deee5cd87a7b4ddac0cde335388f7e7d076b725`, schema version 1 |
| Expected outcomes / manifest | `sample-data/erp-2/expected-profile.json` |
| Source-to-target mapping | `sample-data/erp-2/mapping-template.json` |
| Rules and tests | `apps/erp/modules/erp-2/src/migration/rules.ts`, `apps/erp/modules/erp-2/tests/migration/rules.test.ts` |

| Field | Required | Normalization | Accepted values / limits | Reject reason codes |
|---|---|---|---|---|
| `vendors.name` | yes | trim, collapse spaces | ≤ 255 chars | `VENDOR_NAME_REQUIRED`, `NAME_TOO_LONG` |
| `vendors.tax_number` | yes | strip spaces, upper-case | `^[A-Z0-9-]{3,64}$`; exact duplicate → review | `TAX_NUMBER_REQUIRED`, `INVALID_TAX_NUMBER_FORMAT`, `DUPLICATE_TAX_NUMBER_REVIEW` |
| `vendors.email` | yes | trim, lower-case | local@domain.tld, ≤ 255 | `EMAIL_REQUIRED`, `INVALID_EMAIL_FORMAT` |
| `vendors.phone` | no | strip separators | 7–15 digits, optional `+` | `INVALID_PHONE_FORMAT` |
| `vendors.address_line / city / country` | no | trim, collapse spaces | ≤ 255 / 100 / 64 | `ADDRESS_TOO_LONG`, `CITY_TOO_LONG`, `COUNTRY_TOO_LONG` |
| `vendors.bank_details` | no | strip spaces and dashes | 4–34 alphanumerics, ≥ 4 digits; reported masked only | `INVALID_BANK_DETAILS_FORMAT` |
| `vendors.currency` | yes (explicit) | trim, upper-case | USD, EUR, GBP | `CURRENCY_REQUIRED`, `INVALID_CURRENCY` |
| `purchase_orders.po_number` | no | strip spaces, upper-case | ≤ 64; exact duplicate → review | `PO_NUMBER_TOO_LONG`, `DUPLICATE_PO_NUMBER_REVIEW` |
| `purchase_orders.vendor_ref` | yes | strip spaces, upper-case | must match an accepted vendor tax number | `VENDOR_REF_REQUIRED`, `VENDOR_NOT_FOUND`, `VENDOR_REJECTED` |
| `purchase_orders.order_date` | yes | `YYYY/MM/DD` → `YYYY-MM-DD` | real calendar date; ambiguous formats rejected | `ORDER_DATE_REQUIRED`, `INVALID_ORDER_DATE`, `AMBIGUOUS_DATE_FORMAT` |
| `purchase_orders.status` | yes | trim, fix case | Draft, Sent, Received, Closed; no cancellation | `STATUS_REQUIRED`, `INVALID_STATUS` |
| `purchase_orders.currency` | yes (explicit) | trim, upper-case | USD, EUR, GBP | `CURRENCY_REQUIRED`, `INVALID_CURRENCY` |
| `purchase_orders.total` | derived | — | sum of line totals, must fit NUMERIC(18,2); source value ignored | `TOTAL_OVERFLOW` |
| `po_lines.product_id` | yes | trim, lower-case | UUID that exists in ERP-1 (ReferenceResolver) | `PRODUCT_ID_REQUIRED`, `INVALID_PRODUCT_ID_FORMAT`, `UNKNOWN_PRODUCT` |
| `po_lines.quantity` | yes | remove thousands commas, 2 decimals | > 0, ≤ 2 decimals, ≤ 10 integer digits | `QUANTITY_REQUIRED`, `INVALID_QUANTITY_FORMAT`, `NEGATIVE_AMOUNT`, `EXCESS_DECIMAL_PLACES`, `QUANTITY_NOT_POSITIVE`, `AMOUNT_OVERFLOW` |
| `po_lines.price` | yes | remove thousands commas, 2 decimals | ≥ 0, ≤ 2 decimals, ≤ 16 integer digits | `PRICE_REQUIRED`, `INVALID_PRICE_FORMAT`, `NEGATIVE_AMOUNT`, `EXCESS_DECIMAL_PLACES`, `AMOUNT_OVERFLOW` |
| `po_lines.*` (relationship) | — | — | line must attach to an accepted order | `ORPHAN_LINE`, `PARENT_PO_REJECTED`, `PARENT_PO_IN_REVIEW` |

Policies: raw input is never changed; no fuzzy matching; no automatic merge (duplicates are held for explicit review); an order loads whole or not at all.

---

## 7. Synthetic Demo & Runbook

### 7.1 Local Verification & Test Execution

Run the complete ERP-2 API and domain test suite:

```bash
# Run unit & API test suite for list/read and domain invariants
npx vitest run apps/erp/modules/erp-2/tests/api/list.test.ts

# Run mutation and domain rules test suites
npx vitest run apps/erp/modules/erp-2/tests/api/mutations.test.ts apps/erp/modules/erp-2/tests/domain/rules.test.ts

# Run complete ERP-2 test suite (vendors, purchase-orders, idempotency)
npx vitest run apps/erp/modules/erp-2/tests/
```

### 7.2 Synthetic Endpoint Demo Flow

#### 1. List Vendors with Bounded Paging & Search
```bash
# Bounded pagination (page 1, pageSize 20) with search by legal business name
curl -X GET "http://localhost:3000/api/v1/erp-vendors/vendors?page=1&pageSize=20&search=Acme" \
  -H "Authorization: Bearer role:purchasing_admin"
```
*Expected Output*: HTTP 200 with `items: [...]`, `total: 1`, `page: 1`, `pageSize: 20`, `totalPages: 1`, with `bank_masked: "XXXX-XXXX-7890"`.

#### 2. Read Single Vendor by ID
```bash
curl -X GET "http://localhost:3000/api/v1/erp-vendors/vendors/00000000-0000-0000-0000-000000000001" \
  -H "Authorization: Bearer role:purchasing_admin"
```
*Expected Output*: HTTP 200 with full vendor profile, bank details masked to `XXXX-XXXX-7890`.

#### 3. Create a Vendor with Server-Side Bank Masking
```bash
curl -X POST "http://localhost:3000/api/v1/erp-vendors/vendors" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer role:purchasing_admin" \
  -d '{
    "name": "Apex Industrial Supplies",
    "tax_number": "TX-APEX-001",
    "email": "procurement@apex-supplies.com",
    "phone": "+1-555-0188",
    "address_line": "500 Logistics Parkway",
    "city": "Chicago",
    "country": "USA",
    "bank_details": "98765432101234",
    "currency": "USD"
  }'
```
*Expected Output*: HTTP 201 Created with `bank_masked: "XXXX-XXXX-1234"`.

#### 4. Create Purchase Order with ERP-1 Product Verification & Server-Side Totals
```bash
curl -X POST "http://localhost:3000/api/v1/erp-vendors/purchase-orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer role:purchasing_admin" \
  -d '{
    "vendor_id": "00000000-0000-0000-0000-000000000001",
    "order_date": "2026-10-25",
    "currency": "USD",
    "lines": [
      {
        "product_id": "11111111-1111-1111-1111-111111111111",
        "quantity": "10.00",
        "price": "15.50"
      },
      {
        "product_id": "22222222-2222-2222-2222-222222222222",
        "quantity": "3.00",
        "price": "20.25"
      }
    ],
    "total": "9999.99"
  }'
```
*Expected Output*: HTTP 201 Created (Note: client-submitted `total: 9999.99` is ignored; server recalculates `155.00 + 60.75 = 215.75`).

#### 5. Filter Purchase Orders by Status
```bash
curl -X GET "http://localhost:3000/api/v1/erp-vendors/purchase-orders?status=Draft&page=1&pageSize=10" \
  -H "Authorization: Bearer role:purchasing_admin"
```
*Expected Output*: HTTP 200 with list of Draft POs.

#### 6. Transition Purchase Order Status
```bash
curl -X PATCH "http://localhost:3000/api/v1/erp-vendors/purchase-orders/00000000-0000-0000-0001-000000000001" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer role:purchasing_admin" \
  -d '{ "status": "Sent" }'
```
*Expected Output*: HTTP 200 with `status: "Sent"`. Attempting to transition back to `Draft` returns HTTP 422 `INVALID_STATUS_TRANSITION`.


