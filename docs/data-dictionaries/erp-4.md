# ERP-4 Finance & Accounting — Data Dictionary (Global Reference)

This document is the global-docs copy of the module data dictionary.

For the canonical, detailed version see:
[`apps/erp/modules/erp-4/docs/data-dictionary.md`](../../apps/erp/modules/erp-4/docs/data-dictionary.md)

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-4 Finance & Accounting |
| **Issue** | #36 |
| **PostgreSQL Schema** | `erp4` |
| **API Base** | `/api/v1/erp-finance` |
| **Tables** | `erp4.accounts`, `erp4.accounting_periods`, `erp4.journal_entries`, `erp4.journal_lines`, `erp4.opening_balances` |
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
