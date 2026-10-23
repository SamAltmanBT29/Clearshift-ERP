import React from 'react';
import type { Category, UnitOfMeasure, StockStatusFilter, ProductSortField } from '@clearshift/contracts';

export interface ActiveFiltersState {
  search?: string | undefined;
  categoryId?: string | undefined;
  unitOfMeasure?: UnitOfMeasure | undefined;
  stockStatus?: StockStatusFilter | undefined;
  minPrice?: string | undefined;
  maxPrice?: string | undefined;
  sortBy?: ProductSortField | undefined;
  sortDirection?: 'asc' | 'desc' | undefined;
}

export interface FilterPillTagsProps {
  readonly filters: ActiveFiltersState;
  readonly categories: readonly Category[];
  readonly onRemoveFilter: (filterKey: keyof ActiveFiltersState) => void;
  readonly onClearAll: () => void;
  readonly disabled?: boolean;
}

const STOCK_STATUS_LABELS: Record<StockStatusFilter, string> = {
  all: 'All',
  in_stock: 'In Stock',
  low_stock: 'Low Stock',
  out_of_stock: 'Out of Stock',
};

const SORT_FIELD_LABELS: Record<ProductSortField, string> = {
  name: 'Product Name',
  sku: 'SKU',
  price: 'Price',
  createdAt: 'Date Created',
  quantity: 'Stock Quantity',
};

export const FilterPillTags: React.FC<FilterPillTagsProps> = ({
  filters,
  categories,
  onRemoveFilter,
  onClearAll,
  disabled = false,
}) => {
  interface PillItem {
    id: keyof ActiveFiltersState;
    label: string;
    value: string;
    ariaLabel: string;
  }

  const pills: PillItem[] = [];

  if (filters.search && filters.search.trim()) {
    pills.push({
      id: 'search',
      label: 'Search',
      value: `"${filters.search.trim()}"`,
      ariaLabel: `Remove search filter: ${filters.search.trim()}`,
    });
  }

  if (filters.categoryId) {
    const category = categories.find((c) => c.id === filters.categoryId);
    const catName = category ? `${category.name} (${category.code})` : filters.categoryId;
    pills.push({
      id: 'categoryId',
      label: 'Category',
      value: catName,
      ariaLabel: `Remove category filter: ${catName}`,
    });
  }

  if (filters.unitOfMeasure) {
    pills.push({
      id: 'unitOfMeasure',
      label: 'Unit',
      value: filters.unitOfMeasure,
      ariaLabel: `Remove unit of measure filter: ${filters.unitOfMeasure}`,
    });
  }

  if (filters.stockStatus && filters.stockStatus !== 'all') {
    const label = STOCK_STATUS_LABELS[filters.stockStatus] || filters.stockStatus;
    pills.push({
      id: 'stockStatus',
      label: 'Stock',
      value: label,
      ariaLabel: `Remove stock status filter: ${label}`,
    });
  }

  if (filters.minPrice) {
    pills.push({
      id: 'minPrice',
      label: 'Min Price',
      value: `$${filters.minPrice}`,
      ariaLabel: `Remove min price filter: $${filters.minPrice}`,
    });
  }

  if (filters.maxPrice) {
    pills.push({
      id: 'maxPrice',
      label: 'Max Price',
      value: `$${filters.maxPrice}`,
      ariaLabel: `Remove max price filter: $${filters.maxPrice}`,
    });
  }

  if (filters.sortBy && filters.sortBy !== 'name') {
    const sortLabel = SORT_FIELD_LABELS[filters.sortBy] || filters.sortBy;
    const dir = filters.sortDirection === 'desc' ? 'Desc' : 'Asc';
    pills.push({
      id: 'sortBy',
      label: 'Sorted By',
      value: `${sortLabel} (${dir})`,
      ariaLabel: `Reset sort to default`,
    });
  }

  if (pills.length === 0) {
    return null;
  }

  return (
    <div
      className="cs-erp1-active-pills-bar"
      role="region"
      aria-label="Active filters"
    >
      <span className="cs-erp1-active-pills-label">Active filters:</span>
      <ul className="cs-erp1-pills-list">
        {pills.map((pill) => (
          <li key={pill.id} className="cs-erp1-pill-item">
            <span className="cs-erp1-pill-text">
              <strong className="cs-erp1-pill-tag">{pill.label}:</strong> {pill.value}
            </span>
            <button
              type="button"
              className="cs-erp1-pill-remove-btn"
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
        className="cs-erp1-btn-clear-all"
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
