/**
 * ERP-5 HR & Employees — Shared Route Guards
 *
 * Every route of the module is bound to a **declared** policy of
 * `HR_ROUTE_POLICIES` (see `src/policies/permissions.ts`). The role sets
 * come from the central matrix of PLT-06 — the module owns no role list of
 * its own.
 *
 * The policy is bound to an **entity kind**, which is the object-level
 * dimension: a route guarded by `hr.employees.update` can only ever reach an
 * employee row, because the service resolves the identifier in the table that
 * belongs to the route. An identifier of another module resolves to nothing
 * and is answered with `404` — no row is mutated through it.
 *
 * The Migration Kit therefore loads a payroll aggregate as MIGRATION_RUNNER
 * and can never write into the `erp5` tables directly (Decision C7): it goes
 * through this module's public API.
 *
 * @module erp5/routes/guard
 */

import { requireHrPolicy } from '../policies/guard.js';
import { HrPolicies } from '../policies/permissions.js';

// ── Employees (FR-ERP5-01/02) ───────────────────────────────────────────────
export const employeeReadGuard = requireHrPolicy(HrPolicies.EMPLOYEES_READ);
export const employeeCreateGuard = requireHrPolicy(HrPolicies.EMPLOYEES_CREATE);
export const employeeUpdateGuard = requireHrPolicy(HrPolicies.EMPLOYEES_UPDATE);

// ── Departments (FR-ERP5-03) ────────────────────────────────────────────────
export const departmentReadGuard = requireHrPolicy(HrPolicies.DEPARTMENTS_READ);
export const departmentCreateGuard = requireHrPolicy(HrPolicies.DEPARTMENTS_CREATE);
export const departmentUpdateGuard = requireHrPolicy(HrPolicies.DEPARTMENTS_UPDATE);

// ── Leave (FR-ERP5-04) ──────────────────────────────────────────────────────
export const leaveReadGuard = requireHrPolicy(HrPolicies.LEAVE_READ);
export const leaveCreateGuard = requireHrPolicy(HrPolicies.LEAVE_CREATE);
export const leaveUpdateGuard = requireHrPolicy(HrPolicies.LEAVE_UPDATE);

// ── Payroll aggregates (FR-ERP5-06) ─────────────────────────────────────────
export const payrollReadGuard = requireHrPolicy(HrPolicies.PAYROLL_READ);
export const payrollLoadGuard = requireHrPolicy(HrPolicies.PAYROLL_LOAD);

// ── Hub Identity projection (FR-ERP5-05) — read only ────────────────────────
export const identityUsersReadGuard = requireHrPolicy(HrPolicies.IDENTITY_USERS_READ);
