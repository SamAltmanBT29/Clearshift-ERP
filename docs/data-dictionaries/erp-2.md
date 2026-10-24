# ERP-2 Vendors & Purchasing — Data Dictionary (Global Reference)

This document is the global-docs copy of the module data dictionary.

For the canonical, detailed version see:
[`apps/erp/modules/erp-2/docs/data-dictionary.md`](../../apps/erp/modules/erp-2/docs/data-dictionary.md)

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-2 Vendors and Purchasing (Group 7) |
| **Issues** | #16: ERP2-01 (Schema, Drizzle Models & Guarded Migrations), #17: ERP2-02 (List/Read API with Bounded Paging & OpenAPI), #18: ERP2-03 (Mutation API and Domain Validation), #21: ERP2-06 (Relationships, State Transitions & Read Model Consistency), #22: ERP2-07 (Migration Kit Adapter), #25: ERP2-10 (QA Evidence & Seed), #132: ERP2-16 (Frontend Route Registration) |
| **PostgreSQL Schema** | `erp2` |
| **API Base** | `/api/v1/erp-vendors` |
| **OpenAPI Contract** | `packages/contracts/openapi/erp-2.yaml` |
| **Zod Contract** | `packages/contracts/src/erp-2.ts` |
| **Drizzle Model** | `apps/erp/modules/erp-2/db/schema.ts` |
| **Migration** | `packages/database/migrations/erp2_v1.sql` |
| **Tables** | `erp2.vendors`, `erp2.purchase_orders`, `erp2.po_lines`, `erp2.import_receipts` |
| **Version** | V1.0 |
| **SDS Reference** | ClearShift ERP v2.0 §4.3 (FR-ERP2-01..06, BR-ERP2-01), §4.7 (ERP-2 tables) |

## Table Index

| Table | Purpose | Key Constraint |
|---|---|---|
| `erp2.vendors` | Supplier / vendor master catalog with masked bank details | UNIQUE(`tax_number`), INDEX(`name`) |
| `erp2.purchase_orders` | Purchase order headers with status lifecycle & total | UNIQUE(`po_number`), FK(`vendor_id`$\rightarrow$ `vendors.id`) |
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
| `quantity` | `NUMERIC(12,2)` | NOT NULL | — | Purchased quantity | greater than 0 |
| `price` | `NUMERIC(18,2)` | NOT NULL | — | Unit purchase price | greater than or equal to 0 |
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
| `GET` | `/api/v1/erp-vendors/vendors` | List vendors | Paged (`page`, `pageSize <= 100`), search by name and tax number (case-insensitive), returns `bank_masked` |
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
4. **Strict State Machine (FR-ERP2-04)**: Status transitions must follow `Draft` $\rightarrow$ `Sent` $\rightarrow$ `Received` $\rightarrow$ `Closed`. Backwards transitions or cancellations are rejected with `INVALID_STATUS_TRANSITION`(HTTP 422). Marking status as `Received` does not alter inventory in V1.
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

---

## 9. QA Evidence (ERP2-10)

| Layer | Location |
|---|---|
| Domain unit tests | `apps/erp/modules/erp-2/tests/domain/` |
| Fastify injection tests (every endpoint, auth, validation, idempotency) | `apps/erp/modules/erp-2/tests/api/`, `apps/erp/modules/erp-2/tests/migration/` |
| DB constraint and transaction tests (real PostgreSQL, needs `DATABASE_URL`) | `apps/erp/modules/erp-2/tests/db/constraints.test.ts` |
| OpenAPI vs implemented routes | `apps/erp/modules/erp-2/tests/contract/openapi-parity.test.ts` |
| Deterministic seed (public API only, idempotent) | `sample-data/erp-2/seed.ts`, `apps/erp/modules/erp-2/tests/seed/` |
| Scripted V1 demo journey | `apps/erp/modules/erp-2/tests/e2e/demo-journey.test.ts`, `docs/demo-scripts/erp-2-v1.md` |
| Runbook and known defects | `apps/erp/modules/erp-2/README.md` |

Notes:
- Vendor search matches name and tax number, case-insensitively.
- Purchase order header and lines are written in one transaction.
- The public API accepts prices with up to 2 decimals. `line_total = round_half_up(quantity x price, 2)` and the order total is the sum of the line totals.
- Open defects and their issue links are tracked in the README "Known defects" table.

---

## 9. Primary Module List Screen Specification (ERP2-04 / Issue #19)

### 9.1 Overview & Architecture

The primary list screen for ERP-2 Vendors & Purchasing is delivered as a production vertical slice connecting React/TypeScript web components to the Fastify `/api/v1/erp-vendors` REST API.

| Aspect | Implementation Details |
|---|---|
| **Location** | `apps/erp/modules/erp-2/web/src/pages/VendorsListPage.tsx` |
| **API Client** | `apps/erp/modules/erp-2/web/src/api/erp-2.ts` (`fetchVendors`, `fetchPurchaseOrders`) |
| **Components** | `VendorsTable.tsx`, `PurchaseOrdersTable.tsx`, `FilterBar.tsx`, `StateViews.tsx` |
| **Styling** | `apps/erp/modules/erp-2/web/src/theme.css` (Minimal White Theme using `:root` CSS variables) |
| **Preview** | `apps/erp/modules/erp-2/web/preview.html` |
| **Tests** | `apps/erp/modules/erp-2/web/tests/VendorsListPage.test.tsx` (RTL) & `VendorsListPage.test.ts` (Domain) |

### 9.2 UI State Lifecycle

1. **Loading State**: `SkeletonTable` with shimmer effect, accessible `role="status"` and `aria-busy="true"`.
2. **Empty State**: `EmptyState` component displaying contextual zero-data messages when 0 records match the query.
3. **Error State**: `ErrorState` component with `role="alert"` and a recoverable "Try Again" retry button.
4. **Access Denied State**: `AccessDeniedState` component rendered on HTTP 403 Forbidden responses.
5. **Pagination**: Bounded server-side pagination with "Previous" / "Next" buttons and active page indicator. Any filter or search change immediately resets pagination to page 1.

---

## 10. Frontend Route & Shell Registration Matrix (ERP2-16)

### 10.1 Route Table Manifest

