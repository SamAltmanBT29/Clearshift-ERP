# Implementation Plan: ERP-4 Finance & Accounting Migration Kit Adapter & Durable Import Receipts

| Metadata | Details |
|---|---|
| **Issue** | #42: [ERP4-07] ERP-4 Finance and Accounting: Module Migration Kit adapter and durable import receipts |
| **Branch** | `feature/42-erp4-07-module-migration-kit-adapter-and-durable-import-receipts` |
| **Owner** | Group 9 — Role 2 — Integration / Backend Engineer |
| **Target** | Sprint 3 (Weeks 5-6) — Gate G4 |
| **Depends On** | ERP4-01, ERP4-03, KIT-08, PLT-04 |
| **Traceability** | SDS ClearShift ERP v2.0 §7.9, FR-ERP4-01..05, BR-ERP4-01..02; Project Plan §7.9; Architecture Spec §4.1, §4.3 |

---

## 1. Executive Summary & Problem Statement

ERP-4 Finance and Accounting is a core V1 target module for ClearShift managing chart of accounts, accounting periods, double-entry journal entries and lines, opening balance loads, and trial balances. As defined by the Master Architecture Spec (§4.1, §4.3) and Decision C4 / KIT-08:
1. **Public API Ingestion Only**: The shared Migration Kit loads records solely through the module's public API (`POST /api/v1/erp-finance/import`) or the in-process `TargetAdapter` port. The Migration Kit and external modules have **no direct database write privilege** to private module tables (`erp4.accounts`, `erp4.journal_entries`, `erp4.journal_lines`, `erp4.opening_balances`).
2. **Atomic Dual-Write Transaction Guarantee**: Every write from import carries `batch_id`, `source_row`, and a stable `Idempotency-Key`. The target domain mutation and durable import receipt (`erp4.import_receipts`) commit or roll back together in a single local PostgreSQL transaction.
3. **Deterministic Idempotency**:
   - Same `Idempotency-Key` + identical canonical request payload $\rightarrow$ returns the prior result (HTTP 200/201) with existing receipt, target ID, and `prior_result: true`.
   - Same `Idempotency-Key` + different payload $\rightarrow$ HTTP 409 Conflict with zero data mutation.
4. **Domain Invariant Enforcement**:
   - Every posted journal entry balances exactly at currency precision (`BR-ERP4-01`).
   - Debit and credit are non-negative, and cannot both be positive on one line.
   - Header and lines commit in one database transaction.
   - Posting locks the entry during validation; posted entries are immutable.
   - Corrections use reversal entries, not direct edits.
   - Each account code is unique; opening balance is loaded once per account/currency (`FR-ERP4-04`).
   - Each journal entry has one explicit `currency_code`; all its lines use that currency, balance is checked within that currency at 2 decimal places, and V1 performs no FX conversion. Trial balance totals are grouped by account and currency and never add unlike currencies (`FR-ERP4-03`).
   - Closed accounting period rejects posting (`BR-ERP4-02`).
5. **Robust Error & Classification Guarantees**:
   - Business rule rejection returns a stable reason code and plain-language safe message.
   - Unexpected / simulated infrastructure failure (503) rolls back transaction, remains retryable, and is never misclassified as bad data or written as a rejected receipt.
   - Batch runner bounds chunks to 500 rows, halts when failure rate exceeds 10% after 10 rows, and guarantees complete terminal outcome reconciliation (`source = loaded + rejected + unattempted`, `unaccounted = 0`).

---

## 2. Traceability Matrix

