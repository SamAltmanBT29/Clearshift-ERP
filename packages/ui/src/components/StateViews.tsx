import React from "react";

export interface SkeletonTableProps {
  columns?: number;
  rows?: number;
  className?: string;
}

export const SkeletonTable: React.FC<SkeletonTableProps> = ({
  columns = 5,
  rows = 5,
  className = ""
}) => {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading table content"
      className={`cs-skeleton-table overflow-x-auto rounded border border-[var(--cs-border)] bg-[var(--cs-bg)] p-4 ${className}`}
    >
      <div className="animate-pulse space-y-4">
        {/* Header Skeleton */}
        <div className="grid gap-4 py-2 border-b border-[var(--cs-border)]" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
          {Array.from({ length: columns }).map((_, i) => (
            <div key={i} className="h-4 bg-[var(--cs-border)]/40 rounded" />
          ))}
        </div>
        {/* Rows Skeleton */}
        {Array.from({ length: rows }).map((_, rIdx) => (
          <div key={rIdx} className="grid gap-4 py-2 border-b border-[var(--cs-border)]/20" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
            {Array.from({ length: columns }).map((_, cIdx) => (
              <div key={cIdx} className="h-4 bg-[var(--cs-border)]/20 rounded" />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading content, please wait...</span>
    </div>
  );
};

export interface EmptyStateProps {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = "No records found",
  message = "There are no items to display at this time.",
  actionLabel,
  onAction,
  icon,
  className = ""
}) => {
  return (
    <div className={`cs-empty-state flex flex-col items-center justify-center p-8 rounded border border-dashed border-[var(--cs-border)] bg-[var(--cs-surface)] text-center ${className}`}>
      {icon ? (
        <div className="mb-3 text-[var(--cs-text-muted)]" aria-hidden="true">
          {icon}
        </div>
      ) : (
        <div className="mb-3 text-3xl text-[var(--cs-text-muted)]" aria-hidden="true">
          📭
        </div>
      )}
      <h3 className="text-base font-semibold text-[var(--cs-text)] mb-1">
        {title}
      </h3>
      <p className="text-sm text-[var(--cs-text-muted)] max-w-sm mb-4">
        {message}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="px-4 py-2 rounded text-sm font-medium bg-[var(--cs-accent)] text-white hover:bg-[var(--cs-accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)] transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = "Failed to load content",
  message = "An unexpected error occurred while communicating with the server.",
  onRetry,
  retryLabel = "Try Again",
  className = ""
}) => {
  return (
    <div
      role="alert"
      className={`cs-error-state flex flex-col items-center justify-center p-8 rounded border border-[var(--cs-err)] bg-[var(--cs-err-bg)] text-center ${className}`}
    >
      <div className="text-3xl text-[var(--cs-err)] mb-3" aria-hidden="true">
        ⚠
      </div>
      <h3 className="text-base font-semibold text-[var(--cs-err)] mb-1">
        {title}
      </h3>
      <p className="text-sm text-[var(--cs-text)] max-w-sm mb-4">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 rounded text-sm font-medium bg-[var(--cs-err)] text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--cs-err)] transition-colors"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
};
