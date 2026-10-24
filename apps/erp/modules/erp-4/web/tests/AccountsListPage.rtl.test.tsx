// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AccountsListPage } from '../src/pages/AccountsListPage.js';
import * as api from '../src/api/erp-4.js';
import type { Account, JournalEntry, TrialBalanceResponse } from '@clearshift/contracts';

const mockAccountA: Account = {
  id: '44444444-4444-4000-8000-000000000001',
  code: '1010',
  name: 'Operating Cash',
  type: 'asset',
  currencyCode: 'USD',
  isActive: true,
  balance: 25000,
  createdAt: '2026-04-15T00:00:00.000Z',
  updatedAt: '2026-04-15T00:00:00.000Z',
};

const mockAccountB: Account = {
  id: '44444444-4444-4000-8000-000000000002',
  code: '2010',
  name: 'Accounts Payable',
  type: 'liability',
  currencyCode: 'USD',
  isActive: true,
  balance: 10000,
  createdAt: '2026-04-15T00:00:00.000Z',
  updatedAt: '2026-04-15T00:00:00.000Z',
};

const mockJournalEntry: JournalEntry = {
  id: '77777777-7777-4000-8000-000000000001',
  entry_number: 'JE-2026-0001',
  posting_date: '2026-04-15',
  period_id: '2026-04',
  currency_code: 'USD',
  description: 'Initial Opening Entry',
  status: 'draft',
  lines: [
    {
      id: '88888888-8888-4000-8000-000000000001',
      account_id: mockAccountA.id,
      debit: 500,
      credit: 0,
      narration: 'Cash deposit',
    },
    {
      id: '88888888-8888-4000-8000-000000000002',
      account_id: mockAccountB.id,
      debit: 0,
      credit: 500,
      narration: 'Payable balance',
    },
  ],
  created_at: '2026-04-15T00:00:00.000Z',
  updated_at: '2026-04-15T00:00:00.000Z',
};

const mockTrialBalance: TrialBalanceResponse = {
  period: '2026-04',
  currencyCode: 'USD',
  items: [
    {
      accountId: mockAccountA.id,
      accountCode: mockAccountA.code,
      accountName: mockAccountA.name,
      accountType: 'asset',
      currencyCode: 'USD',
      debit: 25000,
      credit: 0,
      netBalance: 25000,
    },
    {
      accountId: mockAccountB.id,
      accountCode: mockAccountB.code,
      accountName: mockAccountB.name,
      accountType: 'liability',
      currencyCode: 'USD',
      debit: 0,
      credit: 25000,
      netBalance: -25000,
    },
  ],
  totalDebit: 25000,
  totalCredit: 25000,
  isBalanced: true,
  accountCount: 2,
  generatedAt: '2026-04-15T00:00:00.000Z',
};

describe('AccountsListPage — React Testing Library Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'fetchAccounts').mockResolvedValue({
      items: [mockAccountA, mockAccountB],
      data: [mockAccountA, mockAccountB],
      total: 2,
      page: 1,
      limit: 20,
      pageSize: 20,
      totalPages: 1,
    });
    vi.spyOn(api, 'fetchTrialBalance').mockResolvedValue(mockTrialBalance);
    vi.spyOn(api, 'fetchJournalEntries').mockResolvedValue({
      data: [mockJournalEntry],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <AccountsListPage />
      </MemoryRouter>
    );

  it('renders page header, metric cards, and accounts table on mount', async () => {
    renderComponent();

    expect(screen.getByText('Finance & Accounting (ERP-4)')).toBeDefined();

    const cashRow = await screen.findByText('Operating Cash');
    expect(cashRow).toBeDefined();
    expect(screen.getByText('Accounts Payable')).toBeDefined();
    expect(screen.getByText('Total Accounts')).toBeDefined();
    expect(screen.getByText('Double-Entry')).toBeDefined();
  });

  it('handles search input change and calls fetchAccounts with query', async () => {
    renderComponent();

    await screen.findByText('Operating Cash');

    const searchInput = screen.getByPlaceholderText(/Search accounts by code or name/i);
    fireEvent.change(searchInput, { target: { value: 'Cash' } });

    await waitFor(() => {
      expect(api.fetchAccounts).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Cash', page: 1 })
      );
    });
  });

  it('handles account type filter selection', async () => {
    renderComponent();

    await screen.findByText('Operating Cash');

    const typeSelect = screen.getByLabelText(/Filter by account type/i);
    fireEvent.change(typeSelect, { target: { value: 'asset' } });

    await waitFor(() => {
      expect(api.fetchAccounts).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'asset', page: 1 })
      );
    });
  });

  it('switches between Chart of Accounts, Trial Balance, and Journal Entries tabs', async () => {
    renderComponent();

    await screen.findByText('Operating Cash');

    // Switch to Trial Balance tab
    const tbTab = screen.getByRole('tab', { name: /Trial Balance View/i });
    fireEvent.click(tbTab);

    await waitFor(() => {
      expect(api.fetchTrialBalance).toHaveBeenCalled();
      expect(screen.getByText(/Invariant Verified: Balanced/i)).toBeDefined();
    });

    // Switch to Journal Entries tab
    const jeTab = screen.getByRole('tab', { name: /Journal Entries/i });
    fireEvent.click(jeTab);

    await waitFor(() => {
      expect(api.fetchJournalEntries).toHaveBeenCalled();
      expect(screen.getByText('Initial Opening Entry')).toBeDefined();
    });
  });

  it('navigates to create new journal entry view when clicking + New Journal Entry', async () => {
    renderComponent();

    await screen.findByText('Operating Cash');

    const newBtn = screen.getByRole('button', { name: /Create new journal entry/i });
    fireEvent.click(newBtn);

    await waitFor(() => {
      expect(screen.getByRole('main', { name: /Journal Entry Creation Screen/i })).toBeDefined();
    });

    // Back to list
    const backBtn = screen.getByRole('button', { name: /Back to accounts list/i });
    fireEvent.click(backBtn);

    await waitFor(() => {
      expect(screen.getByText('Finance & Accounting (ERP-4)')).toBeDefined();
    });
  });

  it('opens account create modal when clicking + New Account', async () => {
    renderComponent();

    await screen.findByText('Operating Cash');

    const createAccBtn = screen.getByRole('button', { name: /Create new account/i });
    fireEvent.click(createAccBtn);

    await waitFor(() => {
      expect(screen.getByText('Create General Ledger Account')).toBeDefined();
    });
  });
});
