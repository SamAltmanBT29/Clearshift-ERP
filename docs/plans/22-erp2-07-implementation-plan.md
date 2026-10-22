# Implementation Plan: ERP-2 Vendors & Purchasing Migration Kit Adapter & Durable Import Receipts

| Metadata | Details |
|---|---|
| **Issue** | #22: ERP2-07 ERP-2 Vendors and Purchasing Module Migration Kit Adapter and Durable Import Receipts |
| **Branch** | `22-erp2-07-erp-2-vendors-and-purchasing-module-migration-kit-adapter-and-durable-import-receipts` |
| **Owner** | Group 7 — Role 2 — Integration / Backend Engineer |
| **Target** | Sprint 3 (Weeks 5-6) — Gate G4 |
| **Depends On** | ERP2-01, ERP2-03, KIT-08, PLT-04 |
| **Traceability** | SDS ClearShift ERP v2.0 §4.3, §4.7, §4.8, §7.7; Project Plan §7.7; Architecture Spec §4.1, §4.3 |

---

## 1. Executive Summary & Problem Statement

ERP-2 (Vendors and Purchasing) is a core V1 target module for ClearShift. It manages the vendor master catalog, purchase orders, and purchase order lines. As part of Migration Kit loading (KIT-08), data cannot be written directly into private database tables by the Migration Kit or external modules. All migration and external ingestion must flow through the approved public API and target adapter contract, guaranteeing:
1. **Zero direct DB writes from Kit/sibling modules**: Module database tables (`erp2_vendors`, `erp2_purchase_orders`, `erp2_po_lines`) are owned strictly by ERP-2.
2. **Atomic dual-write transaction guarantee**: The target business entity mutation and its durable import receipt (`erp2_import_receipts`) commit or roll back together in a single local PostgreSQL transaction.
3. **Deterministic idempotency**:
   - Same `Idempotency-Key` + identical canonical request payload $\rightarrow$ returns the prior result (HTTP 200/201) with existing receipt and target ID.
   - Same `Idempotency-Key` + different payload $\rightarrow$ HTTP 409 Conflict with zero data mutation.
4. **Domain invariant enforcement**:
   - Purchase order lines reference valid existing products verified via the owning ERP-1 API contract (`ReferenceResolver`). Unknown product $\rightarrow$ rejected with stable reason `UNKNOWN_PRODUCT`.
   - Purchase order total is recomputed server-side from lines using decimal arithmetic and half-up rounding. Clients cannot authoritatively provide totals.
   - Unidirectional purchase order lifecycle: `Draft` $\rightarrow$ `Sent` $\rightarrow$ `Received` $\rightarrow$ `Closed`. Backwards transitions and cancellations are rejected (HTTP 422).
   - Marking PO as `Received` does not alter inventory in V1 (goods receipts are V2).
   - Bank details are masked server-side (`XXXX-XXXX-7890`) and never exposed in responses or logs.

---

## 2. Traceability Matrix

| Requirement / Invariant | Source | Implementation Mechanism | Verification Test |
|---|---|---|---|
| **FR-ERP2-01** | SDS §4.3 | `GET /api/v1/erp-vendors/vendors` with bounded pagination and search by name | `api/vendors.test.ts` |
| **FR-ERP2-02** | SDS §4.3 | `POST /api/v1/erp-vendors/vendors` & `PATCH .../vendors/{id}` (name, tax_number, email, phone, address, bank details) | `api/vendors.test.ts` |
| **FR-ERP2-03** | SDS §4.3 | `POST /api/v1/erp-vendors/purchase-orders` with lines (product_id, quantity, price) | `api/purchase-orders.test.ts` |
| **FR-ERP2-04** | SDS §4.3 | PO status transitions: `Draft` $\rightarrow$ `Sent` $\rightarrow$ `Received` $\rightarrow$ `Closed` | `api/purchase-orders.test.ts` |
| **FR-ERP2-05** | SDS §4.3 | Server-side total calculation: `line_total = round(qty * price, 2)`, `total = sum(line_total)` | `api/purchase-orders.test.ts` |
| **FR-ERP2-06** | SDS §4.3 | Bank details masking format `XXXX-XXXX-7890` applied server-side | `api/vendors.test.ts`, negative leakage test |
| **BR-ERP2-01** | SDS §4.3 | PO line product verification via ERP-1 `ReferenceResolver.exists('product', id)`. Unknown $\rightarrow$ reject | `tests/migration/idempotency.test.ts` |
| **KIT-08 / C4** | Master Spec §4.1 | In-process `TargetAdapter` + `POST /api/v1/erp-vendors/import` committing target row + receipt in 1 transaction | `tests/migration/idempotency.test.ts` |
| **Idempotency** | Issue #22 Spec | SHA-256 canonical hash comparison; 3x retry gives 1 record; payload mismatch gives 409 | `tests/migration/idempotency.test.ts` |
| **Infra Retry** | Issue #22 Spec | 503 infrastructure error rolls back transaction and is not recorded as rejected | `tests/migration/idempotency.test.ts` |

