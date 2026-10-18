/**
 * ERP-4 Finance & Accounting — Domain Service
 *
 * Implements business rules and coordinates repository operations:
 *   - Chart of Accounts (FR-ERP4-01)
 *   - Journal Entries & double-entry balance checks (FR-ERP4-02, BR-ERP4-01)
 *   - Accounting Period posting guard (BR-ERP4-02)
 *   - Trial Balance report generation (FR-ERP4-03)
 *   - One-time opening balances (FR-ERP4-04)
 *
 * @module erp4/services/finance.service
 */

import { randomUUID } from 'node:crypto';
import type {
  Account,
  CreateAccountRequest,
  AccountListQuery,
  AccountListResponse,
  JournalEntry,
  CreateJournalEntryRequest,
  JournalEntryListQuery,
  JournalEntryListResponse,
  ReverseJournalEntryRequest,
  TrialBalanceQuery,
  TrialBalanceResponse,
  TrialBalanceRow,
  OpeningBalance,
  CreateOpeningBalancesRequest,
  CreateOpeningBalancesResponse,
  OpeningBalanceListQuery,
  OpeningBalanceListResponse,
  AccountingPeriod,
  PeriodListQuery,
  PeriodListResponse,
} from '@clearshift/contracts';
import {
  assertDoubleEntryBalanced,
  assertJournalLineValid,
  assertPeriodAcceptsPosting,
  assertEntryIsReversible,
  computeTrialBalance,
  computeTrialBalanceTotals,
  DomainError,
} from '../../domain/engine.js';
import type { FinanceRepository } from './repository.js';
import { InMemoryFinanceRepository } from './repository.js';

// ─────────────────────────────────────────────────────────────────────────────
// Service Errors
// ─────────────────────────────────────────────────────────────────────────────

export class ServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly error: string,
    message: string,
    public readonly details: unknown[] = []
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export class NotFoundError extends ServiceError {
  constructor(entity: string, id: string) {
    super(404, 'Not Found', `${entity} with identifier "${id}" was not found.`);
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string) {
    super(409, 'Conflict', message);
  }
}

export class BadRequestError extends ServiceError {
  constructor(message: string, details: unknown[] = []) {
    super(400, 'Bad Request', message, details);
  }
}

export class UnprocessableError extends ServiceError {
  constructor(message: string, details: unknown[] = []) {
    super(422, 'Unprocessable Entity', message, details);
  }
}

