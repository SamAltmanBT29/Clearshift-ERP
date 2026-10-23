import React from 'react';
import type { Vendor } from '@clearshift/contracts';
import { SkeletonTable, EmptyState } from './StateViews.js';

interface VendorsTableProps {
  vendors: Vendor[];
  isLoading: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onRefresh?: () => void;
}

export const VendorsTable: React.FC<VendorsTableProps> = ({
  vendors,
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

  const startRecord = (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  return (
    <div className="cs-table-card" role="region" aria-label="Vendors table">
      <table className="cs-table">
        <thead>
          <tr>
            <th scope="col">Vendor Name</th>
            <th scope="col">Tax Number</th>
            <th scope="col">Email</th>
            <th scope="col">Phone</th>
            <th scope="col">Currency</th>
            <th scope="col">Bank Account</th>
            <th scope="col">Location</th>
          </tr>
        </thead>
        <tbody>
          {vendors.map((vendor) => (
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
