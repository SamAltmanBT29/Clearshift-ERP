/**
 * ERP-5 HR & Employees — Employee Detail Screen
 *
 * The read-only view of one employee: every primary attribute, the
 * system-maintained ones and the masked salary.
 *
 * @module erp5/web/pages/EmployeeDetailPage
 */

import React, { useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { HrEmployeeView, HrLeave, HrLeaveListQuery } from '@clearshift/contracts';
import { getEmployee, listLeave } from '../api/erp-5.js';
import { FormPageLayout } from '../components/FormPageLayout.js';
import { LeaveTable } from '../components/LeaveTable.js';
import { RecordDetail } from '../components/RecordDetail.js';
import { RecordStateBoundary } from '../components/RecordStateBoundary.js';
import { departmentLabel } from '../hooks/useDepartmentLookup.js';
import { useDepartmentLookup } from '../hooks/useDepartmentLookup.js';
import { useHrList } from '../hooks/useHrList.js';
import { useHrRecord } from '../hooks/useHrRecord.js';

export const EmployeeDetailPage: React.FC = () => {
  const { employeeId } = useParams<{ employeeId: string }>();
  const departmentLookup = useDepartmentLookup();

  const fetchEmployee = useCallback(
    (signal: AbortSignal) => {
      if (!employeeId) {
        return Promise.reject(new Error('The employee id is missing from the route.'));
      }
      return getEmployee(employeeId, { signal });
    },
    [employeeId]
  );

  const { record, isLoading, error, reload } = useHrRecord<HrEmployeeView>(fetchEmployee);

  // Linked records: the leave records that belong to this employee. The API
  // filters by `employee_id`, so the sub-table is a bounded page of the
  // employee's own leave history rather than the whole module collection.
  const leaveQuery = useMemo<HrLeaveListQuery>(
    () => ({ page: 1, pageSize: 25, ...(employeeId ? { employee_id: employeeId } : {}) }),
    [employeeId]
  );
  const {
    items: leaveRecords,
    isLoading: leaveLoading,
    error: leaveError,
  } = useHrList<HrLeave, HrLeaveListQuery>(
    (query, signal) => listLeave(query, { signal }),
    leaveQuery
  );

  return (
    <FormPageLayout
      title="Employee"
      description="One staff record with its attributes, its audit metadata and its links."
      backTo="/erp5/employees"
      backLabel="Back to the employee list"
    >
      <RecordStateBoundary
        isLoading={isLoading}
        error={error}
        onRetry={reload}
        notFoundTitle="Employee not found"
        notFoundMessage="This employee does not exist, or it was removed."
      >
        {record ? (
          <>
            <div className="cs-erp5-detail-actions">
              <Link
                className="cs-erp5-button cs-erp5-button-primary"
                to={`/erp5/employees/${record.id}/edit`}
              >
                Edit employee
              </Link>
            </div>
            <RecordDetail
              caption="Employee"
              items={[
                { label: 'Employee number', value: record.employee_no },
                { label: 'First name', value: record.first_name },
                { label: 'Last name', value: record.last_name },
                { label: 'Birth date', value: record.birth_date },
                { label: 'Join date', value: record.join_date },
                {
                  label: 'Department',
                  value: departmentLookup.isLoading
                    ? '…'
                    : departmentLabel(record.department_id, departmentLookup),
                },
                { label: 'Job title', value: record.job_title },
                {
                  label: 'Salary',
                  value: `${record.salary_display} ${record.currency_code}`,
                  helperText: 'Masked by the API (BR-ERP5-02).',
                },
                { label: 'Employee id', value: record.id },
                { label: 'Created', value: record.created_at },
                { label: 'Updated', value: record.updated_at },
              ]}
            />

            <section className="cs-erp5-linked-records" aria-labelledby="erp5-employee-leave-heading">
              <h2 id="erp5-employee-leave-heading" className="cs-erp5-detail-section-title">
                Leave records
              </h2>
              {leaveError ? (
                <p className="cs-erp5-detail-hint">
                  Leave records could not be loaded: {leaveError.message}
                </p>
              ) : (
                <LeaveTable leaveRecords={leaveRecords} isLoading={leaveLoading} />
              )}
            </section>
          </>
        ) : null}
      </RecordStateBoundary>
    </FormPageLayout>
  );
};

export default EmployeeDetailPage;
