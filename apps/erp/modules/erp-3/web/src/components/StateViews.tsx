import React from 'react';
import type { SalesOrderStatus, InvoiceStatus } from '@clearshift/contracts';

interface SkeletonTableProps {
  columns?: number;
  rows?: number;
}

/**
 * Loading State: Clean skeleton loader table
 */
export const SkeletonTable: React.FC<SkeletonTableProps> = ({ columns = 6, rows = 6 }) => {
  return (
    <div className="cs-table-card" role="status" aria-label="Loading sales orders data" aria-busy="true">
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

interface EmptyStateProps {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Empty State: Zero-data view with helpful guidance and action button
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'No records found',
  message = 'There are no sales orders matching your current search or filter criteria.',
  actionLabel,
  onAction,
}) => {
  return (
    <div className="cs-empty-box" role="region" aria-label="Empty records state">
      <div className="cs-empty-icon" aria-hidden="true">
        📦
      </div>
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

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

/**
 * Error State: Clear error message with recoverable action
 */
export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Failed to load records',
  message = 'An unexpected error occurred while communicating with the server.',
  onRetry,
}) => {
  return (
    <div className="cs-error-box" role="alert" aria-label="Error loading records">
      <h3 className="cs-error-title">{title}</h3>
      <p className="cs-error-desc">{message}</p>
      {onRetry && (
        <button type="button" className="cs-btn-danger" onClick={onRetry}>
          Try Again
        </button>
      )}
    </div>
  );
};

/**
 * Forbidden / Access Denied State
 */
export const ForbiddenView: React.FC<{ message?: string }> = ({
  message = 'You do not have permission to view or manage sales orders in ERP-3.',
}) => {
  return (
    <div className="cs-error-box" role="alert" aria-label="Access denied">
      <h3 className="cs-error-title">Access Denied</h3>
      <p className="cs-error-desc">{message}</p>
    </div>
  );
};

interface StatusBadgeProps {
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
