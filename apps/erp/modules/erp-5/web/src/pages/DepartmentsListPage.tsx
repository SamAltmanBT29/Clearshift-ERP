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
import {
  HR_PAGE_SIZE_DEFAULT,
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(HR_PAGE_SIZE_DEFAULT);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<DepartmentSort>('name');

  const debouncedSearch = useDebouncedValue(search);
  const departmentLookup = useDepartmentLookup();

  const query = useMemo<HrDepartmentListQuery>(
    () => ({
      page,
      pageSize,
      sort,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    [page, pageSize, sort, debouncedSearch]
  );

  const { items, meta, isLoading, error, reload } = useHrList<
    HrDepartment,
    HrDepartmentListQuery
  >((currentQuery, signal) => listDepartments(currentQuery, { signal }), query);

  const hasFilters = search.trim().length > 0;

  const handleReset = () => {
    setSearch('');
    setSort('name');
    setPage(1);
  };

  const handleSort = (columnKey: string) => {
    const next = COLUMN_SORT[columnKey];
    if (!next) {
      return;
    }
    setSort(next);
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
          sortDirection="asc"
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
