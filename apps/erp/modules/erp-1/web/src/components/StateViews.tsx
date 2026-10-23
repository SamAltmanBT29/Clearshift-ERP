import React from 'react';
import { SkeletonTable, EmptyState, ErrorState, Alert } from '@cs/ui';
import type { Erp1ApiError } from '../api/erp-1.js';

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
    raw = String((error as any).message || '');
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
    return 'A database connection error occurred while retrieving products. Please try again or contact support.';
  }

  return raw || 'Failed to load products from server.';
}

/**
 * Props for EmptyProductsView.
 */
export interface EmptyProductsViewProps {
  readonly hasActiveFilters: boolean;
  readonly onClearFilters: () => void;
  readonly onCreateProduct?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * Helpful empty state view supporting both zero-data condition (initial catalog empty)
 * and filtered zero-records condition (no matching results for current query).
 */
export const EmptyProductsView: React.FC<EmptyProductsViewProps> = ({
  hasActiveFilters,
  onClearFilters,
  onCreateProduct,
  className = '',
}) => {
  if (hasActiveFilters) {
    return (
      <EmptyState
        title="No matching products found"
        message="No products match the selected filters or search query. Try adjusting your search term or clearing active filters."
        actionLabel="Clear all filters"
        onAction={onClearFilters}
        className={`cs-erp1-empty-state ${className}`.trim()}
        icon={<span className="cs-erp1-empty-icon" aria-hidden="true">🔍</span>}
      />
    );
  }

  return (
    <EmptyState
      title="No products in inventory"
      message="No products have been recorded in the catalog yet. Add your first product to begin tracking inventory and stock levels."
      actionLabel="Add Product"
      onAction={onCreateProduct ?? (() => {})}
      className={`cs-erp1-empty-state cs-erp1-empty-zero-data ${className}`.trim()}
      icon={<span className="cs-erp1-empty-icon" aria-hidden="true">📦</span>}
    />
  );
};

/**
 * Props for ErrorProductsView and ErrorAlertBanner.
 */
export interface ErrorProductsViewProps {
  readonly error?: unknown | undefined;
  readonly message?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * API failure alert banner with retry action; raw error stack traces are hidden.
 */
export const ErrorProductsView: React.FC<ErrorProductsViewProps> = ({
  error,
  message,
  onRetry,
  className = '',
}) => {
  const displayMessage = sanitizeErrorMessage(message || error);
  let correlationId: string | null = null;
  if (error && typeof error === 'object' && 'correlationId' in error) {
    correlationId = (error as any).correlationId || null;
  }

  return (
    <div
      role="alert"
      aria-label="Error loading products"
      className={`cs-erp1-error-banner ${className}`.trim()}
    >
      <div className="cs-erp1-error-header">
        <span className="cs-erp1-error-icon" aria-hidden="true">
          ✕
        </span>
        <div className="cs-erp1-error-content">
          <h3 className="cs-erp1-error-title">Unable to load products</h3>
          <p className="cs-erp1-error-message">{displayMessage}</p>
          {correlationId && (
            <p className="cs-erp1-correlation-hint">
              Reference ID: <code>{correlationId}</code>
            </p>
          )}
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="cs-erp1-retry-btn"
        >
          Try Again
        </button>
      )}
    </div>
  );
};

/**
 * Props for AccessDeniedProductsView.
 */
export interface AccessDeniedProductsViewProps {
  readonly message?: string | undefined;
  readonly requiredCapability?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * 403 Forbidden access-denied view explaining the missing role.
 * Note: Never displays a retry button because permission refusal is not a transient network error.
 */
export const AccessDeniedProductsView: React.FC<AccessDeniedProductsViewProps> = ({
  message,
  requiredCapability = 'inventory:read',
  className = '',
}) => {
  const HEADING_ID = 'erp1-access-denied-heading';

  return (
    <section
      className={`cs-erp1-access-denied ${className}`.trim()}
      role="region"
      aria-labelledby={HEADING_ID}
    >
      <div className="cs-erp1-access-denied-icon" aria-hidden="true">
        🔒
      </div>
      <h2 id={HEADING_ID} className="cs-erp1-access-denied-title">
        Access Denied
      </h2>
      <p className="cs-erp1-access-denied-message">
        {message || 'You do not have the required permissions to view products and inventory.'}
      </p>
      <div className="cs-erp1-access-denied-role-hint">
        Required permission: <code>{requiredCapability}</code> (or <code>inventory:manage</code>)
      </div>
      <p className="cs-erp1-access-denied-footer">
        Please contact your system administrator to assign the necessary role to your account.
      </p>
    </section>
  );
};

/**
 * Props for ProductsLoadingSkeleton.
 */
export interface ProductsLoadingSkeletonProps {
  readonly columns?: number | undefined;
  readonly rows?: number | undefined;
  readonly className?: string | undefined;
}

/**
 * Animated skeleton placeholder during initial data fetching.
 */
export const ProductsLoadingSkeleton: React.FC<ProductsLoadingSkeletonProps> = ({
  columns = 7,
  rows = 6,
  className = '',
}) => {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading products table"
      className={`cs-erp1-skeleton-container ${className}`.trim()}
    >
      <div className="cs-erp1-skeleton-card animate-pulse">
        <table className="cs-erp1-skeleton-table" aria-hidden="true">
          <thead>
            <tr>
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i}>
                  <div className="cs-erp1-skeleton-cell skeleton-header" />
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
                      className="cs-erp1-skeleton-cell"
                      style={{ width: `${40 + ((cIdx + rIdx) % 5) * 12}%` }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="cs-erp1-sr-only">Loading products, please wait...</span>
    </div>
  );
};

export { SkeletonTable, EmptyState, ErrorState, Alert };
