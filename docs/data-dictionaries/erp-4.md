# ERP-4 Finance & Accounting — Data Dictionary (Global Reference)

This document is the global-docs copy of the module data dictionary.

For the canonical, detailed version see:
[`apps/erp/modules/erp-4/docs/data-dictionary.md`](../../apps/erp/modules/erp-4/docs/data-dictionary.md)

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-4 Finance & Accounting |
| **Issues** | #36 (Data Model), #37 (List/Read API & Contracts), #38 (Mutation API & Domain Validation), #39 (Chart of Accounts & Trial Balance UI), #40 (Journal Entry Builder & Live Balance Checker UI), #41 (Domain Relationships), #43 (Migration Profiling, Cleaning, Mapping & Dirty Data Pack), #170 (OpenAPI, Event and Mock Contract Package) |
| **PostgreSQL Schema** | `erp4` |
| **API Base** | `/api/v1/erp-finance` |
| **OpenAPI Contract** | `packages/contracts/openapi/erp-4.yaml` |
| **Mock Contract Package** | `@clearshift/contracts/erp-4-mock` (`createErp4MockServer()`, `npm run mock:erp-4`) |
| **Domain Events** | `@clearshift/contracts/erp-4-events` (PLT-04 / PLT-09 transactional envelopes) |
| **Tables** | `erp4.accounts`, `erp4.accounting_periods`, `erp4.journal_entries`, `erp4.journal_lines`, `erp4.opening_balances`, `erp4.import_receipts` |
| **Version** | V1.0.0 (Gate G1 Frozen Baseline) |
| **SDS Reference** | ClearShift ERP v2.0 §7.9, FR-ERP4-01..05, BR-ERP4-01..02 |

## Table Index

| Table | Purpose | Key Constraint |
|---|---|---|
| `erp4.accounts` | Chart of Accounts | UNIQUE(code) |
| `erp4.accounting_periods` | Fiscal calendar & period guard | UNIQUE(period_label), CHECK(date range) |
| `erp4.journal_entries` | Transaction headers | UNIQUE(entry_number), partial UNIQUE(idempotency_key) |
| `erp4.journal_lines` | Double-entry debit/credit lines | CHECK(not both), CHECK(at least one), CHECK(non-negative) |
| `erp4.opening_balances` | One-time balance loads | UNIQUE(account_id, currency_code) |
| `erp4.import_receipts` | Idempotent mutation & import tracking | UNIQUE(idempotency_key) |

## API Endpoints (Issues #37 & #38)

