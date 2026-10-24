import React from 'react';
import type { SalesOrderStatus, SalesOrdersFilterQuery } from '@clearshift/contracts';
import { SearchBar } from './SearchBar.js';

interface FilterBarProps {
  filters: Partial<SalesOrdersFilterQuery>;
  onFilterChange: (updated: Partial<SalesOrdersFilterQuery>) => void;
  onReset: () => void;
  isLoading?: boolean;
  debounceMs?: number;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onFilterChange,
  onReset,
  isLoading = false,
  debounceMs = 300,
  onToggleSidebar,
  isSidebarOpen,
}) => {
  const hasActiveFilters = Boolean(filters.search?.trim()) || Boolean(filters.status);

  return (
    <div className="cs-filter-bar" role="search" aria-label="Filter sales orders">
      {onToggleSidebar && (
        <button
          type="button"
          className="cs-btn-secondary cs-sidebar-toggle-btn"
          onClick={onToggleSidebar}
          aria-expanded={isSidebarOpen}
          aria-label={isSidebarOpen ? 'Hide filter sidebar' : 'Show filter sidebar'}
        >
          {isSidebarOpen ? 'Hide Filters' : 'Filters'}
        </button>
      )}

      <div className="cs-search-input-wrapper">
        <SearchBar
          value={filters.search || ''}
          onChange={(val) => onFilterChange({ search: val, page: 1 })}
          placeholder="Search by order # or customer Golden ID (UUID)..."
          disabled={isLoading}
          debounceMs={debounceMs}
          inputId="order-search-input"
          ariaLabel="Search orders by order number or customer Golden ID"
        />
      </div>

      <div>
        <label htmlFor="order-status-select" className="sr-only">
          Filter by status
        </label>
        <select
          id="order-status-select"
          className="cs-select"
          value={filters.status || ''}
          onChange={(e) => {
            const val = e.target.value as SalesOrderStatus | '';
            onFilterChange({ status: val ? val : undefined, page: 1 });
          }}
          disabled={isLoading}
          aria-label="Filter by order status"
        >
          <option value="">All Statuses</option>
          <option value="Open">Open</option>
          <option value="Invoiced">Invoiced</option>
          <option value="Closed">Closed</option>
        </select>
      </div>

      <button
        type="button"
        className="cs-btn-secondary"
        onClick={onReset}
        disabled={isLoading || !hasActiveFilters}
        aria-label="Reset filters"
      >
        Reset Filters
      </button>
    </div>
  );
};

export { InvoiceFilterBar } from './InvoiceFilterBar.js';
