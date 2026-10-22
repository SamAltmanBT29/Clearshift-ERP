/**
 * ERP-5 HR & Employees — Contract Tests
 *
 * The Zod contract is the API-facing expression of the schema rules. These
 * tests prove that the contract rejects the same invalid payloads that the
 * database constraints reject, and that the salary masking contract of
 * BR-ERP5-02 never leaks the underlying value.
 *
 * @module erp5/tests/contracts/erp-5.contract.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  CreateHrEmployeeRequestSchema,
  UpdateHrEmployeeRequestSchema,
  CreateHrLeaveRequestSchema,
  CreateHrDepartmentRequestSchema,
  CreateHrPayrollTotalRequestSchema,
  HrEmployeeListQuerySchema,
  HrEmployeeViewSchema,
  HrIdentityUserSchema,
  HR_SALARY_MASK,
  HR_SALARY_HIDDEN,
  HR_PAGE_SIZE_MAX,
  maskHrSalary,
  hideHrSalary,
} from '@clearshift/contracts';

const VALID_EMPLOYEE = {
  employee_no: 'EMP-0001',
  first_name: 'Asha',
  last_name: 'Iyer',
  birth_date: '1990-04-12',
  join_date: '2024-01-08',
  department_id: '11111111-1111-1111-1111-111111111111',
  job_title: 'Software Engineer',
  salary: '125000.0000',
  currency_code: 'INR',
};

describe('CreateHrEmployeeRequest', () => {
  it('accepts a valid employee', () => {
    const result = CreateHrEmployeeRequestSchema.safeParse(VALID_EMPLOYEE);
    expect(result.success).toBe(true);
  });

  it('[BR-ERP5-01] rejects a join date before the birth date', () => {
    const result = CreateHrEmployeeRequestSchema.safeParse({
      ...VALID_EMPLOYEE,
      join_date: '1989-01-08',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['join_date']);
      expect(result.error.issues[0]?.message).toMatch(/join_date must not be before birth_date/);
    }
  });

  it('accepts a join date equal to the birth date', () => {
    const result = CreateHrEmployeeRequestSchema.safeParse({
      ...VALID_EMPLOYEE,
      join_date: '1990-04-12',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative salary', () => {
    const result = CreateHrEmployeeRequestSchema.safeParse({ ...VALID_EMPLOYEE, salary: '-1' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed date', () => {
    const result = CreateHrEmployeeRequestSchema.safeParse({
      ...VALID_EMPLOYEE,
      birth_date: '12-04-1990',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a duplicate-looking employee number with illegal characters', () => {
    const result = CreateHrEmployeeRequestSchema.safeParse({
      ...VALID_EMPLOYEE,
      employee_no: 'EMP 0001',
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateHrEmployeeRequest', () => {
  it('rejects an empty patch', () => {
    expect(UpdateHrEmployeeRequestSchema.safeParse({}).success).toBe(false);
  });

  it('[BR-ERP5-01] rejects a patch whose join date precedes the birth date', () => {
    const result = UpdateHrEmployeeRequestSchema.safeParse({
      birth_date: '1990-04-12',
      join_date: '1989-01-08',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a single-field patch', () => {
    expect(UpdateHrEmployeeRequestSchema.safeParse({ job_title: 'Staff Engineer' }).success).toBe(
      true
    );
  });
});

describe('CreateHrLeaveRequest', () => {
  const VALID_LEAVE = {
    employee_id: '11111111-1111-1111-1111-111111111111',
    date_from: '2026-04-01',
    date_to: '2026-04-05',
    type: 'sick',
  };

  it('accepts a valid leave record', () => {
    expect(CreateHrLeaveRequestSchema.safeParse(VALID_LEAVE).success).toBe(true);
  });

  it('rejects an end date before the start date', () => {
    const result = CreateHrLeaveRequestSchema.safeParse({
      ...VALID_LEAVE,
      date_to: '2026-03-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown leave type', () => {
    const result = CreateHrLeaveRequestSchema.safeParse({ ...VALID_LEAVE, type: 'unpaid' });
    expect(result.success).toBe(false);
  });
});

describe('CreateHrDepartmentRequest', () => {
  it('accepts a department with and without a parent', () => {
    expect(
      CreateHrDepartmentRequestSchema.safeParse({ name: 'Engineering', code: 'ENG' }).success
    ).toBe(true);
    expect(
      CreateHrDepartmentRequestSchema.safeParse({
        name: 'Engineering West',
        code: 'ENG-W',
        parent_id: '11111111-1111-1111-1111-111111111111',
      }).success
    ).toBe(true);
  });

  it('rejects a missing code', () => {
    expect(CreateHrDepartmentRequestSchema.safeParse({ name: 'Engineering' }).success).toBe(false);
  });
});

describe('CreateHrPayrollTotalRequest', () => {
  it('accepts a valid aggregate', () => {
    const result = CreateHrPayrollTotalRequestSchema.safeParse({
      department_id: '11111111-1111-1111-1111-111111111111',
      month: '2026-04',
      total_amount: '500000.0000',
      headcount: 4,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed month', () => {
    const result = CreateHrPayrollTotalRequestSchema.safeParse({
      department_id: '11111111-1111-1111-1111-111111111111',
      month: '2026-13',
      total_amount: '500000.0000',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative headcount', () => {
    const result = CreateHrPayrollTotalRequestSchema.safeParse({
      department_id: '11111111-1111-1111-1111-111111111111',
      month: '2026-04',
      total_amount: '500000.0000',
      headcount: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe('Bounded pagination', () => {
  it('defaults to page 1 with 25 items', () => {
    const parsed = HrEmployeeListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(25);
  });

  it('rejects a page size above the hard cap', () => {
    expect(HrEmployeeListQuerySchema.safeParse({ pageSize: HR_PAGE_SIZE_MAX + 1 }).success).toBe(
      false
    );
    expect(HrEmployeeListQuerySchema.safeParse({ pageSize: HR_PAGE_SIZE_MAX }).success).toBe(true);
  });

  it('rejects a page below 1', () => {
    expect(HrEmployeeListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it('rejects a sort field outside the allow-list', () => {
    expect(HrEmployeeListQuerySchema.safeParse({ sort: 'salary' }).success).toBe(false);
  });
});

describe('Salary masking (BR-ERP5-02)', () => {
  it('masks a salary to the approved placeholder', () => {
    expect(maskHrSalary()).toBe(HR_SALARY_MASK);
    expect(maskHrSalary()).toBe('XX,XXX');
  });

  it('hides a salary entirely when it must not be disclosed', () => {
    expect(hideHrSalary()).toBe(HR_SALARY_HIDDEN);
    expect(hideHrSalary()).toBe('salary hidden');
  });

  it('never exposes a raw salary column in the viewer projection', () => {
    const parsed = HrEmployeeViewSchema.parse({
      id: '11111111-1111-1111-1111-111111111111',
      employee_no: 'EMP-0001',
      first_name: 'Asha',
      last_name: 'Iyer',
      birth_date: '1990-04-12',
      join_date: '2024-01-08',
      department_id: '22222222-2222-2222-2222-222222222222',
      job_title: 'Software Engineer',
      salary_display: 'XX,XXX',
      currency_code: 'INR',
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    });
    expect(parsed.salary_display).toBe('XX,XXX');
    expect(Object.keys(parsed)).not.toContain('salary');
  });
});

describe('Read-only identity projection', () => {
  it('accepts an identity user without any credential field', () => {
    const result = HrIdentityUserSchema.safeParse({
      id: '33333333-3333-3333-3333-333333333333',
      username: 'asha.iyer',
      roles: ['viewer'],
      employee_ref: null,
      status: 'active',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain('password');
      expect(Object.keys(result.data)).not.toContain('token');
    }
  });
});
