import { useState, useEffect } from 'react';

/**
 * useDebouncedValue hook
 *
 * Debounces a value changes by a specified delay in milliseconds (default: 300ms).
 * Strictly enforces the 300ms debouncing acceptance criterion for search queries.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
