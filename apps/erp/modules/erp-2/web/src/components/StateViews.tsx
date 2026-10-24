import React from 'react';
import type { PurchaseOrderStatus } from '@clearshift/contracts';

/**
 * Sanitizes an error message or raw error object for safe operator display.
 * Strips raw stack traces, file path details, and database error internals,
 * ensuring no technical internals or stack traces leak to the UI.
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
    return 'A database connection error occurred while communicating with the server. Please try again or contact support.';
  }

  return raw || 'Failed to load records from server.';
}

export interface SkeletonTableProps {
  columns?: number | undefined;
  rows?: number | undefined;
  ariaLabel?: string | undefined;
  className?: string | undefined;
}

/**
 * Loading State: Clean animated skeleton loader table
 */
export const SkeletonTable: React.FC<SkeletonTableProps> = ({
  columns = 6,
  rows = 6,
  ariaLabel,
  className = '',
}) => {
  const hasAria = ariaLabel !== undefined;
  const isAria = Boolean(hasAria ? ariaLabel : true);
  const statusLabel = hasAria ? ariaLabel : 'Loading data';

  return (
    <div
      className={`cs-table-card cs-erp2-skeleton-card ${className}`.trim()}
      {...(isAria
        ? {
            role: 'status',
            'aria-label': statusLabel,
            'aria-busy': true,
          }
        : {})}
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
        Loading data from API...
      </div>
    </div>
  );
};

export interface VendorsLoadingSkeletonProps {
  columns?: number | undefined;
  rows?: number | undefined;
  className?: string | undefined;
}

/**
 * Animated skeleton placeholder for Vendors table during initial data fetching (AC1)
 */
export const VendorsLoadingSkeleton: React.FC<VendorsLoadingSkeletonProps> = ({
  columns = 7,
  rows = 6,
  className = '',
}) => {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading vendors table"
      className={`cs-erp2-skeleton-container ${className}`.trim()}
    >
      <SkeletonTable columns={columns} rows={rows} ariaLabel="" />
      <span className="sr-only">Loading vendors, please wait...</span>
    </div>
  );
};

export interface PurchaseOrdersLoadingSkeletonProps {
  columns?: number | undefined;
  rows?: number | undefined;
  className?: string | undefined;
}

/**
 * Animated skeleton placeholder for Purchase Orders table during initial data fetching (AC1)
 */
export const PurchaseOrdersLoadingSkeleton: React.FC<PurchaseOrdersLoadingSkeletonProps> = ({
  columns = 7,
  rows = 6,
  className = '',
}) => {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading purchase orders table"
      className={`cs-erp2-skeleton-container ${className}`.trim()}
    >
      <SkeletonTable columns={columns} rows={rows} ariaLabel="" />
      <span className="sr-only">Loading purchase orders, please wait...</span>
    </div>
  );
};

export interface EmptyStateProps {
  title?: string | undefined;
  message?: string | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  icon?: React.ReactNode | undefined;
  className?: string | undefined;
}

/**
 * Empty State: Zero-data view with helpful guidance and action button
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
    <div
      className={`cs-empty-box cs-erp2-empty-state ${className}`.trim()}
      role="region"
      aria-label="Empty records state"
    >
      {icon ? (
        <div className="cs-empty-icon cs-erp2-empty-icon" aria-hidden="true">
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

export interface EmptyVendorsViewProps {
  readonly hasActiveFilters: boolean;
  readonly onClearFilters: () => void;
  readonly onCreateVendor?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * Helpful empty state view for Vendors supporting zero-data condition with CTA
 * and filtered zero-records condition (AC2)
 */
export const EmptyVendorsView: React.FC<EmptyVendorsViewProps> = ({
  hasActiveFilters,
  onClearFilters,
  onCreateVendor,
  className = '',
}) => {
  if (hasActiveFilters) {
    return (
      <EmptyState
        title="No matching vendors found"
        message="No vendor profiles match the selected filters or search query. Try adjusting your search term or clearing active filters."
        actionLabel="Clear all filters"
        onAction={onClearFilters}
        className={`cs-erp2-empty-filtered ${className}`.trim()}
        icon={<span className="cs-erp2-empty-icon" aria-hidden="true">🔍</span>}
      />
    );
  }

  return (
    <EmptyState
      title="No vendors in supplier master"
      message="No vendor profiles have been recorded in the supplier master yet. Add your first vendor to establish supplier coordinates."
      actionLabel="Add Vendor"
      onAction={onCreateVendor ?? (() => {})}
      className={`cs-erp2-empty-zero-data ${className}`.trim()}
      icon={<span className="cs-erp2-empty-icon" aria-hidden="true">🏢</span>}
    />
  );
};

