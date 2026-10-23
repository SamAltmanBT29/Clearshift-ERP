/**
 * ERP-5 HR & Employees — Department Lookup
 *
 * The API returns a **department id** on every employee, leave record and
 * payroll aggregate, and never a department name. To show an operator a
 * readable department, the module reads the department collection once and
 * resolves the ids against it.
 *
 * The read is **bounded**: it asks for the largest page the API allows
 * (`HR_PAGE_SIZE_MAX`, 100). A department outside that page cannot be
 * resolved and is shown as a short identifier instead — never as a
 * fabricated name.
 *
 * @module erp5/web/hooks/useDepartmentLookup
 */

import { useMemo } from 'react';
import { HR_PAGE_SIZE_MAX, type HrDepartment, type HrDepartmentListQuery } from '@clearshift/contracts';
import { listDepartments } from '../api/erp-5.js';
import { useHrList } from './useHrList.js';
import { shortIdentifier } from '../utils/format.js';

export interface DepartmentOption {
  readonly id: string;
  readonly name: string;
  readonly code: string;
}

export interface DepartmentLookup {
  readonly options: readonly DepartmentOption[];
  readonly byId: ReadonlyMap<string, DepartmentOption>;
  readonly isLoading: boolean;
}

export function useDepartmentLookup(): DepartmentLookup {
  const { items, isLoading } = useHrList<HrDepartment, HrDepartmentListQuery>(
    (query, signal) => listDepartments(query, { signal }),
    { page: 1, pageSize: HR_PAGE_SIZE_MAX, sort: 'name' }
  );

  const options = useMemo<readonly DepartmentOption[]>(
    () => items.map((item) => ({ id: item.id, name: item.name, code: item.code })),
    [items]
  );

  const byId = useMemo<ReadonlyMap<string, DepartmentOption>>(
    () => new Map(options.map((option) => [option.id, option])),
    [options]
  );

  return { options, byId, isLoading };
}

/**
 * The readable name of a department.
 *
 * A department that is not in the bounded lookup — or an absent reference —
 * is shown as a short identifier, never invented.
 */
export function departmentLabel(
  id: string | null | undefined,
  lookup: DepartmentLookup
): string {
  if (!id) {
    return '—';
  }
  const match = lookup.byId.get(id);
  return match ? match.name : shortIdentifier(id);
}
