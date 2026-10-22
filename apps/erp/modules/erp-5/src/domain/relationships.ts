/**
 * ERP-5 HR & Employees — Relationship Rules, State Transitions and Read Model
 *
 * The deterministic domain layer of the module:
 *   - **relationships** — every required link is validated before the commit;
 *     an absent *optional* link produces an approved warning instead of a
 *     synthetic record
 *   - **state transitions** — the V1 leave state matrix, with an exact
 *     failure code and the allowed set in the message
 *   - **enumerations** — the approved leave type / status values, rejected
 *     with a stable code even outside the HTTP boundary
 *   - **read model** — the assertions that guarantee a persisted row and its
 *     public projection agree, immediately after a successful write
 *
 * Everything in this file is pure: no I/O, no repository, no HTTP. The
 * service layer supplies the data; the rules decide.
 *
 * @module erp5/domain/relationships
 */

import {
  HR_DOMAIN_RULES,
  HR_LEAVE_STATUS_TRANSITIONS,
  HR_LEAVE_STATUSES,
  HR_LEAVE_TERMINAL_STATUSES,
  HR_LEAVE_TYPES,
  HR_OPTIONAL_REFERENCE_ABSENT,
  type HrDepartment,
  type HrEmployee,
  type HrLeave,
  type HrPayrollTotal,
  type HrRelationshipWarning,
  type LeaveStatus,
  type LeaveType,
} from '@clearshift/contracts';
import { HrDomainError } from './rules.js';

// ─────────────────────────────────────────────────────────────────────────────
// Optional relationship handling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles an **optional** relationship.
 *
 * When the link is absent the module returns the approved warning and keeps
 * the value `null` — it never materialises a placeholder record. The caller
 * decides whether the warning is surfaced in the response.
 */
export function handleOptionalRelationship<T>(
  value: T | null | undefined,
  fieldName: string,
  relationshipName: string
): { value: T | null; warning?: HrRelationshipWarning } {
  if (value === null || value === undefined || value === '') {
    return {
      value: null,
      warning: {
        relationship: relationshipName,
        field: fieldName,
        code: HR_OPTIONAL_REFERENCE_ABSENT,
        message: `Optional relationship "${relationshipName}" on field "${fieldName}" is absent. No synthetic record was created.`,
      },
    };
  }
  return { value };
}

// ─────────────────────────────────────────────────────────────────────────────
// Enumeration rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FR-ERP5-04 — the leave type must be one of sick / holiday / other.
 *
 * The HTTP boundary rejects an unknown type with `400`; this rule is the
 * domain-level guarantee that also holds for a non-HTTP caller (the
 * Migration Kit adapter).
 */
export function assertValidLeaveType(value: string): asserts value is LeaveType {
  if (!(HR_LEAVE_TYPES as readonly string[]).includes(value)) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.INVALID_LEAVE_TYPE,
      `The leave type "${value}" is not one of the approved values [${HR_LEAVE_TYPES.join(', ')}].`,
      { field: 'type', allowed: [...HR_LEAVE_TYPES] }
    );
  }
}

/**
 * FR-ERP5-04 — the leave status must be one of pending / approved / rejected.
 */
