# ERP-4 Finance & Accounting: Requirement-to-Test Traceability Matrix

**Issue**: [ERP4-24 / #180](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/180), Gate G1 Design Artifact  
**Requirement Source**: `docs/SDS_ClearShift_ERP.md` §7.9 (FR-ERP4-01..05, BR-ERP4-01..02) and ClearShift Core Rules  
**Test Root**: `apps/erp/modules/erp-4/`  

---

## 1. Traceability Matrix

| Requirement ID | Specification Requirement (SDS / Rules) | Priority | Level | Test Suite File | Test Case Name / Verification | Status |
|---|---|---|---|---|---|---|
| **FR-ERP4-01** | Chart of accounts tree: code, name, type (asset/liability/income/expense), currency, parent account, active flag | Must | DB | `tests/db/schema.test.ts` | enforces non-empty code, name, valid account_type enum, parent self-reference | EXISTS |
| | | | Domain | `tests/domain/invariants.test.ts` | asserts valid account classification allowlist | EXISTS |
| | | | API | `tests/api/list.test.ts` | GET /accounts returns paginated list with search, active filters, deterministic order | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | POST /accounts creates account and validates unique code | EXISTS |
| | | | UI | `web/tests/AccountsListPage.test.tsx` | renders accounts table, type badges, search input, filter pills | EXISTS |
| | | | UI | `web/tests/AccountCreateModal.test.tsx` | creates account with code, name, type, and currency | EXISTS |
| **FR-ERP4-02** | Fiscal period calendar: period label, start/end date, status (open/soft_closed/locked) | Must | DB | `tests/db/schema.test.ts` | enforces unique period_label, start_date <= end_date, period_status enum | EXISTS |
| | | | Domain | `tests/domain/invariants.test.ts` | period transitions open -> soft_closed -> locked | EXISTS |
| | | | API | `tests/api/list.test.ts` | GET /periods returns accounting periods with status | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | PATCH /periods/:id updates status and enforces closing guard | EXISTS |
| **FR-ERP4-03** | Journal entry header and lines: entry number, date, period reference, currency, balanced debit/credit lines | Must | DB | `tests/db/schema.test.ts` | journal_entries and journal_lines tables enforce schema, cascades, and line constraints | EXISTS |
| | | | Domain | `tests/domain/relationships.test.ts` | validates journal line relationships to header and account | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | POST /journal-entries creates draft entry with lines atomically | EXISTS |
| | | | UI | `web/tests/JournalEntryForm.test.tsx` | renders line items builder, live debit/credit total calculator | EXISTS |
| **FR-ERP4-04** | Posting guard & double-entry balance check: total debits == total credits; posting is atomic; reject unbalanced with JOURNAL_UNBALANCED | Must | Domain | `tests/domain/invariants.test.ts` | assertDoubleEntryBalanced validates debit total equals credit total at currency precision | EXISTS |
| | | | Domain | `tests/domain/invariants.test.ts` | rejects unbalanced journal entry with JOURNAL_UNBALANCED | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | POST /journal-entries/:id/post rejects unbalanced entry with 422 JOURNAL_UNBALANCED | EXISTS |
| | | | API | `tests/api/mutations.test.ts` | POST /journal-entries/:id/post rejects posting to locked or soft_closed periods | EXISTS |
| | | | E2E | `tests/e2e/demo-journey.test.ts` | complete posting workflow: draft -> balanced lines -> post -> trial balance | EXISTS |
| **FR-ERP4-05** | Trial balance report: real-time debit and credit totals grouped by account and currency | Must | Domain | `tests/domain/invariants.test.ts` | trial balance calculation aggregates debits and credits correctly | EXISTS |
| | | | API | `tests/api/list.test.ts` | GET /trial-balance returns aggregated debit/credit totals | EXISTS |
| | | | UI | `web/tests/AccountsListPage.rtl.test.tsx` | switches to Trial Balance tab and displays debit/credit columns | EXISTS |
| **BR-ERP4-01** | Double-entry invariant: decimal arithmetic only; no rounding loss; zero floating-point discrepancies | Must | Domain | `tests/domain/invariants.test.ts` | exact decimal math with NUMERIC(18,4) precision; rejects floating-point inaccuracies | EXISTS |
| **BR-ERP4-02** | Closed period guard: locked periods reject mutations; audit log tracks closures | Must | API | `tests/api/mutations.test.ts` | rejects journal entry posting when period status is locked | EXISTS |
| | | | Service | `tests/seed/seed.test.ts` | verifies seed periods created with open/closed states | EXISTS |
| **KIT-08** | In-process target adapter: atomic target mutation + durable import receipt; dual-write commit in single transaction | Must | Migration | `tests/migration/idempotency.test.ts` | importRow dual-write commits business entity and receipt atomically | EXISTS |
| | | | Migration | `tests/migration/idempotency.test.ts` | retrying with same idempotency key returns priorResult without duplicate insert | EXISTS |
| | | | Migration | `tests/migration/retry-stop.test.ts` | chunks 500 rows, halts when failure rate > 10%, preserves committed rows | EXISTS |
| **KIT-14** | Shared Migration Kit Wizard integration: target schema metadata registration; dynamic fields rendering; type compatibility | Must | UI | `web/tests/kit-metadata.test.ts` | erp4WebKitMetadata registers account, opening_balance, journal_entry, journal_line | EXISTS |
| | | | UI | `web/tests/MigrationKitWizard.test.tsx` | renders field labels, type badges, enum allowlist; warns on incompatible mapping; blocks unmapped required | EXISTS |
| **KIT-16** | Rejection review & export: module identifier columns; failure explanations; sensitive masking; formula-safe export | Must | UI | `tests/kit/rejection-context.test.ts` | validates identifier columns, error code explanations, sensitive field masking, formula neutralization | EXISTS |
| | | | UI | `web/tests/RejectionReviewScreen.test.tsx` | renders review screen, error filter, inspect drawer, masked payload, CSV download | EXISTS |
| **SEC-01** | Authorization & RBAC: role-based access control; admin, editor, viewer permissions; tenant isolation | Must | Security | `tests/security/authorization.test.ts` | verifies role-based permissions, viewer cannot mutate, admin/editor can post | EXISTS |
| | | | Security | `tests/api/auth-and-envelope.test.ts` | verifies JWT authentication and standard { data, error } envelope | EXISTS |
