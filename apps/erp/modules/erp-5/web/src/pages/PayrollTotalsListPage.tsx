/**
 * ERP-5 HR & Employees — Payroll Totals List Screen
 *
 * The department/month payroll aggregate on the real API
 * (`GET /api/v1/erp-hr/payroll-totals`). The screen shows **aggregates
 * only** — the API never returns an employee row (FR-ERP5-06).
 *
 * @module erp5/web/pages/PayrollTotalsListPage
 */

import React, { useMemo, useState } from 'react';
import { PageTitle, Pagination } from '@cs/ui';
import {
  HR_PAGE_SIZE_DEFAULT,
  type HrPayrollTotal,
  type HrPayrollTotalListQuery,
} from '@clearshift/contracts';
import { listPayrollTotals } from '../api/erp-5.js';
import { ListFilterBar } from '../components/ListFilterBar.js';
import { ListStateBoundary } from '../components/ListStateBoundary.js';
import { PayrollTotalsTable } from '../components/PayrollTotalsTable.js';
import { useDepartmentLookup } from '../hooks/useDepartmentLookup.js';
import { useHrList } from '../hooks/useHrList.js';

export const PayrollTotalsListPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(HR_PAGE_SIZE_DEFAULT);
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [departmentId, setDepartmentId] = useState<string | undefined>(undefined);

  const departmentLookup = useDepartmentLookup();

  const query = useMemo<HrPayrollTotalListQuery>(
    () => ({
      page,
      pageSize,
      ...(month ? { month } : {}),
      ...(departmentId ? { department_id: departmentId } : {}),
    }),
    [page, pageSize, month, departmentId]
  );

  const { items, meta, isLoading, error, reload } = useHrList<
    HrPayrollTotal,
    HrPayrollTotalListQuery
  >((currentQuery, signal) => listPayrollTotals(currentQuery, { signal }), query);

  const hasFilters = month !== undefined || departmentId !== undefined;

  const handleReset = () => {
    setMonth(undefined);
    setDepartmentId(undefined);
    setPage(1);
  };

  return (
    <div className="cs-erp5-list-page">
      <PageTitle
        title="Payroll totals"
        subtitle="Department and month payroll aggregates. Never employee rows."
      />

      <ListFilterBar
        landmarkLabel="Filter payroll totals"
        showSearch={false}
        searchLabel="Search payroll totals"
        searchValue=""
        onSearchChange={() => undefined}
        filters={[
          {
            id: 'month',
            label: 'Month',
            helperText: 'In YYYY-MM form.',
            inputType: 'month',
            placeholder: 'YYYY-MM',
            value: month,
            onChange: (value) => {
              setMonth(value);
              setPage(1);
            },
          },
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
        onReset={handleReset}
        resetLabel="Clear filters"
        isLoading={isLoading}
      />

      <ListStateBoundary
        isLoading={isLoading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={reload}
        errorTitle="Unable to load the payroll totals"
        emptyTitle="No payroll totals found"
        emptyMessage={
          hasFilters
            ? 'No payroll aggregate matches the current filters.'
            : 'There is no payroll aggregate yet.'
        }
        {...(hasFilters ? { emptyActionLabel: 'Clear filters', onEmptyAction: handleReset } : {})}
        skeletonColumns={5}
        skeletonRows={6}
      >
        <PayrollTotalsTable payrollTotals={items} departmentLookup={departmentLookup} />
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

export default PayrollTotalsListPage;
