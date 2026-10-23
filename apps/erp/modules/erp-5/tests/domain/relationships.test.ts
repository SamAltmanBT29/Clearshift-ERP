/**
 * ERP-5 HR & Employees — Relationship, State Transition and Read-Model Tests
 *
 * The pure domain layer of issue #51 (`ERP5-06`), asserted directly:
 *
 *   - **relationships** — an absent optional relationship produces the
 *     approved warning and never a synthetic record
 *   - **enumerations** — every approved leave type / status is accepted and
 *     every unknown value is rejected with a stable code
 *   - **state transitions** — each allowed and each forbidden transition of the
 *     V1 leave state matrix
 *   - **read model** — a persisted row and its public projection must agree
 *   - **source identity** — the pair is all or nothing
 *
 * @module erp5/tests/domain/relationships.test
 */

import { describe, it, expect } from 'vitest';
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
} from '@clearshift/contracts';
import {
  assertHrDepartmentReadConsistency,
  assertHrEmployeeReadConsistency,
  assertHrLeaveReadConsistency,
  assertHrPayrollTotalReadConsistency,
  assertLeaveStatusTransition,
  assertSourceIdentityIsComplete,
  assertValidLeaveStatus,
  assertValidLeaveType,
  handleOptionalRelationship,
} from '../../src/domain/relationships.js';
import { HrDomainError } from '../../src/domain/rules.js';

const EMPLOYEE: HrEmployee = {
  id: '11111111-1111-1111-1111-111111111111',
  employee_no: 'EMP-0001',
  first_name: 'Asha',
  last_name: 'Iyer',
  birth_date: '1990-04-12',
  join_date: '2024-01-08',
  department_id: '22222222-2222-2222-2222-222222222222',
  job_title: 'Software Engineer',
  salary: '125000.0000',
  currency_code: 'INR',
  source_system: null,
  source_id: null,
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
};

const DEPARTMENT: HrDepartment = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Engineering',
  code: 'ENG',
  parent_id: null,
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
};

const LEAVE: HrLeave = {
  id: '33333333-3333-3333-3333-333333333333',
  employee_id: EMPLOYEE.id,
  date_from: '2026-04-01',
  date_to: '2026-04-05',
  type: 'sick',
  status: 'pending',
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
};

const PAYROLL_TOTAL: HrPayrollTotal = {
  id: '44444444-4444-4444-4444-444444444444',
  department_id: DEPARTMENT.id,
  month: '2026-04',
  total_amount: '250000.0000',
  currency_code: 'INR',
  headcount: 2,
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
};

describe('Optional relationships (ERP5-06)', () => {
  it('keeps a present value and reports no warning', () => {
    const result = handleOptionalRelationship('22222222-2222-2222-2222-222222222222', 'parent_id', 'DEPARTMENT_PARENT');
    expect(result.value).toBe('22222222-2222-2222-2222-222222222222');
    expect(result.warning).toBeUndefined();
  });

  it('reports the approved warning for an absent relationship', () => {
    const result = handleOptionalRelationship(null, 'parent_id', 'DEPARTMENT_PARENT');
    expect(result.value).toBeNull();
    expect(result.warning?.code).toBe(HR_OPTIONAL_REFERENCE_ABSENT);
    expect(result.warning?.relationship).toBe('DEPARTMENT_PARENT');
    expect(result.warning?.field).toBe('parent_id');
    expect(result.warning?.message).toContain('No synthetic record was created');
  });

  it('treats an empty string as absent', () => {
    const result = handleOptionalRelationship('', 'parent_id', 'DEPARTMENT_PARENT');
    expect(result.value).toBeNull();
    expect(result.warning).toBeDefined();
  });
});

describe('Enumerations (ERP5-06)', () => {
  it('accepts every approved leave type', () => {
    for (const type of HR_LEAVE_TYPES) {
      expect(() => assertValidLeaveType(type)).not.toThrow();
    }
  });

  it('rejects an unknown leave type with a stable code', () => {
    try {
      assertValidLeaveType('unpaid');
      expect.unreachable('the rule must reject the value');
    } catch (error) {
      expect(error).toBeInstanceOf(HrDomainError);
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.INVALID_LEAVE_TYPE);
      expect((error as HrDomainError).context['field']).toBe('type');
    }
  });

  it('accepts every approved leave status', () => {
    for (const status of HR_LEAVE_STATUSES) {
      expect(() => assertValidLeaveStatus(status)).not.toThrow();
    }
  });

  it('rejects an unknown leave status with a stable code', () => {
    try {
      assertValidLeaveStatus('cancelled');
      expect.unreachable('the rule must reject the value');
    } catch (error) {
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.INVALID_LEAVE_STATUS);
      expect((error as HrDomainError).context['field']).toBe('status');
    }
  });
});

