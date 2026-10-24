import React from 'react';
import type { AccountType, AccountsFilterQuery } from '@clearshift/contracts';

export type FilterUpdate = {
  search?: string | undefined;
  type?: AccountType | undefined;
  isActive?: boolean | undefined;
  is_active?: boolean | undefined;
  currencyCode?: string | undefined;
  currency_code?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  pageSize?: number | undefined;
};

export interface FilterSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  filters: AccountsFilterQuery;
  onFilterChange: (updated: FilterUpdate) => void;
  onReset: () => void;
  totalResults?: number | undefined;
}

const ACCOUNT_TYPES: { label: string; value: AccountType }[] = [
  { label: 'Asset', value: 'asset' },
  { label: 'Liability', value: 'liability' },
  { label: 'Income', value: 'income' },
  { label: 'Expense', value: 'expense' },
];

const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP'];

/**
 * Faceted Filter Sidebar for Chart of Accounts (ERP4-18)
 *
 * Implements:
 * - Faceted sidebar panel with categorized filtering
 * - Account type facets, status facets, currency facets
 * - Responsive drawer or slide-over with accessible focus and close affordances
 */
export const FilterSidebar: React.FC<FilterSidebarProps> = ({
  isOpen,
  onClose,
  filters,
  onFilterChange,
  onReset,
  totalResults,
}) => {
  if (!isOpen) return null;

  return (
    <aside
      className="cs-filter-sidebar fixed inset-y-0 right-0 z-50 w-80 max-w-full bg-[var(--cs-bg)] border-l border-[var(--cs-border)] shadow-xl flex flex-col p-5"
      role="region"
      aria-label="Faceted Filter Controls"
    >
      <div className="flex items-center justify-between pb-4 border-b border-[var(--cs-border)]">
        <div>
          <h2 className="text-base font-semibold text-[var(--cs-text)] m-0">Faceted Filters</h2>
          {totalResults !== undefined && (
            <p className="text-xs text-[var(--cs-text-muted)] m-0 mt-0.5">
              {totalResults} matching accounts
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-[var(--cs-text-muted)] hover:text-[var(--cs-text)] hover:bg-[var(--cs-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)]"
          aria-label="Close filter panel"
        >
          <span aria-hidden="true" className="text-lg font-bold">&times;</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-6">
        {/* Facet 1: Account Type */}
        <fieldset className="border-0 p-0 m-0">
          <legend className="text-sm font-semibold text-[var(--cs-text)] mb-2.5">
            Account Type
          </legend>
          <div className="space-y-2">
            <label className="flex items-center gap-2.5 text-sm cursor-pointer text-[var(--cs-text)]">
              <input
                type="radio"
                name="account-type-facet"
                checked={!filters.type}
                onChange={() => onFilterChange({ type: undefined, page: 1 })}
                className="text-[var(--cs-accent)]"
              />
              <span>All Types</span>
            </label>
            {ACCOUNT_TYPES.map((t) => (
              <label
                key={t.value}
                className="flex items-center gap-2.5 text-sm cursor-pointer text-[var(--cs-text)]"
              >
                <input
                  type="radio"
                  name="account-type-facet"
                  value={t.value}
                  checked={filters.type === t.value}
                  onChange={() => onFilterChange({ type: t.value, page: 1 })}
                  className="text-[var(--cs-accent)]"
                />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Facet 2: Account Status */}
        <fieldset className="border-0 p-0 m-0 pt-4 border-t border-[var(--cs-border)]">
          <legend className="text-sm font-semibold text-[var(--cs-text)] mb-2.5">
            Status
          </legend>
          <div className="space-y-2">
            <label className="flex items-center gap-2.5 text-sm cursor-pointer text-[var(--cs-text)]">
              <input
                type="radio"
                name="status-facet"
                checked={filters.isActive === undefined && filters.is_active === undefined}
                onChange={() => onFilterChange({ isActive: undefined, is_active: undefined, page: 1 })}
                className="text-[var(--cs-accent)]"
              />
              <span>All Statuses</span>
            </label>
            <label className="flex items-center gap-2.5 text-sm cursor-pointer text-[var(--cs-text)]">
              <input
                type="radio"
                name="status-facet"
                checked={filters.isActive === true || filters.is_active === true}
                onChange={() => onFilterChange({ isActive: true, is_active: true, page: 1 })}
                className="text-[var(--cs-accent)]"
              />
              <span>Active Only</span>
            </label>
            <label className="flex items-center gap-2.5 text-sm cursor-pointer text-[var(--cs-text)]">
              <input
                type="radio"
                name="status-facet"
                checked={filters.isActive === false || filters.is_active === false}
                onChange={() => onFilterChange({ isActive: false, is_active: false, page: 1 })}
                className="text-[var(--cs-accent)]"
              />
              <span>Archived / Inactive</span>
            </label>
          </div>
        </fieldset>

        {/* Facet 3: Currency */}
        <fieldset className="border-0 p-0 m-0 pt-4 border-t border-[var(--cs-border)]">
          <legend className="text-sm font-semibold text-[var(--cs-text)] mb-2.5">
            Currency
          </legend>
          <div className="space-y-2">
            <label className="flex items-center gap-2.5 text-sm cursor-pointer text-[var(--cs-text)]">
              <input
                type="radio"
                name="currency-facet"
                checked={!filters.currencyCode && !filters.currency_code}
                onChange={() => onFilterChange({ currencyCode: undefined, currency_code: undefined, page: 1 })}
                className="text-[var(--cs-accent)]"
              />
              <span>All Currencies</span>
            </label>
            {CURRENCIES.map((curr) => {
              const isSelected = filters.currencyCode === curr || filters.currency_code === curr;
              return (
                <label
                  key={curr}
                  className="flex items-center gap-2.5 text-sm cursor-pointer text-[var(--cs-text)]"
                >
                  <input
                    type="radio"
                    name="currency-facet"
                    value={curr}
                    checked={isSelected}
                    onChange={() => onFilterChange({ currencyCode: curr, currency_code: curr, page: 1 })}
                    className="text-[var(--cs-accent)]"
                  />
                  <span>{curr}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <div className="pt-4 border-t border-[var(--cs-border)] flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onReset}
          className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--cs-border)] bg-[var(--cs-bg)] hover:bg-[var(--cs-surface)] text-[var(--cs-text)]"
        >
          Reset All
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-1.5 text-xs font-semibold rounded bg-[var(--cs-accent, #2563eb)] text-white hover:opacity-90"
        >
          Done
        </button>
      </div>
    </aside>
  );
};
