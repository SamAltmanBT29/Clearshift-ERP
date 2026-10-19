import React, { useState, useEffect, useCallback } from 'react';
import type {
  Account,
  AccountsFilterQuery,
  TrialBalanceResponse,
} from '@clearshift/contracts';
import { fetchAccounts, fetchTrialBalance } from '../api/erp-4.js';
import { AccountsTable } from '../components/AccountsTable.js';
import { TrialBalanceTable } from '../components/TrialBalanceTable.js';
import { FilterBar } from '../components/FilterBar.js';
import { ErrorState, EmptyState } from '../components/StateViews.js';

export const AccountsListPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'accounts' | 'trial-balance'>('accounts');

  // Accounts List State
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsTotal, setAccountsTotal] = useState(0);
  const [accountsTotalPages, setAccountsTotalPages] = useState(1);
  const [isAccountsLoading, setIsAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [filters, setFilters] = useState<AccountsFilterQuery>({
    page: 1,
    limit: 20,
    search: '',
    type: undefined,
    isActive: undefined,
  });

  // Trial Balance State
  const [period, setPeriod] = useState<string>(() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${month}`;
  });
  const [trialBalanceData, setTrialBalanceData] = useState<TrialBalanceResponse | null>(null);
  const [isTbLoading, setIsTbLoading] = useState(false);
  const [tbError, setTbError] = useState<string | null>(null);

  // Fetch Accounts from real API
  const loadAccounts = useCallback(async (currentFilters: AccountsFilterQuery) => {
    setIsAccountsLoading(true);
    setAccountsError(null);
    try {
      const response = await fetchAccounts(currentFilters);
      setAccounts(response.items);
      setAccountsTotal(response.total);
      setAccountsTotalPages(response.totalPages);
    } catch (err: any) {
      setAccountsError(err?.message || 'Failed to fetch chart of accounts');
    } finally {
      setIsAccountsLoading(false);
    }
  }, []);

  // Fetch Trial Balance from real API
  const loadTrialBalance = useCallback(async (currentPeriod: string) => {
    setIsTbLoading(true);
    setTbError(null);
    try {
      const response = await fetchTrialBalance(currentPeriod);
      setTrialBalanceData(response);
    } catch (err: any) {
      setTbError(err?.message || 'Failed to fetch trial balance report');
    } finally {
      setIsTbLoading(false);
    }
  }, []);

  // Trigger accounts fetch on filter or page change
  useEffect(() => {
    if (activeTab === 'accounts') {
      loadAccounts(filters);
    }
  }, [filters, activeTab, loadAccounts]);

  // Trigger trial balance fetch on period change
  useEffect(() => {
    if (activeTab === 'trial-balance') {
      loadTrialBalance(period);
    }
  }, [period, activeTab, loadTrialBalance]);

  // Handle filter changes (strictly resets to page 1 as mandated by acceptance criteria)
  const handleFilterChange = (updated: Partial<AccountsFilterQuery>) => {
    setFilters((prev) => ({
      ...prev,
      ...updated,
      page: 1, // Reset pagination to page 1 on search or filter change
    }));
  };

  const handleResetFilters = () => {
    setFilters({
      page: 1,
      limit: 20,
      search: '',
      type: undefined,
      isActive: undefined,
    });
  };

  const handlePageChange = (newPage: number) => {
    setFilters((prev) => ({
      ...prev,
      page: newPage,
    }));
  };

  // Derive high-level stats
  const assetCount = accounts.filter((a) => a.type === 'asset').length;
  const liabilityCount = accounts.filter((a) => a.type === 'liability').length;

  return (
    <div className="cs-module-root">
      {/* Module Title & Header */}
      <header className="cs-header">
        <h1 className="cs-header-title">Finance & Accounting (ERP-4)</h1>
        <p className="cs-header-desc">
          General Ledger, Chart of Accounts, and Period-End Trial Balance Verification.
        </p>
      </header>

      {/* Top Level Metric Summary Tiles */}
      <section className="cs-stats-grid" aria-label="Financial Overview Metrics">
        <div className="cs-stat-card">
          <div className="cs-stat-label">Total Accounts</div>
          <div className="cs-stat-value">{accountsTotal}</div>
          <div className="cs-stat-sub">Across all 5 categories</div>
        </div>
        <div className="cs-stat-card">
          <div className="cs-stat-label">Asset Accounts</div>
          <div className="cs-stat-value" style={{ color: 'var(--color-success)' }}>
            {assetCount}
          </div>
          <div className="cs-stat-sub">Current & Fixed Assets</div>
        </div>
        <div className="cs-stat-card">
          <div className="cs-stat-label">Liabilities</div>
          <div className="cs-stat-value" style={{ color: 'var(--color-error)' }}>
            {liabilityCount}
          </div>
          <div className="cs-stat-sub">Payables & Obligations</div>
        </div>
        <div className="cs-stat-card">
          <div className="cs-stat-label">Ledger Integrity</div>
          <div className="cs-stat-value" style={{ color: 'var(--color-primary)' }}>
            Double-Entry
          </div>
          <div className="cs-stat-sub">Balanced GL Invariant</div>
        </div>
      </section>

      {/* Navigation Tabs */}
      <nav className="cs-tabs" role="tablist" aria-label="Finance navigation views">
        <button
          type="button"
          role="tab"
          id="tab-accounts"
          aria-selected={activeTab === 'accounts'}
          aria-controls="panel-accounts"
          className={`cs-tab-btn ${activeTab === 'accounts' ? 'active' : ''}`}
          onClick={() => setActiveTab('accounts')}
        >
          Chart of Accounts
        </button>
        <button
          type="button"
          role="tab"
          id="tab-trial-balance"
          aria-selected={activeTab === 'trial-balance'}
          aria-controls="panel-trial-balance"
          className={`cs-tab-btn ${activeTab === 'trial-balance' ? 'active' : ''}`}
          onClick={() => setActiveTab('trial-balance')}
        >
          Trial Balance View
        </button>
      </nav>

      {/* Tab Panels */}
      {activeTab === 'accounts' && (
        <section id="panel-accounts" role="tabpanel" aria-labelledby="tab-accounts">
          <FilterBar
            filters={filters}
            onFilterChange={handleFilterChange}
            onReset={handleResetFilters}
            isLoading={isAccountsLoading}
          />

          {accountsError ? (
            <ErrorState
              title="Unable to load Chart of Accounts"
              message={accountsError}
              onRetry={() => loadAccounts(filters)}
            />
          ) : (
            <AccountsTable
              accounts={accounts}
              isLoading={isAccountsLoading}
              total={accountsTotal}
              page={filters.page || 1}
              totalPages={accountsTotalPages}
              onPageChange={handlePageChange}
              onRefresh={() => loadAccounts(filters)}
            />
          )}
        </section>
      )}

      {activeTab === 'trial-balance' && (
        <section id="panel-trial-balance" role="tabpanel" aria-labelledby="tab-trial-balance">
          {tbError ? (
            <ErrorState
              title="Unable to generate Trial Balance"
              message={tbError}
              onRetry={() => loadTrialBalance(period)}
            />
          ) : (
            <TrialBalanceTable
              data={trialBalanceData}
              isLoading={isTbLoading}
              period={period}
              onPeriodChange={setPeriod}
              onRefresh={() => loadTrialBalance(period)}
            />
          )}
        </section>
      )}
    </div>
  );
};

export default AccountsListPage;
