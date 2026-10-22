# ERP-5 HR & Employees — Data Dictionary

**SDS Reference**: ClearShift ERP v2.0, §4.6 (FR-ERP5-01..06, BR-ERP5-01..02), §4.7 (ERP-5 tables)
**Architecture Reference**: ClearShift V1 Master Architecture Spec, §C3 (identity ownership), §5 (ERD), §6.1 (slot 01)
**Module**: ERP-5 HR & Employees (Group 10)
**Issue**: [#46](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/46) — `[ERP5-01] Schema, Drizzle models and guarded migrations`
**Mutation API Issue**: [#48](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/48) — `[ERP5-03] Mutation API and domain validation`
**Relationship Issue**: [#51](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/51) — `[ERP5-06] Relationships, state transitions and read-model consistency`
**Read API Issue**: [#47](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/47) — `[ERP5-02] List/read API with bounded paging and OpenAPI contract`
**PostgreSQL Schema**: `erp5`
**API Base**: `/api/v1/erp-hr`
**Version**: V1.3

---

## Table of Contents

1. [Ownership & boundaries](#1-ownership--boundaries)
2. [`erp5.departments`](#2-erp5departments--department-hierarchy)
3. [`erp5.employees`](#3-erp5employees--employee-master)
4. [`erp5.leave`](#4-erp5leave--leave-records)
5. [`erp5.payroll_totals`](#5-erp5payroll_totals--department-month-aggregates)
6. [`erp5.import_receipts`](#6-erp5import_receipts--idempotency--migration-audit)
7. [`erp5.identity_users` (view)](#7-erp5identity_users-view--read-only-hub-identity-projection)
8. [Constraints reference](#8-constraints-reference)
9. [Entity relationship diagram](#9-entity-relationship-diagram)
10. [Decision records](#10-decision-records)
11. [Migration & verification](#11-migration--verification)
12. [Mutation API (ERP5-03)](#12-mutation-api-erp503)
13. [Relationships, state transitions and read model (ERP5-06)](#13-relationships-state-transitions-and-read-model-erp506)
14. [Query layer — list and read API (ERP5-02)](#14-query-layer--list-and-read-api-erp502)

---

## 1. Ownership & boundaries

| Object | Owner | Notes |
|---|---|---|
| `erp5.departments` | ERP-5 | Department master data |
| `erp5.employees` | ERP-5 | Employee master data |
| `erp5.leave` | ERP-5 | Leave records |
| `erp5.payroll_totals` | ERP-5 | Department/month aggregates only — never employee rows |
| `erp5.import_receipts` | ERP-5 | Durable import receipts (Master Architecture Spec §6.1 slot 01, KIT-08) |
| `erp5.identity_users` | **Hub Identity (Platform)** | Read-only projection. ERP-5 does not own, create, extend or write it |
| `platform.hub_users` | Platform (PLT-03 / PLT-05) | Read through the projection only. No ERP-5 foreign key points at it |
| `public.schema_migrations` | Platform (PLT-03) | Shared migration ledger written by the controlled migration job |

**Cross-module boundary (Decision C7).** Every foreign key in `erp5` points at another `erp5` table. The only cross-schema object is the read-only view `erp5.identity_users`, which the Master Architecture Spec sanctions explicitly (C3: *"`erp5_users` is a read-only projection/view"*). No sibling module and no Migration Kit adapter may write into the `erp5` schema; cross-module data is read through the owning module's API or an approved projection.

---

## 2. `erp5.departments` — Department Hierarchy

**Purpose**: One row per department, with an optional parent department.
**FR Reference**: FR-ERP5-03
**Owner**: ERP-5

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `name` | `VARCHAR(255)` | NOT NULL | — | Human-readable department name | — |
| `code` | `VARCHAR(32)` | NOT NULL | — | Unique mnemonic department code, e.g. `ENG` | UNIQUE `departments_code_unique` |
| `parent_id` | `UUID` | NULL | — | Parent department (self-reference, same module) | FK → `erp5.departments(id)` ON DELETE RESTRICT; CHECK `departments_not_self_parent` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp (UTC) | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last update timestamp; maintained by trigger `departments_set_updated_at` | — |

**Indexes**:
- `departments_code_unique` — UNIQUE on `(code)` ← FR-ERP5-03
- `departments_parent_id_idx` — B-tree on `(parent_id)` — hierarchy traversal

---

## 3. `erp5.employees` — Employee Master

**Purpose**: One row per employee.
**FR Reference**: FR-ERP5-01 (list/search), FR-ERP5-02 (create/edit)
**BR Reference**: BR-ERP5-01 (join date), BR-ERP5-02 (salary masking)
**Owner**: ERP-5

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `employee_no` | `VARCHAR(32)` | NOT NULL | — | Declared employee identifier, e.g. `EMP-0001` | UNIQUE `employees_employee_no_unique` |
| `first_name` | `VARCHAR(120)` | NOT NULL | — | Given name | — |
| `last_name` | `VARCHAR(120)` | NOT NULL | — | Family name | — |
| `birth_date` | `DATE` | NOT NULL | — | Date of birth | — |
| `join_date` | `DATE` | NOT NULL | — | Employment start date | CHECK `employees_join_date_after_birth_date` (`join_date >= birth_date`) |
| `department_id` | `UUID` | NOT NULL | — | Owning department | FK → `erp5.departments(id)` ON DELETE RESTRICT |
| `job_title` | `VARCHAR(120)` | NOT NULL | — | Job title | — |
| `salary` | `NUMERIC(20,4)` | NOT NULL | — | Monthly salary. Never returned in full to viewers, never logged | CHECK `employees_salary_non_negative` (`salary >= 0`) |
| `currency_code` | `VARCHAR(3)` | NOT NULL | `'INR'` | ISO 4217 currency of `salary` and of the payroll aggregates derived from it | — |
| `source_system` | `VARCHAR(64)` | NULL | — | System that produced the record, e.g. `legacy_hr_csv` | — |
| `source_id` | `VARCHAR(128)` | NULL | — | Source-system identifier of the employee | — |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp (UTC) | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last update timestamp; maintained by trigger `employees_set_updated_at` | — |

**Indexes**:
- `employees_employee_no_unique` — UNIQUE on `(employee_no)` — declared identity key
- `employees_source_identity_unique` — **partial** UNIQUE on `(source_system, source_id) WHERE source_id IS NOT NULL` — stable source identity for idempotent migration loads; manually created employees (`source_id IS NULL`) are unconstrained
- `employees_department_id_idx` — B-tree on `(department_id)` — department-scoped listings
- `employees_last_first_name_idx` — B-tree on `(last_name, first_name)` — name search (FR-ERP5-01)
- `employees_job_title_idx` — B-tree on `(job_title)` — job-title filtering

**Sensitive field handling (BR-ERP5-02).** `salary` is stored in clear numeric form and **masked at serialization time**. The API never returns the raw column to a viewer: the public projection (`EmployeeView` in `packages/contracts/src/erp-5.ts`) omits `salary` and exposes `salary_display` = `XX,XXX` (or `salary hidden`). `salary` must never appear in an application log, an export, an error payload or an audit diff. See [Decision record DR-2](#dr-2--salary-storage--sdss-47-vs-master-architecture-spec--5).

---

## 4. `erp5.leave` — Leave Records

**Purpose**: One row per leave record.
**FR Reference**: FR-ERP5-04
**Owner**: ERP-5

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `employee_id` | `UUID` | NOT NULL | — | Employee the leave belongs to | FK → `erp5.employees(id)` ON DELETE CASCADE |
| `date_from` | `DATE` | NOT NULL | — | First day of the leave (inclusive) | — |
| `date_to` | `DATE` | NOT NULL | — | Last day of the leave (inclusive) | CHECK `leave_date_range_valid` (`date_to >= date_from`) |
| `type` | `erp5.leave_type` | NOT NULL | — | `sick` \| `holiday` \| `other` | enum |
| `status` | `erp5.leave_status` | NOT NULL | `'pending'` | `pending` \| `approved` \| `rejected` | enum |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp (UTC) | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last update timestamp; maintained by trigger `leave_set_updated_at` | — |

**Indexes**:
- `leave_employee_id_idx` — B-tree on `(employee_id)` — employee-scoped listings
- `leave_status_date_from_idx` — B-tree on `(status, date_from)` — status/period filtering

**V1/V2 boundary.** V1 records the status only. The V2 request → approve/reject workflow (FR-ERP5-10, SDS §8) reuses the same three states, so V1 rows need no remapping when the workflow lands.

---

## 5. `erp5.payroll_totals` — Department / Month Aggregates

**Purpose**: One aggregate per department and month. **Never employee rows** (FR-ERP5-06: "one number per department, no personal data").
**Owner**: ERP-5

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `department_id` | `UUID` | NOT NULL | — | Department the aggregate belongs to | FK → `erp5.departments(id)` ON DELETE RESTRICT |
| `month` | `VARCHAR(7)` | NOT NULL | — | Payroll month, `YYYY-MM` | CHECK `payroll_totals_month_format_valid` |
| `total_amount` | `NUMERIC(20,4)` | NOT NULL | — | Aggregated payroll amount for the department/month | CHECK `payroll_totals_total_non_negative` |
| `currency_code` | `VARCHAR(3)` | NOT NULL | `'INR'` | ISO 4217 currency of `total_amount` | — |
| `headcount` | `INTEGER` | NOT NULL | `0` | Number of employees included in the aggregate | CHECK `payroll_totals_headcount_non_negative` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Row creation timestamp (UTC) | — |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last update timestamp; maintained by trigger `payroll_totals_set_updated_at` | — |

**Indexes**:
- `payroll_totals_department_month_unique` — UNIQUE on `(department_id, month)` — exactly one aggregate per department/month
- `payroll_totals_month_idx` — B-tree on `(month)` — month-scoped listing

---

## 6. `erp5.import_receipts` — Idempotency & Migration Audit

**Purpose**: Durable receipt proving that a source row was loaded into a target entity. Written in the same PostgreSQL transaction as the target mutation (KIT-08).
**Owner**: ERP-5

| Column | PostgreSQL Type | Nullable | Default | Meaning | Constraints |
|---|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key | PK |
| `batch_id` | `UUID` | NOT NULL | — | Migration batch identifier | — |
| `source_row` | `INTEGER` | NOT NULL | — | 1-based source row number inside the batch | — |
| `entity` | `VARCHAR(64)` | NOT NULL | — | Target entity, e.g. `employee` | — |
| `schema_version` | `INTEGER` | NOT NULL | `1` | Target schema version of the load | — |
| `idempotency_key` | `VARCHAR(128)` | NOT NULL | — | Stable `batch + source row + entity/schema version` key | UNIQUE `import_receipts_idempotency_key_unique` |
| `target_id` | `UUID` | NOT NULL | — | Identifier of the created target row | — |
| `kind` | `VARCHAR(16)` | NOT NULL | `'created'` | `created` \| `linked` | — |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Receipt creation timestamp (UTC) | — |

**Indexes**:
- `import_receipts_idempotency_key_unique` — UNIQUE on `(idempotency_key)` — guarantees a retry cannot create a second record
- `import_receipts_batch_row_idx` — B-tree on `(batch_id, source_row)` — batch trace lookup

---

## 7. `erp5.identity_users` (view) — Read-only Hub Identity Projection

**Purpose**: Expose Hub Identity users to the ERP-5 read APIs without ERP-5 owning, copying or writing user data.
**FR Reference**: FR-ERP5-05
**Architecture Reference**: Master Architecture Spec C3
**Owner**: **Hub Identity (Platform)** — ERP-5 holds a read-only projection only

| Column | PostgreSQL Type | Nullable | Meaning |
|---|---|---|---|
| `id` | `UUID` | NOT NULL | Hub Identity user id |
| `username` | `TEXT` | NOT NULL | Login name |
| `roles` | `TEXT[]` | NOT NULL | Application roles held by the user |
| `employee_ref` | `UUID` | NULL | Optional link to an ERP-5 employee (populated by the owning side) |
| `status` | `TEXT` | NOT NULL | Account status |

**Properties**:
- It is a **VIEW**, not a table: no ERP-5 row is ever written for a user, so no identity drift is possible.
- It exposes **no credential or token column** — no password, no hash, no access token, no refresh token.
- `INSERT`, `UPDATE`, `DELETE` and `TRUNCATE` are revoked from `PUBLIC`; the projection is read-only for every application role.
- The view is created by the migration **only when `platform.hub_users` exists**, so a clean-database migration succeeds while PLT-05 (Hub Identity) is still open. Re-running the migration after Hub Identity lands creates the projection.

---

## 8. Constraints Reference

| Constraint | Type | Table | Rule | Source |
|---|---|---|---|---|
| `departments_code_unique` | UNIQUE | `erp5.departments` | Department code is unique | FR-ERP5-03 |
| `departments_not_self_parent` | CHECK | `erp5.departments` | `parent_id IS NULL OR parent_id <> id` | ERP-5 rule |
| `employees_employee_no_unique` | UNIQUE | `erp5.employees` | Employee number is unique | Master Arch. ERD §5 (`employee_no UK`) |
| `employees_source_identity_unique` | UNIQUE (partial) | `erp5.employees` | `(source_system, source_id)` unique when `source_id IS NOT NULL` | KIT-08 idempotency |
| `employees_join_date_after_birth_date` | CHECK | `erp5.employees` | `join_date >= birth_date` | **BR-ERP5-01** |
| `employees_salary_non_negative` | CHECK | `erp5.employees` | `salary >= 0` | ERP-5 rule |
| `leave_date_range_valid` | CHECK | `erp5.leave` | `date_to >= date_from` | FR-ERP5-04 |
| `payroll_totals_department_month_unique` | UNIQUE | `erp5.payroll_totals` | One aggregate per department/month | FR-ERP5-06 |
| `payroll_totals_month_format_valid` | CHECK | `erp5.payroll_totals` | `month ~ '^\d{4}-(0[1-9]|1[0-2])$'` | ERP-5 rule |
| `payroll_totals_total_non_negative` | CHECK | `erp5.payroll_totals` | `total_amount >= 0` | ERP-5 rule |
| `payroll_totals_headcount_non_negative` | CHECK | `erp5.payroll_totals` | `headcount >= 0` | ERP-5 rule |
| `import_receipts_idempotency_key_unique` | UNIQUE | `erp5.import_receipts` | One receipt per idempotency key | Master Arch. §6.1 / KIT-08 |

**Foreign keys**

| Constraint | Child → Parent | Delete rule |
|---|---|---|
| `departments_parent_id_fkey` | `erp5.departments.parent_id` → `erp5.departments.id` | RESTRICT |
| `employees_department_id_fkey` | `erp5.employees.department_id` → `erp5.departments.id` | RESTRICT |
| `leave_employee_id_fkey` | `erp5.leave.employee_id` → `erp5.employees.id` | CASCADE |
| `payroll_totals_department_id_fkey` | `erp5.payroll_totals.department_id` → `erp5.departments.id` | RESTRICT |

**Enums**

| Enum | Values |
|---|---|
| `erp5.leave_type` | `sick`, `holiday`, `other` |
| `erp5.leave_status` | `pending`, `approved`, `rejected` |

**Triggers** — `erp5.set_updated_at()` is attached to every mutable table and keeps `updated_at` current on update.

---

## 9. Entity Relationship Diagram

```
erp5.departments
    │ 1
    ├───────────────< erp5.employees        (department_id, RESTRICT)
    │                       │ 1
    │                       └──────< erp5.leave   (employee_id, CASCADE)
    │
    └───────────────< erp5.payroll_totals   (department_id, RESTRICT)

platform.hub_users  ──read-only──▶  erp5.identity_users  (VIEW, no writes, no FK)

erp5.import_receipts  ──references──▶  any target entity by id (no FK, by design)
```

---

## 10. Decision Records

### DR-1 — Employee identity key

- **Conflict**: SDS §4.7 lists `erp5_employees` without an employee identifier beyond `id`; the Master Architecture Spec ERD §5 declares `text employee_no UK`; the pre-existing module stub `apps/erp/modules/erp-5/src/public.ts` already exposes an `employeeNo` attribute.
- **Decision**: `employee_no VARCHAR(32) NOT NULL` with a UNIQUE constraint, plus a partial UNIQUE on `(source_system, source_id)`. The declared key is required by the exact-duplicate policy (ERP5-12) and the profiling expectations (ERP5-26).
- **Status**: accepted for V1 — flagged for maintainer confirmation in the PR.

### DR-2 — Salary storage (SDS §4.7 vs Master Architecture Spec §5)

- **Conflict**: SDS §4.7 declares a plain `salary` column; the Master Architecture Spec ERD §5 declares `bytea salary_enc` (encrypted at rest).
- **Decision**: V1 stores `salary NUMERIC(20,4)` in clear numeric form and **masks it at serialization time** (BR-ERP5-02: viewers receive `XX,XXX`; the raw column is never serialized to a viewer, logged or exported).
- **Rationale**: FR-ERP5-06 requires a per-department/month payroll aggregate. A ciphertext column cannot be aggregated in SQL, and no V1 issue covers key management (`pgcrypto` key provisioning, rotation, migration of existing rows). Encrypting at rest is therefore a hardening item owned by PLT-12 (security baseline) and ERP5-09 (authorization and sensitive-field protection), not a schema-slot-01 decision.
- **Status**: accepted for V1 — escalated to the maintainer as an open divergence between the SDS and the Master Architecture Spec. If the maintainer prefers encryption at rest, this is a follow-up migration (not a rewrite): add `salary_enc`, backfill from `salary`, and drop the plaintext column in the same forward migration.

### DR-3 — `erp5_users` is a projection, not an ERP-5 table

- **Conflict**: SDS §4.7 lists `erp5_users` in the ERP-5 table list; the Master Architecture Spec C3 states that `erp5_users` is a read-only projection/view over Hub Identity.
- **Decision**: ERP-5 creates **no** `erp5_users` table. The module exposes `erp5.identity_users`, a read-only view over `platform.hub_users` with no credential column and no write path, and the module API reads identity data through the owning platform API/projection.
- **Rationale**: HR does not own users, does not store credentials and does not grant application roles (FR-ERP5-05, standardisation plan §8 rule 7).

### DR-4 — Payroll aggregate table name

- **Gap**: the SDS names no table for FR-ERP5-06.
- **Decision**: `erp5.payroll_totals`, following the module's `erp5_` prefix convention and the `erp5_` table names frozen by the Master Architecture Spec §6.1.
- **Status**: naming proposal — flagged for maintainer confirmation in the PR.

### DR-5 — V1 masks the salary for every caller of the mutation API

- **Conflict**: BR-ERP5-02 says the salary is "masked **for viewers**", and the OpenAPI contract merged with ERP5-01 documented the privileged `Employee` schema (raw `salary`) as the response of `POST /employees` and `PATCH /employees/{id}`. The **central matrix merged with PLT-06** (issue #61, `packages/core/src/auth/permissions.ts` → `SENSITIVE_FIELDS.SALARY`, `maskSensitiveFields`) states the platform rule "**Salary: visible to Admin only; masked for Viewer, Editor, Analyst and Migration Runner**", and the route policy `hr.read` is described as "Read employee records (salaries masked for non-admin)". V1, however, defines **no** ERP-5 rule that names the privileged representation, and the shared RBAC matrix (`packages/rbac`) exposes `module.read` / `module.write` only — there is no salary capability to gate on.
- **Decision**: every employee response of the V1 mutation API uses the masked `HrEmployeeView` projection (`salary_display` = `XX,XXX`). The raw `salary` column never leaves the service layer, for **any** role, including Admin. The privileged `Employee` schema stays in the OpenAPI document as the *internal* representation and is referenced by no endpoint.
- **Rationale**: BR-ERP5-02 names only `XX,XXX` and `salary hidden` as the permitted representations of the salary, so the stricter of the two readings is the one the ERP-5 rule can be verified against by an automated test. A module that discloses *less* than the platform matrix permits never violates the matrix; the opposite would violate BR-ERP5-02. The divergence from PLT-06 is recorded here and escalated rather than resolved silently in code.
- **Status**: **open** — escalated to the maintainer in PR #226 (ERP5-03). If the maintainer prefers the PLT-06 reading, the follow-up is an Admin-only privileged projection (`salary` instead of `salary_display`), which needs an approved ERP-5 contract change and a dedicated test. Until then the module stays on the strict side of the conflict.

### DR-6 — Import provenance is a triple

- **Conflict**: the issue requires `batch_id`, `source_row` and an `Idempotency-Key` for import writes, and the Master Architecture Spec fixes the stable idempotency key as *batch id + source row + target entity/schema version*. It does not say what happens when only part of the triple is present.
- **Decision**: the three fields travel together. A request that carries any of them but not all of them is rejected with `400 HR_IMPORT_PROVENANCE_REQUIRED`. The receipt is written in the same transaction as the target mutation, and a repeated request with the same key returns the original receipt and the original row (`200`) without a second mutation.
- **Rationale**: an idempotency key without a batch and a source row cannot produce a durable receipt, so honouring it silently would be a lie. Rejecting it is deterministic and observable.

### DR-7 — Source-identity fields are import-only

- **Conflict**: `erp5.employees` carries `source_system` and `source_id` (DR-1), and the partial UNIQUE index on them is the stable source identity for migration loads. A browser write could otherwise claim a source identity.
- **Decision**: `source_system` and `source_id` may only be set by a request that carries the full import provenance of DR-6. A browser write that carries them is rejected with `400 HR_PROTECTED_FIELD`. `id`, `created_at` and `updated_at` are never writable at all, and `currency_code` is accepted on create (default `INR`) but is immutable afterwards.
- **Rationale**: it satisfies "never accept protected/system-maintained fields as authoritative from a browser" without removing the Migration Kit's ability to record the source identity of a loaded row.

### DR-8 — The write service depends on a repository contract, not on Drizzle

- **Conflict**: issue #48 (`ERP5-03`) and issue #47 (`ERP5-02`) both name `apps/erp/modules/erp-5/src/services/*.ts`. The canonical slot plan assigns the *repository/query layer* to slot 02 and the *create/update API* to slot 05; this issue is slot 05, and `ERP5-02` is still open.
- **Decision**: ERP5-03 owns the **repository contract** (`HrRepository` in `src/services/repository.ts`) and a deterministic in-memory implementation used by the mutation tests. ERP5-02 owns the **Drizzle implementation** of the same interface plus the list/read queries. The mutation service depends on the interface only, so the Drizzle repository can be dropped in without touching a single service rule.
- **Rationale**: it keeps the two issues from forking the data layer, and it keeps the mutation rules testable without a live database. The transaction boundary (`HrRepository.transaction`) is part of the contract, so the Drizzle implementation must commit the target mutation and the import receipt in one PostgreSQL transaction.
- **Status**: open — the hand-over is stated explicitly in PR #226 so that ERP5-02 can be implemented on top of it.

### DR-9 — Write authorization follows the central matrix of PLT-06

- **Conflict**: the module write gate could be the coarse `module.write` capability of `packages/rbac` (Editor, Admin) or the finer role/action/resource matrix that **PLT-06** (issue #61) merged while this issue was in flight. PLT-06 declares the ERP-5 route policies `hr.mutate` (Editor, Admin — employee master records) and `hr.payroll_bulk` (Migration Runner, Admin — bulk load of payroll totals) in `apps/hub/src/policies/route-policy.ts`, and the resource matrix in `packages/core/src/auth/permissions.ts`. PLT-06 has **no** resource for departments or leave, and it grants no `CREATE` on `payroll` to any role.
- **Decision**:
  - Employees, departments and leave use the shared `module.write` capability guard (`requireCapability(Capabilities.MODULE_WRITE)`). The holders of that capability are exactly Editor and Admin — the same role set as PLT-06's `hr.mutate`.
  - The payroll aggregate uses the **central matrix itself** (`hasPermission` from `@cs/core` on the `payroll` resource), which yields Migration Runner (`EXECUTE_BULK`) and Admin (`UPDATE`). The check is expressed with the shared matrix, not with a local role list, so the module cannot drift from the platform policy.
  - The module owns **no** role list and **no** permission table of its own.
- **Rationale**: the Migration Kit is the producer of the department/month aggregates (FR-ERP5-06). A gate that only admits Editor and Admin would make the import path of issue #48 unusable for the Kit, so the payroll load follows the platform's `hr.payroll_bulk` policy.
- **Open item**: PLT-06 declares no policy for the **identity the Kit uses to load employee, department and leave rows**. The module grants those writes to any holder of the shared `module.write` capability, which today means Editor and Admin; a platform-issued Kit service identity (or a `hr.employee_bulk` policy) is needed to close the gap. This is escalated to **ERP5-15** (module authorization policy integration) and to the PLT-06 owner.
- **Status**: open — escalated in PR #226.

### DR-10 — The V1 leave state transition

- **Conflict**: issue #51 (`ERP5-06`) requires "the allowed state transitions" and "state transition tests cover each allowed transition and each forbidden transition", but the leave **request → approve/reject workflow with a log** is `FR-ERP5-10`, which the SDS places in **Part V2** (§5.2) and which issue #51 lists under "Out of Scope: V2/V3-only capability".
- **Decision**: V1 exposes the **state transition only** — `pending → approved | rejected`; `approved` and `rejected` are **terminal** (a decision is never reversed and a leave is never un-decided); setting the same status again is an idempotent no-op, not an error. It is exposed as `PATCH /api/v1/erp-hr/leave/{id}`. There is **no** request step, **no** approval log and **no** notification — those belong to FR-ERP5-10 in V2. A forbidden transition is answered with `422 HR_INVALID_LEAVE_STATUS_TRANSITION` and the allowed set in the message.
- **Rationale**: the leave status is the only stateful field of the V1 ERP-5 data model (`erp5.leave.status`; the other three tables have no status column), and FR-ERP5-04 makes it a V1 field. The state matrix is therefore a V1 rule; the *workflow* is not.
- **Status**: **open** — escalated in PR #231 (ERP5-06). If the maintainer prefers V1 immutability, the endpoint is deleted and the matrix collapses to a single state (the change is confined to one route, one service method and one contract schema).

### DR-11 — The payroll aggregate is authoritative as loaded

- **Conflict**: issue #51 requires that "derived display values and **report totals** are computed from authoritative persisted state". The only ERP-5 report is the department/month payroll aggregate, which would suggest recomputing it from the employee rows (`sum(erp5.employees.salary)`).
- **Decision**: the module does **not** recompute the amount. The aggregate is the number of the customer's payroll system, loaded through the Migration Kit (FR-ERP5-06: "one number per department, **no personal data**"), and it is authoritative **as loaded**. The module validates it against its own invariants (the department exists, the month label is valid, the amount and headcount are non-negative, one aggregate per department and month) and reads the persisted row back. The **display** values — the department link, the month label, the status and the headcount — are always derived from the persisted rows, never from the request payload.
- **Rationale**: recomputing the total from the employee rows would (a) replace the source system's number with a different one, (b) make the load order significant — the aggregate could not be loaded before the employees — and (c) put a per-employee sum behind an aggregate that must not carry personal data.
- **Status**: **open** — escalated in PR #231 (ERP5-06).

### DR-12 — The cross-module resolver denies what it cannot prove

- **Defect found in the ERP5-03 output**: `Erp5ReferenceResolver.exists()` answered "yes" for **every** employee, department and leave id, and `get()` returned a fabricated summary (`EMP-001`, `dept-engineering`). A sibling module or the Kit that resolved a reference through the module facade would therefore have been told that a non-existent record exists, and could have built a dangling reference that only the foreign key would catch — as a `500`, not as a clean `404`.
- **Decision**: the resolver validates against the `HrRepository` (`createErp5Resolver(repository)`) and **denies every existence check when it has no data source** (default deny, PLT-06's non-negotiable invariant). The facade keeps a repository-less instance for the module definition; the platform bootstrap constructs the repository-backed one once the Drizzle repository of ERP5-02 exists.
- **Status**: accepted for V1 — flagged for maintainer confirmation in PR #231.

### DR-13 — The ERP-5 list response keeps its published `{data, meta}` shape

- **Conflict**: three collection shapes exist in the repository — the ERP-5 contract published with ERP5-01 (`{data, meta}`, `HrListMetaSchema`), the ERP-4 list API (`{data, total, page, pageSize, totalPages}`) and the **PLT-04** shared factory `createPaginatedResponseSchema` (`{items, page, pageSize, total, totalPages}`). PLT-04's acceptance criterion says "Every shared schema is imported by server routes instead of duplicated ad hoc", which points at the shared factory.
- **Decision**: ERP-5 keeps the `{data, meta}` shape it published in ERP5-01. The Zod contract (`HrListMetaSchema`, `hrListResponseSchema`) and the OpenAPI (`EmployeeListResponse`, `DepartmentListResponse`, …) already carry it, and no client consumes the endpoint yet, so changing it would churn a published contract for no consumer benefit.
- **Rationale**: harmonising the three shapes is a **platform-wide** change — it touches ERP-4 and every module contract, and it is owned by PLT-04 / PLT-14, not by a module issue. Doing it inside ERP5-02 would make ERP-5 the first module to migrate and leave the others behind, which is a programme decision rather than a module one.
- **Status**: open — escalated in PR #232 (ERP5-02). The pagination **rules** (1-based `page`, `pageSize` 1..100, default 25, the allow-listed sort fields, the deterministic `id` tie-breaker) are identical in all three shapes — only the envelope differs.


---

## 11. Migration & Verification

- **Migration file**: `packages/database/migrations/erp5_v1.sql` — guarded, forward-only, idempotent. It creates the `erp5` schema, the two enum types, the five tables, the indexes, the check and unique constraints, the foreign keys, the `updated_at` trigger function and triggers, the read-only identity view and the `schema_migrations` ledger entry.
- **Runner**: `packages/database/scripts/migrate.js` (the controlled migration job). It applies each file once and records it in `public.schema_migrations`; a second run skips the file instead of reapplying it.
- **Commands**:
  ```bash
  npm run db:migrate                                              # apply
  npm run db:migrate                                              # re-run — "already applied", skipped
  DATABASE_URL_TEST=postgresql://user:pass@localhost:5432/postgres \
    npx vitest run apps/erp/modules/erp-5                        # live constraint proofs
  ```
- **Automated proofs**: `apps/erp/modules/erp-5/tests/db/schema.test.ts` (DDL ↔ Drizzle parity, constraint inventory, ownership boundary) and `apps/erp/modules/erp-5/tests/db/schema.integration.test.ts` (live PostgreSQL: SQLSTATE 23505 / 23514 / 23503 / 42501, read-only projection, trigger behaviour). The integration suite creates and drops its own throwaway database and never touches a developer or production database.

---

## 12. Mutation API (ERP5-03)

**Issue**: [#48](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/48) — `[ERP5-03] Mutation API and domain validation`
**Contract**: `packages/contracts/openapi/erp-5.yaml` · `packages/contracts/src/erp-5.ts`
**Dependencies**: ERP5-01 (schema — merged) · PLT-04 (shared error envelope and standard error codes — merged while this issue was in flight; the module consumes `ErrorEnvelopeSchema`, `ErrorDetail` and `StandardErrorCodes` from `@clearshift/contracts`) · ERP5-02 (list/read API — still open; the `HrRepository` contract of DR-8 is the hand-over point)

### 12.1 Endpoints

| Method | Endpoint | Entity written | Domain rules enforced |
|---|---|---|---|
| `POST` | `/api/v1/erp-hr/employees` | `erp5.employees` | unique `employee_no`, unique source identity, existing department, BR-ERP5-01, non-negative salary |
| `PATCH` | `/api/v1/erp-hr/employees/{id}` | `erp5.employees` | unique `employee_no`, existing department, BR-ERP5-01 against the **stored** dates |
| `POST` | `/api/v1/erp-hr/departments` | `erp5.departments` | unique `code`, existing parent |
| `PATCH` | `/api/v1/erp-hr/departments/{id}` | `erp5.departments` | unique `code`, existing parent, no self-parent, acyclic hierarchy |
| `POST` | `/api/v1/erp-hr/leave` | `erp5.leave` | valid date range, existing employee, approved type/status |
| `PATCH` | `/api/v1/erp-hr/leave/{id}` | `erp5.leave` | the V1 state matrix (§13.3), re-validated date range and type, immutable subject |
| `POST` | `/api/v1/erp-hr/payroll-totals` | `erp5.payroll_totals` | one aggregate per department/month, existing department, no employee rows |

The list/read endpoints belong to **ERP5-02** (issue #47) and are not implemented here.

### 12.2 Layering

```
HTTP request
  └─ Fastify route (apps/erp/modules/erp-5/src/routes/*)
       ├─ Zod validation at the route boundary   → 400 / 422
       ├─ shared RBAC guard (module.write)       → 401 / 403
       └─ HrService (src/services/hr.service.ts)
            ├─ domain rules (src/domain/rules.ts)      → 422
            ├─ uniqueness / existence checks           → 409 / 404
            └─ HrRepository.transaction(...)
                 ├─ target mutation
                 └─ erp5.import_receipts receipt (same transaction)
  └─ PostgreSQL constraints (second line of defence)
```

### 12.3 Error envelope

Every failure is rendered with the **shared** platform envelope owned by PLT-04
(`packages/contracts/src/common.ts` → `ErrorEnvelopeSchema` / `FlatErrorEnvelopeSchema`,
mirrored by `@cs/kernel` → `ErrorEnvelopeSchema`): `{code, message, details, correlation_id}`.
The module never defines a second envelope. The `x-correlation-id` request header is echoed;
when it is missing a UUID is generated.

| Status | When | Example `code` |
|---|---|---|
| `400` | malformed request, unknown key, protected field, incomplete import provenance | `VALIDATION_ERROR`, `HR_PROTECTED_FIELD`, `HR_IMPORT_PROVENANCE_REQUIRED` |
| `401` | no / invalid bearer token | `UNAUTHORIZED` |
| `403` | the caller has no `module.write` capability | `FORBIDDEN` |
| `404` | the addressed or referenced record does not exist | `NOT_FOUND`, `HR_DEPARTMENT_REQUIRED`, `HR_EMPLOYEE_REQUIRED` |
| `409` | duplicate key or idempotency conflict | `HR_EMPLOYEE_NO_DUPLICATE`, `HR_DEPARTMENT_CODE_DUPLICATE`, `HR_PAYROLL_TOTAL_DUPLICATE`, `HR_IDEMPOTENCY_CONFLICT` |
| `422` | invalid business value | `HR_JOIN_DATE_AFTER_BIRTH_DATE`, `HR_LEAVE_DATE_RANGE_VALID`, `HR_SALARY_NON_NEGATIVE`, `HR_DEPARTMENT_SELF_PARENT`, `HR_DEPARTMENT_CYCLE` |
| `500` | unexpected failure — correlation id only, never a SQL statement, a stack trace, a secret or a raw row | `INTERNAL_SERVER_ERROR` |

### 12.4 Authorization

The module owns **no** role list and **no** permission table. It consumes the platform primitives:

| Write | Gate | Allowed roles | Source |
|---|---|---|---|
| employees, departments, leave | `requireCapability(Capabilities.MODULE_WRITE)` | Editor, Admin | shared capability matrix (`packages/rbac`); the same role set as PLT-06's `hr.mutate` |
| payroll totals | `hasPermission(roles, …, Resources.PAYROLL)` | Migration Runner, Admin | central matrix (`packages/core`, PLT-06) — `hr.payroll_bulk` |

Viewer and Analyst receive `403` on every write. The Migration Kit loads a payroll
aggregate through this module's public API as MIGRATION_RUNNER and can never write into
the `erp5` tables directly (Decision C7). The residual gap — the identity the Kit uses to
load employee, department and leave rows — is recorded in [DR-9](#dr-9--write-authorization-follows-the-central-matrix-of-plt-06).

### 12.5 Privacy and protected fields (BR-ERP5-02)

- The employee write response is the masked `EmployeeView` projection. The raw `salary`
  column never leaves the service layer and never appears in a log, an error payload or
  an import receipt (DR-5).
- `id`, `created_at`, `updated_at` are never writable. `currency_code` is accepted on
  create (default `INR`) and immutable afterwards. `source_system` and `source_id` are
  import-only (DR-7). A payload that carries any of them is rejected with
  `400 HR_PROTECTED_FIELD`.
- A payload that carries a credential (`password`, `token`, `roles`, …) is rejected with
  `400 HR_CREDENTIALS_FORBIDDEN` — HR stores no credentials and grants no application
  roles (Master Architecture Spec C3).
- A payroll aggregate that carries an employee-level field is rejected with
  `400 HR_PROTECTED_FIELD` (FR-ERP5-06).

### 12.6 Import / load writes (KIT-08)

An import write supplies `batch_id`, `source_row` and an `Idempotency-Key` **together**
(DR-6). The receipt is written in the same transaction as the target mutation, so a
receipt can never exist without its row and a row can never exist without its receipt.
A repeated request with the same idempotency key returns the original row and the
original receipt with `200 OK` and performs **no** second mutation. The same key with a
different payload is answered with `409 HR_IDEMPOTENCY_CONFLICT`.

### 12.7 Test evidence

| Suite | Level | Coverage |
|---|---|---|
| `apps/erp/modules/erp-5/tests/services/hr.service.test.ts` | service | every invariant with a valid and an invalid input, the transaction rollback, the concurrency replay |
| `apps/erp/modules/erp-5/tests/api/mutations.test.ts` | API | validation, authorization, status mapping, protected fields, import receipts, correlation id, sanitised 500 |
| `apps/erp/modules/erp-5/tests/contracts/erp-5.contract.test.ts` | contract | the Zod contract, the stable business-rule codes, the masked response schemas |
| `apps/erp/modules/erp-5/tests/contracts/erp-5.openapi.test.ts` | contract | every `$ref` resolves, every write route is documented, unknown properties are forbidden |
| `apps/erp/modules/erp-5/tests/db/schema.integration.test.ts` | database | the PostgreSQL constraints that back the same invariants (live PostgreSQL) |

---

## 13. Relationships, state transitions and read model (ERP5-06)

**Issue**: [#51](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/51) — `[ERP5-06] Relationships, state transitions and read-model consistency`
**Domain layer**: `apps/erp/modules/erp-5/src/domain/relationships.ts` (pure — no I/O)

### 13.1 Relationship map

| From | To | Cardinality | Rule | Failure |
|---|---|---|---|---|
| `employees.department_id` | `departments.id` | exactly one, required | the department must exist | `404 HR_DEPARTMENT_REQUIRED` |
| `leave.employee_id` | `employees.id` | exactly one, required | the employee must exist | `404 HR_EMPLOYEE_REQUIRED` |
| `payroll_totals.department_id` | `departments.id` | exactly one, required | the department must exist | `404 HR_DEPARTMENT_REQUIRED` |
| `departments.parent_id` | `departments.id` | zero or one, **optional** | the parent must exist; no self-parent; no cycle | `404` / `422 HR_DEPARTMENT_SELF_PARENT` / `422 HR_DEPARTMENT_CYCLE` |
| `employees.(source_system, source_id)` | the source system | zero or one, **optional pair** | both or neither | `400 HR_SOURCE_IDENTITY_INCOMPLETE` / `400 HR_PROTECTED_FIELD` |
| `identity_users.employee_ref` | `employees.id` | zero or one, **optional, read-only** | the Hub owns the link; ERP-5 never writes it | — |

Every required relationship is validated **before** the mutation, inside the same transaction as the write. A rejected reference therefore leaves **no** partial mutation — the target row is not written and the import receipt is not written.

### 13.2 Optional relationships — the approved warning

An absent **optional** relationship is reported as a warning, never as an invented record:

```json
{
  "relationship": "DEPARTMENT_PARENT",
  "field": "parent_id",
  "code": "HR_OPTIONAL_REFERENCE_ABSENT",
  "message": "Optional relationship \"DEPARTMENT_PARENT\" on field \"parent_id\" is absent. No synthetic record was created."
}
```

The warning travels in the `warnings` array of the mutation response. A root department therefore reports "this department has no parent" without the module fabricating a parent row.

### 13.3 The leave state matrix

`erp5.leave.status` is the only stateful field of the V1 ERP-5 data model.

| From | To | Allowed | Reason |
|---|---|---|---|
| `pending` | `approved` | ✅ | the decision |
| `pending` | `rejected` | ✅ | the decision |
| `pending` | `pending` | ✅ (no-op) | idempotent, carries no state change |
| `approved` | `rejected` | ❌ | a decision is never reversed |
| `approved` | `pending` | ❌ | a leave is never un-decided |
| `approved` | `approved` | ✅ (no-op) | idempotent |
| `rejected` | `approved` | ❌ | a decision is never reversed |
| `rejected` | `pending` | ❌ | a leave is never un-decided |
| `rejected` | `rejected` | ✅ (no-op) | idempotent |

A forbidden transition is answered with `422 HR_INVALID_LEAVE_STATUS_TRANSITION`; the message names the allowed set. The request → approve/reject **workflow with a log** (FR-ERP5-10) is a **V2** capability and is not exposed — see [DR-10](#dr-10--the-v1-leave-state-transition).

The recorded subject of a leave — the employee it belongs to — is **immutable**: a leave is a fact about one employee and is never re-parented. `date_from`, `date_to` and `type` stay editable and are re-validated.

### 13.4 Read model

The response of a write is built from the **persisted row**, never from the request payload, and the row is asserted against the read model of its entity before it is returned:

| Entity | Read-model assertion |
|---|---|
| employee | the mandatory links are present, `join_date >= birth_date`, the salary is a valid decimal |
| department | the code is present, the row is not its own parent |
| leave | the employee link is present, `date_to >= date_from`, the type and the status are approved values |
| payroll total | the department link is present, the month label is valid, the amount and the headcount are non-negative |

The read model is what makes the UI and the read API agree with the database immediately after a successful write — the status, the links and the derived totals a client sees are the ones the database holds.

### 13.5 Cross-module boundary

`Erp5ReferenceResolver` is the module's published surface for *other* modules and the Migration Kit (Decision C7: cross-module data is read through the owning module's API, never by writing into the `erp5` tables).

| Call | Answer |
|---|---|
| `exists('employee', <existing id>)` | `true` |
| `exists('employee', <unknown id>)` | `false` |
| `exists('<unknown entity>', <any id>)` | `false` |
| `get('employee', <unknown id>)` | `null` |
| `exists(...)` with **no repository** | `false` — default deny (PLT-06) |

The resolver never confirms a record it cannot prove exists — see [DR-12](#dr-12--the-cross-module-resolver-denies-what-it-cannot-prove).

### 13.6 Test evidence

| Suite | Level | Coverage |
|---|---|---|
| `apps/erp/modules/erp-5/tests/domain/relationships.test.ts` | domain | the optional-reference warning, the enumerations, every allowed and forbidden transition, the read model, the source identity |
| `apps/erp/modules/erp-5/tests/services/hr.relationships.test.ts` | service | the relationship failures with no partial write, the state matrix, the warning, the read-back |
| `apps/erp/modules/erp-5/tests/api/state-transitions.test.ts` | API | the transitions over HTTP, the error envelope, the resolver, the no-partial-mutation proof |

---

## 14. Query layer — list and read API (ERP5-02)

**Issue**: [#47](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/47) — `[ERP5-02] List/read API with bounded paging and OpenAPI contract`
**Implementation**: `apps/erp/modules/erp-5/db/repository.ts` — the Drizzle implementation of the `HrRepository` contract

### 14.1 Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/erp-hr/employees` | List employees — search, department filter, allow-listed sort |
| `GET` | `/api/v1/erp-hr/employees/{id}` | Read one employee (masked projection) |
| `GET` | `/api/v1/erp-hr/departments` | List departments — search, parent filter, allow-listed sort |
| `GET` | `/api/v1/erp-hr/departments/{id}` | Read one department |
| `GET` | `/api/v1/erp-hr/leave` | List leave records — employee, type and status filters |
| `GET` | `/api/v1/erp-hr/leave/{id}` | Read one leave record |
| `GET` | `/api/v1/erp-hr/payroll-totals` | List department/month aggregates — month and department filters |
| `GET` | `/api/v1/erp-hr/payroll-totals/{id}` | Read one aggregate |
| `GET` | `/api/v1/erp-hr/identity-users` | The read-only Hub Identity projection |

Reads require the shared `module.read` capability (Viewer, Editor, Analyst, Admin).

### 14.2 The paging contract

| Rule | Value |
|---|---|
| `page` | 1-based, minimum 1, default 1 |
| `pageSize` | 1..100, default 25 — a larger request is `400` |
| Ordering | the allow-listed sort field, then the `id` as the deterministic tie-breaker |
| Response | `{ data: [...], meta: { page, pageSize, total, totalPages } }` |
| `totalPages` | `0` for an empty collection |

The allow-listed sort fields are `name` / `employee_no` / `join_date` for the employees and
`name` / `code` for the departments. A sort field outside the list is `400`.

### 14.3 Server-side, parameterised, bounded

The search and the filter are applied **in the database** — never by string-building SQL.
The live proof (`tests/db/repository.integration.test.ts`) searches for
`'; DROP TABLE erp5.employees; --` and shows that it is treated as text: no row matches and
the table is still there.

No collection is ever returned unbounded: every query carries a `LIMIT` and an `OFFSET`, and
the `total` is counted with a separate, equally parameterised count query.

### 14.4 The Hub Identity projection

`erp5.identity_users` is a **view** over `platform.hub_users`, owned by the platform. The
module reads it and never writes it.

- The projection is created by the migration **only when `platform.hub_users` exists**. When
  it is absent the read degrades to an **empty page** — the HR module stays available.
- The projection carries no credential, hash, token or refresh-token column; the write
  privileges are revoked from `PUBLIC` by the migration, and the live proof shows the write
  refused with SQLSTATE `42501` for an application role.
- A Hub user without a linked employee is returned with `employee_ref: null` — no employee
  row is invented for it.

### 14.5 Test evidence

| Suite | Level | Coverage |
|---|---|---|
| `apps/erp/modules/erp-5/tests/api/list.test.ts` | API | paging, search, filters, the sort allow-list, the page-size cap, the empty result, the salary mask, the projection shape, `404` / `400` / `401` / `403` |
| `apps/erp/modules/erp-5/tests/db/repository.integration.test.ts` | database | the Drizzle write path, the parameterised server-side search, the bounded deterministic pages, the transaction commit and rollback, the read-only projection, the read model (live PostgreSQL) |
