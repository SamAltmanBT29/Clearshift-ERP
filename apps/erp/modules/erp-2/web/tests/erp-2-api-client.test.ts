/**
 * ERP-2 web API client — unit tests (ERP2-29).
 * fetch is stubbed; no network, no live service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createPurchaseOrder,
  createVendor,
  fetchPurchaseOrderById,
  fetchPurchaseOrders,
  fetchVendorById,
  fetchVendors,
  updatePurchaseOrderStatus,
  updateVendor,
} from '../src/api/erp-2.js';

const BASE = '/api/v1/erp-vendors';
const ID = '5eed0000-0000-4000-8000-0000000000a1';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

describe('fetchVendors', () => {
  it('uses page 1 / pageSize 20 by default and omits search', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [], total: 0 }));
    await fetchVendors();
    expect(lastCall().url).toBe(`${BASE}/vendors?page=1&pageSize=20`);
  });

  it('sends trimmed search and ignores whitespace-only search', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [] }));
    await fetchVendors({ page: 2, pageSize: 50, search: '  acme  ' });
    expect(lastCall().url).toBe(`${BASE}/vendors?page=2&pageSize=50&search=acme`);
    await fetchVendors({ page: 1, pageSize: 20, search: '   ' });
    expect(lastCall().url).toBe(`${BASE}/vendors?page=1&pageSize=20`);
  });

  it('falls back to page 1 when page is falsy and keeps an explicit pageSize', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [] }));
    await fetchVendors({ page: 0, pageSize: 10 } as never);
    expect(lastCall().url).toBe(`${BASE}/vendors?page=1&pageSize=10`);
  });

  it('sends JSON content negotiation headers', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [] }));
    await fetchVendors();
    expect(lastCall().init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  });
});

describe('fetchPurchaseOrders', () => {
  it('adds vendor_id and status filters only when present', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [] }));
    await fetchPurchaseOrders({ page: 1, pageSize: 20 });
    expect(lastCall().url).toBe(`${BASE}/purchase-orders?page=1&pageSize=20`);
    await fetchPurchaseOrders({ page: 3, pageSize: 20, vendor_id: ID, status: 'Sent' } as never);
    expect(lastCall().url).toBe(
      `${BASE}/purchase-orders?page=3&pageSize=20&vendor_id=${ID}&status=Sent`,
    );
  });

  it('uses defaults when called without a query', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [] }));
    await fetchPurchaseOrders();
    expect(lastCall().url).toBe(`${BASE}/purchase-orders?page=1&pageSize=20`);
  });
});

describe('single-record reads', () => {
  it('fetchVendorById and fetchPurchaseOrderById hit the id paths', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ id: ID }));
    await expect(fetchVendorById(ID)).resolves.toEqual({ id: ID });
    expect(lastCall().url).toBe(`${BASE}/vendors/${ID}`);
    await expect(fetchPurchaseOrderById(ID)).resolves.toEqual({ id: ID });
    expect(lastCall().url).toBe(`${BASE}/purchase-orders/${ID}`);
  });
});

describe('writes', () => {
  it('createVendor POSTs the JSON body', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ id: ID }, { status: 201 }));
    const body = { name: 'Acme', tax_number: 'TX-1', email: 'ap@example.com' };
    await createVendor(body as never);
    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/vendors`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('updateVendor PATCHes the id path', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ id: ID }));
    await updateVendor(ID, { city: 'Zurich' } as never);
    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/vendors/${ID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ city: 'Zurich' });
  });

  it('createPurchaseOrder POSTs and updatePurchaseOrderStatus PATCHes', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ id: ID }));
    await createPurchaseOrder({ vendor_id: ID, lines: [] } as never);
    expect(lastCall().url).toBe(`${BASE}/purchase-orders`);
    expect(lastCall().init.method).toBe('POST');
    await updatePurchaseOrderStatus(ID, { status: 'Sent' } as never);
    expect(lastCall().url).toBe(`${BASE}/purchase-orders/${ID}`);
    expect(lastCall().init.method).toBe('PATCH');
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ status: 'Sent' });
  });
});

describe('error mapping', () => {
  it('maps the standard error envelope to ApiError', async () => {
    fetchMock.mockImplementation(async () => 
      jsonResponse(
        { code: 'VALIDATION_ERROR', message: 'Bad name', details: [{ field: 'name' }] },
        { status: 400 },
      ),
    );
    const err = await fetchVendors().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.code).toBe('VALIDATION_ERROR');
    expect(apiErr.message).toBe('Bad name');
    expect(apiErr.details).toEqual([{ field: 'name' }]);
    expect(apiErr.name).toBe('ApiError');
  });

  it('defaults a non-JSON 403 to FORBIDDEN with an HTTP message', async () => {
    fetchMock.mockImplementation(async () => new Response('nope', { status: 403, statusText: 'Forbidden' }));
    const apiErr = (await fetchVendors().catch((e: unknown) => e)) as ApiError;
    expect(apiErr.status).toBe(403);
    expect(apiErr.code).toBe('FORBIDDEN');
    expect(apiErr.message).toBe('HTTP 403 Forbidden');
  });

  it('defaults a non-JSON 500 to API_REQUEST_FAILED', async () => {
    fetchMock.mockImplementation(async () => new Response('boom', { status: 500, statusText: 'Server Error' }));
    const apiErr = (await fetchPurchaseOrders().catch((e: unknown) => e)) as ApiError;
    expect(apiErr.code).toBe('API_REQUEST_FAILED');
    expect(apiErr.message).toBe('HTTP 500 Server Error');
  });

  it('defaults the code for a JSON error body without one', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ message: 'Not here' }, { status: 404 }));
    const apiErr = (await fetchVendorById(ID).catch((e: unknown) => e)) as ApiError;
    expect(apiErr.code).toBe('API_REQUEST_FAILED');
    expect(apiErr.message).toBe('Not here');
  });

  it('ApiError details default to null', () => {
    expect(new ApiError(409, 'CONFLICT', 'dup').details).toBeNull();
  });
});
