import React from 'react';
import type { SalesOrderStatus, InvoiceStatus } from '@clearshift/contracts';

/**
 * Sanitizes an error message or raw error object for safe operator display.
 * Strips raw stack traces, file path details, and database error internals,
 * ensuring no technical internals or stack traces leak to the UI (AC3).
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (!error) {
    return 'An unexpected error occurred while communicating with the server.';
  }

  let raw = '';
  if (error instanceof Error) {
    raw = error.message || '';
  } else if (typeof error === 'string') {
    raw = error;
  } else if (typeof error === 'object' && error !== null && 'message' in error) {
    raw = String((error as { message?: unknown }).message || '');
  } else {
    return 'An unexpected error occurred while communicating with the server.';
  }

  // 1. If message contains multiline stack trace or "at ..." frames, strip them
  if (raw.includes('\n') || raw.includes(' at ')) {
    const lines = raw.split(/\r?\n/);
    const nonStackLines = lines.filter(
      (line) => !/^\s*at\s+/i.test(line) && !line.includes('node_modules') && !/:\d+:\d+/.test(line)
    );
    raw = nonStackLines.join(' ').trim();
  }

  // 2. Hide database/ORM specific error traces
  if (
    /error:\s*(syntax error|relation|column|violates|select|insert|update|delete|pg_)/i.test(raw) ||
    /drizzle-orm|postgres|pg-protocol/i.test(raw) ||
    /ECONNREFUSED|ENOTFOUND|getaddrinfo/i.test(raw)
  ) {
    return 'A database connection error occurred while retrieving sales orders. Please try again or contact support.';
  }

  return raw || 'Failed to load records from server.';
}

export interface SkeletonTableProps {
  columns?: number;
  rows?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * Loading State: Clean animated skeleton loader table (AC1)
 */
