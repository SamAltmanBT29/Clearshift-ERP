import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { JournalEntry } from '@clearshift/contracts';
import { Table, Pagination, type ColumnDef, type SortDirection } from '@cs/ui';
import { StatusBadge, SkeletonTable, EmptyState } from './StateViews.js';

export interface JournalEntriesTableProps {
  entries: JournalEntry[];
  isLoading: boolean;
  total: number;
  page: number;
  totalPages: number;
  pageSize?: number | undefined;
  pageSizeOptions?: number[] | undefined;
  sortColumn?: string | undefined;
  sortDirection?: SortDirection | undefined;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: ((newPageSize: number) => void) | undefined;
  onSort?: ((columnKey: string) => void) | undefined;
  onRefresh?: (() => void) | undefined;
}

/**
 * Main Paginated Data Table for Journal Entries (ERP4-17)
 *
 * Implements:
 * - Stable columns matching the ClearShift ERP-4 data dictionary
 * - Bounded server-side pagination with pageSize clamping (<= 100)
 * - Predictable column sorting with visual indicators and aria-sort
 * - Safe virtualization guard against DOM degradation
 */
export const JournalEntriesTable: React.FC<JournalEntriesTableProps> = ({
  entries,
  isLoading,
  total,
  page,
  totalPages,
  pageSize = 20,
  pageSizeOptions = [10, 20, 50, 100],
  sortColumn: externalSortColumn,
  sortDirection: externalSortDirection,
  onPageChange,
  onPageSizeChange,
  onSort: externalOnSort,
  onRefresh,
}) => {
  const [internalSortColumn, setInternalSortColumn] = useState<string>('posting_date');
  const [internalSortDirection, setInternalSortDirection] = useState<SortDirection>('desc');

  const activeSortColumn = externalSortColumn ?? internalSortColumn;
  const activeSortDirection = externalSortDirection ?? internalSortDirection;

  const handleSort = (columnKey: string) => {
    if (externalOnSort) {
      externalOnSort(columnKey);
    } else {
      if (internalSortColumn === columnKey) {
        setInternalSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setInternalSortColumn(columnKey);
        setInternalSortDirection('asc');
      }
    }
  };

  const sortedEntries = useMemo(() => {
    if (!entries || entries.length === 0) return [];
    const list = [...entries];

    list.sort((a, b) => {
      let cmp = 0;
      switch (activeSortColumn) {
        case 'entry_number': {
          const numA = a.entry_number || (a as any).entryNumber || '';
          const numB = b.entry_number || (b as any).entryNumber || '';
          cmp = numA.localeCompare(numB);
          break;
        }
        case 'posting_date': {
          const dateA = a.posting_date || (a as any).entryDate || '';
          const dateB = b.posting_date || (b as any).entryDate || '';
          cmp = dateA.localeCompare(dateB);
          break;
        }
        case 'period_id': {
          const perA = a.period_id || (a as any).period || '';
          const perB = b.period_id || (b as any).period || '';
          cmp = perA.localeCompare(perB);
          break;
        }
        case 'description': {
          const descA = a.description || '';
          const descB = b.description || '';
          cmp = descA.localeCompare(descB);
          break;
        }
        case 'status': {
          const statA = a.status || '';
          const statB = b.status || '';
          cmp = statA.localeCompare(statB);
          break;
        }
        default: {
          const dateA = a.posting_date || (a as any).entryDate || '';
          const dateB = b.posting_date || (b as any).entryDate || '';
          cmp = dateA.localeCompare(dateB);
        }
      }

      // Stable secondary tie-breaker
      if (cmp === 0) {
        const numA = a.entry_number || a.id;
        const numB = b.entry_number || b.id;
        cmp = numA.localeCompare(numB);
      }

      return activeSortDirection === 'desc' ? -cmp : cmp;
    });

    return list;
  }, [entries, activeSortColumn, activeSortDirection]);

  // Stable columns matching data dictionary
  const columns: ColumnDef<JournalEntry>[] = useMemo(
    () => [
      {
        key: 'entry_number',
        header: 'Entry Number',
        sortable: true,
        width: '180px',
        render: (entry) => (
          <Link
            to={`/erp4/journal-entries/${entry.id}`}
            className="cs-link font-mono font-semibold"
            style={{ color: 'var(--cs-accent, #2563eb)' }}
          >
            {entry.entry_number || (entry as any).entryNumber || entry.id.substring(0, 8)}
          </Link>
        ),
      },
      {
        key: 'posting_date',
        header: 'Posting Date',
        sortable: true,
        width: '130px',
        render: (entry) => (
          <span className="font-mono text-xs">
            {entry.posting_date || (entry as any).entryDate || '—'}
          </span>
        ),
      },
      {
        key: 'period_id',
        header: 'Fiscal Period',
        sortable: true,
        width: '120px',
        render: (entry) => (
          <span className="font-mono text-xs text-[var(--cs-text-muted)]">
            {entry.period_id || (entry as any).period || '—'}
          </span>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        sortable: true,
        render: (entry) => (
          <span className="text-[var(--cs-text)] line-clamp-1">
            {entry.description || '—'}
          </span>
        ),
      },
      {
        key: 'currency_code',
        header: 'Currency',
        sortable: false,
        width: '90px',
        render: (entry) => (
          <span className="font-mono text-xs">
            {entry.currency_code || (entry as any).currency || 'USD'}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        width: '120px',
        render: (entry) => (
          <StatusBadge
            label={entry.status.toUpperCase()}
            variant={
              entry.status === 'posted'
                ? 'success'
                : entry.status === 'reversed'
                ? 'error'
                : 'muted'
            }
          />
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        sortable: false,
        align: 'right',
        width: '110px',
        render: (entry) => (
          <div className="flex items-center justify-end">
            <Link
              to={`/erp4/journal-entries/${entry.id}`}
              className="px-2.5 py-1 text-xs rounded border border-[var(--cs-border)] bg-[var(--cs-bg)] hover:bg-[var(--cs-surface)] text-[var(--cs-text)]"
            >
              View
            </Link>
          </div>
        ),
      },
    ],
    []
  );

  if (isLoading) {
    return <SkeletonTable columns={6} rows={6} />;
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        title="No journal entries found"
        message="No journal entries match your search criteria. Create a double-entry transaction to begin."
        actionLabel={onRefresh ? 'Refresh Ledger' : undefined}
        onAction={onRefresh}
      />
    );
  }

  const safePageSize = Math.min(100, Math.max(1, pageSize));

  return (
    <div className="space-y-3">
      <Table<JournalEntry>
        caption="Journal Entries Ledger"
        columns={columns}
        data={sortedEntries}
        keyExtractor={(entry) => entry.id}
        sortColumn={activeSortColumn}
        sortDirection={activeSortDirection}
        onSort={handleSort}
        isLoading={isLoading}
        emptyMessage="No journal entries recorded."
        virtualize={sortedEntries.length > 50}
        virtualWindowSize={50}
      />

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalItems={total}
        pageSize={safePageSize}
        pageSizeOptions={pageSizeOptions}
        onPageChange={onPageChange}
        {...(onPageSizeChange ? { onPageSizeChange } : {})}
        isLoading={isLoading}
      />
    </div>
  );
};
