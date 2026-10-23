/**
 * ERP-5 HR & Employees — Bounded List Hook
 *
 * Drives one collection screen:
 *
 *   - the query is sent to the **server**, never applied in the browser;
 *   - a new query cancels the request in flight;
 *   - a failure is normalised into an {@link HrApiError};
 *   - `reload()` re-runs the current query after a recoverable failure.
 *
 * The effect depends on a *serialised* form of the query, so a re-render
 * that rebuilds an equal query object does not trigger a second request.
 *
 * @module erp5/web/hooks/useHrList
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HrListMeta } from '@clearshift/contracts';
import { isAbortError, toHrApiError, type HrApiError, type HrListResponse } from '../api/erp-5.js';

export interface HrListQuery {
  readonly page: number;
}

export interface UseHrListResult<T> {
  /** The rows of the current page. */
  readonly items: readonly T[];
  /** The paging metadata the server returned. */
  readonly meta: HrListMeta | null;
  /** True while a request is in flight. */
  readonly isLoading: boolean;
  /** The failure of the last request, or `null`. */
  readonly error: HrApiError | null;
  /** Re-runs the current query — the retry action of the error state. */
  readonly reload: () => void;
}

export function useHrList<T, Q extends HrListQuery>(
  fetcher: (query: Q, signal: AbortSignal) => Promise<HrListResponse<T>>,
  query: Q
): UseHrListResult<T> {
  const [items, setItems] = useState<readonly T[]>([]);
  const [meta, setMeta] = useState<HrListMeta | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<HrApiError | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  // The fetcher and the query are read through refs so that a caller may
  // pass an inline function or a freshly built query object without the
  // effect re-running.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const queryRef = useRef(query);
  queryRef.current = query;

  const queryKey = JSON.stringify(query);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setIsLoading(true);
    setError(null);

    fetcherRef
      .current(queryRef.current, controller.signal)
      .then((response) => {
        if (!active) {
          return;
        }
        setItems(response.data);
        setMeta(response.meta);
        setIsLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause)) {
          return;
        }
        setItems([]);
        setMeta(null);
        setError(toHrApiError(cause));
        setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [queryKey, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { items, meta, isLoading, error, reload };
}
