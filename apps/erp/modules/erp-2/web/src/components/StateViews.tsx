import React from 'react';
import type { PurchaseOrderStatus } from '@clearshift/contracts';

interface SkeletonTableProps {
  columns?: number;
  rows?: number;
}

/**
 * Loading State: Clean skeleton loader table
 */
export const SkeletonTable: React.FC<SkeletonTableProps> = ({ columns = 6, rows = 6 }) => {
  return (
    <div className="cs-table-card" role="status" aria-label="Loading data" aria-busy="true">
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
  message = 'There are no records matching your current search or filter criteria.',
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

interface AccessDeniedStateProps {
  title?: string;
  message?: string;
}

/**
 * Permission Denied State: 403 Forbidden display
 */
export const AccessDeniedState: React.FC<AccessDeniedStateProps> = ({
  title = 'Access Denied',
  message = 'You do not have the required permissions to view this resource. Contact your ClearShift administrator.',
}) => {
  return (
    <div className="cs-forbidden-box" role="alert" aria-label="Access denied state">
      <div className="cs-empty-icon" aria-hidden="true">
        🔒
      </div>
      <h3 className="cs-forbidden-title">{title}</h3>
      <p className="cs-forbidden-desc">{message}</p>
    </div>
  );
};

interface StatusBadgeProps {
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
