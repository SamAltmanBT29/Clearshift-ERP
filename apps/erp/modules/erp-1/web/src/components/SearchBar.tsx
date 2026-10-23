import React, { useEffect, useState, useRef } from 'react';

export interface SearchBarProps {
  readonly value: string;
  readonly onChange: (debouncedValue: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly debounceMs?: number;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = 'Search products by name or SKU...',
  disabled = false,
  debounceMs = 300,
}) => {
  const [internalText, setInternalText] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync internal state when prop value changes externally (e.g. from URL or Clear All)
  useEffect(() => {
    setInternalText(value);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [value]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value;
    setInternalText(nextVal);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      onChange(nextVal);
      timerRef.current = null;
    }, debounceMs);
  };

  const handleClear = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setInternalText('');
    onChange('');
  };

  return (
    <div className="cs-erp1-search-container" role="search" aria-label="Search products">
      <div className="cs-erp1-search-wrapper">
        <label htmlFor="erp1-product-search-input" className="cs-erp1-sr-only">
          Search products by name or SKU
        </label>
        <span className="cs-erp1-search-icon" aria-hidden="true">
          🔍
        </span>
        <input
          id="erp1-product-search-input"
          type="search"
          className="cs-erp1-search-input"
          placeholder={placeholder}
          value={internalText}
          onChange={handleInputChange}
          disabled={disabled}
          aria-label="Search products by name or SKU"
          autoComplete="off"
        />
        {internalText.length > 0 && (
          <button
            type="button"
            className="cs-erp1-search-clear-btn"
            onClick={handleClear}
            disabled={disabled}
            aria-label="Clear search input"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
