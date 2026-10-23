import React from 'react';
import type { VendorListQuery, PurchaseOrderListQuery, PurchaseOrderStatus } from '@clearshift/contracts';

interface VendorFilterBarProps {
  filters: VendorListQuery;
  onFilterChange: (filters: Partial<VendorListQuery>) => void;
  onReset: () => void;
  isLoading?: boolean;
}

export const VendorFilterBar: React.FC<VendorFilterBarProps> = ({
  filters,
  onFilterChange,
  onReset,
  isLoading = false,
}) => {
  return (
    <div className="cs-filter-bar" role="search" aria-label="Vendor search and filter controls">
      <div className="cs-filter-group">
        <label htmlFor="vendor-search-input" className="cs-filter-label">
          Search
        </label>
        <input
          id="vendor-search-input"
          type="search"
          className="cs-input cs-input-search"
          placeholder="Search by legal name..."
          aria-label="Search vendors by legal name"
          value={filters.search || ''}
          onChange={(e) => onFilterChange({ search: e.target.value })}
          disabled={isLoading}
        />
      </div>

      <div className="cs-filter-group" style={{ alignSelf: 'flex-end' }}>
        <button
          type="button"
          className="cs-btn-secondary"
          onClick={onReset}
          disabled={isLoading || !filters.search}
          aria-label="Reset filters"
        >
          Reset Filters
        </button>
      </div>
    </div>
  );
};

interface PurchaseOrderFilterBarProps {
  filters: PurchaseOrderListQuery;
  onFilterChange: (filters: Partial<PurchaseOrderListQuery>) => void;
  onReset: () => void;
  isLoading?: boolean;
}

const PO_STATUS_OPTIONS: PurchaseOrderStatus[] = ['Draft', 'Sent', 'Received', 'Closed'];

export const PurchaseOrderFilterBar: React.FC<PurchaseOrderFilterBarProps> = ({
  filters,
  onFilterChange,
  onReset,
  isLoading = false,
}) => {
  return (
    <div className="cs-filter-bar" role="search" aria-label="Purchase order filter controls">
      <div className="cs-filter-group">
        <label htmlFor="po-status-select" className="cs-filter-label">
          Order Status
        </label>
        <select
          id="po-status-select"
          className="cs-select"
          aria-label="Filter by order status"
          value={filters.status || ''}
          onChange={(e) => {
            const val = e.target.value;
            onFilterChange({ status: (val as PurchaseOrderStatus) || undefined });
          }}
          disabled={isLoading}
        >
          <option value="">All Statuses</option>
          {PO_STATUS_OPTIONS.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
      </div>

      <div className="cs-filter-group" style={{ alignSelf: 'flex-end' }}>
        <button
          type="button"
          className="cs-btn-secondary"
          onClick={onReset}
          disabled={isLoading || (!filters.status && !filters.vendor_id)}
          aria-label="Reset filters"
        >
          Reset Filters
        </button>
      </div>
    </div>
  );
};
