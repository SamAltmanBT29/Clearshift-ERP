# ERP-2 Vendors & Purchasing — Data Dictionary

This document is the global reference copy of the data dictionary for ERP-2 Vendors & Purchasing.

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-2 Vendors and Purchasing |
| **Issues** | #17: ERP2-02 (List/Read API with Bounded Paging & OpenAPI), #18: ERP2-03 (Mutation API and Domain Validation), #21: ERP2-06 (Relationships, State Transitions & Read Model Consistency), #22: ERP2-07 (Migration Kit Adapter) |
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

---

## 8. State Machine & Read Model Consistency Matrix (ERP2-06)

### 8.1 Purchase Order Status Transition Matrix

| Current Status | Allowed Next Status | Forbidden Next Statuses | Failure Code | Behavior on Same Status |
|---|---|---|---|---|
| `Draft` | `Sent` | `Received`, `Closed` | `INVALID_STATUS_TRANSITION` (422) | No-op (200 OK) |
| `Sent` | `Received` | `Draft`, `Closed` | `INVALID_STATUS_TRANSITION` (422) | No-op (200 OK) |
| `Received` | `Closed` | `Draft`, `Sent` | `INVALID_STATUS_TRANSITION` (422) | No-op (200 OK) |
| `Closed` (Terminal) | *None* | `Draft`, `Sent`, `Received` | `INVALID_STATUS_TRANSITION` (422) | No-op (200 OK) |

> **Note on Received Status**: Transitioning to `Received` marks the purchase order as fulfilled from the supplier perspective but does **not** alter warehouse stock levels in V1 (goods receipts and stock ledger adjustments are V2).

### 8.2 Read Model Consistency Guarantees
1. **Vendor**:
   - `bank_masked` matches regex `^XXXX-XXXX-\d{4}$` if present.
   - `source_system` and `source_id` are complete pairs.
2. **Purchase Order**:
   - Status is valid enumeration: `Draft`, `Sent`, `Received`, `Closed`.
   - Every line item's `line_total` equals `round(quantity * price, 2)` using half-up decimal rounding.
   - The purchase order `total` equals the exact sum of all line totals.
   - Client and API agree immediately upon mutation commit.
3. **Optional Link Handling**:
   - When an optional relationship (e.g. `source_system`/`source_id`, phone) is absent, code `ERP2_OPTIONAL_REFERENCE_ABSENT` is surfaced in warnings and the value remains `null`. No synthetic records are materialized.



