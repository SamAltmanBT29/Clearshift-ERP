// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Web API Client Comprehensive Test Suite (Issue #205 / ERP5-29)
 *
 * Verifies all API client operations:
 * - Query parameter serialization and empty value dropping
 * - Authorization bearer token header attachment from session
 * - Collection list endpoints: listEmployees, listDepartments, listLeave, listPayrollTotals, listIdentityUsers
 * - Single-record reads: getEmployee, getDepartment, getLeave
 * - Resource mutations: createEmployee, updateEmployee, createDepartment, updateDepartment, createLeave, updateLeave
 * - Error normalization into HrApiError with status, code, message, details, and correlation_id
 * - Permission-denied classification (status 403 -> isPermissionDenied: true)
 * - AbortError detection and network unreachable fallback
 *
 * @module erp5/web/tests/erp-5-api-client.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ERP5_API_BASE,
  HrApiError,
  buildHrQueryString,
  isAbortError,
  toHrApiError,
  listEmployees,
  listDepartments,
  listLeave,
  listPayrollTotals,
  listIdentityUsers,
  getEmployee,
  getDepartment,
  getLeave,
  createEmployee,
  updateEmployee,
  createDepartment,
  updateDepartment,
  createLeave,
  updateLeave,
} from '../src/api/erp-5.js';
import { clearStoredAccessToken, storeAccessToken, validAccessToken } from './support/session.js';

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

let requests: RecordedRequest[] = [];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

const EMPTY_PAGE = { data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } };
const FAKE_UUID = '5eed0000-0000-4000-8000-000000000001';

