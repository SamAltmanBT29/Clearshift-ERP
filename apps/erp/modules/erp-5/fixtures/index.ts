/**
 * ERP-5 HR & Employees — Synthetic Fixtures
 *
 * Deterministic, entirely synthetic data. No real person, company, account or
 * credential is represented here — the names, identifiers and amounts are
 * invented for tests and local demos only.
 *
 * The fixtures are shared with **ERP5-02** (issue #47), which owns the
 * list/read API and reuses the same rows.
 *
 * @module erp5/fixtures
 */

import type {
  HrDepartment,
  HrEmployee,
  HrIdentityUser,
  HrLeave,
  HrPayrollTotal,
} from '@clearshift/contracts';

/** Fixed timestamp so every fixture run is byte-identical. */
export const FIXTURE_TIMESTAMP = '2026-04-15T12:00:00.000Z';

export const FIXTURE_DEPARTMENT_ENGINEERING: HrDepartment = {
  id: 'd1000000-0000-4000-8000-000000000001',
  name: 'Engineering',
  code: 'ENG',
  parent_id: null,
  created_at: FIXTURE_TIMESTAMP,
  updated_at: FIXTURE_TIMESTAMP,
};

export const FIXTURE_DEPARTMENT_PLATFORM: HrDepartment = {
  id: 'd1000000-0000-4000-8000-000000000002',
  name: 'Platform',
  code: 'PLAT',
  parent_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
  created_at: FIXTURE_TIMESTAMP,
  updated_at: FIXTURE_TIMESTAMP,
};

export const FIXTURE_DEPARTMENT_FINANCE: HrDepartment = {
  id: 'd1000000-0000-4000-8000-000000000003',
  name: 'Finance',
  code: 'FIN',
  parent_id: null,
  created_at: FIXTURE_TIMESTAMP,
  updated_at: FIXTURE_TIMESTAMP,
};

export const FIXTURE_EMPLOYEE_ASHA: HrEmployee = {
  id: 'e1000000-0000-4000-8000-000000000001',
  employee_no: 'EMP-0001',
  first_name: 'Asha',
  last_name: 'Iyer',
  birth_date: '1990-04-12',
  join_date: '2024-01-08',
  department_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
  job_title: 'Software Engineer',
  salary: '125000.0000',
  currency_code: 'INR',
  source_system: null,
  source_id: null,
  created_at: FIXTURE_TIMESTAMP,
  updated_at: FIXTURE_TIMESTAMP,
};

export const FIXTURE_EMPLOYEE_ROHAN: HrEmployee = {
  id: 'e1000000-0000-4000-8000-000000000002',
  employee_no: 'EMP-0002',
  first_name: 'Rohan',
  last_name: 'Mehta',
  birth_date: '1988-11-30',
  join_date: '2022-06-01',
  department_id: FIXTURE_DEPARTMENT_PLATFORM.id,
  job_title: 'Platform Engineer',
  salary: '118500.5000',
  currency_code: 'INR',
  source_system: null,
  source_id: null,
  created_at: FIXTURE_TIMESTAMP,
  updated_at: FIXTURE_TIMESTAMP,
};

export const FIXTURE_EMPLOYEE_NISHA: HrEmployee = {
  id: 'e1000000-0000-4000-8000-000000000003',
  employee_no: 'EMP-0003',
  first_name: 'Nisha',
  last_name: 'Rao',
  birth_date: '1995-02-21',
  join_date: '2025-03-17',
  department_id: FIXTURE_DEPARTMENT_FINANCE.id,
  job_title: 'Financial Controller',
  salary: '142000.0000',
  currency_code: 'INR',
  source_system: null,
  source_id: null,
  created_at: FIXTURE_TIMESTAMP,
  updated_at: FIXTURE_TIMESTAMP,
};

