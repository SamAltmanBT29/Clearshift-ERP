// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Module API Client Tests
 *
 * The client is the only place the module talks to the API, so these tests
 * pin the three properties the screens depend on: the query really reaches
 * the server, the session travels with the request, and a failure never
 * leaks anything but the shared error envelope.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ERP5_API_BASE,
  HrApiError,
  buildHrQueryString,
  listDepartments,
  listEmployees,
  listIdentityUsers,
  listLeave,
  listPayrollTotals,
  toHrApiError,
} from '../src/api/erp-5.js';
import { clearStoredAccessToken, storeAccessToken, validAccessToken } from './support/session.js';

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

let requests: RecordedRequest[] = [];

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

const EMPTY_PAGE = { data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } };

describe('ERP-5 module API client', () => {
  beforeEach(() => {
    requests = [];
    clearStoredAccessToken();
  });

  afterEach(() => {
    clearStoredAccessToken();
    vi.unstubAllGlobals();
  });

  describe('1. Query construction', () => {
    it('drops every value the caller did not set', () => {
      expect(
        buildHrQueryString({ page: 1, pageSize: 25, search: '', department_id: undefined })
      ).toBe('?page=1&pageSize=25');
    });

    it('keeps the values that were set', () => {
      expect(
        buildHrQueryString({ page: 2, pageSize: 10, search: 'asha', sort: 'name' })
      ).toBe('?page=2&pageSize=10&search=asha&sort=name');
    });

    it('returns an empty string when nothing was set', () => {
      expect(buildHrQueryString({})).toBe('');
    });
  });

  describe('2. Requests', () => {
    it('calls the module API base', async () => {
      respond(200, EMPTY_PAGE);
      await listEmployees({ page: 1, pageSize: 25, sort: 'name' });

      expect(requests[0]?.url.startsWith(`${ERP5_API_BASE}/employees`)).toBe(true);
    });

    it('sends the paging, the search and the filters to the server', async () => {
      respond(200, EMPTY_PAGE);
      await listEmployees({
        page: 3,
        pageSize: 10,
        sort: 'employee_no',
        search: 'asha',
        department_id: '11111111-1111-1111-1111-111111111111',
      });

      const url = new URL(requests[0]?.url ?? '', 'http://clearshift.test');
      expect(url.searchParams.get('page')).toBe('3');
      expect(url.searchParams.get('pageSize')).toBe('10');
      expect(url.searchParams.get('sort')).toBe('employee_no');
      expect(url.searchParams.get('search')).toBe('asha');
      expect(url.searchParams.get('department_id')).toBe('11111111-1111-1111-1111-111111111111');
    });

    it('sends the session with the request', async () => {
      storeAccessToken(validAccessToken());
      respond(200, EMPTY_PAGE);
      await listEmployees({ page: 1, pageSize: 25, sort: 'name' });

      const headers = requests[0]?.init?.headers as Record<string, string>;
      expect(headers['Authorization']).toMatch(/^Bearer /);
    });

    it('sends no authorization header when there is no session', async () => {
      respond(200, EMPTY_PAGE);
      await listEmployees({ page: 1, pageSize: 25, sort: 'name' });

      const headers = requests[0]?.init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('reads every collection of the module', async () => {
      respond(200, EMPTY_PAGE);

      await listEmployees({ page: 1, pageSize: 25, sort: 'name' });
      await listDepartments({ page: 1, pageSize: 25, sort: 'name' });
      await listLeave({ page: 1, pageSize: 25 });
      await listPayrollTotals({ page: 1, pageSize: 25 });
      await listIdentityUsers({ page: 1, pageSize: 25 });

      expect(requests.map((request) => new URL(request.url, 'http://x').pathname)).toEqual([
        '/api/v1/erp-hr/employees',
        '/api/v1/erp-hr/departments',
        '/api/v1/erp-hr/leave',
        '/api/v1/erp-hr/payroll-totals',
        '/api/v1/erp-hr/identity-users',
      ]);
    });
  });

  describe('3. Failure handling', () => {
    it('turns a refused request into an error carrying the shared envelope', async () => {
      respond(403, {
        code: 'FORBIDDEN',
        message: 'Access denied. Required capability: module.read',
        details: [],
        correlation_id: 'corr-1',
      });

      const error = await listEmployees({ page: 1, pageSize: 25, sort: 'name' }).catch(
        (cause: unknown) => cause
      );

      expect(error).toBeInstanceOf(HrApiError);
      expect((error as HrApiError).status).toBe(403);
      expect((error as HrApiError).code).toBe('FORBIDDEN');
      expect((error as HrApiError).message).toBe('Access denied. Required capability: module.read');
      expect((error as HrApiError).correlationId).toBe('corr-1');
      expect((error as HrApiError).isPermissionDenied).toBe(true);
    });

    it('reads the field details of a rejected request', async () => {
      respond(400, {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'pageSize', message: 'pageSize cannot exceed 100', code: 'too_big' }],
        correlation_id: 'corr-2',
      });

      const error = await listEmployees({ page: 1, pageSize: 500, sort: 'name' }).catch(
        (cause: unknown) => cause
      );

      expect((error as HrApiError).status).toBe(400);
      expect((error as HrApiError).details).toHaveLength(1);
      expect((error as HrApiError).details[0]?.field).toBe('pageSize');
    });

    it('falls back to a readable message when the envelope is missing', async () => {
      respond(500, {});
      const error = await listEmployees({ page: 1, pageSize: 25, sort: 'name' }).catch(
        (cause: unknown) => cause
      );

      expect((error as HrApiError).status).toBe(500);
      expect((error as HrApiError).message.length).toBeGreaterThan(0);
    });

    it('has a readable message for every status the module answers with', async () => {
      const cases: [number, string][] = [
        [400, 'The request was rejected because it is not valid.'],
        [401, 'Your session is missing or has expired. Sign in again to continue.'],
        [403, 'You do not have permission to view this data.'],
        [404, 'The requested record does not exist.'],
        [409, 'The request conflicts with the current state of the record.'],
        [422, 'The request breaks a business rule of the HR module.'],
      ];

      for (const [status, message] of cases) {
        respond(status, {});
        const error = await listEmployees({ page: 1, pageSize: 25, sort: 'name' }).catch(
          (cause: unknown) => cause
        );
        expect((error as HrApiError).message).toBe(message);
      }
    });

    it('turns a transport failure into a retryable error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        })
      );

      const error = await listEmployees({ page: 1, pageSize: 25, sort: 'name' }).catch(
        (cause: unknown) => cause
      );

      expect(error).toBeInstanceOf(HrApiError);
      expect((error as HrApiError).status).toBe(0);
      expect((error as HrApiError).code).toBe('HR_API_UNREACHABLE');
    });

    it('never leaks a stack trace or a raw row into the error', async () => {
      respond(500, { code: 'INTERNAL_SERVER_ERROR', message: 'boom', details: [] });
      const error = await listEmployees({ page: 1, pageSize: 25, sort: 'name' }).catch(
        (cause: unknown) => cause
      );

      const serialized = JSON.stringify({
        status: (error as HrApiError).status,
        code: (error as HrApiError).code,
        message: (error as HrApiError).message,
        details: (error as HrApiError).details,
      });

      expect(serialized).not.toContain('stack');
      expect(serialized).not.toContain('SELECT');
    });

    it('keeps an error that is already an API error', () => {
      const original = new HrApiError(404, 'NOT_FOUND', 'gone');
      expect(toHrApiError(original)).toBe(original);
    });
  });
});
