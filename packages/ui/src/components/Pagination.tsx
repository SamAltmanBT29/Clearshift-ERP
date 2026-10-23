import React from "react";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems?: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  isLoading?: boolean;
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  pageSize = 20,
  pageSizeOptions = [10, 20, 50, 100],
  onPageChange,
  onPageSizeChange,
  isLoading = false,
  className = ""
}) => {
  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;

  // Generate page numbers with windowing
  const getPageNumbers = (): (number | "...")[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, "...", totalPages];
    }
    if (currentPage >= totalPages - 3) {
      return [1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
  };

  const pages = getPageNumbers();

  return (
    <nav
      aria-label="Pagination"
      className={`cs-pagination flex flex-col sm:flex-row items-center justify-between gap-4 py-3 border-t border-[var(--cs-border)] ${className}`}
    >
      <div className="flex items-center gap-4 text-sm text-[var(--cs-text-muted)]">
        {totalItems !== undefined && (
          <span>
            Showing page <span className="font-medium text-[var(--cs-text)]">{currentPage}</span> of{" "}
            <span className="font-medium text-[var(--cs-text)]">{totalPages || 1}</span> ({totalItems} total items)
          </span>
        )}
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <label htmlFor="cs-page-size-select" className="text-sm">
              Per page:
            </label>
            <select
              id="cs-page-size-select"
              aria-label="Items per page"
              value={pageSize}
              disabled={isLoading}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded border border-[var(--cs-border)] bg-[var(--cs-bg)] px-2 py-1 text-sm text-[var(--cs-text)] focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)] disabled:opacity-50"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-1">
        <button
          type="button"
          aria-label="Go to previous page"
          disabled={isFirstPage || isLoading}
          onClick={() => onPageChange(currentPage - 1)}
          className="px-3 py-1.5 rounded border border-[var(--cs-border)] text-sm font-medium text-[var(--cs-text)] bg-[var(--cs-bg)] hover:bg-[var(--cs-surface)] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)]"
        >
          Previous
        </button>

        <ul className="flex items-center space-x-1">
          {pages.map((p, idx) => (
            <li key={idx}>
              {p === "..." ? (
                <span className="px-2 py-1.5 text-sm text-[var(--cs-text-muted)]">...</span>
              ) : (
                <button
                  type="button"
                  aria-label={`Go to page ${p}`}
                  aria-current={p === currentPage ? "page" : undefined}
                  disabled={isLoading}
                  onClick={() => onPageChange(p)}
                  className={`px-3 py-1.5 rounded text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)] ${
                    p === currentPage
                      ? "bg-[var(--cs-accent)] text-white font-semibold"
                      : "border border-[var(--cs-border)] bg-[var(--cs-bg)] text-[var(--cs-text)] hover:bg-[var(--cs-surface)]"
                  }`}
                >
                  {p}
                </button>
              )}
            </li>
          ))}
        </ul>

        <button
          type="button"
          aria-label="Go to next page"
          disabled={isLastPage || isLoading}
          onClick={() => onPageChange(currentPage + 1)}
          className="px-3 py-1.5 rounded border border-[var(--cs-border)] text-sm font-medium text-[var(--cs-text)] bg-[var(--cs-bg)] hover:bg-[var(--cs-surface)] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)]"
        >
          Next
        </button>
      </div>
    </nav>
  );
};
