/**
 * ERP-5 HR & Employees — Debounced Value Hook
 *
 * A search box must not fire a request per keystroke. The value is held
 * back for `delayMs` before it is published, so the list screen sends one
 * server query per pause in typing instead of one per character.
 *
 * @module erp5/web/hooks/useDebouncedValue
 */

import { useEffect, useState } from 'react';

/** The pause before a search term is sent to the server. */
export const SEARCH_DEBOUNCE_MS = 300;

export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
