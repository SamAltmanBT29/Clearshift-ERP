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
| `erp4.import_receipts` | Idempotent mutation & import tracking | UNIQUE(idempotency_key), request_hash |

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
| `POST` | `/api/v1/erp-finance/import` | Import row via KIT-08 target adapter contract with durable receipts |

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

## 14. Mapping & Value Translation Configuration (Issue #184 / ERP4-28 / KIT-05)

- **Module Mapping Configuration**: [`apps/erp/modules/erp-4/src/migration/mapping-config.ts`](../../apps/erp/modules/erp-4/src/migration/mapping-config.ts) defines source-to-target field mapping templates, strict type coercion routines (ISO-8601 dates, decimal strings, booleans), enum translation dictionaries (`account_type`, `currency_code`, `status`), and required target column enforcement guards.
- **Web Metadata Bridge**: [`apps/erp/modules/erp-4/web/src/kit-metadata.ts`](../../apps/erp/modules/erp-4/web/src/kit-metadata.ts) registering ERP-4 metadata with `@cs/kit` `MigrationKitRegistry`.
- **REST Endpoints**: Fastify 5 routes in [`apps/erp/modules/erp-4/src/routes/mapping.ts`](../../apps/erp/modules/erp-4/src/routes/mapping.ts) (`/api/v1/erp-finance/migration/mapping/*`).
- **Frontend Screen**: Accessible UI component [`DataMappingConfigPage.tsx`](../../apps/erp/modules/erp-4/web/src/pages/DataMappingConfigPage.tsx) consuming shared `MigrationKitWizard`.
- **Automated Verification**: [`apps/erp/modules/erp-4/tests/migration/mapping.test.ts`](../../apps/erp/modules/erp-4/tests/migration/mapping.test.ts) (26 tests) and [`apps/erp/modules/erp-4/web/tests/DataMappingConfigPage.test.tsx`](../../apps/erp/modules/erp-4/web/tests/DataMappingConfigPage.test.tsx) (3 tests).

## 15. Module Route and Page Registration Using Shared Shell (Issue #172 / ERP4-16)

- **Route Manifest (`/erp4/*`)**: Defined in [`apps/erp/modules/erp-4/web/src/route-manifest.ts`](../../apps/erp/modules/erp-4/web/src/route-manifest.ts) registering all primary, secondary, and migration screens under prefix `/erp4`:
  - General Ledger: Accounts List (`/erp4/accounts`), Account Create (`/erp4/accounts/new`), Account Detail (`/erp4/accounts/:id`), Account Edit (`/erp4/accounts/:id/edit`), Journal Entries List (`/erp4/journal-entries`), Journal Entry New (`/erp4/journal-entries/new`), Journal Entry Detail (`/erp4/journal-entries/:id`), Journal Entry Edit (`/erp4/journal-entries/:id/edit`).
  - Reports: Trial Balance (`/erp4/trial-balance`).
  - Migration & Data Health: Health Profile (`/erp4/migration/profile`), Data Cleaning Review (`/erp4/migration/clean`), Mapping Config (`/erp4/migration/mapping`).
  - Catch-all: NotFound 404 (`/erp4/*`).
- **Module Shell & Landmark Layout**: Implemented in [`ModuleShell.tsx`](../../apps/erp/modules/erp-4/web/src/components/ModuleShell.tsx):
  - Accessible skip link (`#erp4-main`) with visible focus state.
  - Semantic landmark regions: `role="banner"` module header, `role="navigation"` (`<nav aria-label="Finance and Accounting">`), and `<main id="erp4-main" tabIndex={-1}>`.
  - Dynamic `document.title` synchronization formatted as `<Page Title> · ClearShift ERP4`.
  - Grouped navigation with `aria-current="page"` and active state highlighting (`.is-active`).
  - Hierarchical breadcrumb navigation (`ModuleBreadcrumbs.tsx`) derived dynamically from route descriptors.