describe('ERP-5 Web API Client Test Suite (ERP5-29)', () => {
  beforeEach(() => {
    requests = [];
    clearStoredAccessToken();
  });

  afterEach(() => {
    clearStoredAccessToken();
    vi.unstubAllGlobals();
  });

  function stubFetch(response: Response | (() => Promise<Response>)) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return typeof response === 'function' ? response() : response;
      })
    );
  }

  // ── 1. Query Serialization & Headers ───────────────────────────────────────
  describe('1. Query Serialization and Transport Headers', () => {
    it('drops empty or undefined query values', () => {
      expect(buildHrQueryString({})).toBe('');
      expect(buildHrQueryString({ search: '', department_id: undefined, page: null })).toBe('');
      expect(buildHrQueryString({ page: 2, pageSize: 50, search: 'Aarav' })).toBe(
        '?page=2&pageSize=50&search=Aarav'
      );
    });

    it('attaches Bearer authorization header when valid token is in session', async () => {
      storeAccessToken(validAccessToken({ roles: ['hr_admin'] }));
      stubFetch(jsonResponse(EMPTY_PAGE));

      await listEmployees({ page: 1, pageSize: 25 });
      expect(requests).toHaveLength(1);
      const headers = requests[0]?.init?.headers as Record<string, string>;
      expect(headers['Authorization']).toMatch(/^Bearer /);
      expect(headers['Accept']).toBe('application/json');
    });

    it('omits Bearer authorization header when no token is in session', async () => {
      clearStoredAccessToken();
      stubFetch(jsonResponse(EMPTY_PAGE));

      await listEmployees({ page: 1, pageSize: 25 });
      expect(requests).toHaveLength(1);
      const headers = requests[0]?.init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  // ── 2. Collection List Operations ──────────────────────────────────────────
  describe('2. Collection List Operations', () => {
    it('listEmployees sends query parameters to /employees', async () => {
      stubFetch(jsonResponse(EMPTY_PAGE));
      await listEmployees({ page: 2, pageSize: 50, search: 'Sharma', department_id: FAKE_UUID });
      expect(requests[0]?.url).toBe(
        `${ERP5_API_BASE}/employees?page=2&pageSize=50&search=Sharma&department_id=${FAKE_UUID}`
      );
    });

    it('listDepartments hits /departments endpoint', async () => {
      stubFetch(jsonResponse(EMPTY_PAGE));
      await listDepartments({ page: 1, pageSize: 10, search: 'Engineering' });
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/departments?page=1&pageSize=10&search=Engineering`);
    });

    it('listLeave hits /leave endpoint with filters', async () => {
      stubFetch(jsonResponse(EMPTY_PAGE));
      await listLeave({ page: 1, pageSize: 25, status: 'approved', leave_type: 'annual' });
      expect(requests[0]?.url).toBe(
        `${ERP5_API_BASE}/leave?page=1&pageSize=25&status=approved&leave_type=annual`
      );
    });

    it('listPayrollTotals hits /payroll-totals endpoint', async () => {
      stubFetch(jsonResponse(EMPTY_PAGE));
      await listPayrollTotals({ page: 1, pageSize: 12, month: '2026-06' });
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/payroll-totals?page=1&pageSize=12&month=2026-06`);
    });

    it('listIdentityUsers hits /identity-users endpoint', async () => {
      stubFetch(jsonResponse(EMPTY_PAGE));
      await listIdentityUsers({ page: 1, pageSize: 20 });
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/identity-users?page=1&pageSize=20`);
    });
  });

  // ── 3. Single Record Reads ─────────────────────────────────────────────────
  describe('3. Single Record Reads', () => {
    it('getEmployee reads employee by id', async () => {
      const mockEmployee = { id: FAKE_UUID, employee_no: 'EMP-1001', first_name: 'Aarav' };
      stubFetch(jsonResponse(mockEmployee));

      const result = await getEmployee(FAKE_UUID);
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/employees/${FAKE_UUID}`);
      expect(result).toEqual(mockEmployee);
    });

    it('getDepartment reads department by id', async () => {
      const mockDept = { id: FAKE_UUID, code: 'ENG', name: 'Engineering' };
      stubFetch(jsonResponse(mockDept));

      const result = await getDepartment(FAKE_UUID);
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/departments/${FAKE_UUID}`);
      expect(result).toEqual(mockDept);
    });

    it('getLeave reads leave by id', async () => {
      const mockLeave = { id: FAKE_UUID, leave_type: 'annual', status: 'approved' };
      stubFetch(jsonResponse(mockLeave));

      const result = await getLeave(FAKE_UUID);
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/leave/${FAKE_UUID}`);
      expect(result).toEqual(mockLeave);
    });
  });

  // ── 4. Resource Mutations ──────────────────────────────────────────────────
  describe('4. Resource Mutations', () => {
    it('createEmployee issues POST /employees with JSON payload', async () => {
      const payload = {
        employee_no: 'EMP-1001',
        first_name: 'Aarav',
        last_name: 'Sharma',
        department_id: FAKE_UUID,
        job_title: 'Staff Engineer',
        birth_date: '1985-05-15',
        join_date: '2015-06-01',
        salary: '85000.0000',
        currency_code: 'INR' as const,
      };
      stubFetch(jsonResponse({ id: FAKE_UUID, ...payload }, 201));

      await createEmployee(payload);
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/employees`);
      expect(requests[0]?.init?.method).toBe('POST');
      expect(JSON.parse(requests[0]?.init?.body as string)).toEqual(payload);
    });

    it('updateEmployee issues PATCH /employees/:id with partial payload', async () => {
      const payload = { job_title: 'Principal Engineer' };
      stubFetch(jsonResponse({ id: FAKE_UUID, ...payload }, 200));

      await updateEmployee(FAKE_UUID, payload);
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/employees/${FAKE_UUID}`);
      expect(requests[0]?.init?.method).toBe('PATCH');
      expect(JSON.parse(requests[0]?.init?.body as string)).toEqual(payload);
    });

    it('createDepartment issues POST /departments', async () => {
      const payload = { code: 'ENG', name: 'Engineering' };
      stubFetch(jsonResponse({ id: FAKE_UUID, ...payload }, 201));

      await createDepartment(payload);
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/departments`);
      expect(requests[0]?.init?.method).toBe('POST');
    });

    it('updateDepartment issues PATCH /departments/:id', async () => {
      const payload = { name: 'Engineering & Architecture' };
      stubFetch(jsonResponse({ id: FAKE_UUID, ...payload }, 200));

      await updateDepartment(FAKE_UUID, payload);
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/departments/${FAKE_UUID}`);
      expect(requests[0]?.init?.method).toBe('PATCH');
    });

    it('createLeave issues POST /leave', async () => {
      const payload = {
        employee_id: FAKE_UUID,
        leave_type: 'annual' as const,
        date_from: '2026-07-01',
        date_to: '2026-07-05',
      };
      stubFetch(jsonResponse({ id: FAKE_UUID, ...payload, status: 'pending' }, 201));

      await createLeave(payload);
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/leave`);
      expect(requests[0]?.init?.method).toBe('POST');
    });

    it('updateLeave issues PATCH /leave/:id', async () => {
      const payload = { status: 'approved' as const };
      stubFetch(jsonResponse({ id: FAKE_UUID, ...payload }, 200));

      await updateLeave(FAKE_UUID, payload);
      expect(requests[0]?.url).toBe(`${ERP5_API_BASE}/leave/${FAKE_UUID}`);
      expect(requests[0]?.init?.method).toBe('PATCH');
    });
  });

  // ── 5. Error Handling, Normalization & Correlation ─────────────────────────
  describe('5. Error Handling, Normalization and Correlation ID', () => {
    it('normalizes structured error envelope { code, message, details, correlation_id }', async () => {
      const errorPayload = {
        code: 'HR_JOIN_DATE_BEFORE_BIRTH_DATE',
        message: 'Join date cannot precede birth date',
        details: [{ field: 'join_date', message: 'Must be on or after birth_date' }],
        correlation_id: 'corr-xyz-123',
      };
      stubFetch(jsonResponse(errorPayload, 422));

      await expect(
        createEmployee({} as never)
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(HrApiError);
        const apiErr = err as HrApiError;
        expect(apiErr.status).toBe(422);
        expect(apiErr.code).toBe('HR_JOIN_DATE_BEFORE_BIRTH_DATE');
        expect(apiErr.message).toBe('Join date cannot precede birth date');
        expect(apiErr.details).toHaveLength(1);
        expect(apiErr.correlationId).toBe('corr-xyz-123');
        expect(apiErr.isPermissionDenied).toBe(false);
        return true;
      });
    });

    it('flags permission-denied errors (HTTP 403) via isPermissionDenied getter', async () => {
      stubFetch(
        jsonResponse(
          { code: 'HR_FORBIDDEN', message: 'You do not have permission.' },
          403,
          { 'x-correlation-id': 'corr-403' }
        )
      );

      await expect(getEmployee(FAKE_UUID)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(HrApiError);
        const apiErr = err as HrApiError;
        expect(apiErr.status).toBe(403);
        expect(apiErr.isPermissionDenied).toBe(true);
        expect(apiErr.correlationId).toBe('corr-403');
        return true;
      });
    });

    it('falls back to status 0 and HR_API_UNREACHABLE when network fails completely', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('Failed to fetch (DNS / Network Error)'))
      );

      await expect(listEmployees({ page: 1, pageSize: 10 })).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(HrApiError);
        const apiErr = err as HrApiError;
        expect(apiErr.status).toBe(0);
        expect(apiErr.code).toBe('HR_API_UNREACHABLE');
        return true;
      });
    });

    it('identifies AbortError and does not wrap it into an HrApiError', async () => {
      const abortErr = new Error('The user aborted a request.');
      abortErr.name = 'AbortError';
      expect(isAbortError(abortErr)).toBe(true);
      expect(isAbortError(new Error('Other'))).toBe(false);

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));
      await expect(listEmployees({ page: 1, pageSize: 10 })).rejects.toThrowError(
        'The user aborted a request.'
      );
    });

    it('toHrApiError helper preserves existing HrApiError instances', () => {
      const original = new HrApiError(404, 'HR_NOT_FOUND', 'Not found');
      expect(toHrApiError(original)).toBe(original);
      const fromGeneric = toHrApiError(new Error('Generic failure'));
      expect(fromGeneric.status).toBe(0);
      expect(fromGeneric.code).toBe('HR_API_UNREACHABLE');
    });
  });
});