---

## 3. Architecture & Design Decisions

### 3.1 Dual-Write Transaction Guarantee (KIT-08 / Decision C4)
- When importing a vendor or purchase order, the repository/service opens a local PostgreSQL transaction (or transactional unit of work).
- The domain entity (`erp2_vendors` or `erp2_purchase_orders` + `erp2_po_lines`) is written, and the durable receipt (`erp2_import_receipts`) is inserted in the **same transaction**.
- If any operation fails (e.g. database disconnect, constraint violation), the entire transaction aborts. No orphaned domain rows or orphan receipts can exist.

### 3.2 Canonical Request Hashing & Idempotency Key FSM
- An SHA-256 hash is computed over a canonical representation of the incoming business payload (sorted keys, trimmed string values, normalized numbers).
- In `erp2_import_receipts`, `idempotency_key` has a `UNIQUE` constraint and stores `request_hash`, `target_id`, `outcome`, and `response_payload`.
- **Workflow**:
  ```
  Incoming Request (Idempotency-Key: K, Payload: P)
         │
         ▼
  Compute hash(P)
         │
         ▼
  Query erp2_import_receipts WHERE idempotency_key = K
         ├── Found?
         │     ├── YES:
         │     │     ├── If stored.request_hash == hash(P):
         │     │     │     └── Return stored response (HTTP 200/201) [Idempotent Replay]
         │     │     └── Else:
         │     │           └── Return HTTP 409 Conflict ("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH")
         │     │
         │     └── NO:
         │           ├── Execute Domain Validation & Business Mutation
         │           ├── Insert Target Row(s)
         │           ├── Insert erp2_import_receipts row (K, hash(P), target_id, 'loaded')
         │           └── Commit Transaction & Return HTTP 201 Created
  ```

### 3.3 Cross-Module Reference Integrity (Decision C7)
- ERP-2 never creates foreign keys across database schemas to `erp1.products`.
- Product references in purchase order lines are validated at runtime via the `ReferenceResolver` port provided by `@cs/kernel` (injected with `erp1Resolver` or test mocks).
- If `await referenceResolver.exists('product', line.product_id)` returns `false`, the operation immediately halts with domain error `UNKNOWN_PRODUCT` / HTTP 422.

### 3.4 Strict State Machine for Purchase Orders
- Status values: `Draft` $\rightarrow$ `Sent` $\rightarrow$ `Received` $\rightarrow$ `Closed`.
- Permitted forward transitions:
  - `Draft` $\rightarrow$ `Sent`
  - `Sent` $\rightarrow$ `Received`
  - `Received` $\rightarrow$ `Closed`
- Disallowed: Backwards transitions (e.g. `Sent` $\rightarrow$ `Draft`), skipping steps (e.g. `Draft` $\rightarrow$ `Received`), cancellation in V1.
- Attempting invalid transitions throws `DomainError` / HTTP 422 with code `INVALID_STATUS_TRANSITION`.
- Moving to `Received` emits no stock changes to ERP-1 (receipts are V2).

### 3.5 Bank Masking Security Rule
- Vendors store bank details in encrypted or masked form; normal serializations, logs, and query endpoints expose only `bank_masked` with mask `XXXX-XXXX-7890` (retaining only the last 4 alphanumeric digits).
- The raw bank details are never returned in any response schema.

---

## 4. File-by-File Breakdown & Implementation Specifications

### 4.1 `packages/contracts/src/import-target.ts`
- Defines shared contracts for Migration Kit target adapters and public import routes:
  - `ImportOutcomeEnum = z.enum(['loaded', 'rejected', 'merged', 'skipped'])`
  - `ImportRowRequestSchema`: validates `batch_id` (UUID), `source_row` (nonnegative integer), `source_system` (optional string), `source_id` (optional string), `idempotency_key` (string 1-128 chars), `correlation_id` (optional string), `entity` (string), `record` (unknown/object).
  - `ImportReceiptRecordSchema`: validates receipt attributes (`id`, `batch_id`, `source_row`, `source_system`, `source_id`, `entity`, `schema_version`, `idempotency_key`, `target_id`, `kind`, `outcome`, `created_at`).
  - `ImportRowResponseSchema`: validates `{ target_id, target_version, outcome, receipt, prior_result }`.
  - `TargetAdapterErrorSchema`: validates `{ reason_code, message, field?, retryable }`.

