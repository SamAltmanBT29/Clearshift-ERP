/**
 * ERP-2 Vendors & Purchasing — Filter Bar Components
 *
 * VendorFilterBar: debounced search bar (300ms, AC1) + reset action.
 * PurchaseOrderFilterBar: status dropdown + reset action.
 *
 * @module erp2/web/components/FilterBar
 */

import React from 'react';
import type { VendorListQuery, PurchaseOrderListQuery, PurchaseOrderStatus } from '@clearshift/contracts';
import { SearchBar } from './SearchBar.js';

// ─── Vendor Filter Bar ─────────────────────────────────────────────────────────

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
  const hasActiveFilters = Boolean(filters.search?.trim());

  return (
    <div className="cs-filter-bar" role="search" aria-label="Vendor search and filter controls">
      {/* Debounced search — 300ms (AC1) */}
      <div className="cs-filter-group cs-filter-group--search">
        <SearchBar
          value={filters.search || ''}
          onChange={(debouncedVal) => onFilterChange({ search: debouncedVal })}
          placeholder="Search vendors by name, tax number..."
          disabled={isLoading}
          debounceMs={300}
          inputId="erp2-vendor-search-input"
          ariaLabel="Search vendors"
        />
      </div>

      <div className="cs-filter-group" style={{ alignSelf: 'center' }}>
        <button
          type="button"
          className="cs-btn-secondary"
          onClick={onReset}
          disabled={isLoading || !hasActiveFilters}
          aria-label="Reset vendor filters"
        >
          Reset Filters
        </button>
      </div>
    </div>
  );
};

// ─── Purchase Order Filter Bar ─────────────────────────────────────────────────

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
  const hasActiveFilters = Boolean(filters.status) || Boolean(filters.vendor_id);

  return (
    <div className="cs-filter-bar" role="search" aria-label="Purchase order filter controls">
      {/* Status filter */}
      <div className="cs-filter-group">
        <label htmlFor="po-status-select" className="cs-filter-label">
          Order Status
        </label>
        <select
          id="po-status-select"
          className="cs-select"
          aria-label="Status filter"
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
          disabled={isLoading || !hasActiveFilters}
          aria-label="Reset purchase order filters"
        >
          Reset Filters
        </button>
      </div>
    </div>
  );
};
