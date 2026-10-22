import React from "react";

export type SortDirection = "asc" | "desc";

export interface ColumnDef<T> {
  key: string;
  header: string;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  width?: string;
  render?: (row: T, index: number) => React.ReactNode;
}

export interface TableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  caption?: string;
  keyExtractor: (row: T, index: number) => string;
  sortColumn?: string;
  sortDirection?: SortDirection;
  onSort?: (columnKey: string) => void;
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
  /**
   * Virtualization support for large datasets.
   * STRICT GUARD: Browser memory safety (no sending 100,000 rows to DOM).
   */
  virtualize?: boolean;
  virtualWindowSize?: number;
  virtualStartIndex?: number;
}

export const MAX_SAFE_DOM_ROWS = 5000;

export function Table<T>({
  columns,
  data,
  caption,
  keyExtractor,
  sortColumn,
  sortDirection,
  onSort,
  isLoading = false,
  emptyMessage = "No data available",
  className = "",
  virtualize = false,
  virtualWindowSize = 100,
  virtualStartIndex = 0
}: TableProps<T>): React.ReactElement {
  // Guard against unpaged/overflow row payloads in browser (Constraint: No sending 100,000 rows to the browser)
  if (data.length > MAX_SAFE_DOM_ROWS && !virtualize) {
    console.warn(
      `[ClearShift UI] Table received ${data.length} rows without virtualization. Enforcing windowing guard.`
    );
  }

  // Determine rendered row slice (virtualized or bounded)
  const renderedRows = virtualize || data.length > MAX_SAFE_DOM_ROWS
    ? data.slice(virtualStartIndex, virtualStartIndex + virtualWindowSize)
    : data;

  const topSpacerHeight = virtualize ? virtualStartIndex * 40 : 0;
  const bottomSpacerHeight = virtualize
    ? Math.max(0, (data.length - (virtualStartIndex + renderedRows.length)) * 40)
    : 0;

  return (
    <div className={`cs-table-container overflow-x-auto rounded border border-[var(--cs-border)] bg-[var(--cs-bg)] ${className}`}>
      <table className="w-full text-left text-sm border-collapse" aria-busy={isLoading}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-[var(--cs-surface)] text-[var(--cs-text)] font-semibold border-b border-[var(--cs-border)]">
          <tr>
            {columns.map((col) => {
              const isSorted = sortColumn === col.key;
              const ariaSort: "ascending" | "descending" | "none" | undefined = col.sortable
                ? isSorted
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
                : undefined;

              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={ariaSort}
                  style={col.width ? { width: col.width } : undefined}
                  className={`px-4 py-3 text-${col.align || "left"} ${
                    col.sortable ? "cursor-pointer select-none hover:bg-[var(--cs-border)]/20" : ""
                  }`}
                  onClick={() => col.sortable && onSort && onSort(col.key)}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{col.header}</span>
                    {col.sortable && (
                      <span className="text-xs text-[var(--cs-text-muted)]" aria-hidden="true">
                        {isSorted ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--cs-border)]">
          {topSpacerHeight > 0 && (
            <tr style={{ height: `${topSpacerHeight}px` }} aria-hidden="true">
              <td colSpan={columns.length} />
            </tr>
          )}

          {renderedRows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-[var(--cs-text-muted)]"
              >
                {isLoading ? "Loading data..." : emptyMessage}
              </td>
            </tr>
          ) : (
            renderedRows.map((row, index) => {
              const key = keyExtractor(row, virtualStartIndex + index);
              return (
                <tr
                  key={key}
                  className="hover:bg-[var(--cs-surface)] transition-colors focus-within:bg-[var(--cs-surface)]"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3 text-${col.align || "left"} text-[var(--cs-text)]`}
                    >
                      {col.render
                        ? col.render(row, virtualStartIndex + index)
                        : (row as any)[col.key] !== undefined
                        ? String((row as any)[col.key])
                        : null}
                    </td>
                  ))}
                </tr>
              );
            })
          )}

          {bottomSpacerHeight > 0 && (
            <tr style={{ height: `${bottomSpacerHeight}px` }} aria-hidden="true">
              <td colSpan={columns.length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
