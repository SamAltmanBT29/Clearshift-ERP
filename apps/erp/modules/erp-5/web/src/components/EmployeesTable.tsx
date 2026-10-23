/**
 * ERP-5 HR & Employees — Employees Table
 *
 * The SDS-required columns of the employee list: employee number, first and
 * last name, birth date, join date, department, job title and the **masked**
 * salary. The raw salary column never leaves the API (BR-ERP5-02), so the
 * table can only ever show `salary_display`.
 *
 * The `isLoading` prop marks the table busy while the next page is coming;
 * the empty state of the collection is rendered by `ListStateBoundary`.
 *
 * @module erp5/web/components/EmployeesTable
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Table, type ColumnDef, type SortDirection } from '@cs/ui';
import type { HrEmployeeView } from '@clearshift/contracts';
import { departmentLabel, type DepartmentLookup } from '../hooks/useDepartmentLookup.js';

export interface EmployeesTableProps {
  readonly employees: readonly HrEmployeeView[];
  readonly departmentLookup: DepartmentLookup;
  readonly sortColumn?: string | undefined;
  readonly sortDirection?: SortDirection | undefined;
  readonly onSort?: ((columnKey: string) => void) | undefined;
  readonly isLoading?: boolean | undefined;
}

export const EmployeesTable: React.FC<EmployeesTableProps> = ({
  employees,
  departmentLookup,
  sortColumn,
  sortDirection,
  onSort,
  isLoading = false,
}) => {
  const columns: ColumnDef<HrEmployeeView>[] = [
    { key: 'employee_no', header: 'Employee no.', sortable: true },
    { key: 'first_name', header: 'First name' },
    { key: 'last_name', header: 'Last name' },
    { key: 'birth_date', header: 'Birth date' },
    { key: 'join_date', header: 'Join date', sortable: true },
    {
      key: 'department_id',
      header: 'Department',
      render: (row) => departmentLabel(row.department_id, departmentLookup),
    },
    { key: 'job_title', header: 'Job title' },
    {
      key: 'salary_display',
      header: 'Salary',
      align: 'right',
      render: (row) => `${row.salary_display} ${row.currency_code}`,
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      render: (row) => (
        <Link
          className="cs-erp5-row-link"
          to={`/erp5/employees/${row.id}`}
          aria-label={`View employee ${row.employee_no}`}
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      data={employees as HrEmployeeView[]}
      caption="Employees"
      emptyMessage="No employee to show."
      keyExtractor={(row) => row.id}
      {...(sortColumn ? { sortColumn } : {})}
      {...(sortDirection ? { sortDirection } : {})}
      {...(onSort ? { onSort } : {})}
      isLoading={isLoading}
    />
  );
};

export default EmployeesTable;