| Requirement / Invariant | Source | Implementation Mechanism | Verification Test |
|---|---|---|---|
| **FR-ERP4-01** | SDS §7.9 | Chart of Accounts hierarchy, code uniqueness, types `asset`/`liability`/`income`/`expense` | `apps/erp/modules/erp-4/tests/api/mutations.test.ts`, `idempotency.test.ts` |
| **FR-ERP4-02 / BR-ERP4-01** | SDS §7.9 | Balanced double-entry journal creation, posting lock, and immutable entries | `apps/erp/modules/erp-4/tests/api/mutations.test.ts`, `idempotency.test.ts` |
| **FR-ERP4-03** | SDS §7.9 | Trial balance grouped by account and currency; currency isolation | `apps/erp/modules/erp-4/tests/api/list.test.ts`, `idempotency.test.ts` |
| **FR-ERP4-04** | SDS §7.9 | One-time opening balances per account and currency pair | `apps/erp/modules/erp-4/tests/api/mutations.test.ts`, `idempotency.test.ts` |
| **BR-ERP4-02** | SDS §7.9 | Closed accounting period rejects posting | `apps/erp/modules/erp-4/tests/domain/relationships.test.ts`, `idempotency.test.ts` |
| **KIT-08 / C4** | Master Spec §4.1 | In-process `Erp4TargetAdapter` + `POST /api/v1/erp-finance/import` committing target row + receipt in 1 transaction | `apps/erp/modules/erp-4/tests/migration/idempotency.test.ts` |
| **Deterministic Idempotency** | Issue #42 Spec | SHA-256 canonical hash comparison; 3x retry gives 1 record; payload mismatch gives 409 | `apps/erp/modules/erp-4/tests/migration/idempotency.test.ts` |
| **Infrastructure Retry** | Issue #42 Spec | 503 infrastructure error rolls back transaction and is not recorded as rejected | `apps/erp/modules/erp-4/tests/migration/idempotency.test.ts` |
| **Batch Processing & Limits** | Core Rules / KIT-08 | 500 row chunks, 10% failure abort threshold, zero unaccounted rows | `apps/erp/modules/erp-4/tests/migration/idempotency.test.ts` |

---

## 3. Architecture & Design Decisions

### 3.1 Dual-Write Transaction Guarantee (KIT-08 / Decision C4)
- When importing an entity (`account`, `journal_entry`, `opening_balance`), the repository executes a transactional unit of work (`executeTransactional`).
- The domain mutation and durable receipt (`erp4.import_receipts`) are committed together.
- In `InMemoryFinanceRepository`, an in-memory snapshot clone ensures complete rollback if any validation or transient error occurs.
- In `DrizzleFinanceRepository`, a PostgreSQL transaction block commits both statements atomically.

### 3.2 Canonical Request Hashing & Idempotency Key FSM
- Canonical JSON serialization (keys recursively sorted, strings normalized) is passed to SHA-256.
- In `erp4_import_receipts`, `idempotency_key` is unique and indexes `request_hash`, `target_id`, `outcome`, `response_payload`, `batch_id`, and `source_row`.
- **Idempotency Lifecycle**:
  ```
  Incoming Request (Idempotency-Key: K, Payload: P)
     │
     ├── Calculate request_hash = SHA256(canonicalize(P))
     │
     ├── Lookup receipt by K
     │     │
     │     ├── Receipt Found
     │     │     ├── receipt.request_hash === request_hash
     │     │     │     └── Return HTTP 200 (prior_result: true, target_id, receipt)
     │     │     └── receipt.request_hash !== request_hash
     │     │           └── Throw HTTP 409 Conflict (IDEMPOTENCY_KEY_PAYLOAD_MISMATCH)
     │     │
     │     └── Receipt Not Found (Fresh)
     │           └── Start local PG transaction:
     │                 ├── Validate domain rules (invariants)
     │                 ├── Write domain record (e.g. account, journal_entry, opening_balance)
     │                 ├── Write durable import receipt
     │                 └── Commit transaction -> Return HTTP 201 (prior_result: false)
  ```

### 3.3 Target Adapter Port Implementation (`@cs/kit`)
- `Erp4TargetAdapter<TRow = unknown>` implements `TargetAdapter<TRow>`:
  - `preflight(batchId, rows)`: Performs zero-database dry-run validation returning `{ validCount, rejectCount }`.
  - `importRow(batchId, sourceRow, idempotencyKey, cleanData)`: Invokes the atomic service import method, mapping domain/conflict/validation errors to `TargetAdapterError` while propagating transient/infrastructure errors (e.g. 503) for retry.
  - `loadBatch(batchId, rows, options)`: Executes chunked batches (500 rows), enforces 10% failure rate circuit breaker, and produces terminal outcome reconciliation.

---

## 4. File-by-File Implementation Plan

### 4.1 Schema & Database (`apps/erp/modules/erp-4/db/`)
1. **`apps/erp/modules/erp-4/db/schema.ts`**:
   - Update `erp4ImportReceipts` table definition to add:
     - `source_system`: `varchar(64)`
     - `source_id`: `varchar(128)`
     - `request_hash`: `varchar(64).notNull()`
     - `outcome`: `varchar(16).notNull().default('loaded')`
     - `response_payload`: `text('response_payload')` (serialized JSON)
   - Update `Erp4ImportReceipt` and `NewErp4ImportReceipt` type inferences.
2. **`apps/erp/modules/erp-4/db/import-receipts.ts`** (NEW):
   - Provide `findReceiptByKey` and `insertReceipt` helpers for Drizzle database access.

