import React from 'react';
import type { AccountType, AccountsFilterQuery } from '@clearshift/contracts';

interface FilterBarProps {
  filters: AccountsFilterQuery;
  onFilterChange: (updated: Partial<AccountsFilterQuery>) => void;
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
    <div className="cs-filter-bar" role="search" aria-label="Filter accounts">
      <label htmlFor="account-search-input" className="sr-only" style={{ display: 'none' }}>
        Search accounts
      </label>
      <input
        id="account-search-input"
        type="text"
        className="cs-input cs-input-search"
        placeholder="Search accounts by code or name..."
        value={filters.search || ''}
        onChange={(e) => onFilterChange({ search: e.target.value, page: 1 })}
        disabled={isLoading}
        aria-label="Search accounts by code or name"
      />

      <label htmlFor="account-type-select" className="sr-only" style={{ display: 'none' }}>
        Filter by account type
      </label>
      <select
        id="account-type-select"
        className="cs-select"
        value={filters.type || ''}
        onChange={(e) => {
          const val = e.target.value as AccountType | '';
          onFilterChange({ type: val ? val : undefined, page: 1 });
        }}
        disabled={isLoading}
        aria-label="Filter by account type"
      >
        <option value="">All Account Types</option>
        <option value="asset">Asset</option>
        <option value="liability">Liability</option>
        <option value="equity">Equity</option>
        <option value="income">Income</option>
        <option value="expense">Expense</option>
      </select>

      <label htmlFor="account-status-select" className="sr-only" style={{ display: 'none' }}>
        Filter by status
      </label>
      <select
        id="account-status-select"
        className="cs-select"
        value={typeof filters.isActive === 'boolean' ? String(filters.isActive) : ''}
        onChange={(e) => {
          const val = e.target.value;
          onFilterChange({
            isActive: val === 'true' ? true : val === 'false' ? false : undefined,
            page: 1,
          });
        }}
        disabled={isLoading}
        aria-label="Filter by status"
      >
        <option value="">All Statuses</option>
        <option value="true">Active Only</option>
        <option value="false">Archived / Inactive</option>
      </select>

      <button
        type="button"
        className="cs-btn cs-btn-secondary cs-btn-sm"
        onClick={onReset}
        disabled={isLoading}
        aria-label="Reset all filters"
      >
        Reset Filters
      </button>
    </div>
  );
};
