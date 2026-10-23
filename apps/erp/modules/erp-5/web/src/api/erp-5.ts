/**
 * ERP-5 HR & Employees — Module API Client
 *
 * The typed client for the module's public API, `/api/v1/erp-hr`.
 *
 * Every request carries the Hub access token, every query parameter is sent
 * to the **server** — the browser never filters, sorts or paginates a
 * collection itself — and every failure is normalised into an
 * {@link HrApiError} that carries the shared error envelope
 * `{ code, message, details, correlation_id }` and nothing else. A stack
 * trace, a SQL statement or a raw row never reaches the UI.
 *
 * @module erp5/web/api/erp-5
 */

import type {
  CreateHrDepartmentRequest,
  CreateHrEmployeeRequest,
  CreateHrLeaveRequest,
  HrDepartment,
  HrDepartmentListQuery,
  HrEmployeeListQuery,
  HrEmployeeView,
  HrIdentityUser,
  HrIdentityUserListQuery,
  HrLeave,
  HrLeaveListQuery,
  HrListMeta,
  HrPayrollTotal,
  HrPayrollTotalListQuery,
  UpdateHrDepartmentRequest,
  UpdateHrEmployeeRequest,
  UpdateHrLeaveRequest,
} from '@clearshift/contracts';
import { readAccessToken } from '../auth/session.js';

/** The public API base of the module. */
export const ERP5_API_BASE = '/api/v1/erp-hr';

export interface HrApiErrorDetail {
  readonly field?: string;
  readonly message: string;
  readonly code?: string;
}

/**
 * A failed API call.
 *
 * `status` is the HTTP status. `status === 0` means the request never
 * reached the API (no network, DNS failure, offline). `status === 403` is
 * the permission-denied case and is rendered as its own state.
 */
export class HrApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: readonly HrApiErrorDetail[];
  public readonly correlationId: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: readonly HrApiErrorDetail[] = [],
    correlationId: string | null = null
  ) {
    super(message);
    this.name = 'HrApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.correlationId = correlationId;
  }

  /** True when the API refused the request for lack of permission. */
  get isPermissionDenied(): boolean {
    return this.status === 403;
  }
}

/** The bounded list envelope every collection endpoint returns. */
export interface HrListResponse<T> {
  readonly data: T[];
  readonly meta: HrListMeta;
}

export interface HrRequestOptions {
  readonly signal?: AbortSignal | undefined;
}

type HrQueryValue = string | number | boolean | undefined | null;

/**
 * Builds a query string, dropping every value the caller did not set.
 *
 * An empty search term is dropped rather than sent as `search=`, because the
 * module's query schema treats a blank string as invalid input.
 */
export function buildHrQueryString(params: Record<string, HrQueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

function toQueryRecord(query: object): Record<string, HrQueryValue> {
  return query as Record<string, HrQueryValue>;
}

/** True when a rejection is the result of an aborted request. */
export function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'name' in cause &&
    (cause as { name?: unknown }).name === 'AbortError'
  );
}

/** Normalises an unknown rejection into an {@link HrApiError}. */
export function toHrApiError(cause: unknown): HrApiError {
  if (cause instanceof HrApiError) {
    return cause;
  }
  return new HrApiError(
    0,
    'HR_API_UNREACHABLE',
    'The HR module API could not be reached. Check the connection and try again.'
  );
}

function defaultMessageForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'The request was rejected because it is not valid.';
    case 401:
      return 'Your session is missing or has expired. Sign in again to continue.';
    case 403:
      return 'You do not have permission to view this data.';
    case 404:
      return 'The requested record does not exist.';
    case 409:
      return 'The request conflicts with the current state of the record.';
    case 422:
      return 'The request breaks a business rule of the HR module.';
    default:
      return 'The HR module API could not complete the request.';
  }
}

function isErrorDetail(value: unknown): value is HrApiErrorDetail {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

async function readHrApiError(response: Response): Promise<HrApiError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const envelope = (payload ?? {}) as Record<string, unknown>;
  const code =
    typeof envelope['code'] === 'string' ? envelope['code'] : `HR_HTTP_${response.status}`;
  const message =
    typeof envelope['message'] === 'string'
      ? envelope['message']
      : defaultMessageForStatus(response.status);

  const rawDetails = envelope['details'];
  const details = Array.isArray(rawDetails) ? rawDetails.filter(isErrorDetail) : [];

  const correlationId =
    typeof envelope['correlation_id'] === 'string'
      ? envelope['correlation_id']
      : response.headers.get('x-correlation-id');

  return new HrApiError(response.status, code, message, details, correlationId);
}