### 4.2 Repositories & Services (`apps/erp/modules/erp-4/src/services/`)
1. **`apps/erp/modules/erp-4/src/services/repository.ts`**:
   - Add `canonicalizeJson` and `computeRequestHash` utilities.
   - Add `executeTransactional<T>(work: (txRepo: FinanceRepository) => Promise<T>): Promise<T>` to `FinanceRepository`.
   - Update `InMemoryFinanceRepository` with map snapshot/rollback transaction simulator and updated receipt fields.
   - Update `DrizzleFinanceRepository` with PG transaction block.
2. **`apps/erp/modules/erp-4/src/services/finance.service.ts`**:
   - Implement `importRow(req: ImportRowRequest): Promise<ImportRowResponse>`.
   - Implement handlers for:
     - `entity === 'account'` (with code uniqueness and hierarchy checks)
     - `entity === 'journal_entry'` (draft creation or posting with double-entry balance check and period guard)
     - `entity === 'opening_balance'` (one-time check per account and currency)
   - Idempotency check with canonical request hash comparison.
   - Dual-write transaction commit.

### 4.3 Routes & Migration Adapter (`apps/erp/modules/erp-4/src/`)
1. **`apps/erp/modules/erp-4/src/routes/import.ts`** (NEW):
   - Exposes `POST /import` (resolving to `/api/v1/erp-finance/import`).
   - Validates `ImportRowRequestSchema`, extracts `Idempotency-Key` header/body, calls `financeService.importRow`.
   - Returns 201 for fresh mutations, 200 for idempotent replays.
2. **`apps/erp/modules/erp-4/src/routes/index.ts`**:
   - Register `importRoutes` under `/import`.
3. **`apps/erp/modules/erp-4/src/migration/target-adapter.ts`** (NEW):
   - Implements `Erp4TargetAdapter` implementing `TargetAdapter` from `@cs/kit`.
   - Includes `preflight`, `importRow`, and `loadBatch` with chunking and failure rate abort.
4. **`apps/erp/modules/erp-4/src/index.ts`**:
   - Re-export `Erp4TargetAdapter`, `importRoutes`, and receipt helpers.

### 4.4 Shared Contracts & OpenAPI (`packages/contracts/`)
1. **`packages/contracts/src/erp-4.ts`**:
   - Ensure `ImportReceiptSchema` contains `source_system`, `source_id`, `request_hash`, `outcome`, `response_payload` (as optional/nullable) for complete parity with `ImportReceiptRecordSchema`.
2. **`packages/contracts/openapi/erp-4.yaml`**:
   - Add `/import` POST endpoint path, tag `Migration Import`, parameter `Idempotency-Key`, schema references for `ImportRowRequest` and `ImportRowResponse`.
   - Add `ImportRowRequest` and `ImportRowResponse` component schemas.

### 4.5 Documentation (`docs/`)
1. **`docs/plans/42-erp4-07-implementation-plan.md`**:
   - Commit comprehensive implementation plan.
2. **`docs/data-dictionaries/erp-4.md`** and **`apps/erp/modules/erp-4/docs/data-dictionary.md`**:
   - Update data dictionary documenting `POST /api/v1/erp-finance/import`, receipt fields, and adapter contract.

### 4.6 Verification Test Suite (`apps/erp/modules/erp-4/tests/`)
1. **`apps/erp/modules/erp-4/tests/migration/idempotency.test.ts`** (NEW):
   - Test 1: In-process target adapter preflight (zero DB mutation, valid/reject counts).
   - Test 2: In-process target adapter atomic dual-write of entity and receipt.
   - Test 3: Public API 3x identical retry produces exactly 1 business record and 1 durable receipt (201 -> 200 -> 200).
   - Test 4: Key reuse with different payload returns HTTP 409 Conflict without data mutation.
   - Test 5: Business validation rejections (unbalanced entry, duplicate account code, period closed) return stable reason codes.
   - Test 6: Simulated 503 transient infrastructure error rolls back transaction and does NOT record a rejected receipt.
   - Test 7: LoadBatch chunking (500 rows) and 10% excessive failure threshold abort with exact reconciliation (`total = loaded + rejected + unattempted`).
   - Test 8: Domain invariant: posted journal entry exact balance at currency precision.

---

## 5. Verification Commands & Acceptance Checklist

```bash
# 1. Run all ERP-4 unit, API, schema, and migration tests
npx vitest run apps/erp/modules/erp-4

# 2. Run shared contracts & OpenAPI validation tests
npx vitest run packages/contracts

# 3. TypeScript typecheck
npx tsc --noEmit

# 4. Verify git status and diff
git diff --check
git status --short
```
