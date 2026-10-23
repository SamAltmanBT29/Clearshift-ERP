// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Mutation API Client Tests
 *
 * The write path of the module API client: the method, the path, the body
 * and — above all — what a failure looks like to the form that made it.
 *
 * @module erp5/web/tests/hr-mutations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ERP5_API_BASE,
  HrApiError,
  createDepartment,
  createEmployee,
  createLeave,
  getDepartment,
  getEmployee,
  getLeave,
  updateDepartment,
  updateEmployee,
  updateLeave,
} from '../src/api/erp-5.js';
import {
  clearStoredAccessToken,
  storeAccessToken,
  validAccessToken,
} from './support/session.js';

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

let requests: RecordedRequest[] = [];

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: (init?.method ?? 'GET').toUpperCase(),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

const EMPLOYEE = {
  id: 'e1000000-0000-4000-8000-000000000001',
  employee_no: 'EMP-0001',
  first_name: 'Asha',
  last_name: 'Iyer',
  birth_date: '1990-04-12',
  join_date: '2024-01-08',
  department_id: 'd1000000-0000-4000-8000-000000000001',
  job_title: 'Software Engineer',
  salary_display: 'XX,XXX',
  currency_code: 'INR',
  created_at: '2026-04-15T12:00:00.000Z',
  updated_at: '2026-04-15T12:00:00.000Z',
};

const EMPLOYEE_PAYLOAD = {
  employee_no: 'EMP-0001',
  first_name: 'Asha',
  last_name: 'Iyer',
  birth_date: '1990-04-12',
  join_date: '2024-01-08',
  department_id: 'd1000000-0000-4000-8000-000000000001',
  job_title: 'Software Engineer',
  salary: '150000.0000',
};