### 4.2 `packages/contracts/src/erp-2.ts`
- Single source of truth for ERP-2 Zod schemas and TypeScript types:
  - Primitives: `CurrencyCode` (ISO-4217 3-letter uppercase), `UuidSchema`, `MoneyAmount`.
  - Enums: `PurchaseOrderStatusEnum` (`'Draft' | 'Sent' | 'Received' | 'Closed'`).
  - Vendor schemas:
    - `VendorSchema`: Full vendor entity representation with `bank_masked`.
    - `CreateVendorRequestSchema`: Input payload for creating a vendor (name, tax_number, email, phone?, address_line?, city?, country?, bank_details?, currency?, source_system?, source_id?).
    - `UpdateVendorRequestSchema`: Partial patch payload.
    - `VendorListQuerySchema`: Query filters (`page`, `pageSize`, `search`).
  - Purchase Order schemas:
    - `PurchaseOrderLineSchema` & `CreatePurchaseOrderLineRequestSchema`: `product_id`, `quantity`, `price`, `line_total`.
    - `PurchaseOrderSchema`: `id`, `po_number`, `vendor_id`, `order_date`, `status`, `currency`, `total`, `lines`, `created_at`, `updated_at`.
    - `CreatePurchaseOrderRequestSchema`: `vendor_id`, `order_date`, `currency?`, `po_number?`, `lines` (min 1 line).
    - `UpdatePurchaseOrderStatusRequestSchema`: `{ status: PurchaseOrderStatusEnum }`.
    - `PurchaseOrderListQuerySchema`: `page`, `pageSize`, `vendor_id?`, `status?`.
  - Import Schemas:
    - `VendorImportRowSchema`, `PurchaseOrderImportRowSchema`.

### 4.3 `packages/contracts/src/index.ts`
- Export `* from './erp-2.js'` and `* from './import-target.js'`.

### 4.4 `packages/contracts/openapi/erp-2.yaml`
- OpenAPI 3.1.0 specification defining all endpoints:
  - `GET /api/v1/erp-vendors/vendors` (search, paged)
  - `POST /api/v1/erp-vendors/vendors` (create with idempotency support)
  - `PATCH /api/v1/erp-vendors/vendors/{id}` (update vendor)
  - `GET /api/v1/erp-vendors/purchase-orders` (list POs)
  - `GET /api/v1/erp-vendors/purchase-orders/{id}` (get PO with lines)
  - `POST /api/v1/erp-vendors/purchase-orders` (create PO with calculated total)
  - `PATCH /api/v1/erp-vendors/purchase-orders/{id}` (allowed status transition only)
  - `POST /api/v1/erp-vendors/import` (Migration Kit public row import endpoint)

### 4.5 `apps/erp/modules/erp-2/db/schema.ts`
- Drizzle ORM schema defining module tables in `pgSchema('erp2')`:
  - `erp2_vendors`:
    - `id` (UUID PK), `name` (varchar 255), `tax_number` (varchar 64), `email` (varchar 255), `phone` (varchar 32), `address_line` (varchar 255), `city` (varchar 100), `country` (varchar 64), `bank_masked` (varchar 64), `currency` (varchar 3), `source_system` (varchar 64), `source_id` (varchar 128), timestamps.
    - Index on `name` (search), unique index on `tax_number`.
  - `erp2_purchase_orders`:
    - `id` (UUID PK), `po_number` (varchar 64, UNIQUE), `vendor_id` (FK to `erp2_vendors.id`), `order_date` (date), `status` (enum `po_status`), `currency` (varchar 3), `total` (numeric 18, 2), timestamps.
  - `erp2_po_lines`:
    - `id` (UUID PK), `po_id` (FK to `erp2_purchase_orders.id`), `product_id` (UUID), `quantity` (numeric 12, 2), `price` (numeric 18, 2), `line_total` (numeric 18, 2).
  - `erp2_import_receipts`:
    - `id` (UUID PK), `batch_id` (UUID), `source_row` (integer), `source_system` (varchar 64), `source_id` (varchar 128), `entity` (varchar 64), `schema_version` (integer default 1), `idempotency_key` (varchar 128, UNIQUE), `request_hash` (varchar 64), `target_id` (UUID), `kind` (varchar 16 default 'created'), `outcome` (varchar 16 default 'loaded'), `response_payload` (jsonb/text), `created_at` (timestamptz).

