# ERP-4 Finance & Accounting (V1) — Runbook & Module Handoff

Package `@cs/mod-erp4`. API base `/api/v1/erp-finance`. PostgreSQL schema `erp4`.
Tables: `erp4.accounts`, `erp4.accounting_periods`, `erp4.journal_entries`, `erp4.journal_lines`, `erp4.opening_balances`, `erp4.import_receipts`.

Data dictionary: [`docs/data-dictionary.md`](docs/data-dictionary.md) | Global data dictionary: [`docs/data-dictionaries/erp-4.md`](../../../../docs/data-dictionaries/erp-4.md) | OpenAPI contract: [`packages/contracts/openapi/erp-4.yaml`](../../../../packages/contracts/openapi/erp-4.yaml) | Demo script: [`docs/demo-scripts/erp-4-v1.md`](../../../../docs/demo-scripts/erp-4-v1.md)

---

## 1. Endpoints

| Method | Path | Summary / Invariants Enforced |
|---|---|---|
| `GET` | `/accounts` | List chart of accounts with server-side filters (`type`, `isActive`, `currencyCode`), search, and bounded paging (`pageSize <= 100`) |
| `GET` | `/accounts/{id}` | Retrieve single account by UUID |
| `POST` | `/accounts` | Create account; enforces unique code (409 `DUPLICATE_CODE`), required classification, and atomic receipt persistence |
| `PATCH` | `/accounts/{id}` | Update mutable account metadata; system identifiers and type are immutable |
| `GET` | `/journal-entries` | List journal entries filtered by `period_id`, `status`, `posting_date`, or `source_reference` |
| `GET` | `/journal-entries/{id}` | Retrieve journal entry header with all debit/credit lines |
| `POST` | `/journal-entries` | Create draft journal entry; validates minimum 2 lines and double-entry balance at 4 decimal places (BR-ERP4-01) |
| `PATCH` | `/journal-entries/{id}` | Update draft journal entry header or lines; rejected if entry is `posted` or `reversed` (422 `ENTRY_IMMUTABLE`) |
| `POST` | `/journal-entries/{id}/post` | Post draft entry; enforces double-entry balance, locked period guard (BR-ERP4-02), and sets immutable `posted_at` |
| `POST` | `/journal-entries/{id}/reverse` | Create compensating reversal entry with swapped debit/credit legs; links original with `reversed_by_entry_id` |
| `POST` | `/journal-entries/{id}/void` | Void draft entry; transitions draft to terminal `voided` state |
| `GET` | `/trial-balance` | Generate trial balance aggregated by account for a fiscal period; verifies `is_balanced` and excludes drafts |
| `GET` | `/opening-balances` | List loaded opening balances with bounded paging and filters |
| `GET` | `/opening-balances/{id}` | Retrieve single opening balance record by UUID |
| `POST` | `/opening-balances` | Bulk-load opening balances; enforces one-time load per account/currency (FR-ERP4-04); duplicates reported in `skipped` |
| `GET` | `/periods` | List fiscal accounting periods |
| `GET` | `/periods/{id}` | Retrieve fiscal period details and lifecycle status (`open`, `soft_closed`, `locked`) |
| `PATCH` | `/periods/{id}` | Update period status (Finance Admin role required) |
| `GET` | `/migration/profiling` | Migration Kit profiler inspection on legacy finance data |
| `GET` | `/migration/cleaning` | Inspect cleaning transformations and formula-safe audit log |
| `GET` | `/migration/mapping` | Inspect source-to-target field mapping templates and enum dictionaries |

---

## 2. Run the Evidence

```bash
# Verify environment
node -v                                     # must be Node.js 24.x LTS
npm install
npm run lint && npm run typecheck

# Run all ERP-4 unit, API, integration, and contract tests
npm run erp4:test

# Run database level constraints against real PostgreSQL (when DATABASE_URL is set)
DATABASE_URL=postgres://user:pass@localhost:5432/clearshift_test npx vitest run apps/erp/modules/erp-4/tests/db/constraints.test.ts

# Run in-process scripted demo journey
npx vitest run apps/erp/modules/erp-4/tests/e2e/demo-journey.test.ts

# Run Playwright browser journey
npm run erp4:e2e
```