| Route ID | Path (relative to `/erp2`) | Full Path | Document Title | Nav Group | Nav Label | Screen Purpose |
|---|---|---|---|---|---|---|
| `vendors` | `vendors` | `/erp2/vendors` | Vendors · ClearShift ERP | `purchasing` | Vendors | Supplier catalog list with search & paging |
| `vendors-create` | `vendors/new` | `/erp2/vendors/new` | New vendor · ClearShift ERP | *None* | New vendor | Vendor creation form |
| `vendors-detail` | `vendors/:vendorId` | `/erp2/vendors/:vendorId` | Vendor · ClearShift ERP | *None* | Vendor | Vendor profile & terms view |
| `vendors-edit` | `vendors/:vendorId/edit` | `/erp2/vendors/:vendorId/edit` | Edit vendor · ClearShift ERP | *None* | Edit vendor | Vendor update form |
| `purchase-orders` | `purchase-orders` | `/erp2/purchase-orders` | Purchase orders · ClearShift ERP | `purchasing` | Purchase orders | Purchase order list with status filter |
| `purchase-orders-create` | `purchase-orders/new` | `/erp2/purchase-orders/new` | New purchase order · ClearShift ERP | *None* | New purchase order | PO creation with product picker |
| `purchase-orders-detail` | `purchase-orders/:purchaseOrderId` | `/erp2/purchase-orders/:purchaseOrderId` | Purchase order · ClearShift ERP | *None* | Purchase order | PO details, line items & status transitions |
| `import-receipts` | `import-receipts` | `/erp2/import-receipts` | Import receipts · ClearShift ERP | `integration` | Import receipts | Durable migration receipt audit (KIT-08) |
| `duplicates` | `duplicates` | `/erp2/duplicates` | Duplicate candidates · ClearShift ERP | `integration` | Duplicate candidates | Exact duplicate candidate review & audited decisions (ERP2-12 / KIT-10) |

### 10.2 Shell Layout & Accessibility Architecture

1. **Accessibility Landmarks**:
   - Skip Link: Targets `#erp2-main`, first in keyboard tab order.
   - Banner Landmark: `<header role="banner" aria-label="Vendors & Purchasing">` with eyebrow and module title.
   - Navigation Landmark: `<nav role="navigation" aria-label="Vendors and Purchasing">` with semantic groups.
   - Breadcrumb Landmark: `<nav role="navigation" aria-label="Breadcrumb">` rendering `Vendors & Purchasing → <Resource> → <Sub-action>`.
   - Main Content Landmark: `<main id="erp2-main" role="main" tabIndex={-1} aria-label="Vendors & Purchasing content">`.
   - Heading Rules: Exactly one `<h1>` rendered per page component.

2. **Route Guards & Session State**:
   - `RequireAuth`: Inspects `clearshift.access_token` in `sessionStorage`. Missing or expired tokens redirect to `/login?returnTo=<encodedPath>` preserving the requested URL.

---

## 11. Exact Duplicate Key Policy & Human Review Specification (ERP2-12 / KIT-10)

### 11.1 Overview & Invariants

ERP-2 Vendors & Purchasing enforces a deterministic, exact duplicate matching policy in accordance with ClearShift V1 core invariants:
1. **Deterministic Matching Only**: Duplicate detection relies strictly on exact normalized string equality (`confidence = 1.0`). Probabilistic scoring, fuzzy string matching (Levenshtein, Jaro-Winkler), and distance metrics are strictly out of scope for V1.
2. **Strict Prohibition of Fuzzy Auto-Merge**: Automated target-side merge sagas are prohibited in V1. Any duplicate consolidation requires explicit operator review and authorization.
3. **Ambiguity Handling**: Conflicting key matches across multiple entities (e.g., matching email but differing tax number) are classified as `AMBIGUOUS` and held in the review queue (`PENDING_REVIEW`).
4. **Immutable Audit Trail**: All human review decisions (`MERGE`, `REJECT`, `KEEP_BOTH`) are recorded synchronously in the shared `AuditService` with action `merge.decided`, actor ID, timestamp, kept ID, and merged ID.

### 11.2 Key Normalization Formulas

| Entity | Field | Normalization Function | Normalization Rule | Example Transformation |
|---|---|---|---|---|
| `erp2.vendors` | `tax_number` | `normalizeTaxNumber` | Trim leading/trailing whitespace, uppercase, strip separators `[\s\-._/]` | `"  us-ein-123.456/789  "` $\rightarrow$ `"USEIN123456789"` |
| `erp2.vendors` | `email` | `normalizeEmail` | Trim leading/trailing whitespace, convert to lowercase | `"  Sales@Acme.COM  "` $\rightarrow$ `"sales@acme.com"` |
| `erp2.purchase_orders` | `po_number` | `normalizePoNumber` | Trim leading/trailing whitespace, convert to uppercase | `"  po-2026-0001  "` $\rightarrow$ `"PO-2026-0001"` |

### 11.3 Classification Rules

| Classification | Condition | Resulting Action |
|---|---|---|
| `UNIQUE` | No normalized key matches any existing target record | Candidate is permitted to import directly without review |
| `EXACT_DUPLICATE` | Normalized `tax_number` or `email` matches an existing record with complete concordance | Held as duplicate candidate (`status: PENDING_REVIEW`, `confidence: 1.0`) |
| `AMBIGUOUS_CANDIDATE` | Keys conflict (e.g. tax number matches Vendor A, but email matches Vendor B) or match multiple distinct records | Held in review queue with `match_kind: AMBIGUOUS` for human operator adjudication |

### 11.4 Human Review API Contracts

- `POST /api/v1/erp-vendors/duplicates/check`: Deterministic batch scanner returning identified candidate collisions.
- `GET /api/v1/erp-vendors/duplicates/candidates`: Retrieves held candidate queue filtered by entity (`vendor`, `purchase_order`) or status.
- `GET /api/v1/erp-vendors/duplicates/candidates/:id`: Inspects candidate record details, diffs, and matching keys.
- `POST /api/v1/erp-vendors/duplicates/review`: Submits operator merge decision. Requires role `admin`, `migration_runner`, or `editor`, distinct `kept_id` and `merged_id` for merges, and a minimum 5-character documented rationale.

### 11.5 Audit Log Record Specification

On decision execution, the following immutable audit record is appended via `AuditService`:

```json
{
  "action": "merge.decided",
  "actor": "operator-user-id",
  "actorRole": "migration_runner",
  "targetEntity": "erp2.vendors",
  "targetId": "<kept_id>",
  "correlationId": "<correlation_id>",
  "result": "success",
  "reason": "Confirmed duplicate legal entity; retaining master account.",
  "metadata": {
    "candidateId": "<candidate_uuid>",
    "keptId": "<kept_id>",
    "mergedId": "<merged_id>",
    "decision": "MERGE",
    "matchingKey": "tax_number",
    "matchingValue": "TX-998877"
  }
}
```

