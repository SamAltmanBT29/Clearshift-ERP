# ERP-5 HR & Employees — Security Note

**Issue**: [#191](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/191) — `[ERP5-15] Module authorization policy integration`
**Scope**: V1 · **Module**: ERP-5 HR & Employees (Group 10)
**Central matrix**: PLT-06 (`packages/core/src/auth/permissions.ts`, `apps/hub/src/policies/route-policy.ts`)
**Token verification**: PLT-05 (`@cs/identity` → `verifyAccessToken`)

This note describes the authorization posture of the ERP-5 module: who may do what, how a
caller is authenticated, and which fields never leave the module.

---

## 1. The declared policy matrix

The module owns **no** role list. Every route is bound to one entry of
`HR_ROUTE_POLICIES` (`src/policies/permissions.ts`), and the role sets mirror the central
matrix of PLT-06:

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

**Invariant: DEFAULT DENY.** A route without a policy entry, a policy that is not declared,
or a role that is not listed is refused with `403`.

The Migration Runner deliberately has **no read** access to the HR master data: it may load
a payroll aggregate (its declared job) and nothing else. It can never write into the `erp5`
tables directly — it goes through this module's public API (Decision C7).

## 2. Authentication

| Path | Behaviour |
|---|---|
| A real access token (three JWT segments) | Verified with the **shared** Hub verifier: the EdDSA signature, the issuer (`clearshift-hub`), the audience (`clearshift`) and the expiry (`exp`) are all checked. A disabled account is refused. |
| A synthetic local token (`role:<role>`, `user:<id>`) | Accepted so that the local unit tests can address a role. It is a **test affordance, not a credential**, and it grants nothing outside the test process. |
| `invalid`, `invalid-token`, `expired`, `disabled`, `user-disabled` | Refused with `401`. |
| No `Authorization` header | `401` when `authRequired` is on (the default); otherwise the local system identity. |
| A role the shared matrix does not know | No capability at all → `403`. |

When the module is mounted by the platform (`apps/api`), the platform's own authentication
has already populated `request.user`; the module's hook then leaves the verified identity
untouched.

## 3. The object-level guard

The policy is bound to an **entity kind**, and the identifier of a request is always
resolved inside the table that belongs to the route:

- A record of another kind is not addressable — the leave id read as an employee is a `404`.
- An identifier that belongs to **another module** (a Hub Identity user, for example) is
  not addressable either — it resolves to nothing and the mutation is refused with `404`.
  No row is ever mutated through it.
- A forbidden request is refused with `403` **before** the record is loaded, so a caller
  that may not write cannot learn whether a record exists.

### The known V1 limitation

ERP-5 has **no tenant and no per-user ownership dimension**: the `erp5` schema has no
organisation, tenant or owner column, and every record belongs to the single organisation
the module serves. The object-level guard can therefore only enforce *module* ownership.
The multi-tenant dimension is a schema item and is recorded as an open decision (DR-14);
it is **not** silently approximated by the guard.

## 4. Field-level protection

| Field | Rule | Where |
|---|---|---|
| `salary` (and the compensation fields) | The raw value **never leaves the module**. Every employee response carries `salary_display` = `XX,XXX` and no `salary` field (BR-ERP5-02). | `src/services/hr.service.ts` → `toHrEmployeeView()` |
| credentials, hashes, tokens | A payload that carries one is refused with `400 HR_CREDENTIALS_FORBIDDEN`. | `src/domain/rules.ts` |
| bank details, government identifiers | The module stores none, so none can be returned. | — |
| the Hub Identity projection | Read-only, and it carries **no** credential, hash, token or refresh-token column. The write privileges are revoked from `PUBLIC` by the migration. | `erp5_v1.sql`, `packages/database/migrations` |
| raw rows, SQL, stack traces | Never returned and never logged. An unexpected failure answers with a correlation id only. | `src/app.ts` |

> The visibility rule for the salary is recorded as **DR-5**: BR-ERP5-02 permits only the
> masked representations, while the central matrix of PLT-06 permits an Admin to see the
> value. The module implements the stricter rule and the divergence is escalated — it is
> not resolved silently in either direction.

## 5. Audit and logs

The module writes no audit trail of its own — the platform owns it (PLT-10). It never
logs a salary, a credential, a token or a raw row, and the correlation id is the only
handle a caller receives for an unexpected failure.

## 6. Test evidence

| Suite | Coverage |
|---|---|
| `apps/erp/modules/erp-5/tests/security/authorization.test.ts` | the declared matrix, the route × role matrix (16 routes × 5 roles), the JWT verification (real, forged, tampered, expired, disabled), and the object-level guard |
| `apps/erp/modules/erp-5/tests/api/mutations.test.ts` | the write authorization per endpoint (401 / 403) |
| `apps/erp/modules/erp-5/tests/api/list.test.ts` | the read authorization per collection (401 / 403) |
| `apps/erp/modules/erp-5/tests/db/repository.integration.test.ts` | the read-only Hub Identity projection (SQLSTATE `42501` for an application role) |
