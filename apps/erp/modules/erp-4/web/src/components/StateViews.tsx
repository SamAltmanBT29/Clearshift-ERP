/**
 * ERP-4 Finance and Accounting — State Views & Visual Feedback System
 *
 * Implements:
 * - Animated skeleton table placeholder for initial data fetching
 * - Zero-data empty states with clear call-to-action buttons
 * - Sanitized error alert banners with retry actions, suppressing stack traces
 * - 403 Forbidden access-denied views explaining missing RBAC roles
 *
 * @module erp4/web/components/StateViews
 */

import React from 'react';
import type { AccountType } from '@clearshift/contracts';
import { Alert } from '@cs/ui';
import { sanitizeErrorMessage, type SanitizedErrorInfo } from '../utils/error-sanitizer.js';
import { AccessDeniedView } from './AccessDeniedView.js';

export { AccessDeniedView } from './AccessDeniedView.js';
export {
  sanitizeErrorMessage,
  containsRawStackTrace,
  DEFAULT_FINANCE_ROLES,
  type SanitizedErrorInfo,
} from '../utils/error-sanitizer.js';

export interface SkeletonTableProps {
  columns?: number;
  rows?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * ⏳ Loading State: Animated skeleton placeholder table during data fetching
 * Conforms to ERP4-19 Acceptance Criterion #1.
 */
export const SkeletonTable: React.FC<SkeletonTableProps> = ({
  columns = 5,
  rows = 6,
  className = '',
  ariaLabel = 'Loading financial ledger data',
}) => {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={ariaLabel}
      className={`cs-skeleton-container animate-pulse rounded-lg border border-[var(--cs-border,#e5e7eb)] bg-[var(--cs-surface,#ffffff)] overflow-hidden shadow-sm ${className}`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse" aria-hidden="true">
          <thead className="bg-[var(--cs-bg,#f9fafb)] border-b border-[var(--cs-border,#e5e7eb)]">
            <tr>
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="p-3">
                  <div
                    className="h-4 bg-[var(--cs-border,#e5e7eb)] rounded"
                    style={{ width: `${50 + (i % 3) * 15}%` }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--cs-border,#e5e7eb)]/60">
            {Array.from({ length: rows }).map((_, rIdx) => (
              <tr key={rIdx} className="bg-[var(--cs-surface,#ffffff)]">
                {Array.from({ length: columns }).map((_, cIdx) => (
                  <td key={cIdx} className="p-3">
                    <div
                      className="h-3.5 bg-[var(--cs-border,#e5e7eb)]/70 rounded"
                      style={{ width: `${35 + ((cIdx + rIdx) % 5) * 12}%` }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-3 text-center text-xs font-medium text-[var(--cs-text-muted,#6b7280)] bg-[var(--cs-bg,#f9fafb)] border-t border-[var(--cs-border,#e5e7eb)]">
        Loading data from API...
      </div>
      <span className="sr-only">Loading content, please wait...</span>
    </div>
  );
};

export interface EmptyStateProps {
  icon?: React.ReactNode | undefined;
  title?: string | undefined;
  message?: string | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  secondaryActionLabel?: string | undefined;
  onSecondaryAction?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * 📄 Empty State: Polished zero-data view with prominent Call-to-Action button
 * Conforms to ERP4-19 Acceptance Criterion #2.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title = 'No records found',
  message = 'There are no financial records matching your current criteria.',
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
}) => {
  return (
    <div
      role="region"
      aria-label="Empty state results"
      className={`cs-empty-state flex flex-col items-center justify-center p-8 rounded-lg border border-dashed border-[var(--cs-border,#d1d5db)] bg-[var(--cs-surface,#ffffff)] text-center my-4 ${className}`}
    >
      <div className="cs-empty-icon text-3xl mb-3 text-[var(--cs-text-muted,#9ca3af)]" aria-hidden="true">
        {icon || '📂'}
      </div>
      <h3 className="cs-empty-title text-base font-semibold text-[var(--cs-text,#1f2937)] mb-1">
        {title}
      </h3>
      <p className="cs-empty-text text-sm text-[var(--cs-text-muted,#6b7280)] max-w-md mb-4">
        {message}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {actionLabel && onAction && (
          <button
            type="button"
            className="cs-btn cs-btn-primary px-4 py-2 rounded text-sm font-medium bg-[var(--cs-accent,#2563eb)] text-white hover:bg-[var(--cs-accent-hover,#1d4ed8)] focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent,#2563eb)] transition-colors"
            onClick={onAction}
            aria-label={actionLabel}
          >
            {actionLabel}
          </button>
        )}
        {secondaryActionLabel && onSecondaryAction && (
          <button
            type="button"
            className="cs-btn cs-btn-secondary px-4 py-2 rounded text-sm font-medium border border-[var(--cs-border,#d1d5db)] bg-[var(--cs-bg,#ffffff)] text-[var(--cs-text,#374151)] hover:bg-[var(--cs-surface,#f3f4f6)] transition-colors"
            onClick={onSecondaryAction}
            aria-label={secondaryActionLabel}
          >
            {secondaryActionLabel}
          </button>
        )}
      </div>
    </div>
  );
};

export interface ErrorAlertProps {
  error?: unknown | undefined;
  title?: string | undefined;
  message?: string | undefined;
  onRetry?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
  className?: string | undefined;
  id?: string | undefined;
}

/**
 * ⚠️ Alert Banner with Retry Action: Sanitizes errors and suppresses raw stack traces
 * Conforms to ERP4-19 Acceptance Criterion #3.
 */
export const ErrorAlert: React.FC<ErrorAlertProps> = ({
  error,
  title: propTitle,
  message: propMessage,
  onRetry,
  onDismiss,
  className = '',
  id,
}) => {
  const sanitized: SanitizedErrorInfo = error
    ? sanitizeErrorMessage(error)
    : {
        title: propTitle || 'Request Error',
        message: propMessage || 'An unexpected error occurred.',
        isForbidden: false,
        isUnauthorized: false,
        isNotFound: false,
      };

  const displayTitle = propTitle || sanitized.title;
  const displayMessage = propMessage || sanitized.message;

  return (
    <div className={`my-3 ${className}`} id={id}>
      <Alert
        variant="error"
        title={displayTitle}
        {...(onDismiss ? { onDismiss } : {})}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-1">
          <p className="text-sm text-[var(--cs-text,#374151)]">
            {displayMessage}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded border border-[var(--cs-err,#dc2626)] bg-[var(--cs-bg,#ffffff)] text-[var(--cs-err,#dc2626)] hover:bg-[var(--cs-err-bg,#fef2f2)] focus:outline-none focus:ring-2 focus:ring-[var(--cs-err,#dc2626)] transition-colors shrink-0"
              aria-label="Retry failed operation"
            >
              ↻ Retry Action
            </button>
          )}
        </div>
      </Alert>
    </div>
  );
};

export interface ErrorStateProps {
  error?: unknown | undefined;
  title?: string | undefined;
  message?: string | undefined;
  onRetry?: (() => void) | undefined;
  retryLabel?: string | undefined;
  requiredRoles?: string[] | undefined;
  className?: string | undefined;
}

/**
 * ⚠️ Recoverable Error State Card:
 * Automatically routes 403 Forbidden to AccessDeniedView and sanitizes raw stack traces.
 */
export const ErrorState: React.FC<ErrorStateProps> = ({
  error,
  title: propTitle,
  message: propMessage,
  onRetry,
  retryLabel = 'Retry Request',
  requiredRoles,
  className = '',
}) => {
  const sanitized: SanitizedErrorInfo = error
    ? sanitizeErrorMessage(error)
    : {
        title: propTitle || 'Failed to load records',
        message: propMessage || 'An unexpected error occurred while communicating with the Finance API.',
        isForbidden: false,
        isUnauthorized: false,
        isNotFound: false,
      };

  // If error is 403 Forbidden, render dedicated AccessDeniedView
  if (sanitized.isForbidden) {
    return (
      <AccessDeniedView
        title={sanitized.title}
        message={sanitized.message}
        {...(requiredRoles ? { requiredRoles } : {})}
        {...(onRetry ? { onRetry } : {})}
        className={className}
      />
    );
  }

  const displayTitle = propTitle || sanitized.title;
  const displayMessage = propMessage || sanitized.message;

  return (
    <div
      role="alert"
      className={`cs-error-card flex flex-col items-center justify-center p-8 rounded-lg border border-[var(--cs-err,#dc2626)] bg-[var(--cs-err-bg,#fef2f2)] text-center my-4 ${className}`}
    >
      <div className="text-3xl text-[var(--cs-err,#dc2626)] mb-2" aria-hidden="true">
        ⚠
      </div>
      <h3 className="cs-error-title text-base font-semibold text-[var(--cs-err,#dc2626)] mb-1">
        {displayTitle}
      </h3>
      <p className="cs-error-text text-sm text-[var(--cs-text,#374151)] max-w-md mb-4">
        {displayMessage}
      </p>
      {onRetry && (
        <button
          type="button"
          className="cs-btn cs-btn-secondary px-4 py-2 rounded text-sm font-medium bg-[var(--cs-err,#dc2626)] text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--cs-err,#dc2626)] transition-colors"
          onClick={onRetry}
          aria-label={retryLabel}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
};

export interface StatusBadgeProps {
  status?: string | undefined;
  type?: AccountType | string | undefined;
  label?: string | undefined;
  variant?: 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'success' | 'error' | 'muted' | undefined;
}

/**
 * Soft pill badge for accounting entities
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ type, label, variant, status }) => {
  const effectiveType = type || status;
  const badgeClass = variant
    ? `cs-badge-${variant}`
    : effectiveType
    ? `cs-badge-${effectiveType.toLowerCase()}`
    : 'cs-badge-muted';
  return (
    <span className={`cs-badge ${badgeClass}`}>
      {label || effectiveType}
    </span>
  );
};
