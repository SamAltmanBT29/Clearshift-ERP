import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Account } from '@clearshift/contracts';
import { Table, Pagination, type ColumnDef, type SortDirection } from '@cs/ui';
import { StatusBadge, SkeletonTable, EmptyState } from './StateViews.js';

export interface AccountsTableProps {
  accounts: Account[];
  isLoading: boolean;
  total: number;
  page: number;
  totalPages: number;
  pageSize?: number | undefined;
  pageSizeOptions?: number[] | undefined;
  sortColumn?: string | undefined;
  sortDirection?: SortDirection | undefined;
  hasActiveFilters?: boolean | undefined;
  emptyTitle?: string | undefined;
  emptyMessage?: string | undefined;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: ((newPageSize: number) => void) | undefined;
  onSort?: ((columnKey: string) => void) | undefined;
  onRefresh?: (() => void) | undefined;
  onClearFilters?: (() => void) | undefined;
  onCreateAccount?: (() => void) | undefined;
  emptyActionLabel?: string | undefined;
  emptyOnAction?: (() => void) | undefined;
}

/**
 * Main Paginated Data Table for Chart of Accounts (ERP4-17)
 *
 * Implements:
 * - Stable columns matching the ClearShift ERP-4 data dictionary
 * - Bounded server-side pagination with pageSize clamping (<= 100)
 * - Predictable column sorting with visual indicators and aria-sort
 * - Safe virtualization guard against DOM degradation
 */