---

## 12. Idempotent Retry & Partial-Load Stop Behavior Specification (ERP2-13 / KIT-12 / Issue #129)

### 12.1 Overview & Architecture Boundaries

ERP-2 implements high-reliability batch migration loading conforming to the ClearShift System Design Specification (SDS) and Architecture Decision Records (ADRs). The batch load engine guarantees safe chunking, transient failure resiliency, deterministic stop criteria on abnormal error rates, and complete audit durability without destructive compensating rollbacks.

### 12.2 Chunking Invariant (500 Rows)

- Batch payloads are partitioned into sequential, bounded chunks of at most **500 rows** (`CHUNK_SIZE = 500`).
- Processing occurs sequentially chunk by chunk, ensuring streaming memory bounds, predictable transaction lifecycles, and avoiding PostgreSQL statement timeout / lock escalation risks.
- Chunk boundaries do not alter per-row transactional boundaries: each row's business write and import receipt commit atomically in a single transaction.

### 12.3 Transient Failure Detection & Bounded Exponential Retry

- **Retry Policy**:
  - Max Retries: 3 attempts (`maxRetries = 3`).
  - Initial Delay: 50 ms (`initialDelayMs = 50`).
  - Backoff Factor: 2.0 exponential (`backoffFactor = 2.0`), yielding retry delays of 50ms, 100ms, and 200ms.
- **Classification of Errors**:
  - *Transient (Retryable)*: HTTP 503 Service Unavailable, HTTP 504 Gateway Timeout, connection reset (`ECONNRESET`), connection timeout (`ETIMEDOUT`), PostgreSQL deadlock detected (`40P01`), PostgreSQL admin shutdown (`57P01`), and transient query timeouts.
  - *Deterministic (Non-Retryable)*: Schema validation failures (400), domain integrity violations (422), business rule rejections, and natural key conflicts (409) are deterministic and fail immediately on the first attempt without retrying.
- **Strict Idempotency Key Preservation**:
  - Retries on transient errors **never** mutate, salt, or recompute the idempotency key (`batch_id + source_row + target entity/schema version`).
  - The exact same idempotency key and payload hash are reused across all retry attempts. If a transient network disconnect occurs after the database commit but before the HTTP response returns, the retry immediately matches the committed receipt and returns `prior_result: true` without secondary writes.

### 12.4 10% Failure Rate Stop Threshold Rule

- **Statistical Floor**: Evaluation begins only after a minimum statistical floor of **10 attempted rows** (`DEFAULT_MIN_ATTEMPTED_ROWS = 10`) to eliminate premature halts on early isolated row errors.
- **Threshold Rule**: Execution stops immediately when the failure rate exceeds **10% of attempted rows**:
  $$\text{Failure Rate} = \frac{\text{rejected}}{\text{attempted}} > 0.10$$
- **Halt Behavior**:
  - The batch transitions immediately to status `STOPPED_EXCESSIVE_FAILURES`.
  - Processing halts instantly: no further rows or chunks are attempted.
  - Remaining unattempted rows in the batch are explicitly recorded with outcome `unattempted`.
  - A comprehensive diagnostic message is recorded in `stoppedReason` detailing the exact failure count, attempted count, and calculated percentage.

### 12.5 Durability, Accounting Invariant, and Replay Safety

- **Durability**: All rows and import receipts committed prior to the halt remain fully durable in PostgreSQL.
- **Reconciliation Invariant**:
  $$\text{total} = \text{loaded} + \text{rejected} + \text{unattempted}$$
  $$\text{unaccounted} = 0$$
  Every row in the source batch has a deterministic, audited outcome state.
- **Idempotent Replay / Resumption**:
  - Operators or migration runners may re-submit the batch after correcting source data or transient issues.
  - Rows already committed return `prior_result: true` and are skipped idempotently without re-executing domain writes.
  - Previously unattempted or corrected rows proceed through normal ingestion.

### 12.6 Prohibition of V1 Rollback Sagas

- In strict compliance with ClearShift Core Rules, compensating rollback sagas are explicitly prohibited in V1 (`ROLLBACK_SAGA_PROHIBITED`).
- When a batch stops due to excessive failures, ClearShift preserves all durable evidence, target rows, and receipt logs for human inspection and auditable resumption. Under no circumstances are committed business rows or receipts rolled back or deleted.

---

## 13. Search, Filters and Sorting Controls (ERP2-18)

### 13.1 Debounced Search Bar (AC1)

| Parameter | Value |
|---|---|
| Component | `SearchBar` (`apps/erp/modules/erp-2/web/src/components/SearchBar.tsx`) |
| Debounce delay | 300ms from last keystroke |
| API parameter | `search` (string, max 100 chars) on `VendorListQuery` |
| PO search | Client-side text match on `po_number` only (API does not support PO search) |
| Clear behavior | Clicking ✕ fires `onChange('')` immediately (no debounce) |
| External reset | Internal state syncs when parent `value` prop changes (e.g. Clear All) |

### 13.2 Faceted Filter Sidebar (AC2)

| Facet | Scope | Options | API parameter |
|---|---|---|---|
| Currency | Vendors | All, USD, EUR, GBP | Client-side filter (not in API) |
| Status | Purchase Orders | All, Draft, Sent, Received, Closed | `status` on `PurchaseOrderListQuery` |

- Sidebar is collapsible on mobile (< 768px stacks above content).
- Radio group selection immediately updates filter state and triggers table reload.
- "Reset Filters" button clears all facets in the sidebar.

### 13.3 Active Filter Pill Tags (AC3)

| Feature | Behavior |
|---|---|
| Pill rendering | One pill per active filter (search, currency, status, vendor_id) |
| Individual remove | Clicking ✕ on a pill clears that specific filter and resets to page 1 |
| Clear All | Clicking "Clear All" resets all filters and sort to defaults |
| Empty state | Component returns `null` when no filters are active |

### 13.4 URL Query State Synchronization

Active filter values are synced to the browser URL using `window.history.replaceState`:

| Tab | URL parameters |
|---|---|
| Vendors | `?search=X&currency=Y&page=N&pageSize=M&sort=F&order=asc\|desc` |
| Purchase Orders | `?status=X&vendor_id=Y&page=N&pageSize=M&sort=F&order=asc\|desc` |

