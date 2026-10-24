/**
 * ERP-2 Vendors & Purchasing — Active Filter Pill Tags
 *
 * Renders a pill for each active filter value with an individual ✕ clear button,
 * plus a "Clear All" action that resets all filters at once (AC3).
 * Returns null when no filters are active.
 *
 * @module erp2/web/components/FilterPillTags
 */

import React from 'react';
import type { PurchaseOrderStatus } from '@clearshift/contracts';

export interface Erp2ActiveFilters {
  search?: string | undefined;
  currency?: string | undefined;
  status?: PurchaseOrderStatus | undefined;
  vendor_id?: string | undefined;
}

export type Erp2FilterKey = keyof Erp2ActiveFilters;

export interface FilterPillTagsProps {
  readonly filters: Erp2ActiveFilters;
  readonly onRemoveFilter: (key: Erp2FilterKey) => void;
  readonly onClearAll: () => void;
  readonly disabled?: boolean;
}

interface PillItem {
  id: Erp2FilterKey;
  label: string;
  value: string;
  ariaLabel: string;
}

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  Draft: 'Draft',
  Sent: 'Sent',
  Received: 'Received',
  Closed: 'Closed',
};

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
    const statusLabel = STATUS_LABELS[filters.status] || filters.status;
    pills.push({
      id: 'status',
      label: 'Status',
      value: statusLabel,
      ariaLabel: `Remove status filter: ${statusLabel}`,
    });
  }

  if (filters.vendor_id) {
    pills.push({
      id: 'vendor_id',
      label: 'Vendor',
      value: filters.vendor_id.slice(0, 8) + '…',
      ariaLabel: `Remove vendor filter`,
    });
  }

  if (pills.length === 0) {
    return null;
  }

  return (
    <div
      className="cs-erp2-active-pills-bar"
      role="region"
      aria-label="Active filters"
    >
      <span className="cs-erp2-active-pills-label">Active filters:</span>
      <ul className="cs-erp2-pills-list" aria-label="Active filter list">
        {pills.map((pill) => (
          <li key={pill.id} className="cs-erp2-pill-item">
            <span className="cs-erp2-pill-text">
              <strong className="cs-erp2-pill-tag">{pill.label}:</strong>{' '}
              {pill.value}
            </span>
            <button
              type="button"
              className="cs-erp2-pill-remove-btn"
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
        className="cs-erp2-btn-clear-all"
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
