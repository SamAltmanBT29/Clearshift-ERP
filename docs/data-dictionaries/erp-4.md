# ERP-4 Finance & Accounting — Data Dictionary (Global Reference)

This document is the global-docs copy of the module data dictionary.

For the canonical, detailed version see:
[`apps/erp/modules/erp-4/docs/data-dictionary.md`](../../apps/erp/modules/erp-4/docs/data-dictionary.md)

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-4 Finance & Accounting |
| **Issues** | #36 (Data Model), #37 (List/Read API & Contracts), #38 (Mutation API & Domain Validation), #39 (Chart of Accounts & Trial Balance UI), #40 (Journal Entry Builder & Live Balance Checker UI), #41 (Domain Relationships) |
| **PostgreSQL Schema** | `erp4` |
| **API Base** | `/api/v1/erp-finance` |
| **OpenAPI Contract** | `packages/contracts/openapi/erp-4.yaml` |
| **Tables** | `erp4.accounts`, `erp4.accounting_periods`, `erp4.journal_entries`, `erp4.journal_lines`, `erp4.opening_balances`, `erp4.import_receipts` |
| **Version** | V1.0 |
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

## Module Authorization & Security (Issue #171 / ERP4-15)

- **Authentication**: Validates incoming Hub EdDSA JWTs via `@cs/identity` (`verifyAccessToken`). Unauthenticated requests reject with 401 `UNAUTHORIZED`.
- **Capability Matrix**: Enforces Default Deny. Roles (`viewer`, `editor`, `migration_runner`, `analyst`, `admin`) map to granular endpoint policies (`requireFinanceRead`, `requireFinanceWrite`, `requireJournalCreate`, `requireJournalPost`, `requireOpeningBalancesLoad`, `requirePeriodUpdate`).
- **Object-Level Guards**:
  - Multi-tenant isolation (`assertTenantAccess`) returns 403 `OBJECT_ACCESS_DENIED`.
  - Cross-user draft mutation protection (`assertObjectMutationAccess`) returns 403 `CROSS_USER_MUTATION_FORBIDDEN` when non-admin editors modify drafts created by others.
- **Error Envelopes**: Standard ClearShift envelope `{ statusCode, error, code, message, details, correlation_id }` with correlation IDs preserved in headers and body.
