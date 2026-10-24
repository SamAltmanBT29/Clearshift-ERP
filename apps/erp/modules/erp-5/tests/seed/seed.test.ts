/**
 * ERP-5 HR & Employees — Deterministic Seed Test Suite (Public API Only)
 *
 * Verifies that the deterministic synthetic seed script:
 *   - Runs exclusively through the public API (/api/v1/erp-hr/*)
 *   - Populates departments, employees, leave records, and payroll totals
 *   - Replays idempotently on successive invocations (HTTP 200 without duplicate insertion)
 *   - Produces identical business state on a clean reset
 *   - Enforces salary masking (BR-ERP5-02 / DR-5) and domain invariants (BR-ERP5-01, FR-ERP5-04, FR-ERP5-06)
 *
 * @module erp5/tests/seed/seed.test
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AuditService, InMemoryAuditRepository } from '@cs/core';
import { buildHrApp } from '../../src/app.js';
import { HrService } from '../../src/services/hr.service.js';
import { InMemoryHrRepository } from '../../src/services/in-memory.repository.js';
import {
  SEED_DEPARTMENTS,
  SEED_EMPLOYEES,
  SEED_LEAVE,
  SEED_PAYROLL_TOTALS,
  runSeed,
  type PostFn,
} from '../../../../../../sample-data/erp-5/seed.js';

const BASE = '/api/v1/erp-hr';

describe('ERP-5 HR & Employees — Deterministic Seed (Public API Only) (#55)', () => {
  let app: FastifyInstance;
  let repo: InMemoryHrRepository;
  let post: PostFn;

  const createCleanApp = () => {
    repo = new InMemoryHrRepository(false); // empty clean slate
    const auditService = new AuditService(new InMemoryAuditRepository());
    const hrService = new HrService(repo, auditService);
    app = buildHrApp({ repository: repo, hrService, authRequired: true });
  };

  beforeEach(() => {
    createCleanApp();

    post = async (method, path, body, headers) => {
      const res = await app.inject({
        method,
        url: path,
        payload: body,
        headers: headers ?? { authorization: 'Bearer role:admin' },
      });
      return {
        status: res.statusCode,
        body: res.json() as Record<string, unknown>,
      };
    };
  });

  it('creates the documented departments, employees, leave records, and payroll totals', async () => {
    const result = await runSeed(post);

    expect(result.replayed).toBe(false);
    expect(result.departmentIds).toHaveLength(SEED_DEPARTMENTS.length);
    expect(result.employeeIds).toHaveLength(SEED_EMPLOYEES.length);
    expect(result.leaveIds).toHaveLength(SEED_LEAVE.length);
    expect(result.payrollTotalIds).toHaveLength(SEED_PAYROLL_TOTALS.length);

    // Verify through public GET endpoints
    const deptList = await app.inject({
      method: 'GET',
      url: `${BASE}/departments`,
      headers: { authorization: 'Bearer role:viewer' },
    });
    expect(deptList.statusCode).toBe(200);
    expect(deptList.json().data).toHaveLength(3);

    const empList = await app.inject({
      method: 'GET',
      url: `${BASE}/employees`,
      headers: { authorization: 'Bearer role:viewer' },
    });
    expect(empList.statusCode).toBe(200);
    expect(empList.json().data).toHaveLength(3);

    const leaveList = await app.inject({
      method: 'GET',
      url: `${BASE}/leave`,
      headers: { authorization: 'Bearer role:viewer' },
    });
    expect(leaveList.statusCode).toBe(200);
    expect(leaveList.json().data).toHaveLength(2);

    const payrollList = await app.inject({
      method: 'GET',
      url: `${BASE}/payroll-totals?month=2026-04`,
      headers: { authorization: 'Bearer role:viewer' },
    });
    expect(payrollList.statusCode).toBe(200);
    expect(payrollList.json().data).toHaveLength(2);
  });

  it('is strictly idempotent: second run replays and creates zero new rows', async () => {
    const firstRun = await runSeed(post);
    const secondRun = await runSeed(post);

    expect(secondRun.replayed).toBe(true);
    expect(secondRun.departmentIds).toEqual(firstRun.departmentIds);
    expect(secondRun.employeeIds).toEqual(firstRun.employeeIds);
    expect(secondRun.leaveIds).toEqual(firstRun.leaveIds);
    expect(secondRun.payrollTotalIds).toEqual(firstRun.payrollTotalIds);

    // Ensure counts remain identical
    const empList = await app.inject({
      method: 'GET',
      url: `${BASE}/employees`,
      headers: { authorization: 'Bearer role:viewer' },
    });
    expect(empList.json().data).toHaveLength(3);
  });

  it('produces identical business records on a clean reset (deterministic)', async () => {
    await runSeed(post);

    const firstEmps = await app.inject({
      method: 'GET',
      url: `${BASE}/employees`,
      headers: { authorization: 'Bearer role:viewer' },
    });

    // Reset repo & re-seed
    createCleanApp();
    await runSeed(post);

    const secondEmps = await app.inject({
      method: 'GET',
      url: `${BASE}/employees`,
      headers: { authorization: 'Bearer role:viewer' },
    });

    const normalize = (items: Array<Record<string, unknown>>) =>
      items.map((i) => ({
        employee_no: i.employee_no,
        first_name: i.first_name,
        last_name: i.last_name,
        job_title: i.job_title,
        salary_display: i.salary_display,
      })).sort((a, b) => String(a.employee_no).localeCompare(String(b.employee_no)));

    expect(normalize(secondEmps.json().data)).toEqual(normalize(firstEmps.json().data));
  });

  it('never leaks raw salary in responses; enforces salary masking (BR-ERP5-02 / DR-5)', async () => {
    await runSeed(post);

    const empList = await app.inject({
      method: 'GET',
      url: `${BASE}/employees`,
      headers: { authorization: 'Bearer role:viewer' },
    });

    expect(empList.payload).not.toContain('120000.00');
    expect(empList.payload).not.toContain('95000.00');
    expect(empList.payload).not.toContain('110000.00');

    for (const emp of empList.json().data) {
      expect(emp.salary_display).toBe('XX,XXX');
    }
  });

  it('asserts domain temporal invariant that join_date >= birth_date (BR-ERP5-01)', async () => {
    await runSeed(post);

    // Attempt to inject an employee with join_date earlier than birth_date
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/employees`,
      headers: { authorization: 'Bearer role:editor' },
      payload: {
        employee_no: 'EMP-FAIL',
        first_name: 'Time',
        last_name: 'Traveler',
        birth_date: '2000-01-01',
        join_date: '1995-01-01', // Before birth date
        department_id: '00000000-0000-0000-0000-000000000001',
        job_title: 'Temporal Paradox',
        salary: '100000.00',
      },
    });

    expect(res.statusCode).toBe(422);
  });
});