- **Route Authorization Guard**: [`RequireAuth.tsx`](../../apps/erp/modules/erp-4/web/src/auth/RequireAuth.tsx) and [`session.ts`](../../apps/erp/modules/erp-4/web/src/auth/session.ts) protecting all module routes with JWT expiration check, role verification, and redirect to `/login?returnTo=...` preserving destination.
- **Automated Verification**:
  - [`apps/erp/modules/erp-4/web/tests/route-manifest.test.ts`](../../apps/erp/modules/erp-4/web/tests/route-manifest.test.ts) (15 tests).
  - [`apps/erp/modules/erp-4/web/tests/module-shell.test.tsx`](../../apps/erp/modules/erp-4/web/tests/module-shell.test.tsx) (11 tests).
  - [`apps/erp/modules/erp-4/web/tests/routes.test.tsx`](../../apps/erp/modules/erp-4/web/tests/routes.test.tsx) (8 tests).

## 16. Main Paginated Data Table & Sortable Collection Screens (Issue #173 / ERP4-17)

- **Chart of Accounts Collection Table (`AccountsTable.tsx`)**:
  - Bound to shared `@cs/ui` `Table` and `Pagination` components using design tokens.
  - Stable columns matching data dictionary: Account Code (`code`), Account Name (`name`), Account Type (`type`), Currency (`currency_code`), Balance (`balance`), Status (`is_active`), and Actions (`View`, `Edit`).
  - Predictable multi-column sorting (`code`, `name`, `type`, `currency_code`, `balance`, `is_active`) with visual directional indicators (`▲`, `▼`, `⇅`) and accessible `aria-sort` attributes (`ascending`, `descending`, `none`).
  - Deterministic secondary tie-breaker (`code ASC, id ASC`) guaranteeing stable row positioning.
  - Bounded pagination controls bound to API `page` and `pageSize` parameters (clamped to `<= 100` rows per page).
  - Virtualization DOM guard (`virtualize={accounts.length > 50}`) protecting the browser from rendering degradation.
- **Journal Entries Collection Table (`JournalEntriesTable.tsx`)**:
  - Reusable collection component integrated into `JournalEntriesListPage.tsx`.
  - Stable columns matching data dictionary: Entry Number (`entry_number`), Posting Date (`posting_date`), Fiscal Period (`period_id`), Description (`description`), Currency (`currency_code`), Status (`status`), and Actions.
  - Predictable sorting on entry number, posting date, period, description, and status.
  - Full server-side pagination with windowed page numbers, total counts, and page size selector.
- **Automated Verification**:
  - [`apps/erp/modules/erp-4/web/tests/paginated-data-table.test.tsx`](../../apps/erp/modules/erp-4/web/tests/paginated-data-table.test.tsx) (11 tests verifying column contracts, pagination binding, sorting predictability, and virtualization guards).

## 17. Loading, Empty, Error, and Access-Denied States (Issue #175 / ERP4-19)

- **Loading State**:
  - [`SkeletonTable.tsx`](../../apps/erp/modules/erp-4/web/src/components/StateViews.tsx): Accessible animated skeleton table placeholder (`role="status"`, `aria-busy="true"`, `.animate-pulse`) displaying column header and row pulse blocks matching target dimensions during initial data fetching.
- **Empty State**:
  - [`EmptyState.tsx`](../../apps/erp/modules/erp-4/web/src/components/StateViews.tsx): Accessible zero-data condition card (`role="region"`, `aria-label="Empty state results"`) displaying descriptive message and primary Call-to-Action button (e.g. `+ New Account`, `+ New Journal Entry`), with optional secondary reset/refresh actions.
- **API Failure & Error Sanitization**:
  - [`error-sanitizer.ts`](../../apps/erp/modules/erp-4/web/src/utils/error-sanitizer.ts): Error sanitization utility that strips raw V8 stack traces, runtime engine exceptions, file paths, and internal PostgreSQL queries. Maps standard domain error codes (`JOURNAL_UNBALANCED`, `PERIOD_CLOSED`, `PERIOD_SOFT_CLOSED`, `DUPLICATE_CODE`, `NOT_FOUND`, `FORBIDDEN`) to helpful business descriptions without leaking backend internals.
  - [`ErrorAlert.tsx`](../../apps/erp/modules/erp-4/web/src/components/StateViews.tsx): Accessible alert banner (`role="alert"`) wrapping shared `@cs/ui` `Alert` (`variant="error"`), displaying sanitized error details and an interactive `↻ Retry Action` button invoking bounded recovery.