export interface EmptyPurchaseOrdersViewProps {
  readonly hasActiveFilters: boolean;
  readonly onClearFilters: () => void;
  readonly onCreatePurchaseOrder?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * Helpful empty state view for Purchase Orders supporting zero-data condition with CTA
 * and filtered zero-records condition (AC2)
 */
export const EmptyPurchaseOrdersView: React.FC<EmptyPurchaseOrdersViewProps> = ({
  hasActiveFilters,
  onClearFilters,
  onCreatePurchaseOrder,
  className = '',
}) => {
  if (hasActiveFilters) {
    return (
      <EmptyState
        title="No matching purchase orders found"
        message="No purchase orders match the selected filters or search criteria. Try adjusting your filters or resetting the search."
        actionLabel="Clear all filters"
        onAction={onClearFilters}
        className={`cs-erp2-empty-filtered ${className}`.trim()}
        icon={<span className="cs-erp2-empty-icon" aria-hidden="true">🔍</span>}
      />
    );
  }

  return (
    <EmptyState
      title="No purchase orders in ledger"
      message="No purchase orders have been recorded in the procurement ledger yet. Create your first purchase order to begin tracking supplier orders."
      actionLabel="New Purchase Order"
      onAction={onCreatePurchaseOrder ?? (() => {})}
      className={`cs-erp2-empty-zero-data ${className}`.trim()}
      icon={<span className="cs-erp2-empty-icon" aria-hidden="true">📦</span>}
    />
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
  if (!resolvedCorrId && error && typeof error === 'object' && 'correlationId' in error) {
    const rawId = (error as { correlationId?: unknown }).correlationId;
    if (typeof rawId === 'string') {
      resolvedCorrId = rawId;
    }
  }

  return (
    <div
      className={`cs-error-box cs-erp2-error-banner ${className}`.trim()}
      role="alert"
      aria-label="Error loading records"
    >
      <div className="cs-erp2-error-header">
        <span className="cs-erp2-error-icon" aria-hidden="true">
          ✕
        </span>
        <div className="cs-erp2-error-content">
          <h3 className="cs-error-title cs-erp2-error-title">{title}</h3>
          <p className="cs-error-desc cs-erp2-error-message">{displayMessage}</p>
          {resolvedCorrId && (
            <p className="cs-erp2-correlation-hint">
              Reference ID: <code>{resolvedCorrId}</code>
            </p>
          )}
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          className="cs-btn-danger cs-erp2-retry-btn"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
};

export interface ErrorVendorsViewProps {
  readonly error?: unknown | undefined;
  readonly message?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * API failure alert banner for Vendors with retry action (AC3)
 */
export const ErrorVendorsView: React.FC<ErrorVendorsViewProps> = ({
  error,
  message,
  onRetry,
  className = '',
}) => {
  return (
    <ErrorState
      title="Unable to load vendors"
      message={message}
      error={error}
      onRetry={onRetry}
      className={className}
    />
  );
};

export interface ErrorPurchaseOrdersViewProps {
  readonly error?: unknown | undefined;
  readonly message?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * API failure alert banner for Purchase Orders with retry action (AC3)
 */
export const ErrorPurchaseOrdersView: React.FC<ErrorPurchaseOrdersViewProps> = ({
  error,
  message,
  onRetry,
  className = '',
}) => {
  return (
    <ErrorState
      title="Unable to load purchase orders"
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
  requiredCapability = 'module.read',
  className = '',
}) => {
  const HEADING_ID = 'erp2-access-denied-heading';

  return (
    <section
      className={`cs-forbidden-box cs-erp2-access-denied ${className}`.trim()}
      role="region"
      aria-labelledby={HEADING_ID}
      aria-label="Access denied state"
    >
      <div className="cs-empty-icon cs-erp2-access-denied-icon" aria-hidden="true">
        🔒
      </div>
      <h2 id={HEADING_ID} className="cs-forbidden-title cs-erp2-access-denied-title">
        {title}
      </h2>
      <p className="cs-forbidden-desc cs-erp2-access-denied-message">
        {message}
      </p>
      <div className="cs-erp2-access-denied-role-hint">
        Required permission: <code>{requiredCapability}</code> (or <code>module.write</code>)
      </div>
      <p className="cs-erp2-access-denied-footer">
        Please contact your system administrator to assign the necessary role to your account.
      </p>
    </section>
  );
};

export const AccessDeniedVendorsView = AccessDeniedState;

export interface StatusBadgeProps {
  status: PurchaseOrderStatus;
}

/**
 * StatusBadge: Visual indicator for Purchase Order status
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const norm = (status || 'Draft').toLowerCase();
  let className = 'cs-badge cs-badge-draft';

  if (norm === 'sent') className = 'cs-badge cs-badge-sent';
  if (norm === 'received') className = 'cs-badge cs-badge-received';
  if (norm === 'closed') className = 'cs-badge cs-badge-closed';

  return <span className={className}>{status}</span>;
};