### 4.6 `apps/erp/modules/erp-2/db/import-receipts.ts`
- Dedicated receipt helper queries and schema re-exports.

### 4.7 `apps/erp/modules/erp-2/src/migration/target-adapter.ts`
- Implements `TargetAdapter<unknown>` from `@cs/kit`:
  - `readonly module = "erp2"`
  - `preflight(batchId, rows)`: In-memory dry run validation without DB mutation.
  - `importRow(batchId, sourceRow, idempotencyKey, cleanData)`: Runs within database transaction.
    - Computes canonical hash.
    - Checks prior receipt: returns existing result if identical; rejects with 409 if hash mismatch.
    - Performs entity creation and inserts receipt atomically.
    - Returns `{ targetId, receipt }` or `TargetAdapterError`.

### 4.8 `apps/erp/modules/erp-2/src/routes/import.ts`
- Fastify route handler for `POST /api/v1/erp-vendors/import`:
  - Accepts `batch_id`, `source_row`, `source_system`, `source_id`, `idempotency_key` (from body or `Idempotency-Key` header), `entity`, and `record`.
  - Maps to `targetAdapter.importRow`.
  - Maps errors to standard HTTP response:
    - 201 Created on fresh load
    - 200 OK on replay of identical key/payload
    - 409 Conflict on payload mismatch
    - 422 Unprocessable Entity on domain rule rejection (e.g., unknown product)
    - 503 Service Unavailable on infrastructure error (retryable, no rejection stored)

### 4.9 `apps/erp/modules/erp-2/src/routes/vendors.ts` & `purchase-orders.ts`
- Full REST endpoints implementing the specified contract baseline:
  - `GET /api/v1/erp-vendors/vendors`: Paged search by name, returns masked bank details.
  - `POST /api/v1/erp-vendors/vendors`: Validates name, tax number, email, masks bank details, creates record.
  - `PATCH /api/v1/erp-vendors/vendors/:id`: Modifies editable fields.
  - `GET /api/v1/erp-vendors/purchase-orders`: Paged list with status/vendor filters.
  - `GET /api/v1/erp-vendors/purchase-orders/:id`: Full PO detail with lines.
  - `POST /api/v1/erp-vendors/purchase-orders`: Validates vendor exists; resolves all line product IDs via `ReferenceResolver`; calculates line totals and PO total server-side; defaults to `Draft`.
  - `PATCH /api/v1/erp-vendors/purchase-orders/:id`: Allows valid forward transitions only (`Draft` $\rightarrow$ `Sent` $\rightarrow$ `Received` $\rightarrow$ `Closed`). Rejects backwards or skipped transitions. Does not touch inventory on `Received`.

### 4.10 `apps/erp/modules/erp-2/src/services/erp2.service.ts` & `repository.ts`
- Encapsulates domain logic, decimal arithmetic via `@cs/core` `Money` / `Decimal`, bank masking helper `maskBankDetails(raw: string): string`, and transactional persistence (both `NodePgDatabase` and `InMemoryErp2Repository` for ultra-fast, zero-dependency unit tests).

### 4.11 `apps/erp/modules/erp-2/src/app.ts` & `index.ts`
- `buildApp(options)`: Fastify instance factory with standardized error envelope, correlation ID propagation, and route registration under `/api/v1/erp-vendors`.
- `moduleDefinition`: Exported for monorepo auto-registration in `apps/api/src/module-registry.ts`.

### 4.12 `docs/data-dictionaries/erp-2.md`
- Complete data dictionary documenting tables (`erp2_vendors`, `erp2_purchase_orders`, `erp2_po_lines`, `erp2_import_receipts`), constraints, indexes, mask formats, and state transitions.

---

## 5. Test Suite Plan

### 5.1 `apps/erp/modules/erp-2/tests/migration/idempotency.test.ts`
1. **Identical Retries (3x)**: Submitting identical key and payload 3 consecutive times yields HTTP 201 on first run, HTTP 200 on runs 2 and 3; asserts exactly 1 vendor/PO row and exactly 1 receipt row in the database.
2. **Payload Mismatch (409 Conflict)**: Submitting key `K1` with payload `A`, then submitting key `K1` with payload `B`, returns HTTP 409 Conflict; asserts payload `B` did NOT mutate the database.
3. **Atomic Dual-Write Rollback**: Simulating an unhandled error/database crash during receipt insertion rolls back the business entity mutation; asserts zero orphan rows.
4. **Business Rule Rejection & No Receipt**: Submitting a PO with an unknown product ID (unresolvable in ERP-1) rejects with HTTP 422 `UNKNOWN_PRODUCT`; asserts no receipt or PO created.
5. **Infrastructure 503 Retryability**: Simulated 503 is returned as retryable failure; confirms it is NOT recorded as a permanent business rejection.