| Layer | Test Location | Purpose |
|---|---|---|
| **Domain Invariants** | `tests/domain/invariants.test.ts`, `tests/db/schema.test.ts` | Mathematical balance, non-negative lines, currency precision, period guards |
| **API & Envelope** | `tests/api/auth-and-envelope.test.ts`, `tests/api/list.test.ts`, `tests/api/mutations.test.ts` | Error envelope, correlation ID, RBAC matrix, secret sanitization |
| **Contract Parity** | `tests/contract/openapi-parity.test.ts` | Fastify route tree parity against `packages/contracts/openapi/erp-4.yaml` |
| **DB Constraints** | `tests/db/constraints.test.ts` | Real PostgreSQL schema checks, unique indexes, and foreign keys |
| **Deterministic Seed** | `tests/seed/seed.test.ts`, `sample-data/erp-4/seed.ts` | Public API seeding with idempotency keys and replay determinism |
| **Demo Journey E2E** | `tests/e2e/demo-journey.test.ts` | In-process execution of the 5-minute V1 user workflow |
| **Browser Journey** | `e2e/erp-4-journey.spec.ts` | Playwright test suite in Chromium & Firefox against minimal Vite host |

---

## 3. Seed / Reset

```bash
# Run deterministic seed against running API (idempotent, public API only)
ERP4_BASE_URL=http://localhost:3000 ERP4_AUTH_TOKEN=role:admin npm run erp4:seed

# Full stack database reset (recreates schema, migrations, and standard seeds)
npm run db:reset
```

The seed script creates:
- 8 accounts across Asset, Liability, Income, and Expense classifications.
- 4 opening balances with fixed `SEED_BATCH_ID = 'b4000000-0000-4000-8000-000000000001'`.
- 4 journal entries (posted commercial sale, posted vendor disbursement, draft accrual, and posted-then-reversed charge).
- Re-running the seed is a deterministic, verified no-op (`replayed: true`).

---

## 4. Domain Invariants and Verification

| Invariant | Implementation Mechanism | Test Location |
|---|---|---|
| **Double-Entry Balance (BR-ERP4-01)** | `assertDoubleEntryBalanced`, `SUM(debit) === SUM(credit)` at 4 decimal places | `tests/domain/invariants.test.ts`, `tests/e2e/demo-journey.test.ts` |
| **Non-Negative Debit/Credit** | Database CHECK constraints `debit_amount >= 0`, `credit_amount >= 0` | `tests/db/constraints.test.ts`, `tests/domain/invariants.test.ts` |
| **Posted Entries Immutable** | State machine blocks mutations on status `'posted'` or `'reversed'` | `tests/domain/invariants.test.ts`, `tests/e2e/demo-journey.test.ts` |
| **Compensating Reversals Only** | Reversal swaps debit/credit lines into new entry and links via `reversed_by_entry_id` | `tests/domain/invariants.test.ts`, `tests/seed/seed.test.ts` |
| **Unique Account Codes (FR-ERP4-01)** | Unique index `accounts_code_unique` on `erp4.accounts (code)`; HTTP 409 | `tests/db/constraints.test.ts`, `tests/e2e/demo-journey.test.ts` |
| **One-Time Opening Balance (FR-ERP4-04)** | Unique constraint on `(account_id, currency_code)`; duplicates reported in `skipped` | `tests/db/constraints.test.ts`, `tests/e2e/demo-journey.test.ts` |
| **Period Posting Guard (BR-ERP4-02)** | Locked period rejects posting (HTTP 422 `PERIOD_LOCKED`); soft-closed requires `finance_admin` | `tests/domain/invariants.test.ts`, `tests/e2e/demo-journey.test.ts` |
| **Currency Isolation** | Journal entries enforce single currency across all lines; no auto-FX conversion | `tests/domain/invariants.test.ts` |
| **Trial Balance Integrity** | Sum of debits equals sum of credits; drafts excluded from posted balance | `tests/seed/seed.test.ts`, `tests/e2e/demo-journey.test.ts` |
| **Dual-Write Transactions** | Target record and durable import receipt commit atomically in one PostgreSQL transaction | `tests/migration/mapping.test.ts`, `tests/seed/seed.test.ts` |

---

## 5. Architectural Boundaries & Team Handoff

1. **Schema Ownership**: Schema `erp4` is owned strictly by the ERP-4 module. No other module, Migration Kit, or sibling service may write directly to `erp4.*` tables.
2. **Cross-Module References**: Cross-module entities (e.g. ERP-5 `department_ref`, ERP-3 `invoice` source references) are resolved exclusively through public contracts and `ReferenceResolver` adapters.
3. **No Compensating Sagas or Fuzzy Merges**: In accordance with ClearShift V1 boundaries, duplicate handling uses deterministic exact-key matching. Fuzzy matching and automated cross-database saga rollbacks are out of scope for V1.
4. **Synthetic Data**: Fixtures and seed scripts use synthetic data only; no real company, personal, or financial records exist in the repository.
