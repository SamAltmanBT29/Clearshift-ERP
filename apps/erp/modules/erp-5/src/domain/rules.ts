/**
 * ERP-5 HR & Employees — Domain Rules
 *
 * Pure, side-effect free invariants of the HR domain. The rules here are the
 * **first** line of defence; the PostgreSQL constraints of `erp5` are the
 * second one. Nothing in this file performs I/O, so every rule can be unit
 * tested without a database.
 *
 * Enforced invariants:
 *   - BR-ERP5-01  join date can never precede the birth date
 *   - BR-ERP5-02  salary is never disclosed in full and never logged
 *   - FR-ERP5-03  a department can never be its own parent and the hierarchy
 *                 stays acyclic
 *   - FR-ERP5-04  leave end date can never precede the start date
 *   - FR-ERP5-06  a payroll aggregate carries department totals only
 *   - C3          HR stores no credentials and grants no application roles
 *
 * @module erp5/domain/rules
 */

import { HR_DOMAIN_RULES } from '@clearshift/contracts';

/**
 * A violated domain invariant.
 *
 * The service layer converts it into the shared `{code, message, details}`
 * error envelope with `422 Unprocessable Entity`.
 */
export class HrDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'HrDomainError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Date rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BR-ERP5-01 — the join date can never precede the birth date.
 *
 * The same rule exists as the `employees_join_date_after_birth_date` CHECK
 * constraint in PostgreSQL.
 */
export function assertJoinDateNotBeforeBirthDate(birthDate: string, joinDate: string): void {
  if (joinDate < birthDate) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.JOIN_DATE_AFTER_BIRTH_DATE,
      'join_date must not be before birth_date.',
      { field: 'join_date', birth_date: birthDate, join_date: joinDate }
    );
  }
}

/**
 * FR-ERP5-04 — the leave end date can never precede the start date.
 *
 * The same rule exists as the `leave_date_range_valid` CHECK constraint.
 */
export function assertLeaveDateRange(dateFrom: string, dateTo: string): void {
  if (dateTo < dateFrom) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.LEAVE_DATE_RANGE_VALID,
      'date_to must not be before date_from.',
      { field: 'date_to', date_from: dateFrom, date_to: dateTo }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Money rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BR-ERP5-02 — a salary is never negative.
 *
 * The same rule exists as the `employees_salary_non_negative` CHECK
 * constraint.
 */
export function assertSalaryNotNegative(salary: string): void {
  if (!/^\d+(\.\d{1,4})?$/.test(salary)) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.SALARY_NON_NEGATIVE,
      'salary must be a non-negative amount.',
      { field: 'salary' }
    );
  }
}

/** A payroll aggregate amount is never negative. */
export function assertPayrollAmountNotNegative(totalAmount: string): void {
  if (!/^\d+(\.\d{1,4})?$/.test(totalAmount)) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.SALARY_NON_NEGATIVE,
      'total_amount must be a non-negative amount.',
      { field: 'total_amount' }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Department hierarchy rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FR-ERP5-03 — a department can never be its own parent.
 *
 * The same rule exists as the `departments_not_self_parent` CHECK constraint.
 */
export function assertDepartmentNotSelfParent(
  departmentId: string,
  parentId: string | null | undefined
): void {
  if (parentId !== null && parentId !== undefined && parentId === departmentId) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.DEPARTMENT_SELF_PARENT,
      'A department cannot be its own parent.',
      { field: 'parent_id', department_id: departmentId }
    );
  }
}

/**
 * FR-ERP5-03 — the department hierarchy stays acyclic.
 *
 * `ancestorIds` is the chain of ancestors of the proposed parent. When the
 * department being edited already appears in that chain, re-parenting it
 * would close a cycle.
 */
export function assertDepartmentHierarchyAcyclic(
  departmentId: string,
  parentId: string | null | undefined,
  ancestorIds: readonly string[]
): void {
  assertDepartmentNotSelfParent(departmentId, parentId);
  if (parentId === null || parentId === undefined) {
    return;
  }
  if (ancestorIds.includes(departmentId)) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.DEPARTMENT_CYCLE,
      'The department hierarchy would become circular.',
      { field: 'parent_id', department_id: departmentId, parent_id: parentId }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ownership / privacy rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * C3 — HR stores no credentials and grants no application roles.
 *
 * The Hub Identity projection is read-only and has no password, hash, token or
 * refresh-token field, so no ERP-5 write may carry one.
 */
export function assertNoIdentityCredentials(payload: Readonly<Record<string, unknown>>): void {
  const forbidden = [
    'password',
    'password_hash',
    'token',
    'access_token',
    'refresh_token',
    'secret',
    'roles',
    'role',
    'permissions',
  ];

  const offending = forbidden.find((key) => payload[key] !== undefined);
  if (offending !== undefined) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.CREDENTIALS_FORBIDDEN,
      `The field "${offending}" is not writable by the HR module.`,
      { field: offending }
    );
  }
}

/**
 * FR-ERP5-06 — a payroll aggregate carries department totals only.
 *
 * An employee-level field would turn the aggregate into a personal-data row.
 */
export function assertPayrollAggregateHasNoEmployeeRows(
  payload: Readonly<Record<string, unknown>>
): void {
  const forbidden = [
    'employee_id',
    'employee_no',
    'employee_ids',
    'employees',
    'first_name',
    'last_name',
    'birth_date',
    'salary',
  ];

  const offending = forbidden.find((key) => payload[key] !== undefined);
  if (offending !== undefined) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.PAYROLL_AGGREGATE_ONLY,
      `A payroll aggregate cannot carry the employee-level field "${offending}".`,
      { field: offending }
    );
  }
}
