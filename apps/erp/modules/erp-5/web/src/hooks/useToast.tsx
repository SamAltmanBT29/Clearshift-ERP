/**
 * ERP-5 HR & Employees — Toast hook
 *
 * A tiny, self-contained notification channel for the module. The provider
 * is mounted once in `ModuleShell`, so a toast survives the route change that
 * follows a successful save (the create page navigates to the detail page
 * immediately after `onSaved`).
 *
 * The channel keeps at most one toast at a time and auto-dismisses it after
 * a short delay. A manual dismiss cancels the pending timer.
 *
 * @module erp5/web/hooks/useToast
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Toast } from '../components/Toast.js';
import type { ToastMessage } from '../components/Toast.js';

export interface ToastContextValue {
  readonly showToast: (message: string, variant?: 'success' | 'error') => void;
  readonly dismissToast: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 3000;

export interface ToastProviderProps {
  readonly children: React.ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (message: string, variant: 'success' | 'error' = 'success') => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToast({ id, message, variant });
      timerRef.current = setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, AUTO_DISMISS_MS);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      {toast ? (
        <Toast message={toast.message} variant={toast.variant} onDismiss={dismissToast} />
      ) : null}
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (value === null) {
    // The provider is mounted by the module shell. A page rendered in
    // isolation (for example, in a unit test) has no provider; in that case
    // the toast is a no-op rather than a crash, so the page stays testable.
    return { showToast: () => undefined, dismissToast: () => undefined };
  }
  return value;
}

// Re-export for convenience.
export { Toast } from '../components/Toast.js';