- **403 Forbidden Access-Denied View**:
  - [`AccessDeniedView.tsx`](../../apps/erp/modules/erp-4/web/src/components/AccessDeniedView.tsx): Dedicated access-denied screen rendered on HTTP 403 or missing RBAC permissions (`role="region"`, `aria-label="Access Denied"`). Explains missing roles (`Finance Admin`, `Finance Editor`, `Finance Viewer`, `Auditor`), displays active user role, provides guidance for requesting role elevation from an administrator or PMO security officer, and provides `← Go Back` and `Return to Finance Overview` navigation actions.
- **Automated Verification**:
  - [`apps/erp/modules/erp-4/web/tests/state-views.test.tsx`](../../apps/erp/modules/erp-4/web/tests/state-views.test.tsx) (15 tests covering skeleton placeholders, zero-data CTA actions, error sanitization & retry alerts, and 403 access-denied role explanations).

## 18. Create Form with Field-Level Validation (Issue #176 / ERP4-20)

- **Account Creation Form (`AccountForm.tsx`)**:
  - Bound to shared `@cs/ui` `FormField`, `Input`, `Select`, `Button`, and `Card` components.
  - Real-time client-side field validation covering required fields (`code`, `name`, `type`, `currency_code`), email format, phone numbers, and decimal numeric ranges (`opening_balance >= 0.00` and `<= 999,999,999.99`).
  - Strict submission guards preventing whitespace-only submissions, clearing field errors upon user edits.
  - Inflight double-submission prevention (`isSubmitting` flag disables submit button and displays loading spinner).
  - Direct mapping of HTTP 400 server validation errors: parses server response details (array or object formats) and attaches error messages directly to matching field inputs.
- **Modal Lifecycle & Collection Cache Synchronization (`AccountCreateModal.tsx` & `AccountsListPage.tsx`)**:
  - Encapsulated within accessible `@cs/ui` `Dialog` modal with keyboard dismissal (`Escape`) and clean backdrop handling.
  - On successful creation, closes modal automatically, invokes `onAccountCreated` callback to prepend/update the table cache optimistically, and dispatches an accessible confirmation toast (`Toast.tsx` with `role="status"` and `aria-live="polite"`).
  - Full-page alternative route supported at `/erp4/accounts/new` via `AccountCreatePage.tsx`.
- **Automated Verification**:
  - [`apps/erp/modules/erp-4/web/tests/AccountCreateModal.test.tsx`](../../apps/erp/modules/erp-4/web/tests/AccountCreateModal.test.tsx) (9 comprehensive tests verifying field validation, decimal boundaries, double-submit guards, server error mapping, modal lifecycle, and table cache updates).

## 19. Detail/Edit Workflow and Linked Records (Issue #177 / ERP4-21)

- **Primary Attribute & System Metadata Display (`AccountDetailPage.tsx` & `AccountAuditPanel.tsx`)**:
  - Displays all primary domain attributes: Account Code (`code`), Account Name (`name`), Classification Type (`type`), Operating Currency (`currency_code`), Current Balance (`balance`), Active Status (`is_active`), Description, and Parent Account ID.
  - Dedicated Audit Metadata Panel (`AccountAuditPanel.tsx`) rendering system-maintained `created_at` and `updated_at` formatted timestamps.
  - Golden ID resolution (`resolveGoldenId`) resolving canonical master record identifiers (e.g. `GLD-ACC-<ID_PREFIX>` or `GLD-<SOURCE_SYSTEM>-<ID>`) with `Canonical` badge (`data-testid="audit-golden-id"`).
- **Inline Edit & Drawer Modification Workflow (`AccountDetailPage.tsx` & `AccountEditDrawer.tsx`)**:
  - Dual edit modes:
    - **Inline Edit**: In-place edit toggle on the General Ledger Specification card with live inputs, real-time required field validation, and direct save.
    - **Drawer Edit**: Slide-over modal dialog (`AccountEditDrawer.tsx`) wrapping allowlisted fields.
  - Strict field allowlist enforcement: Only `name`, `description`, and `is_active` can be mutated; immutable system attributes (`code`, `type`, `currency_code`, `id`) remain permanently locked with visual lock indicators.
  - Role-based permission checking: Disables edit actions and displays read-only mode banners when the user lacks Editor or Admin privileges (`canEdit` guard).
