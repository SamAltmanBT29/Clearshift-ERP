import React from 'react';
import type { SalesOrder } from '@clearshift/contracts';
import {
  StatusBadge,
  SkeletonTable,
  EmptyState,
  EmptySalesOrdersView,
  SalesOrdersLoadingSkeleton,
} from './StateViews.js';

export interface OrdersTableProps {
  orders: SalesOrder[];
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
  onSelectOrder?: ((order: SalesOrder) => void) | undefined;
  hasActiveFilters?: boolean | undefined;
  onCreateOrder?: (() => void) | undefined;
  onClearFilters?: (() => void) | undefined;
}

function computeOrderBreakdown(order: SalesOrder): { subtotal: number; taxTotal: number; total: number } {
  const total = parseFloat(order.total || '0');
  if (!order.lines || order.lines.length === 0) {
    return { subtotal: total, taxTotal: 0, total };
  }
  const taxTotal = order.lines.reduce((acc, l) => acc + parseFloat(l.tax_amount || '0'), 0);
  const lineSum = order.lines.reduce((acc, l) => acc + parseFloat(l.line_total || '0'), 0);
  const subtotal = Math.max(0, lineSum - taxTotal);
  return { subtotal, taxTotal, total };
}

export const OrdersTable: React.FC<OrdersTableProps> = ({
  orders,
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
  onSelectOrder,
  hasActiveFilters,
  onCreateOrder,
  onClearFilters,
}) => {
  if (isLoading) {
    return <SalesOrdersLoadingSkeleton columns={8} rows={pageSize > 10 ? 8 : pageSize} />;
  }

  if (orders.length === 0) {
    return (
      <EmptySalesOrdersView
        hasActiveFilters={Boolean(hasActiveFilters)}
        onClearFilters={onClearFilters || onRefresh || (() => {})}
        onCreateOrder={onCreateOrder}
      />
    );
  }

  // Predictably sort rows if sortField is specified
  const displayOrders = React.useMemo(() => {
    if (!sortField) return orders;
    return [...orders].sort((a, b) => {
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
  }, [orders, sortField, sortDirection]);

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
    <div className="cs-table-card" role="region" aria-label="Sales orders table">
      <div style={{ overflowX: 'auto' }}>
        <table className="cs-table" aria-label="Sales Orders Table">
          <thead>
            <tr>
              {renderSortableHeader('order_number', 'Order #')}
              {renderSortableHeader('customer_golden_id', 'Customer Golden ID')}
              {renderSortableHeader('order_date', 'Date')}
              {renderSortableHeader('status', 'Status')}
              <th scope="col" style={{ textAlign: 'right' }}>Subtotal</th>
              <th scope="col" style={{ textAlign: 'right' }}>Tax</th>
              {renderSortableHeader('total', 'Total', { textAlign: 'right' })}
              <th scope="col" style={{ textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {displayOrders.map((order) => {
              const breakdown = computeOrderBreakdown(order);
              return (
                <tr key={order.id}>
                  <td>
                    <span className="cs-mono" style={{ fontWeight: 600 }}>
                      {order.order_number}
                    </span>
                  </td>
                  <td>
                    <span className="cs-mono">{order.customer_golden_id}</span>
                  </td>
                  <td>{order.order_date}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                  <td style={{ textAlign: 'right' }} className="cs-mono">
                    {breakdown.subtotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    {order.currency}
                  </td>
                  <td style={{ textAlign: 'right' }} className="cs-mono">
                    {breakdown.taxTotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    {order.currency}
                  </td>
                  <td style={{ textAlign: 'right' }} className="cs-mono">
                    <span style={{ fontWeight: 600 }}>
                      {breakdown.total.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      {order.currency}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="cs-btn-secondary"
                      style={{ padding: '2px 8px', fontSize: '12px' }}
                      onClick={() => onSelectOrder && onSelectOrder(order)}
                      aria-label={`View order ${order.order_number}`}
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer
        className="cs-pagination-bar"
        aria-label="Sales Orders Pagination"
      >
        <div className="cs-pagination-info">
          Showing <strong>{startRecord}</strong>–<strong>{endRecord}</strong> of{' '}
          <strong>{total}</strong> orders
        </div>

        {onPageSizeChange && (
          <div className="cs-page-size-selector">
            <label htmlFor="orders-page-size-select">Rows per page:</label>
            <select
              id="orders-page-size-select"
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
