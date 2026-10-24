# ERP-5 HR & Employees (V1) — Runbook & Module Documentation

Package `@cs/mod-erp5`. API base `/api/v1/erp-hr`.  
Tables: `erp5_departments`, `erp5_employees`, `erp5_leave`, `erp5_payroll_totals`, `erp5_import_receipts`, and read-only Hub Identity projection `erp5_identity_users` (PostgreSQL schema `erp5`).  
Data Dictionary: [`docs/data-dictionary.md`](docs/data-dictionary.md) & [`docs/data-dictionaries/erp-5.md`](../../../../docs/data-dictionaries/erp-5.md)  
OpenAPI Contract: [`packages/contracts/openapi/erp-5.yaml`](../../../../packages/contracts/openapi/erp-5.yaml)  
TypeScript Contract: [`packages/contracts/src/erp-5.ts`](../../../../packages/contracts/src/erp-5.ts)  
Demo Script: [`docs/demo-scripts/erp-5-v1.md`](../../../../docs/demo-scripts/erp-5-v1.md)  
Data Quality Rules: [`docs/data-quality-rules.md`](docs/data-quality-rules.md)  
Gate G4 Evidence Pack: [`docs/gate-g4-evidence-pack.md`](docs/gate-g4-evidence-pack.md)  

---

## 1. Public Endpoints & Authorization Matrix

All endpoints require asymmetric-signed EdDSA Hub JWT access tokens or verified roles under default-deny policy.

| Method | Path | Summary / Domain Invariants Enforced | Minimum Role |
|---|---|---|---|
| `GET` | `/departments` | List departments with search and hierarchy metadata | `Viewer`, `Editor`, `Analyst`, `Admin` |
| `POST` | `/departments` | Create department; validates unique `code` and parent-cycle prevention (FR-ERP5-03) | `Editor`, `Admin` |
| `GET` | `/departments/{id}` | Read department by UUID | `Viewer`, `Editor`, `Analyst`, `Admin` |
| `PATCH` | `/departments/{id}` | Update department; checks circular ancestor references (`DEPARTMENT_CYCLE_DETECTED`) | `Editor`, `Admin` |
| `GET` | `/employees` | List employees with bounded pagination (`limit <= 100`) and search; masks salary | `Viewer`, `Editor`, `Analyst`, `Admin` |
| `POST` | `/employees` | Create employee; enforces `join_date >= birth_date` (BR-ERP5-01) and unique `employee_no` | `Editor`, `Admin` |
| `GET` | `/employees/{id}` | Read employee master record; masks salary as `salary_display = "XX,XXX"` (BR-ERP5-02 / DR-5) | `Viewer`, `Editor`, `Analyst`, `Admin` |
| `PATCH` | `/employees/{id}` | Update employee attributes; re-validates temporal rules on modification | `Editor`, `Admin` |
| `GET` | `/leave` | List leave requests filtered by employee, status, or date | `Viewer`, `Editor`, `Analyst`, `Admin` |
| `POST` | `/leave` | Record leave request; enforces `date_to >= date_from` (FR-ERP5-04) | `Editor`, `Admin` |
| `GET` | `/leave/{id}` | Read leave request details | `Viewer`, `Editor`, `Analyst`, `Admin` |
| `PATCH` | `/leave/{id}` | Forward-only status transition (`pending` $\to$ `approved` / `rejected`); immutable employee | `Editor`, `Admin` |
| `GET` | `/payroll-totals` | List department/month payroll aggregates for given `month=YYYY-MM` | `Viewer`, `Editor`, `Analyst`, `Admin` |
| `POST` | `/payroll-totals` | Record payroll total; aggregates only, employee lines strictly forbidden (FR-ERP5-06) | `Migration Runner`, `Admin` |
| `GET` | `/identity-users` | Read-only Hub Identity projection; zero local credential storage (FR-ERP5-05) | `Viewer`, `Editor`, `Analyst`, `Admin` |
| `GET` | `/migration-metadata` | Target entity schema and natural key descriptors for Migration Kit (`@cs/kit`) | `Migration Runner`, `Admin` |
| `GET` | `/rejections` | Module-specific rejection review context and reason code registry | `Viewer`, `Editor`, `Analyst`, `Admin` |