export class ForbiddenError extends ServiceError {
  constructor(message: string = 'Forbidden') {
    super(403, 'Forbidden', message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Finance Service
// ─────────────────────────────────────────────────────────────────────────────

export class FinanceService {
  constructor(private readonly repository: FinanceRepository = new InMemoryFinanceRepository()) {}

  // ── Accounts (Chart of Accounts) ───────────────────────────────────────────

  async listAccounts(query: AccountListQuery): Promise<AccountListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const { accounts, total } = await this.repository.listAccounts({
      ...query,
      page,
      pageSize,
    });

    const totalPages = Math.ceil(total / pageSize) || 1;

    return {
      data: accounts,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  async getAccountById(id: string): Promise<Account> {
    const account = await this.repository.getAccountById(id);
    if (!account) {
      throw new NotFoundError('Account', id);
    }
    return account;
  }

  async createAccount(data: CreateAccountRequest): Promise<Account> {
    const existing = await this.repository.getAccountByCode(data.code);
    if (existing) {
      throw new ConflictError(`Account with code "${data.code}" already exists.`);
    }

    if (data.parent_id) {
      const parent = await this.repository.getAccountById(data.parent_id);
      if (!parent) {
        throw new BadRequestError(`Parent account with ID "${data.parent_id}" not found.`);
      }
    }

    return this.repository.createAccount(data);
  }

  // ── Accounting Periods ─────────────────────────────────────────────────────

  async listPeriods(query: PeriodListQuery): Promise<PeriodListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const { periods, total } = await this.repository.listPeriods({
      ...query,
      page,
      pageSize,
    });

    const totalPages = Math.ceil(total / pageSize) || 1;

    return {
      data: periods,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  async getPeriodById(id: string): Promise<AccountingPeriod> {
    const period = await this.repository.getPeriodById(id);
    if (!period) {
      throw new NotFoundError('Accounting period', id);
    }
    return period;
  }

  // ── Journal Entries ────────────────────────────────────────────────────────

  async listJournalEntries(query: JournalEntryListQuery): Promise<JournalEntryListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? query.limit ?? 20;

    const { entries, total } = await this.repository.listJournalEntries({
      ...query,
      page,
      pageSize,
    });

    const totalPages = Math.ceil(total / pageSize) || 1;

    return {
      data: entries,
      total,
      page,
      pageSize,
      limit: pageSize,
      totalPages,
    };
  }

  async getJournalEntryById(id: string): Promise<JournalEntry> {
    const entry = await this.repository.getJournalEntryById(id);
    if (!entry) {
      throw new NotFoundError('Journal entry', id);
    }
    return entry;
  }

  async createJournalEntry(
    data: CreateJournalEntryRequest,
    userId: string
  ): Promise<{ entry: JournalEntry; created: boolean }> {
    // Idempotency check
    if (data.idempotency_key) {
      const existing = await this.repository.getJournalEntryByIdempotencyKey(data.idempotency_key);
      if (existing) {
        return { entry: existing, created: false };
      }
    }

    // Validate period exists
    const period = await this.repository.getPeriodById(data.period_id);
    if (!period) {
      throw new BadRequestError(`Accounting period with ID "${data.period_id}" was not found.`);
    }

    // Validate lines per-line constraints (BR-ERP4-01)
    if (!data.lines || data.lines.length < 2) {
      throw new BadRequestError('A journal entry must contain at least 2 lines.');
    }

    for (let idx = 0; idx < data.lines.length; idx++) {
      const line = data.lines[idx]!;
      assertJournalLineValid(
        {
          account_id: line.account_id,
          debit_amount: line.debit_amount ?? '0.0000',
          credit_amount: line.credit_amount ?? '0.0000',
        },
        idx
      );

      // Verify account exists
      const acct = await this.repository.getAccountById(line.account_id);
      if (!acct) {
        throw new BadRequestError(`Account "${line.account_id}" does not exist.`);
      }
      if (!acct.is_posting_account) {
        throw new BadRequestError(`Account "${acct.code}" is a header account and cannot receive postings.`);
      }
    }

    // Validate double-entry balance invariant at 4 decimal places (BR-ERP4-01)
    try {
      assertDoubleEntryBalanced(
        data.lines.map((l) => ({
          account_id: l.account_id,
          debit_amount: l.debit_amount ?? '0.0000',
          credit_amount: l.credit_amount ?? '0.0000',
        })),
        data.currency_code
      );
    } catch (err) {
      if (err instanceof DomainError) {
        throw new BadRequestError(err.message, [err.context]);
      }
      throw err;
    }

    const entryNumber = `JV-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

    const entry = await this.repository.createJournalEntry({
      ...data,
      entry_number: entryNumber,
      created_by_user_id: userId,
    });

    return { entry, created: true };
  }

  async postJournalEntry(id: string, user: { id: string; role?: string }): Promise<JournalEntry> {
    const entry = await this.repository.getJournalEntryById(id);
    if (!entry) {
      throw new NotFoundError('Journal entry', id);
    }

    // Status machine: only draft entries can be posted
    if (entry.status !== 'draft') {
      throw new UnprocessableError(
        `Journal entry ${entry.entry_number} cannot be posted from status "${entry.status}". Posted entries are immutable.`
      );
    }

    // Domain invariant: Every posted journal entry balances exactly at currency precision (BR-ERP4-01)
    try {
      assertDoubleEntryBalanced(
        entry.lines.map((l) => ({
          account_id: l.account_id,
          debit_amount: l.debit_amount,
          credit_amount: l.credit_amount,
        })),
        entry.currency_code
      );
    } catch (err) {
      if (err instanceof DomainError) {
        throw new UnprocessableError(
          `Cannot post unbalanced journal entry: ${err.message}`,
          [err.context]
        );
      }
      throw err;
    }

    // Period posting guard (BR-ERP4-02): closed month rejects posting
    const period = await this.repository.getPeriodById(entry.period_id);
    if (!period) {
      throw new UnprocessableError(`Accounting period for entry "${id}" does not exist.`);
    }

    try {
      assertPeriodAcceptsPosting(
        { period_label: period.period_label, status: period.status },
        user.role ?? 'staff'
      );
    } catch (err) {
      if (err instanceof DomainError) {
        if (err.code === 'PERIOD_LOCKED') {
          throw new UnprocessableError(`Cannot post entry: period "${period.period_label}" is locked.`);
        }
        if (err.code === 'PERIOD_SOFT_CLOSED') {
          throw new ForbiddenError(
            `Cannot post entry: period "${period.period_label}" is soft-closed and requires finance_admin role.`
          );
        }
      }
      throw err;
    }

    // Post and immutably lock entry
    return this.repository.updateJournalEntryStatus(id, {
      status: 'posted',
      posted_at: new Date().toISOString(),
      posted_by_user_id: user.id,
    });
  }

  async reverseJournalEntry(
    id: string,
    data: ReverseJournalEntryRequest,
    user: { id: string; role?: string }
  ): Promise<{ original: JournalEntry; reversal: JournalEntry }> {
    const entry = await this.repository.getJournalEntryById(id);
    if (!entry) {
      throw new NotFoundError('Journal entry', id);
    }

    // Assert entry is reversible (must be posted, not draft/voided/already reversed)
    try {
      assertEntryIsReversible(entry.id, entry.status);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new UnprocessableError(`Cannot reverse journal entry: ${err.message}`);
      }
      throw err;
    }

    // Period posting guard on reversal date/period
    const period = await this.repository.getPeriodById(entry.period_id);
    if (!period) {
      throw new UnprocessableError(`Accounting period for entry "${id}" does not exist.`);
    }

    try {
      assertPeriodAcceptsPosting(
        { period_label: period.period_label, status: period.status },
        user.role ?? 'staff'
      );
    } catch (err) {
      if (err instanceof DomainError) {
        throw new UnprocessableError(`Cannot reverse entry into period "${period.period_label}": ${err.message}`);
      }
      throw err;
    }

    const reversalDate = data.reversal_date ?? new Date().toISOString().slice(0, 10);
    const reversalDescription =
      data.reversal_description ?? `Reversal of ${entry.entry_number}: ${entry.description}`;

    // Swap debit and credit lines
    const swappedLines = entry.lines.map((l) => ({
      account_id: l.account_id,
      debit_amount: l.credit_amount,
      credit_amount: l.debit_amount,
      line_narration: `Reversal leg: ${l.line_narration ?? ''}`.trim(),
      department_ref: l.department_ref ?? null,
    }));

    // Create the reversal entry directly in posted status
    const reversalNumber = `${entry.entry_number}-REV`;
    const reversalEntryDraft = await this.repository.createJournalEntry({
      period_id: entry.period_id,
      posting_date: reversalDate,
      description: reversalDescription,
      currency_code: entry.currency_code,
      source_reference: `REVERSAL:${entry.id}`,
      idempotency_key: `reversal-${entry.id}`,
      entry_number: reversalNumber,
      created_by_user_id: user.id,
      lines: swappedLines,
    });

    const postedReversal = await this.repository.updateJournalEntryStatus(reversalEntryDraft.id, {
      status: 'posted',
      posted_at: new Date().toISOString(),
      posted_by_user_id: user.id,
    });

    // Mark original entry as reversed and point to reversal entry
    const updatedOriginal = await this.repository.updateJournalEntryStatus(id, {
      status: 'reversed',
      reversed_by_entry_id: postedReversal.id,
    });

    return { original: updatedOriginal, reversal: postedReversal };
  }

  // ── Trial Balance ──────────────────────────────────────────────────────────

  async getTrialBalance(query: TrialBalanceQuery): Promise<TrialBalanceResponse> {
    const period = await this.repository.getPeriodByLabel(query.period);
    if (!period) {
      throw new NotFoundError('Accounting period', query.period);
    }

    // Retrieve all posted journal entries for this period (up to 100 for V1)
    const { entries } = await this.repository.listJournalEntries({
      period: query.period,
      status: 'posted',
      currency_code: query.currency_code,
      page: 1,
      pageSize: 100,
    });

    // Extract lines into ledger movements
    const movements: Array<{
      account_id: string;
      currency_code: string;
      debit_amount: string;
      credit_amount: string;
    }> = [];

    for (const entry of entries) {
      for (const line of entry.lines) {
        movements.push({
          account_id: line.account_id,
          currency_code: entry.currency_code,
          debit_amount: line.debit_amount,
          credit_amount: line.credit_amount,
        });
      }
    }

    // Retrieve opening balances
    const { balances: openingBalancesList } = await this.repository.listOpeningBalances({
      currency_code: query.currency_code,
      page: 1,
      pageSize: 100,
    });

    const openingBalances = openingBalancesList.map((ob) => ({
      account_id: ob.account_id,
      currency_code: ob.currency_code,
      balance_amount: ob.balance_amount,
    }));

    // Compute trial balance rows using pure domain engine
    const rawRows = computeTrialBalance(movements, openingBalances);

    // Populate account metadata (code, name, type) for each row
    const enrichedRows: TrialBalanceRow[] = [];
    for (const row of rawRows) {
      const acct = await this.repository.getAccountById(row.account_id);
      enrichedRows.push({
        account_id: row.account_id,
        account_code: acct!.code,
        account_name: acct!.name,
        account_type: acct!.type,
        currency_code: row.currency_code,
        total_debit: row.total_debit,
        total_credit: row.total_credit,
        net_balance: row.net_balance,
        opening_balance: row.opening_balance,
        closing_balance: row.closing_balance,
      });
    }

    // Sort rows stably by account_code ASC
    enrichedRows.sort((a, b) => a.account_code.localeCompare(b.account_code));

    const totals = computeTrialBalanceTotals(enrichedRows);

    return {
      period: query.period,
      generated_at: new Date().toISOString(),
      rows: enrichedRows,
      totals,
    };
  }

  // ── Opening Balances ───────────────────────────────────────────────────────

  async listOpeningBalances(query: OpeningBalanceListQuery): Promise<OpeningBalanceListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const { balances, total } = await this.repository.listOpeningBalances({
      ...query,
      page,
      pageSize,
    });

    const totalPages = Math.ceil(total / pageSize) || 1;

    return {
      data: balances,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  async getOpeningBalanceById(id: string): Promise<OpeningBalance> {
    const balance = await this.repository.getOpeningBalanceById(id);
    if (!balance) {
      throw new NotFoundError('Opening balance', id);
    }
    return balance;
  }

  async createOpeningBalances(
    data: CreateOpeningBalancesRequest,
    userId: string
  ): Promise<CreateOpeningBalancesResponse> {
    const created: OpeningBalance[] = [];
    const skipped: Array<{ account_id: string; currency_code: string; reason: string }> = [];

    for (const item of data.balances) {
      // Verify account exists
      const account = await this.repository.getAccountById(item.account_id);
      if (!account) {
        skipped.push({
          account_id: item.account_id,
          currency_code: item.currency_code,
          reason: `Account with ID "${item.account_id}" does not exist.`,
        });
        continue;
      }

      // Check if already loaded (FR-ERP4-04: one-time per account/currency)
      const existing = await this.repository.getOpeningBalance(item.account_id, item.currency_code);
      if (existing) {
        skipped.push({
          account_id: item.account_id,
          currency_code: item.currency_code,
          reason: `Opening balance already loaded for account "${account.code}" in currency "${item.currency_code}".`,
        });
        continue;
      }

      const balance = await this.repository.createOpeningBalance({
        account_id: item.account_id,
        currency_code: item.currency_code,
        balance_amount: item.balance_amount,
        as_of_date: item.as_of_date,
        source_reference: item.source_reference ?? null,
        loaded_by_user_id: userId,
      });

      created.push(balance);
    }

    return { created, skipped };
  }
}
