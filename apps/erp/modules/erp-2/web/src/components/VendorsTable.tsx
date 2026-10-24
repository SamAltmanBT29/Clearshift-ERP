/**
 * ERP-2 Vendors & Purchasing — Vendors Paginated Data Table
 *
 * Implements main paginated collection table matching Data Dictionary §2:
 *   - Stable entity columns: Name, Tax Number, Email, Phone, Currency, Bank Account, Location
 *   - Server-side / query-bound pagination with page & pageSize
 *   - Sortable column headers with aria-sort and predictable asc/desc toggle
 *   - Bounded paging preventing DOM performance degradation
 *
 * @module erp2/web/components/VendorsTable
 */

import React from 'react';
import type { Vendor } from '@clearshift/contracts';
import { SkeletonTable, EmptyState } from './StateViews.js';

export interface VendorsTableProps {
  vendors: Vendor[];
  isLoading: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortField?: string | undefined;
  sortDirection?: 'asc' | 'desc' | undefined;
  onSortChange?: (field: string) => void;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: (newPageSize: number) => void;
  onRefresh?: () => void;
}

export const VendorsTable: React.FC<VendorsTableProps> = ({
  vendors,
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
}) => {
  if (isLoading) {
    return <SkeletonTable columns={7} rows={pageSize > 10 ? 8 : pageSize} />;
  }

  if (vendors.length === 0) {
    return (
      <EmptyState
        title="No vendors found"
        message="No vendor profiles match your current search criteria. Try modifying your search term."
        actionLabel={onRefresh ? 'Reset Search' : undefined}
        onAction={onRefresh}
      />
    );
  }

  // Predictably sort rows if sortField is specified
  const displayVendors = React.useMemo(() => {
    if (!sortField) return vendors;
    return [...vendors].sort((a, b) => {
      let valA: unknown;
      let valB: unknown;

      if (sortField === 'location') {
        valA = [a.city, a.country].filter(Boolean).join(', ');
        valB = [b.city, b.country].filter(Boolean).join(', ');
      } else {
        valA = (a as unknown as Record<string, unknown>)[sortField];
        valB = (b as unknown as Record<string, unknown>)[sortField];
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
  }, [vendors, sortField, sortDirection]);

  const startRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  const renderSortableHeader = (field: string, label: string) => {
    const isSorted = sortField === field;
    const ariaSortValue = isSorted
      ? sortDirection === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none';
    const indicator = isSorted ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅';

    return (
      <th scope="col" aria-sort={ariaSortValue}>
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
    <div className="cs-table-card" role="region" aria-label="Vendors table">
      <table className="cs-table">
        <thead>
          <tr>
            {renderSortableHeader('name', 'Vendor Name')}
            {renderSortableHeader('tax_number', 'Tax Number')}
            {renderSortableHeader('email', 'Email')}
            {renderSortableHeader('phone', 'Phone')}
            {renderSortableHeader('currency', 'Currency')}
            <th scope="col">Bank Account</th>
            {renderSortableHeader('location', 'Location')}
          </tr>
        </thead>
        <tbody>
          {displayVendors.map((vendor) => (
            <tr key={vendor.id}>
              <td>
                <strong>{vendor.name}</strong>
              </td>
              <td className="cs-cell-mono">{vendor.tax_number}</td>
              <td>{vendor.email}</td>
              <td>{vendor.phone || '—'}</td>
              <td className="cs-cell-mono">{vendor.currency}</td>
              <td className="cs-cell-masked">{vendor.bank_masked || '—'}</td>
              <td>
                {[vendor.city, vendor.country].filter(Boolean).join(', ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination Bar */}
      <footer className="cs-pagination-bar" aria-label="Vendor list pagination">
        <div className="cs-pagination-info">
          Showing <strong>{startRecord}</strong>–<strong>{endRecord}</strong> of{' '}
          <strong>{total}</strong> vendors
        </div>

        {onPageSizeChange && (
          <div className="cs-page-size-selector">
            <label htmlFor="vendor-page-size-select">Rows per page:</label>
            <select
              id="vendor-page-size-select"
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
