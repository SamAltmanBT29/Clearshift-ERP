import React from 'react';
import type { ProductSortField } from '@clearshift/contracts';

export interface SortingControlsProps {
  readonly sortBy: ProductSortField;
  readonly sortDirection: 'asc' | 'desc';
  readonly onSortChange: (sortBy: ProductSortField, sortDirection: 'asc' | 'desc') => void;
  readonly disabled?: boolean;
}

const SORT_OPTIONS: { value: ProductSortField; label: string }[] = [
  { value: 'name', label: 'Product Name' },
  { value: 'sku', label: 'SKU' },
  { value: 'price', label: 'Price' },
  { value: 'createdAt', label: 'Date Created' },
  { value: 'quantity', label: 'Stock Quantity' },
];

export const SortingControls: React.FC<SortingControlsProps> = ({
  sortBy,
  sortDirection,
  onSortChange,
  disabled = false,
}) => {
  const handleFieldChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onSortChange(e.target.value as ProductSortField, sortDirection);
  };

  const handleToggleDirection = () => {
    const nextDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    onSortChange(sortBy, nextDirection);
  };

  return (
    <div className="cs-erp1-sort-controls">
      <div className="cs-erp1-sort-field-wrapper">
        <label htmlFor="erp1-sort-field-select" className="cs-erp1-sort-label">
          Sort by:
        </label>
        <select
          id="erp1-sort-field-select"
          className="cs-erp1-sort-select"
          value={sortBy}
          onChange={handleFieldChange}
          disabled={disabled}
          aria-label="Sort products by column"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="cs-erp1-sort-direction-btn"
        onClick={handleToggleDirection}
        disabled={disabled}
        aria-label={`Toggle sort order, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
        title={`Sort ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
      >
        <span className="cs-erp1-sort-icon" aria-hidden="true">
          {sortDirection === 'asc' ? '▲ Asc' : '▼ Desc'}
        </span>
      </button>
    </div>
  );
};

export default SortingControls;