- **Cross-Module Linked Records Sub-Tables (`AccountLinkedRecordsTable.tsx`)**:
  - Sub-tables with tabbed navigation and badge counts displaying related master records across modules:
    - ERP-4 Journal Transactions (`lines` / journal entries) with links to `/erp4/journal-entries/:id`.
    - ERP-2 Vendor Bills (Purchasing & Accounts Payable) with links to `/erp2/bills/:id`.
    - ERP-3 Customer Invoices (Sales & Receivables) with links to `/erp3/invoices/:id`.
    - ERP-5 Payroll Allocations (Human Resources & Payroll Totals) with links to `/erp5/payroll/:id`.
  - Accessible zero-records fallback using `@cs/ui` `EmptyState`.
- **Concurrent Modification Conflict Handling (HTTP 409)**:
  - Catches HTTP 409 Conflict responses on concurrent updates.
  - Renders an alert banner (`data-testid="concurrent-conflict-banner"`) prompting the user: "This record was updated by another operator or background job while you were editing. To prevent data corruption, your changes were not applied."
  - Provides an interactive `🔄 Refresh Record and Re-apply Changes` button (`data-testid="conflict-refresh-btn"`) that re-fetches the latest server state and resets dirty form fields.
- **Automated Verification**:
  - [`apps/erp/modules/erp-4/web/tests/detail-edit-workflow.test.tsx`](../../apps/erp/modules/erp-4/web/tests/detail-edit-workflow.test.tsx) (13 tests verifying primary attribute display, timestamps, Golden ID resolution, inline and drawer editing with allowlist and permission checking, tabbed linked entity sub-tables, and HTTP 409 concurrent conflict prompts with refresh handling).

## 20. Search, Filters and Sorting Controls (Issue #174 / ERP4-18)

- **300ms Debounced Search Bar (`FilterBar.tsx` & `useDebounce.ts`)**:
  - Implements rapid keystroke debouncing (`useDebounce`) waiting 300ms before dispatching search queries.
  - Immediate local state feedback for responsive typing with inline clear button (`✕`).
  - Automatically resets pagination to page 1 on search value changes.
- **Faceted Filters & Drawer Panel (`FilterSidebar.tsx`)**:
  - Accessible slide-over filter panel exposing categorized facet controls:
    - Account Type (`asset`, `liability`, `income`, `expense`).
    - Status (`active`, `archived` / `inactive`).
    - Currency (`USD`, `INR`, `EUR`, `GBP`).
  - Active filter badge counter on toggle button displaying the number of active filters.
  - URL query state synchronization (`useSearchParams`) reflecting active filters in browser URL (`?search=...&type=...&isActive=...`).
- **Removable Filter Tags & Clear All (`FilterPills.tsx`)**:
  - Active filter criteria rendered as accessible pill tags (`role="list"` / `role="listitem"`).
  - Individual removal buttons with accessible `aria-label` values (`Remove filter for <Label>`).
  - One-click `"Clear All"` reset button that removes all active criteria and resets URL query state.
- **Informative Empty Results Messaging**:
  - Differentiates between default zero-data states and empty search/filter queries.
  - Displays `"No matching accounts found"` with prompt to adjust criteria or clear filters.
  - Inline `"Clear All Filters"` recovery button triggering state reset.
- **Automated Verification**:
  - [`apps/erp/modules/erp-4/web/tests/search-filters.test.tsx`](../../apps/erp/modules/erp-4/web/tests/search-filters.test.tsx) (9 comprehensive tests verifying 300ms debounce, faceted sidebar updates, pill tag clearing, Clear All, and empty state messaging).

## 21. Playwright Browser Journey & E2E Verification (Issue #45 / ERP4-10)

