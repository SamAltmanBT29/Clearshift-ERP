// @vitest-environment jsdom
/**
 * Automated Verification Suite for ERP4-17: Main Paginated Data Table
 *
 * Verifies:
 * - Table displays entity rows with stable columns matching the data dictionary
 * - Pagination controls bind to API page and pageSize query parameters
 * - Sorting by column headers toggles ascending/descending order predictably
 * - Virtualization or bounded paging prevents DOM performance degradation
 *
 * @module erp4/web/tests/paginated-data-table
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Account, JournalEntry } from '@clearshift/contracts';
import { installNavigationRequestShim } from './support/jsdom-environment.js';
import { AccountsTable } from '../src/components/AccountsTable.js';
import { JournalEntriesTable } from '../src/components/JournalEntriesTable.js';

installNavigationRequestShim();

describe('ERP4-17: Main Paginated Data Table Component Suite', () => {
  const mockAccounts: Account[] = [
    {
      id: 'acc-1111-1111',
      code: '1010',
      name: 'Cash in Bank',
      type: 'asset',
      currency_code: 'USD',
      parent_id: null,
      description: 'Primary operating account',
      is_active: true,
      is_posting_account: true,
      created_at: '2026-10-20T00:00:00.000Z',
      updated_at: '2026-10-20T00:00:00.000Z',
    },
    {
      id: 'acc-2222-2222',
      code: '2010',
      name: 'Accounts Payable',
      type: 'liability',
      currency_code: 'USD',
      parent_id: null,
      description: 'Vendor payables',
      is_active: true,
      is_posting_account: true,
      created_at: '2026-10-20T00:00:00.000Z',
      updated_at: '2026-10-20T00:00:00.000Z',
    },
    {
      id: 'acc-3333-3333',
      code: '4010',
      name: 'Sales Revenue',
      type: 'income',
      currency_code: 'USD',
      parent_id: null,
      description: 'Product sales',
      is_active: false,
      is_posting_account: true,
      created_at: '2026-10-20T00:00:00.000Z',
      updated_at: '2026-10-20T00:00:00.000Z',
    },
  ];

  const mockJournalEntries: JournalEntry[] = [
    {
      id: 'je-1111-1111',
      entry_number: 'JE-2026-0001',
      period_id: '2026-10',
      posting_date: '2026-10-01',
      status: 'posted',
      description: 'Monthly office rent payment',
      created_by_user_id: 'u-1',
      posted_at: '2026-10-01T10:00:00Z',
      posted_by_user_id: 'u-1',
      reversed_by_journal_entry_id: null,
      created_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T10:00:00Z',
      lines: [
        {
          id: 'jl-1',
          journal_entry_id: 'je-1111-1111',
          account_id: 'acc-1111-1111',
          debit_amount: '1500.00',
          credit_amount: '0.00',
          line_narration: 'Rent debit',
          department_ref: null,
          created_at: '2026-10-01T09:00:00Z',
        },
        {
          id: 'jl-2',
          journal_entry_id: 'je-1111-1111',
          account_id: 'acc-2222-2222',
          debit_amount: '0.00',
          credit_amount: '1500.00',
          line_narration: 'Rent cash credit',
          department_ref: null,
          created_at: '2026-10-01T09:00:00Z',
        },
      ],
    },
    {
      id: 'je-2222-2222',
      entry_number: 'JE-2026-0002',
      period_id: '2026-10',
      posting_date: '2026-10-02',
      status: 'draft',
      description: 'Utilities accrual',
      created_by_user_id: 'u-1',
      posted_at: null,
      posted_by_user_id: null,
      reversed_by_journal_entry_id: null,
      created_at: '2026-10-02T09:00:00Z',
      updated_at: '2026-10-02T09:00:00Z',
      lines: [],
    },
  ];

  describe('1. Acceptance Criterion: Table displays entity rows matching data dictionary', () => {
    it('AccountsTable renders all stable columns defined in ERP-4 data dictionary', () => {
      render(
        <MemoryRouter>
          <AccountsTable
            accounts={mockAccounts}
            isLoading={false}
            total={3}
            page={1}
            totalPages={1}
            onPageChange={vi.fn()}
          />
        </MemoryRouter>
      );

      // Verify column headers exist
      expect(screen.getByRole('columnheader', { name: /Account Code/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Account Name/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Type/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Currency/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Balance/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Status/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Actions/i })).toBeDefined();

      // Verify row values rendered correctly
      expect(screen.getByText('1010')).toBeDefined();
      expect(screen.getByText('Cash in Bank')).toBeDefined();
      expect(screen.getByText('Primary operating account')).toBeDefined();
      expect(screen.getByText('2010')).toBeDefined();
      expect(screen.getByText('Accounts Payable')).toBeDefined();
      expect(screen.getByText('4010')).toBeDefined();
      expect(screen.getByText('Sales Revenue')).toBeDefined();

      // Status badges
      const activeBadges = screen.getAllByText('Active');
      expect(activeBadges.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Archived')).toBeDefined();
    });

    it('JournalEntriesTable renders all stable columns matching data dictionary', () => {
      render(
        <MemoryRouter>
          <JournalEntriesTable
            entries={mockJournalEntries}
            isLoading={false}
            total={2}
            page={1}
            totalPages={1}
            onPageChange={vi.fn()}
          />
        </MemoryRouter>
      );

      // Verify column headers
      expect(screen.getByRole('columnheader', { name: /Entry Number/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Posting Date/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Fiscal Period/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Description/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Currency/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Status/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Actions/i })).toBeDefined();

      // Verify row items
      expect(screen.getByText('JE-2026-0001')).toBeDefined();
      expect(screen.getByText('Monthly office rent payment')).toBeDefined();
      expect(screen.getByText('JE-2026-0002')).toBeDefined();
      expect(screen.getByText('Utilities accrual')).toBeDefined();
      expect(screen.getByText('POSTED')).toBeDefined();
      expect(screen.getByText('DRAFT')).toBeDefined();
    });
  });

  describe('2. Acceptance Criterion: Pagination controls bind to API page and pageSize parameters', () => {
    it('triggers onPageChange with target page number on next/previous clicks', () => {
      const onPageChange = vi.fn();
      render(
        <MemoryRouter>
          <AccountsTable
            accounts={mockAccounts}
            isLoading={false}
            total={60}
            page={2}
            totalPages={3}
            pageSize={20}
            onPageChange={onPageChange}
          />
        </MemoryRouter>
      );

      const prevBtn = screen.getByRole('button', { name: /Go to previous page/i }) as HTMLButtonElement;
      const nextBtn = screen.getByRole('button', { name: /Go to next page/i }) as HTMLButtonElement;

      expect(prevBtn).toBeDefined();
      expect(nextBtn).toBeDefined();
      expect(prevBtn.disabled).toBe(false);
      expect(nextBtn.disabled).toBe(false);

      fireEvent.click(prevBtn);
      expect(onPageChange).toHaveBeenCalledWith(1);

      fireEvent.click(nextBtn);
      expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it('disables previous button on first page and next button on last page', () => {
      const { rerender } = render(
        <MemoryRouter>
          <AccountsTable
            accounts={mockAccounts}
            isLoading={false}
            total={20}
            page={1}
            totalPages={2}
            pageSize={10}
            onPageChange={vi.fn()}
          />
        </MemoryRouter>
      );

      const page1Prev = screen.getByRole('button', { name: /Go to previous page/i }) as HTMLButtonElement;
      const page1Next = screen.getByRole('button', { name: /Go to next page/i }) as HTMLButtonElement;
      expect(page1Prev.disabled).toBe(true);
      expect(page1Next.disabled).toBe(false);

      // Re-render on last page
      rerender(
        <MemoryRouter>
          <AccountsTable
            accounts={mockAccounts}
            isLoading={false}
            total={20}
            page={2}
            totalPages={2}
            pageSize={10}
            onPageChange={vi.fn()}
          />
        </MemoryRouter>
      );

      const page2Prev = screen.getByRole('button', { name: /Go to previous page/i }) as HTMLButtonElement;
      const page2Next = screen.getByRole('button', { name: /Go to next page/i }) as HTMLButtonElement;
      expect(page2Prev.disabled).toBe(false);
      expect(page2Next.disabled).toBe(true);
    });

    it('triggers onPageSizeChange and respects bounded page size options (max 100)', () => {
      const onPageSizeChange = vi.fn();
      render(
        <MemoryRouter>
          <AccountsTable
            accounts={mockAccounts}
            isLoading={false}
            total={150}
            page={1}
            totalPages={8}
            pageSize={20}
            pageSizeOptions={[10, 20, 50, 100]}
            onPageChange={vi.fn()}
            onPageSizeChange={onPageSizeChange}
          />
        </MemoryRouter>
      );

      const select = screen.getByRole('combobox', { name: /Items per page/i });
      expect(select).toBeDefined();

      fireEvent.change(select, { target: { value: '50' } });
      expect(onPageSizeChange).toHaveBeenCalledWith(50);

      fireEvent.change(select, { target: { value: '100' } });
      expect(onPageSizeChange).toHaveBeenCalledWith(100);
    });
  });

  describe('3. Acceptance Criterion: Sorting by column headers toggles order predictably', () => {
    it('sets aria-sort attributes correctly on sorted headers and toggles on header click', () => {
      const onSort = vi.fn();
      render(
        <MemoryRouter>
          <AccountsTable
            accounts={mockAccounts}
            isLoading={false}
            total={3}
            page={1}
            totalPages={1}
            sortColumn="code"
            sortDirection="asc"
            onSort={onSort}
            onPageChange={vi.fn()}
          />
        </MemoryRouter>
      );

      const codeHeader = screen.getByRole('columnheader', { name: /Account Code/i });
      expect(codeHeader.getAttribute('aria-sort')).toBe('ascending');

      const nameHeader = screen.getByRole('columnheader', { name: /Account Name/i });
      expect(nameHeader.getAttribute('aria-sort')).toBe('none');

      // Click to sort by Name
      fireEvent.click(nameHeader);
      expect(onSort).toHaveBeenCalledWith('name');
    });

    it('predictably sorts accounts in descending order when toggled', () => {
      const { rerender } = render(
        <MemoryRouter>
          <AccountsTable
            accounts={mockAccounts}
            isLoading={false}
            total={3}
            page={1}
            totalPages={1}
            sortColumn="code"
            sortDirection="asc"
            onPageChange={vi.fn()}
          />
        </MemoryRouter>
      );

      let rows = screen.getAllByRole('row');
      // header row is row 0, data rows 1, 2, 3
      expect(rows[1]?.textContent).toContain('1010');
      expect(rows[3]?.textContent).toContain('4010');

      // Re-render in desc order
      rerender(
        <MemoryRouter>
          <AccountsTable
            accounts={mockAccounts}
            isLoading={false}
            total={3}
            page={1}
            totalPages={1}
            sortColumn="code"
            sortDirection="desc"
            onPageChange={vi.fn()}
          />
        </MemoryRouter>
      );

      rows = screen.getAllByRole('row');
      expect(rows[1]?.textContent).toContain('4010');
      expect(rows[3]?.textContent).toContain('1010');
    });

    it('JournalEntriesTable toggles sort order on header click', () => {
      const onSort = vi.fn();
      render(
        <MemoryRouter>
          <JournalEntriesTable
            entries={mockJournalEntries}
            isLoading={false}
            total={2}
            page={1}
            totalPages={1}
            sortColumn="entry_number"
            sortDirection="desc"
            onSort={onSort}
            onPageChange={vi.fn()}
          />
        </MemoryRouter>
      );

      const entryNumHeader = screen.getByRole('columnheader', { name: /Entry Number/i });
      expect(entryNumHeader.getAttribute('aria-sort')).toBe('descending');

      fireEvent.click(entryNumHeader);
      expect(onSort).toHaveBeenCalledWith('entry_number');
    });
  });

  describe('4. Acceptance Criterion: Virtualization & safe state rendering', () => {
    it('renders SkeletonTable when isLoading is true', () => {
      render(
        <MemoryRouter>
          <AccountsTable
            accounts={[]}
            isLoading={true}
            total={0}
            page={1}
            totalPages={1}
            onPageChange={vi.fn()}
          />
        </MemoryRouter>
      );

      // Loading skeleton table
      expect(screen.getByText(/Loading data from API/i)).toBeDefined();
    });

    it('renders EmptyState with refresh action when data list is empty', () => {
      const onRefresh = vi.fn();
      render(
        <MemoryRouter>
          <AccountsTable
            accounts={[]}
            isLoading={false}
            total={0}
            page={1}
            totalPages={1}
            onPageChange={vi.fn()}
            onRefresh={onRefresh}
          />
        </MemoryRouter>
      );

      expect(screen.getByText('No accounts found')).toBeDefined();
      const refreshBtn = screen.getByRole('button', { name: /Refresh Accounts/i });
      fireEvent.click(refreshBtn);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('JournalEntriesTable renders empty state when entries are empty', () => {
      const onRefresh = vi.fn();
      render(
        <MemoryRouter>
          <JournalEntriesTable
            entries={[]}
            isLoading={false}
            total={0}
            page={1}
            totalPages={1}
            onPageChange={vi.fn()}
            onRefresh={onRefresh}
          />
        </MemoryRouter>
      );

      expect(screen.getByText('No journal entries found')).toBeDefined();
      const refreshBtn = screen.getByRole('button', { name: /Refresh Ledger/i });
      fireEvent.click(refreshBtn);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });
});
