# ERP-4 Finance & Accounting: Comprehensive Field-Level Data Dictionary

**Issue**: [ERP4-24 / #180](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/180), Gate G1 Design Artifact  
**PostgreSQL Schema**: `erp4`  
**API Prefix**: `/api/v1/erp-finance`  
**Reference Document**: SDS ClearShift ERP v2.0 §7.9  

---

## 1. `erp4.accounts` (Chart of Accounts Master)

Authoritative general ledger taxonomy master table.

| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints | Business Rule | Example |
|---|---|---|---|---|---|---|---|
| `id` | `UUID` | `string (uuid)` | No | `gen_random_uuid()` | Primary Key | Immutable synthetic surrogate key | `10000000-0000-0000-0000-000000000001` |
| `code` | `VARCHAR(32)` | `string (1..32)` | No | — | UNIQUE, NOT NULL | Alphanumeric account code; uppercase trimmed normalization | `1010-CASH` |
| `name` | `VARCHAR(255)` | `string (1..255)` | No | — | NOT NULL | Human-readable account title | `Petty Cash - Main Vault` |
| `type` | `erp4.account_type` | `'asset' \| 'liability' \| 'income' \| 'expense'` | No | — | CHECK enum | Core financial statement taxonomy classification | `asset` |
| `currency_code` | `VARCHAR(3)` | `string (length 3)` | No | `'INR'` | ISO 4217 uppercase | Account base reporting currency | `INR` |
| `parent_id` | `UUID` | `string (uuid) \| null` | Yes | `NULL` | FK → `erp4.accounts(id)` RESTRICT | Self-referencing tree hierarchy | `10000000-0000-0000-0000-000000000000` |
| `description` | `TEXT` | `string \| null` | Yes | `NULL` | None | Descriptive ledger memo | `Operating branch petty cash reserve` |
| `is_active` | `BOOLEAN` | `boolean` | No | `TRUE` | NOT NULL | Active flag; soft-disabled accounts block new postings | `true` |
| `is_posting_account` | `BOOLEAN` | `boolean` | No | `TRUE` | NOT NULL | Header grouping account vs leaf posting account | `true` |
| `created_at` | `TIMESTAMPTZ` | `string (ISO-8601)` | No | `now()` | NOT NULL | Audit creation timestamp | `2026-04-01T00:00:00.000Z` |
| `updated_at` | `TIMESTAMPTZ` | `string (ISO-8601)` | No | `now()` | NOT NULL | Audit update timestamp | `2026-04-01T00:00:00.000Z` |

---

## 2. `erp4.accounting_periods` (Fiscal Calendar Control)

Controls fiscal calendar boundaries and guards journal transaction posting.

| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints | Business Rule | Example |
|---|---|---|---|---|---|---|---|
| `id` | `UUID` | `string (uuid)` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate key | `20000000-0000-0000-0000-000000000001` |
| `period_label` | `VARCHAR(16)` | `string (YYYY-MM)` | No | — | UNIQUE, NOT NULL | Canonical fiscal period label | `2026-04` |
| `start_date` | `DATE` | `string (YYYY-MM-DD)` | No | — | NOT NULL | Start date of fiscal period (inclusive) | `2026-04-01` |
| `end_date` | `DATE` | `string (YYYY-MM-DD)` | No | — | NOT NULL, CHECK (`start_date <= end_date`) | End date of fiscal period (inclusive) | `2026-04-30` |
| `status` | `erp4.period_status` | `'open' \| 'soft_closed' \| 'locked'` | No | `'open'` | CHECK enum | Posting guard state; soft_closed & locked reject posts | `open` |
| `closed_at` | `TIMESTAMPTZ` | `string (ISO-8601) \| null` | Yes | `NULL` | None | Timestamp period transition to soft_closed/locked | `2026-05-05T18:00:00.000Z` |
| `closed_by` | `UUID` | `string (uuid) \| null` | Yes | `NULL` | None | Financial controller user who closed the period | `00000000-0000-0000-0000-000000000001` |
| `created_at` | `TIMESTAMPTZ` | `string (ISO-8601)` | No | `now()` | NOT NULL | Creation timestamp | `2026-04-01T00:00:00.000Z` |
| `updated_at` | `TIMESTAMPTZ` | `string (ISO-8601)` | No | `now()` | NOT NULL | Modification timestamp | `2026-04-01T00:00:00.000Z` |

---

## 3. `erp4.journal_entries` (Double-Entry Header)

Authoritative double-entry transaction journal headers.

| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints | Business Rule | Example |
|---|---|---|---|---|---|---|---|
| `id` | `UUID` | `string (uuid)` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate key | `30000000-0000-0000-0000-000000000001` |
| `entry_number` | `VARCHAR(32)` | `string (1..32)` | No | — | UNIQUE, NOT NULL | Sequential journal entry identifier | `JE-2026-0001` |
| `posting_date` | `DATE` | `string (YYYY-MM-DD)` | No | — | NOT NULL | Transaction posting date | `2026-04-15` |
| `period_id` | `UUID` | `string (uuid)` | No | — | FK → `erp4.accounting_periods(id)` RESTRICT | Must point to an active, open accounting period | `20000000-0000-0000-0000-000000000001` |
| `status` | `erp4.journal_status`| `'draft' \| 'posted' \| 'voided' \| 'reversed'` | No | `'draft'` | CHECK enum | Posting lifecycle status; atomic transition on post | `posted` |
| `currency_code` | `VARCHAR(3)` | `string (length 3)` | No | `'INR'` | ISO 4217 uppercase | Transaction denomination currency | `INR` |
| `description` | `TEXT` | `string (1..1000)` | No | — | NOT NULL | Journal description memo / transaction narration | `Vendor bill payment batch #12` |
| `source_entry_id` | `UUID` | `string (uuid) \| null` | Yes | `NULL` | None | References original entry if compensating reversal | `30000000-0000-0000-0000-000000000000` |
| `idempotency_key` | `VARCHAR(128)` | `string \| null` | Yes | `NULL` | Partial UNIQUE where not null | Durable mutation and retry idempotency key | `batch-01-row-12-v1` |
| `source_system` | `VARCHAR(64)` | `string \| null` | Yes | `NULL` | None | Migration ingestion provenance origin | `tally-prime-v3` |
| `source_id` | `VARCHAR(64)` | `string \| null` | Yes | `NULL` | None | Original row identifier from source system | `VOUCHER-9921` |
| `posted_at` | `TIMESTAMPTZ` | `string (ISO-8601) \| null` | Yes | `NULL` | None | Exact posting timestamp | `2026-04-15T10:30:00.000Z` |
| `posted_by` | `UUID` | `string (uuid) \| null` | Yes | `NULL` | None | User UUID authorizing the posting | `00000000-0000-0000-0000-000000000001` |
| `created_at` | `TIMESTAMPTZ` | `string (ISO-8601)` | No | `now()` | NOT NULL | Header creation timestamp | `2026-04-15T10:00:00.000Z` |
| `updated_at` | `TIMESTAMPTZ` | `string (ISO-8601)` | No | `now()` | NOT NULL | Modification timestamp | `2026-04-15T10:30:00.000Z` |

---

## 4. `erp4.journal_lines` (Double-Entry Debit & Credit Lines)

Atomic lines constituting a balanced double-entry transaction.

| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints | Business Rule | Example |
|---|---|---|---|---|---|---|---|
| `id` | `UUID` | `string (uuid)` | No | `gen_random_uuid()` | Primary Key | Line surrogate key | `40000000-0000-0000-0000-000000000001` |
| `journal_entry_id` | `UUID` | `string (uuid)` | No | — | FK → `erp4.journal_entries(id)` CASCADE | Parent journal header reference | `30000000-0000-0000-0000-000000000001` |
| `account_id` | `UUID` | `string (uuid)` | No | — | FK → `erp4.accounts(id)` RESTRICT | General ledger account receiving debit/credit | `10000000-0000-0000-0000-000000000001` |
| `line_number` | `INTEGER` | `number (int >= 1)` | No | — | UNIQUE (`journal_entry_id`, `line_number`) | 1-based sequential line position | `1` |
| `debit_amount` | `NUMERIC(18,4)`| `string \| number` | No | `0.0000` | CHECK (`debit_amount >= 0`) | Non-negative decimal; exactly one of debit/credit > 0 | `15000.0000` |
| `credit_amount` | `NUMERIC(18,4)`| `string \| number` | No | `0.0000` | CHECK (`credit_amount >= 0`) | Non-negative decimal; exactly one of debit/credit > 0 | `0.0000` |
| `description` | `TEXT` | `string \| null` | Yes | `NULL` | None | Line-level narration / itemized explanation | `Payment for invoice INV-2026-004` |
| `created_at` | `TIMESTAMPTZ` | `string (ISO-8601)` | No | `now()` | NOT NULL | Line creation timestamp | `2026-04-15T10:00:00.000Z` |

---

## 5. `erp4.opening_balances` (Historical Opening Balance Loads)

Opening general ledger balances migrated during system cutover.

| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints | Business Rule | Example |
|---|---|---|---|---|---|---|---|
| `id` | `UUID` | `string (uuid)` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate key | `50000000-0000-0000-0000-000000000001` |
| `account_id` | `UUID` | `string (uuid)` | No | — | FK → `erp4.accounts(id)` RESTRICT | General ledger account receiving initial balance | `10000000-0000-0000-0000-000000000001` |
| `currency_code` | `VARCHAR(3)` | `string (length 3)` | No | `'INR'` | UNIQUE (`account_id`, `currency_code`) | ISO 4217 currency code | `INR` |
| `balance_amount` | `NUMERIC(18,4)`| `string \| number` | No | — | NOT NULL | Signed decimal balance (+ for debit balance, - for credit balance) | `250000.0000` |
| `as_of_date` | `DATE` | `string (YYYY-MM-DD)` | No | — | NOT NULL | Cutover balance date | `2026-04-01` |
| `source_reference` | `TEXT` | `string \| null` | Yes | `NULL` | None | Legacy balance verification reference | `FY2025-Audit-Final` |
| `created_at` | `TIMESTAMPTZ` | `string (ISO-8601)` | No | `now()` | NOT NULL | Ingestion timestamp | `2026-04-01T00:00:00.000Z` |

---

## 6. `erp4.import_receipts` (Durable Migration Tracking)

Durable atomic receipt records tracking every migrated source row terminal state.

| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints | Business Rule | Example |
|---|---|---|---|---|---|---|---|
| `id` | `UUID` | `string (uuid)` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate key | `60000000-0000-0000-0000-000000000001` |
| `idempotency_key` | `VARCHAR(128)` | `string` | No | — | UNIQUE, NOT NULL | Stable key: batchId + sourceRow + entity/version | `batch-01-row-0-account-v1` |
| `batch_id` | `VARCHAR(64)` | `string` | No | — | NOT NULL | Migration execution batch UUID | `11111111-1111-1111-1111-111111111111` |
| `source_row` | `INTEGER` | `number (int >= 0)` | No | — | NOT NULL | Zero-indexed row number in source file | `0` |
| `target_entity` | `VARCHAR(64)` | `string` | No | — | NOT NULL | Domain entity type (`account`, `journal_entry`) | `account` |
| `target_id` | `UUID` | `string (uuid) \| null` | Yes | `NULL` | None | Persisted business record UUID | `10000000-0000-0000-0000-000000000001` |
| `status` | `VARCHAR(32)` | `'loaded' \| 'rejected' \| 'merged' \| 'skipped'` | No | — | CHECK status enum | Exact terminal migration row outcome | `loaded` |
| `metadata` | `JSONB` | `Record<string, unknown>` | Yes | `'{}'::jsonb` | NOT NULL | Sanitized provenance, request hash, or error details | `{"source_id":"ACC-001"}` |
| `created_at` | `TIMESTAMPTZ` | `string (ISO-8601)` | No | `now()` | NOT NULL | Dual-write commit timestamp | `2026-04-01T00:00:00.000Z` |
