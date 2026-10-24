/**
 * ERP-2 Vendors & Purchasing — Purchase Orders Paginated Data Table
 *
 * Implements main paginated collection table matching Data Dictionary §3:
 *   - Stable entity columns: PO Number, Vendor ID, Order Date, Status, Currency, Order Total, Lines
 *   - Server-side / query-bound pagination with page & pageSize
 *   - Sortable column headers with aria-sort and predictable asc/desc toggle
 *   - Bounded paging preventing DOM performance degradation
 *
 * @module erp2/web/components/PurchaseOrdersTable
 */

import React from 'react';
import type { PurchaseOrder } from '@clearshift/contracts';
import { SkeletonTable, EmptyState, StatusBadge } from './StateViews.js';

export interface PurchaseOrdersTableProps {
  purchaseOrders: PurchaseOrder[];
  isLoading: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortField?: string | undefined;
  sortDirection?: 'asc' | 'desc' | undefined;
  hasActiveFilters?: boolean | undefined;
  onCreatePurchaseOrder?: (() => void) | undefined;
  onSortChange?: (field: string) => void;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: (newPageSize: number) => void;
  onRefresh?: () => void;
}

export const PurchaseOrdersTable: React.FC<PurchaseOrdersTableProps> = ({
  purchaseOrders,
  isLoading,
  total,
  page,
  pageSize,
  totalPages,
  sortField,
  sortDirection = 'asc',
  hasActiveFilters,
  onCreatePurchaseOrder,
  onSortChange,
  onPageChange,
  onPageSizeChange,
  onRefresh,
}) => {
  if (isLoading) {
    return <SkeletonTable columns={7} rows={pageSize > 10 ? 8 : pageSize} ariaLabel="Loading data" />;
  }

  if (purchaseOrders.length === 0) {
    if (!hasActiveFilters && total === 0 && onCreatePurchaseOrder) {
      return (
        <EmptyState
          title="No purchase orders in ledger"
          message="No purchase orders have been recorded in the procurement ledger yet. Create your first purchase order to begin tracking supplier orders."
          actionLabel="New Purchase Order"
          onAction={onCreatePurchaseOrder}
        />
      );
    }
    return (
      <EmptyState
        title="No purchase orders found"
        message="No purchase orders match your current filter criteria."
        actionLabel={onCreatePurchaseOrder ? 'New Purchase Order' : onRefresh ? 'Reset Filters' : undefined}
        onAction={onCreatePurchaseOrder || onRefresh}
      />
    );
  }

  // Predictably sort rows if sortField is specified
  const displayOrders = React.useMemo(() => {
    if (!sortField) return purchaseOrders;
    return [...purchaseOrders].sort((a, b) => {
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
  }, [purchaseOrders, sortField, sortDirection]);

  const startRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  const renderSortableHeader = (field: string, label: string, extraClassName?: string) => {
    const isSorted = sortField === field;
    const ariaSortValue = isSorted
      ? sortDirection === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none';
    const indicator = isSorted ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅';

    return (
      <th scope="col" aria-sort={ariaSortValue} className={extraClassName}>
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
    <div className="cs-table-card" role="region" aria-label="Purchase orders table">
      <table className="cs-table">
        <thead>
          <tr>
            {renderSortableHeader('po_number', 'PO Number')}
            <th scope="col">Vendor ID</th>
            {renderSortableHeader('order_date', 'Order Date')}
            {renderSortableHeader('status', 'Status')}
            {renderSortableHeader('currency', 'Currency')}
            {renderSortableHeader('total', 'Order Total', 'cs-cell-number')}
            <th scope="col">Lines</th>
          </tr>
        </thead>
        <tbody>
          {displayOrders.map((po) => (
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
                <strong>
                  {Number(po.total).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
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

        {onPageSizeChange && (
          <div className="cs-page-size-selector">
            <label htmlFor="po-page-size-select">Rows per page:</label>
            <select
              id="po-page-size-select"
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
            className="cs-btn-secondary"
            onClick={() => onPageChange(1)}
            disabled={page <= 1}
            aria-label="First page"
          >
            « First
          </button>
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
          <button
            type="button"
            className="cs-btn-secondary"
            onClick={() => onPageChange(totalPages)}
            disabled={page >= totalPages}
            aria-label="Last page"
          >
            Last »
          </button>
        </div>
      </footer>
    </div>
  );
};
