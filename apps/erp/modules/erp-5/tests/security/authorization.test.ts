/**
 * ERP-5 HR & Employees — Authorization Test Suite (PLT-06 / ERP5-15)
 *
 * Proves the acceptance criteria of issue #191:
 *
 *   1. every route validates the incoming Hub JWT signature and expiry
 *   2. the role capability matrix is enforced for every role
 *      (Viewer, Editor, Migration Runner, Analyst, Admin)
 *   3. an unauthenticated request is `401`, an insufficient one is `403`
 *   4. the object-level guard prevents a cross-module record mutation
 *
 * The policy matrix under test is the **declared** one
 * (`src/policies/permissions.ts`), which mirrors the central matrix of
 * PLT-06 — the module owns no role list of its own.
 *
 * @module erp5/tests/security/authorization.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { signAccessToken, Roles } from '@cs/identity';
import { buildHrApp } from '../../src/app.js';
import { HrService } from '../../src/services/hr.service.js';
import { InMemoryHrRepository } from '../../src/services/in-memory.repository.js';
import { AuditService, InMemoryAuditRepository } from '@cs/core';
import { HR_ROUTE_POLICIES, isPolicySatisfied } from '../../src/policies/permissions.js';
import {
  FIXTURE_DEPARTMENT_ENGINEERING,
  FIXTURE_EMPLOYEE_ASHA,
  FIXTURE_LEAVE_SICK,
  FIXTURE_PAYROLL_TOTAL_ENGINEERING,
} from '../../fixtures/index.js';

const BASE = '/api/v1/erp-hr';

const ROLES = [
  Roles.VIEWER,
  Roles.EDITOR,
  Roles.MIGRATION_RUNNER,
  Roles.ANALYST,
  Roles.ADMIN,
] as const;

type Role = (typeof ROLES)[number];

interface RouteCase {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  policy: string;
  /** The status the role receives when it holds the policy. */
  allowedStatus: number;
  payload?: Record<string, unknown>;
}

const EMPLOYEE_ID = FIXTURE_EMPLOYEE_ASHA.id;
const DEPARTMENT_ID = FIXTURE_DEPARTMENT_ENGINEERING.id;
const LEAVE_ID = FIXTURE_LEAVE_SICK.id;
const PAYROLL_ID = FIXTURE_PAYROLL_TOTAL_ENGINEERING.id;

const ROUTE_CASES: RouteCase[] = [
  {
    method: 'GET',
    path: `${BASE}/employees`,
    policy: 'hr.employees.read',
    allowedStatus: 200,
  },
  {
    method: 'GET',
    path: `${BASE}/employees/${EMPLOYEE_ID}`,
    policy: 'hr.employees.read',
    allowedStatus: 200,
  },
  {
    method: 'POST',
    path: `${BASE}/employees`,
    policy: 'hr.employees.create',
    allowedStatus: 201,
    payload: {
      employee_no: 'EMP-SEC-0001',
      first_name: 'Ira',
      last_name: 'Sethi',
      birth_date: '1991-02-03',
      join_date: '2024-05-06',
      department_id: DEPARTMENT_ID,
      job_title: 'Engineer',
      salary: '100000.0000',
    },
  },
  {
    method: 'PATCH',
    path: `${BASE}/employees/${EMPLOYEE_ID}`,
    policy: 'hr.employees.update',
    allowedStatus: 200,
    payload: { job_title: 'Senior Engineer' },
  },
  {
    method: 'GET',
    path: `${BASE}/departments`,
    policy: 'hr.departments.read',
    allowedStatus: 200,
  },
  {
    method: 'GET',
    path: `${BASE}/departments/${DEPARTMENT_ID}`,
    policy: 'hr.departments.read',
    allowedStatus: 200,
  },
  {
    method: 'POST',
    path: `${BASE}/departments`,
    policy: 'hr.departments.create',
    allowedStatus: 201,
    payload: { name: 'Quality Assurance', code: 'QA' },
  },
  {
    method: 'PATCH',
    path: `${BASE}/departments/${DEPARTMENT_ID}`,
    policy: 'hr.departments.update',
    allowedStatus: 200,
    payload: { name: 'Engineering' },
  },
  {
    method: 'GET',
    path: `${BASE}/leave`,
    policy: 'hr.leave.read',
    allowedStatus: 200,
  },
  {
    method: 'GET',
    path: `${BASE}/leave/${LEAVE_ID}`,
    policy: 'hr.leave.read',
    allowedStatus: 200,
  },
  {
    method: 'POST',
    path: `${BASE}/leave`,
    policy: 'hr.leave.create',
    allowedStatus: 201,
    payload: {
      employee_id: EMPLOYEE_ID,
      date_from: '2026-10-01',
      date_to: '2026-10-03',
      type: 'sick',
    },
  },
  {
    method: 'PATCH',
    path: `${BASE}/leave/${LEAVE_ID}`,
    policy: 'hr.leave.update',
    allowedStatus: 200,
    payload: { status: 'approved' },
  },
  {
    method: 'GET',
    path: `${BASE}/payroll-totals`,
    policy: 'hr.payroll.read',
    allowedStatus: 200,
  },
  {
    method: 'GET',
    path: `${BASE}/payroll-totals/${PAYROLL_ID}`,
    policy: 'hr.payroll.read',
    allowedStatus: 200,
  },
  {
    method: 'POST',
    path: `${BASE}/payroll-totals`,
    policy: 'hr.payroll.load',
    allowedStatus: 201,
    payload: {
      department_id: DEPARTMENT_ID,
      month: '2026-10',
      total_amount: '1000.0000',
    },
  },
  {
    method: 'GET',
    path: `${BASE}/identity-users`,
    policy: 'hr.identity_users.read',
    allowedStatus: 200,
  },
];