---

## 2. Execution & Test Commands

```bash
node -v                                     # Must be Node.js 24 LTS
npm install
npm run lint && npm run typecheck
npx vitest run apps/erp/modules/erp-5       # Full module suite: domain, api, security, migration, seed, web UI
DATABASE_URL_TEST=postgres://user:pass@localhost:5432/clearshift_test npx vitest run apps/erp/modules/erp-5/tests/db
```
*Note: DB constraint tests skip cleanly with an informative message when `DATABASE_URL_TEST` is not set.*

### Test Architecture

| Layer | Location | Test Count | Focus |
|---|---|---|---|
| Domain Rules & Invariants | `tests/domain/` | 41 | Temporal ordering, status transitions, cycle prevention |
| Fastify API Injections | `tests/api/` | 102 | Bounded pagination, status transitions, mutations, error envelope |
| OpenAPI & Contract Parity | `tests/contracts/` | 67 | Schema parity, error contracts, Zod synchronization |
| Security & Sensitive Masking | `tests/security/` | 115 | Real EdDSA JWT, role matrix, salary masking, safe logging |
| Data Quality & Migration | `tests/migration/` | 159 | Profiling, cleaning, mapping, reconciliation balance equation |
| Deterministic Seed Helper | `tests/seed/` | 5 | In-process public API seed execution and idempotency |
| React UI / RTL Components | `web/tests/` | 185 | Screen states, forms, employee list, routing, permissions |
| **Total Automated Tests** | | **859** | **100% Pass Rate (0 failures)** |

---

## 3. Deterministic Seed & Reset

Seed script operates exclusively through the public API using synthetic data only:
```bash
# Public API idempotent seed:
ERP5_BASE_URL=http://localhost:3000 ERP5_AUTH_TOKEN=role:admin node sample-data/erp-5/seed.ts

# Automated seed verification test (in-process):
npx vitest run apps/erp/modules/erp-5/tests/seed
```

---

## 4. Domain Invariants & Security Principles

1. **Temporal Ordering (BR-ERP5-01)**: `join_date` must never precede `birth_date`. Violations return HTTP 422 with `JOIN_DATE_BEFORE_BIRTH_DATE`.
2. **Salary Protection (BR-ERP5-02 / DR-5)**: Stored as exact `NUMERIC(20,4)` in PostgreSQL; strictly masked as `salary_display = "XX,XXX"` on serialization before network transmission, CSV export, or application logging.
3. **Leave Workflow (FR-ERP5-04)**: Status transitions move forward only (`pending` $\to$ `approved` / `rejected`). Once in a terminal state, mutations are rejected (`INVALID_LEAVE_STATUS_TRANSITION`). `date_to` must be on or after `date_from`.
4. **Boundary Isolation (FR-ERP5-06)**: Payroll output is strictly department/month aggregates (`gross_total`, `net_total`, `headcount`). Individual employee payslips or salary lines are forbidden.
5. **Deterministic Idempotency (KIT-08)**: Write operations require stable triple `(batch_id, source_row, idempotency_key)`. Dual-write with durable `erp5_import_receipts` guarantees replay safety.
6. **Hub Identity Projection (Decision C3)**: ERP-5 never stores passwords, salts, or credentials. User identity is projected read-only from central Hub Identity.

---

## 5. Gate G4 Release Sign-Off Record

- **Release Milestone**: Gate G4 — V1 Build Complete (Weeks 7–8)
- **Module**: ERP-5 HR and Employees
- **Assignee & QA Lead**: @saadmulla82 (Group 10, Role 4 — Data / QA Lead)
- **Product Owner Sign-Off**: Role 1 & Role 4 unanimous sign-off that 100% of V1 functional requirements (FR-ERP5-01..06) and domain rules (BR-ERP5-01..02) are satisfied with no deferred architecture choices and zero out-of-scope V2/V3 additions.
- **Verification Summary**:
  - Automated Tests: 859 tests passing across 41 suites.
  - Typecheck: `npx tsc --noEmit` clean (zero errors).
  - Formatting & Diffs: `git diff --check` clean.
  - Scripted Demo: `docs/demo-scripts/erp-5-v1.md` verified without manual SQL.
