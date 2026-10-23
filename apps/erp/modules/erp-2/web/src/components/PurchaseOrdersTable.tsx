import React from 'react';
import type { PurchaseOrder } from '@clearshift/contracts';
import { SkeletonTable, EmptyState, StatusBadge } from './StateViews.js';

interface PurchaseOrdersTableProps {
  purchaseOrders: PurchaseOrder[];
  isLoading: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onRefresh?: () => void;
}

export const PurchaseOrdersTable: React.FC<PurchaseOrdersTableProps> = ({
  purchaseOrders,
  isLoading,
  total,
  page,
  pageSize,
  totalPages,
  onPageChange,
  onRefresh,
}) => {
  if (isLoading) {
    return <SkeletonTable columns={7} rows={pageSize > 10 ? 8 : pageSize} />;
  }

  if (purchaseOrders.length === 0) {
    return (
      <EmptyState
        title="No purchase orders found"
        message="No purchase orders match your current filter criteria."
        actionLabel={onRefresh ? 'Reset Filters' : undefined}
        onAction={onRefresh}
      />
    );
  }

  const startRecord = (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  return (
    <div className="cs-table-card" role="region" aria-label="Purchase orders table">
      <table className="cs-table">
        <thead>
          <tr>
            <th scope="col">PO Number</th>
            <th scope="col">Vendor ID</th>
            <th scope="col">Order Date</th>
            <th scope="col">Status</th>
            <th scope="col">Currency</th>
            <th scope="col" className="cs-cell-number">Order Total</th>
            <th scope="col">Lines</th>
          </tr>
        </thead>
        <tbody>
          {purchaseOrders.map((po) => (
            <tr key={po.id}>
              <td>
                <strong className="cs-cell-mono">{po.po_number}</strong>
              </td>
              <td className="cs-cell-mono" title={po.vendor_id}>
                {po.vendor_id.slice(0, 8)}…{po.vendor_id.slice(-4)}
              </td>
              <td>{po.order_date}</td>
              <td>
                <StatusBadge status={po.status} />
              </td>
              <td className="cs-cell-mono">{po.currency}</td>
              <td className="cs-cell-number">
                <strong>{Number(po.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </td>
              <td>
                <span className="cs-badge cs-badge-draft">
                  {po.lines?.length || 0} line{(po.lines?.length || 0) === 1 ? '' : 's'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination Bar */}
      <footer className="cs-pagination-bar" aria-label="Purchase order list pagination">
        <div className="cs-pagination-info">
          Showing <strong>{startRecord}</strong>–<strong>{endRecord}</strong> of{' '}
          <strong>{total}</strong> purchase orders
        </div>
        <div className="cs-pagination-controls">
          <button
            type="button"
            className="cs-btn-secondary"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            Previous
          </button>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 8px', fontSize: '13px' }}>
            Page {page} of {totalPages || 1}
          </span>
          <button
            type="button"
            className="cs-btn-secondary"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      </footer>
    </div>
  );
};
