/**
 * ERP-5 HR & Employees — Mutation API and Domain Validation Test Suite
 *
 * Exhaustively validates the V1 write surface of issue #48:
 *
 *   - Route-boundary Zod validation (400 with field-level details)
 *   - Authorization through the shared RBAC matrix (401 / 403)
 *   - Domain rules in the service layer (422 with a stable code)
 *   - Duplicates and idempotency conflicts (409)
 *   - Missing records (404)
 *   - Import receipts written in the same transaction as the target mutation
 *   - A repeated import returns the original receipt and mutates nothing
 *   - Protected / system-maintained fields are never accepted from a browser
 *   - The shared `{code, message, details, correlation_id}` error envelope
 *   - No SQL, stack trace, secret or raw row in an unexpected failure
 *   - BR-ERP5-01 — join date can never precede the birth date
 *   - BR-ERP5-02 — salary is masked and never leaves the module in full
 *
 * @module erp5/tests/api/mutations.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  ErrorEnvelopeSchema,
  HR_DOMAIN_RULES,
  HR_SALARY_MASK,
  type HrEmployeeMutationResponse,
} from '@clearshift/contracts';
import { buildHrApp } from '../../src/app.js';
import { HrService } from '../../src/services/hr.service.js';
import { InMemoryHrRepository } from '../../src/services/in-memory.repository.js';
import { AuditService, InMemoryAuditRepository } from '@cs/core';
import {
  FIXTURE_DEPARTMENT_ENGINEERING,
  FIXTURE_DEPARTMENT_FINANCE,
  FIXTURE_DEPARTMENT_PLATFORM,
  FIXTURE_EMPLOYEE_ASHA,
} from '../../fixtures/index.js';

const BASE = '/api/v1/erp-hr';
const EDITOR = { authorization: 'Bearer role:editor' };
const MIGRATION_RUNNER = { authorization: 'Bearer role:migration_runner' };
const ADMIN = { authorization: 'Bearer role:admin' };

const VALID_EMPLOYEE = {
  employee_no: 'EMP-9101',
  first_name: 'Meera',
  last_name: 'Nair',
  birth_date: '1993-03-08',
  join_date: '2023-11-06',
  department_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
  job_title: 'Backend Engineer',
  salary: '128000.0000',
  currency_code: 'INR',
};

describe('ERP-5 HR & Employees — Mutation API & Domain Validation (#48)', () => {
  let repository: InMemoryHrRepository;
  let hrService: HrService;
  let app: FastifyInstance;

  beforeEach(() => {
    repository = new InMemoryHrRepository(true);
    const auditService = new AuditService(new InMemoryAuditRepository());
    hrService = new HrService(repository, auditService);
    app = buildHrApp({ repository, hrService, authRequired: true });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Employee mutations
  // ───────────────────────────────────────────────────────────────────────────
  describe('Employee mutations', () => {
    it('creates an employee and returns the masked projection (BR-ERP5-02)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: VALID_EMPLOYEE,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as HrEmployeeMutationResponse;
      expect(body.employee_no).toBe('EMP-9101');
      expect(body.salary_display).toBe(HR_SALARY_MASK);
      expect(body).not.toHaveProperty('salary');
      expect(res.body).not.toContain('128000');
    });

    it('[BR-ERP5-01] rejects a join date before the birth date with 422', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: { ...VALID_EMPLOYEE, join_date: '1992-01-01' },
      });

      expect(res.statusCode).toBe(422);
      const err = res.json();
      expect(err.code).toBe(HR_DOMAIN_RULES.JOIN_DATE_AFTER_BIRTH_DATE);
      expect(err.details[0]?.field).toBe('join_date');
      expect(res.body).not.toContain('SELECT');
    });

    it('rejects a malformed body with 400 and field-level details', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: { ...VALID_EMPLOYEE, employee_no: 'EMP 9101', birth_date: '08-03-1993' },
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(err.details)).toBe(true);
      expect(err.details.length).toBeGreaterThan(0);
      expect(err.details.some((d: { field?: string }) => d.field === 'employee_no')).toBe(true);
    });

    it('rejects a protected field sent by a browser with 400 HR_PROTECTED_FIELD', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: { ...VALID_EMPLOYEE, id: randomUUID() },
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(err.code).toBe(HR_DOMAIN_RULES.PROTECTED_FIELD);
      expect(err.details[0]?.field).toBe('id');
    });

    it('rejects an unknown, non-protected field with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: { ...VALID_EMPLOYEE, nickname: 'ash' },
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details[0]?.message).toContain('nickname');
    });

    it('rejects a duplicate employee number with 409', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: { ...VALID_EMPLOYEE, employee_no: FIXTURE_EMPLOYEE_ASHA.employee_no },
      });

      expect(res.statusCode).toBe(409);
      const err = res.json();
      expect(err.code).toBe(HR_DOMAIN_RULES.EMPLOYEE_NO_DUPLICATE);
      expect(err.details[0]?.field).toBe('employee_no');
    });

    it('rejects an unknown department with 404', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: { ...VALID_EMPLOYEE, department_id: randomUUID() },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.DEPARTMENT_REQUIRED);
    });

    it('edits an employee and keeps the salary masked', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/employees/${FIXTURE_EMPLOYEE_ASHA.id}`,
        headers: EDITOR,
        payload: { job_title: 'Principal Engineer', salary: '139000.0000' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.job_title).toBe('Principal Engineer');
      expect(body.salary_display).toBe(HR_SALARY_MASK);
      expect(res.body).not.toContain('139000');
    });

    it('rejects an edit of an unknown employee with 404', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/employees/${randomUUID()}`,
        headers: EDITOR,
        payload: { job_title: 'Nobody' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    it('rejects a malformed id with 400', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/employees/not-a-uuid`,
        headers: EDITOR,
        payload: { job_title: 'Nobody' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('never accepts system-maintained fields as authoritative on edit', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/employees/${FIXTURE_EMPLOYEE_ASHA.id}`,
        headers: EDITOR,
        payload: {
          job_title: 'Staff Engineer',
          created_at: '2020-01-01T00:00:00.000Z',
          currency_code: 'EUR',
        },
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(err.code).toBe(HR_DOMAIN_RULES.PROTECTED_FIELD);
      const fields = err.details.map((d: { field?: string }) => d.field);
      expect(fields).toContain('created_at');
      expect(fields).toContain('currency_code');

      // The row is untouched.
      const stored = await repository.getEmployeeById(FIXTURE_EMPLOYEE_ASHA.id);
      expect(stored?.created_at).toBe(FIXTURE_EMPLOYEE_ASHA.created_at);
      expect(stored?.currency_code).toBe('INR');
    });

    it('rejects a source-identity field on a write without import provenance', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: { ...VALID_EMPLOYEE, source_system: 'legacy_hr_csv', source_id: 'row-1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.PROTECTED_FIELD);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Department mutations
  // ───────────────────────────────────────────────────────────────────────────
  describe('Department mutations', () => {
    it('creates a department', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/departments`,
        headers: EDITOR,
        payload: { name: 'Quality Assurance', code: 'QA' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.code).toBe('QA');
      expect(body.parent_id).toBeNull();
    });

    it('rejects a duplicate department code with 409', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/departments`,
        headers: EDITOR,
        payload: { name: 'Engineering West', code: 'ENG' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.DEPARTMENT_CODE_DUPLICATE);
    });

    it('rejects an unknown parent department with 404', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/departments`,
        headers: EDITOR,
        payload: { name: 'Orphan', code: 'ORPH', parent_id: randomUUID() },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.DEPARTMENT_REQUIRED);
    });

    it('edits a department', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/departments/${FIXTURE_DEPARTMENT_FINANCE.id}`,
        headers: EDITOR,
        payload: { name: 'Finance & Accounts' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Finance & Accounts');
    });

    it('rejects a self-referential parent with 422', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/departments/${FIXTURE_DEPARTMENT_PLATFORM.id}`,
        headers: EDITOR,
        payload: { parent_id: FIXTURE_DEPARTMENT_PLATFORM.id },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.DEPARTMENT_SELF_PARENT);
    });

    it('rejects a circular hierarchy with 422', async () => {
      // Platform's parent is Engineering — re-parenting Engineering under
      // Platform would close the cycle.
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/departments/${FIXTURE_DEPARTMENT_ENGINEERING.id}`,
        headers: EDITOR,
        payload: { parent_id: FIXTURE_DEPARTMENT_PLATFORM.id },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.DEPARTMENT_CYCLE);
    });

    it('rejects an edit of an unknown department with 404', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/departments/${randomUUID()}`,
        headers: EDITOR,
        payload: { name: 'Ghost' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Leave mutations
  // ───────────────────────────────────────────────────────────────────────────
  describe('Leave mutations', () => {
    it('creates a leave record', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/leave`,
        headers: EDITOR,
        payload: {
          employee_id: FIXTURE_EMPLOYEE_ASHA.id,
          date_from: '2026-05-04',
          date_to: '2026-05-08',
          type: 'holiday',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.type).toBe('holiday');
      expect(body.status).toBe('pending');
    });

    it('rejects a leave range that ends before it starts with 422', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/leave`,
        headers: EDITOR,
        payload: {
          employee_id: FIXTURE_EMPLOYEE_ASHA.id,
          date_from: '2026-05-08',
          date_to: '2026-05-04',
          type: 'holiday',
        },
      });

      expect(res.statusCode).toBe(422);
      const err = res.json();
      expect(err.code).toBe(HR_DOMAIN_RULES.LEAVE_DATE_RANGE_VALID);
      expect(err.details[0]?.field).toBe('date_to');
    });

    it('rejects a leave record for an unknown employee with 404', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/leave`,
        headers: EDITOR,
        payload: {
          employee_id: randomUUID(),
          date_from: '2026-05-04',
          date_to: '2026-05-08',
          type: 'sick',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.EMPLOYEE_REQUIRED);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Payroll aggregates
  // ───────────────────────────────────────────────────────────────────────────
  describe('Payroll aggregate mutations', () => {
    it('creates one department/month aggregate', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/payroll-totals`,
        headers: MIGRATION_RUNNER,
        payload: {
          department_id: FIXTURE_DEPARTMENT_PLATFORM.id,
          month: '2026-05',
          total_amount: '118500.5000',
          headcount: 1,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.month).toBe('2026-05');
      expect(body.total_amount).toBe('118500.5000');
      expect(body).not.toHaveProperty('employee_id');
    });

    it('rejects a second aggregate for the same department and month with 409', async () => {
      const first = await app.inject({
        method: 'POST',
        url: `${BASE}/payroll-totals`,
        headers: MIGRATION_RUNNER,
        payload: {
          department_id: FIXTURE_DEPARTMENT_PLATFORM.id,
          month: '2026-05',
          total_amount: '118500.5000',
        },
      });
      expect(first.statusCode).toBe(201);

      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/payroll-totals`,
        headers: MIGRATION_RUNNER,
        payload: {
          department_id: FIXTURE_DEPARTMENT_PLATFORM.id,
          month: '2026-05',
          total_amount: '99000.0000',
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.PAYROLL_TOTAL_DUPLICATE);
    });

    it('rejects an aggregate for an unknown department with 404', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/payroll-totals`,
        headers: MIGRATION_RUNNER,
        payload: {
          department_id: randomUUID(),
          month: '2026-05',
          total_amount: '1000.0000',
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it('rejects an aggregate that carries an employee row with 400 (FR-ERP5-06)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/payroll-totals`,
        headers: MIGRATION_RUNNER,
        payload: {
          department_id: FIXTURE_DEPARTMENT_PLATFORM.id,
          month: '2026-06',
          total_amount: '1000.0000',
          employee_id: FIXTURE_EMPLOYEE_ASHA.id,
        },
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(err.code).toBe(HR_DOMAIN_RULES.PROTECTED_FIELD);
      expect(err.details[0]?.field).toBe('employee_id');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Authorization — the shared RBAC matrix
  // ───────────────────────────────────────────────────────────────────────────
  describe('Authorization', () => {
    it('rejects an unauthenticated write with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        payload: VALID_EMPLOYEE,
      });

      expect(res.statusCode).toBe(401);
      const err = res.json();
      expect(err.code).toBe('UNAUTHORIZED');
      expect(err.correlation_id).toBeDefined();
    });

    it('rejects a viewer write with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { authorization: 'Bearer role:viewer' },
        payload: VALID_EMPLOYEE,
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it('rejects an analyst write with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/departments`,
        headers: { authorization: 'Bearer role:analyst' },
        payload: { name: 'Analytics', code: 'ANL' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects a migration-runner write with 403 — the Kit never writes module tables', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { authorization: 'Bearer role:migration_runner' },
        payload: VALID_EMPLOYEE,
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects an editor payroll load with 403 (PLT-06 `hr.payroll_bulk`)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/payroll-totals`,
        headers: EDITOR,
        payload: {
          department_id: FIXTURE_DEPARTMENT_PLATFORM.id,
          month: '2026-08',
          total_amount: '118500.5000',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it('lets a migration runner load a payroll aggregate (PLT-06 `hr.payroll_bulk`)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/payroll-totals`,
        headers: { authorization: 'Bearer role:migration_runner' },
        payload: {
          department_id: FIXTURE_DEPARTMENT_PLATFORM.id,
          month: '2026-08',
          total_amount: '118500.5000',
        },
      });

      expect(res.statusCode).toBe(201);
    });

    it('never returns the raw salary, not even to an admin (BR-ERP5-02, DR-5)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: ADMIN,
        payload: VALID_EMPLOYEE,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().salary_display).toBe(HR_SALARY_MASK);
      expect(res.body).not.toContain(VALID_EMPLOYEE.salary);
    });

    it('rejects a malformed Authorization header with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { authorization: 'Basic abc' },
        payload: VALID_EMPLOYEE,
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects an invalid or expired bearer token with 401', async () => {
      for (const token of ['invalid', 'expired']) {
        const res = await app.inject({
          method: 'POST',
          url: `${BASE}/employees`,
          headers: { authorization: `Bearer ${token}` },
          payload: VALID_EMPLOYEE,
        });

        expect(res.statusCode).toBe(401);
        expect(res.json().code).toBe('UNAUTHORIZED');
      }
    });

    it('rejects a role the shared matrix does not know with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { authorization: 'Bearer role:superuser' },
        payload: VALID_EMPLOYEE,
      });

      expect(res.statusCode).toBe(403);
    });

    it('serves the trusted internal context when authentication is not required', async () => {
      const openApp = buildHrApp({
        repository: new InMemoryHrRepository(true),
        hrService: new HrService(new InMemoryHrRepository(true), new AuditService(new InMemoryAuditRepository())),
        authRequired: false,
      });

      const res = await openApp.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        payload: VALID_EMPLOYEE,
      });

      expect(res.statusCode).toBe(201);
    });

    it('accepts an admin write', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: ADMIN,
        payload: VALID_EMPLOYEE,
      });

      expect(res.statusCode).toBe(201);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Import provenance, receipts and idempotency
  // ───────────────────────────────────────────────────────────────────────────
  describe('Import provenance and idempotency', () => {
    it('writes the import receipt in the same transaction as the target mutation', async () => {
      const idempotencyKey = `erp5-${randomUUID()}`;
      const batchId = randomUUID();

      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { ...EDITOR, 'idempotency-key': idempotencyKey },
        payload: {
          ...VALID_EMPLOYEE,
          source_system: 'legacy_hr_csv',
          source_id: 'row-42',
          batch_id: batchId,
          source_row: 42,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.import_receipt).toBeDefined();
      expect(body.import_receipt.idempotency_key).toBe(idempotencyKey);
      expect(body.import_receipt.batch_id).toBe(batchId);
      expect(body.import_receipt.source_row).toBe(42);
      expect(body.import_receipt.target_id).toBe(body.id);

      const stored = await repository.getImportReceiptByIdempotencyKey(idempotencyKey);
      expect(stored?.target_id).toBe(body.id);
    });

    it('returns the original receipt and mutates nothing on a repeated import', async () => {
      const idempotencyKey = `erp5-${randomUUID()}`;
      const payload = {
        ...VALID_EMPLOYEE,
        batch_id: randomUUID(),
        source_row: 7,
        idempotency_key: idempotencyKey,
      };

      const first = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { ...EDITOR, 'idempotency-key': idempotencyKey },
        payload,
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { ...EDITOR, 'idempotency-key': idempotencyKey },
        payload,
      });

      expect(second.statusCode).toBe(200);
      const firstBody = first.json();
      const secondBody = second.json();
      expect(secondBody.id).toBe(firstBody.id);
      expect(secondBody.import_receipt.id).toBe(firstBody.import_receipt.id);

      // Exactly one employee row exists.
      const stored = await repository.getEmployeeByEmployeeNo(VALID_EMPLOYEE.employee_no);
      expect(stored?.id).toBe(firstBody.id);
    });

    it('rejects the same idempotency key with a different payload with 409', async () => {
      const idempotencyKey = `erp5-${randomUUID()}`;
      const payload = {
        ...VALID_EMPLOYEE,
        batch_id: randomUUID(),
        source_row: 7,
        idempotency_key: idempotencyKey,
      };

      await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { ...EDITOR, 'idempotency-key': idempotencyKey },
        payload,
      });

      const conflict = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { ...EDITOR, 'idempotency-key': idempotencyKey },
        payload: { ...payload, job_title: 'A different title' },
      });

      expect(conflict.statusCode).toBe(409);
      const err = conflict.json();
      expect(err.code).toBe(HR_DOMAIN_RULES.IDEMPOTENCY_CONFLICT);
      expect(err.details[0]?.field).toBe('idempotency_key');
    });

    it('rejects an incomplete import provenance with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { ...EDITOR, 'idempotency-key': `erp5-${randomUUID()}` },
        payload: { ...VALID_EMPLOYEE, batch_id: randomUUID() },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED);
    });

    it('replays a leave import without a second leave record', async () => {
      const idempotencyKey = `erp5-${randomUUID()}`;
      const payload = {
        employee_id: FIXTURE_EMPLOYEE_ASHA.id,
        date_from: '2026-07-06',
        date_to: '2026-07-10',
        type: 'sick' as const,
        batch_id: randomUUID(),
        source_row: 21,
        idempotency_key: idempotencyKey,
      };

      const first = await app.inject({
        method: 'POST',
        url: `${BASE}/leave`,
        headers: { ...EDITOR, 'idempotency-key': idempotencyKey },
        payload,
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: `${BASE}/leave`,
        headers: { ...EDITOR, 'idempotency-key': idempotencyKey },
        payload,
      });

      expect(second.statusCode).toBe(200);
      const firstBody = first.json();
      const secondBody = second.json();
      expect(secondBody.id).toBe(firstBody.id);
      expect(secondBody.import_receipt.id).toBe(firstBody.import_receipt.id);
    });

    it('rejects an Idempotency-Key header that disagrees with the body field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { ...EDITOR, 'idempotency-key': 'erp5-header-key' },
        payload: {
          ...VALID_EMPLOYEE,
          batch_id: randomUUID(),
          source_row: 1,
          idempotency_key: 'erp5-body-key',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(HR_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Error envelope, correlation id and safe failure handling
  // ───────────────────────────────────────────────────────────────────────────
  describe('Error envelope, correlation id and safe failures', () => {
    it('renders every error with the shared envelope', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: { ...VALID_EMPLOYEE, join_date: '1992-01-01' },
      });

      expect(res.statusCode).toBe(422);
      const parsed = ErrorEnvelopeSchema.parse(res.json());
      expect(parsed.code).toBe(HR_DOMAIN_RULES.JOIN_DATE_AFTER_BIRTH_DATE);
      expect(parsed.details.length).toBeGreaterThan(0);
      expect(parsed.correlation_id).toBeDefined();
    });

    it('echoes a client supplied correlation id', async () => {
      const correlationId = 'test-corr-id-12345';

      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: { ...EDITOR, 'x-correlation-id': correlationId },
        payload: { first_name: 'Missing' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.headers['x-correlation-id']).toBe(correlationId);
      expect(res.json().correlation_id).toBe(correlationId);
    });

    it('generates a correlation id when the client does not supply one', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${BASE}/employees/00000000-0000-0000-0000-000000000000`,
        headers: EDITOR,
        payload: { job_title: 'Nobody' },
      });

      expect(res.statusCode).toBe(404);
      const err = res.json();
      expect(typeof err.correlation_id).toBe('string');
      expect(err.correlation_id.length).toBeGreaterThan(0);
      expect(res.headers['x-correlation-id']).toBe(err.correlation_id);
    });

    it('answers an unknown route with the shared envelope', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/does-not-exist`,
        headers: EDITOR,
      });

      expect(res.statusCode).toBe(404);
      const parsed = ErrorEnvelopeSchema.parse(res.json());
      expect(parsed.code).toBe('NOT_FOUND');
      expect(parsed.correlation_id).toBeDefined();
    });

    it('masks SQL and secrets in an unexpected failure and never leaks a stack trace', async () => {
      const failingRepository = new InMemoryHrRepository(true);
      failingRepository.createEmployee = async () => {
        throw new Error('SELECT * FROM erp5.employees WHERE password_hash = "secret" FAILED');
      };
      const failingApp = buildHrApp({
        repository: failingRepository,
        hrService: new HrService(failingRepository, new AuditService(new InMemoryAuditRepository())),
        authRequired: true,
      });

      const res = await failingApp.inject({
        method: 'POST',
        url: `${BASE}/employees`,
        headers: EDITOR,
        payload: VALID_EMPLOYEE,
      });

      expect(res.statusCode).toBe(500);
      const err = res.json();
      expect(err.code).toBe('INTERNAL_SERVER_ERROR');
      expect(err.message).toBe('An unexpected internal error occurred.');
      expect(err.correlation_id).toBeDefined();
      expect(err.details).toEqual([]);
      expect(res.body).not.toContain('SELECT');
      expect(res.body).not.toContain('password_hash');
      expect(res.body).not.toContain('at Object');
    });
  });
});
