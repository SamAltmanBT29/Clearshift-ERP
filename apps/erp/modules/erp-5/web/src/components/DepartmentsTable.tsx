/**
 * ERP-5 HR & Employees — Departments Table
 *
 * The SDS-required columns of the department list: code, name and the
 * optional parent department.
 *
 * @module erp5/web/components/DepartmentsTable
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Table, type ColumnDef, type SortDirection } from '@cs/ui';
import type { HrDepartment } from '@clearshift/contracts';
import { departmentLabel, type DepartmentLookup } from '../hooks/useDepartmentLookup.js';

export interface DepartmentsTableProps {
  readonly departments: readonly HrDepartment[];
  readonly departmentLookup: DepartmentLookup;
  readonly sortColumn?: string | undefined;
  readonly sortDirection?: SortDirection | undefined;
  readonly onSort?: ((columnKey: string) => void) | undefined;
  readonly isLoading?: boolean | undefined;
}

export const DepartmentsTable: React.FC<DepartmentsTableProps> = ({
  departments,
  departmentLookup,
  sortColumn,
  sortDirection,
  onSort,
  isLoading = false,
}) => {
  const columns: ColumnDef<HrDepartment>[] = [
    { key: 'code', header: 'Code', sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    {
      key: 'parent_id',
      header: 'Parent department',
      render: (row) => departmentLabel(row.parent_id, departmentLookup),
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      render: (row) => (
        <Link
          className="cs-erp5-row-link"
          to={`/erp5/departments/${row.id}`}
          aria-label={`View department ${row.code}`}
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      data={departments as HrDepartment[]}
      caption="Departments"
      emptyMessage="No department to show."
      keyExtractor={(row) => row.id}
      {...(sortColumn ? { sortColumn } : {})}
      {...(sortDirection ? { sortDirection } : {})}
      {...(onSort ? { onSort } : {})}
      isLoading={isLoading}
    />
  );
};

export default DepartmentsTable;
