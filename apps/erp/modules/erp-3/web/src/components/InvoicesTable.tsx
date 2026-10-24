import React from 'react';
import type { Invoice } from '@clearshift/contracts';
import { StatusBadge, SkeletonTable, EmptyState } from './StateViews.js';

export interface InvoicesTableProps {
  invoices: Invoice[];
  isLoading: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortField?: string | undefined;
  sortDirection?: 'asc' | 'desc' | undefined;
  onSortChange?: ((field: string) => void) | undefined;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: ((newPageSize: number) => void) | undefined;
  onRefresh?: (() => void) | undefined;
  onSelectInvoice?: ((invoice: Invoice) => void) | undefined;
}

export const InvoicesTable: React.FC<InvoicesTableProps> = ({
  invoices,
  isLoading,
  total,
  page,
  pageSize,
  totalPages,
  sortField,
  sortDirection = 'asc',
  onSortChange,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  onSelectInvoice,
}) => {
  if (isLoading) {
    return <SkeletonTable columns={8} rows={pageSize > 10 ? 8 : pageSize} />;
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

  // Predictably sort rows if sortField is specified
  const displayInvoices = React.useMemo(() => {
    if (!sortField) return invoices;
    return [...invoices].sort((a, b) => {
      let valA: unknown = (a as unknown as Record<string, unknown>)[sortField];
      let valB: unknown = (b as unknown as Record<string, unknown>)[sortField];

      if (sortField === 'total') {
        const numA = Number(a.total) || 0;
        const numB = Number(b.total) || 0;
        return sortDirection === 'desc' ? numB - numA : numA - numB;
      }

      if (valA === valB) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;

      const comp = String(valA).localeCompare(String(valB), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      return sortDirection === 'desc' ? -comp : comp;
    });
  }, [invoices, sortField, sortDirection]);

  const startRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  const renderSortableHeader = (
    field: string,
    label: string,
    extraStyle?: React.CSSProperties
  ) => {
    const isSorted = sortField === field;
    const ariaSortValue = isSorted
      ? sortDirection === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none';
    const indicator = isSorted ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅';

    return (
      <th scope="col" aria-sort={ariaSortValue} style={extraStyle}>
        <button
          type="button"
          className="cs-th-sort-btn"
          onClick={() => onSortChange?.(field)}
          aria-label={`Sort by ${label}`}
        >
          <span>{label}</span>
          <span className="cs-sort-indicator" aria-hidden="true">
            {indicator}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="cs-table-card" role="region" aria-label="Invoices table">
      <div style={{ overflowX: 'auto' }}>
        <table className="cs-table" aria-label="Invoices Table">
          <thead>
            <tr>
              {renderSortableHeader('invoice_number', 'Invoice #')}
              {renderSortableHeader('order_id', 'Order ID')}
              {renderSortableHeader('customer_golden_id', 'Customer Golden ID')}
              {renderSortableHeader('invoice_date', 'Issue Date')}
              {renderSortableHeader('due_date', 'Due Date')}
              {renderSortableHeader('status', 'Status')}
              {renderSortableHeader('total', 'Total', { textAlign: 'right' })}
              <th scope="col" style={{ textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {displayInvoices.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <span className="cs-mono" style={{ fontWeight: 600 }}>
                    {inv.invoice_number}
                  </span>
                </td>
                <td>
                  <span className="cs-mono">{inv.order_id || '—'}</span>
                </td>
                <td>
                  <span className="cs-mono">{inv.customer_golden_id}</span>
                </td>
                <td>{inv.invoice_date}</td>
                <td>
                  <span style={inv.status === 'Overdue' ? { color: 'var(--color-error)', fontWeight: 600 } : undefined}>
                    {inv.due_date}
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
                    {inv.currency}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    className="cs-btn-secondary"
                    style={{ padding: '2px 8px', fontSize: '12px' }}
                    onClick={() => onSelectInvoice && onSelectInvoice(inv)}
                    aria-label={`View invoice ${inv.invoice_number}`}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer
        className="cs-pagination-bar"
        aria-label="Invoices Pagination"
      >
        <div className="cs-pagination-info">
          Showing <strong>{startRecord}</strong>–<strong>{endRecord}</strong> of{' '}
          <strong>{total}</strong> invoices
        </div>

        {onPageSizeChange && (
          <div className="cs-page-size-selector">
            <label htmlFor="invoices-page-size-select">Rows per page:</label>
            <select
              id="invoices-page-size-select"
              className="cs-page-size-select"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Rows per page"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        )}

        <div className="cs-pagination-controls">
          <button
            type="button"
            className="cs-page-btn cs-btn-secondary"
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
            aria-label="First page"
          >
            « First
          </button>
          <button
            type="button"
            className="cs-page-btn cs-btn-secondary"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            Previous
          </button>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 8px', fontSize: '13px' }}>
            Page {page} of {totalPages || 1}
          </span>
          <button
            type="button"
            className="cs-page-btn cs-btn-secondary"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            Next
          </button>
          <button
            type="button"
            className="cs-page-btn cs-btn-secondary"
            disabled={page >= totalPages}
            onClick={() => onPageChange(totalPages)}
            aria-label="Last page"
          >
            Last »
          </button>
        </div>
      </footer>
    </div>
  );
};
