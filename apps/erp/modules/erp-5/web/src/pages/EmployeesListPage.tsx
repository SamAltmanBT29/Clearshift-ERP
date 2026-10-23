/**
 * ERP-5 HR & Employees — Employee List Screen
 *
 * The primary collection screen of the module, built as a vertical slice on
 * the real API (`GET /api/v1/erp-hr/employees`).
 *
 * The screen never filters, sorts or paginates in the browser: the search
 * term, the department filter, the sort field and the page are sent to the
 * server, and the server answers with one bounded page plus its metadata.
 *
 * @module erp5/web/pages/EmployeesListPage
 */

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageTitle, Pagination } from '@cs/ui';
import {
  HR_PAGE_SIZE_DEFAULT,
  type HrEmployeeListQuery,
  type HrEmployeeView,
} from '@clearshift/contracts';
import { listEmployees } from '../api/erp-5.js';
import { getSession } from '../auth/session.js';
import { canCreateHrRecord } from '../auth/permissions.js';
import { EmployeesTable } from '../components/EmployeesTable.js';
import { ListFilterBar } from '../components/ListFilterBar.js';
import { ListStateBoundary } from '../components/ListStateBoundary.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useDepartmentLookup } from '../hooks/useDepartmentLookup.js';
import { useHrList } from '../hooks/useHrList.js';

type EmployeeSort = HrEmployeeListQuery['sort'];

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'employee_no', label: 'Employee number' },
  { value: 'join_date', label: 'Join date' },
] as const;

/** Which server sort a table column stands for. */
const COLUMN_SORT: Readonly<Record<string, EmployeeSort>> = {
  employee_no: 'employee_no',
  first_name: 'name',
  last_name: 'name',
  join_date: 'join_date',
};

/** Which table column announces the active server sort. */
const SORT_COLUMN: Readonly<Record<EmployeeSort, string>> = {
  name: 'first_name',
  employee_no: 'employee_no',
  join_date: 'join_date',
};

export const EmployeesListPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(HR_PAGE_SIZE_DEFAULT);
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<EmployeeSort>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const debouncedSearch = useDebouncedValue(search);
  const departmentLookup = useDepartmentLookup();

  const query = useMemo<HrEmployeeListQuery>(
    () => ({
      page,
      pageSize,
      sort,
      sort_dir: sortDir,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(departmentId ? { department_id: departmentId } : {}),
    }),
    [page, pageSize, sort, sortDir, debouncedSearch, departmentId]
  );

  const { items, meta, isLoading, error, reload } = useHrList<
    HrEmployeeView,
    HrEmployeeListQuery
  >((currentQuery, signal) => listEmployees(currentQuery, { signal }), query);

  const hasFilters = search.trim().length > 0 || departmentId !== undefined;

  const handleReset = () => {
    setSearch('');
    setDepartmentId(undefined);
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
      // Toggle the direction when the same column is clicked again.
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(next);
      setSortDir('asc');
    }
    setPage(1);
  };

  const session = getSession();
  const titleProps = {
    title: 'Employees',
    subtitle:
      'Staff records with masked salary values, department assignment and job titles. Filter and sort on the server.',
    ...(canCreateHrRecord(session?.roles ?? [])
      ? {
          actions: (
            <Link className="cs-erp5-button cs-erp5-button-primary" to="/erp5/employees/new">
              New employee
            </Link>
          ),
        }
      : {}),
  };

  return (
    <div className="cs-erp5-list-page">
      <PageTitle {...titleProps} />

      <ListFilterBar
        landmarkLabel="Search and filter employees"
        searchLabel="Search employees"
        searchPlaceholder="Name or employee number"
        searchHelperText="Searches first name, last name and employee number on the server."
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        filters={[
          {
            id: 'department',
            label: 'Department',
            options: departmentLookup.options.map((option) => ({
              value: option.id,
              label: option.name,
            })),
            value: departmentId,
            onChange: (value) => {
              setDepartmentId(value);
              setPage(1);
            },
          },
        ]}
        sortLabel="Sort by"
        sortValue={sort}
        sortOptions={SORT_OPTIONS}
        onSortChange={(value) => {
          setSort(value as EmployeeSort);
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
        errorTitle="Unable to load the employee list"
        emptyTitle="No employees found"
        emptyMessage={
          hasFilters
            ? 'No employee matches the current search and filters.'
            : 'There is no employee record yet.'
        }
        {...(hasFilters
          ? { emptyActionLabel: 'Clear filters', onEmptyAction: handleReset }
          : {})}
        skeletonColumns={9}
        skeletonRows={8}
      >
        <EmployeesTable
          employees={items}
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

export default EmployeesListPage;