async function hrRequest<T>(
  path: string,
  query: Record<string, HrQueryValue>,
  options: HrRequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = readAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${ERP5_API_BASE}${path}${buildHrQueryString(query)}`, {
      headers,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause;
    }
    throw toHrApiError(cause);
  }

  if (!response.ok) {
    throw await readHrApiError(response);
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause;
    }
    throw new HrApiError(
      response.status,
      'HR_API_MALFORMED_RESPONSE',
      'The HR module API returned a response that could not be read.'
    );
  }
}

/**
 * A write to the module.
 *
 * The body is sent exactly as the caller built it. The module's request
 * schemas are **strict**, so a payload that carries a protected, a masked or
 * a system-maintained field is refused by the API with
 * `400 HR_PROTECTED_FIELD` — the browser cannot write around the contract.
 */
async function hrWrite<T>(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  options: HrRequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const token = readAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${ERP5_API_BASE}${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause;
    }
    throw toHrApiError(cause);
  }

  if (!response.ok) {
    throw await readHrApiError(response);
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause;
    }
    throw new HrApiError(
      response.status,
      'HR_API_MALFORMED_RESPONSE',
      'The HR module API returned a response that could not be read.'
    );
  }
}

/** `GET /api/v1/erp-hr/employees` — the masked employee projection. */
export function listEmployees(
  query: HrEmployeeListQuery,
  options?: HrRequestOptions
): Promise<HrListResponse<HrEmployeeView>> {
  return hrRequest<HrListResponse<HrEmployeeView>>(
    '/employees',
    toQueryRecord(query),
    options
  );
}

/** `GET /api/v1/erp-hr/departments` — the department hierarchy. */
export function listDepartments(
  query: HrDepartmentListQuery,
  options?: HrRequestOptions
): Promise<HrListResponse<HrDepartment>> {
  return hrRequest<HrListResponse<HrDepartment>>(
    '/departments',
    toQueryRecord(query),
    options
  );
}

/** `GET /api/v1/erp-hr/leave` — the leave records. */
export function listLeave(
  query: HrLeaveListQuery,
  options?: HrRequestOptions
): Promise<HrListResponse<HrLeave>> {
  return hrRequest<HrListResponse<HrLeave>>('/leave', toQueryRecord(query), options);
}

/** `GET /api/v1/erp-hr/payroll-totals` — the department/month aggregates. */
export function listPayrollTotals(
  query: HrPayrollTotalListQuery,
  options?: HrRequestOptions
): Promise<HrListResponse<HrPayrollTotal>> {
  return hrRequest<HrListResponse<HrPayrollTotal>>(
    '/payroll-totals',
    toQueryRecord(query),
    options
  );
}

/** `GET /api/v1/erp-hr/identity-users` — the read-only Hub projection. */
export function listIdentityUsers(
  query: HrIdentityUserListQuery,
  options?: HrRequestOptions
): Promise<HrListResponse<HrIdentityUser>> {
  return hrRequest<HrListResponse<HrIdentityUser>>(
    '/identity-users',
    toQueryRecord(query),
    options
  );
}

/** `GET /api/v1/erp-hr/employees/{id}` — one employee, masked. */
export function getEmployee(
  id: string,
  options?: HrRequestOptions
): Promise<HrEmployeeView> {
  return hrRequest<HrEmployeeView>(`/employees/${id}`, {}, options);
}

/** `GET /api/v1/erp-hr/departments/{id}` — one department. */
export function getDepartment(
  id: string,
  options?: HrRequestOptions
): Promise<HrDepartment> {
  return hrRequest<HrDepartment>(`/departments/${id}`, {}, options);
}

/** `GET /api/v1/erp-hr/leave/{id}` — one leave record. */
export function getLeave(id: string, options?: HrRequestOptions): Promise<HrLeave> {
  return hrRequest<HrLeave>(`/leave/${id}`, {}, options);
}

/** `POST /api/v1/erp-hr/employees` — create an employee. */
export function createEmployee(
  payload: CreateHrEmployeeRequest,
  options?: HrRequestOptions
): Promise<HrEmployeeView> {
  return hrWrite<HrEmployeeView>('/employees', 'POST', payload, options);
}

/** `PATCH /api/v1/erp-hr/employees/{id}` — edit an employee. */
export function updateEmployee(
  id: string,
  payload: UpdateHrEmployeeRequest,
  options?: HrRequestOptions
): Promise<HrEmployeeView> {
  return hrWrite<HrEmployeeView>(`/employees/${id}`, 'PATCH', payload, options);
}

/** `POST /api/v1/erp-hr/departments` — create a department. */
export function createDepartment(
  payload: CreateHrDepartmentRequest,
  options?: HrRequestOptions
): Promise<HrDepartment> {
  return hrWrite<HrDepartment>('/departments', 'POST', payload, options);
}

/** `PATCH /api/v1/erp-hr/departments/{id}` — edit a department. */
export function updateDepartment(
  id: string,
  payload: UpdateHrDepartmentRequest,
  options?: HrRequestOptions
): Promise<HrDepartment> {
  return hrWrite<HrDepartment>(`/departments/${id}`, 'PATCH', payload, options);
}

/** `POST /api/v1/erp-hr/leave` — create a leave record. */
export function createLeave(
  payload: CreateHrLeaveRequest,
  options?: HrRequestOptions
): Promise<HrLeave> {
  return hrWrite<HrLeave>('/leave', 'POST', payload, options);
}

/** `PATCH /api/v1/erp-hr/leave/{id}` — edit a leave record or decide it. */
export function updateLeave(
  id: string,
  payload: UpdateHrLeaveRequest,
  options?: HrRequestOptions
): Promise<HrLeave> {
  return hrWrite<HrLeave>(`/leave/${id}`, 'PATCH', payload, options);
}
