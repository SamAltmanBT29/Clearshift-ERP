# ERP-5 HR & Employees — Data Dictionary

**SDS Reference**: ClearShift ERP v2.0, §4.6 (FR-ERP5-01..06, BR-ERP5-01..02), §4.7 (ERP-5 tables)
**Architecture Reference**: ClearShift V1 Master Architecture Spec, §C3 (identity ownership), §5 (ERD), §6.1 (slot 01)
**Module**: ERP-5 HR & Employees (Group 10)
**Issue**: [#46](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/46) — `[ERP5-01] Schema, Drizzle models and guarded migrations`
**PostgreSQL Schema**: `erp5`
**API Base**: `/api/v1/erp-hr`
**Version**: V1.0

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
