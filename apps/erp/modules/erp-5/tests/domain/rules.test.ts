/**
 * ERP-5 HR & Employees — Domain Rule Unit Tests
 *
 * The pure invariants of the module, asserted directly. No database, no HTTP
 * layer — just the rules that the service layer and the PostgreSQL
 * constraints both enforce.
 *
 * @module erp5/tests/domain/rules.test
 */

import { describe, it, expect } from 'vitest';
import { HR_DOMAIN_RULES } from '@clearshift/contracts';
import {
  HrDomainError,
  assertDepartmentHierarchyAcyclic,
  assertDepartmentNotSelfParent,
  assertJoinDateNotBeforeBirthDate,
  assertLeaveDateRange,
  assertNoIdentityCredentials,
  assertPayrollAggregateHasNoEmployeeRows,
  assertPayrollAmountNotNegative,
  assertSalaryNotNegative,
} from '../../src/domain/rules.js';

describe('Join date rule (BR-ERP5-01)', () => {
  it('accepts a join date after the birth date', () => {
    expect(() => assertJoinDateNotBeforeBirthDate('1990-04-12', '2024-01-08')).not.toThrow();
  });

  it('accepts a join date equal to the birth date', () => {
    expect(() => assertJoinDateNotBeforeBirthDate('1990-04-12', '1990-04-12')).not.toThrow();
  });

  it('rejects a join date before the birth date', () => {
    expect(() => assertJoinDateNotBeforeBirthDate('1990-04-12', '1989-01-08')).toThrow(
      HrDomainError
    );

    try {
      assertJoinDateNotBeforeBirthDate('1990-04-12', '1989-01-08');
      expect.unreachable('the rule must reject the value');
    } catch (error) {
      expect(error).toBeInstanceOf(HrDomainError);
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.JOIN_DATE_AFTER_BIRTH_DATE);
      expect((error as HrDomainError).context['field']).toBe('join_date');
    }
  });
});

describe('Leave date range rule (FR-ERP5-04)', () => {
  it('accepts a valid range', () => {
    expect(() => assertLeaveDateRange('2026-04-01', '2026-04-05')).not.toThrow();
  });

  it('rejects a range that ends before it starts', () => {
    try {
      assertLeaveDateRange('2026-04-05', '2026-04-01');
      expect.unreachable('the rule must reject the value');
    } catch (error) {
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.LEAVE_DATE_RANGE_VALID);
      expect((error as HrDomainError).context['field']).toBe('date_to');
    }
  });
});

describe('Amount rules (BR-ERP5-02)', () => {
  it('accepts a non-negative salary', () => {
    expect(() => assertSalaryNotNegative('125000.0000')).not.toThrow();
    expect(() => assertSalaryNotNegative('0')).not.toThrow();
  });

  it('rejects a negative salary', () => {
    try {
      assertSalaryNotNegative('-1.0000');
      expect.unreachable('the rule must reject the value');
    } catch (error) {
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.SALARY_NON_NEGATIVE);
      expect((error as HrDomainError).context['field']).toBe('salary');
    }
  });

  it('rejects a malformed salary', () => {
    expect(() => assertSalaryNotNegative('not-a-number')).toThrow(HrDomainError);
  });

  it('accepts a non-negative payroll amount and rejects a negative one', () => {
    expect(() => assertPayrollAmountNotNegative('500000.0000')).not.toThrow();

    try {
      assertPayrollAmountNotNegative('-1');
      expect.unreachable('the rule must reject the value');
    } catch (error) {
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.SALARY_NON_NEGATIVE);
      expect((error as HrDomainError).context['field']).toBe('total_amount');
    }
  });
});

describe('Department hierarchy rules (FR-ERP5-03)', () => {
  it('accepts a department without a parent', () => {
    expect(() => assertDepartmentNotSelfParent('dept-1', null)).not.toThrow();
    expect(() => assertDepartmentNotSelfParent('dept-1', undefined)).not.toThrow();
  });

  it('rejects a self-referential parent', () => {
    try {
      assertDepartmentNotSelfParent('dept-1', 'dept-1');
      expect.unreachable('the rule must reject the value');
    } catch (error) {
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.DEPARTMENT_SELF_PARENT);
    }
  });

  it('rejects a hierarchy that would become circular', () => {
    expect(() =>
      assertDepartmentHierarchyAcyclic('dept-1', 'dept-2', ['dept-3', 'dept-4'])
    ).not.toThrow();

    try {
      assertDepartmentHierarchyAcyclic('dept-1', 'dept-2', ['dept-2', 'dept-1']);
      expect.unreachable('the rule must reject the value');
    } catch (error) {
      expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.DEPARTMENT_CYCLE);
    }
  });

  it('rejects a self-parent through the hierarchy rule as well', () => {
    expect(() => assertDepartmentHierarchyAcyclic('dept-1', 'dept-1', [])).toThrow(HrDomainError);
  });
});

describe('Ownership and privacy rules (C3, FR-ERP5-06)', () => {
  it('accepts a payload without any credential', () => {
    expect(() =>
      assertNoIdentityCredentials({ employee_no: 'EMP-0001', job_title: 'Engineer' })
    ).not.toThrow();
  });

  it('rejects a payload that carries a credential', () => {
    for (const field of ['password', 'password_hash', 'token', 'access_token', 'roles', 'role']) {
      try {
        assertNoIdentityCredentials({ [field]: 'value' });
        expect.unreachable(`the rule must reject ${field}`);
      } catch (error) {
        expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.CREDENTIALS_FORBIDDEN);
        expect((error as HrDomainError).context['field']).toBe(field);
      }
    }
  });

  it('accepts a payroll aggregate without an employee row', () => {
    expect(() =>
      assertPayrollAggregateHasNoEmployeeRows({
        department_id: 'dept-1',
        month: '2026-04',
        total_amount: '500000.0000',
      })
    ).not.toThrow();
  });

  it('rejects a payroll aggregate that carries an employee row', () => {
    for (const field of ['employee_id', 'employee_no', 'first_name', 'salary']) {
      try {
        assertPayrollAggregateHasNoEmployeeRows({ [field]: 'value' });
        expect.unreachable(`the rule must reject ${field}`);
      } catch (error) {
        expect((error as HrDomainError).code).toBe(HR_DOMAIN_RULES.PAYROLL_AGGREGATE_ONLY);
        expect((error as HrDomainError).context['field']).toBe(field);
      }
    }
  });
});