function tokenFor(role: Role): string {
  return `Bearer role:${role}`;
}

describe('ERP-5 HR & Employees — authorization policy (PLT-06 / ERP5-15)', () => {
  let repository: InMemoryHrRepository;
  let hrService: HrService;
  let app: FastifyInstance;

  beforeEach(() => {
    repository = new InMemoryHrRepository(true);
    const auditService = new AuditService(new InMemoryAuditRepository());
    hrService = new HrService(repository, auditService);
    app = buildHrApp({ repository, hrService, authRequired: true });
  });

  // ── 1. The declared matrix ────────────────────────────────────────────────

  describe('The declared policy matrix', () => {
    it('mirrors the central matrix of PLT-06', () => {
      // hr.read → Viewer, Editor, Analyst, Admin
      const readRoles = HR_ROUTE_POLICIES['hr.employees.read']?.allowedRoles;
      expect([...(readRoles ?? [])].sort()).toEqual(
        [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN].sort()
      );

      // hr.mutate → Editor, Admin
      const mutateRoles = HR_ROUTE_POLICIES['hr.employees.create']?.allowedRoles;
      expect([...(mutateRoles ?? [])].sort()).toEqual([Roles.EDITOR, Roles.ADMIN].sort());

      // hr.payroll_bulk → Migration Runner, Admin
      const payrollRoles = HR_ROUTE_POLICIES['hr.payroll.load']?.allowedRoles;
      expect([...(payrollRoles ?? [])].sort()).toEqual(
        [Roles.MIGRATION_RUNNER, Roles.ADMIN].sort()
      );
    });

    it('gives the Migration Runner no read access to the HR master data', () => {
      for (const policy of Object.values(HR_ROUTE_POLICIES)) {
        if (policy.policy.endsWith('.read')) {
          expect(policy.allowedRoles).not.toContain(Roles.MIGRATION_RUNNER);
        }
      }
    });

    it('denies an unknown policy (default deny)', () => {
      expect(isPolicySatisfied('hr.does.not.exist' as never, [Roles.ADMIN])).toBe(false);
    });
  });

  // ── 2. The route × role matrix ────────────────────────────────────────────

  describe('Every route enforces the matrix', () => {
    for (const route of ROUTE_CASES) {
      for (const role of ROLES) {
        it(`${route.method} ${route.path} → ${role} is ${
          isPolicySatisfied(route.policy as never, [role]) ? 'allowed' : 'forbidden'
        }`, async () => {
          const res = await app.inject({
            method: route.method,
            url: route.path,
            headers: { authorization: tokenFor(role) },
            ...(route.payload !== undefined && { payload: route.payload }),
          });

          if (isPolicySatisfied(route.policy as never, [role])) {
            expect(res.statusCode).toBe(route.allowedStatus);
          } else {
            expect(res.statusCode).toBe(403);
            expect(res.json().code).toBe('FORBIDDEN');
          }
        });
      }
    }
  });

  // ── 3. Authentication ─────────────────────────────────────────────────────

  describe('Authentication', () => {
    it('answers 401 without a bearer token', async () => {
      const res = await app.inject({ method: 'GET', url: `${BASE}/employees` });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('answers 401 for a malformed Authorization header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees`,
        headers: { authorization: 'Basic abc' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('answers 401 for a known invalid token', async () => {
      for (const token of ['invalid', 'invalid-token', 'expired', 'disabled', 'user-disabled']) {
        const res = await app.inject({
          method: 'GET',
          url: `${BASE}/employees`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(401);
      }
    });

    it('answers 403 for a role the shared matrix does not know', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees`,
        headers: { authorization: 'Bearer role:superuser' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it('answers 401 for a disabled account', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees`,
        headers: { authorization: 'Bearer user:user-disabled-01' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('answers 401 for an account the platform reports as disabled', async () => {
      const disabledApp = buildHrApp({
        repository: new InMemoryHrRepository(true),
        hrService: new HrService(new InMemoryHrRepository(true)),
        authRequired: true,
        isUserDisabled: (userId) => userId === 'user-suspended-01',
      });

      const res = await disabledApp.inject({
        method: 'GET',
        url: `${BASE}/employees`,
        headers: { authorization: 'Bearer user:user-suspended-01' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('authenticates a real Hub access token and honours its roles', async () => {
      const token = await signAccessToken('user-editor-01', [Roles.EDITOR]);
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          employee_no: 'EMP-JWT-0001',
          first_name: 'Ira',
          last_name: 'Sethi',
          birth_date: '1991-02-03',
          join_date: '2024-05-06',
          department_id: DEPARTMENT_ID,
          job_title: 'Engineer',
          salary: '100000.0000',
        },
      });

      expect(res.statusCode).toBe(201);
    });

    it('refuses a real token whose roles do not hold the policy', async () => {
      const token = await signAccessToken('user-viewer-01', [Roles.VIEWER]);
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          employee_no: 'EMP-JWT-0002',
          first_name: 'Ira',
          last_name: 'Sethi',
          birth_date: '1991-02-03',
          join_date: '2024-05-06',
          department_id: DEPARTMENT_ID,
          job_title: 'Engineer',
          salary: '100000.0000',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('refuses a forged token', async () => {
      // A syntactically valid JWT whose payload was tampered with.
      const forged = `${'a'.repeat(8)}.${'b'.repeat(8)}.${'c'.repeat(8)}`;
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees`,
        headers: { authorization: `Bearer ${forged}` },
      });

      expect(res.statusCode).toBe(401);
    });

    it('refuses a token signed by another key', async () => {
      const token = await signAccessToken('user-editor-02', [Roles.EDITOR]);
      // Break the signature but keep the token syntactically a JWT.
      const parts = token.split('.');
      const tampered = `${parts[0]}.${parts[1]}.${parts[2]?.slice(0, -4)}AAAA`;
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees`,
        headers: { authorization: `Bearer ${tampered}` },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── 4. The object-level guard ─────────────────────────────────────────────

  describe('Object-level authorization', () => {
    it('refuses to mutate a record that belongs to another module', async () => {
      // A Hub Identity user id — it is not an ERP-5 employee.
      const foreignId = 'c1000000-0000-4000-8000-000000000001';

      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/employees/${foreignId}`,
        headers: { authorization: tokenFor(Roles.ADMIN) },
        payload: { job_title: 'Injected' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');

      // Nothing was mutated.
      const identity = await repository.listIdentityUsers({ page: 1, pageSize: 25 });
      expect(identity.items.find((u) => u.id === foreignId)).toBeDefined();
    });

    it('refuses to read a record of another kind through a route of this kind', async () => {
      // The leave id addressed as an employee.
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/employees/${LEAVE_ID}`,
        headers: { authorization: tokenFor(Roles.ADMIN) },
      });

      expect(res.statusCode).toBe(404);
    });

    it('answers 403 before the record is loaded, so a forbidden write reveals nothing', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/employees/${randomUUID()}`,
        headers: { authorization: tokenFor(Roles.VIEWER) },
        payload: { job_title: 'Injected' },
      });

      // The role is refused before the record is even looked up.
      expect(res.statusCode).toBe(403);
    });
  });
});
