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

## 6. Database Constraints Reference

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

---

## 7. Domain Rules

| Rule | Enforcement Layer | Notes |
|---|---|---|
| Every posted entry: SUM(debit) = SUM(credit) at 4dp | Application (domain engine) | Cannot be enforced as a DB aggregate constraint |
| A line cannot have both debit > 0 AND credit > 0 | **Database** (CHECK) + Application | jl_not_both_debit_and_credit |
| A line must have at least one non-zero amount | **Database** (CHECK) + Application | jl_at_least_one_nonzero |
| debit_amount, credit_amount are always >= 0 | **Database** (CHECK) + Application | jl_debit_non_negative, jl_credit_non_negative |
| Account code is globally unique | **Database** (UNIQUE) | accounts_code_unique |
| Period must be open (or soft_closed for admin) before posting | Application (domain engine) | DB does not know the user's role |
| Opening balance is loaded once per account+currency | **Database** (UNIQUE) | opening_balances_account_currency_unique |
| Idempotency key is globally unique when set | **Database** (PARTIAL UNIQUE) | Allows NULL for manual entries |
| Posted entries are immutable | Application + DB triggers | No UPDATE on posted lines (enforced by API layer) |
| Corrections use reversal entries, not edits | Application (status machine) | assertValidStatusTransition() |
| All lines of one entry share one currency_code | Application | V1: no FX conversion |
| Trial balance: unlike currencies never summed | Application (computeTrialBalance) | Groups by (account_id, currency_code) |
| Closed period rejects posting | Application (assertPeriodAcceptsPosting) | BR-ERP4-02 |
| Monetary values use NUMERIC(20,4), not FLOAT | **Database** (column type) | IEEE-754 floats are forbidden |
