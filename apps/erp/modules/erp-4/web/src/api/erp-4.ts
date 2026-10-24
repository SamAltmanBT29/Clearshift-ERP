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

  return (await response.json()) as T;
}

export interface NormalizedAccountsResponse {
  items: Account[];
  data: Account[];
  total: number;
  page: number;
  limit: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Fetch bounded paginated Chart of Accounts with filters.
 * Normalizes between backend `data`/`pageSize` and frontend `items`/`limit`.
 */
export async function fetchAccounts(
  query: AccountsFilterQuery = { page: 1, limit: 20 }
): Promise<NormalizedAccountsResponse> {
  const params = new URLSearchParams();
  const page = query.page || 1;
  const limit = query.limit !== undefined ? query.limit : (query.pageSize !== undefined ? query.pageSize : 20);

  params.set('page', String(page));
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  } else {
    params.set('pageSize', String(limit));
  }
  if (query.search) params.set('search', query.search);
  if (query.type) params.set('type', query.type);
  if (typeof query.isActive === 'boolean') {
    params.set('isActive', String(query.isActive));
  } else if (typeof query.is_active === 'boolean') {
    params.set('is_active', String(query.is_active));
  }
  if (query.currencyCode) {
    params.set('currencyCode', query.currencyCode);
  } else if (query.currency_code) {
    params.set('currency_code', query.currency_code);
  }

  const qs = params.toString();
  const res = await request<any>(`/accounts${qs ? `?${qs}` : ''}`);

  const rawItems = res.items || res.data || [];
  const items = rawItems.map((item: any) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    type: item.type,
    currencyCode: item.currencyCode || item.currency_code || 'INR',
    currency_code: item.currency_code || item.currencyCode || 'INR',
    parentId: item.parentId || item.parent_id || null,
    parent_id: item.parent_id || item.parentId || null,
    description: item.description || null,
    isActive: item.isActive !== undefined ? Boolean(item.isActive) : (item.is_active !== undefined ? Boolean(item.is_active) : true),
    is_active: item.is_active !== undefined ? Boolean(item.is_active) : (item.isActive !== undefined ? Boolean(item.isActive) : true),
    isPostingAccount: item.isPostingAccount !== undefined ? Boolean(item.isPostingAccount) : (item.is_posting_account !== undefined ? Boolean(item.is_posting_account) : true),
    is_posting_account: item.is_posting_account !== undefined ? Boolean(item.is_posting_account) : (item.isPostingAccount !== undefined ? Boolean(item.isPostingAccount) : true),
    balance: Number(item.balance ?? 0),
    createdAt: item.createdAt || item.created_at || new Date().toISOString(),
    created_at: item.created_at || item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.updated_at || new Date().toISOString(),
    updated_at: item.updated_at || item.updatedAt || new Date().toISOString(),
  }));

  const total = Number(res.total ?? items.length);
  const totalPages = Number(res.totalPages ?? (Math.ceil(total / limit) || 1));

  return {
    items,
    data: items,
    total,
    page: Number(res.page ?? page),
    limit,
    pageSize: limit,
    totalPages,
  };
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
  rows?: any[];
  totals?: any;
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
  const params = new URLSearchParams({ period, currencyCode });
  const res = await request<any>(`/trial-balance?${params.toString()}`);

  const rawRows = res.rows || res.items || [];
  const items = rawRows.map((r: any) => ({
    accountId: r.accountId || r.account_id || '',
    accountCode: r.accountCode || r.account_code || '',
    accountName: r.accountName || r.account_name || '',
    accountType: r.accountType || r.account_type || 'asset',
    currencyCode: r.currencyCode || r.currency_code || currencyCode,
    debit: Number(r.debit ?? r.total_debit ?? 0),
    credit: Number(r.credit ?? r.total_credit ?? 0),
    netBalance: Number(r.netBalance ?? r.net_balance ?? 0),
  }));

  const totalDebit = Number(res.totalDebit ?? res.totals?.total_debit ?? 0);
  const totalCredit = Number(res.totalCredit ?? res.totals?.total_credit ?? 0);
  const isBalanced = res.isBalanced ?? res.totals?.is_balanced ?? (totalDebit === totalCredit);

  return {
    period: res.period || period,
    currencyCode,
    items,
    rows: rawRows,
    totals: res.totals,
    totalDebit,
    totalCredit,
    isBalanced,
    accountCount: items.length,
    generatedAt: res.generatedAt ? new Date(res.generatedAt) : (res.generated_at ? new Date(res.generated_at) : new Date()),
  };
}

