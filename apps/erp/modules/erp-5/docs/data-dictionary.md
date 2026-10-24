# ERP-5 HR & Employees — Data Dictionary

**SDS Reference**: ClearShift ERP v2.0, §4.6 (FR-ERP5-01..06, BR-ERP5-01..02), §4.7 (ERP-5 tables)
**Architecture Reference**: ClearShift V1 Master Architecture Spec, §C3 (identity ownership), §5 (ERD), §6.1 (slot 01)
**Module**: ERP-5 HR & Employees (Group 10)
**Issue**: [#46](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/46) — `[ERP5-01] Schema, Drizzle models and guarded migrations`
**Mutation API Issue**: [#48](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/48) — `[ERP5-03] Mutation API and domain validation`
**Relationship Issue**: [#51](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/51) — `[ERP5-06] Relationships, state transitions and read-model consistency`
**Read API Issue**: [#47](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/47) — `[ERP5-02] List/read API with bounded paging and OpenAPI contract`
**Authorization Issue**: [#191](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/191) — `[ERP5-15] Module authorization policy integration`
**PostgreSQL Schema**: `erp5`
**API Base**: `/api/v1/erp-hr`
**Version**: V1.4

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
15. [Authorization policy (ERP5-15)](#15-authorization-policy-erp515)
16. [Collection screens (ERP5-04)](#16-collection-screens-erp504)
17. [Create, edit and detail screens (ERP5-05)](#17-create-edit-and-detail-screens-erp505)
18. [Canonical Field-Level Data Dictionary & Entity Index](#18-canonical-field-level-data-dictionary--entity-index)
19. [Comprehensive Entity-Relationship Diagram (ERD) & Ownership Boundaries](#19-comprehensive-entity-relationship-diagram-erd--ownership-boundaries)
20. [Requirement-to-Test Traceability Matrix](#20-requirement-to-test-traceability-matrix)
21. [Canonical Dirty Data Pack Plan & Synthetic Defect Distribution](#21-canonical-dirty-data-pack-plan--synthetic-defect-distribution)
22. [Gate G1 Review & Governance Sign-Off](#22-gate-g1-review--governance-sign-off)

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

### DR-14 — The object-level guard enforces module ownership, not tenancy

- **Conflict**: issue #191 requires "object-level authorization guards prevent unauthorized **multi-tenant** or cross-user record mutations". The `erp5` schema has **no** organisation, tenant or owner column — `erp5.employees`, `erp5.departments`, `erp5.leave` and `erp5.payroll_totals` carry no such attribute, and every record belongs to the single organisation the module serves.
- **Decision**: the object-level guard enforces **module ownership**: the policy is bound to an entity kind, the identifier of a request is always resolved inside the table that belongs to the route, and an identifier that belongs to another module resolves to nothing and is refused with `404`. A forbidden request is refused with `403` before the record is loaded, so a caller that may not write cannot learn whether a record exists. The guard does **not** pretend to implement a tenancy dimension that the schema does not have.
- **Rationale**: inventing a tenant scope in the API without a tenant column would be a policy the database cannot enforce — the check would live only in the request path and could not be proven. The limitation is stated instead of being approximated.
- **Status**: open — escalated in PR #239 (ERP5-15). A multi-tenant dimension is a **schema** item (an organisation column on every module table, plus a foreign key to the owning organisation) and belongs to a migration issue, not to an authorization issue.

### DR-15 — The Kit's write identity for the master records (closes DR-9)

- **Conflict**: DR-9 (raised in PR #226 and repeated in PR #231) recorded that the central matrix of PLT-06 declares no policy for the **identity the Migration Kit uses to load employee, department and leave rows**. The Kit loads a payroll aggregate as MIGRATION_RUNNER (`hr.payroll_bulk`), but the master records are `hr.mutate` — Editor and Admin.
- **Decision**: the module declares the policy it can prove and grants no more: the master-record loads require `hr.mutate` (Editor, Admin) and the payroll load requires `hr.payroll_bulk` (Migration Runner, Admin). The module does **not** invent a Kit-only role, and it does **not** widen `hr.mutate` to the Migration Runner — that would grant the Kit write access to the whole HR master data, which no approved policy asks for.
- **Rationale**: the gap is a **platform** policy gap, not a module one: the platform must either issue a service identity that holds `module.write` for the Kit, or add an `hr.employee_bulk` policy to the central matrix. Until then the module stays on the declared policy, and the load of a payroll aggregate — the Kit's own job — works.
- **Status**: open — escalated to the PLT-06 owner and **ERP5-15** in PR #239 (ERP5-15). The payroll half of the gap is closed by this issue; the master-record half needs a platform decision.


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

---

## 15. Authorization policy (ERP5-15)

**Issue**: [#191](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/191) — `[ERP5-15] Module authorization policy integration`
**Declaration**: `apps/erp/modules/erp-5/src/policies/permissions.ts` · **Guard**: `src/policies/guard.ts`
**Security note**: [`apps/erp/modules/erp-5/docs/security.md`](./security.md)

### 15.1 The declared matrix

The module owns **no** role list. Every route is bound to one entry of
`HR_ROUTE_POLICIES`, and the role sets mirror the central matrix of PLT-06:

| Policy | Entity | Roles | Central policy |
|---|---|---|---|
| `hr.employees.read` | employee | Viewer, Editor, Analyst, Admin | `hr.read` |
| `hr.employees.create` | employee | Editor, Admin | `hr.mutate` |
| `hr.employees.update` | employee | Editor, Admin | `hr.mutate` |
| `hr.departments.read` | department | Viewer, Editor, Analyst, Admin | `hr.read` |
| `hr.departments.create` | department | Editor, Admin | `hr.mutate` |
| `hr.departments.update` | department | Editor, Admin | `hr.mutate` |
| `hr.leave.read` | leave | Viewer, Editor, Analyst, Admin | `hr.read` |
| `hr.leave.create` | leave | Editor, Admin | `hr.mutate` |
| `hr.leave.update` | leave | Editor, Admin | `hr.mutate` |
| `hr.payroll.read` | payroll_total | Viewer, Editor, Analyst, Admin | `hr.read` |
| `hr.payroll.load` | payroll_total | **Migration Runner**, Admin | `hr.payroll_bulk` |
| `hr.identity_users.read` | identity_user | Viewer, Editor, Analyst, Admin | `hr.read` |

**Invariant: DEFAULT DENY.** A route without a declared policy, an unknown policy or an
unlisted role is refused with `403`.

The Migration Runner has **no read** access to the HR master data — it may load a payroll
aggregate (its declared job) and nothing else, and it can never write into the `erp5`
tables directly (Decision C7).

### 15.2 Authentication

A real access token is verified with the shared Hub verifier of PLT-05 — the EdDSA
signature, the issuer, the audience and the expiry are all checked, and a disabled account
is refused. The module never derives a role from an unverified token: the role set always
comes from the verified claims. When the platform mounts the module, its own
authentication has already populated `request.user` and the module leaves it untouched.

### 15.3 The object-level guard

The policy is bound to an **entity kind** and the identifier of a request is always
resolved inside the table that belongs to the route:

| Attempt | Result |
|---|---|
| A leave id read as an employee | `404` — it is not an employee |
| A Hub Identity user id patched as an employee | `404` — it is not an ERP-5 record, and nothing is mutated |
| A forbidden write of a record that does not exist | `403` — the role is refused before the record is loaded, so nothing is revealed |

ERP-5 has **no tenant and no per-user ownership dimension** in V1 — see
[DR-14](#dr-14--the-object-level-guard-enforces-module-ownership-not-tenancy).

### 15.4 Test evidence

| Suite | Coverage |
|---|---|
| `apps/erp/modules/erp-5/tests/security/authorization.test.ts` | the declared matrix, the route × role matrix (16 routes × 5 roles), the JWT verification (real, forged, tampered, expired, disabled) and the object-level guard |
| `apps/erp/modules/erp-5/tests/api/mutations.test.ts` | the write authorization per endpoint |
| `apps/erp/modules/erp-5/tests/api/list.test.ts` | the read authorization per collection |

---

## 16. Collection screens (ERP5-04)

**Issue**: [#49](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/49) — `[ERP5-04] ERP-5 HR and Employees: List screen, search/filter and stable empty/loading/error states`
**Implementation**: `apps/erp/modules/erp-5/web/src/` — the API client, the shared list
machinery and the five collection screens
**Route registration**: [ERP5-16](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/192) —
issue #192

### 16.1 The screens and the endpoint each one reads

| Screen | Route | Endpoint | Rows |
|---|---|---|---|
| Employee list | `/erp5/employees` | `GET /api/v1/erp-hr/employees` | `HrEmployeeView` |
| Department list | `/erp5/departments` | `GET /api/v1/erp-hr/departments` | `HrDepartment` |
| Leave record list | `/erp5/leave` | `GET /api/v1/erp-hr/leave` | `HrLeave` |
| Payroll total list | `/erp5/payroll-totals` | `GET /api/v1/erp-hr/payroll-totals` | `HrPayrollTotal` |
| Identity user list | `/erp5/identity-users` | `GET /api/v1/erp-hr/identity-users` | `HrIdentityUser` |

### 16.2 The columns each screen shows

Every column is a field the contract already returns. The screen adds no field and
invents no value.

| Screen | Columns |
|---|---|
| Employee list | `employee_no`, `first_name`, `last_name`, `birth_date`, `join_date`, department, `job_title`, `salary_display` + `currency_code`, action |
| Department list | `code`, `name`, parent department, action |
| Leave record list | `employee_id`, `date_from`, `date_to`, `type`, `status`, action |
| Payroll total list | `department_id`, `month`, `total_amount`, `currency_code`, `headcount` |
| Identity user list | `username`, `roles`, `employee_ref`, `status` |

**The salary column shows `salary_display`, never `salary`.** The raw column is absent
from the public projection (BR-ERP5-02), so the browser cannot render it even if it
wanted to. The frontend test asserts the masked values and nothing else.

**The department and the employee references are resolved by identifier.** The API
returns `department_id` and `employee_id` and never a name. The module reads the bounded
department collection (at most `HR_PAGE_SIZE_MAX`, 100 rows) to resolve a department to
its name; a department outside that page is shown as a short identifier, never as an
invented name. The leave list resolves no employee at all — the employee collection is
not bounded — so the leave screen links to the employee record and carries the
identifier.

### 16.3 The server does the filtering, the sorting and the paging

The browser never narrows, orders or pages a collection. The screen sends the search
term, the filters, the sort field and the page to the API and renders exactly the page
the API answered.

| Screen | Query parameters it sends |
|---|---|
| Employee list | `page`, `pageSize`, `search`, `department_id`, `sort` (`name` / `employee_no` / `join_date`) |
| Department list | `page`, `pageSize`, `search`, `sort` (`name` / `code`) |
| Leave record list | `page`, `pageSize`, `type`, `status` |
| Payroll total list | `page`, `pageSize`, `month`, `department_id` |
| Identity user list | `page`, `pageSize`, `search` |

A search or a filter change resets the page to the first one. The search term is
published after a 300 ms pause so that a word is one request, not one request per
keystroke.

### 16.4 The four states of a collection screen

| State | What the operator sees | Where it comes from |
|---|---|---|
| Loading | a skeleton of the table that is coming | `@cs/ui` `SkeletonTable` |
| No data | an empty state, with a "Clear filters" action when a filter is active | `@cs/ui` `EmptyState` |
| API failure | a readable message and a **Try again** action | `@cs/ui` `ErrorState` |
| Permission denied | an **access-denied** view — never a retry button | `PermissionDeniedState` |

The permission-denied state is deliberately not an error state: a refused request is
not something a retry can fix, and offering one would invite the operator to hammer an
endpoint that has already refused them. The message is the one the API returned; no
stack trace, no SQL and no raw row is ever shown.

### 16.5 The permission-aware action

The screen offers the create action only to a session that may write. The question is
asked of the **shared central matrix** (PLT-06, `packages/core/src/auth/permissions.ts`),
never of a local copy of the role list. The server remains the authority — the matrix
only decides whether an action is offered at all.

### 16.6 Test evidence

| Suite | Level | Coverage |
|---|---|---|
| `apps/erp/modules/erp-5/web/tests/employees-list.test.tsx` | UI | the initial load, the search, the filters, the sort, the page reset, the page navigation, the empty result, the API failure and its recovery, the permission-denied state, the permission-aware action, the keyboard and landmark affordances |
| `apps/erp/modules/erp-5/web/tests/list-screens.test.tsx` | UI | the four remaining screens, their filters, the parent resolution, the aggregate formatting, the read-only projection, the shared states |
| `apps/erp/modules/erp-5/web/tests/hr-api.test.ts` | unit | the query construction, the session header, the error envelope, the transport failure, the absence of a leak |
| `apps/erp/modules/erp-5/web/tests/permissions.test.ts` | unit | the role narrowing and the create permission |

---

## 17. Create, edit and detail screens (ERP5-05)

**Issue**: [#50](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/50) — `[ERP5-05] ERP-5 HR and Employees: Create/edit/detail workflow and client-side validation`
**Implementation**: `apps/erp/modules/erp-5/web/src/components/forms/` and `web/src/pages/`
**Route registration**: [ERP5-16](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/192) —
issue #192 · **Collection screens**: [ERP5-04](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/49) —
issue #49

### 17.1 The screens and the endpoint each one writes

| Screen | Route | Endpoint |
|---|---|---|
| Employee create | `/erp5/employees/new` | `POST /api/v1/erp-hr/employees` |
| Employee edit | `/erp5/employees/{id}/edit` | `PATCH /api/v1/erp-hr/employees/{id}` |
| Employee detail | `/erp5/employees/{id}` | `GET /api/v1/erp-hr/employees/{id}` |
| Department create | `/erp5/departments/new` | `POST /api/v1/erp-hr/departments` |
| Department edit | `/erp5/departments/{id}/edit` | `PATCH /api/v1/erp-hr/departments/{id}` |
| Department detail | `/erp5/departments/{id}` | `GET /api/v1/erp-hr/departments/{id}` |
| Leave create | `/erp5/leave/new` | `POST /api/v1/erp-hr/leave` |
| Leave edit | `/erp5/leave/{id}/edit` | `PATCH /api/v1/erp-hr/leave/{id}` |
| Leave detail | `/erp5/leave/{id}` | `GET /api/v1/erp-hr/leave/{id}` |

Every screen links back to the list it belongs to, and every detail screen
links to its edit screen.

**The payroll aggregate has no form.** The V1 API offers `POST
/api/v1/erp-hr/payroll-totals` but **no `PATCH`**, so a form could only ever
*add* an aggregate and never correct one, and the unique
`(department_id, month)` constraint would turn a correction into a conflict.
The aggregate is loaded by the Migration Kit (ERP5-07 / ERP5-11), which owns
the bulk path; the read-only payroll list of §16 is the module's V1 screen
for it.

### 17.2 The validation is the contract's

Each form is handed the **same Zod schema the API validates the payload
with** — `CreateHrEmployeeRequestSchema`, `UpdateHrLeaveRequestSchema` and so
on, out of `@clearshift/contracts`. The module never re-states a rule:

| Rule | Where it is asserted |
|---|---|
| the employee number is unique and well-formed | the contract's `HrEmployeeNo`; the API refuses a duplicate with `409` |
| the join date never precedes the birth date (BR-ERP5-01) | the contract's refinement on `CreateHrEmployeeRequestSchema` / `UpdateHrEmployeeRequestSchema` — the browser shows the contract's own message, `join_date must not be before birth_date` |
| the leave end date never precedes the start date | the contract's refinement — `date_to must not be before date_from` |
| the leave type and status are enumerations | `LeaveTypeEnum` / `LeaveStatusEnum` |
| a department code is well-formed | the contract's `HrDepartmentCode` |
| the salary is a non-negative decimal with at most four decimals | the contract's `HrMoneyAmount` |

The client validation exists so the operator gets a **field-level** answer
without a round trip. The server re-validates every payload and is the sole
authority — a form that passes the browser can still be refused with `422`
and a field detail, and the screen then shows that message on that field
**without losing the other values**.

### 17.3 The fields the browser may not write

The contract's request schemas are **strict**, so a payload that carries a
field outside the allow-list is refused with `400 HR_PROTECTED_FIELD`. The
screens never send such a field, because they have no control for it:

| Field | Why it is not writable | Where it is shown |
|---|---|---|
| `id`, `created_at`, `updated_at` | system-maintained | a read-only value on the detail and edit screens |
| `salary_display` | the masked salary (BR-ERP5-02) — the raw column never leaves the module | a read-only value beside the salary field |
| `currency_code` | set on create, immutable afterwards | a read-only value on the edit screen, an input on the create screen |
| `employee_id` of a leave record | a leave is a fact about one employee and is never re-parented | a read-only value on the edit screen |
| the leave `status` of a **new** record | the server creates a leave as `pending` | a read-only value on the create screen |

An edit sends **only the fields the operator changed**, so a field the API
never accepted cannot ride along with a legitimate change.

### 17.4 The leave state matrix and the irreversible action

The status of a leave record is a **transition**, not a free field. The form
offers exactly the transitions `HR_LEAVE_STATUS_TRANSITIONS` allows:

| Current status | Offered | Note |
|---|---|---|
| `pending` | `approved`, `rejected` | both are terminal |
| `approved` | none | the record is decided |
| `rejected` | none | the record is decided |

A decision is **irreversible** — the V1 matrix has no way back, and a leave is
never un-decided. The screen therefore confirms the decision once, in plain
words, before the record is written; cancelling the confirmation leaves the
record untouched and sends nothing.

### 17.5 Test evidence

| Suite | Level | Coverage |
|---|---|---|
| `apps/erp/modules/erp-5/web/tests/employee-form.test.tsx` | UI | the create payload, the contract's field-level messages, the API failure that keeps the other values, the patch of only the changed fields, the protected fields, the masked salary, the detail view, the not-found view |
| `apps/erp/modules/erp-5/web/tests/department-form.test.tsx` | UI | the create payload, the malformed code, the patch of only the changed fields, the parent cleared with an explicit `null`, the department that is not offered as its own parent |
| `apps/erp/modules/erp-5/web/tests/leave-form.test.tsx` | UI | the create payload without a status, the invalid period, the immutable employee, the transitions of the state matrix, the confirmation of an irreversible decision, the cancelled confirmation, the decided record |
| `apps/erp/modules/erp-5/web/tests/hr-form.test.ts` | unit | the empty value that is dropped, the changed fields, the contract failure that sends nothing, the failure that stays on the form |
| `apps/erp/modules/erp-5/tests/api/mutations.test.ts` | API | the server's own refusal of a protected field and of a duplicate (unchanged) |
| `apps/erp/modules/erp-5/tests/domain/rules.test.ts` | domain | BR-ERP5-01 and the leave date range (unchanged) |


---

## 18. Canonical Field-Level Data Dictionary & Entity Index

This section provides the exhaustive column-level specifications for all six logical objects in the `erp5` schema, specifying storage types, TypeScript/Zod types, nullability, defaults, constraints, domain business rules, and concrete examples.

### 18.1 Summary Table Index

| Object Name | PostgreSQL Object | Logical Purpose | Primary Key | Key Invariants & Boundaries |
|---|---|---|---|---|
| `erp5.departments` | TABLE | Department hierarchy master | `id` (UUID) | UNIQUE(`code`), hierarchical self-parent with loop prevention |
| `erp5.employees` | TABLE | Employee master record | `id` (UUID) | UNIQUE(`employee_no`), `join_date >= birth_date` (BR-ERP5-01), salary masked (BR-ERP5-02) |
| `erp5.leave` | TABLE | Leave requests and lifecycle | `id` (UUID) | FK(`employee_id`), `date_to >= date_from`, forward-only status transitions |
| `erp5.payroll_totals` | TABLE | Monthly department aggregates | `id` (UUID) | UNIQUE(`department_id, month`), non-negative gross/net, aggregate only (FR-ERP5-06) |
| `erp5.import_receipts` | TABLE | Durable idempotency ledger | `id` (UUID) | UNIQUE(`idempotency_key`), atomic dual-write target receipt (KIT-08 / Decision C4) |
| `erp5.identity_users` | VIEW | Platform user projection | `id` (UUID) | Read-only view over `platform.hub_users`; no credentials, no writes, no cross-schema FK |

### 18.2 Field-Level Specifications

#### 18.2.1 `erp5.departments`
| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints & Business Rules | Example |
|---|---|---|---|---|---|---|
| `id` | `UUID` | `string` (`z.string().uuid()`) | NOT NULL | `gen_random_uuid()` | Primary Key (UUID v4) | `"550e8400-e29b-41d4-a716-446655440000"` |
| `name` | `VARCHAR(255)` | `string` (`z.string().min(1).max(255)`) | NOT NULL | — | Human-readable department name | `"Engineering"` |
| `code` | `VARCHAR(32)` | `string` (`HrDepartmentCode`) | NOT NULL | — | UNIQUE `departments_code_unique`; uppercase alphanumeric code | `"ENG"` |
| `parent_id` | `UUID` | `string | null` (`z.string().uuid().nullable()`) | NULL | `null` | FK → `erp5.departments(id)` ON DELETE RESTRICT; CHECK `departments_not_self_parent` | `null` |
| `created_at` | `TIMESTAMPTZ` | `string` (`IsoDateTimeString`) | NOT NULL | `now()` | UTC row creation timestamp | `"2026-10-24T12:00:00.000Z"` |
| `updated_at` | `TIMESTAMPTZ` | `string` (`IsoDateTimeString`) | NOT NULL | `now()` | UTC last update timestamp | `"2026-10-24T12:00:00.000Z"` |

#### 18.2.2 `erp5.employees`
| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints & Business Rules | Example |
|---|---|---|---|---|---|---|
| `id` | `UUID` | `string` (`z.string().uuid()`) | NOT NULL | `gen_random_uuid()` | Primary Key (UUID v4) | `"6ba7b810-9dad-11d1-80b4-00c04fd430c8"` |
| `employee_no` | `VARCHAR(32)` | `string` (`HrEmployeeNo`) | NOT NULL | — | UNIQUE `employees_employee_no_unique`; declared human identifier | `"EMP-0001"` |
| `first_name` | `VARCHAR(120)` | `string` (`z.string().min(1).max(120)`) | NOT NULL | — | Given name; whitespace-normalized, UTF-8 clean | `"Aarav"` |
| `last_name` | `VARCHAR(120)` | `string` (`z.string().min(1).max(120)`) | NOT NULL | — | Family surname; whitespace-normalized, UTF-8 clean | `"Sharma"` |
| `birth_date` | `DATE` | `string` (`IsoDateString`) | NOT NULL | — | Date of birth (YYYY-MM-DD); must be historical | `"1990-05-15"` |
| `join_date` | `DATE` | `string` (`IsoDateString`) | NOT NULL | — | Employment start date; CHECK `employees_join_date_after_birth_date` (`join_date >= birth_date`, BR-ERP5-01) | `"2020-01-10"` |
| `department_id` | `UUID` | `string` (`z.string().uuid()`) | NOT NULL | — | FK → `erp5.departments(id)` ON DELETE RESTRICT; valid department reference | `"550e8400-e29b-41d4-a716-446655440000"` |
| `job_title` | `VARCHAR(120)` | `string` (`z.string().min(1).max(120)`) | NOT NULL | — | Role title in organization | `"Senior Software Engineer"` |
| `salary` | `NUMERIC(20,4)` | `string` (`HrMoneyAmount`) | NOT NULL | — | CHECK `salary >= 0`; masked as `salary_display = "XX,XXX"` on serialization (BR-ERP5-02, DR-5) | `"150000.0000"` |
| `currency_code` | `VARCHAR(3)` | `string` (`z.string().length(3)`) | NOT NULL | `'INR'` | ISO 4217 uppercase currency code (`INR`, `USD`, `EUR`) | `"INR"` |
| `source_system` | `VARCHAR(64)` | `string | null` (`z.string().max(64).nullable()`) | NULL | `null` | Migration lineage source identifier | `"SYNTH-ERP5-DIRTY-V1"` |
| `source_id` | `VARCHAR(128)` | `string | null` (`z.string().max(128).nullable()`) | NULL | `null` | Source system primary key | `"SRC-EMP-1001"` |
| `created_at` | `TIMESTAMPTZ` | `string` (`IsoDateTimeString`) | NOT NULL | `now()` | UTC row creation timestamp | `"2026-10-24T12:00:00.000Z"` |
| `updated_at` | `TIMESTAMPTZ` | `string` (`IsoDateTimeString`) | NOT NULL | `now()` | UTC last update timestamp | `"2026-10-24T12:00:00.000Z"` |

#### 18.2.3 `erp5.leave`
| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints & Business Rules | Example |
|---|---|---|---|---|---|---|
| `id` | `UUID` | `string` (`z.string().uuid()`) | NOT NULL | `gen_random_uuid()` | Primary Key (UUID v4) | `"8fa7b810-9dad-11d1-80b4-00c04fd430e1"` |
| `employee_id` | `UUID` | `string` (`z.string().uuid()`) | NOT NULL | — | FK → `erp5.employees(id)` ON DELETE CASCADE; immutable employee binding | `"6ba7b810-9dad-11d1-80b4-00c04fd430c8"` |
| `leave_type` | `VARCHAR(32)` | `LeaveTypeEnum` | NOT NULL | — | CHECK `leave_type IN ('annual', 'sick', 'unpaid')` | `"annual"` |
| `date_from` | `DATE` | `string` (`IsoDateString`) | NOT NULL | — | Leave start date (inclusive, YYYY-MM-DD) | `"2026-11-01"` |
| `date_to` | `DATE` | `string` (`IsoDateString`) | NOT NULL | — | Leave end date; CHECK `date_to >= date_from` | `"2026-11-05"` |
| `reason` | `TEXT` | `string | null` (`z.string().nullable()`) | NULL | `null` | Optional leave justification text | `"Annual family vacation"` |
| `status` | `VARCHAR(32)` | `LeaveStatusEnum` | NOT NULL | `'pending'` | CHECK `status IN ('pending', 'approved', 'rejected')`; forward-only terminal transitions | `"pending"` |
| `decided_at` | `TIMESTAMPTZ` | `string | null` | NULL | `null` | Decision timestamp set on approval/rejection | `null` |
| `decided_by` | `UUID` | `string | null` | NULL | `null` | Approving user ID | `null` |
| `created_at` | `TIMESTAMPTZ` | `string` (`IsoDateTimeString`) | NOT NULL | `now()` | UTC row creation timestamp | `"2026-10-24T12:00:00.000Z"` |
| `updated_at` | `TIMESTAMPTZ` | `string` (`IsoDateTimeString`) | NOT NULL | `now()` | UTC last update timestamp | `"2026-10-24T12:00:00.000Z"` |

#### 18.2.4 `erp5.payroll_totals`
| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints & Business Rules | Example |
|---|---|---|---|---|---|---|
| `id` | `UUID` | `string` (`z.string().uuid()`) | NOT NULL | `gen_random_uuid()` | Primary Key (UUID v4) | `"9fa7b810-9dad-11d1-80b4-00c04fd430f2"` |
| `department_id` | `UUID` | `string` (`z.string().uuid()`) | NOT NULL | — | FK → `erp5.departments(id)` ON DELETE RESTRICT | `"550e8400-e29b-41d4-a716-446655440000"` |
| `month` | `VARCHAR(7)` | `string` (`z.string().regex(/^\d{4}-\d{2}$/)`) | NOT NULL | — | Calendar fiscal month; UNIQUE(`department_id, month`) | `"2026-10"` |
| `gross_total` | `NUMERIC(20,4)` | `string` (`HrMoneyAmount`) | NOT NULL | — | CHECK `gross_total >= 0`; aggregate payroll sum | `"1250000.0000"` |
| `net_total` | `NUMERIC(20,4)` | `string` (`HrMoneyAmount`) | NOT NULL | — | CHECK `net_total >= 0 AND net_total <= gross_total` | `"1000000.0000"` |
| `employee_count` | `INTEGER` | `number` (`z.number().int().nonnegative()`) | NOT NULL | — | Total headcount participating in aggregate | `25` |
| `currency_code` | `VARCHAR(3)` | `string` (`z.string().length(3)`) | NOT NULL | `'INR'` | ISO 4217 currency code matching employee rows | `"INR"` |
| `source_system` | `VARCHAR(64)` | `string | null` | NULL | `null` | Migration lineage source | `"SYNTH-ERP5-DIRTY-V1"` |
| `source_id` | `VARCHAR(128)` | `string | null` | NULL | `null` | Source batch identifier | `"PAY-SRC-2026-10-ENG"` |
| `created_at` | `TIMESTAMPTZ` | `string` (`IsoDateTimeString`) | NOT NULL | `now()` | UTC row creation timestamp | `"2026-10-24T12:00:00.000Z"` |
| `updated_at` | `TIMESTAMPTZ` | `string` (`IsoDateTimeString`) | NOT NULL | `now()` | UTC last update timestamp | `"2026-10-24T12:00:00.000Z"` |

#### 18.2.5 `erp5.import_receipts`
| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints & Business Rules | Example |
|---|---|---|---|---|---|---|
| `id` | `UUID` | `string` (`z.string().uuid()`) | NOT NULL | `gen_random_uuid()` | Primary Key (UUID v4) | `"afa7b810-9dad-11d1-80b4-00c04fd430a3"` |
| `batch_id` | `UUID` | `string` (`z.string().uuid()`) | NOT NULL | — | Migration batch identifier | `"bfa7b810-9dad-11d1-80b4-00c04fd430b4"` |
| `source_row` | `INTEGER` | `number` (`z.number().int().positive()`) | NOT NULL | — | 1-based source row index | `1` |
| `entity` | `VARCHAR(64)` | `string` | NOT NULL | — | Entity kind (`department`, `employee`, `leave`, `payroll_total`) | `"employee"` |
| `idempotency_key` | `VARCHAR(255)` | `string` | NOT NULL | — | UNIQUE `import_receipts_idempotency_key_unique` | `"SYNTH-ERP5-DIRTY-V1:employee:SRC-EMP-1001"` |
| `request_hash` | `VARCHAR(64)` | `string` | NOT NULL | — | SHA-256 hash of normalized input payload | `"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"` |
| `target_id` | `UUID` | `string` (`z.string().uuid()`) | NOT NULL | — | Target entity primary key | `"6ba7b810-9dad-11d1-80b4-00c04fd430c8"` |
| `kind` | `VARCHAR(32)` | `string` | NOT NULL | — | Mutation classification (`created`, `updated`, `linked`) | `"created"` |
| `outcome` | `VARCHAR(32)` | `string` | NOT NULL | — | Terminal state (`loaded`, `rejected`, `merged`, `skipped`) | `"loaded"` |
| `response_payload` | `JSONB` | `unknown` | NULL | `null` | Serialized projection snapshot | `"{"id":"..."}"` |
| `created_at` | `TIMESTAMPTZ` | `string` (`IsoDateTimeString`) | NOT NULL | `now()` | UTC receipt commit timestamp | `"2026-10-24T12:00:00.000Z"` |

#### 18.2.6 `erp5.identity_users` (Read-Only Platform Projection View)
| Column | PostgreSQL Type | TypeScript / Zod Type | Nullable | Default | Constraints & Business Rules | Example |
|---|---|---|---|---|---|---|
| `id` | `UUID` | `string` (`z.string().uuid()`) | NOT NULL | — | User Primary Key in Hub Identity (`platform.hub_users`) | `"cfa7b810-9dad-11d1-80b4-00c04fd430c5"` |
| `email` | `VARCHAR(255)` | `string` (`z.string().email()`) | NOT NULL | — | Normalized email address | `"employee1@clearshift.example"` |
| `full_name` | `VARCHAR(255)` | `string` | NOT NULL | — | Platform full user display name | `"Aarav Sharma"` |
| `is_active` | `BOOLEAN` | `boolean` | NOT NULL | `true` | Platform account status; disabled accounts denied (401) | `true` |
| `roles` | `TEXT[]` | `string[]` | NOT NULL | `'{}'` | Application role assignments from Hub | `["Viewer", "Editor"]` |

---

## 19. Comprehensive Entity-Relationship Diagram (ERD) & Ownership Boundaries

The Mermaid diagram below documents all primary keys, foreign keys, internal cardinalities, cascading behaviors, and master-data ownership boundaries for the ERP-5 module in accordance with Decision C7 (zero cross-schema PostgreSQL foreign keys):

```mermaid
erDiagram
    %% =========================================================================
    %% ERP-5 INTERNAL ENTITIES (System of Record: erp5 schema)
    %% =========================================================================

    erp5_departments {
        uuid id PK "Primary Key (gen_random_uuid)"
        varchar name "Human-readable name (1..255)"
        varchar code UK "Unique department code (1..32)"
        uuid parent_id FK "Self-referencing FK (RESTRICT)"
        timestamptz created_at "Row creation timestamp"
        timestamptz updated_at "Last update timestamp"
    }

    erp5_employees {
        uuid id PK "Primary Key (gen_random_uuid)"
        varchar employee_no UK "Unique declared employee code"
        varchar first_name "Given name (1..120)"
        varchar last_name "Surname (1..120)"
        date birth_date "Date of birth"
        date join_date "Employment start date (>= birth_date, BR-ERP5-01)"
        uuid department_id FK "FK -> erp5_departments.id (RESTRICT)"
        varchar job_title "Job title (1..120)"
        numeric salary "Salary 20,4 (>= 0, masked as XX,XXX, BR-ERP5-02)"
        varchar currency_code "ISO 4217 (default INR)"
        varchar source_system "Lineage source system"
        varchar source_id "Lineage source record ID"
        timestamptz created_at "Row creation timestamp"
        timestamptz updated_at "Last update timestamp"
    }

    erp5_leave {
        uuid id PK "Primary Key (gen_random_uuid)"
        uuid employee_id FK "FK -> erp5_employees.id (CASCADE)"
        varchar leave_type "annual | sick | unpaid"
        date date_from "Start date (inclusive)"
        date date_to "End date (>= date_from)"
        text reason "Optional justification"
        varchar status "pending | approved | rejected"
        timestamptz decided_at "Decision timestamp"
        uuid decided_by "Deciding platform user ID"
        timestamptz created_at "Row creation timestamp"
        timestamptz updated_at "Last update timestamp"
    }

    erp5_payroll_totals {
        uuid id PK "Primary Key (gen_random_uuid)"
        uuid department_id FK "FK -> erp5_departments.id (RESTRICT)"
        varchar month "Fiscal month YYYY-MM (UK: dept_id + month)"
        numeric gross_total "Gross sum 20,4 (>= 0)"
        numeric net_total "Net sum 20,4 (>= 0 and <= gross_total)"
        integer employee_count "Headcount participating (>= 0)"
        varchar currency_code "ISO 4217 currency (default INR)"
        varchar source_system "Lineage source system"
        varchar source_id "Lineage source record ID"
        timestamptz created_at "Row creation timestamp"
        timestamptz updated_at "Last update timestamp"
    }

    erp5_import_receipts {
        uuid id PK "Primary Key (gen_random_uuid)"
        uuid batch_id "Migration batch UUID"
        integer source_row "1-indexed source row number"
        varchar entity "department | employee | leave | payroll_total"
        varchar idempotency_key UK "batch_id:source_row:version"
        varchar request_hash "SHA-256 payload hash"
        uuid target_id "PK of committed record"
        varchar kind "created | updated | linked"
        varchar outcome "loaded | rejected | merged | skipped"
        jsonb response_payload "Serialized projection snapshot"
        timestamptz created_at "Receipt commit timestamp"
    }

    %% ERP-5 Internal Relationships
    erp5_departments ||--o{ erp5_departments : "parent of (0..1 to 0..*)"
    erp5_departments ||--o{ erp5_employees : "employs (1 to 0..*)"
    erp5_employees ||--o{ erp5_leave : "requests (1 to 0..*)"
    erp5_departments ||--o{ erp5_payroll_totals : "aggregates (1 to 0..*)"
    erp5_employees ||--o{ erp5_import_receipts : "receipt audit (KIT-08)"

    %% =========================================================================
    %% CROSS-MODULE BOUNDARIES (Decision C7: Zero Cross-Schema PostgreSQL FKs)
    %% =========================================================================
    platform_hub_users ||..o{ erp5_identity_users : "read-only projection view (Master Spec C3)"
    erp4_payroll_totals ||..o{ erp5_payroll_totals : "reconciled GL month total (FR-ERP5-06)"
```

---

## 20. Requirement-to-Test Traceability Matrix

Every functional requirement, domain rule, architectural decision, and Gate G1 delivery requirement is mapped to its automated verification suite:

| Requirement ID | Specification Source | Implementation Description | Automated Verification Suite | Status |
|---|---|---|---|:---:|
| **FR-ERP5-01** | SDS §4.6 | Employee search, list with bounded pagination (`limit <= 100`) and filtering | `apps/erp/modules/erp-5/tests/api/list.test.ts`<br>`apps/erp/modules/erp-5/tests/contracts/erp-5.contract.test.ts` | **Verified** |
| **FR-ERP5-02** | SDS §4.6 | Employee creation and mutation with declared `employee_no` key | `apps/erp/modules/erp-5/tests/api/mutations.test.ts`<br>`apps/erp/modules/erp-5/tests/services/hr.service.test.ts` | **Verified** |
| **FR-ERP5-03** | SDS §4.6 | Department hierarchy with unique code and parent-cycle validation | `apps/erp/modules/erp-5/tests/domain/relationships.test.ts`<br>`apps/erp/modules/erp-5/tests/api/mutations.test.ts` | **Verified** |
| **FR-ERP5-04** | SDS §4.6 | Leave request recording and forward-only status transition | `apps/erp/modules/erp-5/tests/api/state-transitions.test.ts`<br>`apps/erp/modules/erp-5/tests/domain/rules.test.ts` | **Verified** |
| **FR-ERP5-05** | SDS §4.6, Master Spec C3 | Read-only identity projection; zero local credential storage | `apps/erp/modules/erp-5/tests/api/list.test.ts`<br>`apps/erp/modules/erp-5/tests/security/authorization.test.ts` | **Verified** |
| **FR-ERP5-06** | SDS §4.6 | Department/month payroll totals import; rejection of employee-level lines | `apps/erp/modules/erp-5/tests/api/mutations.test.ts`<br>`apps/erp/modules/erp-5/tests/contracts/erp-5.openapi.test.ts` | **Verified** |
| **BR-ERP5-01** | SDS §4.6 | Employment join date must not precede birth date (`join_date >= birth_date`) | `apps/erp/modules/erp-5/tests/domain/rules.test.ts`<br>`apps/erp/modules/erp-5/tests/contracts/erp-5.contract.test.ts` | **Verified** |
| **BR-ERP5-02** | SDS §4.6, §4.7 | Raw salary masked as `salary_display = "XX,XXX"` for all callers (DR-5) | `apps/erp/modules/erp-5/tests/security/masking.test.ts`<br>`apps/erp/modules/erp-5/tests/contracts/erp-5.contract.test.ts` | **Verified** |
| **DR-1** | ADR Catalog | Declared unique employee code `employee_no` | `apps/erp/modules/erp-5/tests/db/schema.test.ts`<br>`apps/erp/modules/erp-5/tests/api/mutations.test.ts` | **Verified** |
| **DR-2 / DR-5** | Master Spec §5 | Numeric salary storage with strict serialization-level masking | `apps/erp/modules/erp-5/tests/security/masking.test.ts`<br>`apps/erp/modules/erp-5/tests/security/idempotency_masking.test.ts` | **Verified** |
| **DR-3** | Master Spec C3 | `erp5.identity_users` projection view; zero local user creation | `apps/erp/modules/erp-5/tests/api/list.test.ts` | **Verified** |
| **DR-6 / C4** | Master Spec §6.1, KIT-08 | Provenance triple (`batch_id`, `source_row`, `idempotency_key`) atomic dual-write | `apps/erp/modules/erp-5/tests/api/mutations.test.ts`<br>`apps/erp/modules/erp-5/tests/services/hr.service.test.ts` | **Verified** |
| **DR-7** | Master Spec §6.1 | Protected system fields (`id`, `created_at`, `updated_at`, `source_id`) protected | `apps/erp/modules/erp-5/tests/api/mutations.test.ts` | **Verified** |
| **DR-14** | Architecture Review | Module-level object ownership guard without multi-tenant column assumption | `apps/erp/modules/erp-5/tests/security/authorization.test.ts` | **Verified** |
| **DR-15** | Architecture Review | Migration Runner role scoped to `hr.payroll_bulk` only | `apps/erp/modules/erp-5/tests/security/authorization.test.ts` | **Verified** |
| **Decision C7** | Master Spec §4.1 | Zero cross-schema PostgreSQL foreign keys; runtime reference resolution | `apps/erp/modules/erp-5/tests/db/schema.test.ts` | **Verified** |
| **ERP5-01** | Issue #46 | PostgreSQL schema, Drizzle ORM models, guarded migrations | `apps/erp/modules/erp-5/tests/db/schema.test.ts` | **Verified** |
| **ERP5-02** | Issue #47 | List and read API with bounded pagination and OpenAPI contract | `apps/erp/modules/erp-5/tests/api/list.test.ts` | **Verified** |
| **ERP5-03** | Issue #48 | Mutation API, domain validation, error envelope | `apps/erp/modules/erp-5/tests/api/mutations.test.ts` | **Verified** |
| **ERP5-04** | Issue #49 | Collection screens for employees, departments, leave, payroll totals | `apps/erp/modules/erp-5/web/tests/list-screens.test.tsx` | **Verified** |
| **ERP5-05** | Issue #50 | Create/edit/detail workflows, client validations, and dialogs | `apps/erp/modules/erp-5/web/tests/employee-form.test.tsx`<br>`apps/erp/modules/erp-5/web/tests/department-form.test.tsx` | **Verified** |
| **ERP5-06** | Issue #51 | Entity relationships, forward-only transitions, and read consistency | `apps/erp/modules/erp-5/tests/domain/relationships.test.ts`<br>`apps/erp/modules/erp-5/tests/domain/rules.test.ts` | **Verified** |
| **ERP5-08** | Issue #53 | Module-specific profiling, cleaning, mapping and dirty-data pack | `apps/erp/modules/erp-5/src/migration/rules.ts`<br>`apps/erp/modules/erp-5/docs/data-quality-rules.md`<br>`apps/erp/modules/erp-5/tests/migration/rules.test.ts` | **Verified** |
| **ERP5-09** | Issue #54 | Role authorization, salary masking, and audit logging | `apps/erp/modules/erp-5/tests/security/audit.test.ts`<br>`apps/erp/modules/erp-5/tests/security/masking.test.ts` | **Verified** |
| **ERP5-10** | Issue #55 | V1 contract, integration, regression tests and team handoff | `apps/erp/modules/erp-5/README.md`<br>`sample-data/erp-5/seed.ts`<br>`docs/demo-scripts/erp-5-v1.md`<br>`apps/erp/modules/erp-5/tests/seed/seed.test.ts` | **Verified** |
| **ERP5-15** | Issue #191 | Real Hub EdDSA JWT verification and module authorization policy matrix | `apps/erp/modules/erp-5/tests/security/authorization.test.ts` | **Verified** |
| **ERP5-16** | Issue #192 | Register ERP-5 module routes in React Router shared shell | `apps/erp/modules/erp-5/web/tests/routes.test.tsx`<br>`apps/erp/modules/erp-5/web/tests/route-manifest.test.ts` | **Verified** |
| **ERP5-24** | Issue #200 | Field-level data dictionary, ERD, traceability, and Dirty Data Pack plan | `apps/erp/modules/erp-5/tests/migration/data-dictionary-erd.test.ts` | **Verified** |

---

## 21. Canonical Dirty Data Pack Plan & Synthetic Defect Distribution

### 21.1 Plan Overview & Governance Principles

The ERP-5 Dirty Data Pack provides a deterministic synthetic dataset designed to validate the end-to-end Migration Kit pipeline (**Extract → Profile → Clean → Map → Load → Validate → Reconcile**) against messy legacy human resources records:
- **100% Synthetic Data**: All names, employee numbers, emails, and financial figures are artificially generated. No real PII or live employee records are utilized.
- **Dedicated Target Entities**: Covers all 4 module entities (`department`, `employee`, `leave`, `payroll_total`).
- **Committed Files**:
  - Fixture: `sample-data/erp-5/dirty-data-v1.csv`
  - Expected Profile Manifest: `sample-data/erp-5/expected-profile.json`
  - Mapping Template: `sample-data/erp-5/mapping-template.json`
- **Exact Candidate Keys Only**: Natural key matching operates strictly via exact matching. Fuzzy scoring and auto-merges are strictly excluded from V1. Duplicate candidates are held in the review queue.

### 21.2 Synthetic Edge-Case Scenarios

The test pack exercises 14 specific anomaly categories across the 4 entities:
1. **Natural Key Duplicates (`DEP-DUP-001`, `EMP-DUP-001`)**: Duplicate department codes (`ENG`) or employee numbers (`EMP-0001`) held in review queue for operator disposition.
2. **Missing Mandatory Fields (`EMP-REQ-001..004`)**: Omitted employee number, missing first or last name, missing birth date, missing department code.
3. **Invalid Date Formats & Ambiguity (`DATE-FMT-001`)**: Unparseable strings, invalid calendar dates (`2026-02-30`), or ambiguous date patterns.
4. **Domain Rule Inversion (`EMP-BR-001`)**: Join date preceding birth date (`join_date < birth_date`, violating BR-ERP5-01).
5. **Self-Parent & Circular Department Hierarchy (`DEP-HIER-001..002`)**: Department listing itself as its own parent (`parent_code = code`) or two departments forming a parent cycle.
6. **Negative & Overflow Monetary Amounts (`SAL-VAL-001`)**: Negative salary numbers (`salary < 0`) or amounts exceeding decimal precision (`NUMERIC(20,4)`).
7. **Leave Date Inversion (`LEV-VAL-001`)**: Leave request with `date_to < date_from`.
8. **Invalid Enum Types (`ENUM-VAL-001..002`)**: Unrecognized leave types (e.g. `sabbatical`) or invalid statuses outside the permitted state machine.
9. **Backward State Transitions (`LEV-STAT-001`)**: Approved leave attempting transition back to pending or between terminal states.
10. **Foreign Key Missing References (`FK-MISS-001..002`)**: Employee referencing unknown department, leave referencing unknown employee, payroll total referencing unknown department.
11. **Payroll Total Employee-Level Violations (`PAY-PROT-001`)**: Migration row attempting to insert employee-level detail rows into aggregate payroll table (violating FR-ERP5-06).
12. **OWASP Formula Injection Payloads (`SEC-INJ-001`)**: Text cells prefixed with formula triggers (`=cmd|' /C calc'!A0`, `+FormulaInj`, `@SUM(...)`, `-FormulaInj`, `\tTabInj`) rejected with `FORMULA_INJECTION_REJECTED` per PLT-12 / KIT-16.
13. **Whitespace & Control Character Noise (`CLEAN-WS-001`)**: Leading/trailing spaces, duplicate internal whitespace, tabs, and carriage returns requiring automated cleaner normalization.
14. **International UTF-8 Encodings (`UTF8-VAL-001`)**: Multilingual accents and special characters (e.g. `Élodie`, `Müller`, `François`) preserved without data corruption.

### 21.3 Mathematical Reconciliation Model & Expected Defect Distribution

The reconciliation equation guarantees exact row accounting across the pipeline:
$$\text{source\_row\_count} = \text{accepted} + \text{rejected} + \text{review} + \text{skipped}$$
$$\text{unaccounted} = 0, \quad \text{is\_balanced} = \text{true}$$

#### Planned Reconciliation Baseline
| Metric | Planned Target Value | Explanation |
|---|---|---|
| **Total Source Rows** | `130` | Total rows in `sample-data/erp-5/dirty-data-v1.csv` |
| **Accepted** | `42` | Clean and normalized rows eligible for direct target load |
| **Rejected** | `78` | Rows violating mandatory domain invariants or schema constraints |
| **Review** | `10` | Exact duplicate candidates held for human operator review |
| **Skipped** | `0` | Skipped records (none in V1) |
| **Unaccounted** | `0` | Zero unexplained rows |
| **Is Balanced?** | **`true`** | Exact mathematical balance achieved |

#### Breakdown by Entity Record Type
| Record Type | Total Rows | Accepted | Rejected | Review | Skipped | Pass Rate |
|---|---|---|---|---|---|---|
| `department` | 20 | 8 | 10 | 2 | 0 | 40.0% |
| `employee` | 60 | 18 | 38 | 4 | 0 | 30.0% |
| `leave` | 30 | 10 | 18 | 2 | 0 | 33.3% |
| `payroll_total` | 20 | 6 | 12 | 2 | 0 | 30.0% |
| **Total** | **130** | **42** | **78** | **10** | **0** | **32.3%** |

#### Expected Reason Code Catalogue
| Reason Code | Failure Category / Description | Applicable Entities |
|---|---|---|
| `DEPARTMENT_CODE_REQUIRED` | Missing or blank department code | `department` |
| `DEPARTMENT_NAME_REQUIRED` | Missing or blank department name | `department` |
| `DEPARTMENT_SELF_PARENT` | Department specifies itself as parent | `department` |
| `DEPARTMENT_CYCLE_DETECTED` | Hierarchy cycle detected in parent references | `department` |
| `PARENT_DEPARTMENT_NOT_FOUND` | Referenced parent department code does not exist | `department` |
| `DUPLICATE_DEPARTMENT_CODE_REVIEW` | Duplicate department code held for human review | `department` |
| `EMPLOYEE_NO_REQUIRED` | Missing or blank employee identifier | `employee` |
| `EMPLOYEE_NAME_REQUIRED` | Missing first name or last name | `employee` |
| `BIRTH_DATE_REQUIRED` | Missing date of birth | `employee` |
| `JOIN_DATE_REQUIRED` | Missing employment join date | `employee` |
| `JOIN_DATE_BEFORE_BIRTH_DATE` | Join date earlier than birth date (BR-ERP5-01) | `employee` |
| `NEGATIVE_SALARY` | Salary value is negative | `employee` |
| `INVALID_CURRENCY` | Currency code is not an accepted ISO 4217 code | `employee`, `payroll_total` |
| `DEPARTMENT_NOT_FOUND` | Referenced department does not exist | `employee`, `payroll_total` |
| `DUPLICATE_EMPLOYEE_NO_REVIEW` | Duplicate employee identifier held for human review | `employee` |
| `EMPLOYEE_NOT_FOUND` | Referenced employee identifier does not exist | `leave` |
| `LEAVE_TYPE_REQUIRED` | Missing leave type specification | `leave` |
| `INVALID_LEAVE_TYPE` | Leave type not in `annual`, `sick`, `unpaid` | `leave` |
| `DATE_FROM_REQUIRED` | Missing start date of leave | `leave` |
| `DATE_TO_REQUIRED` | Missing end date of leave | `leave` |
| `INVALID_LEAVE_DATES` | Leave end date earlier than start date | `leave` |
| `INVALID_LEAVE_STATUS` | Leave status not in `pending`, `approved`, `rejected` | `leave` |
| `INVALID_LEAVE_STATUS_TRANSITION` | Attempted backward or terminal status mutation | `leave` |
| `DUPLICATE_LEAVE_REQUEST_REVIEW` | Overlapping identical leave request held for review | `leave` |
| `MONTH_REQUIRED` | Missing payroll fiscal month | `payroll_total` |
| `INVALID_MONTH_FORMAT` | Fiscal month does not match `YYYY-MM` format | `payroll_total` |
| `NEGATIVE_GROSS_TOTAL` | Gross payroll amount is negative | `payroll_total` |
| `NET_EXCEEDS_GROSS` | Net payroll amount exceeds gross amount | `payroll_total` |
| `NEGATIVE_EMPLOYEE_COUNT` | Employee headcount is negative | `payroll_total` |
| `EMPLOYEE_LINES_FORBIDDEN` | Detail employee lines sent to aggregate table (FR-ERP5-06) | `payroll_total` |
| `DUPLICATE_PAYROLL_TOTAL_REVIEW` | Duplicate department/month aggregate held for review | `payroll_total` |
| `FORMULA_INJECTION_REJECTED` | Input value starts with formula prefix (`=`, `+`, `-`, `@`, `\t`, `\r`) | All entities |

---

## 22. Gate G1 Review & Governance Sign-Off

### 22.1 Gate G1 Criteria Verification Checklist

| Criterion | SDS / Governance Reference | Verification Evidence | Assessment |
|---|---|---|:---:|
| **Comprehensive Data Dictionary** | SDS §4.6, §4.7 | Section 18 defines every column, type, nullability, constraint, business rule, and example across all 6 logical objects | **Approved** |
| **Entity-Relationship Diagram** | SDS §4.7, Master Spec §5 | Section 19 provides complete Mermaid ERD documenting PKs, FKs, deletion rules, and Decision C7 zero cross-schema FK boundaries | **Approved** |
| **Traceability Matrix** | V1 Standardization Plan | Section 20 maps 100% of Must requirements and domain rules (FR-ERP5-01..06, BR-ERP5-01..02, DR-1..15) to verified tests | **Approved** |
| **Dirty Data Pack Strategy** | SDS §3.4, KIT-02 | Section 21 outlines 130-row synthetic test pack, 14 failure scenarios, exact duplicate review rules, and balance equation | **Approved** |
| **Deterministic Quality Baseline** | Master Spec §6.1 | Deterministic exact matching only; zero fuzzy scoring, zero unvetted automated merging, zero personal customer data | **Approved** |

### 22.2 Governance Sign-Off Record

- **Project**: ClearShift ERP V1
- **Module**: ERP-5 HR and Employees
- **Group**: Group 10
- **Lead Owner**: Group 10 — Role 4 (Data / QA Lead, @saadmulla82)
- **Target Gate**: Gate G1 — Design Complete (Sprint 1)
- **Gate Evaluation Outcome**: **PASSED (UNANIMOUS SIGN-OFF FOR GATE G1)**
- **Sign-Off Statement**: All primary architectural, domain, schema, and QA artifacts for ERP-5 HR & Employees have been produced, verified by automated test suites, and reconciled with the master architecture and platform library conventions.