describe('Leave state matrix (ERP5-06)', () => {
  it('allows pending → approved', () => {
    expect(() => assertLeaveStatusTransition('pending', 'approved')).not.toThrow();
  });

  it('allows pending → rejected', () => {
    expect(() => assertLeaveStatusTransition('pending', 'rejected')).not.toThrow();
  });

  it('treats the same status as a no-op', () => {
    expect(() => assertLeaveStatusTransition('pending', 'pending')).not.toThrow();
    expect(() => assertLeaveStatusTransition('approved', 'approved')).not.toThrow();
    expect(() => assertLeaveStatusTransition('rejected', 'rejected')).not.toThrow();
  });

  it('forbids approved → rejected', () => {
    try {
      assertLeaveStatusTransition('approved', 'rejected');
      expect.unreachable('the rule must reject the transition');
    } catch (error) {
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.INVALID_LEAVE_STATUS_TRANSITION);
      expect((error as HrDomainError).context['current_status']).toBe('approved');
      expect((error as HrDomainError).context['requested_status']).toBe('rejected');
      expect((error as HrDomainError).context['terminal']).toBe(true);
    }
  });

  it('forbids rejected → approved', () => {
    expect(() => assertLeaveStatusTransition('rejected', 'approved')).toThrow(HrDomainError);
  });

  it('forbids un-deciding a decided leave', () => {
    try {
      assertLeaveStatusTransition('approved', 'pending');
      expect.unreachable('the rule must reject the transition');
    } catch (error) {
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.INVALID_LEAVE_STATUS_TRANSITION);
    }
  });

  it('declares exactly the documented matrix', () => {
    expect(HR_LEAVE_STATUS_TRANSITIONS.pending).toEqual(['approved', 'rejected']);
    expect(HR_LEAVE_STATUS_TRANSITIONS.approved).toEqual([]);
    expect(HR_LEAVE_STATUS_TRANSITIONS.rejected).toEqual([]);
    expect([...HR_LEAVE_TERMINAL_STATUSES].sort()).toEqual(['approved', 'rejected']);
  });
});

describe('Read-model consistency (ERP5-06)', () => {
  it('accepts a consistent employee', () => {
    expect(() => assertHrEmployeeReadConsistency(EMPLOYEE)).not.toThrow();
  });

  it('rejects an employee whose join date precedes the birth date', () => {
    try {
      assertHrEmployeeReadConsistency({ ...EMPLOYEE, join_date: '1989-01-01' });
      expect.unreachable('the rule must reject the row');
    } catch (error) {
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT);
    }
  });

  it('rejects an employee without a department link', () => {
    expect(() =>
      assertHrEmployeeReadConsistency({ ...EMPLOYEE, department_id: '' })
    ).toThrow(HrDomainError);
  });

  it('rejects an employee with an invalid salary', () => {
    expect(() => assertHrEmployeeReadConsistency({ ...EMPLOYEE, salary: 'n/a' })).toThrow(
      HrDomainError
    );
  });

  it('accepts a consistent department and rejects a self-parenting one', () => {
    expect(() => assertHrDepartmentReadConsistency(DEPARTMENT)).not.toThrow();
    expect(() =>
      assertHrDepartmentReadConsistency({ ...DEPARTMENT, parent_id: DEPARTMENT.id })
    ).toThrow(HrDomainError);
  });

  it('accepts a consistent leave and rejects a broken date range', () => {
    expect(() => assertHrLeaveReadConsistency(LEAVE)).not.toThrow();
    try {
      assertHrLeaveReadConsistency({ ...LEAVE, date_to: '2026-03-01' });
      expect.unreachable('the rule must reject the row');
    } catch (error) {
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT);
    }
  });

  it('rejects a leave whose status is outside the enumeration', () => {
    expect(() => assertHrLeaveReadConsistency({ ...LEAVE, status: 'cancelled' as never })).toThrow(
      HrDomainError
    );
  });

  it('accepts a consistent payroll aggregate and rejects a broken one', () => {
    expect(() => assertHrPayrollTotalReadConsistency(PAYROLL_TOTAL)).not.toThrow();
    expect(() =>
      assertHrPayrollTotalReadConsistency({ ...PAYROLL_TOTAL, month: '2026-13' })
    ).toThrow(HrDomainError);
    expect(() =>
      assertHrPayrollTotalReadConsistency({ ...PAYROLL_TOTAL, headcount: -1 })
    ).toThrow(HrDomainError);
  });
});

describe('Source identity completeness (ERP5-06)', () => {
  it('accepts a complete pair and a fully absent pair', () => {
    expect(() => assertSourceIdentityIsComplete('legacy_hr_csv', 'row-1')).not.toThrow();
    expect(() => assertSourceIdentityIsComplete(null, null)).not.toThrow();
    expect(() => assertSourceIdentityIsComplete(undefined, undefined)).not.toThrow();
  });

  it('rejects a half-set source identity', () => {
    try {
      assertSourceIdentityIsComplete('legacy_hr_csv', null);
      expect.unreachable('the rule must reject the value');
    } catch (error) {
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE);
      expect((error as HrDomainError).context['field']).toBe('source_id');
    }

    expect(() => assertSourceIdentityIsComplete(null, 'row-1')).toThrow(HrDomainError);
  });
});
