import React from 'react';
import type { InvoiceStatus, InvoicesFilterQuery } from '@clearshift/contracts';

export interface InvoiceFilterBarProps {
  filters: InvoicesFilterQuery;
  onFilterChange: (updated: Partial<InvoicesFilterQuery>) => void;
  onReset: () => void;
  isLoading?: boolean;
}

export const InvoiceFilterBar: React.FC<InvoiceFilterBarProps> = ({
  filters,
  onFilterChange,
  onReset,
  isLoading = false,
}) => {
  return (
    <div className="cs-filter-bar" role="search" aria-label="Filter invoices">
      <div className="cs-search-input-wrapper">
        <label htmlFor="invoice-search-input" className="sr-only">
          Search invoices
        </label>
        <input
          id="invoice-search-input"
          type="text"
          className="cs-input"
          placeholder="Search by invoice #, order ID, or customer Golden ID..."
          value={filters.search || ''}
          onChange={(e) => onFilterChange({ search: e.target.value, page: 1 })}
          disabled={isLoading}
          aria-label="Search invoices by invoice number, order ID, or customer Golden ID"
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
          <option value="open">Open</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      <button
        type="button"
        className="cs-btn-secondary"
        onClick={onReset}
        disabled={isLoading}
        aria-label="Reset invoice filters"
      >
        Reset Filters
      </button>
    </div>
  );
};
