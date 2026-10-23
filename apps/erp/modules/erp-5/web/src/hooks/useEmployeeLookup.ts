/**
 * ERP-5 HR & Employees — Employee Lookup
 *
 * The leave form needs to offer the employees a leave record can belong to.
 * The employee collection is **not** bounded, so the lookup reads the largest
 * page the API allows (`HR_PAGE_SIZE_MAX`, 100) and offers what it finds.
 *
 * The bound is stated in the UI rather than hidden: the field says how many
 * employees it offers, and the leave **list** — which filters the server-side
 * by `employee_id` — is the way to reach an employee outside that page.
 *
 * @module erp5/web/hooks/useEmployeeLookup
 */

import { useMemo } from 'react';
import {
  HR_PAGE_SIZE_MAX,
  type HrEmployeeListQuery,
  type HrEmployeeView,
} from '@clearshift/contracts';
import { listEmployees } from '../api/erp-5.js';
import { useHrList } from './useHrList.js';

export interface EmployeeOption {
  readonly id: string;
  readonly label: string;
}

export interface EmployeeLookup {
  readonly options: readonly EmployeeOption[];
  readonly isLoading: boolean;
}

export function useEmployeeLookup(): EmployeeLookup {
  const { items, isLoading } = useHrList<HrEmployeeView, HrEmployeeListQuery>(
    (query, signal) => listEmployees(query, { signal }),
    { page: 1, pageSize: HR_PAGE_SIZE_MAX, sort: 'name' }
  );

  const options = useMemo<readonly EmployeeOption[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        label: `${item.employee_no} — ${item.first_name} ${item.last_name}`,
      })),
    [items]
  );

  return { options, isLoading };
}
