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
| **Mutation API Issue** | #48 — `[ERP5-03] Mutation API and domain validation` |
| **Relationship Issue** | #51 — `[ERP5-06] Relationships, state transitions and read-model consistency` |
| **PostgreSQL Schema** | `erp5` |
| **API Base** | `/api/v1/erp-hr` |
| **OpenAPI Contract** | `packages/contracts/openapi/erp-5.yaml` |
| **Zod Contract** | `packages/contracts/src/erp-5.ts` |
| **Drizzle Model** | `apps/erp/modules/erp-5/db/schema.ts` |
| **Migration** | `packages/database/migrations/erp5_v1.sql` |
| **Tables** | `erp5.departments`, `erp5.employees`, `erp5.leave`, `erp5.payroll_totals`, `erp5.import_receipts` |
| **View** | `erp5.identity_users` — read-only Hub Identity projection (owner: Platform / Hub Identity) |
| **Version** | V1.2 |
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

## API Endpoints (contract baseline — implemented in ERP5-02 / ERP5-03 / ERP5-06)

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
| `PATCH` | `/api/v1/erp-hr/leave/{id}` | Edit a leave record and apply the V1 state transition (ERP5-06) |
| `GET` | `/api/v1/erp-hr/identity-users` | Read-only Hub Identity user projection |
| `GET` | `/api/v1/erp-hr/payroll-totals?month=YYYY-MM` | Department/month payroll aggregates |
| `POST` | `/api/v1/erp-hr/payroll-totals` | Load one department/month aggregate |

## Domain Rules

- **Join date guard (BR-ERP5-01)**: `join_date` can never precede `birth_date` — enforced by the database check constraint `employees_join_date_after_birth_date`, by the Zod contract and by the service layer. A violation is answered with `422 HR_JOIN_DATE_AFTER_BIRTH_DATE`.
- **Salary masking (BR-ERP5-02)**: salary is never returned in full to a viewer and never appears in a log. The public projection exposes `salary_display` = `XX,XXX` (or `salary hidden`); the raw `salary` column is never serialized to a viewer. The V1 mutation API masks the salary for **every** caller (DR-5).
- **Leave validity**: `date_to` can never precede `date_from`; the referenced employee must exist.
- **Payroll aggregates**: one aggregate per department and month; the payload carries no employee-level data (FR-ERP5-06).
- **Identity ownership**: HR stores no credentials and grants no application roles. `erp5.identity_users` is a read-only view over `platform.hub_users` with no credential or token column and no write privilege. A write that carries a credential is rejected with `400 HR_CREDENTIALS_FORBIDDEN`.
- **Cross-module boundary (Decision C7)**: every foreign key in `erp5` targets an `erp5` table. No sibling module or Kit adapter may write into the `erp5` schema.

## Mutation API Contract (ERP5-03)

| Aspect | Rule |
|---|---|
| Validation | Zod at the route boundary; every write request schema forbids unknown properties (`additionalProperties: false`) |
| Authorization | shared `module.write` capability — Editor and Admin may write (PLT-06 `hr.mutate`); the payroll aggregate follows the central matrix (`hr.payroll_bulk`) — Migration Runner and Admin; Viewer and Analyst receive `403` |
| Transaction | the target mutation and its `erp5.import_receipts` receipt commit in one transaction |
| Import provenance | `batch_id` + `source_row` + `Idempotency-Key` travel together; a partial triple is `400 HR_IMPORT_PROVENANCE_REQUIRED` |
| Idempotency | a repeated import returns the original row and the original receipt with `200 OK` and performs no second mutation; a different payload with the same key is `409 HR_IDEMPOTENCY_CONFLICT` |
| Protected fields | `id`, `created_at`, `updated_at` are never writable; `currency_code` is immutable after create; `source_system` / `source_id` are import-only — all rejected with `400 HR_PROTECTED_FIELD` |
| Error envelope | the shared `{code, message, details, correlation_id}` envelope owned by PLT-04 (`@clearshift/contracts` → `ErrorEnvelopeSchema`) — never a second envelope |
| Status mapping | `400` malformed · `401` unauthenticated · `403` forbidden · `404` missing record · `409` duplicate/idempotency · `422` invalid business value · `500` unexpected (correlation id only) |

## Relationship, State and Read-Model Contract (ERP5-06)

