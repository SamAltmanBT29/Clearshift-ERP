import type {
  Account,
  AccountsFilterQuery,
  PaginatedAccountsResponse,
  CreateAccountInput,
  JournalEntry,
  JournalEntriesFilterQuery,
  PaginatedJournalEntriesResponse,
  CreateJournalEntryInput,
  TrialBalanceResponse,
  CreateOpeningBalancesInput,
  OpeningBalancesResponse,
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

/**
 * Fetch bounded paginated Chart of Accounts with filters.
 */
export async function fetchAccounts(
  query: AccountsFilterQuery = { page: 1, limit: 20 }
): Promise<PaginatedAccountsResponse> {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  if (query.search) params.set('search', query.search);
  if (query.type) params.set('type', query.type);
  if (typeof query.isActive === 'boolean') params.set('isActive', String(query.isActive));
  if (query.currencyCode) params.set('currencyCode', query.currencyCode);

  const qs = params.toString();
  return request<PaginatedAccountsResponse>(`/accounts${qs ? `?${qs}` : ''}`);
}

/**
 * Create a new account in Chart of Accounts (Admin / Editor only).
 */
export async function createAccount(data: CreateAccountInput): Promise<Account> {
  return request<Account>('/accounts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Fetch Trial Balance report for a specified period and currency.
 */
export async function fetchTrialBalance(
  period: string,
  currencyCode = 'USD'
): Promise<TrialBalanceResponse> {
  const params = new URLSearchParams({ period, currencyCode });
  return request<TrialBalanceResponse>(`/trial-balance?${params.toString()}`);
}

/**
 * Fetch bounded paginated Journal Entries.
 */
export async function fetchJournalEntries(
  query: JournalEntriesFilterQuery = { page: 1, limit: 20 }
): Promise<PaginatedJournalEntriesResponse> {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  if (query.period) params.set('period', query.period);
  if (query.status) params.set('status', query.status);
  if (query.search) params.set('search', query.search);
  if (query.currencyCode) params.set('currencyCode', query.currencyCode);

  const qs = params.toString();
  return request<PaginatedJournalEntriesResponse>(`/journal-entries${qs ? `?${qs}` : ''}`);
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
export async function createJournalEntry(
  data: CreateJournalEntryInput
): Promise<JournalEntry> {
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
export async function createOpeningBalances(
  data: CreateOpeningBalancesInput
): Promise<OpeningBalancesResponse> {
  return request<OpeningBalancesResponse>('/opening-balances', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
