import React from 'react';
import type { TrialBalanceResponse } from '@clearshift/contracts';
import { StatusBadge, SkeletonTable, EmptyState } from './StateViews.js';

interface TrialBalanceTableProps {
  data: TrialBalanceResponse | null;
  isLoading: boolean;
  period: string;
  onPeriodChange: (newPeriod: string) => void;
  onRefresh?: () => void;
}

export const TrialBalanceTable: React.FC<TrialBalanceTableProps> = ({
  data,
  isLoading,
  period,
  onPeriodChange,
  onRefresh,
}) => {
  if (isLoading) {
    return <SkeletonTable columns={6} rows={6} />;
  }

  if (!data || data.items.length === 0) {
    return (
      <div>
        <div className="cs-filter-bar" role="search" aria-label="Trial balance period selector">
          <label htmlFor="tb-period-select" style={{ fontSize: '13px', fontWeight: 600 }}>
            Accounting Period:
          </label>
          <input
            id="tb-period-select"
            type="month"
            className="cs-input"
            value={period}
            onChange={(e) => onPeriodChange(e.target.value)}
            aria-label="Accounting Period"
          />
        </div>
        <EmptyState
          title="No trial balance records"
          message={`No accounting transactions or balances have been recorded for period ${period}.`}
          actionLabel={onRefresh ? 'Re-calculate Period' : undefined}
          onAction={onRefresh}
        />
      </div>
    );
  }

  const difference = Math.abs(data.totalDebit - data.totalCredit);

  return (
    <div>
      {/* Period & Controls Filter Bar */}
      <div className="cs-filter-bar" role="search" aria-label="Trial balance controls">
        <label htmlFor="tb-period-input" style={{ fontSize: '13px', fontWeight: 600 }}>
          Accounting Period:
        </label>
        <input
          id="tb-period-input"
          type="month"
          className="cs-input"
          value={period}
          onChange={(e) => onPeriodChange(e.target.value)}
          aria-label="Accounting Period"
        />
        {onRefresh && (
          <button
            type="button"
            className="cs-btn cs-btn-secondary cs-btn-sm"
            onClick={onRefresh}
            aria-label="Refresh trial balance data"
          >
            Refresh Report
          </button>
        )}
      </div>

      {/* Trial Balance Health & Invariant Verification Banner */}
      <div className="cs-balance-banner" role="region" aria-label="Trial balance summary">
        <div className="cs-balance-totals">
          <div>
            <div className="cs-balance-item-title">Total Debits</div>
            <div className="cs-balance-item-val" style={{ color: 'var(--color-primary)' }}>
              {data.currencyCode}{' '}
              {data.totalDebit.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>
          <div>
            <div className="cs-balance-item-title">Total Credits</div>
            <div className="cs-balance-item-val" style={{ color: 'var(--color-primary)' }}>
              {data.currencyCode}{' '}
              {data.totalCredit.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>
          <div>
            <div className="cs-balance-item-title">Variance / Difference</div>
            <div
              className="cs-balance-item-val"
              style={{
                color: difference === 0 ? 'var(--color-success)' : 'var(--color-error)',
              }}
            >
              {data.currencyCode}{' '}
              {difference.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>
        </div>

        <div>
          <StatusBadge
            label={data.isBalanced ? '✓ Invariant Verified: Balanced' : '✗ Unbalanced Entries'}
            variant={data.isBalanced ? 'success' : 'error'}
          />
        </div>
      </div>

      {/* Trial Balance Table */}
      <div className="cs-table-container">
        <table className="cs-table" aria-label="Trial Balance Sheet">
          <thead>
            <tr className="cs-tr">
              <th className="cs-th" scope="col">Code</th>
              <th className="cs-th" scope="col">Account Name</th>
              <th className="cs-th" scope="col">Category</th>
              <th className="cs-th cs-text-right" scope="col">Debit ({data.currencyCode})</th>
              <th className="cs-th cs-text-right" scope="col">Credit ({data.currencyCode})</th>
              <th className="cs-th cs-text-right" scope="col">Net Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr key={row.accountId} className="cs-tr">
                <td className="cs-td">
                  <span className="cs-code">{row.accountCode}</span>
                </td>
                <td className="cs-td" style={{ fontWeight: 600 }}>
                  {row.accountName}
                </td>
                <td className="cs-td">
                  <StatusBadge type={row.accountType} />
                </td>
                <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                  {row.debit > 0
                    ? row.debit.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : '—'}
                </td>
                <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                  {row.credit > 0
                    ? row.credit.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : '—'}
                </td>
                <td
                  className="cs-td cs-text-right"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    color: row.netBalance < 0 ? 'var(--color-error)' : 'var(--color-text)',
                  }}
                >
                  {row.netBalance.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>
              </tr>
            ))}
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
                Grand Total ({data.accountCount} active accounts)
              </td>
              <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                {data.totalDebit.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </td>
              <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                {data.totalCredit.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </td>
              <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                {difference === 0 ? '0.00' : difference.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
