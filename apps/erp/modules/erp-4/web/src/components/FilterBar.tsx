import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { AccountType, AccountsFilterQuery } from '@clearshift/contracts';
import { useDebounce } from '../hooks/useDebounce.js';
import { FilterPills, type ActiveFilterPill } from './FilterPills.js';
import { FilterSidebar, type FilterUpdate } from './FilterSidebar.js';

export { type FilterUpdate } from './FilterSidebar.js';

export interface FilterBarProps {
  filters: AccountsFilterQuery;
  onFilterChange: (updated: FilterUpdate) => void;
  onReset: () => void;
  isLoading?: boolean;
  totalResults?: number | undefined;
}

/**
 * FilterBar Component (ERP4-18)
 *
 * Implements:
 * - 300ms debounced search input with immediate local typing feedback
 * - Faceted dropdowns (Account Type, Status, Currency)
 * - Faceted Filter Sidebar drawer toggle with active count badge
 * - Removable filter pill tags with individual removal and 'Clear All' action
 */
export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onFilterChange,
  onReset,
  isLoading = false,
  totalResults,
}) => {
  // Local state for immediate typing responsiveness
  const [searchTerm, setSearchTerm] = useState<string>(filters.search || '');
  const debouncedSearchTerm = useDebounce<string>(searchTerm, 300);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Sync external filters.search back into local state if reset externally
  useEffect(() => {
    if (filters.search !== undefined && filters.search !== searchTerm) {
      setSearchTerm(filters.search || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  // Track if this is the initial mount to prevent redundant initial fetch
  const isInitialMount = useRef(true);

  // Trigger search filter when debounced term changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const currentSearch = filters.search || '';
    if (debouncedSearchTerm !== currentSearch) {
      onFilterChange({
        search: debouncedSearchTerm.trim() || undefined,
        page: 1,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchTerm]);

  const handleClearSearch = () => {
    setSearchTerm('');
    onFilterChange({ search: undefined, page: 1 });
  };

  // Build active filter pills list
  const activePills: ActiveFilterPill[] = useMemo(() => {
    const list: ActiveFilterPill[] = [];

    if (filters.search) {
      list.push({
        id: 'search',
        label: 'Search',
        value: `"${filters.search}"`,
        onRemove: () => {
          setSearchTerm('');
          onFilterChange({ search: undefined, page: 1 });
        },
      });
    }

    if (filters.type) {
      const typeLabel = filters.type.charAt(0).toUpperCase() + filters.type.slice(1);
      list.push({
        id: 'type',
        label: 'Type',
        value: typeLabel,
        onRemove: () => onFilterChange({ type: undefined, page: 1 }),
      });
    }

    if (filters.isActive !== undefined || filters.is_active !== undefined) {
      const active = filters.isActive ?? filters.is_active;
      list.push({
        id: 'status',
        label: 'Status',
        value: active ? 'Active' : 'Archived',
        onRemove: () => onFilterChange({ isActive: undefined, is_active: undefined, page: 1 }),
      });
    }

    if (filters.currencyCode || filters.currency_code) {
      const curr = filters.currencyCode || filters.currency_code || '';
      list.push({
        id: 'currency',
        label: 'Currency',
        value: curr,
        onRemove: () => onFilterChange({ currencyCode: undefined, currency_code: undefined, page: 1 }),
      });
    }

    return list;
  }, [filters, onFilterChange]);

  const activeFilterCount = activePills.length;

  const handleClearAll = () => {
    setSearchTerm('');
    onReset();
  };

  return (
    <div className="space-y-2 mb-4" role="search" aria-label="Filter and Search Controls">
      <div className="cs-filter-bar flex flex-wrap items-center gap-3">
        {/* Search input with 300ms debounce */}
        <div className="relative flex-1 min-w-[240px]">
          <label htmlFor="account-search-input" className="sr-only">
            Search accounts by code or name
          </label>
          <input
            id="account-search-input"
            type="text"
            className="cs-input cs-input-search w-full pr-8"
            placeholder="Search accounts by code or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={isLoading}
            aria-label="Search accounts by code or name"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-[var(--cs-text-muted)] hover:text-[var(--cs-text)]"
              aria-label="Clear search input"
            >
              &times;
            </button>
          )}
        </div>

        {/* Dropdown 1: Account Type */}
        <label htmlFor="account-type-select" className="sr-only">
          Filter by account type
        </label>
        <select
          id="account-type-select"
          className="cs-select"
          value={filters.type || ''}
          onChange={(e) => {
            const val = e.target.value as AccountType | '';
            onFilterChange({
              type: val ? val : undefined,
              page: 1,
            });
          }}
          disabled={isLoading}
          aria-label="Filter by account type"
        >
          <option value="">All Account Types</option>
          <option value="asset">Asset</option>
          <option value="liability">Liability</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>

        {/* Dropdown 2: Status */}
        <label htmlFor="account-status-select" className="sr-only">
          Filter by status
        </label>
        <select
          id="account-status-select"
          className="cs-select"
          value={
            typeof filters.isActive === 'boolean'
              ? String(filters.isActive)
              : typeof filters.is_active === 'boolean'
              ? String(filters.is_active)
              : ''
          }
          onChange={(e) => {
            const val = e.target.value;
            const update: FilterUpdate = { page: 1 };
            if (val === 'true') {
              update.isActive = true;
              update.is_active = true;
            } else if (val === 'false') {
              update.isActive = false;
              update.is_active = false;
            } else {
              update.isActive = undefined;
              update.is_active = undefined;
            }
            onFilterChange(update);
          }}
          disabled={isLoading}
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          <option value="true">Active Only</option>
          <option value="false">Archived / Inactive</option>
        </select>

        {/* Toggle Faceted Sidebar Button */}
        <button
          type="button"
          className="cs-btn cs-btn-secondary cs-btn-sm flex items-center gap-1.5"
          onClick={() => setIsSidebarOpen(true)}
          aria-label="Open faceted filter panel"
        >
          <span>Faceted Filters</span>
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-[var(--cs-accent, #2563eb)] rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Reset / Clear All button */}
        <button
          type="button"
          className="cs-btn cs-btn-secondary cs-btn-sm"
          onClick={handleClearAll}
          disabled={isLoading || activeFilterCount === 0}
          aria-label="Reset all filters"
        >
          Reset Filters
        </button>
      </div>

      {/* Active filter pill tags with individual clear buttons */}
      <FilterPills
        pills={activePills}
        onClearAll={handleClearAll}
      />

      {/* Slide-over Faceted Filter Sidebar */}
      <FilterSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        filters={filters}
        onFilterChange={onFilterChange}
        onReset={handleClearAll}
        totalResults={totalResults}
      />
    </div>
  );
};
