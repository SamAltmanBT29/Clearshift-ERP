import React from 'react';
import type { AccountType } from '@clearshift/contracts';

interface SkeletonTableProps {
  columns?: number;
  rows?: number;
}

/**
 * ⏳ Loading State: Clean skeleton loader table
 */
export const SkeletonTable: React.FC<SkeletonTableProps> = ({ columns = 5, rows = 6 }) => {
  return (
    <div className="cs-table-container" role="status" aria-label="Loading content skeleton">
      <table className="cs-table" aria-hidden="true">
        <thead>
          <tr className="cs-tr">
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="cs-th">
                <div className="cs-skeleton-cell" style={{ width: '60%' }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rIdx) => (
            <tr key={rIdx} className="cs-tr">
              {Array.from({ length: columns }).map((_, cIdx) => (
                <td key={cIdx} className="cs-td">
                  <div
                    className="cs-skeleton-cell"
                    style={{ width: `${40 + ((cIdx + rIdx) % 5) * 12}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ textAlign: 'center', padding: '12px', color: 'var(--color-text-muted)', fontSize: '13px' }}>
        Loading data from API...
      </div>
    </div>
  );
};

interface EmptyStateProps {
  icon?: React.ReactNode | undefined;
  title?: string | undefined;
  message?: string | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}

/**
 * 📄 Empty State: Polished zero-data view with clear action
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title = 'No records found',
  message = 'There are no accounts matching your current search or filter criteria.',
  actionLabel,
  onAction,
}) => {
  return (
    <div className="cs-empty-state" role="region" aria-label="Empty state results">
      <div className="cs-empty-icon" aria-hidden="true">{icon || '📂'}</div>
      <h3 className="cs-empty-title">{title}</h3>
      <p className="cs-empty-text">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          className="cs-btn cs-btn-secondary"
          onClick={onAction}
          aria-label={actionLabel}
        >
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
 * ⚠️ Error State: Friendly recoverable card with retry button
 */
export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Failed to load records',
  message = 'An unexpected error occurred while communicating with the Finance API.',
  onRetry,
}) => {
  return (
    <div className="cs-error-card" role="alert">
      <h3 className="cs-error-title">{title}</h3>
      <p className="cs-error-text">{message}</p>
      {onRetry && (
        <button
          type="button"
          className="cs-btn cs-btn-secondary"
          onClick={onRetry}
          aria-label="Retry loading data"
        >
          Retry Request
        </button>
      )}
    </div>
  );
};

interface StatusBadgeProps {
  status?: string;
  type?: AccountType | string;
  label?: string;
  variant?: 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'success' | 'error' | 'muted';
}

/**
 * Soft pill badge
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
