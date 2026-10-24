/**
 * ERP-2 Vendors & Purchasing — Faceted Filter Sidebar
 *
 * Renders faceted filter groups for vendors (currency) or purchase orders (status).
 * Filter changes are immediately reflected in URL query state and trigger table reloads (AC2).
 * Collapsible on mobile via isOpen toggle.
 *
 * @module erp2/web/components/FilterSidebar
 */

import React from 'react';
import type { PurchaseOrderStatus } from '@clearshift/contracts';

// ─── Vendor Facets ────────────────────────────────────────────────────────────

const VENDOR_CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Currencies' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'AUD', label: 'AUD — Australian Dollar' },
];

export interface VendorFacets {
  currency?: string | undefined;
}

export interface VendorFilterSidebarProps {
  readonly filters: VendorFacets;
  readonly onFilterChange: (updated: Partial<VendorFacets>) => void;
  readonly onResetFilters: () => void;
  readonly isLoading?: boolean;
  readonly isOpen?: boolean;
  readonly onToggle?: () => void;
}

export const VendorFilterSidebar: React.FC<VendorFilterSidebarProps> = ({
  filters,
  onFilterChange,
  onResetFilters,
  isLoading = false,
  isOpen = true,
  onToggle,
}) => {
  const hasActiveFacet = Boolean(filters.currency);

  return (
    <aside
      className={`cs-erp2-faceted-sidebar ${isOpen ? 'is-open' : 'is-collapsed'}`}
      role="complementary"
      aria-label="Vendor faceted filters"
    >
      <div className="cs-erp2-sidebar-header">
        <h2 className="cs-erp2-sidebar-title">Filters</h2>
        {onToggle && (
          <button
            type="button"
            className="cs-erp2-sidebar-toggle-btn"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={isOpen ? 'Collapse filters sidebar' : 'Expand filters sidebar'}
          >
            {isOpen ? '◀' : '▶'}
          </button>
        )}
      </div>

      {isOpen && (
        <>
          {hasActiveFacet && (
            <div className="cs-erp2-sidebar-reset-container">
              <button
                type="button"
                className="cs-erp2-btn-reset-filters"
                onClick={onResetFilters}
                disabled={isLoading}
                aria-label="Clear all sidebar filters"
              >
                Clear Sidebar Filters
              </button>
            </div>
          )}

          {/* Currency Facet */}
          <section
            className="cs-erp2-facet-group"
            aria-labelledby="erp2-facet-currency-heading"
          >
            <h3
              id="erp2-facet-currency-heading"
              className="cs-erp2-facet-heading"
            >
              Currency
            </h3>
            <div className="cs-erp2-facet-content">
              {VENDOR_CURRENCY_OPTIONS.map((opt) => (
                <label key={opt.value || 'all'} className="cs-erp2-radio-option">
                  <input
                    type="radio"
                    name="erp2-facet-currency"
                    value={opt.value}
                    checked={
                      opt.value === ''
                        ? !filters.currency
                        : filters.currency === opt.value
                    }
                    onChange={() =>
                      onFilterChange({
                        currency: opt.value || undefined,
                      })
                    }
                    disabled={isLoading}
                    aria-label={opt.label}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </section>
        </>
      )}
    </aside>
  );
};

// ─── Purchase Order Facets ─────────────────────────────────────────────────────

const PO_STATUS_OPTIONS: { value: PurchaseOrderStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'Draft', label: 'Draft' },
  { value: 'Sent', label: 'Sent' },
  { value: 'Received', label: 'Received' },
  { value: 'Closed', label: 'Closed' },
];

export interface POFacets {
  status?: PurchaseOrderStatus | undefined;
}

export interface POFilterSidebarProps {
  readonly filters: POFacets;
  readonly onFilterChange: (updated: Partial<POFacets>) => void;
  readonly onResetFilters: () => void;
  readonly isLoading?: boolean;
  readonly isOpen?: boolean;
  readonly onToggle?: () => void;
}

export const POFilterSidebar: React.FC<POFilterSidebarProps> = ({
  filters,
  onFilterChange,
  onResetFilters,
  isLoading = false,
  isOpen = true,
  onToggle,
}) => {
  const hasActiveFacet = Boolean(filters.status);

  return (
    <aside
      className={`cs-erp2-faceted-sidebar ${isOpen ? 'is-open' : 'is-collapsed'}`}
      role="complementary"
      aria-label="Purchase order faceted filters"
    >
      <div className="cs-erp2-sidebar-header">
        <h2 className="cs-erp2-sidebar-title">Filters</h2>
        {onToggle && (
          <button
            type="button"
            className="cs-erp2-sidebar-toggle-btn"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={isOpen ? 'Collapse filters sidebar' : 'Expand filters sidebar'}
          >
            {isOpen ? '◀' : '▶'}
          </button>
        )}
      </div>

      {isOpen && (
        <>
          {hasActiveFacet && (
            <div className="cs-erp2-sidebar-reset-container">
              <button
                type="button"
                className="cs-erp2-btn-reset-filters"
                onClick={onResetFilters}
                disabled={isLoading}
                aria-label="Clear all sidebar filters"
              >
                Clear Sidebar Filters
              </button>
            </div>
          )}

          {/* Status Facet */}
          <section
            className="cs-erp2-facet-group"
            aria-labelledby="erp2-facet-po-status-heading"
          >
            <h3
              id="erp2-facet-po-status-heading"
              className="cs-erp2-facet-heading"
            >
              Order Status
            </h3>
            <div className="cs-erp2-facet-content">
              {PO_STATUS_OPTIONS.map((opt) => (
                <label
                  key={opt.value || 'all'}
                  className="cs-erp2-radio-option"
                >
                  <input
                    type="radio"
                    name="erp2-facet-po-status"
                    value={opt.value}
                    checked={
                      opt.value === ''
                        ? !filters.status
                        : filters.status === opt.value
                    }
                    onChange={() =>
                      onFilterChange({
                        status: (opt.value as PurchaseOrderStatus) || undefined,
                      })
                    }
                    disabled={isLoading}
                    aria-label={opt.label}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </section>
        </>
      )}
    </aside>
  );
};

export default VendorFilterSidebar;