export function assertValidLeaveStatus(value: string): asserts value is LeaveStatus {
  if (!(HR_LEAVE_STATUSES as readonly string[]).includes(value)) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.INVALID_LEAVE_STATUS,
      `The leave status "${value}" is not one of the approved values [${HR_LEAVE_STATUSES.join(', ')}].`,
      { field: 'status', allowed: [...HR_LEAVE_STATUSES] }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// State transition rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The V1 leave state matrix (ERP5-06).
 *
 * `pending → approved | rejected` is the only transition. `approved` and
 * `rejected` are terminal: a decision is not reversed and a leave is never
 * un-decided. Setting the same status again is a no-op, not an error — it
 * carries no state change.
 *
 * The full request → approve / reject **workflow with a log** is FR-ERP5-10
 * and stays in V2 (decision record DR-10).
 */
export function assertLeaveStatusTransition(current: LeaveStatus, next: LeaveStatus): void {
  if (current === next) {
    return;
  }

  const allowed = HR_LEAVE_STATUS_TRANSITIONS[current] ?? [];

  if (!allowed.includes(next)) {
    const terminal = (HR_LEAVE_TERMINAL_STATUSES as readonly string[]).includes(current);
    throw new HrDomainError(
      HR_DOMAIN_RULES.INVALID_LEAVE_STATUS_TRANSITION,
      terminal
        ? `A leave record in the terminal status "${current}" cannot transition to "${next}". Allowed transitions from "${current}": none.`
        : `A leave record cannot transition from "${current}" to "${next}". Allowed transitions from "${current}": [${allowed.join(', ') || 'none'}].`,
      {
        field: 'status',
        current_status: current,
        requested_status: next,
        allowed: [...allowed],
        terminal,
      }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-model consistency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read-model assertions.
 *
 * They guarantee that a persisted row and its public projection agree right
 * after a successful write, so the UI and the read API can never show a
 * status, a link or a derived total that the database does not hold.
 */
export function assertHrEmployeeReadConsistency(employee: HrEmployee): void {
  if (!employee.id || !employee.employee_no || !employee.department_id) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'The employee row is missing a mandatory link.',
      { field: 'employee' }
    );
  }
  if (employee.join_date < employee.birth_date) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'The employee row violates the join-date invariant.',
      { field: 'join_date' }
    );
  }
  if (!/^\d+(\.\d{1,4})?$/.test(employee.salary)) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'The employee row carries an invalid salary amount.',
      { field: 'salary' }
    );
  }
}

export function assertHrDepartmentReadConsistency(department: HrDepartment): void {
  if (!department.id || !department.code) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'The department row is missing a mandatory field.',
      { field: 'department' }
    );
  }
  if (department.parent_id !== null && department.parent_id === department.id) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'The department row is its own parent.',
      { field: 'parent_id' }
    );
  }
}

export function assertHrLeaveReadConsistency(leave: HrLeave): void {
  if (!leave.id || !leave.employee_id) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'The leave row is missing its employee link.',
      { field: 'leave' }
    );
  }
  if (leave.date_to < leave.date_from) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'The leave row violates the date-range invariant.',
      { field: 'date_to' }
    );
  }
  assertValidLeaveType(leave.type);
  assertValidLeaveStatus(leave.status);
}

export function assertHrPayrollTotalReadConsistency(total: HrPayrollTotal): void {
  if (!total.id || !total.department_id) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'The payroll aggregate is missing its department link.',
      { field: 'payroll_total' }
    );
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(total.month)) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'The payroll aggregate carries an invalid month label.',
      { field: 'month' }
    );
  }
  if (!/^\d+(\.\d{1,4})?$/.test(total.total_amount) || total.headcount < 0) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
      'The payroll aggregate carries an invalid amount or headcount.',
      { field: 'total_amount' }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Relationship completeness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The source identity is a **pair**: `source_system` and `source_id`.
 *
 * Half a source identity is not a valid state — it would claim a source
 * without identifying the row inside it, or identify a row without naming
 * the source. Both are rejected with a stable code.
 */
export function assertSourceIdentityIsComplete(
  sourceSystem: string | null | undefined,
  sourceId: string | null | undefined
): void {
  const hasSystem = sourceSystem !== null && sourceSystem !== undefined && sourceSystem !== '';
  const hasId = sourceId !== null && sourceId !== undefined && sourceId !== '';

  if (hasSystem !== hasId) {
    throw new HrDomainError(
      HR_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE,
      'source_system and source_id must be supplied together — a partial source identity is not a valid state.',
      { field: hasSystem ? 'source_id' : 'source_system' }
    );
  }
}