| Aspect | Rule |
|---|---|
| Relationship validation | every required relationship is validated before the commit, inside the same transaction; a rejected reference leaves **no** partial mutation |
| Optional relationship | an absent optional link produces the approved warning `HR_OPTIONAL_REFERENCE_ABSENT` in the response `warnings` array — no synthetic record is ever created |
| Source identity | `source_system` and `source_id` are a pair — half of them is `400 HR_SOURCE_IDENTITY_INCOMPLETE` |
| Enumerations | the leave type and the leave status are rejected with a stable code (`HR_INVALID_LEAVE_TYPE`, `HR_INVALID_LEAVE_STATUS`) at the service level too, not only at the HTTP boundary |
| Leave state matrix | `pending → approved \| rejected` is the only transition; `approved` and `rejected` are terminal; the same status again is a no-op. A forbidden transition is `422 HR_INVALID_LEAVE_STATUS_TRANSITION` with the allowed set in the message. The FR-ERP5-10 workflow stays in V2 (DR-10) |
| Immutable subject | the employee a leave belongs to is never re-parented |
| Read model | the response of a write is built from the **persisted** row and asserted against the read model of its entity, so the UI and the read API agree immediately after the write |
| Payroll authority | the department/month aggregate is authoritative **as loaded** by the Kit and is never recomputed from the employee rows (DR-11) |
| Cross-module surface | `Erp5ReferenceResolver` confirms only what it can prove; without a repository it denies every existence check (default deny, DR-12) |

## Open Decision Records (V1)

| ID | Decision | Status |
|---|---|---|
| DR-1 | `employee_no` declared unique identity key (SDS §4.7 silent vs Master Arch. ERD §5) | Accepted for V1 — maintainer confirmation requested |
| DR-2 | Salary stored as `NUMERIC(20,4)` and masked at serialization (SDS §4.7 vs Master Arch. ERD `bytea salary_enc`) | Accepted for V1 — escalated; encryption at rest deferred to PLT-12 / ERP5-09 |
| DR-3 | `erp5_users` implemented as a read-only projection, not an ERP-5 table | Accepted (Master Arch. C3) |
| DR-4 | Payroll aggregate table named `erp5.payroll_totals` (SDS names no table) | Naming proposal — maintainer confirmation requested |
| DR-5 | V1 masks the salary for every caller of the mutation API — BR-ERP5-02 permits only `XX,XXX` / `salary hidden`, while the central matrix of PLT-06 permits Admin to see it | Open — escalated; an Admin-only privileged projection belongs to a follow-up |
| DR-6 | Import provenance is a triple (`batch_id` + `source_row` + idempotency key); a partial triple is rejected | Accepted for V1 |
| DR-7 | `source_system` / `source_id` are import-only; `currency_code` is immutable after create | Accepted for V1 |
| DR-8 | The write service depends on the `HrRepository` contract; ERP5-02 owns the Drizzle implementation | Open — hand-over stated for ERP5-02 |
| DR-9 | Write authorization follows the central matrix of PLT-06 — `module.write` for the HR master records, `hr.payroll_bulk` (Migration Runner, Admin) for the payroll aggregate; the Kit's identity for employee/leave loads is still undefined | Open — escalated to ERP5-15 / the PLT-06 owner |
| DR-10 | V1 exposes the leave **state transition** only (`pending → approved \| rejected`, terminal states); the FR-ERP5-10 request → approve/reject workflow with a log stays in V2 | Open — escalated |
| DR-11 | The department/month payroll aggregate is authoritative as loaded and is never recomputed from the employee rows; only the display values are derived | Open — escalated |
| DR-12 | The cross-module resolver denies every existence check when it has no data source (default deny) instead of confirming every id | Accepted for V1 — maintainer confirmation requested |

## Verification

| Evidence | Command |
|---|---|
| Schema contract & DDL ↔ Drizzle parity | `npx vitest run apps/erp/modules/erp-5/tests/db/schema.test.ts` |
| Live PostgreSQL constraint proofs | `DATABASE_URL_TEST=postgresql://user:pass@localhost:5432/postgres npx vitest run apps/erp/modules/erp-5/tests/db/schema.integration.test.ts` |
| Mutation API (service + API level) | `npx vitest run apps/erp/modules/erp-5/tests` |
| Relationships, state transitions and read model | `npx vitest run apps/erp/modules/erp-5/tests/domain apps/erp/modules/erp-5/tests/services/hr.relationships.test.ts apps/erp/modules/erp-5/tests/api/state-transitions.test.ts` |
| Migration apply / re-apply | `npm run db:migrate` twice against an empty database |
