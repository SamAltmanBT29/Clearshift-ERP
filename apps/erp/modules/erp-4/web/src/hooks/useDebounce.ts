import { useState, useEffect } from 'react';

/**
 * Hook to debounce value changes by a specified delay (default 300ms).
 * Strictly conforms to ERP4-18 Acceptance Criteria:
 * "Search input debounces keystrokes (300ms) before triggering API requests."
 *
 * @param value The value to debounce
 * @param delay The delay in milliseconds (default 300ms)
 * @returns Debounced value
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