### 5.2 `apps/erp/modules/erp-2/tests/api/vendors.test.ts`
1. **Search & Pagination**: Search by partial name, bounded `pageSize` (max 100), pagination metadata.
2. **Bank Detail Masking**: Bank details submitted as raw strings are masked to `XXXX-XXXX-7890`; asserts raw details never appear in responses.
3. **Duplicate Tax ID Validation**: Attempting to create duplicate vendor tax number returns 400/409.

### 5.3 `apps/erp/modules/erp-2/tests/api/purchase-orders.test.ts`
1. **Server-Side Total Recomputation**: Submitting PO lines with specified price and quantity calculates exact line totals and order total; verifies client-submitted total is ignored/overwritten.
2. **ERP-1 Product Verification**: Calls `ReferenceResolver`; verifies valid product succeeds, unknown product fails.
3. **Strict Status FSM**:
   - `Draft` $\rightarrow$ `Sent` (allowed)
   - `Sent` $\rightarrow$ `Received` (allowed, asserts no inventory side effects)
   - `Received` $\rightarrow$ `Closed` (allowed)
   - `Sent` $\rightarrow$ `Draft` (rejected with 422)
   - `Closed` $\rightarrow$ `Draft` (rejected with 422)
   - `Draft` $\rightarrow$ `Received` (rejected with 422)

---

## 6. Acceptance Criteria Checklist

- [x] A fixture row can be loaded via the same public API used by the Kit; Kit has no direct target-table write privilege.
- [x] Retrying identical row payload/key 3 times produces one business record and one durable receipt.
- [x] Reusing a key with a different payload returns 409 and does not mutate data.
- [x] A business-rule rejection returns a reason code/plain-language safe message; a simulated 503 is retryable and is not recorded as rejected.
- [x] The receipt, target mutation and any outbox event commit or roll back together.
- [x] Every specified domain invariant is asserted by an automated test for ERP-2 Vendors and Purchasing: Every purchase-order line references a valid existing product through the owning ERP-1 API contract.
- [x] Issue contains no deferred business/architecture choice; any conflict with the source SDS is escalated and resolved before merge, not silently guessed.
- [x] PR passes root CI and has one reviewer outside the author; database/auth/finance-sensitive changes receive required additional owner review.

---

## 7. Execution Strategy (Phases)

| Phase | Tasks | Target Files |
|---|---|---|
| **Phase 1: Contracts & OpenAPI** | Create shared import target and ERP-2 schemas, update OpenAPI spec | `packages/contracts/src/import-target.ts`<br>`packages/contracts/src/erp-2.ts`<br>`packages/contracts/src/index.ts`<br>`packages/contracts/openapi/erp-2.yaml` |
| **Phase 2: Database Schema & Receipts** | Define Drizzle tables, constraints, receipt helpers | `apps/erp/modules/erp-2/db/schema.ts`<br>`apps/erp/modules/erp-2/db/import-receipts.ts` |
| **Phase 3: Domain Service & Repository** | Implement decimal total calculation, bank masking, FSM, and transaction repository | `apps/erp/modules/erp-2/src/services/erp2.service.ts`<br>`apps/erp/modules/erp-2/src/services/repository.ts` |
| **Phase 4: TargetAdapter & Import Route** | Implement KIT-08 `TargetAdapter`, public import route, canonical request hashing | `apps/erp/modules/erp-2/src/migration/target-adapter.ts`<br>`apps/erp/modules/erp-2/src/routes/import.ts` |
| **Phase 5: CRUD & State Transition Routes** | Implement vendor list/create/patch and PO list/get/create/patch routes, Fastify app factory | `apps/erp/modules/erp-2/src/routes/vendors.ts`<br>`apps/erp/modules/erp-2/src/routes/purchase-orders.ts`<br>`apps/erp/modules/erp-2/src/routes/index.ts`<br>`apps/erp/modules/erp-2/src/app.ts`<br>`apps/erp/modules/erp-2/src/index.ts` |
| **Phase 6: Documentation & Comprehensive Tests** | Create data dictionary, test suites (idempotency, vendors, purchase orders), run full typecheck & vitest | `docs/data-dictionaries/erp-2.md`<br>`apps/erp/modules/erp-2/tests/migration/idempotency.test.ts`<br>`apps/erp/modules/erp-2/tests/api/vendors.test.ts`<br>`apps/erp/modules/erp-2/tests/api/purchase-orders.test.ts` |
