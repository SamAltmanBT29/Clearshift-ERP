import React, { useState, useEffect } from 'react';
import type { Account, JournalEntry } from '@clearshift/contracts';
import { fetchAccounts } from '../api/erp-4.js';
import { JournalEntryForm } from '../components/forms/JournalEntryForm.js';
import { AccountCreateModal } from '../components/forms/AccountCreateModal.js';
import { SkeletonTable, ErrorState, StatusBadge } from '../components/StateViews.js';

interface JournalEntryFormPageProps {
  onBackToList: () => void;
  onViewEntryDetail?: (entryId: string) => void;
}

export const JournalEntryFormPage: React.FC<JournalEntryFormPageProps> = ({
  onBackToList,
  onViewEntryDetail,
}) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [createdEntry, setCreatedEntry] = useState<JournalEntry | null>(null);
  const [successAction, setSuccessAction] = useState<'draft' | 'posted' | null>(null);

  const loadAccounts = async () => {
    setIsLoadingAccounts(true);
    setAccountsError(null);
    try {
      const res = await fetchAccounts({ page: 1, limit: 100, isActive: true });
      setAccounts(res.items);
    } catch (err: any) {
      setAccountsError(err?.message || 'Failed to load chart of accounts for entry form.');
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleAccountCreated = (newAcc: Account) => {
    setAccounts((prev) => [newAcc, ...prev]);
  };

  const handleFormSuccess = (entry: JournalEntry, action: 'draft' | 'posted') => {
    setCreatedEntry(entry);
    setSuccessAction(action);
  };

  return (
    <div className="cs-module-root" role="main" aria-label="Journal Entry Creation Screen">
      {/* Navigation Breadcrumb Context */}
      <nav aria-label="Breadcrumb" style={{ marginBottom: '16px' }}>
        <button
          type="button"
          className="cs-btn cs-btn-secondary cs-btn-sm"
          onClick={onBackToList}
          aria-label="Back to accounts list"
        >
          ← Back to Financial Overview
        </button>
      </nav>

      {/* Success Notification Banner */}
      {createdEntry && (
        <div
          role="status"
          style={{
            background: 'var(--color-success-bg)',
            border: '1px solid var(--color-success-border)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            marginBottom: '24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: 'var(--color-success)', fontSize: '16px' }}>
              ✓ Journal Entry {createdEntry.entry_number || createdEntry.id} Successfully{' '}
              {successAction === 'posted' ? 'Posted & Locked' : 'Saved as Draft'}!
            </div>
            <div style={{ fontSize: '13px', color: 'var(--color-text)', marginTop: '2px' }}>
              {createdEntry.description} — Total Balanced Lines:{' '}
              {createdEntry.lines?.length || 2}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {onViewEntryDetail && (
              <button
                type="button"
                className="cs-btn cs-btn-primary cs-btn-sm"
                onClick={() => onViewEntryDetail(createdEntry.id)}
              >
                View Entry Details →
              </button>
            )}
            <button
              type="button"
              className="cs-btn cs-btn-secondary cs-btn-sm"
              onClick={onBackToList}
            >
              Return to Ledger List
            </button>
          </div>
        </div>
      )}

      {/* Loading or Error Boundary */}
      {isLoadingAccounts ? (
        <SkeletonTable columns={4} rows={6} />
      ) : accountsError ? (
        <ErrorState
          title="Could not prepare Journal Form"
          message={accountsError}
          onRetry={loadAccounts}
        />
      ) : (
        <JournalEntryForm
          accounts={accounts}
          onSuccess={handleFormSuccess}
          onCancel={onBackToList}
          onOpenCreateAccount={() => setIsAccountModalOpen(true)}
        />
      )}

      {/* Quick Account Creation Modal */}
      <AccountCreateModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        onSuccess={handleAccountCreated}
      />
    </div>
  );
};

export default JournalEntryFormPage;
