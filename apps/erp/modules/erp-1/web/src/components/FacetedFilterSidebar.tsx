import React, { useState } from 'react';
import type { Category, UnitOfMeasure, StockStatusFilter } from '@clearshift/contracts';

export interface FacetedFiltersState {
  categoryId?: string | undefined;
  unitOfMeasure?: UnitOfMeasure | undefined;
  stockStatus?: StockStatusFilter | undefined;
  minPrice?: string | undefined;
  maxPrice?: string | undefined;
}

export interface FacetedFilterSidebarProps {
  readonly categories: readonly Category[];
  readonly filters: FacetedFiltersState;
  readonly onFilterChange: (updated: Partial<FacetedFiltersState>) => void;
  readonly onResetFilters: () => void;
  readonly isLoading?: boolean;
  readonly isOpenMobile?: boolean;
  readonly onCloseMobile?: () => void;
}

const UNIT_OPTIONS: { value: UnitOfMeasure; label: string }[] = [
  { value: 'pcs', label: 'Pieces (pcs)' },
  { value: 'kg', label: 'Kilograms (kg)' },
  { value: 'g', label: 'Grams (g)' },
  { value: 'litre', label: 'Litres (litre)' },
  { value: 'metre', label: 'Metres (metre)' },
  { value: 'box', label: 'Boxes (box)' },
];

const STOCK_STATUS_OPTIONS: { value: StockStatusFilter; label: string }[] = [
  { value: 'all', label: 'All Stock Levels' },
  { value: 'in_stock', label: 'In Stock (> 10)' },
  { value: 'low_stock', label: 'Low Stock (1 - 10)' },
  { value: 'out_of_stock', label: 'Out of Stock (0)' },
];