- Default values (`page=1`, `pageSize=20`, no sort) are omitted from the URL.
- Parameters are parsed on mount to restore filter state from shared/bookmarked URLs.

### 13.5 Empty State (AC4)

When a search or filter combination returns zero results and there is no loading or error state, the existing `EmptyState` component is displayed with:

- **Default title**: "No records found"
- **Default message**: "There are no records matching your current search or filter criteria."
- Optional action button (e.g. "Clear filters") to reset all filters.

### 13.6 CSS Scoping

All new CSS classes use the `cs-erp2-*` prefix to avoid collision with other modules:

- `cs-erp2-search-*` — Search bar tokens
- `cs-erp2-pill-*` — Filter pill tags tokens
- `cs-erp2-faceted-sidebar`, `cs-erp2-sidebar-*`, `cs-erp2-facet-*` — Sidebar tokens
- `cs-erp2-content-with-sidebar`, `cs-erp2-content-main` — Layout tokens

---

## 14. Create/Edit/Detail Workflow & Client-Side Validation Specification (ERP2-05 / Issue #20)

### 14.1 Overview & Architecture

Issue #20 (`[ERP2-05]`) establishes the full create, edit, and detail workflows for both Vendors and Purchase Orders in ERP-2. Consistent with SDS ClearShift ERP v2.0 §4.3 and §4.9:
- All forms provide real-time, field-level client-side validation for instant feedback while preserving the server's authoritative validation.
- Server-returned validation errors are mapped back to individual form fields with accessible alert labels.
- Sensitive banking coordinates are displayed masked (`XXXX-XXXX-7890`) upon read and edit operations.
- Purchase order lines compute exact line totals (`quantity * price`) live using decimal arithmetic, with the overall order total presented as read-only.
- Status transitions are strictly unidirectional (`Draft -> Sent -> Received -> Closed`) and gated behind an explicit confirmation dialog (`ConfirmActionDialog`).

### 14.2 Vendor Create, Edit & Detail Workflows

| View | Route | Component | Key Behaviors |
|---|---|---|---|
| Vendor Create | `/erp2/vendors/new` | `VendorCreatePage` | Validates required fields (`name`, `tax_number`, `email`), validates ISO currency and minimum bank detail length, submits to `POST /vendors`, and redirects to detail view. |
| Vendor Detail | `/erp2/vendors/:id` | `VendorDetailPage` | Renders complete procurement profile, displays server-masked bank coordinates (`XXXX-XXXX-7890`), and provides quick actions for `Edit Vendor` and `+ Create PO`. |
| Vendor Edit | `/erp2/vendors/:id/edit` | `VendorEditPage` | Fetches vendor by ID, prefills existing values, shows current masked bank details, accepts optional new bank coordinates without requiring re-entry, and submits to `PATCH /vendors/:id`. |

#### Field-Level Validation Rules

- **Legal Name (`name`)**: Required, trimmed string. Displays "Name is required" if omitted.
- **Tax Number / EIN (`tax_number`)**: Required, trimmed alphanumeric string. Enforces unique vendor tax identity.
- **Procurement Email (`email`)**: Required, validated against standard email format (`^[^\s@]+@[^\s@]+\.[^\s@]+$`).
- **Currency (`currency`)**: Optional, defaults to `USD`. Must be a 3-letter ISO 4217 code.
- **Bank Account Details (`bank_details`)**: Optional. On create, entering plain text values submits to server for SHA-256 masking and storage of last 4 digits. If entered, minimum length is 4 characters. On edit, existing masked details are displayed, and users may optionally provide replacement numbers.

### 14.3 Purchase Order Create & Detail Workflows

| View | Route | Component | Key Behaviors |
|---|---|---|---|
| PO Create | `/erp2/purchase-orders/new` | `PurchaseOrderCreatePage` | Supports optional `?vendor_id=` query param, dynamic line item add/remove, live decimal calculations, read-only total display, and submits to `POST /purchase-orders`. |
| PO Detail | `/erp2/purchase-orders/:id` | `PurchaseOrderDetailPage` | Renders order header, linked vendor reference, line items table, read-only computed total, and confirmation-gated status transition buttons. |

#### Live Line Totals & Read-Only Order Total

- **Line Total Calculation**: Line total is calculated dynamically as `calculateLineTotal(quantity, price)`.
- **Order Total**: Aggregated via `calculateOrderTotal()`. The order total is rendered as a prominent read-only summary card (`cs-summary-card`). The client never authoritatively submits an order total to the server; the backend calculates and commits the canonical total in PostgreSQL transactions.
- **Dynamic Items**: Operators can add arbitrary line items via `+ Add Line` or remove lines via `✕` (bounded to minimum 1 line).
- **Foreign Key Validation**: Requires valid RFC 4122 UUID for `vendor_id` (ERP-2) and `product_id` (ERP-1 product catalog).
- **Numeric Invariants**: Quantity must be strictly positive (`> 0`); Unit price must be non-negative (`>= 0`).

### 14.4 Irreversible Forward Status Transitions & Confirmation Gates

In accordance with BR-ERP2-01 and SDS §4.9, purchase order status transitions in V1 are strictly forward-only:

```
[Draft] ──(Send to Vendor)──> [Sent] ──(Mark as Received)──> [Received] ──(Close Order)──> [Closed]
```

- **Draft -> Sent**: Confirms order dispatch to the vendor.
- **Sent -> Received**: Confirms delivery of goods without modifying ERP-1 inventory (in V1).
- **Received -> Closed**: Terminates order lifecycle.
- **Closed**: Permanent terminal state. No transition buttons or actions are rendered. Backward transitions (e.g. `Sent -> Draft`) or cancellations are rejected.
- **Confirmation Dialog**: Each forward transition triggers `ConfirmActionDialog`, presenting the operator with the implications of the state advance and requiring an explicit confirmation click (`Confirm Transition`) before dispatching `PATCH /purchase-orders/:id`.

---

## 15. Loading, Empty, Error, and Access-Denied States Specification (ERP2-19 / Issue #135)

### 15.1 Overview & Architecture Boundaries

ERP-2 Vendors & Purchasing provides production-grade operational state views in strict conformance with the ClearShift V1 Master Architecture Specification and SDS ClearShift ERP v2.0 §4.3 & §4.9. All screen state representations integrate with shared platform components and adhere to the following invariants:
- **Zero Information Leakage**: Technical database dumps, Node.js filepaths, and raw execution stack traces are intercepted and sanitized before rendering to the DOM.
- **Accessible State Semantics**: Screen readers receive appropriate ARIA roles (`status` with `aria-busy="true"` for loading, `alert` for errors, `region` for empty and access-denied screens).
- **Recoverable vs Deterministic Actions**: Transient data fetch errors present a recoverable "Try Again" action; deterministic 403 authorization refusals never display a retry button.