- **Browser Host Architecture (`apps/erp/modules/erp-4/e2e/`)**:
  - Standalone minimal Vite dev server (`vite.e2e.config.ts`) running on port 5177 with `--strictPort`.
  - Mounts real module web routes (`erp4Routes`) and intercepts `/api/*` via Fastify in-memory app injection (`app.inject`), eliminating external network and database dependencies.
  - Exposes `POST /__e2e/reset` endpoint for deterministic test isolation.
- **Automated Browser Journeys (`erp-4-journey.spec.ts`)**:
  - Tested across Chromium and Firefox with zero retries.
  - Unauthenticated visitors navigating to `/erp4/accounts` automatically redirect to `/login?returnTo=%2Ferp4%2Faccounts`.
  - Authenticated finance user creates an account via `AccountCreateModal`, validates real-time input checks, confirms table insertion, filters by account classification, and navigates seamlessly across Chart of Accounts, Journal Entries, and Trial Balance tabs.

## 22. Gate G4 Release Candidate Evidence & Test Inventory (Issue #45 / ERP4-10)

- **Complete Test Pyramid (30 Test Files, 468 Tests)**:
  - `tests/domain/invariants.test.ts` (15 tests): Asserts all domain invariants (balanced double-entry, non-negative amounts, immutable posted entries, compensating reversals, account uniqueness, one-time opening balance, locked period guard, currency isolation).
  - `tests/api/auth-and-envelope.test.ts` (15 tests): Enforces standard ApiError envelopes (PLT-04), correlation ID propagation (`x-correlation-id`), zero raw SQL/secret leakage, and RBAC matrix.
  - `tests/contract/openapi-parity.test.ts` (3 tests): Verifies 100% parity between Fastify route tree and `packages/contracts/openapi/erp-4.yaml`.
  - `tests/db/constraints.test.ts` (4 tests): Tests real PostgreSQL schema constraints (unique codes, non-negative debits/credits, single-direction lines, foreign keys) conditional on `DATABASE_URL`.
  - `tests/seed/seed.test.ts` (7 tests): Validates public API seeding (`sample-data/erp-4/seed.ts`), idempotency keys, and reset determinism.
  - `tests/e2e/demo-journey.test.ts` (1 multiphase test): Executes complete 5-minute V1 user workflow without manual SQL or test fixtures.
  - `web/tests/*.test.tsx` (14 test files, 127 tests): React Testing Library suite covering components, forms, filters, tables, and conflict handling.
- **Convenience Scripts in Monorepo Root `package.json`**:
  - `npm run erp4:test`: Runs full Vitest suite for ERP-4 module.
  - `npm run erp4:seed`: Executes deterministic public API seed helper.
  - `npm run erp4:e2e`: Runs Playwright browser journey suite.

## Versioned Contract Change Control Log

