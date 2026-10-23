/**
 * ERP-5 HR & Employees — Leave Records Table
 *
 * The SDS-required columns of the leave list: the employee the record
 * belongs to, the period, the type (`sick` / `holiday` / `other`) and the
 * status.
 *
 * The API returns `employee_id` and never an employee label, so the column
 * links to the employee record and carries the identifier. The identifier is
 * shortened for display only — the link target and the accessible name keep
 * it complete.
 *
 * @module erp5/web/components/LeaveTable
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge, Table, type ColumnDef } from '@cs/ui';
import type { HrLeave, LeaveStatus } from '@clearshift/contracts';
import { shortIdentifier } from '../utils/format.js';

export interface LeaveTableProps {
  readonly leaveRecords: readonly HrLeave[];
  readonly isLoading?: boolean | undefined;
}

const STATUS_VARIANT: Record<LeaveStatus, 'success' | 'warning' | 'neutral'> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'neutral',
};

export const LeaveTable: React.FC<LeaveTableProps> = ({ leaveRecords, isLoading = false }) => {
  const columns: ColumnDef<HrLeave>[] = [
    {
      key: 'employee_id',
      header: 'Employee',
      render: (row) => (
        <Link
          className="cs-erp5-row-link"
          to={`/erp5/employees/${row.employee_id}`}
          title={row.employee_id}
          aria-label={`View employee ${row.employee_id}`}
        >
          {shortIdentifier(row.employee_id)}
        </Link>
      ),
    },
    { key: 'date_from', header: 'From' },
    { key: 'date_to', header: 'To' },
    { key: 'type', header: 'Type' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge label={row.status.toUpperCase()} variant={STATUS_VARIANT[row.status]} />
      ),
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      render: (row) => (
        <Link
          className="cs-erp5-row-link"
          to={`/erp5/leave/${row.id}`}
          aria-label={`View leave record from ${row.date_from}`}
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      data={leaveRecords as HrLeave[]}
      caption="Leave records"
      emptyMessage="No leave record to show."
      keyExtractor={(row) => row.id}
      isLoading={isLoading}
    />
  );
};

export default LeaveTable;