/**
 * Fetch bounded paginated Journal Entries.
 */
export async function fetchJournalEntries(
  query: JournalEntriesFilterQuery = { page: 1, limit: 20 }
): Promise<PaginatedJournalEntriesResponse> {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.limit || query.pageSize) params.set('limit', String(query.limit || query.pageSize));
  if (query.period) params.set('period', query.period);
  if (query.status) params.set('status', query.status);
  if (query.search) params.set('search', query.search);
  if (query.currencyCode) params.set('currencyCode', query.currencyCode);

  const qs = params.toString();
  const res = await request<any>(`/journal-entries${qs ? `?${qs}` : ''}`);

  return {
    items: res.items || res.data || [],
    total: res.total ?? 0,
    page: res.page ?? query.page ?? 1,
    limit: res.limit || res.pageSize || query.limit || query.pageSize || 20,
    totalPages: res.totalPages ?? 1,
  };
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

export interface DataHealthProfileResponse {
  success: boolean;
  data: any;
}

/**
 * Retrieve column profiling and data health report.
 */
export async function fetchDataHealthProfile(): Promise<any> {
  const res = await request<DataHealthProfileResponse>('/migration/profile');
  return res.data;
}

/**
 * Download formula-safe CSV data health export.
 */
export async function downloadDataHealthCsv(): Promise<string> {
  const url = `${API_BASE}/migration/profile/export`;
  const response = await fetch(url, {
    headers: {
      Accept: 'text/csv',
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'CSV_DOWNLOAD_FAILED', 'Failed to download data health CSV');
  }
  return await response.text();
}

export interface CleanDatasetResponse {
  success: boolean;
  data: any;
}

/**
 * Retrieve cleaned dataset and field-level change audit report.
 */
export async function fetchCleanedData(): Promise<any> {
  const res = await request<CleanDatasetResponse>('/migration/clean');
  return res.data;
}

/**
 * Download formula-safe CSV field-level change audit log.
 */
export async function downloadCleanAuditCsv(): Promise<string> {
  const url = `${API_BASE}/migration/clean/audit/export`;
  const response = await fetch(url, {
    headers: {
      Accept: 'text/csv',
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'CSV_DOWNLOAD_FAILED', 'Failed to download field clean audit CSV');
  }
  return await response.text();
}

export interface MappingTemplatesResponse {
  success: boolean;
  data: any[];
}

/**
 * Fetch available named mapping templates.
 */
export async function fetchMappingTemplates(): Promise<any[]> {
  const res = await request<MappingTemplatesResponse>('/migration/mapping/templates');
  return res.data;
}

/**
 * Fetch a specific named mapping template by ID.
 */
export async function fetchMappingTemplate(templateId: string): Promise<any> {
  const res = await request<{ success: boolean; data: any }>(`/migration/mapping/templates/${templateId}`);
  return res.data;
}

/**
 * Validate a field mapping configuration against an entity schema.
 */
export async function validateMappingConfig(
  entity: string,
  mapping: Record<string, string>,
  sourceTypes?: Record<string, string>
): Promise<any> {
  const res = await request<{ success: boolean; data: any }>('/migration/mapping/validate', {
    method: 'POST',
    body: JSON.stringify({ entity, mapping, sourceTypes }),
  });
  return res.data;
}

/**
 * Transform dataset rows using field mapping and value translations.
 */
export async function transformDatasetRows(
  entity: string,
  mapping: Record<string, string>,
  rows: Record<string, unknown>[]
): Promise<any> {
  const res = await request<{ success: boolean; data: any }>('/migration/mapping/transform', {
    method: 'POST',
    body: JSON.stringify({ entity, mapping, rows }),
  });
  return res.data;
}
