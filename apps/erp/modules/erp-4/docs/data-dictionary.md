# ERP-4 Finance & Accounting — Data Dictionary

**SDS Reference**: ClearShift ERP v2.0, §7.9  
**Module**: ERP-4 Finance & Accounting  
**Issue**: [#36](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/36)  
**PostgreSQL Schema**: `erp4`  
**API Base**: `/api/v1/erp-finance`  
**Version**: V1.0  

---

## Table of Contents
1. [erp4.accounts](#1-erp4accounts--chart-of-accounts)
2. [erp4.accounting_periods](#2-erp4accounting_periods--fiscal-calendar)
3. [erp4.journal_entries](#3-erp4journal_entries--journal-entry-headers)
4. [erp4.journal_lines](#4-erp4journal_lines--double-entry-lines)
5. [erp4.opening_balances](#5-erp4opening_balances--opening-balance-loads)
6. [Constraints Reference](#6-database-constraints-reference)
7. [Domain Rules](#7-domain-rules)

---

## 1. `erp4.accounts` — Chart of Accounts

**Purpose**: Stores the complete chart of accounts. Each account is a node in the financial taxonomy.  
**FR Reference**: FR-ERP4-01  

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `code` | `VARCHAR(32)` | NOT NULL | — | Unique mnemonic account code, e.g. `1010-BANK` | UNIQUE, alphanumeric+hyphen+underscore |
| `name` | `VARCHAR(255)` | NOT NULL | — | Human-readable account name | — |
| `type` | `erp4.account_type` | NOT NULL | — | Account classification: `asset`, `liability`, `income`, `expense` | CHECK via enum |
| `currency_code` | `VARCHAR(3)` | NOT NULL | `'INR'` | ISO 4217 currency code, exactly 3 uppercase letters | — |
| `parent_id` | `UUID` | NULL | — | Self-referential FK to parent account for hierarchy | FK → erp4.accounts(id) ON DELETE RESTRICT |
| `description` | `TEXT` | NULL | — | Optional longer description / accounting notes | — |
| `is_active` | `BOOLEAN` | NOT NULL | `TRUE` | Soft-delete flag; archived accounts hidden from new entries | — |
| `is_posting_account` | `BOOLEAN` | NOT NULL | `TRUE` | If false, account is a header/group only and cannot receive direct journal lines | — |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp (UTC) | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last update timestamp; auto-updated by trigger | — |

**Indexes**:
- `accounts_code_unique` — UNIQUE on `(code)` ← FR-ERP4-01
- `accounts_parent_id_idx` — B-tree on `(parent_id)` — hierarchy traversal
- `accounts_type_idx` — B-tree on `(type)` — P&L / Balance Sheet grouping
- `accounts_currency_code_idx` — B-tree on `(currency_code)` — trial balance grouping
- `accounts_is_active_idx` — B-tree on `(is_active)` — active account filtering

---

## 2. `erp4.accounting_periods` — Fiscal Calendar

**Purpose**: Defines fiscal periods and controls whether new postings are accepted.  
**FR Reference**: BR-ERP4-02  

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `period_label` | `VARCHAR(16)` | NOT NULL | — | Canonical period identifier, e.g. `2026-04` (YYYY-MM) | UNIQUE |
| `start_date` | `DATE` | NOT NULL | — | First day of the period (inclusive) | — |
| `end_date` | `DATE` | NOT NULL | — | Last day of the period (inclusive) | — |
| `status` | `erp4.period_status` | NOT NULL | `'open'` | Lifecycle: `open`, `soft_closed`, `locked` | CHECK via enum |
| `fiscal_year` | `VARCHAR(9)` | NOT NULL | — | Fiscal year label, e.g. `FY2026-27` | — |
| `closed_at` | `TIMESTAMPTZ` | NULL | — | Timestamp when period was first closed | CHECK: NULL iff status = open |
| `closed_by_user_id` | `UUID` | NULL | — | Opaque user reference (no FK to auth module) | — |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last update timestamp | — |

**Constraints**:
- `periods_date_range_valid`: `start_date < end_date`
- `periods_closed_at_consistency`: `(status = 'open' AND closed_at IS NULL) OR (status != 'open' AND closed_at IS NOT NULL)`
- `periods_label_unique`: UNIQUE on `(period_label)`

---

## 3. `erp4.journal_entries` — Journal Entry Headers

**Purpose**: Represents a single accounting transaction (header). Lines carry the double-entry amounts.  
**FR Reference**: FR-ERP4-02, BR-ERP4-01  

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `entry_number` | `VARCHAR(64)` | NOT NULL | — | Unique human-readable reference, e.g. `JV-2026-0001` | UNIQUE |
| `period_id` | `UUID` | NOT NULL | — | FK to accounting period | FK → erp4.accounting_periods(id) ON DELETE RESTRICT |
| `posting_date` | `DATE` | NOT NULL | — | Effective accounting date of the entry | — |
| `status` | `erp4.journal_entry_status` | NOT NULL | `'draft'` | Lifecycle: `draft`, `posted`, `reversed`, `voided` | CHECK via enum |
| `description` | `TEXT` | NOT NULL | — | Required narration / description of the transaction | — |
| `currency_code` | `VARCHAR(3)` | NOT NULL | — | ISO 4217 currency for all lines of this entry | — |
| `source_reference` | `VARCHAR(128)` | NULL | — | Reference to source document, e.g. `PURCHASE_GRN:grn-9842` | — |
| `idempotency_key` | `VARCHAR(128)` | NULL | — | Unique key from source module; prevents duplicate auto-journals | UNIQUE (partial, WHERE NOT NULL) |
| `created_by_user_id` | `UUID` | NOT NULL | — | User who created the draft | — |
| `posted_by_user_id` | `UUID` | NULL | — | User who posted the entry | Required when status = posted |
| `posted_at` | `TIMESTAMPTZ` | NULL | — | Timestamp of posting | Required when status = posted |
| `reversed_by_entry_id` | `UUID` | NULL | — | Self-referential FK to the compensating reversal entry | FK → erp4.journal_entries(id); Required when status = reversed |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last update timestamp | — |

**Constraints**:
- `journal_entries_number_unique`: UNIQUE on `(entry_number)`
- `journal_entries_idempotency_key_unique`: PARTIAL UNIQUE on `(idempotency_key) WHERE idempotency_key IS NOT NULL`
- `je_posted_at_consistency`: posted entries must have `posted_at IS NOT NULL AND posted_by_user_id IS NOT NULL`
- `je_reversed_by_consistency`: reversed entries must have `reversed_by_entry_id IS NOT NULL`

**Application-enforced (cannot be DB constraint)**:
- SUM(debit_amount) = SUM(credit_amount) across all lines before transitioning to `posted`
- Period status must be `open` (or `soft_closed` for finance_admin) before posting

---

## 4. `erp4.journal_lines` — Double-Entry Lines

**Purpose**: Each line is one debit or one credit leg. Together they form the double-entry for the parent journal entry.  
**FR Reference**: FR-ERP4-02, BR-ERP4-01  

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `journal_entry_id` | `UUID` | NOT NULL | — | Parent journal entry | FK → erp4.journal_entries(id) ON DELETE CASCADE |
| `account_id` | `UUID` | NOT NULL | — | Account being debited or credited | FK → erp4.accounts(id) ON DELETE RESTRICT |
| `debit_amount` | `NUMERIC(20,4)` | NOT NULL | `0.0000` | Debit amount at 4dp precision | CHECK ≥ 0 |
| `credit_amount` | `NUMERIC(20,4)` | NOT NULL | `0.0000` | Credit amount at 4dp precision | CHECK ≥ 0 |
| `line_narration` | `VARCHAR(255)` | NULL | — | Optional per-line description | — |
| `department_ref` | `VARCHAR(64)` | NULL | — | Optional cost-centre dimension reference | — |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp | — |

**Constraints** (all DB-level, named):
- `jl_debit_non_negative`: `debit_amount >= 0`
- `jl_credit_non_negative`: `credit_amount >= 0`
- `jl_not_both_debit_and_credit`: `NOT (debit_amount > 0 AND credit_amount > 0)` ← BR-ERP4-01
- `jl_at_least_one_nonzero`: `debit_amount > 0 OR credit_amount > 0` ← BR-ERP4-01

> **Note**: `NUMERIC(20,4)` is used throughout. IEEE-754 `FLOAT` and `DOUBLE PRECISION` are explicitly forbidden for monetary values to prevent cumulative rounding drift.

---

## 5. `erp4.opening_balances` — Opening Balance Loads

**Purpose**: Stores the initial (migration-day) balance for each account+currency. Loaded once per account/currency; immutable thereafter.  
**FR Reference**: FR-ERP4-04  

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `account_id` | `UUID` | NOT NULL | — | Account the opening balance belongs to | FK → erp4.accounts(id) ON DELETE RESTRICT |
| `currency_code` | `VARCHAR(3)` | NOT NULL | — | ISO 4217 currency code | — |
| `balance_amount` | `NUMERIC(20,4)` | NOT NULL | — | Signed balance (negative = deficit / contra) | — |
| `as_of_date` | `DATE` | NOT NULL | — | Effective date (first day of first period) | — |
| `source_reference` | `VARCHAR(128)` | NULL | — | Source audit reference (e.g. migration run ID) | — |
| `loaded_by_user_id` | `UUID` | NOT NULL | — | Finance-admin who loaded the balance | — |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp | — |

**Constraints**:
- `opening_balances_account_currency_unique`: UNIQUE on `(account_id, currency_code)` ← FR-ERP4-04 ("loaded once per account/currency")

---

## 6. `erp4.import_receipts` — Idempotency & Import Receipts

**Purpose**: Persists receipt records for mutation idempotency and external data load provenance.  
**KIT Reference**: KIT-08 / Decision C4  

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `batch_id` | `UUID` | NOT NULL | — | Batch identifier for bulk import | — |
| `source_row` | `INTEGER` | NOT NULL | — | Zero-indexed line/row in source file | CHECK (>= 0) |
| `entity` | `VARCHAR(64)` | NOT NULL | — | Target entity name (e.g. `account`, `journal_entry`, `opening_balance`) | — |
| `schema_version` | `INTEGER` | NOT NULL | `1` | Schema version of imported entity | — |
| `idempotency_key` | `VARCHAR(255)` | NOT NULL | — | Stable idempotency key from header or payload | UNIQUE |
| `target_id` | `VARCHAR(64)` | NOT NULL | — | ID of the created/updated target record | — |
| `kind` | `VARCHAR(32)` | NOT NULL | `'created'` | Operation outcome: `created`, `updated`, `replayed`, `skipped` | — |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Receipt creation timestamp | — |

**Constraints**:
- `import_receipts_idempotency_key_unique`: UNIQUE on `(idempotency_key)`

---

## 7. Database Constraints Reference

| Constraint Name | Table | Type | Rule | FR/BR |
|---|---|---|---|---|
| `accounts_code_unique` | accounts | UNIQUE | account code is unique | FR-ERP4-01 |
| `periods_date_range_valid` | accounting_periods | CHECK | `start_date < end_date` | — |
| `periods_closed_at_consistency` | accounting_periods | CHECK | closed_at IS NULL iff status = open | BR-ERP4-02 |
| `periods_label_unique` | accounting_periods | UNIQUE | period_label is unique | — |
| `journal_entries_number_unique` | journal_entries | UNIQUE | entry_number is unique | FR-ERP4-02 |
| `journal_entries_idempotency_key_unique` | journal_entries | PARTIAL UNIQUE | idempotency_key unique when set | — |
| `je_posted_at_consistency` | journal_entries | CHECK | posted entries have posted_at and posted_by | BR-ERP4-01 |
| `je_reversed_by_consistency` | journal_entries | CHECK | reversed entries have reversed_by_entry_id | BR-ERP4-01 |
| `jl_debit_non_negative` | journal_lines | CHECK | `debit_amount >= 0` | BR-ERP4-01 |
| `jl_credit_non_negative` | journal_lines | CHECK | `credit_amount >= 0` | BR-ERP4-01 |
| `jl_not_both_debit_and_credit` | journal_lines | CHECK | `NOT (debit > 0 AND credit > 0)` | BR-ERP4-01 |
| `jl_at_least_one_nonzero` | journal_lines | CHECK | `debit > 0 OR credit > 0` | BR-ERP4-01 |
| `opening_balances_account_currency_unique` | opening_balances | UNIQUE | one opening balance per account+currency | FR-ERP4-04 |
| `import_receipts_idempotency_key_unique` | import_receipts | UNIQUE | unique receipt per idempotency key | KIT-08 |

---

## 8. Domain Rules

| Rule | Enforcement Layer | Notes |
|---|---|---|
| Every posted entry: SUM(debit) = SUM(credit) at 4dp | Application (domain engine) | Cannot be enforced as a DB aggregate constraint |
| A line cannot have both debit > 0 AND credit > 0 | **Database** (CHECK) + Application | jl_not_both_debit_and_credit |
| A line must have at least one non-zero amount | **Database** (CHECK) + Application | jl_at_least_one_nonzero |
| debit_amount, credit_amount are always >= 0 | **Database** (CHECK) + Application | jl_debit_non_negative, jl_credit_non_negative |
| Account code is globally unique | **Database** (UNIQUE) | accounts_code_unique |
| Period must be open (or soft_closed for admin) before posting | Application (domain engine) | DB does not know the user's role |
| Opening balance is loaded once per account+currency | **Database** (UNIQUE) | opening_balances_account_currency_unique |
| Idempotency key is globally unique when set | **Database** (PARTIAL UNIQUE) + receipts | Prevents duplicate mutations |
| Posted entries are immutable | Application + DB triggers | No UPDATE on posted lines (enforced by API layer) |
| Corrections use reversal entries, not edits | Application (status machine) | assertValidStatusTransition() |
| All lines of one entry share one currency_code | Application | V1: no FX conversion |
| Trial balance: unlike currencies never summed | Application (computeTrialBalance) | Groups by (account_id, currency_code) |
| Closed period rejects posting | Application (assertPeriodAcceptsPosting) | BR-ERP4-02 |
| Monetary values use NUMERIC(20,4), not FLOAT | **Database** (column type) | IEEE-754 floats are forbidden |

---

## 9. V1 API Endpoints & Bounded Pagination Specification

**Issue References**: [#37 (ERP4-02)](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/37), [#38 (ERP4-03)](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/38)  
**Base Path**: `/api/v1/erp-finance`  
**OpenAPI Specification**: `packages/contracts/openapi/erp-4.yaml`  
**Contracts Export**: `packages/contracts/src/erp-4.ts`

### 9.1 Paging and Search Contract
- **Bounded Pagination**: All collection endpoints require `page` (default `1`, min `1`) and `pageSize` (default `20`, max `100`). Any request where `pageSize > 100` is rejected with `HTTP 400 Bad Request`.
- **Server-Side Search**: Case-insensitive substring filtering on text fields (`search` parameter for `code`/`name` in accounts, `entry_number`/`description` in journal entries).
- **Deterministic Sort**: Stable sort order (e.g. `code ASC, id ASC` for accounts; `posting_date DESC, entry_number DESC, id DESC` for journal entries).
- **Safe Envelope**: All errors conform to the standard `ApiError` envelope (`statusCode`, `error`, `message`, `details`, `code`, `correlation_id`).

### 9.2 Endpoints Index

| Method | Endpoint | Query / Body Parameters | Status Codes | Description |
|---|---|---|---|---|
| `GET` | `/accounts` | `page`, `pageSize`, `search`, `type`, `is_active`, `currency_code` | 200, 400, 401 | List chart of accounts with bounded paging |
| `GET` | `/accounts/:id` | Path: `id` (UUID) | 200, 400, 404, 401 | Retrieve single account by ID |
| `POST` | `/accounts` | Body: `code`, `name`, `type`, `currency_code?`, `parent_id?`, `description?`, `is_posting_account?`, `idempotency_key?`, `batch_id?`, `source_row?` | 201, 200, 400, 403, 409, 422, 401 | Create new account (seed/admin/editor only) |
| `PATCH` | `/accounts/:id` | Path: `id` (UUID), Body: `name?`, `description?`, `is_active?`, `is_posting_account?`, `parent_id?` | 200, 400, 403, 404, 422, 401 | Update mutable account fields (admin/editor only) |
| `GET` | `/journal-entries` | `page`, `pageSize`, `period`, `period_id`, `status`, `from_date`, `to_date`, `currency_code`, `search` | 200, 400, 401 | List journal entries with filter & stable sort |
| `GET` | `/journal-entries/:id` | Path: `id` (UUID) | 200, 400, 404, 401 | Get journal entry with lines |
| `POST` | `/journal-entries` | Body: `period_id`, `posting_date`, `description`, `currency_code`, `lines`, `idempotency_key?`, `batch_id?`, `source_row?` | 201, 200 (idempotent), 400, 409, 422, 401 | Create draft journal entry |
| `PATCH` | `/journal-entries/:id` | Path: `id` (UUID), Body: `period_id?`, `posting_date?`, `description?`, `lines?` | 200, 400, 404, 422, 401 | Update draft journal entry (immutable once posted) |
| `POST` | `/journal-entries/:id/post` | Path: `id` (UUID) | 200, 400, 403, 404, 422, 401 | Post draft entry; enforces balancing & period lock |
| `POST` | `/journal-entries/:id/reverse` | Path: `id` (UUID), Body: `reason`, `reversal_date?`, `reversal_description?` | 200, 400, 404, 422, 401 | Reverse posted entry via compensating reversal |
| `POST` | `/journal-entries/:id/void` | Path: `id` (UUID) | 200, 400, 404, 422, 401 | Void draft journal entry |
| `GET` | `/trial-balance` | `period` (YYYY-MM, required), `currency_code?` | 200, 400, 404, 401 | Generate trial balance grouped by account/currency |
| `GET` | `/opening-balances` | `page`, `pageSize`, `account_id?`, `currency_code?` | 200, 400, 401 | List loaded opening balances |
| `GET` | `/opening-balances/:id` | Path: `id` (UUID) | 200, 400, 404, 401 | Get single opening balance by ID |
| `POST` | `/opening-balances` | Body: `balances: Array<OpeningBalanceItem>`, `idempotency_key?`, `batch_id?` | 201, 400, 409, 401 | Bulk-load opening balances (one-time per account/currency) |
| `GET` | `/periods` | `page`, `pageSize`, `status?`, `fiscal_year?` | 200, 400, 401 | List fiscal accounting periods |
| `GET` | `/periods/:id` | Path: `id` (UUID) | 200, 400, 404, 401 | Get accounting period by ID |
| `PATCH` | `/periods/:id` | Path: `id` (UUID), Body: `status` | 200, 400, 401, 403, 404, 422 | Update accounting period lifecycle status |

---

## 10. Domain Relationships & State Transitions (Issue #41)

### 10.1 Intra-Module Relationship Catalog

| Relationship Name | From Entity | From Field | Target Entity | Cardinality | Required? | Validation Rules & Invariants | Error Code |
|---|---|---|---|---|---|---|---|
| `ACCOUNT_PARENT` | `Account` | `parent_id` | `Account` | Many-to-One | Optional | Child and parent must share currency; ancestor cycle detection (no self/loop references); parent must exist | `PARENT_NOT_FOUND`, `CYCLE_DETECTED`, `CURRENCY_MISMATCH` |
| `JOURNAL_ENTRY_PERIOD` | `JournalEntry` | `period_id` | `AccountingPeriod` | Many-to-One | Required | Period must exist; locked period unconditionally rejects posting/draft creation; soft-closed requires `finance_admin` role | `PERIOD_NOT_FOUND`, `PERIOD_LOCKED`, `PERIOD_SOFT_CLOSED` |
| `JOURNAL_LINE_ENTRY` | `JournalLine` | `journal_entry_id` | `JournalEntry` | Many-to-One | Required | Minimum 2 lines required per entry; entry and lines commit atomically | `MINIMUM_LINES_REQUIRED` |
| `JOURNAL_LINE_ACCOUNT` | `JournalLine` | `account_id` | `Account` | Many-to-One | Required | Account must exist, be active (`is_active = true`), have posting capability (`is_posting_account = true`), and match entry currency | `ACCOUNT_NOT_FOUND`, `ACCOUNT_INACTIVE`, `CANNOT_POST_TO_HEADER_ACCOUNT`, `CURRENCY_MISMATCH` |
| `JOURNAL_ENTRY_REVERSAL` | `JournalEntry` | `reversed_by_entry_id` | `JournalEntry` | One-to-One | Optional | Only posted entries can be reversed; reversal entry has swapped debit/credit legs and references original; original marks status = `reversed` | `ILLEGAL_STATUS_TRANSITION` |
| `OPENING_BALANCE_ACCOUNT` | `OpeningBalance` | `account_id` | `Account` | Many-to-One | Required | Account must be active, posting account, and currency must match; loaded once per account+currency pair | `ACCOUNT_NOT_FOUND`, `ACCOUNT_INACTIVE`, `CANNOT_POST_TO_HEADER_ACCOUNT`, `DUPLICATE_OPENING_BALANCE` |

### 10.2 Cross-Module Integrity via ReferenceResolver (Decision C7)

ClearShift ERP enforces clean architectural boundaries: no cross-module database foreign keys or direct writes to foreign schemas are permitted. External references are validated via the contract-approved `ReferenceResolver` port:

| Relationship Name | Source Field | Target Module | Target Entity | Handling for Absent Values | Error Code on Invalid Reference |
|---|---|---|---|---|---|
| `JOURNAL_LINE_DEPARTMENT` | `lines[].department_ref` | ERP-5 (HR / Organization) | `department` | Renders approved warning `OPTIONAL_REFERENCE_ABSENT` | `DEPARTMENT_NOT_FOUND` (422) |
| `JOURNAL_ENTRY_SOURCE` | `source_reference` (e.g. `invoice:UUID`) | ERP-3 (Sales / Billing) | `invoice`, `sales_order` | Permitted null; validated if formatted as cross-module reference | `SOURCE_ENTITY_NOT_FOUND` (422) |

When an optional relationship is absent, the system emits an approved warning object `{ code: 'OPTIONAL_REFERENCE_ABSENT', relationship, field, message }` instead of fabricating or inventing synthetic records.

### 10.3 State Transition Matrices (FSM)

#### Journal Entry FSM
```
        ┌─────────────┐
        │    draft    │
        └──────┬──────┘
         ┌─────┴─────┐
         ▼           ▼
   ┌───────────┐ ┌──────────┐
   │  posted   │ │  voided  │ (terminal)
   └─────┬─────┘ └──────────┘
         │
         ▼
   ┌───────────┐
   │ reversed  │ (terminal)
   └───────────┘
```
- `draft -> posted`: Validates double-entry exact balance (`BR-ERP4-01`) and period posting guard (`BR-ERP4-02`).
- `draft -> voided`: Marks draft cancelled without affecting general ledger balances.
- `posted -> reversed`: Creates compensating reversal entry with swapped debit/credit legs.
- All other transitions (`posted -> draft`, `reversed -> *`, `voided -> *`) are strictly FORBIDDEN (`ILLEGAL_STATUS_TRANSITION`).

#### Accounting Period FSM
```
        ┌─────────────┐
        │    open     │◄────────┐
        └──────┬──────┘         │
         ┌─────┴─────┐          │
         ▼           ▼          │
   ┌───────────┐ ┌──────────┐   │
   │soft_closed│─┤  locked  │   │
   └─────┬─────┘ └──────────┘   │
         │           ▲          │
         └───────────┼──────────┘
                     │
```
- `open -> soft_closed`: Soft-close period (finance_admin or admin). Postings require elevated privileges.
- `open -> locked`: Fully lock period (admin only).
- `soft_closed -> open`: Re-open period (admin only).
- `soft_closed -> locked`: Fully lock period (admin only).
- `locked -> *`: FORBIDDEN (terminal immutable state; cannot be re-opened).

### 10.4 Read-Model Consistency & Authoritative Derived Totals

- **Immediate Consistency**: Upon successful mutation, subsequent reads from `/accounts`, `/journal-entries/:id`, and `/trial-balance` immediately reflect the authoritative persisted state without eventual consistency delays.
- **Double-Entry Balance Invariant (`BR-ERP4-01`)**: `SUM(debit) == SUM(credit)` enforced within explicit currency at 4 decimal places (`NUMERIC(20,4)`).
- **Trial Balance Aggregation**: Computed strictly from posted and reversed ledger movements plus one-time opening balances. Unlike currencies are segregated; `totals.is_balanced` asserts global double-entry equality.

---

## 11. OpenAPI 3.1, Event and Mock Contract Package (Issue #170)

### 11.1 Authoritative Contract Files
- **OpenAPI 3.1 Document**: `packages/contracts/openapi/erp-4.yaml` (covers all 18 V1 endpoints)
- **Zod Runtime Schemas**: `@clearshift/contracts` (`packages/contracts/src/erp-4.ts`)
- **Domain Event Schemas**: `@clearshift/contracts/erp-4-events` (PLT-04/PLT-09 transactional envelopes)
- **Deterministic Mock Server**: `@clearshift/contracts/erp-4-mock` (`npm run mock:erp-4`, port 4014)

### 11.2 Domain Events Specification
- `erp.account.created`: Emitted when new account is established
- `erp.account.updated`: Emitted when account attributes are modified
- `erp.journal_entry.created`: Emitted when balanced draft entry is created
- `erp.journal_entry.posted`: Emitted when draft entry is posted to the GL
- `erp.journal_entry.reversed`: Emitted when compensating reversal is posted
- `erp.journal_entry.voided`: Emitted when draft entry is voided
- `erp.period.status_changed`: Emitted on period lifecycle status transition
- `erp.opening_balance.created`: Emitted when opening balance is recorded

### 11.3 Versioned Change Control Log
- **Version 1.0.0 (2026-10-22)**: Gate G1 baseline sign-off by Integration Lead. Complete OpenAPI 3.1 specification, Zod contract schemas, domain event schemas, and deterministic mock package published.
- **Version 1.1.0 (2026-10-23)**: Sprint 3 / Gate G4 sign-off by Data / QA Lead (Issue #43). Defined module data quality rules catalogue, cleaning routines, 143-row synthetic dirty data pack (`dirty-data-v1.csv`), expected profile manifest (`expected-profile.json`), target mapping template (`mapping-template.json`), and automated migration test suite.
- **Version 1.2.0 (2026-10-23)**: Sprint 2 / Gate G2 sign-off by Data / QA Lead (Issue #182 / ERP4-26). Delivered shared profiler integration (`@cs/kit` / `KIT-03`), module column profiling rules, exact duplicate candidate assertions, formula-safe CSV data health export, Fastify 5 endpoints (`/api/v1/erp-finance/migration/profile`), React UI screen (`DataHealthProfilePage`), and 20 automated assertion tests.

---

## 12. Migration Profiling, Cleaning, Mapping & Dirty Data Pack (Issue #43)

### 12.1 Authoritative Migration Artifacts
- **Data Quality Rules Specification**: [`apps/erp/modules/erp-4/docs/data-quality-rules.md`](./data-quality-rules.md)
- **Rules Engine & Profile Calculator**: [`apps/erp/modules/erp-4/src/migration/rules.ts`](../src/migration/rules.ts)
- **Synthetic Dirty Data Pack**: [`sample-data/erp-4/dirty-data-v1.csv`](../../../../sample-data/erp-4/dirty-data-v1.csv) (143 rows; immutable input, verified via SHA-256 manifest)
- **Canonical Profile & Manifest**: [`sample-data/erp-4/expected-profile.json`](../../../../sample-data/erp-4/expected-profile.json)
- **Target Mapping Template**: [`sample-data/erp-4/mapping-template.json`](../../../../sample-data/erp-4/mapping-template.json)
- **Automated Test Suite**: [`apps/erp/modules/erp-4/tests/migration/rules.test.ts`](../tests/migration/rules.test.ts) (27 tests)

### 12.2 Migration Policies & Invariants
- **BR-KIT-03 Source File Immutability**: Raw input fixtures are never mutated or overwritten in-place during profiling or cleaning.
- **BR-ERP4-01 Double-Entry Exact Balance**: Every journal entry must balance exactly (`SUM(debit) == SUM(credit)`) within currency precision. Unbalanced entries are rejected (`UNBALANCED_JOURNAL_ENTRY`).
- **BR-ERP4-02 Period Posting Guard**: Closed and locked fiscal periods reject postings unconditionally (`PERIOD_LOCKED`, `PERIOD_SOFT_CLOSED`).
- **No-Fuzzy-Merge / Review Policy**: V1 migration does NOT perform automated fuzzy merges. Exact duplicate candidate keys are flagged for explicit human review (`review` outcome) with reason codes `DUPLICATE_ACCOUNT_CODE_REVIEW`, `DUPLICATE_OPENING_BALANCE_REVIEW`, and `DUPLICATE_ENTRY_NUMBER_REVIEW`.
- **100% Outcome Reconciliation**: Every source row evaluates to exactly one terminal outcome: accepted, rejected, or review (`unaccounted = 0`).
- **Atomic Entry Invariant**: If any child line fails validation or if lines fail to balance, the entire journal entry is rejected (`LINE_REJECTED`) along with all peer lines (`PARENT_ENTRY_REJECTED`).

---

## 13. Column Profiling Configuration & Expected-Result Assertions (Issue #182 / ERP4-26 / KIT-03)

### 13.1 Shared Migration Kit Profiler Engine
- Domain engine implemented in `@cs/kit` (`packages/kit/src/domain/profiler.ts`) complying with SDS §4.3 (FR-PR-01..04).
- Computes total rows, null counts, distinct values, invalid format counts/rates, and top 5 values per column.
- Identifies exact duplicate candidate keys and duplicate row associations.
- Strictly non-destructive: verifies raw input byte and SHA-256 immutability.
- Exports formula-safe CSV Data Health Reports with OWASP formula injection protection (`=`, `+`, `-`, `@`, `\t`, `\r` prefixed with `'`).

### 13.2 ERP-4 Profiling Rules & Artifacts
- **Profiling Configuration**: [`apps/erp/modules/erp-4/src/migration/profiling-config.ts`](../src/migration/profiling-config.ts) defines 24 column profiling rules across accounts, opening balances, journal entries, and lines.
- **Exact Duplicate Keys**: Declares exact duplicate key rules for Account Code, Opening Balance (`code + currency`), and Journal Entry Number.
- **REST Endpoints**: Fastify 5 routes in [`apps/erp/modules/erp-4/src/routes/profiling.ts`](../src/routes/profiling.ts):
  - `GET /api/v1/erp-finance/migration/profile` (returns JSON profile report)
  - `GET /api/v1/erp-finance/migration/profile/export` (downloads formula-safe CSV)
  - `POST /api/v1/erp-finance/migration/profile` (in-memory non-destructive profiling on uploaded CSV)
- **Frontend Screen**: Accessible React component [`DataHealthProfilePage.tsx`](../web/src/pages/DataHealthProfilePage.tsx) displaying quality metrics table, duplicate review candidates, and formula-safe CSV download.
- **Automated Assertions**: [`apps/erp/modules/erp-4/tests/migration/profiling.test.ts`](../tests/migration/profiling.test.ts) (20 tests) asserting all column metrics and duplicate candidate numbers match the manifest.
