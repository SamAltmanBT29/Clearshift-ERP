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
| **Read API Issue** | #47 — `[ERP5-02] List/read API with bounded paging and OpenAPI contract` |
| **Authorization Issue** | #191 — `[ERP5-15] Module authorization policy integration` |
| **PostgreSQL Schema** | `erp5` |
| **API Base** | `/api/v1/erp-hr` |
| **OpenAPI Contract** | `packages/contracts/openapi/erp-5.yaml` |
| **Zod Contract** | `packages/contracts/src/erp-5.ts` |
| **Drizzle Model** | `apps/erp/modules/erp-5/db/schema.ts` |
| **Migration** | `packages/database/migrations/erp5_v1.sql` |
| **Tables** | `erp5.departments`, `erp5.employees`, `erp5.leave`, `erp5.payroll_totals`, `erp5.import_receipts` |
| **View** | `erp5.identity_users` — read-only Hub Identity projection (owner: Platform / Hub Identity) |
| **Version** | V1.4 |
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
| `GET` | `/api/v1/erp-hr/employees/{id}` | Read one employee (masked projection) |
| `POST` | `/api/v1/erp-hr/employees` | Create an employee (unique `employee_no`, BR-ERP5-01 enforced) |
| `PATCH` | `/api/v1/erp-hr/employees/{id}` | Edit an employee (allow-listed fields) |
| `GET` | `/api/v1/erp-hr/departments` | List departments |
| `GET` | `/api/v1/erp-hr/departments/{id}` | Read one department |
| `POST` | `/api/v1/erp-hr/departments` | Create a department (unique `code`) |
| `PATCH` | `/api/v1/erp-hr/departments/{id}` | Edit a department |
| `GET` | `/api/v1/erp-hr/leave` | List leave records |
| `GET` | `/api/v1/erp-hr/leave/{id}` | Read one leave record |
| `POST` | `/api/v1/erp-hr/leave` | Create a leave record |
| `PATCH` | `/api/v1/erp-hr/leave/{id}` | Edit a leave record and apply the V1 state transition (ERP5-06) |
| `GET` | `/api/v1/erp-hr/identity-users` | Read-only Hub Identity user projection |
| `GET` | `/api/v1/erp-hr/payroll-totals?month=YYYY-MM` | Department/month payroll aggregates |
| `GET` | `/api/v1/erp-hr/payroll-totals/{id}` | Read one department/month aggregate |
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

## Query Layer Contract (ERP5-02)

| Aspect | Rule |
|---|---|
| Paging | `page` starts at 1, `pageSize` is 1..100 with a default of 25; a larger request is `400` |
| Ordering | an allow-listed sort field, then the `id` as the deterministic tie-breaker |
| Response | `{ data: [...], meta: { page, pageSize, total, totalPages } }` — `totalPages` is `0` for an empty collection |
| Server-side | the search and the filter run in the database and are parameterised — a search term is never interpolated into SQL |
| Bounded | every query carries a `LIMIT`/`OFFSET`; no collection is returned unbounded |
| Salary | the employee collection carries the masked projection — the raw `salary` never leaves the module |
| Identity projection | the read-only Hub Identity projection; empty when the platform has not created it; no credential column; never written by the module |
| Authorization | the shared `module.read` capability — Viewer, Editor, Analyst and Admin |

## Authorization Policy (ERP5-15)

The module owns **no** role list: every route is bound to a declared policy whose role sets mirror the central matrix of PLT-06 (**default deny**).

| Policy | Roles | Central policy |
|---|---|---|
| `hr.employees.read` · `hr.departments.read` · `hr.leave.read` · `hr.payroll.read` · `hr.identity_users.read` | Viewer, Editor, Analyst, Admin | `hr.read` |
| `hr.employees.create` / `.update` · `hr.departments.create` / `.update` · `hr.leave.create` / `.update` | Editor, Admin | `hr.mutate` |
| `hr.payroll.load` | **Migration Runner**, Admin | `hr.payroll_bulk` |