### 15.2 Animated Loading Skeleton Placeholder (AC1)

During initial data fetching and tab switches, the table displays an animated skeleton placeholder:
- **Components**: `VendorsLoadingSkeleton`, `PurchaseOrdersLoadingSkeleton`, and `SkeletonTable` (`apps/erp/modules/erp-2/web/src/components/StateViews.tsx`).
- **Semantics**: Rendered with `role="status"`, `aria-busy="true"`, and accessible label (`Loading vendors table` / `Loading purchase orders table`).
- **Animation**: Placeholder cells utilize the `.cs-skeleton-cell` CSS class with shimmering CSS keyframe animation (`cs-shimmer 1.5s infinite`).
- **Lifecycle**: Replaced seamlessly with the populated data table upon resolution of the asynchronous query.

### 15.3 Zero-Data Condition & Action Callouts (AC2)

The system distinguishes between an empty catalog (zero-data condition) and an active filter producing zero matches:
- **Zero-Data State (Initial Catalog Empty)**:
  - Vendors: Renders "No vendors in supplier master" with guidance: "No vendor profiles have been recorded in the supplier master yet. Add your first vendor to establish supplier coordinates." Includes a prominent call-to-action button: `Add Vendor` (navigating to `/erp2/vendors/new`).
  - Purchase Orders: Renders "No purchase orders in ledger" with guidance: "No purchase orders have been recorded in the procurement ledger yet. Create your first purchase order to begin tracking supplier orders." Includes a call-to-action button: `New Purchase Order` (navigating to `/erp2/purchase-orders/new`).
- **Filtered Zero-Records State**:
  - When filters (e.g. search string, currency, or status) yield zero matches, displays "No matching vendors found" / "No matching purchase orders found" with a call-to-action button: `Clear all filters` or `Reset Search`.

### 15.4 Error Sanitization & Recoverable Alert Banner (AC3)

On API failure, the interface displays an accessible alert banner with recoverable action while hiding raw internal technical details:
- **Error Sanitization (`sanitizeErrorMessage`)**:
  - Strips multiline JavaScript stack frames (`at ...`), Node.js internal paths, and module paths (`node_modules`).
  - Masks internal SQL and ORM syntax error dumps (`syntax error`, `relation`, `drizzle-orm`, `postgres`, `pg-protocol`) and network socket failures (`ECONNREFUSED`, `ENOTFOUND`).
  - Converts low-level errors into safe operator-facing diagnostics (`A database connection error occurred while communicating with the server. Please try again or contact support.`).
  - Preserves user-facing domain validation messages and API envelope messages.
- **Alert Banner**:
  - Renders with `role="alert"` and accessible label.
  - Displays correlation reference ID (`Reference ID: <code>...</code>`) when provided by the backend error envelope.
  - Includes a `Try Again` retry action button that triggers a re-fetch without page reload.

### 15.5 HTTP 403 Forbidden Access-Denied View & Role Guidance (AC4)

When an API endpoint responds with HTTP 403 Forbidden:
- **Access-Denied State (`AccessDeniedState`)**:
  - Rendered with `role="region"` (or `role="alert"`), `aria-label="Access denied state"`, and title "Access Denied".
  - Explains the missing permission: displays `Required permission: module.read (or module.write)`.
  - Informs the operator: "Please contact your system administrator to assign the necessary role to your account."
  - **No Retry Button**: Because 403 Forbidden is a permanent authorization refusal, the component explicitly omits retry buttons to prevent misleading the user.

---

## 16. Create Form with Field-Level Validation & Modals Specification (ERP2-20 / Issue #136)

### 16.1 Overview & Scope

Issue #136 (`[ERP2-20]`) implements responsive, accessible entity creation modals with comprehensive client-side and server-side validation for Vendors and Purchase Orders within ERP-2:
- **`VendorCreateModal`**: Provides an accessible modal dialog wrapping `VendorForm` with instant field validation, double-submission locking, and field error mapping conforming to SDS §4.3 & §4.9.
- **`PurchaseOrderCreateModal`**: Accessible dialog wrapping `PurchaseOrderForm` with multi-line items, dynamic line additions/removals, live client decimal total calculation, and read-only canonical order totals.
- **Seamless List Integration**: In `VendorsListPage`, header quick actions (`+ Add Vendor`, `+ New Purchase Order`) open their respective modals; on completion, the modal closes, the newly created record prepends to the active table view cache (`setVendors((prev) => [created, ...prev])`), total count increments, and an accessible confirmation toast displays.

### 16.2 Field-Level Client-Side Validation Rules (AC1)

Forms execute client validation prior to payload submission and provide live feedback on change:

| Field | Entity | Validation Rule | Error Message |
|---|---|---|---|
| Legal Name (`name`) | Vendor | Non-empty trimmed string, max 255 chars | `Name is required` |
| Tax Number (`tax_number`) | Vendor | Non-empty trimmed string, max 64 chars | `Tax number is required` |
| Email (`email`) | Vendor | Non-empty RFC-compliant email string | `Valid email is required` |
| Phone (`phone`) | Vendor | Optional; regex `^\+?[0-9\s\-()]{7,25}$` if provided | `Phone number must be a valid format (min 7 digits, e.g. +1-555-0199)` |
| Currency (`currency`) | Both | 3-letter ISO 4217 uppercase code (e.g., `USD`) | `Currency must be a 3-letter ISO code (e.g. USD)` |
| Bank Details (`bank_details`) | Vendor | Optional; minimum 4 characters if provided | `Bank details must be at least 4 characters` |
| Vendor UUID (`vendor_id`) | PO | Required RFC 4122 UUID matching supplier master | `Valid Vendor UUID is required` |
| Order Date (`order_date`) | PO | Required ISO format `YYYY-MM-DD` | `Order date must be in YYYY-MM-DD format` |
| Lines (`lines`) | PO | At least 1 item line required | `At least one line item is required` |
| Product UUID (`product_id`) | PO Line | Required RFC 4122 UUID matching ERP-1 catalog | `Product UUID is required (ERP-1)` |
| Quantity (`quantity`) | PO Line | Positive decimal string (`> 0`) | `Quantity must be > 0` |
| Unit Price (`price`) | PO Line | Non-negative decimal string (`>= 0`) | `Price must be >= 0` |