| Version | Date | Gate / Milestone | Author / Team | Description of Changes |
|---|---|---|---|---|
| **`1.0.0`** | 2026-10-22 | Gate G1 Baseline Freeze | Group 9 / Role 2 (Issue #170) | Complete OpenAPI 3.1 specification, Zod contract schemas, domain event schemas, and deterministic mock package published. Approved as frozen baseline for Gate G1. |
| **`1.1.0`** | 2026-10-23 | Sprint 3 / Gate G4 | Group 9 / Role 4 (Issue #43) | Added module-specific profiling, cleaning, mapping rules, 143-row synthetic dirty-data pack (`dirty-data-v1.csv`), expected profile manifest (`expected-profile.json`), target mapping template (`mapping-template.json`), and comprehensive automated migration test suite. |
| **`1.2.0`** | 2026-10-23 | Sprint 2 / Gate G2 | Group 9 / Role 4 (Issue #182 / ERP4-26) | Integrated shared Migration Kit profiler (`@cs/kit` / `KIT-03`), configured column quality metrics and exact duplicate candidate assertions, added formula-safe CSV data health export, Fastify 5 routes, React UI screen, and 20 automated tests. |
| **`1.3.0`** | 2026-10-23 | Sprint 3 / Gate G3 | Group 9 / Role 4 (Issue #183 / ERP4-27) | Implemented canonical 12 V1 cleaning rules (`@cs/kit`), field-level change audit ledger (`kit_clean_log`), rule toggle execution (`FR-CL-05`), formula-safe audit CSV export, Fastify 5 endpoints, React review screen (`DataCleaningReviewPage`), and 20 automated tests. |
| **`1.4.0`** | 2026-10-24 | Sprint 3 / Gate G3 | Group 9 / Role 4 (Issue #184 / ERP4-28) | Implemented source-to-target field mapping templates, strict type coercion rules, enum translation tables, required target column enforcement guards, reproducible named templates, Fastify 5 endpoints, React mapping screen (`DataMappingConfigPage`), and automated test suite. |
| **`1.5.0`** | 2026-10-24 | Sprint 2 / UI Shell | Group 9 / Role 3 (Issue #172 / ERP4-16) | Implemented module route manifest under `/erp4`, accessible ModuleShell with keyboard skip links and landmarks, dynamic document title sync, hierarchical breadcrumbs, JWT session auth guards, and 34 automated web tests. |
| **`1.6.0`** | 2026-10-24 | Sprint 2 / Paginated Data Tables | Group 9 / Role 3 (Issue #173 / ERP4-17) | Implemented main paginated data tables for Chart of Accounts and Journal Entries utilizing shared `@cs/ui` Table and Pagination primitives, bounded page sizing (pageSize <= 100), predictable column sorting, and DOM virtualization guard. |
| **`1.7.0`** | 2026-10-24 | Sprint 2 / Screen States & Error Sanitization | Group 9 / Role 3 (Issue #175 / ERP4-19) | Implemented animated skeleton table placeholders during data fetching, zero-data empty states with actionable primary CTAs, sanitized error alert banners with retry actions (suppressing raw stack traces and DB queries), and accessible 403 Forbidden access-denied views explaining required RBAC roles. Added 15 automated web tests. |
| **`1.8.0`** | 2026-10-24 | Sprint 2 / Create Form & Field Validation | Group 9 / Role 3 (Issue #176 / ERP4-20) | Implemented create modal and form with real-time field validation, decimal range enforcement, double-submission prevention, server 400 validation error mapping, table cache synchronization, and accessible confirmation toast. |
| **`1.9.0`** | 2026-10-24 | Sprint 2 / Detail-Edit Workflow & Linked Records | Group 9 / Role 3 (Issue #177 / ERP4-21) | Implemented detail and edit workflow with primary attributes, timestamps, Golden ID badge, inline and drawer editing with allowlisted fields and RBAC permission guards, cross-module linked records sub-tables with count badges, and HTTP 409 concurrent modification handling with refresh prompt. Added 13 automated web tests. |
| **`1.10.0`** | 2026-10-24 | Sprint 2 / Search & Filters | Group 9 / Role 3 (Issue #174 / ERP4-18) | Implemented 300ms debounced search bar, faceted filter sidebar drawer, active filter pill tags with individual and Clear All actions, URL query state synchronization, and informative empty results messaging. |
| **`1.11.0`** | 2026-10-24 | Sprint 3 / Gate G4 | Group 9 / Role 2 (Issue #42 / ERP4-07) | Implemented Migration Kit target adapter (`Erp4TargetAdapter`), public `POST /api/v1/erp-finance/import` endpoint, durable import receipts schema extension with request hash, atomic local dual-write transactions, 3x idempotent replay guarantees, and batch chunking with excessive failure circuit breaker. |
| **`1.12.0`** | 2026-10-24 | Gate G4 Release Candidate | Group 9 / Role 4 (Issue #45 / ERP4-10) | Finalized V1 contract parity tests (OpenAPI <-> Fastify routes), domain invariant test suite, PostgreSQL DB constraint tests, public API deterministic seed helper, scripted demo journey E2E test, Playwright browser journeys, module runbook (`README.md`), and scripted demo walkthrough (`docs/demo-scripts/erp-4-v1.md`). 100% test pass rate across 30 test files and 468 tests. |

## 21. Migration Kit Target Adapter & Durable Import Receipts (Issue #42 / [ERP4-07])

As part of Sprint 3 / Gate G4 requirements (Decision C4 & KIT-08):
- **Public API Ingestion (`POST /api/v1/erp-finance/import`)**: The shared Migration Kit loads records via the public API or in-process `Erp4TargetAdapter`. Neither the Migration Kit nor sibling modules have direct database write privileges into ERP-4 private tables.
- **Atomic Local Dual-Write**: Target domain mutation and durable import receipt (`erp4.import_receipts`) commit together in a single local PostgreSQL transaction.
- **Deterministic Idempotency Guarantees**:
  - SHA-256 canonical request hash comparison detects replay vs. payload mismatch.
  - Same key + identical payload returns HTTP 200 with prior result and existing target ID.
  - Same key + different payload returns HTTP 409 Conflict with zero data mutation.
- **Domain Invariants**:
  - Accounts: code is unique (`ACCOUNT_CODE_EXISTS`).
  - Journal entries: lines balance exactly at currency precision (`BR-ERP4-01`), locked period rejects posting (`BR-ERP4-02`), header and lines commit atomically.
  - Opening balances: loaded once per account and currency pair (`FR-ERP4-04`).
- **Batch Processing & Limits**:
  - Processed in 500-row chunks.
  - Circuit breaker halts execution when failure rate exceeds 10% after 10 rows.
  - Terminal outcome reconciliation: `total = loaded + rejected + unattempted`, `unaccounted = 0`.

## 22. Playwright Browser Journey & E2E Verification (Issue #45 / ERP4-10)

- **Browser Host Architecture (`apps/erp/modules/erp-4/e2e/`)**:
  - Standalone minimal Vite dev server (`vite.e2e.config.ts`) running on port 5177 with `--strictPort`.
  - Mounts real module web routes (`erp4Routes`) and intercepts `/api/*` via Fastify in-memory app injection (`app.inject`), eliminating external network and database dependencies.
  - Exposes `POST /__e2e/reset` endpoint for deterministic test isolation.
- **Automated Browser Journeys (`erp-4-journey.spec.ts`)**:
  - Tested across Chromium and Firefox with zero retries.
  - Unauthenticated visitors navigating to `/erp4/accounts` automatically redirect to `/login?returnTo=%2Ferp4%2Faccounts`.
  - Authenticated finance user creates an account via `AccountCreateModal`, validates real-time input checks, confirms table insertion, filters by account classification, and navigates seamlessly across Chart of Accounts, Journal Entries, and Trial Balance tabs.

## 23. Gate G4 Release Candidate Evidence & Test Inventory (Issue #45 / ERP4-10)

- **Complete Test Pyramid (30 Test Files, 468 Tests)**:
  - `tests/domain/invariants.test.ts` (15 tests): Asserts all domain invariants (balanced double-entry, non-negative amounts, immutable posted entries, compensating reversals, account uniqueness, one-time opening balance, locked period guard, currency isolation).
  - `tests/api/auth-and-envelope.test.ts` (15 tests): Enforces standard ApiError envelopes (PLT-04), correlation ID propagation (`x-correlation-id`), zero raw SQL/secret leakage, and RBAC matrix.
  - `tests/contract/openapi-parity.test.ts` (3 tests): Verifies 100% parity between Fastify route tree and `packages/contracts/openapi/erp-4.yaml`.
  - `tests/db/constraints.test.ts` (4 tests): Tests real PostgreSQL schema constraints (unique codes, non-negative debits/credits, single-direction lines, foreign keys) conditional on `DATABASE_URL`.
  - `tests/seed/seed.test.ts` (7 tests): Validates public API seeding (`sample-data/erp-4/seed.ts`), idempotency keys, and reset determinism.
  - `tests/e2e/demo-journey.test.ts` (1 multiphase test): Executes complete 5-minute V1 demo workflow without manual SQL or test fixtures.
  - `web/tests/*.test.tsx` (14 test files, 127 tests): React Testing Library suite covering components, forms, filters, tables, and conflict handling.
- **Convenience Scripts in Monorepo Root `package.json`**:
  - `npm run erp4:test`: Runs full Vitest suite for ERP-4 module.
  - `npm run erp4:seed`: Executes deterministic public API seed helper.
  - `npm run erp4:e2e`: Runs Playwright browser journey suite.
