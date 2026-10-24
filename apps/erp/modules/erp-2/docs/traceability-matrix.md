# ERP-2 Vendors & Purchasing: Requirement-to-Test Traceability Matrix

**Issue**: [ERP2-24 / #140](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/140), Gate G1 design artifact
**Requirement source**: `docs/SDS_ClearShift_ERP.md` (FR-ERP2-01..06, BR-ERP2-01 at lines 195-201; later requirements at lines 408-410 and 494-495)
**Test root**: `apps/erp/modules/erp-2/` (paths below are relative to it)
**Status key**: `EXISTS` = test is in the repo today. `PLANNED` = test case defined here, not yet written. `UI` titles were not inventoried; the file is cited.

## 1. Must requirements

| Req | Requirement (SDS) | Prio | Level | Test file | Test case | Status |
|---|---|---|---|---|---|---|
| FR-ERP2-01 | Vendor list with search by name | Must | API | `tests/api/vendors.test.ts` | returns paginated vendor list with default pagination | EXISTS |
| | | | API | `tests/api/vendors.test.ts` | filters vendors by name search | EXISTS |
| | | | API | `tests/api/vendors.test.ts` | rejects invalid page or pageSize > 100 | EXISTS |
| | | | API | `tests/api/list.test.ts` | [AC-2] [SEARCH] performs server-side case-insensitive search by name | EXISTS |
| | | | API | `tests/api/list.test.ts` | [AC-5] returns empty result cleanly when search matches nothing | EXISTS |
| | | | API | `tests/api/list.test.ts` | [AC-3] [PAGINATION] returns deterministic non-overlapping records across pages | EXISTS |
| | | | API | `tests/api/list.test.ts` | [AC-4] [PARAMETERIZATION] ignores unknown query parameters safely without SQL modification | EXISTS |
| | | | DB | `tests/db/schema.test.ts` | [FR-ERP2-01] vendors enforce non-empty name and tax_number | EXISTS |
| | | | UI | `web/tests/VendorsListPage.test.tsx`, `web/tests/search-filter-controls.test.tsx`, `web/tests/paginated-data-table.test.tsx` | list, search, filter, paging screens | EXISTS (titles not inventoried) |
| FR-ERP2-02 | Create and edit a vendor: name, tax number, email, phone, address, bank details (masked) | Must | API | `tests/api/mutations.test.ts` | creates a vendor and masks bank details server-side (FR-ERP2-02, FR-ERP2-06) | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | updates allowed editable fields and masks updated bank details | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | rejects invalid request body with 400 and field details | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | rejects duplicate tax number with 409 Conflict | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | rejects duplicate tax number update with 409 Conflict | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | returns 404 for nonexistent vendor ID / returns 400 for malformed UUID in route parameter | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | ignores protected/system fields submitted by client (AC-10) | EXISTS |
| | | | Contract | `tests/contracts/erp-2.contract.test.ts` | validates a valid create vendor request / rejects a vendor request without name or tax number | EXISTS |
| | | | Contract | `tests/contracts/erp-2.contract.test.ts` | rejects unknown properties in CreateVendorRequest (strict schema) | EXISTS |
| | | | DB | `tests/db/schema.integration.test.ts` | rejects duplicate vendor tax_number | EXISTS |
| | | | UI | `web/tests/*` for `VendorCreatePage` / `VendorEditPage` forms | create and edit form behaviour | **PLANNED** (TC-GAP-07) |
| FR-ERP2-03 | Purchase order with lines: vendor link, date, status, lines (product, quantity, price) | Must | API | `tests/api/purchase-orders.test.ts` | creates purchase order and recomputes total server-side (FR-ERP2-03, FR-ERP2-05) | EXISTS |
| | | | API | `tests/api/purchase-orders.test.ts` | rejects purchase order with non-existent vendor (HTTP 422) | EXISTS |
| | | | API | `tests/api/purchase-orders.test.ts` | returns paged list with status and vendor filters | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | creates a PO with lines, default Draft status, and server-recomputed totals (FR-ERP2-03, FR-ERP2-05) | EXISTS |
| | | | Domain | `tests/domain/relationships.test.ts` | rejects currency mismatch between vendor and purchase order | EXISTS |
| | | | DB | `tests/db/schema.test.ts` | [FR-ERP2-03, FR-ERP2-05] purchase orders enforce non-empty po_number, 3-letter currency, non-negative total | EXISTS |
| | | | DB | `tests/db/schema.test.ts` | [FR-ERP2-03] po_lines enforce quantity > 0, price >= 0, line_total >= 0 | EXISTS |
| | | | DB | `tests/db/schema.test.ts` | po_lines enforce uniqueness on (po_id, line_number) | EXISTS |
| | | | DB | `tests/db/constraints.test.ts` | rejects a purchase order for an unknown vendor (FK) | EXISTS |
| | | | DB | `tests/db/constraints.test.ts` | purchase order header and lines are atomic: a bad line leaves no orphan header | EXISTS |
| | | | DB | `tests/db/constraints.test.ts` | deleting a purchase order cascades to its lines | EXISTS |
| | | | Domain | `tests/domain/rules.test.ts` | rejects empty lines / non-positive quantity / negative price (domain codes `EMPTY_ORDER_LINES`, `QUANTITY_MUST_BE_POSITIVE`, `PRICE_MUST_BE_NON_NEGATIVE`) | **PLANNED** (TC-GAP-09: confirm explicit cases; only the first 12 titles of this file were inventoried) |
| | | | E2E | `tests/e2e/demo-journey.test.ts` | vendor -> purchase order -> Sent -> Received -> Closed, with masking, totals and invariants | EXISTS |
| | | | UI | `web/tests/VendorsListPage.test.tsx`, `web/tests/route-manifest.test.ts` | PO list and routes | EXISTS (titles not inventoried) |
| FR-ERP2-04 | Status: Draft / Sent / Received / Closed | Must | Domain | `tests/domain/rules.test.ts` | allows valid forward sequential transitions | EXISTS |
| | | | Domain | `tests/domain/rules.test.ts` | rejects skipping states in forward flow | EXISTS |
| | | | Domain | `tests/domain/rules.test.ts` | rejects backward transitions | EXISTS |
| | | | Domain | `tests/domain/rules.test.ts` | rejects self-transitions | EXISTS |
| | | | Domain | `tests/domain/rules.test.ts` | has empty allowed transitions for Closed terminal state | EXISTS |
| | | | Domain | `tests/domain/invariants.test.ts` | only the three forward steps are allowed / error context carries current, target and allowed | EXISTS |
| | | | Domain | `tests/domain/relationships.test.ts` | accepts all approved statuses / rejects unknown or invalid status values with stable code | EXISTS |
| | | | Contract | `tests/contracts/erp-2.contract.test.ts` | allows valid forward status transitions: Draft -> Sent -> Received -> Closed | EXISTS |
| | | | Contract | `tests/contracts/erp-2.contract.test.ts` | rejects backwards status transitions / rejects skipping status steps / forbids any transition out of closed | EXISTS |
| | | | API | `tests/api/purchase-orders.test.ts` | executes valid forward transition flow: Draft -> Sent -> Received -> Closed (FR-ERP2-04) | EXISTS |
| | | | API | `tests/api/purchase-orders.test.ts` | rejects backwards transition (e.g. Sent -> Draft) with HTTP 422 | EXISTS |
| | | | API | `tests/api/purchase-orders.test.ts` | rejects skipped transition (e.g. Draft -> Received) with HTTP 422 | EXISTS |
| | | | API | `tests/api/auth-and-envelope.test.ts` | PATCH purchase order with an invalid status body is a 400 VALIDATION_ERROR | EXISTS |
| | | | DB | `tests/db/schema.test.ts` | exports the purchase order status enum with SDS values (FR-ERP2-04) | EXISTS |
| | | | DB | `tests/db/constraints.test.ts` | rejects an invalid status value (enum has no Cancelled in V1) | EXISTS |
| FR-ERP2-05 | Order total calculated from lines, not typed by hand | Must | Domain | `tests/domain/invariants.test.ts` | computes line_total and total with 2dp strings | EXISTS |
| | | | Domain | `tests/domain/invariants.test.ts` | avoids binary float error (0.1 * 3) | EXISTS |
| | | | Domain | `tests/domain/invariants.test.ts` | rounds half-up at 2dp (3 x 0.335 = 1.005 -> 1.01) | EXISTS |
| | | | Domain | `tests/domain/rules.test.ts` | accurately computes line totals and overall total with 2 decimal places | EXISTS |
| | | | API | `tests/api/purchase-orders.test.ts` | creates purchase order and recomputes total server-side (FR-ERP2-03, FR-ERP2-05) | EXISTS |
| | | | Seed | `tests/seed/seed.test.ts` | seeded totals are server-computed with half-up rounding | EXISTS |
| | | | DB | `tests/db/constraints.test.ts` | stores money as NUMERIC(18,2): exact decimals, overflow rejected | EXISTS |
| | | | Domain | `tests/domain/rounding-consistency.test.ts` | stored line_total equals stored quantity x price for inputs with more than 2 decimals (finding R1) | **PLANNED** (TC-GAP-04) |
| FR-ERP2-06 | Bank details masked everywhere: screens and logs show `XXXX-XXXX-7890` | Must | Domain | `tests/domain/rules.test.ts` | masks standard 12 to 16 digit account numbers with XXXX-XXXX-7890 format | EXISTS |
| | | | Domain | `tests/domain/rules.test.ts` | ignores non-digit characters and correctly masks last 4 digits | EXISTS |
| | | | Domain | `tests/domain/invariants.test.ts` | masks to XXXX-XXXX-<last4> / never leaks the leading digits | EXISTS |
| | | | Domain | `tests/domain/invariants.test.ts` | rejects bank details shorter than 4 chars / rejects whitespace-only bank details | EXISTS |
| | | | Contract | `tests/contracts/erp-2.contract.test.ts` | masks bank details to XXXX-XXXX-7890 format (FR-ERP2-06) | EXISTS |
| | | | Contract | `tests/contracts/erp-2.contract.test.ts` | enforces BankMaskedSchema on serialized Vendor | EXISTS |
| | | | Contract | `tests/contracts/erp-2.openapi.test.ts` | masks bank details on the serialized Vendor schema | EXISTS |
| | | | API | `tests/api/list.test.ts` | [AC-7] verifies bank details are always masked (never unmasked) | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | creates a vendor and masks bank details server-side (FR-ERP2-02, FR-ERP2-06) | EXISTS |
| | | | Seed | `tests/seed/seed.test.ts` | never stores or returns raw bank details | EXISTS |
| | | | DB | `tests/db/schema.test.ts` | [FR-ERP2-06] vendors enforce bank detail mask format XXXX-XXXX-7890 | EXISTS |
| | | | DB | `tests/db/schema.integration.test.ts` | rejects vendor with invalid bank_masked format | EXISTS |
| | | | API | `tests/api/bank-masking-logs.test.ts` | captured server logs and error envelopes never contain the raw account number | **PLANNED** (TC-GAP-01) |
| | | | Export | `tests/api/bank-masking-exports.test.ts` | any CSV/JSON export excludes raw bank data | **PLANNED** (TC-GAP-02, blocked until an export exists; FR-ERP2-12 is Should) |
| BR-ERP2-01 | A purchase line must reference an existing product; unknown product is a rejected row | Must | API | `tests/api/mutations.test.ts` | rejects purchase order if product does not exist in ERP-1 (BR-ERP2-01, AC-6) | EXISTS |
| | | | API | `tests/api/purchase-orders.test.ts` | rejects purchase order if product does not exist in ERP-1 (BR-ERP2-01) | EXISTS |
| | | | Migration | `tests/migration/idempotency.test.ts` | rejects purchase order with unknown product with stable reason code and creates no receipt | EXISTS |
| | | | Migration | `tests/migration/idempotency.test.ts` | successfully creates purchase order with valid ERP-1 products and calculated total | EXISTS |
| | | | Seed | `tests/seed/seed.test.ts` | rejects the seed when ERP-1 does not know the products (BR-ERP2-01) | EXISTS |
| | | | DB | `tests/db/constraints.test.ts` | has no FK from lines to ERP-1 products (cross-module integrity is via the resolver, Decision C7) | EXISTS |
| FR-ERP2-10 | Goods receipt: mark received quantity per PO line; status moves to Received | Must | n/a | n/a | The V1 schema has **no received-quantity column** on `po_lines`. Only the status move to `Received` is covered (FR-ERP2-04 tests). Confirm whether per-line receiving is V1 scope. | **GAP** (TC-GAP-03) |

## 2. Cross-cutting constraints from the issue

| Constraint | Test file | Test case | Status |
|---|---|---|---|
| Error envelope `{ code, message, details }` | `tests/api/auth-and-envelope.test.ts` | POST vendor with an empty body is a 400 VALIDATION_ERROR with details | EXISTS |
| | `tests/contracts/erp-2.openapi.test.ts` | declares the canonical ApiError envelope in components | EXISTS |
| 401 / 403 | `tests/api/auth-and-envelope.test.ts` | 401 when auth is required and header is missing / 401 on non-Bearer scheme / 401 on empty bearer token | EXISTS |
| | `tests/api/duplicates.test.ts` | rejects duplicate review attempt from unauthorized viewer role with HTTP 403 | EXISTS |
| 404 / 409 | `tests/api/mutations.test.ts`, `tests/db/constraints.test.ts` | returns 404 for nonexistent vendor ID; same key + different payload is a 409 | EXISTS |
| Correlation id | `tests/api/auth-and-envelope.test.ts` | echoes x-correlation-id / generates one when none is supplied | EXISTS |
| OpenAPI documented = implemented | `tests/contract/openapi-parity.test.ts` | every implemented route is documented / every documented route is implemented | EXISTS |
| V1 has no DELETE or PUT | `tests/contract/openapi-parity.test.ts` | V1 exposes no DELETE or PUT (no cancellation, no hard delete) | EXISTS |
| Idempotent import (KIT-08) | `tests/migration/idempotency.test.ts` | retrying identical row payload and key 3 times produces exactly 1 business record and 1 durable receipt | EXISTS |
| | `tests/migration/idempotency.test.ts` | reusing an idempotency key with a different payload returns 409 and does not mutate data | EXISTS |
| Atomic target write + receipt | `tests/migration/idempotency.test.ts` | commits target business record and durable receipt atomically; simulated 503 rolls back | EXISTS |
| Exact duplicate matching only (KIT-10) | `tests/domain/duplicate-policy.test.ts` | classifies exact tax number match as EXACT_DUPLICATE (confidence 1.0) | EXISTS |
| | `tests/api/duplicates.test.ts` | flags conflicting candidate keys as AMBIGUOUS held for human review (AC3) | EXISTS |
| Retry and stop rules (KIT-12), no V2 rollback saga | `tests/migration/batch-retry-stop.test.ts` | halts batch execution immediately when row failure rate exceeds 10%; committed records remain durable after a batch halts | EXISTS |
| 100% synthetic data | `tests/seed/seed.test.ts` | produces identical business data on a fresh reset (deterministic) | EXISTS |
| Dirty Data Pack profile matches plan | `tests/migration/dirty-data-plan.test.ts` | fixture row counts and outcomes match [`dirty-data-pack-plan.md`](./dirty-data-pack-plan.md) | **PLANNED** (TC-GAP-06) |
| SQL migration and Drizzle model agree | `tests/db/schema-drift.test.ts` | compares `information_schema` after migration to the Drizzle table definitions (drift register D1-D10) | **PLANNED** (TC-GAP-05) |

## 3. Should requirements (not required by the ERP2-24 acceptance criteria)

| Req | Requirement | Prio | Planned coverage |
|---|---|---|---|
| FR-ERP2-11 | Payment terms field on vendor | Should | No column in V1 schema. Not planned for Gate G1. |
| FR-ERP2-12 | Purchase report, totals per vendor and month, CSV export | Should | Not built. Would activate TC-GAP-02. |
| FR-ERP2-20 | Approval workflow above an amount | Should | Not built. |
| FR-ERP2-21 | Three-way match | Should | Not built, depends on ERP-4. |

## 4. Planned test register (gaps to close or decide at Gate G1)

| ID | Purpose | Proposed file | Blocking? |
|---|---|---|---|
| TC-GAP-01 | Raw bank account number never appears in logs or error responses (FR-ERP2-06, issue text "excluded from logs") | `tests/api/bank-masking-logs.test.ts` | Should close before G1 |
| TC-GAP-02 | Exports exclude raw bank data | `tests/api/bank-masking-exports.test.ts` | Blocked until an export exists |
| TC-GAP-03 | Decide FR-ERP2-10 scope (received quantity per line) | decision, then a schema change request | Needs product decision |
| TC-GAP-04 | Rounding consistency (finding R1) | `tests/domain/rounding-consistency.test.ts` | Needs domain-owner decision |
| TC-GAP-05 | SQL vs Drizzle drift guard | `tests/db/schema-drift.test.ts` | Recommended |
| TC-GAP-06 | Dirty Data Pack plan vs fixture | `tests/migration/dirty-data-plan.test.ts` | When fixture is built |
| TC-GAP-07 | Vendor create/edit form tests | `web/tests/VendorForms.test.tsx` | Recommended |
| TC-GAP-09 | Inventory remaining test titles in `rules.test.ts` and others (only the first 12 titles per file were captured when this matrix was built) | n/a | Housekeeping |

## 5. Coverage gate

Closure evidence requires **>= 60% domain coverage** with green CI. Suggested local check from the repo root:

```bash
npx vitest run --coverage apps/erp/modules/erp-2
```

Attach the summary table to the PR. If the coverage provider is not installed, use the CI job output instead.