### 16.3 Inflight Double-Submission Prevention (AC2)

- Upon submitting the form, `isSubmitting` / `isLoading` is set to `true`.
- The submission button is disabled and its label switches from `"Create Vendor"` / `"Create Purchase Order"` to `"Saving..."`.
- Cancel buttons are disabled to prevent state inconsistencies during flight.
- Secondary clicks or rapid double-clicks on the submission button are ignored.
- The disabled state is released in a `finally` block on error or when the modal closes upon completion.

### 16.4 Server Validation Error Mapping (AC3)

When the server returns an HTTP 400 Bad Request:
- Form-level error alerts display the top-level error message in a `cs-error-box` with `role="alert"`.
- Detailed field issues (from `err.details` array containing `path` / `field` and `message`) map directly to input fields via `setFieldErrors`.
- Each invalid field sets `aria-invalid="true"`, applies the `.cs-input-error` class, and links via `aria-describedby` to a `<span role="alert" class="cs-field-error">` containing the server message.

### 16.5 Modal Lifecycle, Cache Update & Confirmation Toast (AC4)

- **Modal Closure**: On successful API response, `isOpen` transitions to `false` and the form resets.
- **Cache Prepending**: In `VendorsListPage`, the newly returned entity is immediately prepended to local table state (`setVendors((prev) => [created, ...prev])`) and the total counter is incremented by 1 without requiring a full page refresh.
- **Confirmation Toast**: An accessible notification banner (`.cs-erp2-toast-banner`) announces the creation outcome with an explicit close button.

---

## 17. Detail/Edit Workflow, Audit Metadata, and Linked Records Specification (ERP2-21 / Issue #137)

### 17.1 Overview & Architecture

Issue #137 (`[ERP2-21]`) implements production-grade entity detail views, inline and drawer-based editing workflows, audit metadata panels, and cross-module linked record sub-tables for ERP-2 Vendors and Purchasing in accordance with SDS ClearShift ERP v2.0 §4.3 and §4.9:
- **Canonical Master Views**: Detail pages render primary entity attributes, server-masked bank coordinates, system timestamps, and cross-module Golden IDs (`GID-VENDOR-XXXX`).
- **Controlled Mutation Workflows**: Operators can update allowlisted fields via inline form controls or a dedicated edit drawer (`VendorEditDrawer`), strictly protected by RBAC permissions (`erp:vendors:write` / `vendors:write` / `admin`).
- **Downstream & Cross-Module Traceability**: Linked entity sub-tables expose related purchase orders in ERP-2, line item references to ERP-1 product master records (`/erp1/products/:id`), and downstream accounts payable vendor bills in ERP-4 (`/erp4/bills`).
- **Concurrent Conflict Protection (HTTP 409)**: Simultaneous edits by multiple operators or background batch syncs trigger an accessible conflict banner prompting the operator to refresh latest state and re-apply changes safely.

### 17.2 Primary Attributes, Timestamps & Canonical Golden ID Resolution (AC1)

The detail view displays all primary attributes alongside immutable system metadata:
- **Primary Attributes**: Legal name, Tax Number / EIN, procurement email, phone number, default currency, street address, city, country, and server-masked bank details (`XXXX-XXXX-7890`).
- **System Timestamps**: Formatted `created_at` and `updated_at` timestamps sourced directly from PostgreSQL timestamp columns.
- **Audit Panel (`VendorAuditPanel`)**: Dedicated component displaying internal record UUID, source system, source ID, and PCI/GDPR compliance status.
- **Canonical Golden ID Resolution (`resolveVendorGoldenId`)**:
  - If `vendor.golden_id` is present on the record, it is rendered directly.
  - If `vendor.source_id` is present, formats as `GID-VENDOR-${source_id.toUpperCase()}`.
  - Otherwise, derives deterministically from the internal UUID: `GID-VENDOR-${id.slice(0, 8).toUpperCase()}`.
  - Styled with a dedicated golden pill badge (`.cs-badge-golden`) for cross-module recognition across ERP-1, ERP-2, and ERP-4.

### 17.3 Inline Edit & Drawer Forms with Permission Enforcement (AC2)

Updating vendor attributes is supported through two flexible, accessible workflows:
- **Allowlisted Mutable Fields**: Operators can modify legal name, tax number, email, phone number, currency, address line, city, and country. Immutable fields (record UUID, Golden ID, `created_at`, `updated_at`, bank mask) are protected from accidental alteration.
- **Inline Edit Mode**: Toggled on `VendorDetailPage` via `Inline Edit`. Converts detail text items into validated input controls within the main card, with client-side validation rules, an active editing badge, and `Save Changes` / `Cancel` actions.
- **Slide-Over Drawer (`VendorEditDrawer`)**: Provides a slide-over modal for focused editing without losing page context.
- **RBAC Permission Gate**:
  - Evaluates session claims for write capabilities (`erp:vendors:write`, `vendors:write`, `admin`, `procurement_manager`).
  - When write permission is absent (`canEdit === false`), edit buttons are replaced with a read-only badge (`Permission: erp:vendors:write required`), drawer displays an access-denied message, and mutation requests are halted.
- **Double-Submit Locking**: Both inline and drawer submit buttons lock during flight (`disabled={isSubmitting}`) to prevent duplicate network calls.

### 17.4 Linked Entity Sub-Tables & Cross-Module Navigation (AC3)

Detail screens integrate linked entity sub-tables with explicit navigation paths across module boundaries:
- **Linked Purchase Orders (`VendorLinkedOrdersTable`)**:
  - Fetches and displays purchase orders associated with the vendor (`GET /purchase-orders?vendor_id=:id`).
  - Renders PO number, order date, status badge, line item count, and server-computed total.
  - Provides direct navigation links to `/erp2/purchase-orders/:id` and a "+ New Purchase Order" button.
  - Displays a clean zero-data state when no purchase orders exist yet.
- **Owning Module Links in Purchase Orders (`PurchaseOrderDetailPage`)**:
  - Owning vendor link navigates back to `/erp2/vendors/:vendor_id` with an `ERP-2 Master` badge.
  - Line items table explicitly links each `product_id` to the owning module catalog: `/erp1/products/:product_id` with an `ERP-1 Product` badge.