export const AccountsTable: React.FC<AccountsTableProps> = ({
  accounts,
  isLoading,
  total,
  page,
  totalPages,
  pageSize = 20,
  pageSizeOptions = [10, 20, 50, 100],
  sortColumn: externalSortColumn,
  sortDirection: externalSortDirection,
  hasActiveFilters,
  emptyTitle,
  emptyMessage,
  onPageChange,
  onPageSizeChange,
  onSort: externalOnSort,
  onRefresh,
  onClearFilters,
  onCreateAccount,
  emptyActionLabel,
  emptyOnAction,
}) => {
  // Local sorting state if not controlled externally
  const [internalSortColumn, setInternalSortColumn] = useState<string>('code');
  const [internalSortDirection, setInternalSortDirection] = useState<SortDirection>('asc');

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

  // Predictable sorting comparator
  const sortedAccounts = useMemo(() => {
    if (!accounts || accounts.length === 0) return [];
    const list = [...accounts];

    list.sort((a, b) => {
      let cmp = 0;
      switch (activeSortColumn) {
        case 'code':
          cmp = (a.code || '').localeCompare(b.code || '');
          break;
        case 'name':
          cmp = (a.name || '').localeCompare(b.name || '');
          break;
        case 'type':
          cmp = (a.type || '').localeCompare(b.type || '');
          break;
        case 'currency_code': {
          const currA = a.currency_code || (a as any).currencyCode || '';
          const currB = b.currency_code || (b as any).currencyCode || '';
          cmp = currA.localeCompare(currB);
          break;
        }
        case 'balance': {
          const balA = Number((a as any).balance ?? (a as any).currentBalance ?? 0);
          const balB = Number((b as any).balance ?? (b as any).currentBalance ?? 0);
          cmp = balA - balB;
          break;
        }
        case 'is_active': {
          const actA = (a.is_active ?? (a as any).isActive ?? true) ? 1 : 0;
          const actB = (b.is_active ?? (b as any).isActive ?? true) ? 1 : 0;
          cmp = actA - actB;
          break;
        }
        default:
          cmp = (a.code || '').localeCompare(b.code || '');
      }

      // Stable secondary tie-breaker
      if (cmp === 0) {
        cmp = (a.code || '').localeCompare(b.code || '');
        if (cmp === 0) {
          cmp = (a.id || '').localeCompare(b.id || '');
        }
      }

      return activeSortDirection === 'desc' ? -cmp : cmp;
    });

    return list;
  }, [accounts, activeSortColumn, activeSortDirection]);

  // Stable columns matching data dictionary
  const columns: ColumnDef<Account>[] = useMemo(
    () => [
      {
        key: 'code',
        header: 'Account Code',
        sortable: true,
        width: '160px',
        render: (acc) => (
          <Link
            to={`/erp4/accounts/${acc.id}`}
            className="cs-link font-mono font-semibold"
            style={{ color: 'var(--cs-accent, #2563eb)' }}
          >
            {acc.code}
          </Link>
        ),
      },
      {
        key: 'name',
        header: 'Account Name',
        sortable: true,
        render: (acc) => (
          <div>
            <div className="font-semibold text-[var(--cs-text)]">{acc.name}</div>
            {acc.description && (
              <div className="text-xs text-[var(--cs-text-muted)] line-clamp-1">
                {acc.description}
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        sortable: true,
        width: '130px',
        render: (acc) => <StatusBadge type={acc.type} />,
      },
      {
        key: 'currency_code',
        header: 'Currency',
        sortable: true,
        width: '100px',
        render: (acc) => (
          <span className="font-mono text-xs">
            {acc.currency_code || (acc as any).currencyCode || 'INR'}
          </span>
        ),
      },
      {
        key: 'balance',
        header: 'Balance',
        sortable: true,
        align: 'right',
        width: '150px',
        render: (acc) => {
          const val = Number((acc as any).balance ?? (acc as any).currentBalance ?? 0);
          return (
            <span
              className="font-mono font-medium text-sm"
              style={{
                color: val < 0 ? 'var(--cs-error, #dc2626)' : 'var(--cs-text)',
              }}
            >
              {val.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          );
        },
      },
      {
        key: 'is_active',
        header: 'Status',
        sortable: true,
        width: '120px',
        render: (acc) => {
          const active = acc.is_active ?? (acc as any).isActive ?? true;
          return (
            <StatusBadge
              label={active ? 'Active' : 'Archived'}
              variant={active ? 'success' : 'muted'}
            />
          );
        },
      },
      {
        key: 'actions',
        header: 'Actions',
        sortable: false,
        align: 'right',
        width: '140px',
        render: (acc) => (
          <div className="flex items-center justify-end gap-2">
            <Link
              to={`/erp4/accounts/${acc.id}`}
              className="px-2.5 py-1 text-xs rounded border border-[var(--cs-border)] bg-[var(--cs-bg)] hover:bg-[var(--cs-surface)] text-[var(--cs-text)]"
            >
              View
            </Link>
            <Link
              to={`/erp4/accounts/${acc.id}/edit`}
              className="px-2.5 py-1 text-xs rounded border border-[var(--cs-border)] bg-[var(--cs-bg)] hover:bg-[var(--cs-surface)] text-[var(--cs-text)]"
            >
              Edit
            </Link>
          </div>
        ),
      },
    ],
    []
  );

  if (isLoading) {
    return <SkeletonTable columns={6} rows={8} />;
  }

  if (accounts.length === 0) {
    const isFiltered = Boolean(hasActiveFilters);
    const defaultActionLabel = isFiltered && onClearFilters
      ? 'Clear All Filters'
      : emptyActionLabel || (onCreateAccount ? '+ New Account' : (onRefresh ? 'Refresh Accounts' : undefined));
    const defaultOnAction = isFiltered && onClearFilters
      ? onClearFilters
      : emptyOnAction || onCreateAccount || onRefresh;

    return (
      <EmptyState
        icon="📂"
        title={emptyTitle ?? (isFiltered ? 'No matching accounts found' : 'No accounts found')}
        message={
          emptyMessage ??
          (isFiltered
            ? 'No accounts match your current search query or filter selection. Try adjusting your search term or clearing active filters.'
            : 'No accounts have been created yet. Get started by creating your first account.')
        }
        {...(defaultActionLabel && defaultOnAction ? { actionLabel: defaultActionLabel, onAction: defaultOnAction } : {})}
        {...(onCreateAccount && onRefresh && !isFiltered ? { secondaryActionLabel: 'Refresh Accounts', onSecondaryAction: onRefresh } : {})}
      />
    );
  }

  // Bounded safe paging guard (pageSize <= 100)
  const safePageSize = Math.min(100, Math.max(1, pageSize));

  return (
    <div className="space-y-3">
      <Table<Account>
        caption="Chart of Accounts"
        columns={columns}
        data={sortedAccounts}
        keyExtractor={(acc) => acc.id}
        sortColumn={activeSortColumn}
        sortDirection={activeSortDirection}
        onSort={handleSort}
        isLoading={isLoading}
        emptyMessage="No accounts match your current filter selection."
        virtualize={sortedAccounts.length > 50}
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