describe('ERP-5 mutation API client', () => {
  beforeEach(() => {
    requests = [];
    clearStoredAccessToken();
    storeAccessToken(validAccessToken());
  });

  afterEach(() => {
    clearStoredAccessToken();
    vi.unstubAllGlobals();
  });

  describe('1. Reading one record', () => {
    it('reads the employee, the department and the leave record', async () => {
      respond(200, EMPLOYEE);

      await getEmployee(EMPLOYEE.id);
      await getDepartment('d1000000-0000-4000-8000-000000000001');
      await getLeave('l1000000-0000-4000-8000-000000000001');

      expect(requests.map((request) => request.url)).toEqual([
        `${ERP5_API_BASE}/employees/${EMPLOYEE.id}`,
        `${ERP5_API_BASE}/departments/d1000000-0000-4000-8000-000000000001`,
        `${ERP5_API_BASE}/leave/l1000000-0000-4000-8000-000000000001`,
      ]);
      expect(requests.every((request) => request.method === 'GET')).toBe(true);
    });
  });

  describe('2. Writing a record', () => {
    it('creates the employee with a POST and the payload', async () => {
      respond(201, EMPLOYEE);

      await createEmployee(EMPLOYEE_PAYLOAD);

      expect(requests[0]?.method).toBe('POST');
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/employees`);
      expect(requests[0]?.body).toEqual(EMPLOYEE_PAYLOAD);
    });

    it('edits the employee with a PATCH and only the changed fields', async () => {
      respond(200, EMPLOYEE);

      await updateEmployee(EMPLOYEE.id, { job_title: 'Staff Engineer' });

      expect(requests[0]?.method).toBe('PATCH');
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/employees/${EMPLOYEE.id}`);
      expect(requests[0]?.body).toEqual({ job_title: 'Staff Engineer' });
    });

    it('creates and edits a department', async () => {
      respond(200, {});
      await createDepartment({ name: 'Data', code: 'DATA' });
      await updateDepartment('d1000000-0000-4000-8000-000000000001', { name: 'Data' });

      expect(requests[0]?.method).toBe('POST');
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/departments`);
      expect(requests[0]?.body).toEqual({ name: 'Data', code: 'DATA' });
      expect(requests[1]?.method).toBe('PATCH');
      expect(requests[1]?.url).toBe(
        `${ERP5_API_BASE}/departments/d1000000-0000-4000-8000-000000000001`
      );
    });

    it('creates and edits a leave record', async () => {
      respond(200, {});
      await createLeave({
        employee_id: EMPLOYEE.id,
        date_from: '2026-05-04',
        date_to: '2026-05-08',
        type: 'holiday',
      });
      await updateLeave('l1000000-0000-4000-8000-000000000001', { status: 'approved' });

      expect(requests[0]?.method).toBe('POST');
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/leave`);
      expect(requests[1]?.method).toBe('PATCH');
      expect(requests[1]?.url).toBe(
        `${ERP5_API_BASE}/leave/l1000000-0000-4000-8000-000000000001`
      );
      expect(requests[1]?.body).toEqual({ status: 'approved' });
    });
  });

  describe('3. A refused write', () => {
    it('turns a 403 into a permission-denied error', async () => {
      respond(403, {
        code: 'FORBIDDEN',
        message: 'Access denied. Required capability: module.write',
        details: [],
        correlation_id: 'corr-1',
      });

      const error = await createEmployee(EMPLOYEE_PAYLOAD).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(HrApiError);
      expect((error as HrApiError).status).toBe(403);
      expect((error as HrApiError).isPermissionDenied).toBe(true);
      expect((error as HrApiError).correlationId).toBe('corr-1');
    });

    it('turns a 422 into a field-level error', async () => {
      respond(422, {
        code: 'HR_JOIN_DATE_AFTER_BIRTH_DATE',
        message: 'join_date must not be before birth_date',
        details: [
          {
            field: 'join_date',
            message: 'join_date must not be before birth_date',
            code: 'HR_JOIN_DATE_AFTER_BIRTH_DATE',
          },
        ],
        correlation_id: 'corr-2',
      });

      const error = await createEmployee(EMPLOYEE_PAYLOAD).catch((cause: unknown) => cause);

      expect((error as HrApiError).status).toBe(422);
      expect((error as HrApiError).details[0]?.field).toBe('join_date');
    });

    it('turns a 409 into a conflict error', async () => {
      respond(409, {
        code: 'HR_DUPLICATE_EMPLOYEE_NO',
        message: 'An employee with this number already exists.',
        details: [],
        correlation_id: 'corr-3',
      });

      const error = await createEmployee(EMPLOYEE_PAYLOAD).catch((cause: unknown) => cause);

      expect((error as HrApiError).status).toBe(409);
      expect((error as HrApiError).code).toBe('HR_DUPLICATE_EMPLOYEE_NO');
    });

    it('turns a transport failure into a retryable error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        })
      );

      const error = await createEmployee(EMPLOYEE_PAYLOAD).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(HrApiError);
      expect((error as HrApiError).status).toBe(0);
      expect((error as HrApiError).code).toBe('HR_API_UNREACHABLE');
    });

    it('turns an unreadable answer into a readable error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('not json', { status: 200 }))
      );

      const error = await createEmployee(EMPLOYEE_PAYLOAD).catch((cause: unknown) => cause);

      expect((error as HrApiError).code).toBe('HR_API_MALFORMED_RESPONSE');
    });

    it('falls back to a readable message when the error body is not JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('<html>gateway error</html>', { status: 502 }))
      );

      const error = await createEmployee(EMPLOYEE_PAYLOAD).catch((cause: unknown) => cause);

      expect((error as HrApiError).status).toBe(502);
      expect((error as HrApiError).message.length).toBeGreaterThan(0);
    });

    it('lets an aborted request through, so a cancelled screen shows no error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          const aborted = new Error('The operation was aborted.');
          aborted.name = 'AbortError';
          throw aborted;
        })
      );

      const error = await createEmployee(EMPLOYEE_PAYLOAD).catch((cause: unknown) => cause);

      // The abort is re-thrown as it is — it must not be dressed up as a
      // failure the operator would be offered a retry for.
      expect((error as Error).name).toBe('AbortError');
      expect(error).not.toBeInstanceOf(HrApiError);
    });
  });
});
