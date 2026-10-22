# ERP-5 HR & Employees — Data Dictionary (Global Reference)

This document is the global-docs copy of the module data dictionary.

For the canonical, detailed version see:
[`apps/erp/modules/erp-5/docs/data-dictionary.md`](../../apps/erp/modules/erp-5/docs/data-dictionary.md)

---

## Module Summary

| Field | Value |
|---|---|
| **Module** | ERP-5 HR & Employees (Group 10) |
| **Issue** | #46 — `[ERP5-01] Schema, Drizzle models and guarded migrations` |
| **PostgreSQL Schema** | `erp5` |
| **API Base** | `/api/v1/erp-hr` |
| **OpenAPI Contract** | `packages/contracts/openapi/erp-5.yaml` |
| **Zod Contract** | `packages/contracts/src/erp-5.ts` |
| **Drizzle Model** | `apps/erp/modules/erp-5/db/schema.ts` |
| **Migration** | `packages/database/migrations/erp5_v1.sql` |
| **Tables** | `erp5.departments`, `erp5.employees`, `erp5.leave`, `erp5.payroll_totals`, `erp5.import_receipts` |
| **View** | `erp5.identity_users` — read-only Hub Identity projection (owner: Platform / Hub Identity) |
| **Version** | V1.0 |
| **SDS Reference** | ClearShift ERP v2.0 §4.6 (FR-ERP5-01..06, BR-ERP5-01..02), §4.7 (ERP-5 tables) |

## Table Index

| Table | Purpose | Key Constraint |
|---|---|---|
| `erp5.departments` | Department hierarchy | UNIQUE(`code`), CHECK(not self-parenting) |
| `erp5.employees` | Employee master | UNIQUE(`employee_no`), CHECK(`join_date >= birth_date`), CHECK(`salary >= 0`) |
| `erp5.leave` | Leave records | CHECK(`date_to >= date_from`), FK → `erp5.employees` |
| `erp5.payroll_totals` | Department/month aggregates (no employee rows) | UNIQUE(`department_id`, `month`), CHECK(month format) |
| `erp5.import_receipts` | Idempotency & migration audit | UNIQUE(`idempotency_key`) |
| `erp5.identity_users` | Read-only Hub Identity projection | VIEW — no credential column, no write privilege |

## API Endpoints (contract baseline — implemented in ERP5-02 / ERP5-03)

All collection endpoints use bounded pagination (`page` starts at 1, `pageSize` 1..100, default 25) with allow-listed sort fields and a deterministic `id` tie-breaker.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/erp-hr/employees` | List employees with bounded paging and search |
| `POST` | `/api/v1/erp-hr/employees` | Create an employee (unique `employee_no`, BR-ERP5-01 enforced) |
| `PATCH` | `/api/v1/erp-hr/employees/{id}` | Edit an employee (allow-listed fields) |
| `GET` | `/api/v1/erp-hr/departments` | List departments |
| `POST` | `/api/v1/erp-hr/departments` | Create a department (unique `code`) |
| `PATCH` | `/api/v1/erp-hr/departments/{id}` | Edit a department |
| `GET` | `/api/v1/erp-hr/leave` | List leave records |
| `POST` | `/api/v1/erp-hr/leave` | Create a leave record |
| `GET` | `/api/v1/erp-hr/identity-users` | Read-only Hub Identity user projection |
| `GET` | `/api/v1/erp-hr/payroll-totals?month=YYYY-MM` | Department/month payroll aggregates |
| `POST` | `/api/v1/erp-hr/payroll-totals` | Load one department/month aggregate |

## Domain Rules

- **Join date guard (BR-ERP5-01)**: `join_date` can never precede `birth_date` — enforced by the database check constraint `employees_join_date_after_birth_date` and by the Zod contract.
- **Salary masking (BR-ERP5-02)**: salary is never returned in full to a viewer and never appears in a log. The public projection exposes `salary_display` = `XX,XXX` (or `salary hidden`); the raw `salary` column is never serialized to a viewer.
- **Leave validity**: `date_to` can never precede `date_from`; the referenced employee must exist.
- **Payroll aggregates**: one aggregate per department and month; the payload carries no employee-level data (FR-ERP5-06).
- **Identity ownership**: HR stores no credentials and grants no application roles. `erp5.identity_users` is a read-only view over `platform.hub_users` with no credential or token column and no write privilege.
- **Cross-module boundary (Decision C7)**: every foreign key in `erp5` targets an `erp5` table. No sibling module or Kit adapter may write into the `erp5` schema.

## Open Decision Records (V1)

| ID | Decision | Status |
|---|---|---|
| DR-1 | `employee_no` declared unique identity key (SDS §4.7 silent vs Master Arch. ERD §5) | Accepted for V1 — maintainer confirmation requested |
| DR-2 | Salary stored as `NUMERIC(20,4)` and masked at serialization (SDS §4.7 vs Master Arch. ERD `bytea salary_enc`) | Accepted for V1 — escalated; encryption at rest deferred to PLT-12 / ERP5-09 |
| DR-3 | `erp5_users` implemented as a read-only projection, not an ERP-5 table | Accepted (Master Arch. C3) |
| DR-4 | Payroll aggregate table named `erp5.payroll_totals` (SDS names no table) | Naming proposal — maintainer confirmation requested |

## Verification

| Evidence | Command |
|---|---|
| Schema contract & DDL ↔ Drizzle parity | `npx vitest run apps/erp/modules/erp-5/tests/db/schema.test.ts` |
| Live PostgreSQL constraint proofs | `DATABASE_URL_TEST=postgresql://user:pass@localhost:5432/postgres npx vitest run apps/erp/modules/erp-5/tests/db/schema.integration.test.ts` |
| Migration apply / re-apply | `npm run db:migrate` twice against an empty database |