export const FacetedFilterSidebar: React.FC<FacetedFilterSidebarProps> = ({
  categories,
  filters,
  onFilterChange,
  onResetFilters,
  isLoading = false,
  isOpenMobile = false,
  onCloseMobile,
}) => {
  const [minPriceInput, setMinPriceInput] = useState(filters.minPrice || '');
  const [maxPriceInput, setMaxPriceInput] = useState(filters.maxPrice || '');

  // Keep price inputs in sync when filters change from outside (e.g. pills or reset)
  React.useEffect(() => {
    setMinPriceInput(filters.minPrice || '');
  }, [filters.minPrice]);

  React.useEffect(() => {
    setMaxPriceInput(filters.maxPrice || '');
  }, [filters.maxPrice]);

  const handlePriceApply = (e: React.FormEvent) => {
    e.preventDefault();
    onFilterChange({
      minPrice: minPriceInput.trim() ? minPriceInput.trim() : undefined,
      maxPrice: maxPriceInput.trim() ? maxPriceInput.trim() : undefined,
    });
  };

  const hasActiveFacet =
    Boolean(filters.categoryId) ||
    Boolean(filters.unitOfMeasure) ||
    (Boolean(filters.stockStatus) && filters.stockStatus !== 'all') ||
    Boolean(filters.minPrice) ||
    Boolean(filters.maxPrice);

  return (
    <aside
      className={`cs-erp1-faceted-sidebar ${isOpenMobile ? 'mobile-open' : ''}`}
      role="complementary"
      aria-label="Faceted filters"
    >
      <div className="cs-erp1-sidebar-header">
        <h2 className="cs-erp1-sidebar-title">Filters</h2>
        {onCloseMobile && (
          <button
            type="button"
            className="cs-erp1-close-mobile-btn"
            onClick={onCloseMobile}
            aria-label="Close filters sidebar"
          >
            ✕
          </button>
        )}
      </div>

      {hasActiveFacet && (
        <div className="cs-erp1-sidebar-reset-container">
          <button
            type="button"
            className="cs-erp1-btn-reset-filters"
            onClick={onResetFilters}
            disabled={isLoading}
            aria-label="Clear all sidebar filters"
          >
            Clear All Sidebar Filters
          </button>
        </div>
      )}

      {/* 1. Category Facet */}
      <section className="cs-erp1-facet-group" aria-labelledby="facet-category-heading">
        <h3 id="facet-category-heading" className="cs-erp1-facet-heading">
          Categories
        </h3>
        <div className="cs-erp1-facet-content">
          <label className="cs-erp1-radio-option">
            <input
              type="radio"
              name="erp1-facet-category"
              value=""
              checked={!filters.categoryId}
              onChange={() => onFilterChange({ categoryId: undefined })}
              disabled={isLoading}
            />
            <span>All Categories</span>
          </label>
          {categories.map((cat) => (
            <label key={cat.id} className="cs-erp1-radio-option">
              <input
                type="radio"
                name="erp1-facet-category"
                value={cat.id}
                checked={filters.categoryId === cat.id}
                onChange={() => onFilterChange({ categoryId: cat.id })}
                disabled={isLoading}
              />
              <span>
                {cat.name} <span className="cs-erp1-code-badge">({cat.code})</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* 2. Unit of Measure Facet */}
      <section className="cs-erp1-facet-group" aria-labelledby="facet-uom-heading">
        <h3 id="facet-uom-heading" className="cs-erp1-facet-heading">
          Unit of Measure
        </h3>
        <div className="cs-erp1-facet-content">
          <label className="cs-erp1-radio-option">
            <input
              type="radio"
              name="erp1-facet-uom"
              value=""
              checked={!filters.unitOfMeasure}
              onChange={() => onFilterChange({ unitOfMeasure: undefined })}
              disabled={isLoading}
            />
            <span>All Units</span>
          </label>
          {UNIT_OPTIONS.map((opt) => (
            <label key={opt.value} className="cs-erp1-radio-option">
              <input
                type="radio"
                name="erp1-facet-uom"
                value={opt.value}
                checked={filters.unitOfMeasure === opt.value}
                onChange={() => onFilterChange({ unitOfMeasure: opt.value })}
                disabled={isLoading}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </section>

      {/* 3. Stock Status Facet */}
      <section className="cs-erp1-facet-group" aria-labelledby="facet-stock-heading">
        <h3 id="facet-stock-heading" className="cs-erp1-facet-heading">
          Stock Status
        </h3>
        <div className="cs-erp1-facet-content">
          {STOCK_STATUS_OPTIONS.map((opt) => (
            <label key={opt.value} className="cs-erp1-radio-option">
              <input
                type="radio"
                name="erp1-facet-stock"
                value={opt.value}
                checked={
                  (!filters.stockStatus && opt.value === 'all') ||
                  filters.stockStatus === opt.value
                }
                onChange={() =>
                  onFilterChange({
                    stockStatus: opt.value === 'all' ? undefined : opt.value,
                  })
                }
                disabled={isLoading}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </section>

      {/* 4. Price Range Facet */}
      <section className="cs-erp1-facet-group" aria-labelledby="facet-price-heading">
        <h3 id="facet-price-heading" className="cs-erp1-facet-heading">
          Price Range
        </h3>
        <form onSubmit={handlePriceApply} className="cs-erp1-price-form">
          <div className="cs-erp1-price-inputs">
            <div className="cs-erp1-price-field">
              <label htmlFor="erp1-min-price-input" className="cs-erp1-field-label">
                Min ($)
              </label>
              <input
                id="erp1-min-price-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="cs-erp1-input-number"
                value={minPriceInput}
                onChange={(e) => setMinPriceInput(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <span className="cs-erp1-price-separator" aria-hidden="true">
              –
            </span>
            <div className="cs-erp1-price-field">
              <label htmlFor="erp1-max-price-input" className="cs-erp1-field-label">
                Max ($)
              </label>
              <input
                id="erp1-max-price-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="1000.00"
                className="cs-erp1-input-number"
                value={maxPriceInput}
                onChange={(e) => setMaxPriceInput(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>
          <button
            type="submit"
            className="cs-erp1-btn-apply-price"
            disabled={isLoading}
            aria-label="Apply price range filter"
          >
            Apply Price
          </button>
        </form>
      </section>
    </aside>
  );
};

export default FacetedFilterSidebar;
