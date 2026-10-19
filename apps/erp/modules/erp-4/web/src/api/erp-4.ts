import type {
  Account,
  AccountListQuery,
  CreateAccountRequest,
  JournalEntry,
  TrialBalanceResponse,
  CreateOpeningBalancesRequest,
} from '@clearshift/contracts';

const API_BASE = '/api/v1/erp-finance';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown = null
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorData: any = {};
    try {
      errorData = await response.json();
    } catch {
      // ignore json parse error
    }
    throw new ApiError(
      response.status,
      errorData?.code || 'API_REQUEST_FAILED',
      errorData?.message || `HTTP ${response.status} ${response.statusText}`,
      errorData?.details
    );
  }

  return response.json();
}

export interface NormalizedAccountsResponse {
  items: Account[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Fetch bounded paginated Chart of Accounts with filters.
 * Normalizes between backend `data`/`pageSize` and frontend `items`/`limit`.
 */
export async function fetchAccounts(
  query: any = { page: 1, limit: 20 }
): Promise<NormalizedAccountsResponse> {
  const params = new URLSearchParams();
  const page = query.page || 1;
  const pageSize = query.pageSize || query.limit || 20;

  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  if (query.search) params.set('search', query.search);
  if (query.type) params.set('type', query.type);
  if (typeof query.isActive === 'boolean') params.set('is_active', String(query.isActive));
  if (typeof query.is_active === 'boolean') params.set('is_active', String(query.is_active));
  if (query.currencyCode) params.set('currency_code', query.currencyCode);
  if (query.currency_code) params.set('currency_code', query.currency_code);

  const qs = params.toString();
  const res = await request<any>(`/accounts${qs ? `?${qs}` : ''}`);

  return {
    items: res.data || res.items || [],
    total: res.total ?? 0,
    page: res.page ?? page,
    limit: res.pageSize || res.limit || pageSize,
    totalPages: res.totalPages ?? 1,
  };
}

/**
 * Create a new account in Chart of Accounts (Admin / Editor only).
 */
export async function createAccount(data: any): Promise<Account> {
  return request<Account>('/accounts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export interface NormalizedTrialBalanceResponse {
  period: string;
  currencyCode: string;
  items: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    accountType: string;
    currencyCode: string;
    debit: number;
    credit: number;
    netBalance: number;
  }>;
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  accountCount: number;
  generatedAt: Date;
}

/**
 * Fetch Trial Balance report for a specified period and currency.
 * Normalizes backend `rows` and `totals` into frontend display model.
 */
export async function fetchTrialBalance(
  period: string,
  currencyCode = 'USD'
): Promise<NormalizedTrialBalanceResponse> {
  const params = new URLSearchParams({ period, currency_code: currencyCode });
  const res = await request<any>(`/trial-balance?${params.toString()}`);

  const rawRows = res.rows || res.items || [];
  const items = rawRows.map((r: any) => ({
    accountId: r.account_id || r.accountId || '',
    accountCode: r.account_code || r.accountCode || '',
    accountName: r.account_name || r.accountName || '',
    accountType: r.account_type || r.accountType || 'asset',
    currencyCode: r.currency_code || r.currencyCode || currencyCode,
    debit: Number(r.total_debit ?? r.debit ?? 0),
    credit: Number(r.total_credit ?? r.credit ?? 0),
    netBalance: Number(r.net_balance ?? r.netBalance ?? 0),
  }));

  const totalDebit = Number(res.totals?.total_debit ?? res.totalDebit ?? 0);
  const totalCredit = Number(res.totals?.total_credit ?? res.totalCredit ?? 0);
  const isBalanced = res.totals?.is_balanced ?? res.isBalanced ?? (totalDebit === totalCredit);

  return {
    period: res.period || period,
    currencyCode,
    items,
    totalDebit,
    totalCredit,
    isBalanced,
    accountCount: items.length,
    generatedAt: res.generated_at ? new Date(res.generated_at) : new Date(),
  };
}

/**
 * Fetch bounded paginated Journal Entries.
 */
export async function fetchJournalEntries(
  query: any = { page: 1, limit: 20 }
): Promise<any> {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.limit || query.pageSize) params.set('pageSize', String(query.limit || query.pageSize));
  if (query.period) params.set('period', query.period);
  if (query.status) params.set('status', query.status);
  if (query.search) params.set('search', query.search);

  const qs = params.toString();
  return request<any>(`/journal-entries${qs ? `?${qs}` : ''}`);
}

/**
 * Get Journal Entry details by ID.
 */
export async function fetchJournalEntryById(id: string): Promise<JournalEntry> {
  return request<JournalEntry>(`/journal-entries/${id}`);
}

/**
 * Create draft journal entry with balanced lines.
 */
export async function createJournalEntry(data: any): Promise<JournalEntry> {
  return request<JournalEntry>('/journal-entries', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Post journal entry (locks entry permanently).
 */
export async function postJournalEntry(id: string): Promise<JournalEntry> {
  return request<JournalEntry>(`/journal-entries/${id}/post`, {
    method: 'POST',
  });
}

/**
 * Reverse posted journal entry.
 */
export async function reverseJournalEntry(id: string): Promise<JournalEntry> {
  return request<JournalEntry>(`/journal-entries/${id}/reverse`, {
    method: 'POST',
  });
}

/**
 * Load one-time opening balances.
 */
export async function createOpeningBalances(data: any): Promise<any> {
  return request<any>('/opening-balances', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
