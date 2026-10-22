/**
 * ERP-5 HR & Employees — Payroll Totals Table
 *
 * The department/month payroll aggregate (FR-ERP5-06). The screen shows
 * **aggregates only** — never an employee row — and the amount is the
 * aggregate the API returned, formatted as a string so no digit is lost to
 * floating point.
 *
 * @module erp5/web/components/PayrollTotalsTable
 */

import React from 'react';
import { Table, type ColumnDef } from '@cs/ui';
import type { HrPayrollTotal } from '@clearshift/contracts';
import { departmentLabel, type DepartmentLookup } from '../hooks/useDepartmentLookup.js';
import { formatAmount } from '../utils/format.js';

export interface PayrollTotalsTableProps {
  readonly payrollTotals: readonly HrPayrollTotal[];
  readonly departmentLookup: DepartmentLookup;
  readonly isLoading?: boolean | undefined;
}

export const PayrollTotalsTable: React.FC<PayrollTotalsTableProps> = ({
  payrollTotals,
  departmentLookup,
  isLoading = false,
}) => {
  const columns: ColumnDef<HrPayrollTotal>[] = [
    {
      key: 'department_id',
      header: 'Department',
      render: (row) => departmentLabel(row.department_id, departmentLookup),
    },
    { key: 'month', header: 'Month' },
    {
      key: 'total_amount',
      header: 'Total',
      align: 'right',
      render: (row) => formatAmount(row.total_amount),
    },
    { key: 'currency_code', header: 'Currency' },
    { key: 'headcount', header: 'Headcount', align: 'right' },
  ];

  return (
    <Table
      columns={columns}
      data={payrollTotals as HrPayrollTotal[]}
      caption="Payroll totals"
      emptyMessage="No payroll aggregate to show."
      keyExtractor={(row) => row.id}
      isLoading={isLoading}
    />
  );
};

export default PayrollTotalsTable;
