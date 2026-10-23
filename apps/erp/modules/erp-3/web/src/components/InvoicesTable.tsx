import React from 'react';
import type { Invoice } from '@clearshift/contracts';
import { StatusBadge, SkeletonTable, EmptyState } from './StateViews.js';

interface InvoicesTableProps {
  invoices: Invoice[];
  isLoading: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onRefresh?: () => void;
  onSelectInvoice?: (invoice: Invoice) => void;
}

export const InvoicesTable: React.FC<InvoicesTableProps> = ({
  invoices,
  isLoading,
  total,
  page,
  pageSize,
  totalPages,
  onPageChange,
  onRefresh,
  onSelectInvoice,
}) => {
  if (isLoading) {
    return <SkeletonTable columns={8} rows={6} />;
  }

  if (invoices.length === 0) {
    return (
      <EmptyState
        title="No invoices found"
        message="No invoices match your current filter selection or search query."
        actionLabel={onRefresh ? 'Clear Filters & Reload' : undefined}
        onAction={onRefresh}
      />
    );
  }

  const startRecord = (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  return (
    <div className="cs-table-card">
      <div style={{ overflowX: 'auto' }}>
        <table className="cs-table" aria-label="Invoices Table">
          <thead>
            <tr>
              <th scope="col">Invoice #</th>
              <th scope="col">Order ID</th>
              <th scope="col">Customer Golden ID</th>
              <th scope="col">Issue Date</th>
              <th scope="col">Due Date</th>
              <th scope="col">Status</th>
              <th scope="col" style={{ textAlign: 'right' }}>Total</th>
              <th scope="col" style={{ textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <span className="cs-mono" style={{ fontWeight: 600 }}>
                    {inv.invoiceNumber}
                  </span>
                </td>
                <td>
                  <span className="cs-mono">{inv.orderId}</span>
                </td>
                <td>
                  <span className="cs-mono">{inv.customerGoldenId}</span>
                </td>
                <td>{inv.invoiceDate}</td>
                <td>
                  <span style={inv.status === 'overdue' ? { color: 'var(--color-error)', fontWeight: 600 } : undefined}>
                    {inv.dueDate}
                  </span>
                </td>
                <td>
                  <StatusBadge status={inv.status} />
                </td>
                <td style={{ textAlign: 'right' }} className="cs-mono">
                  <span style={{ fontWeight: 600 }}>
                    {parseFloat(inv.total).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    {inv.currencyCode}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    className="cs-btn-secondary"
                    style={{ padding: '2px 8px', fontSize: '12px' }}
                    onClick={() => onSelectInvoice && onSelectInvoice(inv)}
                    aria-label={`View invoice ${inv.invoiceNumber}`}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav
        className="cs-pagination-bar"
        aria-label="Invoices Pagination"
      >
        <div>
          Showing <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{startRecord}</span> to{' '}
          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{endRecord}</span> of{' '}
          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{total}</span> invoices
        </div>

        <div className="cs-pagination-controls">
          <button
            type="button"
            className="cs-page-btn"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            Previous
          </button>

          {Array.from({ length: totalPages }, (_, idx) => idx + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
            .map((p) => (
              <button
                key={p}
                type="button"
                className={`cs-page-btn ${p === page ? 'current' : ''}`}
                onClick={() => onPageChange(p)}
                aria-label={`Page ${p}`}
                aria-current={p === page ? 'page' : undefined}
              >
                {p}
              </button>
            ))}

          <button
            type="button"
            className="cs-page-btn"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      </nav>
    </div>
  );
};
