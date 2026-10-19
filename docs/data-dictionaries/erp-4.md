# ERP-4 Finance & Accounting — Data Dictionary (Global Reference)

This document is the global-docs copy of the module data dictionary.

For the canonical, detailed version see:
[`apps/erp/modules/erp-4/docs/data-dictionary.md`](../../apps/erp/modules/erp-4/docs/data-dictionary.md)

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-4 Finance & Accounting |
| **Issues** | #36 (Data Model), #37 (List/Read API & Contracts), #38 (Mutation API & Domain Validation) |
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


