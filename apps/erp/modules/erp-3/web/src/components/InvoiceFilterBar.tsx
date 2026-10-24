import React from 'react';
import type { InvoiceStatus, InvoicesFilterQuery } from '@clearshift/contracts';
import { SearchBar } from './SearchBar.js';

export interface InvoiceFilterBarProps {
  filters: Partial<InvoicesFilterQuery>;
  onFilterChange: (updated: Partial<InvoicesFilterQuery>) => void;
  onReset: () => void;
  isLoading?: boolean;
  debounceMs?: number;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

export const InvoiceFilterBar: React.FC<InvoiceFilterBarProps> = ({
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
    <div className="cs-filter-bar" role="search" aria-label="Filter invoices">
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
          placeholder="Search by invoice #, order ID, or customer Golden ID (UUID)..."
          disabled={isLoading}
          debounceMs={debounceMs}
          inputId="invoice-search-input"
          ariaLabel="Search invoices by invoice number, order ID, or customer Golden ID"
        />
      </div>

      <div>
        <label htmlFor="invoice-status-select" className="sr-only">
          Filter by status
        </label>
        <select
          id="invoice-status-select"
          className="cs-select"
          value={filters.status || ''}
          onChange={(e) => {
            const val = e.target.value as InvoiceStatus | '';
            onFilterChange({ status: val ? val : undefined, page: 1 });
          }}
          disabled={isLoading}
          aria-label="Filter by invoice status"
        >
          <option value="">All Statuses</option>
          <option value="Open">Open</option>
          <option value="Paid">Paid</option>
          <option value="Overdue">Overdue</option>
        </select>
      </div>

      <button
        type="button"
        className="cs-btn-secondary"
        onClick={onReset}
        disabled={isLoading || !hasActiveFilters}
        aria-label="Reset invoice filters"
      >
        Reset Filters
      </button>
    </div>
  );
};
