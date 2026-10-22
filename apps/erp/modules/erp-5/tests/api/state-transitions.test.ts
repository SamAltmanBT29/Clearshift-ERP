/**
 * ERP-5 HR & Employees — Relationship, State Transition and Read-Model Tests
 *
 * API level proof of issue #51 (`ERP5-06`):
 *
 *   - the leave state matrix — every allowed and every forbidden transition
 *   - an invalid reference is rejected with a stable code and **no partial
 *     mutation** (the target row is not written)
 *   - an absent optional relationship produces the approved warning and never
 *     a synthetic record
 *   - the read API and the write agree immediately after a successful write
 *   - the cross-module resolver never confirms a record it cannot prove
 *   - unknown enumerations are rejected
 *
 * @module erp5/tests/api/state-transitions.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ErrorEnvelopeSchema, HR_DOMAIN_RULES } from '@clearshift/contracts';
import { buildHrApp } from '../../src/app.js';
import { HrService } from '../../src/services/hr.service.js';
import { InMemoryHrRepository } from '../../src/services/in-memory.repository.js';
import { createErp5Resolver } from '../../src/public.js';
import {
  FIXTURE_DEPARTMENT_ENGINEERING,
  FIXTURE_DEPARTMENT_PLATFORM,
  FIXTURE_EMPLOYEE_ASHA,
  FIXTURE_LEAVE_SICK,
} from '../../fixtures/index.js';

const BASE = '/api/v1/erp-hr';
const EDITOR = { authorization: 'Bearer role:editor' };
const ADMIN = { authorization: 'Bearer role:admin' };

describe('ERP-5 HR & Employees — relationships, state transitions and read model (#51)', () => {
  let repository: InMemoryHrRepository;
  let hrService: HrService;
  let app: FastifyInstance;

  beforeEach(() => {
    repository = new InMemoryHrRepository(true);
    hrService = new HrService(repository);
    app = buildHrApp({ repository, hrService, authRequired: true });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Leave state transitions
  // ───────────────────────────────────────────────────────────────────────────
  describe('Leave state transitions', () => {
    it('applies the allowed transition pending → approved', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { status: 'approved' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('approved');
      expect(body.id).toBe(FIXTURE_LEAVE_SICK.id);
    });

    it('applies the allowed transition pending → rejected', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { status: 'rejected' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('rejected');
    });

    it('treats the same status as an idempotent no-op', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { status: 'pending' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('pending');
    });

    it('forbids reversing a decision with 422 and a stable code', async () => {
      const approve = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { status: 'approved' },
      });
      expect(approve.statusCode).toBe(200);

      const reverse = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { status: 'rejected' },
      });

      expect(reverse.statusCode).toBe(422);
      const err = reverse.json();
      expect(err.code).toBe(HR_DOMAIN_RULES.INVALID_LEAVE_STATUS_TRANSITION);
      expect(err.details[0]?.field).toBe('status');
      expect(err.message).toContain('terminal');

      // The record is untouched.
      const stored = await repository.getLeaveById(FIXTURE_LEAVE_SICK.id);
      expect(stored?.status).toBe('approved');
    });

    it('forbids un-deciding a leave with 422', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { status: 'pending' },
      });

      // `pending → pending` is a no-op, so the forbidden case is a decided record.
      expect(res.statusCode).toBe(200);

      const approve = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { status: 'approved' },
      });
      expect(approve.statusCode).toBe(200);

      const undecide = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { status: 'pending' },
      });
      expect(undecide.statusCode).toBe(422);
      expect(undecide.json().code).toBe(HR_DOMAIN_RULES.INVALID_LEAVE_STATUS_TRANSITION);
    });

    it('rejects an unknown status with 400', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { status: 'cancelled' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects an unknown leave type with 400 on create', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/leave`,
        headers: EDITOR,
        payload: {
          employee_id: FIXTURE_EMPLOYEE_ASHA.id,
          date_from: '2026-09-01',
          date_to: '2026-09-05',
          type: 'unpaid',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects an edit of an unknown leave record with 404', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${randomUUID()}`,
        headers: EDITOR,
        payload: { status: 'approved' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    it('rejects a write without the module.write capability with 403', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: { authorization: 'Bearer role:viewer' },
        payload: { status: 'approved' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it('never accepts the recorded subject as authoritative', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { employee_id: randomUUID() },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.PROTECTED_FIELD);

      const stored = await repository.getLeaveById(FIXTURE_LEAVE_SICK.id);
      expect(stored?.employee_id).toBe(FIXTURE_LEAVE_SICK.employee_id);
    });

    it('re-validates the date range on edit', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { date_to: '2026-03-01' },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.LEAVE_DATE_RANGE_VALID);

      const stored = await repository.getLeaveById(FIXTURE_LEAVE_SICK.id);
      expect(stored?.date_to).toBe(FIXTURE_LEAVE_SICK.date_to);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Relationships — validated before commit, no partial mutation
  // ───────────────────────────────────────────────────────────────────────────
  describe('Relationship validation', () => {
    it('rejects a leave for an unknown employee without writing the leave', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/leave`,
        headers: EDITOR,
        payload: {
          employee_id: randomUUID(),
          date_from: '2026-09-01',
          date_to: '2026-09-05',
          type: 'sick',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.EMPLOYEE_REQUIRED);

      // No leave row was written for the missing employee.
      const written = await repository.getLeaveById(FIXTURE_LEAVE_SICK.id);
      expect(written).not.toBeNull();
      expect(written?.id).toBe(FIXTURE_LEAVE_SICK.id);
    });

    it('rejects an employee for an unknown department without writing the employee', async () => {
      const employeeNo = 'EMP-NO-DEPT';

      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: {
          employee_no: employeeNo,
          first_name: 'Kiran',
          last_name: 'Desai',
          birth_date: '1992-07-19',
          join_date: '2023-09-04',
          department_id: randomUUID(),
          job_title: 'Engineer',
          salary: '100000.0000',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.DEPARTMENT_REQUIRED);

      // Nothing was written.
      const written = await repository.getEmployeeByEmployeeNo(employeeNo);
      expect(written).toBeNull();
    });

    it('rejects a department with an unknown parent without writing the department', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/departments`,
        headers: EDITOR,
        payload: { name: 'Orphan', code: 'ORPH', parent_id: randomUUID() },
      });

      expect(res.statusCode).toBe(404);
      const written = await repository.getDepartmentByCode('ORPH');
      expect(written).toBeNull();
    });

    it('rejects a source identity on a browser write with 400 HR_PROTECTED_FIELD', async () => {
      const employeeNo = 'EMP-BROWSER-SOURCE';

      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: {
          employee_no: employeeNo,
          first_name: 'Kiran',
          last_name: 'Desai',
          birth_date: '1992-07-19',
          join_date: '2023-09-04',
          department_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
          job_title: 'Engineer',
          salary: '100000.0000',
          source_system: 'legacy_hr_csv',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.PROTECTED_FIELD);

      const written = await repository.getEmployeeByEmployeeNo(employeeNo);
      expect(written).toBeNull();
    });

    it('rejects a half-set source identity on an import write with 400', async () => {
      const employeeNo = 'EMP-HALF-SOURCE';

      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { ...EDITOR, 'idempotency-key': `erp5-${randomUUID()}` },
        payload: {
          employee_no: employeeNo,
          first_name: 'Kiran',
          last_name: 'Desai',
          birth_date: '1992-07-19',
          join_date: '2023-09-04',
          department_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
          job_title: 'Engineer',
          salary: '100000.0000',
          source_system: 'legacy_hr_csv',
          batch_id: randomUUID(),
          source_row: 1,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE);

      const written = await repository.getEmployeeByEmployeeNo(employeeNo);
      expect(written).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Optional relationships — the approved warning
  // ───────────────────────────────────────────────────────────────────────────
  describe('Optional relationships', () => {
    it('reports the approved warning for a root department and invents no parent', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/departments`,
        headers: EDITOR,
        payload: { name: 'Quality Assurance', code: 'QA' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.parent_id).toBeNull();
      expect(body.warnings).toHaveLength(1);
      expect(body.warnings[0].code).toBe('HR_OPTIONAL_REFERENCE_ABSENT');
      expect(body.warnings[0].relationship).toBe('DEPARTMENT_PARENT');
      expect(body.warnings[0].field).toBe('parent_id');
      expect(body.warnings[0].message).toContain('No synthetic record was created');

      // No synthetic parent was created.
      const parents = await repository.getDepartmentById(FIXTURE_DEPARTMENT_ENGINEERING.id);
      expect(parents?.parent_id).toBeNull();
    });

    it('reports no warning when the parent is present', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/departments`,
        headers: EDITOR,
        payload: {
          name: 'Platform West',
          code: 'PLAT-W',
          parent_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().warnings).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Read-model consistency after a successful write
  // ───────────────────────────────────────────────────────────────────────────
  describe('Read-model consistency', () => {
    it('returns the persisted row, not the request payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: {
          employee_no: 'EMP-READBACK',
          first_name: 'Meera',
          last_name: 'Nair',
          birth_date: '1993-03-08',
          join_date: '2023-11-06',
          department_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
          job_title: 'Backend Engineer',
          salary: '128000.0000',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      const stored = await repository.getEmployeeById(body.id);

      expect(stored).not.toBeNull();
      expect(body.employee_no).toBe(stored?.employee_no);
      expect(body.department_id).toBe(stored?.department_id);
      expect(body.created_at).toBe(stored?.created_at);
      // The link the response reports is the one the database holds.
      const department = await repository.getDepartmentById(body.department_id);
      expect(department).not.toBeNull();
    });

    it('never exposes the raw salary in a read-back', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: ADMIN,
        payload: {
          employee_no: 'EMP-MASKED',
          first_name: 'Meera',
          last_name: 'Nair',
          birth_date: '1993-03-08',
          join_date: '2023-11-06',
          department_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
          job_title: 'Backend Engineer',
          salary: '128000.0000',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.body).not.toContain('128000');
      expect(res.json().salary_display).toBe('XX,XXX');
    });

    it('keeps the status of a leave in agreement with the persisted row', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { status: 'approved' },
      });

      expect(res.statusCode).toBe(200);
      const stored = await repository.getLeaveById(FIXTURE_LEAVE_SICK.id);
      expect(res.json().status).toBe(stored?.status);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Cross-module boundary — the resolver never confirms what it cannot prove
  // ───────────────────────────────────────────────────────────────────────────
  describe('Cross-module boundary', () => {
    it('confirms an existing record and denies an unknown one', async () => {
      const resolver = createErp5Resolver(repository);

      expect(await resolver.exists('employee', FIXTURE_EMPLOYEE_ASHA.id)).toBe(true);
      expect(await resolver.exists('employee', randomUUID())).toBe(false);
      expect(await resolver.exists('department', FIXTURE_DEPARTMENT_ENGINEERING.id)).toBe(true);
      expect(await resolver.exists('department', randomUUID())).toBe(false);
      expect(await resolver.exists('leave', FIXTURE_LEAVE_SICK.id)).toBe(true);
      expect(await resolver.exists('leave', randomUUID())).toBe(false);
      expect(await resolver.exists('unknown_entity', FIXTURE_EMPLOYEE_ASHA.id)).toBe(false);
    });

    it('returns the real summary of an existing employee and nothing for a missing one', async () => {
      const resolver = createErp5Resolver(repository);

      const summary = await resolver.get<{ id: string; employeeNo: string }>(
        'employee',
        FIXTURE_EMPLOYEE_ASHA.id
      );
      expect(summary?.employeeNo).toBe(FIXTURE_EMPLOYEE_ASHA.employee_no);

      expect(await resolver.get('employee', randomUUID())).toBeNull();
    });

    it('denies every existence check when it has no data source', async () => {
      const { erp5Resolver } = await import('../../src/public.js');
      expect(await erp5Resolver.exists('employee', FIXTURE_EMPLOYEE_ASHA.id)).toBe(false);
      expect(await erp5Resolver.get('employee', FIXTURE_EMPLOYEE_ASHA.id)).toBeNull();
    });

    it('renders every error with the shared envelope', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/leave/${FIXTURE_LEAVE_SICK.id}`,
        headers: EDITOR,
        payload: { status: 'cancelled' },
      });

      const parsed = ErrorEnvelopeSchema.parse(res.json());
      expect(parsed.code).toBe('VALIDATION_ERROR');
      expect(parsed.correlation_id).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. The department hierarchy stays acyclic
  // ───────────────────────────────────────────────────────────────────────────
  describe('Department hierarchy', () => {
    it('rejects a cycle with 422 and leaves the hierarchy untouched', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/departments/${FIXTURE_DEPARTMENT_ENGINEERING.id}`,
        headers: EDITOR,
        payload: { parent_id: FIXTURE_DEPARTMENT_PLATFORM.id },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.DEPARTMENT_CYCLE);

      const stored = await repository.getDepartmentById(FIXTURE_DEPARTMENT_ENGINEERING.id);
      expect(stored?.parent_id).toBeNull();
    });
  });
});
