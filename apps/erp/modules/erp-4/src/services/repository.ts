/**
 * ERP-4 Finance & Accounting — Repository Layer
 *
 * Provides a clean interface and implementations:
 *   - FinanceRepository: contract for finance data access
 *   - InMemoryFinanceRepository: deterministic, fixture-seeded in-memory store for tests and offline execution
 *   - DrizzleFinanceRepository: production PostgreSQL storage using Drizzle ORM
 *
 * Invariants enforced:
 *   - Stable deterministic sort order
 *   - Exact bounded paging
 *   - Fully parameterized filters
 *   - Isolation of sensitive internal fields
 *
 * @module erp4/services/repository
 */

import { randomUUID } from 'node:crypto';
import type {
  Account,
  CreateAccountRequest,
  AccountListQuery,
  JournalEntry,
  JournalLine,
  CreateJournalEntryRequest,
  JournalEntryListQuery,
  OpeningBalance,
  OpeningBalanceListQuery,
  AccountingPeriod,
  PeriodListQuery,
  ImportReceipt,
} from '@clearshift/contracts';
import {
  FIXTURE_ACCOUNT_CASH,
  FIXTURE_ACCOUNT_BANK,
  FIXTURE_ACCOUNT_ACCOUNTS_PAYABLE,
  FIXTURE_ACCOUNT_SALES_REVENUE,
  FIXTURE_ACCOUNT_SALARY_EXPENSE,
  FIXTURE_PERIOD_OPEN,
  FIXTURE_PERIOD_SOFT_CLOSED,
  FIXTURE_PERIOD_LOCKED,
  FIXTURE_JOURNAL_ENTRY_DRAFT,
  FIXTURE_OPENING_BALANCE_BANK,
} from '../../fixtures/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Repository Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface FinanceRepository {
  // Accounts
  listAccounts(query: AccountListQuery): Promise<{ accounts: Account[]; total: number }>;
  getAccountById(id: string): Promise<Account | null>;
  getAccountByCode(code: string): Promise<Account | null>;
  createAccount(data: CreateAccountRequest & { id?: string }): Promise<Account>;
  updateAccount(id: string, updates: Partial<Account>): Promise<Account>;

  // Accounting Periods
  listPeriods(query: PeriodListQuery): Promise<{ periods: AccountingPeriod[]; total: number }>;
  getPeriodById(id: string): Promise<AccountingPeriod | null>;
  getPeriodByLabel(label: string): Promise<AccountingPeriod | null>;
  createPeriod(data: Omit<AccountingPeriod, 'created_at' | 'updated_at'> & { created_at?: string; updated_at?: string }): Promise<AccountingPeriod>;
  updatePeriod(id: string, updates: Partial<AccountingPeriod>): Promise<AccountingPeriod>;

  // Journal Entries
  listJournalEntries(query: JournalEntryListQuery): Promise<{ entries: JournalEntry[]; total: number }>;
  getJournalEntryById(id: string): Promise<JournalEntry | null>;
  getJournalEntryByIdempotencyKey(key: string): Promise<JournalEntry | null>;
  createJournalEntry(
    data: CreateJournalEntryRequest & { id?: string; entry_number: string; created_by_user_id: string }
  ): Promise<JournalEntry>;
  updateJournalEntry(id: string, updates: Partial<JournalEntry>): Promise<JournalEntry>;
  updateJournalEntryStatus(
    id: string,
    updates: {
      status: JournalEntry['status'];
      posted_at?: string | null;
      posted_by_user_id?: string | null;
      reversed_by_entry_id?: string | null;
    }
  ): Promise<JournalEntry>;

  // Opening Balances
  listOpeningBalances(query: OpeningBalanceListQuery): Promise<{ balances: OpeningBalance[]; total: number }>;
  getOpeningBalanceById(id: string): Promise<OpeningBalance | null>;
  getOpeningBalance(accountId: string, currencyCode: string): Promise<OpeningBalance | null>;
  createOpeningBalance(item: {
    id?: string;
    account_id: string;
    currency_code: string;
    balance_amount: string;
    as_of_date: string;
    source_reference?: string | null;
    loaded_by_user_id: string;
  }): Promise<OpeningBalance>;

  // Import Receipts
  getImportReceiptByIdempotencyKey(key: string): Promise<ImportReceipt | null>;
  createImportReceipt(receipt: {
    id?: string;
    batch_id: string;
    source_row: number;
    entity: string;
    schema_version?: number;
    idempotency_key: string;
    target_id: string;
    kind?: 'created' | 'linked';
    created_at?: string;
  }): Promise<ImportReceipt>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Implementation (with Synthetic Fixtures)
