/**
 * ERP-5 HR & Employees — List / Read API Test Suite
 *
 * Issue #47 (`[ERP5-02]`) — the V1 read surface:
 *
 *   - bounded, server-side, deterministic paging (`page` / `pageSize`,
 *     hard cap 100) on every collection
 *   - server-side search and filter with an allow-listed sort field and a
 *     deterministic `id` tie-breaker
 *   - an invalid page size or sort field is rejected with `400`
 *   - the employee collection carries the **masked** projection — never the
 *     raw salary
 *   - the Hub Identity projection is read-only and carries no credential field
 *   - an unknown record answers `404`, a malformed id answers `400`
 *   - reads require the shared `module.read` capability
 *
 * @module erp5/tests/api/list.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ErrorEnvelopeSchema, HR_SALARY_MASK } from '@clearshift/contracts';
import { buildHrApp } from '../../src/app.js';
import { HrService } from '../../src/services/hr.service.js';
import { InMemoryHrRepository } from '../../src/services/in-memory.repository.js';
import {
  FIXTURE_DEPARTMENT_ENGINEERING,
  FIXTURE_DEPARTMENT_FINANCE,
  FIXTURE_DEPARTMENT_PLATFORM,
  FIXTURE_EMPLOYEE_ASHA,
  FIXTURE_EMPLOYEE_NISHA,
  FIXTURE_EMPLOYEE_ROHAN,
  FIXTURE_LEAVE_SICK,
  FIXTURE_PAYROLL_TOTAL_ENGINEERING,
} from '../../fixtures/index.js';

const BASE = '/api/v1/erp-hr';
const VIEWER = { authorization: 'Bearer role:viewer' };
const EDITOR = { authorization: 'Bearer role:editor' };

describe('ERP-5 HR & Employees — List / Read API (#47)', () => {
  let repository: InMemoryHrRepository;
  let hrService: HrService;
  let app: FastifyInstance;

  beforeEach(() => {
    repository = new InMemoryHrRepository(true);
    hrService = new HrService(repository);
    app = buildHrApp({ repository, hrService, authRequired: true });
  });

  // ── Employees ─────────────────────────────────────────────────────────────

  describe('GET /employees', () => {
    it('returns the bounded first page with the collection metadata', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta).toMatchObject({ page: 1, pageSize: 25, total: 3, totalPages: 1 });
      expect(body.data).toHaveLength(3);
    });

    it('never exposes the raw salary', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees`,
        headers: EDITOR,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('125000');
      expect(res.body).not.toContain('118500');
      for (const employee of res.json().data) {
        expect(employee.salary_display).toBe(HR_SALARY_MASK);
        expect(employee).not.toHaveProperty('salary');
      }
    });

    it('searches server-side across the name and the employee number', async () => {
      const byName = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?search=asha`,
        headers: VIEWER,
      });
      expect(byName.statusCode).toBe(200);
      expect(byName.json().data).toHaveLength(1);
      expect(byName.json().data[0].employee_no).toBe(FIXTURE_EMPLOYEE_ASHA.employee_no);

      const byNumber = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?search=EMP-0003`,
        headers: VIEWER,
      });
      expect(byNumber.json().data).toHaveLength(1);
      expect(byNumber.json().data[0].id).toBe(FIXTURE_EMPLOYEE_NISHA.id);
    });

    it('filters by department', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?department_id=${FIXTURE_DEPARTMENT_PLATFORM.id}`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
      expect(res.json().data[0].id).toBe(FIXTURE_EMPLOYEE_ROHAN.id);
      expect(res.json().meta.total).toBe(1);
    });

    it('orders by the allow-listed sort field with a deterministic tie-breaker', async () => {
      const byName = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?sort=name`,
        headers: VIEWER,
      });
      const names = byName.json().data.map((e: { last_name: string }) => e.last_name);
      expect([...names].sort()).toEqual(names);

      const byNumber = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?sort=employee_no`,
        headers: VIEWER,
      });
      const numbers = byNumber.json().data.map((e: { employee_no: string }) => e.employee_no);
      expect([...numbers].sort()).toEqual(numbers);

      // The same request twice returns the same order.
      const again = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?sort=employee_no`,
        headers: VIEWER,
      });
      expect(again.json().data.map((e: { id: string }) => e.id)).toEqual(
        byNumber.json().data.map((e: { id: string }) => e.id)
      );
    });

    it('rejects a page size above the hard cap with 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?pageSize=101`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(400);
      const parsed = ErrorEnvelopeSchema.parse(res.json());
      expect(parsed.code).toBe('VALIDATION_ERROR');
    });

    it('accepts the hard cap itself', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?pageSize=100`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().meta.pageSize).toBe(100);
    });

    it('rejects a sort field outside the allow-list with 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?sort=salary`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects a page below 1 with 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?page=0`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns an empty page for a search that matches nothing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?search=nobody`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
      expect(res.json().meta.total).toBe(0);
      expect(res.json().meta.totalPages).toBe(0);
    });

    it('returns non-overlapping deterministic pages', async () => {
      const first = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?page=1&pageSize=2&sort=employee_no`,
        headers: VIEWER,
      });
      const second = await app.inject({
        method: 'GET',
        url: `${BASE}/employees?page=2&pageSize=2&sort=employee_no`,
        headers: VIEWER,
      });

      expect(first.json().data).toHaveLength(2);
      expect(second.json().data).toHaveLength(1);
      expect(first.json().meta.total).toBe(3);
      expect(second.json().meta.total).toBe(3);

      const firstIds = first.json().data.map((e: { id: string }) => e.id);
      const secondIds = second.json().data.map((e: { id: string }) => e.id);
      expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual([]);
    });
  });

  describe('GET /employees/{id}', () => {
    it('reads a single employee with the masked projection', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees/${FIXTURE_EMPLOYEE_ASHA.id}`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(FIXTURE_EMPLOYEE_ASHA.id);
      expect(body.salary_display).toBe(HR_SALARY_MASK);
      expect(res.body).not.toContain('125000');
    });

    it('answers 404 for an unknown employee', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees/${randomUUID()}`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    it('answers 400 for a malformed id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees/not-a-uuid`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });
  });

  // ── Departments ───────────────────────────────────────────────────────────

  describe('GET /departments', () => {
    it('lists the departments with the metadata', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/departments`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(3);
      expect(res.json().meta.total).toBe(3);
    });

    it('searches across the name and the code', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/departments?search=fin`,
        headers: VIEWER,
      });

      expect(res.json().data).toHaveLength(1);
      expect(res.json().data[0].id).toBe(FIXTURE_DEPARTMENT_FINANCE.id);
    });

    it('filters by the parent department', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/departments?parent_id=${FIXTURE_DEPARTMENT_ENGINEERING.id}`,
        headers: VIEWER,
      });

      expect(res.json().data).toHaveLength(1);
      expect(res.json().data[0].id).toBe(FIXTURE_DEPARTMENT_PLATFORM.id);
    });

    it('reads a single department and answers 404 for an unknown one', async () => {
      const found = await app.inject({
        method: 'GET',
        url: `${BASE}/departments/${FIXTURE_DEPARTMENT_ENGINEERING.id}`,
        headers: VIEWER,
      });
      expect(found.statusCode).toBe(200);
      expect(found.json().code).toBe('ENG');

      const missing = await app.inject({
        method: 'GET',
        url: `${BASE}/departments/${randomUUID()}`,
        headers: VIEWER,
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  // ── Leave ─────────────────────────────────────────────────────────────────

  describe('GET /leave', () => {
    it('lists the leave records and filters by employee, type and status', async () => {
      const all = await app.inject({
        method: 'GET',
        url: `${BASE}/leave`,
        headers: VIEWER,
      });
      expect(all.statusCode).toBe(200);
      expect(all.json().data).toHaveLength(2);

      const byEmployee = await app.inject({
        method: 'GET',
        url: `${BASE}/leave?employee_id=${FIXTURE_EMPLOYEE_ASHA.id}`,
        headers: VIEWER,
      });
      expect(byEmployee.json().data).toHaveLength(1);
      expect(byEmployee.json().data[0].id).toBe(FIXTURE_LEAVE_SICK.id);

      const byType = await app.inject({
        method: 'GET',
        url: `${BASE}/leave?type=holiday`,
        headers: VIEWER,
      });
      expect(byType.json().data).toHaveLength(1);
      expect(byType.json().data[0].type).toBe('holiday');

      const byStatus = await app.inject({
        method: 'GET',
        url: `${BASE}/leave?status=approved`,
        headers: VIEWER,
      });
      expect(byStatus.json().data).toHaveLength(1);
      expect(byStatus.json().data[0].status).toBe('approved');
    });

    it('reads a single leave record and answers 404 for an unknown one', async () => {
      const found = await app.inject({
        method: 'GET',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: VIEWER,
      });
      expect(found.statusCode).toBe(200);
      expect(found.json().employee_id).toBe(FIXTURE_EMPLOYEE_ASHA.id);

      const missing = await app.inject({
        method: 'GET',
        url: `${BASE}/leave/${randomUUID()}`,
        headers: VIEWER,
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  // ── Payroll totals ────────────────────────────────────────────────────────

  describe('GET /payroll-totals', () => {
    it('lists the aggregates and filters by month and department', async () => {
      const all = await app.inject({
        method: 'GET',
        url: `${BASE}/payroll-totals`,
        headers: VIEWER,
      });
      expect(all.statusCode).toBe(200);
      expect(all.json().data).toHaveLength(2);
      expect(all.json().meta.total).toBe(2);

      const byMonth = await app.inject({
        method: 'GET',
        url: `${BASE}/payroll-totals?month=2026-04`,
        headers: VIEWER,
      });
      expect(byMonth.json().data).toHaveLength(2);

      const byDepartment = await app.inject({
        method: 'GET',
        url: `${BASE}/payroll-totals?department_id=${FIXTURE_DEPARTMENT_ENGINEERING.id}`,
        headers: VIEWER,
      });
      expect(byDepartment.json().data).toHaveLength(1);
      expect(byDepartment.json().data[0].id).toBe(FIXTURE_PAYROLL_TOTAL_ENGINEERING.id);
    });

    it('reads a single aggregate and answers 404 for an unknown one', async () => {
      const found = await app.inject({
        method: 'GET',
        url: `${BASE}/payroll-totals/${FIXTURE_PAYROLL_TOTAL_ENGINEERING.id}`,
        headers: VIEWER,
      });
      expect(found.statusCode).toBe(200);
      expect(found.json().month).toBe('2026-04');

      const missing = await app.inject({
        method: 'GET',
        url: `${BASE}/payroll-totals/${randomUUID()}`,
        headers: VIEWER,
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  // ── Identity users ────────────────────────────────────────────────────────

  describe('GET /identity-users', () => {
    it('lists the read-only projection without any credential field', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/identity-users`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBeGreaterThan(0);

      for (const user of body.data) {
        expect(Object.keys(user).sort()).toEqual([
          'employee_ref',
          'id',
          'roles',
          'status',
          'username',
        ]);
      }
      expect(res.body).not.toContain('password');
      expect(res.body).not.toContain('token');
      expect(res.body).not.toContain('hash');
    });

    it('keeps a Hub user without a linked employee', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/identity-users?search=unlinked`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
      expect(res.json().data[0].employee_ref).toBeNull();
    });
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  describe('Authorization', () => {
    it('rejects an unauthenticated read with 401', async () => {
      const res = await app.inject({ method: 'GET', url: `${BASE}/employees` });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('rejects a role without the module.read capability with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees`,
        headers: { authorization: 'Bearer role:migration_runner' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it('lets a viewer read the collections', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees`,
        headers: VIEWER,
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