All collection endpoints support bounded pagination (`page`, `pageSize <= 100`, default 20) and server-side search. Mutations accept optional `Idempotency-Key` headers and import provenance (`batch_id`, `source_row`), persisting unique receipts atomically.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/erp-finance/accounts` | List chart of accounts with bounded paging & search |
| `GET` | `/api/v1/erp-finance/accounts/:id` | Retrieve single account by UUID |
| `POST` | `/api/v1/erp-finance/accounts` | Create new account (seed/admin/editor only) |
| `PATCH` | `/api/v1/erp-finance/accounts/:id` | Update mutable account fields (admin/editor only) |
| `GET` | `/api/v1/erp-finance/journal-entries` | List journal entries with period/date filters |
| `GET` | `/api/v1/erp-finance/journal-entries/:id` | Get journal entry with lines |
| `POST` | `/api/v1/erp-finance/journal-entries` | Create draft journal entry |
| `PATCH` | `/api/v1/erp-finance/journal-entries/:id` | Update draft journal entry header or lines |
| `POST` | `/api/v1/erp-finance/journal-entries/:id/post` | Post draft entry; enforces balancing invariant & period guard |
| `POST` | `/api/v1/erp-finance/journal-entries/:id/reverse` | Reverse posted entry via compensating reversal |
| `POST` | `/api/v1/erp-finance/journal-entries/:id/void` | Void draft entry (sets status to voided) |
| `GET` | `/api/v1/erp-finance/trial-balance` | Generate trial balance grouped by account & currency |
| `GET` | `/api/v1/erp-finance/opening-balances` | List opening balances |
| `GET` | `/api/v1/erp-finance/opening-balances/:id` | Get single opening balance by UUID |
| `POST` | `/api/v1/erp-finance/opening-balances` | Bulk-load opening balances (one-time per account/currency) |
| `GET` | `/api/v1/erp-finance/periods` | List fiscal accounting periods |
| `GET` | `/api/v1/erp-finance/periods/:id` | Get accounting period by UUID |
| `PATCH` | `/api/v1/erp-finance/periods/:id` | Update accounting period status (`open` -> `soft_closed` -> `locked`) |

## Domain Relationships & State Rules (Issue #41)

- **Chart of Accounts Hierarchy (`ACCOUNT_PARENT`)**: Child accounts may reference parent accounts in the same currency. Circular ancestor references and self-references are detected and rejected (`CYCLE_DETECTED`). Absent parent references emit approved warning `OPTIONAL_REFERENCE_ABSENT`.
- **Period Posting Guard (`JOURNAL_ENTRY_PERIOD`)**: Locked periods reject all postings unconditionally (`PERIOD_LOCKED`). Soft-closed periods require `finance_admin` or `admin` role (`PERIOD_SOFT_CLOSED`).
- **Journal Line Constraints (`JOURNAL_LINE_ACCOUNT`)**: Accounts must exist, be active, and have `is_posting_account = true`. Header accounts reject postings (`CANNOT_POST_TO_HEADER_ACCOUNT`).
- **Double-Entry Exact Balance (`BR-ERP4-01`)**: `SUM(debit) == SUM(credit)` within currency precision. Unbalanced entries are rejected at draft creation and posting (`UNBALANCED_ENTRY`).
- **Journal Entry Immutability & Reversal**: Posted entries are immutable. Reversals create a compensating entry with opposite debits/credits, linking bidirectionally via `reversed_by_entry_id`.
- **Opening Balances (`OPENING_BALANCE_ACCOUNT`)**: Loaded once per account/currency pair (`FR-ERP4-04`). Duplicate attempts are safely reported and skipped.
- **Cross-Module References (Decision C7)**: Cross-module references (e.g. department refs to ERP-5, source invoices to ERP-3) are verified via the `ReferenceResolver` port. No cross-schema foreign keys or direct writes are allowed.
- **Immediate Read Consistency**: Trial balance and detail endpoints immediately reflect posted and reversed movements without delay.

## Frontend Screens & Review Workflows (Issues #39 & #40)

The ERP-4 frontend implements the Minimal White Theme design system using CSS variables, semantic HTML, and the three mandatory UI states (loading skeleton, empty state, and error state with retry):

| Screen / Component | File Path | Purpose & Domain Invariant Enforced |
|---|---|---|
| **AccountsListPage** | `apps/erp/modules/erp-4/web/src/pages/AccountsListPage.tsx` | Master financial overview; tabbed view for Chart of Accounts, Trial Balance, and Journal Entries queue; initiates form creation and detail navigation. |
| **JournalEntryFormPage** | `apps/erp/modules/erp-4/web/src/pages/JournalEntryFormPage.tsx` | Full-page creation workflow with breadcrumb back-link, pre-flight account caching, inline GL account modal, and draft/post submission actions. |
| **JournalEntryDetailPage** | `apps/erp/modules/erp-4/web/src/pages/JournalEntryDetailPage.tsx` | Read-only ledger record view showing header metadata, balanced line items table, posting date, irreversible Post Draft confirmation, and Reversal entry trigger. |
| **JournalLinesEditor** | `apps/erp/modules/erp-4/web/src/components/forms/JournalLinesEditor.tsx` | Live double-entry balance checker (`BR-ERP4-01`); enforces mutual exclusivity of debit/credit per line, non-negative amounts, and minimum 2 lines requirement. |
| **JournalEntryForm** | `apps/erp/modules/erp-4/web/src/components/forms/JournalEntryForm.tsx` | Header fields (date, period, currency, description) and line items; client-side validation; preserves user input on server rejection. |
| **AccountCreateModal** | `apps/erp/modules/erp-4/web/src/components/forms/AccountCreateModal.tsx` | Accessible modal dialog for creating posting GL accounts on the fly without losing in-flight journal draft data. |
| **TrialBalanceTable** | `apps/erp/modules/erp-4/web/src/components/TrialBalanceTable.tsx` | Grouped debit/credit totals by account and period-end balance banner (`totalDebit === totalCredit`). |

## Domain Event Contracts (PLT-04 / PLT-09)

Published in `@clearshift/contracts/erp-4-events` with strongly-typed transactional payloads wrapped in `EventEnvelopeSchema`:

| Event Type | Producer | Entity Type | Trigger & Business Meaning |
|---|---|---|---|
| `erp.account.created` | `erp-4` | `account` | New GL account established in the Chart of Accounts |
| `erp.account.updated` | `erp-4` | `account` | Mutable account attributes modified (name, description, active status) |
| `erp.journal_entry.created` | `erp-4` | `journal_entry` | Balanced journal entry created in `draft` status |
| `erp.journal_entry.posted` | `erp-4` | `journal_entry` | Journal entry finalized and posted to General Ledger (immutable) |
| `erp.journal_entry.reversed` | `erp-4` | `journal_entry` | Posted entry reversed via compensating journal entry |
| `erp.journal_entry.voided` | `erp-4` | `journal_entry` | Unposted draft entry marked void |
| `erp.period.status_changed` | `erp-4` | `accounting_period` | Fiscal period lifecycle updated (`open` -> `soft_closed` -> `locked`) |
| `erp.opening_balance.created` | `erp-4` | `opening_balance` | One-time opening balance loaded for an account/currency pair |

## Deterministic Mock Contract Package & Server (Issue #170)

Exported from `@clearshift/contracts/erp-4-mock` and executable via `npm run mock:erp-4` (default port `4014`):
- Provides representative, schema-valid synthetic responses for all 18 V1 endpoints.
- Pre-seeded with 100% synthetic, reproducible test accounts, fiscal periods, and balanced journal entries.
- Validates double-entry balancing (`BR-ERP4-01`), period locking (`BR-ERP4-02`), and bounded pagination (`pageSize <= 100`).
- Provides in-process test injection via `createErp4MockServer()` and state reset via `mockServer.reset()`.

## Migration Data Quality Rules, Profiling & Dirty Data Pack (Issue #43)

As part of Sprint 3 (Weeks 5-6) / Gate G4 preparation, ERP-4 defines a complete data migration pack for legacy chart of accounts, opening balances, journal entries, and lines:
- **Rule Catalogue & Specification**: [`apps/erp/modules/erp-4/docs/data-quality-rules.md`](../../apps/erp/modules/erp-4/docs/data-quality-rules.md) defines 50+ deterministic rules across cleaning, field validation, and domain invariants (`ACC-*`, `OPB-*`, `JRN-*`, `JRL-*`).
- **Rule Engine & Profiler**: [`apps/erp/modules/erp-4/src/migration/rules.ts`](../../apps/erp/modules/erp-4/src/migration/rules.ts) implements deterministic streaming row evaluation, exact duplicate review candidate flagging, clean entity projection, and trial balance synthesis.
- **Dirty Data Pack**: [`sample-data/erp-4/dirty-data-v1.csv`](../../sample-data/erp-4/dirty-data-v1.csv) contains 143 deterministic synthetic rows covering all 4 entity types with explicit valid and invalid test cases for every field, enumeration, and domain invariant.
- **Canonical Profile & Manifest**: [`sample-data/erp-4/expected-profile.json`](../../sample-data/erp-4/expected-profile.json) establishes the immutable SHA-256 fingerprint, row-level outcome reconciliation (`source = accepted + rejected + review`, `unaccounted = 0`), and isolated balanced trial balance totals.
- **Target Mapping Template**: [`sample-data/erp-4/mapping-template.json`](../../sample-data/erp-4/mapping-template.json) specifies source-to-target schema projections, deterministic normalization policies, dependency-ordered loading sequences, and no-fuzzy-merge candidate review constraints.
- **Automated Verification**: [`apps/erp/modules/erp-4/tests/migration/rules.test.ts`](../../apps/erp/modules/erp-4/tests/migration/rules.test.ts) provides 27 comprehensive tests asserting fixture checksums, non-mutation invariants (`BR-KIT-03`), domain invariants (`BR-ERP4-01`, `BR-ERP4-02`), and public API contract conformance.

## Column Profiling Configuration & Expected-Result Assertions (Issue #182 / ERP4-26 / KIT-03)

- **Shared Migration Kit Profiler**: Integrated with `@cs/kit` shared column profiler (`packages/kit/src/domain/profiler.ts`) providing column-level profiling metrics, exact duplicate candidate grouping, and formula-safe CSV export (`exportProfileReportToCsv`).
- **Module Profiling Rules**: Configured in [`apps/erp/modules/erp-4/src/migration/profiling-config.ts`](../../apps/erp/modules/erp-4/src/migration/profiling-config.ts) for 24 module columns and exact duplicate keys (Account Code, Opening Balance, Journal Entry Number).
- **REST Endpoints**: Fastify 5 routes in [`apps/erp/modules/erp-4/src/routes/profiling.ts`](../../apps/erp/modules/erp-4/src/routes/profiling.ts):
  - `GET /api/v1/erp-finance/migration/profile`
  - `GET /api/v1/erp-finance/migration/profile/export`
  - `POST /api/v1/erp-finance/migration/profile`
- **Frontend Screen**: Accessible UI component [`DataHealthProfilePage.tsx`](../../apps/erp/modules/erp-4/web/src/pages/DataHealthProfilePage.tsx) displaying quality metrics, duplicate candidates review, and formula-safe CSV export.
- **Automated Verification**: [`apps/erp/modules/erp-4/tests/migration/profiling.test.ts`](../../apps/erp/modules/erp-4/tests/migration/profiling.test.ts) (20 tests).

## Cleaning Rules & Field-Level Change Audit (Issue #183 / ERP4-27 / KIT-04)

- **Shared Migration Kit Cleaner Engine**: Implemented in `@cs/kit` (`packages/kit/src/domain/cleaner.ts`) conforming to SDS §3.4 and §4.4 (FR-CL-01..05).
- **Canonical Cleaners**: 12 V1 cleaning rules including `RL-TEXT-01` (whitespace trim/collapse), `RL-TEXT-02` (control characters), `RL-NAME-01` (proper case), `RL-EMAIL-01` (email normalize), `RL-PHONE-01` (phone normalize), `RL-DATE-01` (ISO 8601 date coercion), `RL-CURRENCY-01` (currency & decimal format), `RL-REQ-01` (required field check), and `RL-FORMAT-01` (domain format check).
- **Field Change Audit Ledger**: Generates `kit_clean_log` records (`source_row`, `field_name`, `original_value`, `cleaned_value`, `rule_id`, `timestamp`) for every altered value.
- **Rule Toggles**: Allows selective activation/deactivation of cleaning rules for a batch run (`FR-CL-05`).
- **REST Endpoints**: Fastify 5 routes in [`apps/erp/modules/erp-4/src/routes/cleaning.ts`](../../apps/erp/modules/erp-4/src/routes/cleaning.ts):
  - `GET /api/v1/erp-finance/migration/clean`
  - `GET /api/v1/erp-finance/migration/clean/audit/export`
  - `POST /api/v1/erp-finance/migration/clean`
- **Frontend Screen**: Accessible UI component [`DataCleaningReviewPage.tsx`](../../apps/erp/modules/erp-4/web/src/pages/DataCleaningReviewPage.tsx).
- **Automated Verification**: [`apps/erp/modules/erp-4/tests/migration/cleaning.test.ts`](../../apps/erp/modules/erp-4/tests/migration/cleaning.test.ts) (20 tests).

## Versioned Contract Change Control Log

| Version | Date | Gate / Milestone | Author / Team | Description of Changes |
|---|---|---|---|---|
| **`1.0.0`** | 2026-10-22 | Gate G1 Baseline Freeze | Group 9 / Role 2 (Issue #170) | Complete OpenAPI 3.1 specification, Zod contract schemas, domain event schemas, and deterministic mock package published. Approved as frozen baseline for Gate G1. |
| **`1.1.0`** | 2026-10-23 | Sprint 3 / Gate G4 | Group 9 / Role 4 (Issue #43) | Added module-specific profiling, cleaning, mapping rules, 143-row synthetic dirty-data pack (`dirty-data-v1.csv`), expected profile manifest (`expected-profile.json`), target mapping template (`mapping-template.json`), and comprehensive automated migration test suite. |
| **`1.2.0`** | 2026-10-23 | Sprint 2 / Gate G2 | Group 9 / Role 4 (Issue #182 / ERP4-26) | Integrated shared Migration Kit profiler (`@cs/kit` / `KIT-03`), configured column quality metrics and exact duplicate candidate assertions, added formula-safe CSV data health export, Fastify 5 routes, React UI screen, and 20 automated tests. |
| **`1.3.0`** | 2026-10-23 | Sprint 3 / Gate G3 | Group 9 / Role 4 (Issue #183 / ERP4-27) | Implemented canonical 12 V1 cleaning rules (`@cs/kit`), field-level change audit ledger (`kit_clean_log`), rule toggle execution (`FR-CL-05`), formula-safe audit CSV export, Fastify 5 endpoints, React review screen (`DataCleaningReviewPage`), and 20 automated tests. |
