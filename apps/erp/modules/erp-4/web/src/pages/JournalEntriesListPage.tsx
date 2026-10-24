/**
 * ERP-4 Finance and Accounting — Journal Entries List Page
 *
 * Route: `/erp4/journal-entries`
 *
 * @module erp4/web/pages/JournalEntriesListPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import { PageTitle } from '@cs/ui';
import { Link, useNavigate } from 'react-router-dom';
import type { JournalEntry } from '@clearshift/contracts';
import { fetchJournalEntries } from '../api/erp-4.js';
import { ErrorState, EmptyState, SkeletonTable, StatusBadge } from '../components/StateViews.js';

export const JournalEntriesListPage: React.FC = () => {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJournalEntries = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchJournalEntries({ page, limit });
      setEntries(response.items || []);
      setTotal(response.total || 0);
    } catch (err: any) {
      setError(err?.message || 'Failed to load journal entries');
    } finally {
      setIsLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    loadJournalEntries();
  }, [loadJournalEntries]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="cs-page-container">
      <PageTitle
        title="Journal Entries"
        subtitle="Double-entry transaction ledger with immutable audit trail and balance enforcement"
        actions={
          <Link
            to="/erp4/journal-entries/new"
            className="cs-button cs-button-primary"
            role="button"
          >
            + New Journal Entry
          </Link>
        }
      />

      {error ? (
        <ErrorState
          title="Error Loading Journal Entries"
          message={error}
          onRetry={loadJournalEntries}
        />
      ) : isLoading ? (
        <SkeletonTable columns={6} rows={6} />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No Journal Entries"
          message="No journal entries recorded for the current ledger. Create your first balanced entry to begin."
          actionLabel="Create Journal Entry"
          onAction={() => navigate('/erp4/journal-entries/new')}
        />
      ) : (
        <div className="cs-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="cs-table" aria-label="Journal Entries">
            <thead>
              <tr>
                <th scope="col">Entry Number</th>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col">Period</th>
                <th scope="col">Status</th>
                <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                    <Link
                      to={`/erp4/journal-entries/${entry.id}`}
                      className="cs-link"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {entry.entry_number || (entry as any).entryNumber || entry.id}
                    </Link>
                  </td>
                  <td>{entry.posting_date || (entry as any).entryDate || '—'}</td>
                  <td>{entry.description || '—'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{entry.currency_code || (entry as any).period || 'USD'}</td>
                  <td>
                    <StatusBadge status={entry.status} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link
                      to={`/erp4/journal-entries/${entry.id}`}
                      className="cs-button cs-button-secondary"
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div
              className="cs-pagination"
              role="navigation"
              aria-label="Journal Entries Pagination"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                Page {page} of {totalPages} ({total} entries)
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="cs-button cs-button-secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="cs-button cs-button-secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default JournalEntriesListPage;
