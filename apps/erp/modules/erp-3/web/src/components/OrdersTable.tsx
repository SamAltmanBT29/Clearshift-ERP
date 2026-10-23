import React from 'react';
import type { SalesOrder } from '@clearshift/contracts';
import { StatusBadge, SkeletonTable, EmptyState } from './StateViews.js';

interface OrdersTableProps {
  orders: SalesOrder[];
  isLoading: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onRefresh?: () => void;
  onSelectOrder?: (order: SalesOrder) => void;
}

export const OrdersTable: React.FC<OrdersTableProps> = ({
  orders,
  isLoading,
  total,
  page,
  pageSize,
  totalPages,
  onPageChange,
  onRefresh,
  onSelectOrder,
}) => {
  if (isLoading) {
    return <SkeletonTable columns={8} rows={6} />;
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        title="No sales orders found"
        message="No orders match your current filter selection or search query."
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
        <table className="cs-table" aria-label="Sales Orders Table">
          <thead>
            <tr>
              <th scope="col">Order #</th>
              <th scope="col">Customer Golden ID</th>
              <th scope="col">Date</th>
              <th scope="col">Status</th>
              <th scope="col" style={{ textAlign: 'right' }}>Subtotal</th>
              <th scope="col" style={{ textAlign: 'right' }}>Tax</th>
              <th scope="col" style={{ textAlign: 'right' }}>Total</th>
              <th scope="col" style={{ textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>
                  <span className="cs-mono" style={{ fontWeight: 600 }}>
                    {order.orderNumber}
                  </span>
                </td>
                <td>
                  <span className="cs-mono">{order.customerGoldenId}</span>
                </td>
                <td>{order.orderDate}</td>
                <td>
                  <StatusBadge status={order.status} />
                </td>
                <td style={{ textAlign: 'right' }} className="cs-mono">
                  {parseFloat(order.subtotal).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  {order.currencyCode}
                </td>
                <td style={{ textAlign: 'right' }} className="cs-mono">
                  {parseFloat(order.taxTotal).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  {order.currencyCode}
                </td>
                <td style={{ textAlign: 'right' }} className="cs-mono">
                  <span style={{ fontWeight: 600 }}>
                    {parseFloat(order.total).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    {order.currencyCode}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    className="cs-btn-secondary"
                    style={{ padding: '2px 8px', fontSize: '12px' }}
                    onClick={() => onSelectOrder && onSelectOrder(order)}
                    aria-label={`View order ${order.orderNumber}`}
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
        aria-label="Sales Orders Pagination"
      >
        <div>
          Showing <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{startRecord}</span> to{' '}
          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{endRecord}</span> of{' '}
          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{total}</span> orders
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
