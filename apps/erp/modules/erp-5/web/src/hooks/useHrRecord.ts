/**
 * ERP-5 HR & Employees — Single Record Hook
 *
 * Loads one record — an employee, a department, a leave record — and keeps
 * the request cancelable, so a screen that is left before the answer
 * arrives does not write into a component that is gone.
 *
 * @module erp5/web/hooks/useHrRecord
 */

import { useCallback, useEffect, useState } from 'react';
import { isAbortError, toHrApiError, type HrApiError } from '../api/erp-5.js';

export interface UseHrRecordResult<T> {
  /** The record, or `null` while it is loading or when it could not be read. */
  readonly record: T | null;
  readonly isLoading: boolean;
  readonly error: HrApiError | null;
  /** Loads the record again — the retry action of the failure state. */
  readonly reload: () => void;
}

export function useHrRecord<T>(
  fetcher: (signal: AbortSignal) => Promise<T>
): UseHrRecordResult<T> {
  const [record, setRecord] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<HrApiError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const fetcherRef = useCallback(fetcher, [fetcher]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setIsLoading(true);
    setError(null);

    fetcherRef(controller.signal)
      .then((loaded) => {
        if (!active) {
          return;
        }
        setRecord(loaded);
        setIsLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause)) {
          return;
        }
        setRecord(null);
        setError(toHrApiError(cause));
        setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // `fetcherRef` is stable for the lifetime of the screen.
  }, [fetcherRef, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { record, isLoading, error, reload };
}
