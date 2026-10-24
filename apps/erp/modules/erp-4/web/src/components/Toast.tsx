/**
 * ERP-4 Finance and Accounting — Confirmation Toast Notification
 *
 * Provides an accessible, animated toast confirmation banner with auto-dismissal
 * and close button conforming to WCAG 2.1 status announcement standards.
 *
 * @module erp4/web/components/Toast
 */

import React, { useEffect } from 'react';

export interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
  durationMs?: number;
  className?: string;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'success',
  onClose,
  durationMs = 4000,
  className = '',
}) => {
  useEffect(() => {
    if (durationMs <= 0) return;
    const timer = setTimeout(() => {
      onClose();
    }, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onClose]);

  const typeStyles = {
    success: {
      bg: 'bg-[var(--cs-ok-bg,#ecfdf5)]',
      border: 'border-[var(--cs-ok,#059669)]',
      text: 'text-[var(--cs-ok,#065f46)]',
      icon: '✓',
    },
    error: {
      bg: 'bg-[var(--cs-err-bg,#fef2f2)]',
      border: 'border-[var(--cs-err,#dc2626)]',
      text: 'text-[var(--cs-err,#991b1b)]',
      icon: '✕',
    },
    info: {
      bg: 'bg-[var(--cs-surface,#eff6ff)]',
      border: 'border-[var(--cs-accent,#2563eb)]',
      text: 'text-[var(--cs-accent,#1e40af)]',
      icon: 'ℹ',
    },
  }[type];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg transition-all transform animate-in fade-in slide-in-from-bottom-2 ${typeStyles.bg} ${typeStyles.border} ${typeStyles.text} ${className}`}
    >
      <span className="text-base font-bold select-none" aria-hidden="true">
        {typeStyles.icon}
      </span>
      <p className="text-sm font-medium pr-2">{message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close notification"
        className="ml-auto rounded p-1 hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-current text-xs font-semibold"
      >
        ✕
      </button>
    </div>
  );
};

export default Toast;