export const SkeletonTable: React.FC<SkeletonTableProps> = ({
  columns = 6,
  rows = 6,
  className = '',
  ariaLabel = 'Loading sales orders data',
}) => {
  return (
    <div
      className={`cs-table-card cs-erp3-skeleton-container ${className}`.trim()}
      role="status"
      aria-label={ariaLabel}
      aria-busy="true"
    >
      <table className="cs-table" aria-hidden="true">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i}>
                <div className="cs-skeleton-cell" style={{ width: '60%' }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rIdx) => (
            <tr key={rIdx}>
              {Array.from({ length: columns }).map((_, cIdx) => (
                <td key={cIdx}>
                  <div
                    className="cs-skeleton-cell"
                    style={{ width: `${45 + ((cIdx + rIdx) % 5) * 11}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ textAlign: 'center', padding: '16px', color: 'var(--color-text-muted)', fontSize: '13px' }}>
        Loading data from API, please wait...
      </div>
      <span className="sr-only">Loading content, please wait...</span>
    </div>
  );
};

export const SalesOrdersLoadingSkeleton: React.FC<SkeletonTableProps> = (props) => (
  <SkeletonTable columns={8} rows={6} ariaLabel="Loading sales orders data" {...props} />
);

export const InvoicesLoadingSkeleton: React.FC<SkeletonTableProps> = (props) => (
  <SkeletonTable columns={8} rows={6} ariaLabel="Loading invoices data" {...props} />
);

export interface EmptyStateProps {
  title?: string | undefined;
  message?: string | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  icon?: React.ReactNode | undefined;
  className?: string | undefined;
}

/**
 * Empty State: Zero-data view with helpful guidance and action button (AC2)
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'No records found',
  message = 'There are no records matching your current search or filter criteria.',
  actionLabel,
  onAction,
  icon,
  className = '',
}) => {
  return (
    <div className={`cs-empty-box ${className}`.trim()} role="region" aria-label="Empty records state">
      {icon ? (
        <div className="cs-empty-icon" aria-hidden="true">
          {icon}
        </div>
      ) : (
        <div className="cs-empty-icon" aria-hidden="true">
          📦
        </div>
      )}
      <h3 className="cs-empty-title">{title}</h3>
      <p className="cs-empty-desc">{message}</p>
      {actionLabel && onAction && (
        <button type="button" className="cs-btn-secondary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export interface EmptySalesOrdersViewProps {
  readonly hasActiveFilters: boolean;
  readonly onClearFilters: () => void;
  readonly onCreateOrder?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * Helpful empty state view for Sales Orders supporting zero-data condition with CTA
 * and filtered zero-records condition (AC2)
 */
export const EmptySalesOrdersView: React.FC<EmptySalesOrdersViewProps> = ({
  hasActiveFilters,
  onClearFilters,
  onCreateOrder,
  className = '',
}) => {
  if (hasActiveFilters) {
    return (
      <div
        className={`cs-empty-box cs-erp3-empty-filtered ${className}`.trim()}
        role="region"
        aria-label="Empty records state"
      >
        <div className="cs-empty-icon" aria-hidden="true">
          🔍
        </div>
        <h3 className="cs-empty-title">No sales orders found</h3>
        <p className="cs-empty-desc">
          No orders match your current filter selection or search query.
        </p>
        <button
          type="button"
          className="cs-btn-secondary"
          onClick={onClearFilters}
        >
          Clear Filters & Reload
        </button>
      </div>
    );
  }

  return (
    <div
      className={`cs-empty-box cs-erp3-empty-zero-data ${className}`.trim()}
      role="region"
      aria-label="Empty records state"
    >
      <div className="cs-empty-icon" aria-hidden="true">
        📦
      </div>
      <h3 className="cs-empty-title">No sales orders found</h3>
      <p className="cs-empty-desc">
        No orders match your current filter selection or search query. No sales orders have been recorded yet. Create your first sales order to begin managing orders and line items.
      </p>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {onCreateOrder && (
          <button
            type="button"
            className="cs-btn-primary"
            onClick={onCreateOrder}
          >
            + New Sales Order
          </button>
        )}
        {onClearFilters && (
          <button
            type="button"
            className="cs-btn-secondary"
            onClick={onClearFilters}
          >
            Clear Filters & Reload
          </button>
        )}
      </div>
    </div>
  );
};

export interface EmptyInvoicesViewProps {
  readonly hasActiveFilters: boolean;
  readonly onClearFilters: () => void;
  readonly onCreateInvoice?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * Helpful empty state view for Invoices supporting zero-data condition with CTA
 * and filtered zero-records condition (AC2)
 */
export const EmptyInvoicesView: React.FC<EmptyInvoicesViewProps> = ({
  hasActiveFilters,
  onClearFilters,
  onCreateInvoice,
  className = '',
}) => {
  if (hasActiveFilters) {
    return (
      <div
        className={`cs-empty-box cs-erp3-empty-filtered ${className}`.trim()}
        role="region"
        aria-label="Empty records state"
      >
        <div className="cs-empty-icon" aria-hidden="true">
          🔍
        </div>
        <h3 className="cs-empty-title">No invoices found</h3>
        <p className="cs-empty-desc">
          No invoices match your current filter selection or search query.
        </p>
        <button
          type="button"
          className="cs-btn-secondary"
          onClick={onClearFilters}
        >
          Clear Filters & Reload
        </button>
      </div>
    );
  }

  return (
    <div
      className={`cs-empty-box cs-erp3-empty-zero-data ${className}`.trim()}
      role="region"
      aria-label="Empty records state"
    >
      <div className="cs-empty-icon" aria-hidden="true">
        📄
      </div>
      <h3 className="cs-empty-title">No invoices found</h3>
      <p className="cs-empty-desc">
        No invoices match your current filter selection or search query. No billing invoices have been recorded yet. Create your first invoice or bill an existing sales order.
      </p>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {onCreateInvoice && (
          <button
            type="button"
            className="cs-btn-primary"
            onClick={onCreateInvoice}
          >
            + New Invoice
          </button>
        )}
        {onClearFilters && (
          <button
            type="button"
            className="cs-btn-secondary"
            onClick={onClearFilters}
          >
            Clear Filters & Reload
          </button>
        )}
      </div>
    </div>
  );
};

export interface ErrorStateProps {
  title?: string | undefined;
  message?: string | undefined;
  error?: unknown | undefined;
  correlationId?: string | undefined;
  onRetry?: (() => void) | undefined;
  retryLabel?: string | undefined;
  className?: string | undefined;
}

/**
 * Error State: Clear error alert banner with recoverable action and hidden stack traces (AC3)
 */
export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Failed to load records',
  message,
  error,
  correlationId,
  onRetry,
  retryLabel = 'Try Again',
  className = '',
}) => {
  const displayMessage = sanitizeErrorMessage(message || error);
  let resolvedCorrId = correlationId;
  if (!resolvedCorrId && error && typeof error === 'object' && error !== null) {
    if ('correlationId' in error) {
      const rawId = (error as { correlationId?: unknown }).correlationId;
      if (typeof rawId === 'string') {
        resolvedCorrId = rawId;
      }
    }
    if (!resolvedCorrId && 'details' in error) {
      const details = (error as { details?: unknown }).details;
      if (details && typeof details === 'object' && 'correlationId' in details) {
        const rawId = (details as { correlationId?: unknown }).correlationId;
        if (typeof rawId === 'string') {
          resolvedCorrId = rawId;
        }
      }
    }
  }

  return (
    <div
      className={`cs-error-box cs-erp3-error-banner ${className}`.trim()}
      role="alert"
      aria-label="Error loading records"
    >
      <div className="cs-erp3-error-header">
        <span className="cs-erp3-error-icon" aria-hidden="true">
          ✕
        </span>
        <div className="cs-erp3-error-content">
          <h3 className="cs-error-title cs-erp3-error-title">{title}</h3>
          <p className="cs-error-desc cs-erp3-error-message">{displayMessage}</p>
          {resolvedCorrId && (
            <p className="cs-erp3-correlation-hint">
              Reference ID: <code>{resolvedCorrId}</code>
            </p>
          )}
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          className="cs-btn-danger cs-erp3-retry-btn"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
};

export interface ErrorSalesOrdersViewProps {
  readonly error?: unknown | undefined;
  readonly message?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * API failure alert banner for Sales Orders with retry action (AC3)
 */
export const ErrorSalesOrdersView: React.FC<ErrorSalesOrdersViewProps> = ({
  error,
  message,
  onRetry,
  className = '',
}) => {
  return (
    <ErrorState
      title="Unable to load sales orders"
      message={message}
      error={error}
      onRetry={onRetry}
      className={className}
    />
  );
};

export interface ErrorInvoicesViewProps {
  readonly error?: unknown | undefined;
  readonly message?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * API failure alert banner for Invoices with retry action (AC3)
 */
export const ErrorInvoicesView: React.FC<ErrorInvoicesViewProps> = ({
  error,
  message,
  onRetry,
  className = '',
}) => {
  return (
    <ErrorState
      title="Unable to load invoices"
      message={message}
      error={error}
      onRetry={onRetry}
      className={className}
    />
  );
};

export interface AccessDeniedStateProps {
  title?: string | undefined;
  message?: string | undefined;
  requiredCapability?: string | undefined;
  className?: string | undefined;
}

/**
 * Permission Denied State: 403 Forbidden display explaining missing role without retry button (AC4)
 */
export const AccessDeniedState: React.FC<AccessDeniedStateProps> = ({
  title = 'Access Denied',
  message = 'You do not have the required permissions to view this resource. Contact your ClearShift administrator.',
  requiredCapability = 'orders:read',
  className = '',
}) => {
  const HEADING_ID = 'erp3-access-denied-heading';

  return (
    <section
      className={`cs-forbidden-box cs-erp3-access-denied ${className}`.trim()}
      role="region"
      aria-labelledby={HEADING_ID}
      aria-label="Access denied state"
    >
      <div className="cs-empty-icon cs-erp3-access-denied-icon" aria-hidden="true">
        🔒
      </div>
      <h2 id={HEADING_ID} className="cs-forbidden-title cs-erp3-access-denied-title">
        {title}
      </h2>
      <p className="cs-forbidden-desc cs-erp3-access-denied-message">
        {message}
      </p>
      <div className="cs-erp3-access-denied-role-hint">
        Required permission: <code>{requiredCapability}</code> (or <code>orders:manage</code>)
      </div>
      <p className="cs-erp3-access-denied-footer">
        Please contact your system administrator to assign the necessary role to your account.
      </p>
    </section>
  );
};

export const AccessDeniedOrdersView = AccessDeniedState;
export const AccessDeniedInvoicesView = AccessDeniedState;
export const ForbiddenView = AccessDeniedState;

export interface StatusBadgeProps {
  status?: SalesOrderStatus | InvoiceStatus | string;
  label?: string;
  variant?: 'success' | 'warning' | 'error' | 'neutral' | 'info';
}

/**
 * Status Badge for Order & Invoice statuses
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, variant }) => {
  const normalized = (status || label || '').toLowerCase();

  let resolvedClass = 'cs-badge-open';
  let displayLabel = label || status || '';

  if (variant) {
    if (variant === 'success') resolvedClass = 'cs-badge-paid';
    else if (variant === 'warning') resolvedClass = 'cs-badge-invoiced';
    else if (variant === 'error') resolvedClass = 'cs-badge-overdue';
    else if (variant === 'neutral') resolvedClass = 'cs-badge-closed';
    else resolvedClass = 'cs-badge-open';
  } else {
    switch (normalized) {
      case 'open':
        resolvedClass = 'cs-badge-open';
        break;
      case 'invoiced':
        resolvedClass = 'cs-badge-invoiced';
        break;
      case 'closed':
        resolvedClass = 'cs-badge-closed';
        break;
      case 'paid':
        resolvedClass = 'cs-badge-paid';
        break;
      case 'overdue':
        resolvedClass = 'cs-badge-overdue';
        break;
      default:
        resolvedClass = 'cs-badge-open';
    }
  }

  return <span className={`cs-badge ${resolvedClass}`}>{displayLabel}</span>;
};
