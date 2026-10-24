/**
 * ERP-3 web API client — unit tests (ERP3-29).
 * fetch is stubbed; no network, no live service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  fetchSalesOrders,
  fetchSalesOrderById,
  createSalesOrder,
  updateSalesOrderStatus,
  fetchInvoices,
  fetchInvoiceById,
  createInvoice,
  fetchPayments,
  createPayment,
} from '../src/api/erp-3.js';
import type {
  CreateSalesOrderInput,
  UpdateSalesOrderStatusInput,
  CreateInvoiceInput,
  CreatePaymentInput,
} from '@clearshift/contracts';

const BASE = '/api/v1/erp-orders';
const ID = '33333333-0003-4000-8000-000000000001';
const GOLDEN_ID = '55555555-0003-4000-8000-000000000001';

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

describe('fetchSalesOrders', () => {
  it('uses page 1 / pageSize 20 by default and omits empty search and filters', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [], total: 0 }));
    await fetchSalesOrders();
    expect(lastCall().url).toBe(`${BASE}/sales-orders?page=1&pageSize=20`);
  });

  it('includes search, status, customer_golden_id, currency, and date range filters', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [], total: 0 }));
    await fetchSalesOrders({
      page: 2,
      pageSize: 50,
      search: 'SO-1001',
      status: 'Open',
      customer_golden_id: GOLDEN_ID,
      currency: 'USD',
      from_date: '2026-01-01',
      to_date: '2026-12-31',
    });
    expect(lastCall().url).toBe(
      `${BASE}/sales-orders?page=2&pageSize=50&search=SO-1001&status=Open&customer_golden_id=${GOLDEN_ID}&currency=USD&from_date=2026-01-01&to_date=2026-12-31`
    );
  });

  it('handles response with data property and computes totalPages correctly', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ data: [{ id: ID }], total: 25, totalPages: 2 })
    );
    const result = await fetchSalesOrders({ page: 1, pageSize: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(2);
  });

  it('sends JSON content negotiation headers', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [] }));
    await fetchSalesOrders();
    expect(lastCall().init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  });
});

describe('fetchSalesOrderById and createSalesOrder', () => {
  it('fetchSalesOrderById calls GET /sales-orders/:id', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ id: ID, order_number: 'SO-001' }));
    const result = await fetchSalesOrderById(ID);
    expect(result.id).toBe(ID);
    expect(lastCall().url).toBe(`${BASE}/sales-orders/${ID}`);
    expect(lastCall().init.method).toBeUndefined();
  });

  it('createSalesOrder POSTs JSON body to /sales-orders', async () => {
    const payload: CreateSalesOrderInput = {
      customer_golden_id: GOLDEN_ID,
      order_date: '2026-10-24',
      currency: 'USD',
      lines: [
        {
          product_id: '11111111-0001-4000-8000-000000000001',
          quantity: '2.0000',
          price: '50.0000',
          tax_rate: '10.0000',
        },
      ],
    };
    fetchMock.mockImplementation(async () => jsonResponse({ id: ID, ...payload }, { status: 201 }));
    const result = await createSalesOrder(payload);
    expect(result.id).toBe(ID);
    expect(lastCall().url).toBe(`${BASE}/sales-orders`);
    expect(lastCall().init.method).toBe('POST');
    expect(JSON.parse(lastCall().init.body as string)).toEqual(payload);
  });

  it('updateSalesOrderStatus PATCHes status to /sales-orders/:id', async () => {
    const input: UpdateSalesOrderStatusInput = { status: 'Invoiced' };
    fetchMock.mockImplementation(async () => jsonResponse({ id: ID, status: 'Invoiced' }));
    const result = await updateSalesOrderStatus(ID, input);
    expect(result.status).toBe('Invoiced');
    expect(lastCall().url).toBe(`${BASE}/sales-orders/${ID}`);
    expect(lastCall().init.method).toBe('PATCH');
    expect(JSON.parse(lastCall().init.body as string)).toEqual(input);
  });
});

describe('fetchInvoices and createInvoice', () => {
  it('uses default page 1 / pageSize 20 and adds filters when provided', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [], total: 0 }));
    await fetchInvoices();
    expect(lastCall().url).toBe(`${BASE}/invoices?page=1&pageSize=20`);

    await fetchInvoices({
      page: 1,
      pageSize: 10,
      search: 'INV-2026',
      status: 'Open',
      customer_golden_id: GOLDEN_ID,
      order_id: ID,
      currency: 'EUR',
      from_date: '2026-05-01',
      to_date: '2026-05-31',
    });
    expect(lastCall().url).toBe(
      `${BASE}/invoices?page=1&pageSize=10&search=INV-2026&status=Open&customer_golden_id=${GOLDEN_ID}&order_id=${ID}&currency=EUR&from_date=2026-05-01&to_date=2026-05-31`
    );
  });

  it('fetchInvoiceById calls GET /invoices/:id', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ id: ID, invoice_number: 'INV-001' }));
    const result = await fetchInvoiceById(ID);
    expect(result.id).toBe(ID);
    expect(lastCall().url).toBe(`${BASE}/invoices/${ID}`);
  });

  it('createInvoice POSTs JSON body to /invoices', async () => {
    const payload: CreateInvoiceInput = {
      order_id: ID,
      customer_golden_id: GOLDEN_ID,
      invoice_date: '2026-10-24',
      due_date: '2026-11-24',
      currency: 'USD',
      lines: [
        {
          order_line_id: '22222222-0002-4000-8000-000000000001',
          product_id: '11111111-0001-4000-8000-000000000001',
          quantity: '1.0000',
          price: '100.0000',
          tax_rate: '10.0000',
        },
      ],
    };
    fetchMock.mockImplementation(async () => jsonResponse({ id: ID, ...payload }, { status: 201 }));
    const result = await createInvoice(payload);
    expect(result.id).toBe(ID);
    expect(lastCall().url).toBe(`${BASE}/invoices`);
    expect(lastCall().init.method).toBe('POST');
    expect(JSON.parse(lastCall().init.body as string)).toEqual(payload);
  });
});

describe('fetchPayments and createPayment', () => {
  it('fetchPayments queries /payments with optional invoice_id and method filters', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [], total: 0 }));
    await fetchPayments();
    expect(lastCall().url).toBe(`${BASE}/payments?page=1&pageSize=20`);

    await fetchPayments({ page: 2, pageSize: 15, invoice_id: ID, method: 'bank_transfer' });
    expect(lastCall().url).toBe(`${BASE}/payments?page=2&pageSize=15&invoice_id=${ID}&method=bank_transfer`);
  });

  it('createPayment POSTs JSON body to /payments', async () => {
    const payload: CreatePaymentInput = {
      invoice_id: ID,
      payment_date: '2026-10-24',
      amount: '110.00',
      currency: 'USD',
      method: 'bank_transfer',
      reference: 'TXN-987654',
    };
    fetchMock.mockImplementation(async () => jsonResponse({ id: ID, ...payload }, { status: 201 }));
    const result = await createPayment(payload);
    expect(result.id).toBe(ID);
    expect(lastCall().url).toBe(`${BASE}/payments`);
    expect(lastCall().init.method).toBe('POST');
    expect(JSON.parse(lastCall().init.body as string)).toEqual(payload);
  });
});

describe('ApiError mapping', () => {
  it('maps standard error envelope to ApiError instance', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid customer Golden ID',
          details: [{ field: 'customer_golden_id' }],
        },
        { status: 400 }
      )
    );
    const err = await fetchSalesOrders().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.code).toBe('VALIDATION_ERROR');
    expect(apiErr.message).toBe('Invalid customer Golden ID');
    expect(apiErr.details).toEqual([{ field: 'customer_golden_id' }]);
    expect(apiErr.name).toBe('ApiError');
  });

  it('defaults a non-JSON 401/403 to API_REQUEST_FAILED with HTTP statusText', async () => {
    fetchMock.mockImplementation(async () =>
      new Response('Access Denied', { status: 403, statusText: 'Forbidden' })
    );
    const err = (await fetchSalesOrders().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('API_REQUEST_FAILED');
    expect(err.message).toBe('HTTP 403 Forbidden');
    expect(err.details).toBeNull();
  });

  it('handles JSON response without code and falls back to API_REQUEST_FAILED', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ message: 'Resource not found' }, { status: 404 })
    );
    const err = (await fetchSalesOrderById(ID).catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(404);
    expect(err.code).toBe('API_REQUEST_FAILED');
    expect(err.message).toBe('Resource not found');
  });

  it('ApiError constructor defaults details to null when omitted', () => {
    const error = new ApiError(409, 'CONFLICT', 'Duplicate record');
    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Duplicate record');
    expect(error.details).toBeNull();
  });
});
