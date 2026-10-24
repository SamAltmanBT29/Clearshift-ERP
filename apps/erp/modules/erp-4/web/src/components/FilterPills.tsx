import React from 'react';

export interface ActiveFilterPill {
  id: string;
  label: string;
  value: string;
  onRemove: () => void;
}

export interface FilterPillsProps {
  pills: ActiveFilterPill[];
  onClearAll: () => void;
  className?: string | undefined;
}

/**
 * Active Filter Pill Tags component (ERP4-18)
 *
 * Implements:
 * - Active filter tags rendered as accessible pill tags
 * - Individual tag removal buttons with accessible labels
 * - 'Clear All' action button to reset all active filters at once
 */
export const FilterPills: React.FC<FilterPillsProps> = ({
  pills,
  onClearAll,
  className = '',
}) => {
  if (pills.length === 0) {
    return null;
  }

  return (
    <div
      className={`cs-filter-pills flex flex-wrap items-center gap-2 py-2 ${className}`}
      role="region"
      aria-label="Active filters"
    >
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--cs-text-muted)]">
        Active Filters:
      </span>

      <ul className="flex flex-wrap items-center gap-1.5 list-none m-0 p-0" role="list">
        {pills.map((pill) => (
          <li key={pill.id} role="listitem">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-[var(--cs-surface)] border border-[var(--cs-border)] text-[var(--cs-text)]">
              <span>
                <strong>{pill.label}:</strong> {pill.value}
              </span>
              <button
                type="button"
                onClick={pill.onRemove}
                aria-label={`Remove filter for ${pill.label}`}
                className="inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-[var(--cs-border)] text-[var(--cs-text-muted)] hover:text-[var(--cs-text)] focus:outline-none focus:ring-1 focus:ring-[var(--cs-accent)]"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onClearAll}
        className="px-2.5 py-1 text-xs font-medium rounded border border-transparent text-[var(--cs-accent, #2563eb)] hover:underline focus:outline-none focus:ring-1 focus:ring-[var(--cs-accent)]"
        aria-label="Clear all active filters"
      >
        Clear All
      </button>
    </div>
  );
};
