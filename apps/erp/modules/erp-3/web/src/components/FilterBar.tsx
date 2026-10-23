import React from 'react';
import type { SalesOrderStatus, SalesOrdersFilterQuery } from '@clearshift/contracts';

interface FilterBarProps {
  filters: Partial<SalesOrdersFilterQuery>;
  onFilterChange: (updated: Partial<SalesOrdersFilterQuery>) => void;
  onReset: () => void;
  isLoading?: boolean;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onFilterChange,
  onReset,
  isLoading = false,
}) => {
  return (
    <div className="cs-filter-bar" role="search" aria-label="Filter sales orders">
      <div className="cs-search-input-wrapper">
        <label htmlFor="order-search-input" className="sr-only">
          Search orders
        </label>
        <input
          id="order-search-input"
          type="text"
          className="cs-input"
          placeholder="Search by order # or customer Golden ID (UUID)..."
          value={filters.search || ''}
          onChange={(e) => onFilterChange({ search: e.target.value, page: 1 })}
          disabled={isLoading}
          aria-label="Search orders by order number or customer Golden ID"
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
        disabled={isLoading}
        aria-label="Reset filters"
      >
        Reset Filters
      </button>
    </div>
  );
};

export { InvoiceFilterBar } from './InvoiceFilterBar.js';
