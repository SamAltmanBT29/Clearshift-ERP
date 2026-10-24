/**
 * ERP-5 HR & Employees — Department List Screen
 *
 * The department collection on the real API
 * (`GET /api/v1/erp-hr/departments`). The search, the sort and the page are
 * server-side; the browser never holds more than one bounded page.
 *
 * @module erp5/web/pages/DepartmentsListPage
 */

import React, { useMemo, useState } from 'react';
import { PageTitle, Pagination } from '@cs/ui';
import { useSearchParams } from 'react-router-dom';
import {
  HR_PAGE_SIZE_DEFAULT,
  HR_PAGE_SIZE_MAX,
  type HrDepartment,
  type HrDepartmentListQuery,
} from '@clearshift/contracts';
import { listDepartments } from '../api/erp-5.js';
import { DepartmentsTable } from '../components/DepartmentsTable.js';
import { ListFilterBar } from '../components/ListFilterBar.js';
import { ListStateBoundary } from '../components/ListStateBoundary.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useDepartmentLookup } from '../hooks/useDepartmentLookup.js';
import { useHrList } from '../hooks/useHrList.js';

type DepartmentSort = HrDepartmentListQuery['sort'];

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'code', label: 'Code' },
] as const;

const COLUMN_SORT: Readonly<Record<string, DepartmentSort>> = {
  name: 'name',
  code: 'code',
};

const SORT_COLUMN: Readonly<Record<DepartmentSort, string>> = {
  name: 'name',
  code: 'code',
};

export const DepartmentsListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('page'));
    return Number.isFinite(p) && p >= 1 ? p : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const p = Number(searchParams.get('pageSize'));
    return Number.isFinite(p) && p >= 1 && p <= HR_PAGE_SIZE_MAX ? p : HR_PAGE_SIZE_DEFAULT;
  });
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [sort, setSort] = useState<DepartmentSort>(
    () => (searchParams.get('sort') as DepartmentSort | null) ?? 'name'
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(
    () => (searchParams.get('sort_dir') === 'desc' ? 'desc' : 'asc')
  );

  const debouncedSearch = useDebouncedValue(search);
  const departmentLookup = useDepartmentLookup();

  const query = useMemo<HrDepartmentListQuery>(
    () => ({
      page,
      pageSize,
      sort,
      sort_dir: sortDir,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    [page, pageSize, sort, sortDir, debouncedSearch]
  );

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (page !== 1) params.set('page', String(page));
    if (pageSize !== HR_PAGE_SIZE_DEFAULT) params.set('pageSize', String(pageSize));
    if (search.trim()) params.set('search', search.trim());
    if (sort !== 'name') params.set('sort', sort);
    if (sortDir !== 'asc') params.set('sort_dir', sortDir);
    setSearchParams(params, { replace: true });
  }, [page, pageSize, search, sort, sortDir, setSearchParams]);

  const { items, meta, isLoading, error, reload } = useHrList<
    HrDepartment,
    HrDepartmentListQuery
  >((currentQuery, signal) => listDepartments(currentQuery, { signal }), query);

  const hasFilters = search.trim().length > 0;

  const handleReset = () => {
    setSearch('');
    setSort('name');
    setSortDir('asc');
    setPage(1);
  };

  const handleSort = (columnKey: string) => {
    const next = COLUMN_SORT[columnKey];
    if (!next) {
      return;
    }
    if (sort === next) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(next);
      setSortDir('asc');
    }
    setPage(1);
  };

  return (
    <div className="cs-erp5-list-page">
      <PageTitle
        title="Departments"
        subtitle="The department hierarchy that every employee record and every payroll aggregate references."
      />

      <ListFilterBar
        landmarkLabel="Search and filter departments"
        searchLabel="Search departments"
        searchPlaceholder="Name or code"
        searchHelperText="Searches the name and the code on the server."
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        sortLabel="Sort by"
        sortValue={sort}
        sortOptions={SORT_OPTIONS}
        onSortChange={(value) => {
          setSort(value as DepartmentSort);
          setPage(1);
        }}
        onReset={handleReset}
        resetLabel="Clear filters"
        isLoading={isLoading}
        activeFilters={
          search.trim()
            ? [{ id: 'search', label: `Search: ${search.trim()}`, onRemove: () => { setSearch(''); setPage(1); } }]
            : []
        }
      />

      <ListStateBoundary
        isLoading={isLoading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={reload}
        errorTitle="Unable to load the department list"
        emptyTitle="No departments found"
        emptyMessage={
          hasFilters
            ? 'No department matches the current search.'
            : 'There is no department record yet.'
        }
        {...(hasFilters ? { emptyActionLabel: 'Clear filters', onEmptyAction: handleReset } : {})}
        skeletonColumns={4}
        skeletonRows={6}
      >
        <DepartmentsTable
          departments={items}
          departmentLookup={departmentLookup}
          sortColumn={SORT_COLUMN[sort]}
          sortDirection={sortDir}
          onSort={handleSort}
        />
      </ListStateBoundary>

      {meta ? (
        <Pagination
          currentPage={meta.page}
          totalPages={Math.max(meta.totalPages, 1)}
          totalItems={meta.total}
          pageSize={meta.pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          isLoading={isLoading}
        />
      ) : null}
    </div>
  );
};

export default DepartmentsListPage;
