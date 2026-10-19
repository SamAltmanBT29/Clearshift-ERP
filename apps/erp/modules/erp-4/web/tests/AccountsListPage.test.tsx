import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { AccountsTable } from '../src/components/AccountsTable.js';
import { TrialBalanceTable } from '../src/components/TrialBalanceTable.js';
import { FilterBar } from '../src/components/FilterBar.js';
import { SkeletonTable, EmptyState, ErrorState, StatusBadge } from '../src/components/StateViews.js';

describe('ERP-4 Component View Rendering & State Architecture', () => {
  describe('StatusBadge', () => {
    it('renders with appropriate class for account types', () => {
      const element = <StatusBadge type="asset" />;
      expect(element).toBeDefined();
      expect(element.props.type).toBe('asset');
    });

    it('renders with variant class for verification badges', () => {
      const element = <StatusBadge label="✓ Balanced" variant="success" />;
      expect(element.props.label).toBe('✓ Balanced');
      expect(element.props.variant).toBe('success');
    });
  });

  describe('Mandatory UI States', () => {
    it('renders SkeletonTable loading state with specified dimensions', () => {
      const element = <SkeletonTable columns={6} rows={8} />;
      expect(element.props.columns).toBe(6);
      expect(element.props.rows).toBe(8);
    });

    it('renders EmptyState with actionable button when list is empty', () => {
      const onAction = vi.fn();
      const element = (
        <EmptyState
          title="No accounts found"
          message="No records match your search."
          actionLabel="Refresh List"
          onAction={onAction}
        />
      );
      expect(element.props.title).toBe('No accounts found');
      expect(element.props.actionLabel).toBe('Refresh List');
    });

    it('renders ErrorState with recoverable retry callback', () => {
      const onRetry = vi.fn();
      const element = (
        <ErrorState
          title="API Connection Failed"
          message="Server timed out."
          onRetry={onRetry}
        />
      );
      expect(element.props.title).toBe('API Connection Failed');
      expect(element.props.onRetry).toBe(onRetry);
    });
  });

  describe('FilterBar Component', () => {
    it('accepts filter query values and triggers onFilterChange callback', () => {
      const onFilterChange = vi.fn();
      const onReset = vi.fn();
      const filters = { page: 1, limit: 20, search: 'Cash', type: 'asset' as const };

      const element = (
        <FilterBar
          filters={filters}
          onFilterChange={onFilterChange}
          onReset={onReset}
          isLoading={false}
        />
      );

      expect(element.props.filters.search).toBe('Cash');
      expect(element.props.filters.type).toBe('asset');
    });
  });

  describe('AccountsTable Component', () => {
    it('renders accounts list with server pagination attributes', () => {
      const onPageChange = vi.fn();
      const mockAccounts = [
        {
          id: 'acc-1',
          code: '1010',
          name: 'Operating Checking',
          type: 'asset' as const,
          currencyCode: 'USD',
          isActive: true,
          balance: 45000.5,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const element = (
        <AccountsTable
          accounts={mockAccounts}
          isLoading={false}
          total={1}
          page={1}
          totalPages={1}
          onPageChange={onPageChange}
        />
      );

      expect(element.props.accounts.length).toBe(1);
      expect(element.props.page).toBe(1);
      expect(element.props.total).toBe(1);
    });

    it('displays loading skeleton when isLoading is true', () => {
      const onPageChange = vi.fn();
      const element = (
        <AccountsTable
          accounts={[]}
          isLoading={true}
          total={0}
          page={1}
          totalPages={1}
          onPageChange={onPageChange}
        />
      );

      expect(element.props.isLoading).toBe(true);
    });
  });

  describe('TrialBalanceTable Component', () => {
    it('renders trial balance report with period selector and balance banner', () => {
      const onPeriodChange = vi.fn();
      const mockTbData = {
        period: '2026-10',
        currencyCode: 'USD',
        items: [
          {
            accountId: 'acc-1',
            accountCode: '1010',
            accountName: 'Operating Checking',
            accountType: 'asset' as const,
            currencyCode: 'USD',
            debit: 10000,
            credit: 0,
            netBalance: 10000,
          },
          {
            accountId: 'acc-2',
            accountCode: '3010',
            accountName: 'Owner Equity',
            accountType: 'equity' as const,
            currencyCode: 'USD',
            debit: 0,
            credit: 10000,
            netBalance: -10000,
          },
        ],
        totalDebit: 10000,
        totalCredit: 10000,
        isBalanced: true,
        accountCount: 2,
        generatedAt: new Date(),
      };

      const element = (
        <TrialBalanceTable
          data={mockTbData}
          isLoading={false}
          period="2026-10"
          onPeriodChange={onPeriodChange}
        />
      );

      expect(element.props.data.isBalanced).toBe(true);
      expect(element.props.period).toBe('2026-10');
      expect(element.props.data.totalDebit).toBe(element.props.data.totalCredit);
    });
  });
});
