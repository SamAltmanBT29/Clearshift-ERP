/**
 * ERP-3 Sales Orders & Invoices — Active Filter Pill Tags
 *
 * Renders a pill for each active filter value with an individual ✕ clear button,
 * plus a "Clear All" action that resets all filters at once (AC3).
 * Returns null when no filters are active.
 *
 * @module erp3/web/components/FilterPillTags
 */

import React from 'react';
import type { SalesOrderStatus, InvoiceStatus } from '@clearshift/contracts';

export interface Erp3ActiveFilters {
  search?: string | undefined;
  currency?: string | undefined;
  status?: SalesOrderStatus | InvoiceStatus | undefined;
  customer_golden_id?: string | undefined;
  order_id?: string | undefined;
}

export type Erp3FilterKey = keyof Erp3ActiveFilters;

export interface FilterPillTagsProps {
  readonly filters: Erp3ActiveFilters;
  readonly onRemoveFilter: (key: Erp3FilterKey) => void;
  readonly onClearAll: () => void;
  readonly disabled?: boolean;
}

interface PillItem {
  id: Erp3FilterKey;
  label: string;
  value: string;
  ariaLabel: string;
}

export const FilterPillTags: React.FC<FilterPillTagsProps> = ({
  filters,
  onRemoveFilter,
  onClearAll,
  disabled = false,
}) => {
  const pills: PillItem[] = [];

  if (filters.search && filters.search.trim()) {
    pills.push({
      id: 'search',
      label: 'Search',
      value: `"${filters.search.trim()}"`,
      ariaLabel: `Remove search filter: ${filters.search.trim()}`,
    });
  }

  if (filters.currency) {
    pills.push({
      id: 'currency',
      label: 'Currency',
      value: filters.currency,
      ariaLabel: `Remove currency filter: ${filters.currency}`,
    });
  }

  if (filters.status) {
    pills.push({
      id: 'status',
      label: 'Status',
      value: filters.status,
      ariaLabel: `Remove status filter: ${filters.status}`,
    });
  }

  if (filters.customer_golden_id) {
    pills.push({
      id: 'customer_golden_id',
      label: 'Customer ID',
      value: filters.customer_golden_id.slice(0, 8) + '…',
      ariaLabel: 'Remove customer filter',
    });
  }

  if (filters.order_id) {
    pills.push({
      id: 'order_id',
      label: 'Order ID',
      value: filters.order_id.slice(0, 8) + '…',
      ariaLabel: 'Remove order ID filter',
    });
  }

  if (pills.length === 0) {
    return null;
  }

  return (
    <div
      className="cs-erp3-active-pills-bar"
      role="region"
      aria-label="Active filters"
    >
      <span className="cs-erp3-active-pills-label">Active filters:</span>
      <ul className="cs-erp3-pills-list" aria-label="Active filter list">
        {pills.map((pill) => (
          <li key={pill.id} className="cs-erp3-pill-item">
            <span className="cs-erp3-pill-text">
              <strong className="cs-erp3-pill-tag">{pill.label}:</strong>{' '}
              {pill.value}
            </span>
            <button
              type="button"
              className="cs-erp3-pill-remove-btn"
              onClick={() => onRemoveFilter(pill.id)}
              disabled={disabled}
              aria-label={pill.ariaLabel}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="cs-erp3-btn-clear-all cs-btn-secondary"
        onClick={onClearAll}
        disabled={disabled}
        aria-label="Clear all active filters"
      >
        Clear All
      </button>
    </div>
  );
};

export default FilterPillTags;