| Aspect | Rule |
|---|---|
| Authentication | a real access token is verified with the shared Hub verifier (PLT-05) — signature, issuer, audience, expiry; a disabled account is refused. The role set always comes from the verified claims. |
| Unauthenticated | `401 UNAUTHORIZED` |
| Insufficient role | `403 FORBIDDEN` — refused **before** the record is loaded, so a forbidden write reveals nothing |
| Object level | the policy is bound to an entity kind and the identifier is resolved in the table that belongs to the route: a cross-module identifier is `404` and nothing is mutated (DR-14) |
| Cross-module | the Migration Runner may load a payroll aggregate and nothing else; it never writes into the `erp5` tables directly (Decision C7) |
| Fields | the raw `salary` never leaves the module; a credential in a payload is `400 HR_CREDENTIALS_FORBIDDEN`; the identity projection carries no credential field and is read-only |
| Full note | `apps/erp/modules/erp-5/docs/security.md` |

## Collection Screens (ERP5-04)

**Issue**: [#49](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/49) —
`[ERP5-04] ERP-5 HR and Employees: List screen, search/filter and stable empty/loading/error states`
**Route registration**: [ERP5-16](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/192) —
issue #192
**Canonical detail**:
[`apps/erp/modules/erp-5/docs/data-dictionary.md`](../../apps/erp/modules/erp-5/docs/data-dictionary.md)
§16

| Aspect | Rule |
|---|---|
| Screens | the employee, department, leave, payroll-total and identity-user collections — each reads its own endpoint of the same API base |
| Columns | every column is a field the contract already returns; the screen adds no field and invents no value |
| Salary | the employee screen shows `salary_display` only — the raw `salary` is absent from the public projection, so the browser cannot render it |
| References | the API returns `department_id` / `employee_id`, never a name. The department is resolved through the bounded department collection (at most 100 rows); a department outside that page is shown as a short identifier, never as an invented name |
| Server-side | the search, the filters, the sort and the page are sent to the API; the browser never narrows, orders or pages a collection |
| Page reset | a search or a filter change resets the page to the first one; the search term is published after a 300 ms pause |
| States | loading (a skeleton), no data (an empty state), API failure (a readable message and a retry), permission denied (an access-denied view, never a retry) |
| Permission-aware actions | the create action is offered only to a session that may write — the question is asked of the shared central matrix of PLT-06, never of a local copy of the role list |
| Authorization | the server remains the authority; the client matrix only decides whether an action is offered at all |

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
| DR-13 | The ERP-5 list response keeps its published `{data, meta}` shape; harmonising it with the ERP-4 and PLT-04 envelopes is a platform-wide change | Open — escalated to PLT-04 / PLT-14 |
| DR-14 | The object-level guard enforces **module ownership**, not tenancy — the `erp5` schema has no tenant or owner column, so a multi-tenant dimension is a schema item, not an authorization one | Open — escalated |
| DR-15 | The Kit's write identity for the master records (closes DR-9): the payroll load follows `hr.payroll_bulk`; the master-record loads keep `hr.mutate` — a Kit service identity or an `hr.employee_bulk` policy is a platform decision | Open — escalated to PLT-06 |

## Verification

| Evidence | Command |
|---|---|
| Schema contract & DDL ↔ Drizzle parity | `npx vitest run apps/erp/modules/erp-5/tests/db/schema.test.ts` |
| Live PostgreSQL constraint proofs | `DATABASE_URL_TEST=postgresql://user:pass@localhost:5432/postgres npx vitest run apps/erp/modules/erp-5/tests/db/schema.integration.test.ts` |
| Mutation API (service + API level) | `npx vitest run apps/erp/modules/erp-5/tests` |
| Relationships, state transitions and read model | `npx vitest run apps/erp/modules/erp-5/tests/domain apps/erp/modules/erp-5/tests/services/hr.relationships.test.ts apps/erp/modules/erp-5/tests/api/state-transitions.test.ts` |
| Collection screens (API client, list screens, states) | `npx vitest run apps/erp/modules/erp-5/web` |
| Migration apply / re-apply | `npm run db:migrate` twice against an empty database |
