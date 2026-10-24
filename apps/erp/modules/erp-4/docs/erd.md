# ERP-4 Finance & Accounting: Entity-Relationship Diagram (ERD)

**Issue**: [ERP4-24 / #180](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/180), Gate G1 Design Artifact  
**PostgreSQL Schema**: `erp4`  
**Reference Document**: SDS ClearShift ERP v2.0 §7.9  

---

## 1. Architecture & Ownership Boundaries

ERP-4 Finance & Accounting is the authoritative system of record for the General Ledger, Chart of Accounts, Double-Entry Journal Entries, Fiscal Periods, and Opening Balances.

- **Solid lines** indicate real physical PostgreSQL foreign key constraints within the `erp4` database schema.
- **Dotted lines** indicate cross-module logical projections and read-only references governed by Decision C7 (no cross-database foreign keys). Cross-module mutations must use owning APIs.

---

## 2. Mermaid Entity-Relationship Diagram

```mermaid
erDiagram
    ERP4_ACCOUNTS ||--o{ ERP4_ACCOUNTS : "parent hierarchy (parent_id, ON DELETE RESTRICT)"
    ERP4_ACCOUNTING_PERIODS ||--o{ ERP4_JOURNAL_ENTRIES : "guards posting (period_id, ON DELETE RESTRICT)"
    ERP4_JOURNAL_ENTRIES ||--|{ ERP4_JOURNAL_LINES : "contains atomic lines (journal_entry_id, ON DELETE CASCADE)"
    ERP4_ACCOUNTS ||--o{ ERP4_JOURNAL_LINES : "general ledger line account (account_id, ON DELETE RESTRICT)"
    ERP4_ACCOUNTS ||--o{ ERP4_OPENING_BALANCES : "initial load balance (account_id, ON DELETE RESTRICT)"

    ERP2_VENDOR_BILLS }o..|| ERP4_JOURNAL_ENTRIES : "logical source bill projection (no DB FK, Decision C7)"
    ERP3_INVOICES }o..|| ERP4_JOURNAL_ENTRIES : "logical invoice revenue posting (no DB FK, Decision C7)"
    ERP5_PAYROLL_RUNS }o..|| ERP4_JOURNAL_ENTRIES : "logical payroll summary entry (no DB FK, Decision C7)"
    ERP4_IMPORT_RECEIPTS }o..|| ERP4_ACCOUNTS : "durable import provenance (target_id, no DB FK)"
    ERP4_IMPORT_RECEIPTS }o..|| ERP4_JOURNAL_ENTRIES : "durable import provenance (target_id, no DB FK)"

    ERP4_ACCOUNTS {
        uuid id PK
        varchar code UK "Canonical code, e.g. 1010-CASH"
        varchar name "Human-readable account name"
        enum type "asset, liability, income, expense"
        varchar currency_code "ISO 4217 uppercase, default INR"
        uuid parent_id FK "Hierarchy parent account"
        text description "Optional ledger narration"
        boolean is_active "Active posting status"
        boolean is_posting_account "Leaf posting vs grouping header"
        timestamptz created_at
        timestamptz updated_at
    }

    ERP4_ACCOUNTING_PERIODS {
        uuid id PK
        varchar period_label UK "Format YYYY-MM, e.g. 2026-04"
        date start_date "Start date inclusive"
        date end_date "End date inclusive"
        enum status "open, soft_closed, locked"
        timestamptz closed_at
        uuid closed_by
        timestamptz created_at
        timestamptz updated_at
    }

    ERP4_JOURNAL_ENTRIES {
        uuid id PK
        varchar entry_number UK "Sequential ID, e.g. JE-2026-0001"
        date posting_date "Accounting transaction date"
        uuid period_id FK "References accounting period"
        enum status "draft, posted, voided, reversed"
        varchar currency_code "Entry currency ISO 4217"
        text description "Header narration"
        uuid source_entry_id "Reversal reference pointer"
        varchar idempotency_key UK "Durable client idempotency key"
        varchar source_system "Migration extraction origin"
        varchar source_id "Migration source row identifier"
        timestamptz posted_at
        uuid posted_by
        timestamptz created_at
        timestamptz updated_at
    }

    ERP4_JOURNAL_LINES {
        uuid id PK
        uuid journal_entry_id FK "Parent header CASCADE"
        uuid account_id FK "General ledger account RESTRICT"
        int line_number "1-based line sequence within entry"
        numeric debit_amount "Positive decimal >= 0.0000"
        numeric credit_amount "Positive decimal >= 0.0000"
        text description "Line-level memo"
        timestamptz created_at
    }

    ERP4_OPENING_BALANCES {
        uuid id PK
        uuid account_id FK "Target account RESTRICT"
        varchar currency_code "ISO 4217 code"
        numeric balance_amount "Opening balance amount (signed)"
        date as_of_date "Cutover effective date"
        text source_reference "Migration provenance label"
        timestamptz created_at
    }

    ERP4_IMPORT_RECEIPTS {
        uuid id PK
        varchar idempotency_key UK "Batch + source row key"
        varchar batch_id "Migration batch UUID"
        int source_row "Zero-indexed source row number"
        varchar target_entity "Target entity type"
        uuid target_id "Target record UUID"
        varchar status "loaded, rejected, merged, skipped"
        jsonb metadata "Provenance and audit payload"
        timestamptz created_at
    }
```

---

## 3. Primary Key, Foreign Key & Invariant Enforcement

| Table | Primary Key | Foreign Keys & Actions | Unique Constraints | Check Invariants |
|---|---|---|---|---|
| `erp4.accounts` | `id` (UUID) | `parent_id` → `erp4.accounts(id)` ON DELETE RESTRICT | `code` UNIQUE | `type IN ('asset','liability','income','expense')` |
| `erp4.accounting_periods` | `id` (UUID) | None | `period_label` UNIQUE | `start_date <= end_date`, `status IN ('open','soft_closed','locked')` |
| `erp4.journal_entries` | `id` (UUID) | `period_id` → `erp4.accounting_periods(id)` ON DELETE RESTRICT | `entry_number` UNIQUE, `idempotency_key` UNIQUE (partial) | `status IN ('draft','posted','voided','reversed')` |
| `erp4.journal_lines` | `id` (UUID) | `journal_entry_id` → `erp4.journal_entries(id)` ON DELETE CASCADE, `account_id` → `erp4.accounts(id)` ON DELETE RESTRICT | `(journal_entry_id, line_number)` UNIQUE | `debit_amount >= 0`, `credit_amount >= 0`, `NOT (debit_amount = 0 AND credit_amount = 0)`, `NOT (debit_amount > 0 AND credit_amount > 0)` |
| `erp4.opening_balances` | `id` (UUID) | `account_id` → `erp4.accounts(id)` ON DELETE RESTRICT | `(account_id, currency_code)` UNIQUE | None |
| `erp4.import_receipts` | `id` (UUID) | None (logical target_id) | `idempotency_key` UNIQUE | `status IN ('loaded','rejected','merged','skipped')` |
