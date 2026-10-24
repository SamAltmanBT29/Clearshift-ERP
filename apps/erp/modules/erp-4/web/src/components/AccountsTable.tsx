import React from 'react';
import type { Account } from '@clearshift/contracts';
import { StatusBadge, SkeletonTable, EmptyState } from './StateViews.js';

interface AccountsTableProps {
  accounts: Account[];
  isLoading: boolean;
  total: number;
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onRefresh?: () => void;
}

export const AccountsTable: React.FC<AccountsTableProps> = ({
  accounts,
  isLoading,
  total,
  page,
  totalPages,
  onPageChange,
  onRefresh,
}) => {
  if (isLoading) {
    return <SkeletonTable columns={6} rows={8} />;
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No accounts found"
        message="No accounts match your current filter selection or search query."
        actionLabel={onRefresh ? 'Refresh Accounts' : undefined}
        onAction={onRefresh}
      />
    );
  }

  return (
    <div>
      <div className="cs-table-container">
        <table className="cs-table" aria-label="Chart of Accounts">
          <thead>
            <tr className="cs-tr">
              <th className="cs-th" scope="col">Account Code</th>
              <th className="cs-th" scope="col">Account Name</th>
              <th className="cs-th" scope="col">Type</th>
              <th className="cs-th" scope="col">Currency</th>
              <th className="cs-th cs-text-right" scope="col">Balance</th>
              <th className="cs-th" scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((acc) => (
              <tr key={acc.id} className="cs-tr">
                <td className="cs-td">
                  <span className="cs-code">{acc.code}</span>
                </td>
                <td className="cs-td">
                  <div style={{ fontWeight: 600 }}>{acc.name}</div>
                  {acc.description && (
                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                      {acc.description}
                    </div>
                  )}
                </td>
                <td className="cs-td">
                  <StatusBadge type={acc.type} />
                </td>
                <td className="cs-td">
                  <span className="cs-code">{acc.currency_code || (acc as any).currencyCode || 'USD'}</span>
                </td>
                <td className="cs-td cs-text-right">
                  <span
                    style={{
                      fontWeight: 600,
                      fontFamily: 'var(--font-mono)',
                      color: Number((acc as any).balance ?? (acc as any).currentBalance ?? 0) < 0 ? 'var(--color-error)' : 'var(--color-text)',
                    }}
                  >
                    {Number((acc as any).balance ?? (acc as any).currentBalance ?? 0).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </td>
                <td className="cs-td">
                  <StatusBadge
                    label={(acc.is_active ?? (acc as any).isActive ?? true) ? 'Active' : 'Archived'}
                    variant={(acc.is_active ?? (acc as any).isActive ?? true) ? 'success' : 'muted'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Server-Side Pagination Bar */}
      <div className="cs-pagination-bar" role="navigation" aria-label="Pagination Navigation">
        <div>
          Showing page <strong>{page}</strong> of <strong>{totalPages || 1}</strong> (<strong>{total}</strong> total accounts)
        </div>
        <div className="cs-pagination-actions">
          <button
            type="button"
            className="cs-btn cs-btn-secondary cs-btn-sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || isLoading}
            aria-label="Go to previous page"
          >
            &larr; Previous
          </button>
          <button
            type="button"
            className="cs-btn cs-btn-secondary cs-btn-sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || isLoading}
            aria-label="Go to next page"
          >
            Next &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};