- **Downstream ERP-4 Finance & Bills Reference**:
  - Both vendor and purchase order detail pages render an ERP-4 downstream reference panel (`.cs-cross-module-panel`).
  - Provides direct deep links to matched vendor bills in ERP-4: `/erp4/bills?vendor_id=:id` and `/erp4/bills?po_number=:po_number`.

### 17.5 Concurrent Modification Conflicts (HTTP 409) & Refresh Action (AC4)

To prevent lost updates in distributed operational environments:
- When a `PATCH` request to update a vendor or purchase order fails with HTTP 409 Conflict:
  - An accessible alert banner (`.cs-conflict-banner` with `role="alert"`) displays prominently at the top of the detail page.
  - Diagnostic copy explains: *"Concurrent Modification Conflict (HTTP 409): This record was updated by another operator or background job while you were editing. To prevent data corruption, your changes were not applied."*
- **Actionable Refresh (`handleRefreshRecord`)**:
  - The banner renders an explicit action button: `🔄 Refresh Record and Re-apply Changes` (`data-testid="conflict-refresh-btn"`).
  - Clicking refresh calls `fetchVendorById(id)` to synchronize the latest canonical record from the server, clears the conflict error state, and displays a confirmation toast notifying the operator that current server state has been restored.

---

## 18. Module Authorization & Policy Integration Specification (ERP2-15 / Issue #131)

### 18.1 Overview & Architecture Integration

In accordance with SDS §4.2, §4.9 and ADR-0006, ERP-2 Vendors & Purchasing integrates zero duplicate identity or authorization infrastructure. All authentication and authorization decisions delegate directly to the platform identity (`@cs/identity`, PLT-05) and access control (`@cs/rbac`, PLT-06) primitives.

- **Authentication**: Hub Ed25519 signed JWT access tokens (`verifyAccessToken`), verifying issuer (`clearshift-hub`), audience (`clearshift`), signature, and token expiration. Inactive and revoked accounts are rejected (`401 Unauthorized`).
- **Authorization**: Pre-handler route guards enforcing capability requirements mapped from assigned roles. Requests lacking permissions fail closed (`403 Forbidden`).
- **Object-Level Boundaries**: Explicit multi-tenant boundary checks (`assertTenantAccess`) and record modification ownership checks (`assertObjectMutationAccess`).

### 18.2 Five-Role Capability Matrix across ERP-2 Endpoints

The module capability matrix maps the standard roles to operational permissions:

| Endpoint | HTTP Method | Required Capability / Action | Allowed Roles | Default Deny Roles |
|---|---|---|---|---|
| `/vendors` | `GET` | `read` (`records:read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `/vendors/:id` | `GET` | `read` (`records:read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `/vendors` | `POST` | `ingest` (`migrations:run`, `records:write`, `system:admin`) | Editor, Migration Runner, Admin | Viewer, Analyst |
| `/vendors/:id` | `PATCH` | `write` (`records:write`, `system:admin`) | Editor, Admin | Viewer, Migration Runner, Analyst |
| `/purchase-orders` | `GET` | `read` (`records:read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `/purchase-orders/:id` | `GET` | `read` (`records:read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `/purchase-orders` | `POST` | `ingest` (`migrations:run`, `records:write`, `system:admin`) | Editor, Migration Runner, Admin | Viewer, Analyst |
| `/purchase-orders/:id` | `PATCH` | `write` (`records:write`, `system:admin`) | Editor, Admin | Viewer, Migration Runner, Analyst |
| `/duplicates/check` | `GET` | `read` (`records:read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `/duplicates/candidates` | `GET` | `read` (`records:read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `/duplicates/candidates/:id` | `GET` | `read` (`records:read`) | Viewer, Editor, Migration Runner, Analyst, Admin | None (with valid token) |
| `/duplicates/review` | `POST` | `review` (`duplicates:review`, `records:write`, `system:admin`) | Editor, Migration Runner, Admin | Viewer, Analyst |
| `/import` | `POST` | `ingest` (`migrations:run`, `records:write`, `system:admin`) | Editor, Migration Runner, Admin | Viewer, Analyst |
| `/import/batch` | `POST` | `ingest` (`migrations:run`, `records:write`, `system:admin`) | Editor, Migration Runner, Admin | Viewer, Analyst |

### 18.3 Default Deny & Standard Error Envelope

All authentication and authorization failures return HTTP 401 and 403 status codes conforming strictly to the ClearShift unified error envelope:

```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "code": "UNAUTHORIZED",
  "message": "Missing Authorization header. Bearer token required.",
  "details": [],
  "correlation_id": "a9a38ffb-d36c-4b68-98e3-0d33e5c9ef01"
}
```

```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "code": "FORBIDDEN",
  "message": "Role does not have permission to execute this operation. Required capability: records:write.",
  "details": [
    {
      "field": "authorization",
      "message": "Role does not have permission to execute this operation",
      "code": "FORBIDDEN"
    }
  ],
  "correlation_id": "a9a38ffb-d36c-4b68-98e3-0d33e5c9ef01"
}
```

### 18.4 Multi-Tenant Boundary Enforcement

Multi-tenant isolation is enforced on every operation:
- If a tenant context is established (via `x-tenant-id` header or JWT `tenant_id` claim), operations attempting to access or mutate records belonging to a different tenant are rejected with `403 Forbidden` (`code: TENANT_MISMATCH`).
- Ingestion endpoints (`/vendors`, `/purchase-orders`, `/import`) bind target records and dual-write receipts to the active tenant ID.

### 18.5 Object-Level Cross-User Mutation Safety

Mutation safety prevents unauthorized cross-user modifications:
- When a non-admin user attempts to update a record (`PATCH /vendors/:id` or `PATCH /purchase-orders/:id`), the user must either be an `admin` or the recorded creator of the entity (`assertObjectMutationAccess`).
- Non-admin attempts to overwrite another user's draft or record are rejected with `403 Forbidden` (`code: FORBIDDEN`).

---

## 19. Shared Migration Kit Wizard Integration & Module Metadata Specification (ERP2-22 / Issue #138)

### 19.1 Overview & Architecture Boundaries

In strict compliance with Gate G4 requirements and the "Zero duplicate wizards" architecture rule (H2), ERP-2 Vendors and Purchasing supplies its target schema metadata directly to the shared Migration Kit wizard (`MigrationKitWizard` from `@cs/ui`) via the central `migrationKitRegistry` (`@cs/kit`).
No custom import mapping wizard or duplicate UI components are created; the module defines rich schema definitions, human-readable labels, enum options, and required constraints that dynamically drive the wizard.

### 19.2 Registered Target Entities & Field Definitions (AC1, AC2)

The module registers target schema metadata across all 3 owned domain entities (`vendors`, `purchase_orders`, `po_lines`):

#### 1. Vendors (`erp2_vendors`)
- **Target Table**: `erp2_vendors`
- **Primary Key**: `id` (UUID)
- **Natural Key**: `tax_number`
- **Fields**:
  - `name`: string, required, label: "Vendor Name", rules: `FR-ERP2-01`, `RL-01`.
  - `tax_number`: string, required, label: "Tax Identification Number", rules: `FR-ERP2-01`, `BR-ERP2-01`, `RL-03`.
  - `email`: string, required, label: "Contact Email", rules: `FR-ERP2-01`, `RL-02`.
  - `phone`: string, optional, label: "Phone Number".
  - `address_line`: string, optional, label: "Address Line".
  - `city`: string, optional, label: "City".
  - `country`: string, optional, label: "Country".
  - `currency`: string, required, label: "Default Currency (ISO-4217)", default `USD`.
  - `bank_masked`: string, optional, label: "Masked Bank Details", rules: `FR-ERP2-02`, `BR-ERP2-02`. Example: `XXXX-XXXX-7890`. Server-side masked per PCI/GDPR.
  - `source_system`: string, optional, label: "Source System".
  - `source_id`: string, optional, label: "Source Record ID".
- **Mapping Defaults**: Maps legacy columns (`vendor_name` -> `name`, `tax_id` -> `tax_number`, `email` -> `email`, `currency` -> `currency`, `bank_account` -> `bank_masked`).

#### 2. Purchase Orders (`erp2_purchase_orders`)
- **Target Table**: `erp2_purchase_orders`
- **Primary Key**: `id` (UUID)
- **Natural Key**: `po_number`
- **Fields**:
  - `po_number`: string, required, label: "PO Number", rules: `FR-ERP2-03`, `BR-ERP2-01`.
  - `vendor_id`: uuid, required, label: "Vendor UUID", rules: `FR-ERP2-03`.
  - `order_date`: date, required, label: "Order Date (ISO-8601)", rules: `FR-ERP2-03`.
  - `status`: enum, required, label: "Lifecycle Status", rules: `FR-ERP2-04`. Enum options: `[Draft, Sent, Received, Closed]`.
  - `currency`: string, required, label: "Currency (ISO-4217)".
  - `total`: decimal, required, label: "Order Total", rules: `FR-ERP2-03`, `BR-ERP2-03`.
  - `notes`: string, optional, label: "Order Notes".
  - `source_system`: string, optional, label: "Source System".
  - `source_id`: string, optional, label: "Source Record ID".

#### 3. Purchase Order Lines (`erp2_po_lines`)
- **Target Table**: `erp2_po_lines`
- **Primary Key**: `id` (UUID)
- **Natural Key**: `po_id,line_number`
- **Fields**:
  - `po_id`: uuid, required, label: "Purchase Order UUID".
  - `product_id`: uuid, required, label: "Product UUID (ERP-1 Catalog)", rules: `FR-ERP2-03`, `Decision C7`.
  - `line_number`: number, required, label: "Line Number".
  - `quantity`: decimal, required, label: "Quantity", rules: `FR-ERP2-03`, `BR-ERP2-03`.
  - `price`: decimal, required, label: "Unit Price", rules: `FR-ERP2-03`, `BR-ERP2-03`.
  - `line_total`: decimal, required, label: "Line Total", rules: `FR-ERP2-03`, `BR-ERP2-03`.

### 19.3 Incompatible Source Type Detection & Warning Alerts (AC3)

The shared Migration Kit wizard integrates `checkTypeCompatibility` to analyze incoming source columns against target field types:
- **Type Incompatibilities**: Mapping non-coercible source types (such as `date` to numeric `decimal` total/price, or `boolean` to `enum` status) immediately triggers an operator warning banner (`[data-testid="type-incompatibility-warning"]`) and field-row warning callout.
- **Coercion Notices**: Mapping raw text columns to numeric or date fields renders informational notes explaining standard decimal parsing or ISO-8601 expectations.
- **Preset Staging**: Pre-configured synthetic datasets (`standard_vendors_csv`, `standard_purchase_orders_csv`, `incompatible_types_csv`, `incomplete_vendors_csv`) facilitate testing and operator validation.

### 19.4 Guard Blocking Unmapped Required Fields (AC4)

To guarantee that incomplete mappings never proceed to destructive operations or invalid runs:
- The wizard validates all required target fields across the active entity (`name`, `tax_number`, `email`, `currency` for vendors; `po_number`, `vendor_id`, `order_date`, `status`, `currency`, `total` for POs; `po_id`, `product_id`, `line_number`, `quantity`, `price`, `line_total` for PO lines).
- Whenever any required target field remains unmapped:
  - An unmapped required alert (`[data-testid="unmapped-required-alert"]`) displays the full list of missing fields.
  - "Proceed to Dry-Run" and "Start Migration Load" action buttons are strictly disabled (`disabled` and `aria-disabled="true"`).
- Once all required fields are mapped, the proceed actions become active and dispatch the validated mapping payload.

### 19.5 Host Page Integration (`VendorImportPage` & `VendorsListPage`)

- **Component**: `VendorImportPage` (`apps/erp/modules/erp-2/web/src/pages/VendorImportPage.tsx`) wraps `MigrationKitWizard` with module metadata, synthetic presets, and back navigation.
- **Navigation**: `VendorsListPage` exposes an "Import Data" button (`data-testid="btn-import-data"`) in the header actions bar that seamlessly switches to `VendorImportPage`.

| **`1.8.0`** | 2026-10-24 | Sprint 2 / Authorization Policy | Role 3 / Mahek Yadav (Issue #131 / ERP2-15) | Integrated module authorization and access control policy conforming to SDS §4.2, §4.9, and ADR-0006. Enforced 5-role capability matrix, Ed25519 Hub JWT validation, multi-tenant isolation, object-level creator mutation guards, and standard error envelopes. |
| **`1.9.0`** | 2026-10-24 | Sprint 4 / Migration Kit Metadata | Role 3 / Ninad Deodhare (Issue #138 / ERP2-22) | Integrated ERP-2 target schema metadata with shared Migration Kit wizard (`MigrationKitWizard`), dynamic field rendering, type compatibility checking, unmapped required fields guard, and `VendorImportPage`. |
