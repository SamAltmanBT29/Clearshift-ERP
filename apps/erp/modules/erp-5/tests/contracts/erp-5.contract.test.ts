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
  UpdateHrLeaveRequestSchema,
  CreateHrDepartmentRequestSchema,
  CreateHrPayrollTotalRequestSchema,
  HrEmployeeListQuerySchema,
  HrEmployeeViewSchema,
  HrEmployeeMutationResponseSchema,
  HrDepartmentMutationResponseSchema,
  HrLeaveMutationResponseSchema,
  HrPayrollTotalMutationResponseSchema,
  HrIdParamSchema,
  HrIdentityUserSchema,
  HrRelationshipWarningSchema,
  HR_DOMAIN_RULES,
  HR_LEAVE_STATUS_TRANSITIONS,
  HR_LEAVE_STATUSES,
  HR_LEAVE_TERMINAL_STATUSES,
  HR_LEAVE_TYPES,
  HR_OPTIONAL_REFERENCE_ABSENT,
  HR_UNPROCESSABLE_CODES,
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

// ─────────────────────────────────────────────────────────────────────────────
// Mutation contract (issue #48)
// ─────────────────────────────────────────────────────────────────────────────

describe('Protected and system-maintained fields', () => {
  it('rejects an unknown key on an employee create', () => {
    const result = CreateHrEmployeeRequestSchema.safeParse({
      ...VALID_EMPLOYEE,
      id: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
    }
  });

  it('rejects an unknown key on a department create', () => {
    const result = CreateHrDepartmentRequestSchema.safeParse({
      name: 'Engineering',
      code: 'ENG',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown key on a leave create', () => {
    const result = CreateHrLeaveRequestSchema.safeParse({
      employee_id: '11111111-1111-1111-1111-111111111111',
      date_from: '2026-04-01',
      date_to: '2026-04-05',
      type: 'sick',
      // A credential field is never part of an ERP-5 write payload (C3).
      password: 'n/a',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown key on a payroll aggregate create', () => {
    const result = CreateHrPayrollTotalRequestSchema.safeParse({
      department_id: '11111111-1111-1111-1111-111111111111',
      month: '2026-04',
      total_amount: '500000.0000',
      employee_id: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.success).toBe(false);
  });

  it('never accepts currency_code on an employee edit', () => {
    const result = UpdateHrEmployeeRequestSchema.safeParse({
      job_title: 'Staff Engineer',
      currency_code: 'EUR',
    });
    expect(result.success).toBe(false);
  });

  it('never accepts source identity on an employee edit', () => {
    const result = UpdateHrEmployeeRequestSchema.safeParse({
      source_system: 'legacy_hr_csv',
      source_id: 'row-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('Import provenance', () => {
  it('accepts batch_id, source_row and idempotency_key together', () => {
    const result = CreateHrEmployeeRequestSchema.safeParse({
      ...VALID_EMPLOYEE,
      batch_id: '44444444-4444-4444-4444-444444444444',
      source_row: 12,
      idempotency_key: 'erp5-batch-12',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed batch id', () => {
    const result = CreateHrEmployeeRequestSchema.safeParse({
      ...VALID_EMPLOYEE,
      batch_id: 'not-a-uuid',
      source_row: 12,
      idempotency_key: 'erp5-batch-12',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative source row', () => {
    const result = CreateHrEmployeeRequestSchema.safeParse({
      ...VALID_EMPLOYEE,
      batch_id: '44444444-4444-4444-4444-444444444444',
      source_row: -1,
      idempotency_key: 'erp5-batch-12',
    });
    expect(result.success).toBe(false);
  });
});

describe('Stable business-rule codes', () => {
  it('carries the join-date code on the BR-ERP5-01 refinement', () => {
    const result = CreateHrEmployeeRequestSchema.safeParse({
      ...VALID_EMPLOYEE,
      join_date: '1989-01-08',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe('custom');
      expect(
        (result.error.issues[0] as { params?: { code?: string } }).params?.code
      ).toBe(HR_DOMAIN_RULES.JOIN_DATE_AFTER_BIRTH_DATE);
    }
  });

  it('carries the leave-range code on the date-range refinement', () => {
    const result = CreateHrLeaveRequestSchema.safeParse({
      employee_id: '11111111-1111-1111-1111-111111111111',
      date_from: '2026-04-01',
      date_to: '2026-03-01',
      type: 'sick',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        (result.error.issues[0] as { params?: { code?: string } }).params?.code
      ).toBe(HR_DOMAIN_RULES.LEAVE_DATE_RANGE_VALID);
    }
  });

  it('classifies the business rules as unprocessable (422)', () => {
    expect(HR_UNPROCESSABLE_CODES).toContain(HR_DOMAIN_RULES.JOIN_DATE_AFTER_BIRTH_DATE);
    expect(HR_UNPROCESSABLE_CODES).toContain(HR_DOMAIN_RULES.LEAVE_DATE_RANGE_VALID);
    expect(HR_UNPROCESSABLE_CODES).toContain(HR_DOMAIN_RULES.SALARY_NON_NEGATIVE);
    expect(HR_UNPROCESSABLE_CODES).toContain(HR_DOMAIN_RULES.DEPARTMENT_SELF_PARENT);
    expect(HR_UNPROCESSABLE_CODES).toContain(HR_DOMAIN_RULES.DEPARTMENT_CYCLE);
  });
});

describe('Mutation response schemas', () => {
  const EMPLOYEE_VIEW = {
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
  };

  it('accepts a masked employee without a raw salary', () => {
    const parsed = HrEmployeeMutationResponseSchema.parse(EMPLOYEE_VIEW);
    expect(parsed.salary_display).toBe(HR_SALARY_MASK);
    expect(Object.keys(parsed)).not.toContain('salary');
  });

  it('accepts an import receipt alongside the entity', () => {
    const parsed = HrEmployeeMutationResponseSchema.parse({
      ...EMPLOYEE_VIEW,
      import_receipt: {
        id: '55555555-5555-5555-5555-555555555555',
        batch_id: '44444444-4444-4444-4444-444444444444',
        source_row: 12,
        entity: 'employee',
        schema_version: 1,
        idempotency_key: 'erp5-batch-12',
        request_hash: 'e'.repeat(64),
        target_id: EMPLOYEE_VIEW.id,
        kind: 'created',
        created_at: '2026-04-01T00:00:00.000Z',
      },
    });
    expect(parsed.import_receipt?.idempotency_key).toBe('erp5-batch-12');
  });

  it('accepts the department, leave and payroll mutation responses', () => {
    expect(
      HrDepartmentMutationResponseSchema.parse({
        id: '66666666-6666-6666-6666-666666666666',
        name: 'Engineering',
        code: 'ENG',
        parent_id: null,
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      }).code
    ).toBe('ENG');

    expect(
      HrLeaveMutationResponseSchema.parse({
        id: '77777777-7777-7777-7777-777777777777',
        employee_id: EMPLOYEE_VIEW.id,
        date_from: '2026-04-01',
        date_to: '2026-04-05',
        type: 'sick',
        status: 'pending',
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      }).type
    ).toBe('sick');

    expect(
      HrPayrollTotalMutationResponseSchema.parse({
        id: '88888888-8888-8888-8888-888888888888',
        department_id: '22222222-2222-2222-2222-222222222222',
        month: '2026-04',
        total_amount: '500000.0000',
        currency_code: 'INR',
        headcount: 4,
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      }).month
    ).toBe('2026-04');
  });
});

describe('Resource id parameter', () => {
  it('accepts a uuid', () => {
    expect(
      HrIdParamSchema.safeParse({ id: '11111111-1111-1111-1111-111111111111' }).success
    ).toBe(true);
  });

  it('rejects anything that is not a uuid', () => {
    expect(HrIdParamSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mutation contract — relationships and state transitions (issue #51)
// ─────────────────────────────────────────────────────────────────────────────

describe('Leave update contract (ERP5-06)', () => {
  it('accepts a status transition request', () => {
    expect(UpdateHrLeaveRequestSchema.safeParse({ status: 'approved' }).success).toBe(true);
    expect(UpdateHrLeaveRequestSchema.safeParse({ date_to: '2026-05-08' }).success).toBe(true);
    expect(UpdateHrLeaveRequestSchema.safeParse({ type: 'holiday' }).success).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(UpdateHrLeaveRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(UpdateHrLeaveRequestSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(UpdateHrLeaveRequestSchema.safeParse({ type: 'unpaid' }).success).toBe(false);
  });

  it('rejects the immutable recorded subject', () => {
    const result = UpdateHrLeaveRequestSchema.safeParse({
      employee_id: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a date range that ends before it starts', () => {
    const result = UpdateHrLeaveRequestSchema.safeParse({
      date_from: '2026-05-08',
      date_to: '2026-05-01',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        (result.error.issues[0] as { params?: { code?: string } }).params?.code
      ).toBe(HR_DOMAIN_RULES.LEAVE_DATE_RANGE_VALID);
    }
  });
});

describe('Leave state matrix contract (ERP5-06)', () => {
  it('declares the approved statuses and types', () => {
    expect([...HR_LEAVE_STATUSES].sort()).toEqual(['approved', 'pending', 'rejected']);
    expect([...HR_LEAVE_TYPES].sort()).toEqual(['holiday', 'other', 'sick']);
  });

  it('declares pending as the only state that can move', () => {
    expect(HR_LEAVE_STATUS_TRANSITIONS.pending).toEqual(['approved', 'rejected']);
    expect(HR_LEAVE_STATUS_TRANSITIONS.approved).toEqual([]);
    expect(HR_LEAVE_STATUS_TRANSITIONS.rejected).toEqual([]);
  });

  it('declares the decided states as terminal', () => {
    expect([...HR_LEAVE_TERMINAL_STATUSES].sort()).toEqual(['approved', 'rejected']);
  });
});

describe('Relationship warning contract (ERP5-06)', () => {
  it('accepts the approved warning shape', () => {
    const result = HrRelationshipWarningSchema.safeParse({
      relationship: 'DEPARTMENT_PARENT',
      field: 'parent_id',
      code: HR_OPTIONAL_REFERENCE_ABSENT,
      message: 'Optional relationship "DEPARTMENT_PARENT" on field "parent_id" is absent.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a warning with a foreign code', () => {
    expect(
      HrRelationshipWarningSchema.safeParse({
        relationship: 'DEPARTMENT_PARENT',
        field: 'parent_id',
        code: 'OPTIONAL_REFERENCE_ABSENT',
        message: 'x',
      }).success
    ).toBe(false);
  });

  it('carries the warning on a mutation response', () => {
    const parsed = HrDepartmentMutationResponseSchema.parse({
      id: '66666666-6666-6666-6666-666666666666',
      name: 'Engineering',
      code: 'ENG',
      parent_id: null,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
      warnings: [
        {
          relationship: 'DEPARTMENT_PARENT',
          field: 'parent_id',
          code: HR_OPTIONAL_REFERENCE_ABSENT,
          message: 'absent',
        },
      ],
    });
    expect(parsed.warnings).toHaveLength(1);
  });

  it('classifies the new relationship rules as unprocessable (422)', () => {
    expect(HR_UNPROCESSABLE_CODES).toContain(HR_DOMAIN_RULES.INVALID_LEAVE_STATUS_TRANSITION);
    expect(HR_UNPROCESSABLE_CODES).toContain(HR_DOMAIN_RULES.INVALID_LEAVE_TYPE);
    expect(HR_UNPROCESSABLE_CODES).toContain(HR_DOMAIN_RULES.INVALID_LEAVE_STATUS);
    expect(HR_UNPROCESSABLE_CODES).toContain(HR_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE);
    expect(HR_UNPROCESSABLE_CODES).toContain(HR_DOMAIN_RULES.READ_MODEL_INCONSISTENT);
  });
});