// ─────────────────────────────────────────────────────────────────────────────

export class InMemoryFinanceRepository implements FinanceRepository {
  private accounts: Map<string, Account> = new Map();
  private periods: Map<string, AccountingPeriod> = new Map();
  private journalEntries: Map<string, JournalEntry> = new Map();
  private openingBalances: Map<string, OpeningBalance> = new Map();
  private importReceipts: Map<string, ImportReceipt> = new Map();

  constructor(seedWithFixtures: boolean = true) {
    if (seedWithFixtures) {
      this.seedFixtures();
    }
  }

  public seedFixtures(): void {
    const now = '2026-04-15T12:00:00.000Z';

    // 1. Accounts
    const defaultAccounts = [
      FIXTURE_ACCOUNT_CASH,
      FIXTURE_ACCOUNT_BANK,
      FIXTURE_ACCOUNT_ACCOUNTS_PAYABLE,
      FIXTURE_ACCOUNT_SALES_REVENUE,
      FIXTURE_ACCOUNT_SALARY_EXPENSE,
    ];

    for (const raw of defaultAccounts) {
      const acct: Account = {
        id: String(raw['id']),
        code: String(raw['code']),
        name: String(raw['name']),
        type: raw['type'] as Account['type'],
        currency_code: String(raw['currency_code']),
        parent_id: (raw['parent_id'] as string | null) ?? null,
        description: (raw['description'] as string | null) ?? null,
        is_active: Boolean(raw['is_active']),
        is_posting_account: Boolean(raw['is_posting_account']),
        created_at: (raw['created_at'] as string) ?? now,
        updated_at: (raw['updated_at'] as string) ?? now,
      };
      this.accounts.set(acct.id, acct);
    }

    // 2. Periods
    const defaultPeriods = [
      FIXTURE_PERIOD_OPEN,
      FIXTURE_PERIOD_SOFT_CLOSED,
      FIXTURE_PERIOD_LOCKED,
    ];

    for (const raw of defaultPeriods) {
      const period: AccountingPeriod = {
        id: String(raw['id']),
        period_label: String(raw['period_label']),
        start_date: String(raw['start_date']),
        end_date: String(raw['end_date']),
        status: raw['status'] as AccountingPeriod['status'],
        fiscal_year: String(raw['fiscal_year']),
        closed_at: (raw['closed_at'] as string | null) ?? null,
        closed_by_user_id: (raw['closed_by_user_id'] as string | null) ?? null,
        created_at: (raw['created_at'] as string) ?? now,
        updated_at: (raw['updated_at'] as string) ?? now,
      };
      this.periods.set(period.id, period);
    }

    // 3. Journal Entries
    const rawJe = FIXTURE_JOURNAL_ENTRY_DRAFT;
    const lines = (rawJe['lines'] as Array<Record<string, unknown>>).map((l, idx) => ({
      id: `cccccccc-0001-0002-0001-${String(idx + 1).padStart(12, '0')}`,
      journal_entry_id: String(rawJe['id']),
      account_id: String(l['account_id']),
      debit_amount: String(l['debit_amount']),
      credit_amount: String(l['credit_amount']),
      line_narration: (l['line_narration'] as string | null) ?? null,
      department_ref: (l['department_ref'] as string | null) ?? null,
      created_at: now,
    }));

    const je: JournalEntry = {
      id: String(rawJe['id']),
      entry_number: String(rawJe['entry_number']),
      period_id: String(rawJe['period_id']),
      posting_date: String(rawJe['posting_date']),
      status: rawJe['status'] as JournalEntry['status'],
      description: String(rawJe['description']),
      currency_code: String(rawJe['currency_code']),
      source_reference: (rawJe['source_reference'] as string | null) ?? null,
      idempotency_key: (rawJe['idempotency_key'] as string | null) ?? null,
      created_by_user_id: String(rawJe['created_by_user_id']),
      posted_by_user_id: null,
      posted_at: null,
      reversed_by_entry_id: null,
      lines,
      created_at: now,
      updated_at: now,
    };
    this.journalEntries.set(je.id, je);

    // 4. Opening Balances
    const rawOb = FIXTURE_OPENING_BALANCE_BANK;
    const ob: OpeningBalance = {
      id: 'dddddddd-0001-0001-0001-000000000001',
      account_id: String(rawOb['account_id']),
      currency_code: String(rawOb['currency_code']),
      balance_amount: String(rawOb['balance_amount']),
      as_of_date: String(rawOb['as_of_date']),
      source_reference: (rawOb['source_reference'] as string | null) ?? null,
      loaded_by_user_id: String(rawOb['loaded_by_user_id']),
      created_at: now,
    };
    this.openingBalances.set(ob.id, ob);
  }

