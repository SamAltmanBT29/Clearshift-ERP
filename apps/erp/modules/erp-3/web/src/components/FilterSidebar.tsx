/**
 * ERP-3 Sales Orders & Invoices — Faceted Filter Sidebar
 *
 * Renders faceted filter groups for sales orders (status, currency)
 * and invoices (status, currency).
 * Filter changes update state immediately and trigger table reloads (AC2).
 * Collapsible via isOpen / onToggle.
 *
 * @module erp3/web/components/FilterSidebar
 */

import React from 'react';
import type { SalesOrderStatus, InvoiceStatus } from '@clearshift/contracts';

// ─── Shared Currency Options ──────────────────────────────────────────────────

export const ERP3_CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Currencies' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'AUD', label: 'AUD — Australian Dollar' },
];

// ─── Sales Order Facets ───────────────────────────────────────────────────────

const SO_STATUS_OPTIONS: { value: SalesOrderStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'Open', label: 'Open' },
  { value: 'Invoiced', label: 'Invoiced' },
  { value: 'Closed', label: 'Closed' },
];

export interface SalesOrderFacets {
  status?: SalesOrderStatus | undefined;
  currency?: string | undefined;
}

export interface SalesOrderFilterSidebarProps {
  readonly filters: SalesOrderFacets;
  readonly onFilterChange: (updated: Partial<SalesOrderFacets>) => void;
  readonly onResetFilters: () => void;
  readonly isLoading?: boolean;
  readonly isOpen?: boolean;
  readonly onToggle?: () => void;
}

export const SalesOrderFilterSidebar: React.FC<SalesOrderFilterSidebarProps> = ({
  filters,
  onFilterChange,
  onResetFilters,
  isLoading = false,
  isOpen = true,
  onToggle,
}) => {
  const hasActiveFacet = Boolean(filters.status) || Boolean(filters.currency);

  return (
    <aside
      className={`cs-erp3-faceted-sidebar ${isOpen ? 'is-open' : 'is-collapsed'}`}
      role="complementary"
      aria-label="Sales order faceted filters"
    >
      <div className="cs-erp3-sidebar-header">
        <h2 className="cs-erp3-sidebar-title">Filters</h2>
        {onToggle && (
          <button
            type="button"
            className="cs-erp3-sidebar-toggle-btn"
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
            <div className="cs-erp3-sidebar-reset-container">
              <button
                type="button"
                className="cs-erp3-btn-reset-filters"
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
            className="cs-erp3-facet-group"
            aria-labelledby="erp3-facet-so-status-heading"
          >
            <h3
              id="erp3-facet-so-status-heading"
              className="cs-erp3-facet-heading"
            >
              Order Status
            </h3>
            <div className="cs-erp3-facet-content">
              {SO_STATUS_OPTIONS.map((opt) => (
                <label key={opt.value || 'all'} className="cs-erp3-radio-option">
                  <input
                    type="radio"
                    name="erp3-facet-so-status"
                    value={opt.value}
                    checked={
                      opt.value === ''
                        ? !filters.status
                        : filters.status === opt.value
                    }
                    onChange={() =>
                      onFilterChange({
                        status: (opt.value as SalesOrderStatus) || undefined,
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

          {/* Currency Facet */}
          <section
            className="cs-erp3-facet-group"
            aria-labelledby="erp3-facet-so-currency-heading"
          >
            <h3
              id="erp3-facet-so-currency-heading"
              className="cs-erp3-facet-heading"
            >
              Currency
            </h3>
            <div className="cs-erp3-facet-content">
              {ERP3_CURRENCY_OPTIONS.map((opt) => (
                <label key={opt.value || 'all'} className="cs-erp3-radio-option">
                  <input
                    type="radio"
                    name="erp3-facet-so-currency"
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

// ─── Invoice Facets ───────────────────────────────────────────────────────────

const INVOICE_STATUS_OPTIONS: { value: InvoiceStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'Open', label: 'Open' },
  { value: 'Paid', label: 'Paid' },
  { value: 'Overdue', label: 'Overdue' },
];

export interface InvoiceFacets {
  status?: InvoiceStatus | undefined;
  currency?: string | undefined;
}

export interface InvoiceFilterSidebarProps {
  readonly filters: InvoiceFacets;
  readonly onFilterChange: (updated: Partial<InvoiceFacets>) => void;
  readonly onResetFilters: () => void;
  readonly isLoading?: boolean;
  readonly isOpen?: boolean;
  readonly onToggle?: () => void;
}

export const InvoiceFilterSidebar: React.FC<InvoiceFilterSidebarProps> = ({
  filters,
  onFilterChange,
  onResetFilters,
  isLoading = false,
  isOpen = true,
  onToggle,
}) => {
  const hasActiveFacet = Boolean(filters.status) || Boolean(filters.currency);

  return (
    <aside
      className={`cs-erp3-faceted-sidebar ${isOpen ? 'is-open' : 'is-collapsed'}`}
      role="complementary"
      aria-label="Invoice faceted filters"
    >
      <div className="cs-erp3-sidebar-header">
        <h2 className="cs-erp3-sidebar-title">Filters</h2>
        {onToggle && (
          <button
            type="button"
            className="cs-erp3-sidebar-toggle-btn"
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
            <div className="cs-erp3-sidebar-reset-container">
              <button
                type="button"
                className="cs-erp3-btn-reset-filters"
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
            className="cs-erp3-facet-group"
            aria-labelledby="erp3-facet-inv-status-heading"
          >
            <h3
              id="erp3-facet-inv-status-heading"
              className="cs-erp3-facet-heading"
            >
              Invoice Status
            </h3>
            <div className="cs-erp3-facet-content">
              {INVOICE_STATUS_OPTIONS.map((opt) => (
                <label key={opt.value || 'all'} className="cs-erp3-radio-option">
                  <input
                    type="radio"
                    name="erp3-facet-inv-status"
                    value={opt.value}
                    checked={
                      opt.value === ''
                        ? !filters.status
                        : filters.status === opt.value
                    }
                    onChange={() =>
                      onFilterChange({
                        status: (opt.value as InvoiceStatus) || undefined,
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

          {/* Currency Facet */}
          <section
            className="cs-erp3-facet-group"
            aria-labelledby="erp3-facet-inv-currency-heading"
          >
            <h3
              id="erp3-facet-inv-currency-heading"
              className="cs-erp3-facet-heading"
            >
              Currency
            </h3>
            <div className="cs-erp3-facet-content">
              {ERP3_CURRENCY_OPTIONS.map((opt) => (
                <label key={opt.value || 'all'} className="cs-erp3-radio-option">
                  <input
                    type="radio"
                    name="erp3-facet-inv-currency"
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

export default SalesOrderFilterSidebar;
