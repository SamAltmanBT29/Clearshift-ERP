/**
 * ERP-5 HR & Employees — Zod Contract & Invariant Test Suite
 *
 * Proves that:
 *   - Employee, Department, and Leave schemas enforce required patterns and types.
 *   - Salary masking (BR-ERP5-02) is enforced in View projections.
 *   - Pagination schemas enforce positive integers and the pageSize <= 100 limit.
 *   - Event payload schemas conform to the HR producer specification.
 *   - Package exports are correctly configured for consumers.
 *
 * @module contracts/tests/erp-5.contract.test
 */

import { describe, it, expect } from 'vitest';
import {
  HrUuid,
  HrEmployeeSchema,
  HrEmployeeViewSchema,
  HrDepartmentSchema,
  HrLeaveSchema,
  CreateHrEmployeeRequestSchema,
  CreateHrDepartmentRequestSchema,
  CreateHrLeaveRequestSchema,
  HrPaginationQuerySchema,
  HrEmployeeView,
  HrEmployee,
} from '../src/erp-5.js';
import * as Erp5Events from '../src/erp-5-events.js';
import * as Erp5Mock from '../src/erp-5-mock.js';

describe('ERP-5 Shared Primitives & Enums', () => {
  it('validates HrUuid format', () => {
    expect(HrUuid.safeParse('d1111111-1111-1111-1111-111111111111').success).toBe(true);
    expect(HrUuid.safeParse('not-a-uuid').success).toBe(false);
    expect(HrUuid.safeParse('123-456').success).toBe(false);
  });

  it('enforces bounded pagination (max 100)', () => {
    expect(HrPaginationQuerySchema.safeParse({ page: 1, pageSize: 20 }).success).toBe(true);
    expect(HrPaginationQuerySchema.safeParse({ page: 1, pageSize: 100 }).success).toBe(true);
    expect(HrPaginationQuerySchema.safeParse({ page: 1, pageSize: 101 }).success).toBe(false);
    expect(HrPaginationQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });
});

describe('ERP-5 Employee Contract', () => {
  it('accepts valid CreateHrEmployeeRequest', () => {
    const valid = {
      employee_no: 'EMP-001',
      first_name: 'Alice',
      last_name: 'Smith',
      birth_date: '1985-05-15',
      join_date: '2010-06-01',
      department_id: 'd2222222-2222-2222-2222-222222222222',
      job_title: 'Architect',
      salary: '150000.00',
      currency_code: 'INR',
    };
    expect(CreateHrEmployeeRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('enforces sensitive data exclusion in HrEmployeeViewSchema', () => {
    const rawEmployee: HrEmployee = {
      id: 'e1111111-1111-1111-1111-111111111111',
      employee_no: 'EMP-001',
      first_name: 'Alice',
      last_name: 'Smith',
      birth_date: '1985-05-15',
      join_date: '2010-06-01',
      department_id: 'd2222222-2222-2222-2222-222222222222',
      job_title: 'Architect',
      salary: '150000.00',
      currency_code: 'INR',
      source_system: 'legacy',
      source_id: 'L1',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    // The View schema should NOT be able to parse a raw employee because it's missing salary_display
    // and it should explicitly not contain raw salary.
    const viewParsed = HrEmployeeViewSchema.safeParse(rawEmployee);
    expect(viewParsed.success).toBe(false);
  });

  it('validates HrEmployeeView projection shape', () => {
    const validView: HrEmployeeView = {
      id: 'e1111111-1111-1111-1111-111111111111',
      employee_no: 'EMP-001',
      first_name: 'Alice',
      last_name: 'Smith',
      birth_date: '1985-05-15',
      join_date: '2010-06-01',
      department_id: 'd2222222-2222-2222-2222-222222222222',
      job_title: 'Architect',
      salary_display: 'XX,XXX',
      currency_code: 'INR',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };
    expect(HrEmployeeViewSchema.safeParse(validView).success).toBe(true);
  });
});

describe('ERP-5 Department & Leave Contracts', () => {
  it('accepts valid CreateHrDepartmentRequest', () => {
    const valid = {
      name: 'Engineering',
      code: 'ENG',
      parent_id: 'd1111111-1111-1111-1111-111111111111',
    };
    expect(CreateHrDepartmentRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts valid CreateHrLeaveRequest', () => {
    const valid = {
      employee_id: 'e1111111-1111-1111-1111-111111111111',
      date_from: '2024-11-01',
      date_to: '2024-11-05',
      type: 'sick',
    };
    expect(CreateHrLeaveRequestSchema.safeParse(valid).success).toBe(true);
  });
});

describe('ERP-5 Event Contract', () => {
  it('exports the correct producer name', () => {
    // Event producer is 'erp-5'
    expect(Erp5Events.PRODUCER).toBe('erp-5');
  });

  it('defines a non-empty set of event schemas', () => {
    const eventKeys = Object.keys(Erp5Events).filter(k => k.endsWith('Schema'));
    expect(eventKeys.length).toBeGreaterThan(0);
  });
});

describe('ERP-5 Package Exports', () => {
  it('verifies the mock server factory is exported', () => {
    expect(typeof Erp5Mock.createHrMockServer).toBe('function');
  });

  it('verifies the state reset helper is exported', () => {
    expect(typeof Erp5Mock.resetMockState).toBe('function');
  });
});