export const FIXTURE_LEAVE_SICK: HrLeave = {
  id: '1a100000-0000-4000-8000-000000000001',
  employee_id: FIXTURE_EMPLOYEE_ASHA.id,
  date_from: '2026-04-01',
  date_to: '2026-04-05',
  type: 'sick',
  status: 'pending',
  created_at: FIXTURE_TIMESTAMP,
  updated_at: FIXTURE_TIMESTAMP,
};

export const FIXTURE_LEAVE_HOLIDAY: HrLeave = {
  id: '1a100000-0000-4000-8000-000000000002',
  employee_id: FIXTURE_EMPLOYEE_ROHAN.id,
  date_from: '2026-04-20',
  date_to: '2026-04-24',
  type: 'holiday',
  status: 'approved',
  created_at: FIXTURE_TIMESTAMP,
  updated_at: FIXTURE_TIMESTAMP,
};

export const FIXTURE_PAYROLL_TOTAL_ENGINEERING: HrPayrollTotal = {
  id: 'b1000000-0000-4000-8000-000000000001',
  department_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
  month: '2026-04',
  total_amount: '250000.0000',
  currency_code: 'INR',
  headcount: 2,
  created_at: FIXTURE_TIMESTAMP,
  updated_at: FIXTURE_TIMESTAMP,
};

export const FIXTURE_PAYROLL_TOTAL_FINANCE: HrPayrollTotal = {
  id: 'b1000000-0000-4000-8000-000000000002',
  department_id: FIXTURE_DEPARTMENT_FINANCE.id,
  month: '2026-04',
  total_amount: '142000.0000',
  currency_code: 'INR',
  headcount: 1,
  created_at: FIXTURE_TIMESTAMP,
  updated_at: FIXTURE_TIMESTAMP,
};

/** Every fixture department, in a stable order. */
export const FIXTURE_DEPARTMENTS: readonly HrDepartment[] = [
  FIXTURE_DEPARTMENT_ENGINEERING,
  FIXTURE_DEPARTMENT_PLATFORM,
  FIXTURE_DEPARTMENT_FINANCE,
];

/** Every fixture employee, in a stable order. */
export const FIXTURE_EMPLOYEES: readonly HrEmployee[] = [
  FIXTURE_EMPLOYEE_ASHA,
  FIXTURE_EMPLOYEE_ROHAN,
  FIXTURE_EMPLOYEE_NISHA,
];

/** Every fixture leave record, in a stable order. */
export const FIXTURE_LEAVE_RECORDS: readonly HrLeave[] = [
  FIXTURE_LEAVE_SICK,
  FIXTURE_LEAVE_HOLIDAY,
];

/** Every fixture payroll aggregate, in a stable order. */
export const FIXTURE_PAYROLL_TOTALS: readonly HrPayrollTotal[] = [
  FIXTURE_PAYROLL_TOTAL_ENGINEERING,
  FIXTURE_PAYROLL_TOTAL_FINANCE,
];

/**
 * The synthetic stand-in for the read-only Hub Identity projection.
 *
 * The real projection (`erp5.identity_users`) is a **view** over
 * `platform.hub_users`, owned by the platform. The in-memory repository uses
 * these rows so the read API can be exercised without a Hub Identity
 * database; the Drizzle implementation reads the view itself.
 *
 * The rows carry no credential, hash, token or refresh-token field — the
 * projection never exposes one (Master Architecture Spec C3).
 */
export const FIXTURE_IDENTITY_USERS: readonly HrIdentityUser[] = [
  {
    id: 'c1000000-0000-4000-8000-000000000001',
    username: 'asha.iyer',
    roles: ['viewer'],
    employee_ref: FIXTURE_EMPLOYEE_ASHA.id,
    status: 'active',
  },
  {
    id: 'c1000000-0000-4000-8000-000000000002',
    username: 'rohan.mehta',
    roles: ['editor'],
    employee_ref: FIXTURE_EMPLOYEE_ROHAN.id,
    status: 'active',
  },
  {
    id: 'c1000000-0000-4000-8000-000000000003',
    username: 'unlinked.user',
    roles: ['analyst'],
    employee_ref: null,
    status: 'active',
  },
];
