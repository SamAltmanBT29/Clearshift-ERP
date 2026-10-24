import React, { useState, useEffect, useCallback } from 'react';
import type {
  Account,
  AccountsFilterQuery,
  TrialBalanceResponse,
  JournalEntry,
} from '@clearshift/contracts';
import { fetchAccounts, fetchTrialBalance, fetchJournalEntries } from '../api/erp-4.js';
import { AccountsTable } from '../components/AccountsTable.js';
import { TrialBalanceTable } from '../components/TrialBalanceTable.js';
import { FilterBar } from '../components/FilterBar.js';
import { ErrorState, EmptyState, SkeletonTable, StatusBadge } from '../components/StateViews.js';
import { JournalEntryFormPage } from './JournalEntryFormPage.js';
import { JournalEntryDetailPage } from './JournalEntryDetailPage.js';
import { AccountCreateModal } from '../components/forms/AccountCreateModal.js';

export const AccountsListPage: React.FC = () => {
  const [currentView, setCurrentView] = useState<'list' | 'create-journal' | 'detail-journal'>('list');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'accounts' | 'trial-balance' | 'journal-entries'>('accounts');

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

  // Journal Entries State
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [isEntriesLoading, setIsEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [entriesTotal, setEntriesTotal] = useState(0);

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

  // Fetch Journal Entries from real API
  const loadJournalEntries = useCallback(async () => {
    setIsEntriesLoading(true);
    setEntriesError(null);
    try {
      const response = await fetchJournalEntries({ page: 1, limit: 20 });
      setJournalEntries(response.items || (response as any).data || []);
      setEntriesTotal(response.total || 0);
    } catch (err: any) {
      setEntriesError(err?.message || 'Failed to fetch journal entries');
    } finally {
      setIsEntriesLoading(false);
    }
  }, []);

  // Trigger accounts fetch on filter or page change
  useEffect(() => {
    if (activeTab === 'accounts' && currentView === 'list') {
      loadAccounts(filters);
    }
  }, [filters, activeTab, currentView, loadAccounts]);

  // Trigger trial balance fetch on period change
  useEffect(() => {
    if (activeTab === 'trial-balance' && currentView === 'list') {
      loadTrialBalance(period);
    }
  }, [period, activeTab, currentView, loadTrialBalance]);

  // Trigger journal entries fetch on tab change
  useEffect(() => {
    if (activeTab === 'journal-entries' && currentView === 'list') {
      loadJournalEntries();
    }
  }, [activeTab, currentView, loadJournalEntries]);

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

  // Switch to detail view for a specific journal entry
  const handleViewDetail = (id: string) => {
    setSelectedEntryId(id);
    setCurrentView('detail-journal');
  };

  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);

  // Derive high-level stats
  const assetCount = accounts.filter((a) => a.type === 'asset').length;
  const liabilityCount = accounts.filter((a) => a.type === 'liability').length;

  // Render Form Page View
  if (currentView === 'create-journal') {
    return (
      <JournalEntryFormPage
        onBackToList={() => {
          setCurrentView('list');
          if (activeTab === 'journal-entries') loadJournalEntries();
        }}
        onViewEntryDetail={(id) => {
          setSelectedEntryId(id);
          setCurrentView('detail-journal');
        }}
      />
    );
  }

  // Render Detail Page View
  if (currentView === 'detail-journal' && selectedEntryId) {
    return (
      <JournalEntryDetailPage
        entryId={selectedEntryId}
        onBackToList={() => {
          setCurrentView('list');
          if (activeTab === 'journal-entries') loadJournalEntries();
        }}
      />
    );
  }

  return (
    <div className="cs-module-root">
      {/* Module Title & Header */}
      <header className="cs-header">
        <div>
          <h1 className="cs-header-title">Finance & Accounting (ERP-4)</h1>
          <p className="cs-header-desc">
            General Ledger, Chart of Accounts, Journal Entries, and Period-End Trial Balance Verification.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={() => setIsAccountModalOpen(true)}
            aria-label="Create new account"
          >
            + New Account
          </button>
          <button
            type="button"
            className="cs-btn cs-btn-primary"
            onClick={() => setCurrentView('create-journal')}
            aria-label="Create new journal entry"
          >
            + New Journal Entry
          </button>
        </div>
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
        <button
          type="button"
          role="tab"
          id="tab-journal-entries"
          aria-selected={activeTab === 'journal-entries'}
          aria-controls="panel-journal-entries"
          className={`cs-tab-btn ${activeTab === 'journal-entries' ? 'active' : ''}`}
          onClick={() => setActiveTab('journal-entries')}
        >
          Journal Entries
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

      {activeTab === 'journal-entries' && (
        <section id="panel-journal-entries" role="tabpanel" aria-labelledby="tab-journal-entries">
          {entriesError ? (
            <ErrorState
              title="Unable to load journal entries"
              message={entriesError}
              onRetry={loadJournalEntries}
            />
          ) : isEntriesLoading ? (
            <SkeletonTable columns={6} rows={6} />
          ) : journalEntries.length === 0 ? (
            <EmptyState
              icon="📄"
              title="No journal entries found"
              message="No journal entries recorded. Create your first double-entry transaction."
              actionLabel="+ New Journal Entry"
              onAction={() => setCurrentView('create-journal')}
            />
          ) : (
            <div className="cs-table-container">
              <table className="cs-table" aria-label="Journal Entries Directory">
                <thead>
                  <tr className="cs-tr">
                    <th className="cs-th">Entry #</th>
                    <th className="cs-th">Posting Date</th>
                    <th className="cs-th">Period</th>
                    <th className="cs-th">Currency</th>
                    <th className="cs-th">Description</th>
                    <th className="cs-th">Status</th>
                    <th className="cs-th cs-text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {journalEntries.map((entry) => (
                    <tr key={entry.id} className="cs-tr">
                      <td className="cs-td">
                        <span className="cs-code" style={{ fontWeight: 600 }}>
                          {entry.entry_number || entry.id.substring(0, 8)}
                        </span>
                      </td>
                      <td className="cs-td">{entry.posting_date}</td>
                      <td className="cs-td">
                        <span className="cs-code">{entry.period_id || 'Active'}</span>
                      </td>
                      <td className="cs-td">{entry.currency_code}</td>
                      <td className="cs-td">{entry.description}</td>
                      <td className="cs-td">
                        <StatusBadge
                          label={entry.status.toUpperCase()}
                          variant={
                            entry.status === 'posted'
                              ? 'success'
                              : entry.status === 'reversed'
                              ? 'error'
                              : 'muted'
                          }
                        />
                      </td>
                      <td className="cs-td cs-text-right">
                        <button
                          type="button"
                          className="cs-btn cs-btn-secondary cs-btn-sm"
                          onClick={() => handleViewDetail(entry.id)}
                          aria-label={`View entry ${entry.entry_number || entry.id}`}
                        >
                          View Details →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {/* Quick Account Creation Modal */}
      <AccountCreateModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        onSuccess={(newAcc) => {
          setIsAccountModalOpen(false);
          setAccounts((prev) => [newAcc, ...prev]);
          setAccountsTotal((prev) => prev + 1);
        }}
      />
    </div>
  );
};

export default AccountsListPage;
