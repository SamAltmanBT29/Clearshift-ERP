import React from 'react';
import type { TrialBalanceResponse } from '@clearshift/contracts';
import type { NormalizedTrialBalanceResponse } from '../api/erp-4.js';
import { StatusBadge, SkeletonTable, EmptyState } from './StateViews.js';

interface TrialBalanceTableProps {
  data: NormalizedTrialBalanceResponse | TrialBalanceResponse | null;
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

  const items = (data as any)?.items || (data as any)?.rows || [];

  if (!data || items.length === 0) {
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

  const d = data as any;
  const totalDebit = Number(d.totalDebit ?? d.totals?.total_debit ?? 0);
  const totalCredit = Number(d.totalCredit ?? d.totals?.total_credit ?? 0);
  const difference = Math.abs(totalDebit - totalCredit);
  const isBalanced = d.isBalanced ?? d.totals?.is_balanced ?? (totalDebit === totalCredit);
  const currencyCode = d.currencyCode || d.currency_code || 'USD';
  const accountCount = d.accountCount ?? items.length;

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
              {currencyCode}{' '}
              {totalDebit.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>
          <div>
            <div className="cs-balance-item-title">Total Credits</div>
            <div className="cs-balance-item-val" style={{ color: 'var(--color-primary)' }}>
              {currencyCode}{' '}
              {totalCredit.toLocaleString('en-US', {
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
              {currencyCode}{' '}
              {difference.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>
        </div>

        <div>
          <StatusBadge
            label={isBalanced ? '✓ Invariant Verified: Balanced' : '✗ Unbalanced Entries'}
            variant={isBalanced ? 'success' : 'error'}
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
              <th className="cs-th cs-text-right" scope="col">Debit ({currencyCode})</th>
              <th className="cs-th cs-text-right" scope="col">Credit ({currencyCode})</th>
              <th className="cs-th cs-text-right" scope="col">Net Balance</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row: any) => {
              const accountId = row.accountId || row.account_id || '';
              const accountCode = row.accountCode || row.account_code || '';
              const accountName = row.accountName || row.account_name || '';
              const accountType = row.accountType || row.account_type || 'asset';
              const debit = Number(row.debit ?? row.total_debit ?? 0);
              const credit = Number(row.credit ?? row.total_credit ?? 0);
              const netBalance = Number(row.netBalance ?? row.net_balance ?? 0);

              return (
                <tr key={accountId} className="cs-tr">
                  <td className="cs-td">
                    <span className="cs-code">{accountCode}</span>
                  </td>
                  <td className="cs-td" style={{ fontWeight: 600 }}>
                    {accountName}
                  </td>
                  <td className="cs-td">
                    <StatusBadge type={accountType} />
                  </td>
                  <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                    {debit > 0
                      ? debit.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })
                      : '—'}
                  </td>
                  <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                    {credit > 0
                      ? credit.toLocaleString('en-US', {
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
                      color: netBalance < 0 ? 'var(--color-error)' : 'var(--color-text)',
                    }}
                  >
                    {netBalance.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
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
                Grand Total ({accountCount} active accounts)
              </td>
              <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                {totalDebit.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </td>
              <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                {totalCredit.toLocaleString('en-US', {
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