  // ── Accounts ───────────────────────────────────────────────────────────────

  async listAccounts(query: AccountListQuery): Promise<{ accounts: Account[]; total: number }> {
    let result = Array.from(this.accounts.values());

    // Search: case-insensitive across code and name
    if (query.search) {
      const term = query.search.toLowerCase();
      result = result.filter(
        (a) => a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term)
      );
    }

    // Type filter
    if (query.type) {
      result = result.filter((a) => a.type === query.type);
    }

    // is_active filter
    if (query.is_active !== undefined) {
      result = result.filter((a) => a.is_active === query.is_active);
    }

    // Currency filter
    if (query.currency_code) {
      result = result.filter((a) => a.currency_code === query.currency_code);
    }

    // Stable sort order: code ASC, id ASC
    result.sort((a, b) => {
      const codeCmp = a.code.localeCompare(b.code);
      if (codeCmp !== 0) return codeCmp;
      return a.id.localeCompare(b.id);
    });

    const total = result.length;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const accounts = result.slice(offset, offset + pageSize);

    return { accounts, total };
  }

  async getAccountById(id: string): Promise<Account | null> {
    return this.accounts.get(id) ?? null;
  }

  async getAccountByCode(code: string): Promise<Account | null> {
    for (const a of this.accounts.values()) {
      if (a.code.toLowerCase() === code.toLowerCase()) {
        return a;
      }
    }
    return null;
  }

  async createAccount(data: CreateAccountRequest & { id?: string }): Promise<Account> {
    const now = new Date().toISOString();
    const account: Account = {
      id: data.id ?? randomUUID(),
      code: data.code,
      name: data.name,
      type: data.type,
      currency_code: data.currency_code ?? 'INR',
      parent_id: data.parent_id ?? null,
      description: data.description ?? null,
      is_active: true,
      is_posting_account: data.is_posting_account ?? true,
      created_at: now,
      updated_at: now,
    };
    this.accounts.set(account.id, account);
    return account;
  }

  async updateAccount(id: string, updates: Partial<Account>): Promise<Account> {
    const existing = this.accounts.get(id);
    if (!existing) {
      throw new Error(`Account ${id} not found`);
    }
    const updated: Account = {
      ...existing,
      name: updates.name !== undefined ? updates.name : existing.name,
      description: updates.description !== undefined ? updates.description : existing.description,
      is_active: updates.is_active !== undefined ? updates.is_active : existing.is_active,
      is_posting_account:
        updates.is_posting_account !== undefined
          ? updates.is_posting_account
          : existing.is_posting_account,
      parent_id: updates.parent_id !== undefined ? updates.parent_id : existing.parent_id,
      updated_at: new Date().toISOString(),
    };
    this.accounts.set(id, updated);
    return updated;
  }

  // ── Accounting Periods ─────────────────────────────────────────────────────

  async listPeriods(query: PeriodListQuery): Promise<{ periods: AccountingPeriod[]; total: number }> {
    let result = Array.from(this.periods.values());

    if (query.status) {
      result = result.filter((p) => p.status === query.status);
    }

    if (query.fiscal_year) {
      result = result.filter((p) => p.fiscal_year === query.fiscal_year);
    }

    // Stable sort order: start_date ASC, id ASC
    result.sort((a, b) => {
      const dateCmp = a.start_date.localeCompare(b.start_date);
      if (dateCmp !== 0) return dateCmp;
      return a.id.localeCompare(b.id);
    });

    const total = result.length;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const periods = result.slice(offset, offset + pageSize);

    return { periods, total };
  }

  async getPeriodById(id: string): Promise<AccountingPeriod | null> {
    return this.periods.get(id) ?? null;
  }

  async getPeriodByLabel(label: string): Promise<AccountingPeriod | null> {
    for (const p of this.periods.values()) {
      if (p.period_label === label) {
        return p;
      }
    }
    return null;
  }

  async createPeriod(
    data: Omit<AccountingPeriod, 'created_at' | 'updated_at'> & { created_at?: string; updated_at?: string }
  ): Promise<AccountingPeriod> {
    const now = new Date().toISOString();
    const period: AccountingPeriod = {
      id: data.id,
      period_label: data.period_label,
      start_date: data.start_date,
      end_date: data.end_date,
      status: data.status,
      fiscal_year: data.fiscal_year,
      closed_at: data.closed_at ?? null,
      closed_by_user_id: data.closed_by_user_id ?? null,
      created_at: data.created_at ?? now,
      updated_at: data.updated_at ?? now,
    };
    this.periods.set(period.id, period);
    return period;
  }

  async updatePeriod(id: string, updates: Partial<AccountingPeriod>): Promise<AccountingPeriod> {
    const existing = this.periods.get(id);
    if (!existing) {
      throw new Error(`Accounting period ${id} not found`);
    }
    const updated: AccountingPeriod = {
      ...existing,
      status: updates.status !== undefined ? updates.status : existing.status,
      closed_at: updates.closed_at !== undefined ? updates.closed_at : existing.closed_at,
      closed_by_user_id: updates.closed_by_user_id !== undefined ? updates.closed_by_user_id : existing.closed_by_user_id,
      updated_at: new Date().toISOString(),
    };
    this.periods.set(id, updated);
    return updated;
  }

  // ── Journal Entries ────────────────────────────────────────────────────────

  async listJournalEntries(
    query: JournalEntryListQuery
  ): Promise<{ entries: JournalEntry[]; total: number }> {
    let result = Array.from(this.journalEntries.values());

    // Filter by period label (join lookup)
    if (query.period) {
      const periodObj = await this.getPeriodByLabel(query.period);
      if (periodObj) {
        result = result.filter((je) => je.period_id === periodObj.id);
      } else {
        return { entries: [], total: 0 };
      }
    }

    if (query.period_id) {
      result = result.filter((je) => je.period_id === query.period_id);
    }

    if (query.status) {
      result = result.filter((je) => je.status === query.status);
    }

    if (query.from_date) {
      result = result.filter((je) => je.posting_date >= query.from_date!);
    }

    if (query.to_date) {
      result = result.filter((je) => je.posting_date <= query.to_date!);
    }

    if (query.currency_code) {
      result = result.filter((je) => je.currency_code === query.currency_code);
    }

    // Search: case-insensitive across entry_number and description
    if (query.search) {
      const term = query.search.toLowerCase();
      result = result.filter(
        (je) =>
          je.entry_number.toLowerCase().includes(term) ||
          je.description.toLowerCase().includes(term)
      );
    }

    // Stable sort order: posting_date DESC, entry_number DESC, id DESC
    result.sort((a, b) => {
      const dateCmp = b.posting_date.localeCompare(a.posting_date);
      if (dateCmp !== 0) return dateCmp;
      const numCmp = b.entry_number.localeCompare(a.entry_number);
      if (numCmp !== 0) return numCmp;
      return b.id.localeCompare(a.id);
    });

    const total = result.length;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? query.limit ?? 20;
    const offset = (page - 1) * pageSize;
    const entries = result.slice(offset, offset + pageSize);

    return { entries, total };
  }

  async getJournalEntryById(id: string): Promise<JournalEntry | null> {
    return this.journalEntries.get(id) ?? null;
  }

  async getJournalEntryByIdempotencyKey(key: string): Promise<JournalEntry | null> {
    for (const je of this.journalEntries.values()) {
      if (je.idempotency_key && je.idempotency_key === key) {
        return je;
      }
    }
    return null;
  }

  async createJournalEntry(
    data: CreateJournalEntryRequest & { id?: string; entry_number: string; created_by_user_id: string }
  ): Promise<JournalEntry> {
    const now = new Date().toISOString();
    const entryId = data.id ?? randomUUID();

    const lines: JournalLine[] = data.lines.map((l, idx) => ({
      id: randomUUID(),
      journal_entry_id: entryId,
      account_id: l.account_id,
      debit_amount: l.debit_amount ?? '0.0000',
      credit_amount: l.credit_amount ?? '0.0000',
      line_narration: l.line_narration ?? null,
      department_ref: l.department_ref ?? null,
      created_at: now,
    }));

    const entry: JournalEntry = {
      id: entryId,
      entry_number: data.entry_number,
      period_id: data.period_id,
      posting_date: data.posting_date,
      status: 'draft',
      description: data.description,
      currency_code: data.currency_code,
      source_reference: data.source_reference ?? null,
      idempotency_key: data.idempotency_key ?? null,
      created_by_user_id: data.created_by_user_id,
      posted_by_user_id: null,
      posted_at: null,
      reversed_by_entry_id: null,
      lines,
      created_at: now,
      updated_at: now,
    };

    this.journalEntries.set(entry.id, entry);
    return entry;
  }

  async updateJournalEntry(id: string, updates: Partial<JournalEntry>): Promise<JournalEntry> {
    const entry = this.journalEntries.get(id);
    if (!entry) {
      throw new Error(`Journal entry ${id} not found`);
    }

    const updated: JournalEntry = {
      ...entry,
      posting_date: updates.posting_date !== undefined ? updates.posting_date : entry.posting_date,
      description: updates.description !== undefined ? updates.description : entry.description,
      period_id: updates.period_id !== undefined ? updates.period_id : entry.period_id,
      lines: updates.lines !== undefined ? updates.lines : entry.lines,
      updated_at: new Date().toISOString(),
    };

    this.journalEntries.set(id, updated);
    return updated;
  }

  async updateJournalEntryStatus(
    id: string,
    updates: {
      status: JournalEntry['status'];
      posted_at?: string | null;
      posted_by_user_id?: string | null;
      reversed_by_entry_id?: string | null;
    }
  ): Promise<JournalEntry> {
    const entry = this.journalEntries.get(id);
    if (!entry) {
      throw new Error(`Journal entry ${id} not found`);
    }

    const updated: JournalEntry = {
      ...entry,
      status: updates.status,
      posted_at: updates.posted_at !== undefined ? updates.posted_at : entry.posted_at,
      posted_by_user_id:
        updates.posted_by_user_id !== undefined ? updates.posted_by_user_id : entry.posted_by_user_id,
      reversed_by_entry_id:
        updates.reversed_by_entry_id !== undefined
          ? updates.reversed_by_entry_id
          : entry.reversed_by_entry_id,
      updated_at: new Date().toISOString(),
    };

    this.journalEntries.set(id, updated);
    return updated;
  }

  // ── Opening Balances ───────────────────────────────────────────────────────

  async listOpeningBalances(
    query: OpeningBalanceListQuery
  ): Promise<{ balances: OpeningBalance[]; total: number }> {
    let result = Array.from(this.openingBalances.values());

    if (query.account_id) {
      result = result.filter((ob) => ob.account_id === query.account_id);
    }

    if (query.currency_code) {
      result = result.filter((ob) => ob.currency_code === query.currency_code);
    }

    // Stable sort order: created_at ASC, id ASC
    result.sort((a, b) => {
      const dateCmp = a.created_at.localeCompare(b.created_at);
      if (dateCmp !== 0) return dateCmp;
      return a.id.localeCompare(b.id);
    });

    const total = result.length;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const balances = result.slice(offset, offset + pageSize);

    return { balances, total };
  }

  async getOpeningBalanceById(id: string): Promise<OpeningBalance | null> {
    return this.openingBalances.get(id) ?? null;
  }

  async getOpeningBalance(accountId: string, currencyCode: string): Promise<OpeningBalance | null> {
    for (const ob of this.openingBalances.values()) {
      if (ob.account_id === accountId && ob.currency_code === currencyCode) {
        return ob;
      }
    }
    return null;
  }

  async createOpeningBalance(item: {
    id?: string;
    account_id: string;
    currency_code: string;
    balance_amount: string;
    as_of_date: string;
    source_reference?: string | null;
    loaded_by_user_id: string;
  }): Promise<OpeningBalance> {
    const now = new Date().toISOString();
    const ob: OpeningBalance = {
      id: item.id ?? randomUUID(),
      account_id: item.account_id,
      currency_code: item.currency_code,
      balance_amount: item.balance_amount,
      as_of_date: item.as_of_date,
      source_reference: item.source_reference ?? null,
      loaded_by_user_id: item.loaded_by_user_id,
      created_at: now,
    };
    this.openingBalances.set(ob.id, ob);
    return ob;
  }

  // ── Import Receipts ────────────────────────────────────────────────────────

  async getImportReceiptByIdempotencyKey(key: string): Promise<ImportReceipt | null> {
    for (const receipt of this.importReceipts.values()) {
      if (receipt.idempotency_key === key) {
        return receipt;
      }
    }
    return null;
  }

  async createImportReceipt(receipt: {
    id?: string;
    batch_id: string;
    source_row: number;
    entity: string;
    schema_version?: number;
    idempotency_key: string;
    target_id: string;
    kind?: 'created' | 'linked';
    created_at?: string;
  }): Promise<ImportReceipt> {
    const item: ImportReceipt = {
      id: receipt.id ?? randomUUID(),
      batch_id: receipt.batch_id,
      source_row: receipt.source_row,
      entity: receipt.entity,
      schema_version: receipt.schema_version ?? 1,
      idempotency_key: receipt.idempotency_key,
      target_id: receipt.target_id,
      kind: receipt.kind ?? 'created',
      created_at: receipt.created_at ?? new Date().toISOString(),
    };
    this.importReceipts.set(item.id, item);
    return item;
  }
}
