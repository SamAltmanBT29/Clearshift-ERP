/**
 * ERP-4 Finance — Synthetic Test Fixtures
 *
 * These are static, deterministic UUIDs and values used exclusively in
 * tests and local development seeds.  No real personal data; no cloud services.
 *
 * Convention: FIXTURE_<TABLE>_<NAME>
 */

// ─── Accounts ────────────────────────────────────────────────────────────────

export const FIXTURE_ACCOUNT_CASH: Record<string, unknown> = {
  id: 'aaaaaaaa-0001-0001-0001-000000000001',
  code: '1010-CASH',
  name: 'Cash & Cash Equivalents',
  type: 'asset',
  currency_code: 'INR',
  parent_id: null,
  is_active: true,
  is_posting_account: true,
};

export const FIXTURE_ACCOUNT_BANK: Record<string, unknown> = {
  id: 'aaaaaaaa-0001-0001-0001-000000000002',
  code: '1020-BANK',
  name: 'Main Bank Account',
  type: 'asset',
  currency_code: 'INR',
  parent_id: null,
  is_active: true,
  is_posting_account: true,
};

export const FIXTURE_ACCOUNT_ACCOUNTS_PAYABLE: Record<string, unknown> = {
  id: 'aaaaaaaa-0001-0001-0001-000000000003',
  code: '2010-AP',
  name: 'Accounts Payable',
  type: 'liability',
  currency_code: 'INR',
  parent_id: null,
  is_active: true,
  is_posting_account: true,
};

export const FIXTURE_ACCOUNT_SALES_REVENUE: Record<string, unknown> = {
  id: 'aaaaaaaa-0001-0001-0001-000000000004',
  code: '4010-SALES',
  name: 'Sales Revenue',
  type: 'income',
  currency_code: 'INR',
  parent_id: null,
  is_active: true,
  is_posting_account: true,
};

export const FIXTURE_ACCOUNT_SALARY_EXPENSE: Record<string, unknown> = {
  id: 'aaaaaaaa-0001-0001-0001-000000000005',
  code: '5010-SALARY',
  name: 'Salary Expense',
  type: 'expense',
  currency_code: 'INR',
  parent_id: null,
  is_active: true,
  is_posting_account: true,
};

// ─── Accounting Periods ───────────────────────────────────────────────────────

export const FIXTURE_PERIOD_OPEN: Record<string, unknown> = {
  id: 'bbbbbbbb-0001-0001-0001-000000000001',
  period_label: '2026-04',
  start_date: '2026-04-01',
  end_date: '2026-04-30',
  status: 'open',
  fiscal_year: 'FY2026-27',
};

export const FIXTURE_PERIOD_SOFT_CLOSED: Record<string, unknown> = {
  id: 'bbbbbbbb-0001-0001-0001-000000000002',
  period_label: '2026-03',
  start_date: '2026-03-01',
  end_date: '2026-03-31',
  status: 'soft_closed',
  fiscal_year: 'FY2025-26',
  closed_at: '2026-04-05T10:00:00Z',
};

export const FIXTURE_PERIOD_LOCKED: Record<string, unknown> = {
  id: 'bbbbbbbb-0001-0001-0001-000000000003',
  period_label: '2026-02',
  start_date: '2026-02-01',
  end_date: '2026-02-28',
  status: 'locked',
  fiscal_year: 'FY2025-26',
  closed_at: '2026-03-10T09:00:00Z',
};

// ─── Journal Entries (balanced) ───────────────────────────────────────────────

export const FIXTURE_JOURNAL_ENTRY_DRAFT: Record<string, unknown> = {
  id: 'cccccccc-0001-0001-0001-000000000001',
  entry_number: 'JV-2026-0001',
  period_id: 'bbbbbbbb-0001-0001-0001-000000000001',
  posting_date: '2026-04-15',
  status: 'draft',
  description: 'Synthetic: Cash sale to customer',
  currency_code: 'INR',
  created_by_user_id: 'ffffffff-0001-0001-0001-000000000001',
  lines: [
    {
      account_id: 'aaaaaaaa-0001-0001-0001-000000000002', // BANK
      debit_amount: '50000.0000',
      credit_amount: '0.0000',
      line_narration: 'Cash receipt from customer',
    },
    {
      account_id: 'aaaaaaaa-0001-0001-0001-000000000004', // SALES
      debit_amount: '0.0000',
      credit_amount: '50000.0000',
      line_narration: 'Sales revenue recognised',
    },
  ],
};

// ─── Opening Balances ─────────────────────────────────────────────────────────

export const FIXTURE_OPENING_BALANCE_BANK: Record<string, unknown> = {
  account_id: 'aaaaaaaa-0001-0001-0001-000000000002',
  currency_code: 'INR',
  balance_amount: '200000.0000',
  as_of_date: '2026-04-01',
  source_reference: 'MIGRATION-RUN-001',
  loaded_by_user_id: 'ffffffff-0001-0001-0001-000000000001',
};
