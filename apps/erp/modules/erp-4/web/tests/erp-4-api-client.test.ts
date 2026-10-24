/**
 * ERP-4 web API client — unit tests (ERP4-29).
 * fetch is stubbed; no network, no live service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  fetchAccounts,
  createAccount,
  fetchJournalEntries,
  fetchJournalEntryById,
  createJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  fetchTrialBalance,
  fetchOpeningBalances,
  createOpeningBalances,
} from '../src/api/erp-4.js';

const BASE = '/api/v1/erp-finance';
const ID = '44444444-4444-4000-8000-000000000001';

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

describe('ERP-4 web API client — fetchAccounts', () => {
  it('uses page 1 / limit 20 by default and sends headers', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })
    );
    const res = await fetchAccounts();
    expect(lastCall().url).toBe(`${BASE}/accounts?page=1&limit=20`);
    expect(lastCall().init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
  });

  it('normalizes search, type, and isActive filters into query string', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ items: [], total: 0, page: 2, limit: 10, totalPages: 0 })
    );
    await fetchAccounts({
      page: 2,
      limit: 10,
      search: 'Operating',
      type: 'asset',
      isActive: true,
      currencyCode: 'USD',
    });
    expect(lastCall().url).toBe(
      `${BASE}/accounts?page=2&limit=10&search=Operating&type=asset&isActive=true&currencyCode=USD`
    );
  });

  it('handles pageSize and currency_code aliases', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ data: [], total: 0 })
    );
    await fetchAccounts({
      page: 1,
      pageSize: 50,
      currency_code: 'EUR',
      is_active: false,
    } as any);
    expect(lastCall().url).toBe(
      `${BASE}/accounts?page=1&pageSize=50&is_active=false&currency_code=EUR`
    );
  });
});

describe('ERP-4 web API client — createAccount', () => {
  it('posts input data to /accounts and returns created account', async () => {
    const input = {
      code: '1050',
      name: 'Petty Cash',
      type: 'asset' as const,
      currency_code: 'USD',
      is_posting_account: true,
    };
    fetchMock.mockImplementation(async () =>
      jsonResponse({ id: ID, ...input }, { status: 201 })
    );
    const result = await createAccount(input);
    expect(lastCall().url).toBe(`${BASE}/accounts`);
    expect(lastCall().init.method).toBe('POST');
    expect(JSON.parse(lastCall().init.body as string)).toEqual(input);
    expect(result.id).toBe(ID);
  });
});

describe('ERP-4 web API client — journal entries', () => {
  it('fetchJournalEntries handles periodId, status and pagination', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })
    );
    await fetchJournalEntries({
      page: 2,
      pageSize: 25,
      periodId: '2026-04',
      status: 'posted',
    });
    expect(lastCall().url).toBe(
      `${BASE}/journal-entries?page=2&pageSize=25&periodId=2026-04&status=posted`
    );
  });

  it('fetchJournalEntryById queries single entry by id', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ id: ID }));
    const entry = await fetchJournalEntryById(ID);
    expect(lastCall().url).toBe(`${BASE}/journal-entries/${ID}`);
    expect(entry.id).toBe(ID);
  });

  it('createJournalEntry sends POST with lines and header', async () => {
    const payload = {
      posting_date: '2026-04-15',
      period_id: '2026-04',
      currency_code: 'USD',
      description: 'Vendor payment',
      lines: [
        { account_id: ID, debit: 100, credit: 0 },
        { account_id: '44444444-4444-4000-8000-000000000002', debit: 0, credit: 100 },
      ],
    };
    fetchMock.mockImplementation(async () =>
      jsonResponse({ id: ID, status: 'draft', ...payload }, { status: 201 })
    );
    const res = await createJournalEntry(payload);
    expect(lastCall().url).toBe(`${BASE}/journal-entries`);
    expect(lastCall().init.method).toBe('POST');
    expect(res.id).toBe(ID);
  });

  it('postJournalEntry sends POST to /post route', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ id: ID, status: 'posted' })
    );
    const res = await postJournalEntry(ID);
    expect(lastCall().url).toBe(`${BASE}/journal-entries/${ID}/post`);
    expect(lastCall().init.method).toBe('POST');
    expect(res.status).toBe('posted');
  });

  it('reverseJournalEntry sends POST to /reverse route', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ id: ID, status: 'reversed' })
    );
    const res = await reverseJournalEntry(ID, 'Correction');
    expect(lastCall().url).toBe(`${BASE}/journal-entries/${ID}/reverse`);
    expect(lastCall().init.method).toBe('POST');
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ reason: 'Correction' });
    expect(res.status).toBe('reversed');
  });
});

describe('ERP-4 web API client — trial balance and opening balances', () => {
  it('fetchTrialBalance includes period and currencyCode', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        period: '2026-04',
        currencyCode: 'USD',
        items: [],
        totalDebit: 0,
        totalCredit: 0,
        isBalanced: true,
        accountCount: 0,
        generatedAt: '2026-04-15T00:00:00.000Z',
      })
    );
    const tb = await fetchTrialBalance('2026-04', 'USD');
    expect(lastCall().url).toBe(`${BASE}/trial-balance?period=2026-04&currencyCode=USD`);
    expect(tb.isBalanced).toBe(true);
  });

  it('fetchOpeningBalances handles periodId filter', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ items: [], total: 0, periodId: '2026-01' })
    );
    await fetchOpeningBalances('2026-01');
    expect(lastCall().url).toBe(`${BASE}/opening-balances?periodId=2026-01`);
  });

  it('createOpeningBalances sends batch opening balances', async () => {
    const payload = {
      period_id: '2026-01',
      entries: [{ account_id: ID, balance: 5000 }],
    };
    fetchMock.mockImplementation(async () =>
      jsonResponse({ period_id: '2026-01', entries: [], is_balanced: true })
    );
    await createOpeningBalances(payload);
    expect(lastCall().url).toBe(`${BASE}/opening-balances`);
    expect(lastCall().init.method).toBe('POST');
  });
});

describe('ERP-4 web API client — error handling', () => {
  it('maps structured 400 error to ApiError with details', async () => {
    fetchMock.mockImplementation(async () =>
      new Response(
        JSON.stringify({
          code: 'JOURNAL_UNBALANCED',
          message: 'Debits must equal credits at currency precision',
          details: [{ field: 'lines', message: 'Difference is 10.00' }],
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await expect(fetchJournalEntryById(ID)).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'JOURNAL_UNBALANCED',
      message: 'Debits must equal credits at currency precision',
      details: [{ field: 'lines', message: 'Difference is 10.00' }],
    });
  });

  it('handles non-JSON error payloads gracefully', async () => {
    fetchMock.mockImplementation(async () =>
      new Response('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' })
    );
    await expect(fetchAccounts()).rejects.toMatchObject({
      name: 'ApiError',
      status: 504,
      code: 'API_REQUEST_FAILED',
      message: 'HTTP 504 Gateway Timeout',
    });
  });
});
