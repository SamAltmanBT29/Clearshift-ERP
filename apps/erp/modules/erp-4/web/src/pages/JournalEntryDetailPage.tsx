import React, { useState, useEffect } from 'react';
import type { JournalEntry } from '@clearshift/contracts';
import {
  fetchJournalEntryById,
  postJournalEntry,
  reverseJournalEntry,
} from '../api/erp-4.js';
import { SkeletonTable, ErrorState, StatusBadge } from '../components/StateViews.js';

interface JournalEntryDetailPageProps {
  entryId: string;
  onBackToList: () => void;
}

export const JournalEntryDetailPage: React.FC<JournalEntryDetailPageProps> = ({
  entryId,
  onBackToList,
}) => {
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const loadEntry = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchJournalEntryById(entryId);
      setEntry(data);
    } catch (err: any) {
      setError(err?.message || `Failed to fetch journal entry ${entryId}.`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadEntry();
  }, [entryId]);

  const handlePost = async () => {
    if (!entry) return;
    const confirmed = window.confirm(
      `Confirm POSTING Journal Entry ${entry.entry_number || entry.id}? This will lock the entry permanently per double-entry rules.`
    );
    if (!confirmed) return;

    setIsProcessing(true);
    setActionMessage(null);
    try {
      const updated = await postJournalEntry(entry.id);
      setEntry(updated);
      setActionMessage('Journal entry was successfully posted and locked.');
    } catch (err: any) {
      alert(err?.message || 'Failed to post journal entry.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReverse = async () => {
    if (!entry) return;
    const confirmed = window.confirm(
      `Confirm REVERSAL of Journal Entry ${entry.entry_number || entry.id}? A new reversing journal entry will be created.`
    );
    if (!confirmed) return;

    setIsProcessing(true);
    setActionMessage(null);
    try {
      const reversed = await reverseJournalEntry(entry.id);
      setEntry(reversed);
      setActionMessage('Reversal journal entry was generated.');
    } catch (err: any) {
      alert(err?.message || 'Failed to reverse journal entry.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="cs-module-root">
        <SkeletonTable columns={5} rows={6} />
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="cs-module-root">
        <button
          type="button"
          className="cs-btn cs-btn-secondary cs-btn-sm"
          onClick={onBackToList}
          style={{ marginBottom: '16px' }}
        >
          ← Back to Financial Overview
        </button>
        <ErrorState
          title="Journal Entry Not Found"
          message={error || 'Could not find the requested record.'}
          onRetry={loadEntry}
        />
      </div>
    );
  }

  // Calculate totals from lines
  const totalDebit = entry.lines?.reduce(
    (sum, l) => sum + (parseFloat(l.debit_amount || '0') || 0),
    0
  ) || 0;
  const totalCredit = entry.lines?.reduce(
    (sum, l) => sum + (parseFloat(l.credit_amount || '0') || 0),
    0
  ) || 0;
  const difference = Math.abs(totalDebit - totalCredit);
  const isBalanced = difference === 0 && totalDebit > 0;

  return (
    <div className="cs-module-root" role="main" aria-label="Journal Entry Detail Screen">
      {/* Navigation Breadcrumb */}
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

      {/* Action Notification Message */}
      {actionMessage && (
        <div
          role="status"
          style={{
            background: 'var(--color-success-bg)',
            border: '1px solid var(--color-success-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: '20px',
            color: 'var(--color-success)',
            fontWeight: 600,
          }}
        >
          ✓ {actionMessage}
        </div>
      )}

      {/* Header with Title & Status Actions */}
      <header className="cs-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 className="cs-header-title" style={{ margin: 0 }}>
              Entry: {entry.entry_number || entry.id.substring(0, 8)}
            </h1>
            <StatusBadge
              type={entry.status}
              label={entry.status.toUpperCase()}
              variant={
                entry.status === 'posted'
                  ? 'success'
                  : entry.status === 'reversed'
                  ? 'error'
                  : 'muted'
              }
            />
          </div>
          <p className="cs-header-desc" style={{ marginTop: '6px' }}>
            {entry.description}
          </p>
        </div>

        {/* Action Buttons with confirmation */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {entry.status === 'draft' && (
            <button
              type="button"
              className="cs-btn cs-btn-primary"
              onClick={handlePost}
              disabled={isProcessing}
              aria-label="Post journal entry"
            >
              🔒 Post Entry (Lock)
            </button>
          )}

          {entry.status === 'posted' && (
            <button
              type="button"
              className="cs-btn cs-btn-danger"
              onClick={handleReverse}
              disabled={isProcessing}
              aria-label="Reverse journal entry"
            >
              ↩ Create Reversal Entry
            </button>
          )}

          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            onClick={loadEntry}
            disabled={isProcessing}
            aria-label="Refresh entry details"
          >
            Refresh
          </button>
        </div>
      </header>

      {/* Metadata Cards */}
      <section className="cs-stats-grid" aria-label="Entry summary metrics">
        <div className="cs-stat-card">
          <div className="cs-stat-label">Posting Date</div>
          <div className="cs-stat-value" style={{ fontSize: '18px' }}>
            {entry.posting_date}
          </div>
          <div className="cs-stat-sub">Period: {entry.period_id || 'Active'}</div>
        </div>

        <div className="cs-stat-card">
          <div className="cs-stat-label">Total Debits</div>
          <div className="cs-stat-value" style={{ color: 'var(--color-primary)', fontSize: '18px' }}>
            {entry.currency_code} {totalDebit.toFixed(2)}
          </div>
          <div className="cs-stat-sub">Verified currency precision</div>
        </div>

        <div className="cs-stat-card">
          <div className="cs-stat-label">Total Credits</div>
          <div className="cs-stat-value" style={{ color: 'var(--color-primary)', fontSize: '18px' }}>
            {entry.currency_code} {totalCredit.toFixed(2)}
          </div>
          <div className="cs-stat-sub">Verified currency precision</div>
        </div>

        <div className="cs-stat-card">
          <div className="cs-stat-label">Double-Entry Status</div>
          <div className="cs-stat-value" style={{ fontSize: '18px' }}>
            <StatusBadge
              label={isBalanced ? '✓ Balanced' : '✗ Unbalanced'}
              variant={isBalanced ? 'success' : 'error'}
            />
          </div>
          <div className="cs-stat-sub">Invariant: BR-ERP4-01</div>
        </div>
      </section>

      {/* Lines Table View */}
      <div className="cs-table-container">
        <table className="cs-table" aria-label="Journal Lines Table">
          <thead>
            <tr className="cs-tr">
              <th className="cs-th">Line ID</th>
              <th className="cs-th">Account ID / Code</th>
              <th className="cs-th">Narration</th>
              <th className="cs-th cs-text-right">Debit ({entry.currency_code})</th>
              <th className="cs-th cs-text-right">Credit ({entry.currency_code})</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines?.map((line, idx) => {
              const d = parseFloat(line.debit_amount || '0') || 0;
              const c = parseFloat(line.credit_amount || '0') || 0;
              return (
                <tr key={line.id || idx} className="cs-tr">
                  <td className="cs-td">
                    <span className="cs-code" style={{ fontSize: '12px' }}>
                      #{idx + 1}
                    </span>
                  </td>
                  <td className="cs-td">
                    <span className="cs-code">{line.account_id}</span>
                  </td>
                  <td className="cs-td">
                    {line.line_narration || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                  </td>
                  <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                    {d > 0 ? d.toFixed(2) : '—'}
                  </td>
                  <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                    {c > 0 ? c.toFixed(2) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr
              className="cs-tr"
              style={{
                backgroundColor: 'var(--color-surface)',
                fontWeight: 700,
                borderTop: '2px solid var(--border-subtle)',
              }}
            >
              <td className="cs-td" colSpan={3}>
                Grand Total ({entry.lines?.length || 0} lines)
              </td>
              <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                {totalDebit.toFixed(2)}
              </td>
              <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                {totalCredit.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export default JournalEntryDetailPage;
