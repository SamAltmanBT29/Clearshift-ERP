/**
 * ERP-5 HR & Employees — Leave Records List Screen
 *
 * The leave collection on the real API (`GET /api/v1/erp-hr/leave`). The
 * endpoint filters by type and by status; both filters are sent to the
 * server and reset the page to the first one.
 *
 * @module erp5/web/pages/LeaveListPage
 */

import React, { useMemo, useState } from 'react';
import { PageTitle, Pagination } from '@cs/ui';
import {
  HR_PAGE_SIZE_DEFAULT,
  type HrLeave,
  type HrLeaveListQuery,
} from '@clearshift/contracts';
import { listLeave } from '../api/erp-5.js';
import { LeaveTable } from '../components/LeaveTable.js';
import { ListFilterBar } from '../components/ListFilterBar.js';
import { ListStateBoundary } from '../components/ListStateBoundary.js';
import { useHrList } from '../hooks/useHrList.js';

type LeaveType = NonNullable<HrLeaveListQuery['type']>;
type LeaveStatus = NonNullable<HrLeaveListQuery['status']>;

const TYPE_OPTIONS = [
  { value: 'sick', label: 'Sick' },
  { value: 'holiday', label: 'Holiday' },
  { value: 'other', label: 'Other' },
] as const;

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
] as const;

export const LeaveListPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(HR_PAGE_SIZE_DEFAULT);
  const [type, setType] = useState<LeaveType | undefined>(undefined);
  const [status, setStatus] = useState<LeaveStatus | undefined>(undefined);

  const query = useMemo<HrLeaveListQuery>(
    () => ({
      page,
      pageSize,
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
    }),
    [page, pageSize, type, status]
  );

  const { items, meta, isLoading, error, reload } = useHrList<HrLeave, HrLeaveListQuery>(
    (currentQuery, signal) => listLeave(currentQuery, { signal }),
    query
  );

  const hasFilters = type !== undefined || status !== undefined;

  const handleReset = () => {
    setType(undefined);
    setStatus(undefined);
    setPage(1);
  };

  return (
    <div className="cs-erp5-list-page">
      <PageTitle
        title="Leave records"
        subtitle="Leave requests with their type, period and approval status."
      />

      <ListFilterBar
        landmarkLabel="Filter leave records"
        showSearch={false}
        searchLabel="Search leave records"
        searchValue=""
        onSearchChange={() => undefined}
        filters={[
          {
            id: 'type',
            label: 'Type',
            options: TYPE_OPTIONS,
            value: type,
            onChange: (value) => {
              setType(value as LeaveType | undefined);
              setPage(1);
            },
          },
          {
            id: 'status',
            label: 'Status',
            options: STATUS_OPTIONS,
            value: status,
            onChange: (value) => {
              setStatus(value as LeaveStatus | undefined);
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
        errorTitle="Unable to load the leave records"
        emptyTitle="No leave records found"
        emptyMessage={
          hasFilters
            ? 'No leave record matches the current filters.'
            : 'There is no leave record yet.'
        }
        {...(hasFilters ? { emptyActionLabel: 'Clear filters', onEmptyAction: handleReset } : {})}
        skeletonColumns={6}
        skeletonRows={8}
      >
        <LeaveTable leaveRecords={items} />
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

export default LeaveListPage;
