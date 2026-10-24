/**
 * ERP-3 Sales Orders & Invoices — Debounced Search Bar
 *
 * 300ms debounce prevents API calls on every keystroke (AC1).
 * Internal state keeps display value in sync with external reset (Clear All).
 * Timer is cleaned up on unmount to prevent memory leaks.
 *
 * @module erp3/web/components/SearchBar
 */

import React, { useEffect, useState, useRef } from 'react';

export interface SearchBarProps {
  readonly value: string;
  readonly onChange: (debouncedValue: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Debounce delay in milliseconds. Defaults to 300ms per AC1. */
  readonly debounceMs?: number;
  /** Unique input id (required for label association). */
  readonly inputId?: string;
  /** aria-label for the search input and region. */
  readonly ariaLabel?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
  disabled = false,
  debounceMs = 300,
  inputId = 'erp3-search-input',
  ariaLabel = 'Search',
}) => {
  const [internalText, setInternalText] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync internal state when prop value changes externally (e.g. Clear All reset)
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
    <div className="cs-erp3-search-container" role="search">
      <div className="cs-erp3-search-wrapper">
        <label htmlFor={inputId} className="sr-only">
          {ariaLabel}
        </label>
        <span className="cs-erp3-search-icon" aria-hidden="true">
          🔍
        </span>
        <input
          id={inputId}
          type="search"
          className="cs-erp3-search-input cs-input"
          placeholder={placeholder}
          value={internalText}
          onChange={handleInputChange}
          disabled={disabled}
          aria-label={ariaLabel}
          autoComplete="off"
        />
        {internalText.length > 0 && (
          <button
            type="button"
            className="cs-erp3-search-clear-btn"
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
