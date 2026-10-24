/**
 * ERP-5 HR & Employees — Department Detail Screen
 *
 * @module erp5/web/pages/DepartmentDetailPage
 */

import React, { useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { HrDepartment, HrEmployeeView, HrEmployeeListQuery } from '@clearshift/contracts';
import { getDepartment, listEmployees } from '../api/erp-5.js';
import { EmployeesTable } from '../components/EmployeesTable.js';
import { FormPageLayout } from '../components/FormPageLayout.js';
import { RecordDetail } from '../components/RecordDetail.js';
import { RecordStateBoundary } from '../components/RecordStateBoundary.js';
import { departmentLabel } from '../hooks/useDepartmentLookup.js';
import { useDepartmentLookup } from '../hooks/useDepartmentLookup.js';
import { useHrList } from '../hooks/useHrList.js';
import { useHrRecord } from '../hooks/useHrRecord.js';

export const DepartmentDetailPage: React.FC = () => {
  const { departmentId } = useParams<{ departmentId: string }>();
  const departmentLookup = useDepartmentLookup();

  const fetchDepartment = useCallback(
    (signal: AbortSignal) => {
      if (!departmentId) {
        return Promise.reject(new Error('The department id is missing from the route.'));
      }
      return getDepartment(departmentId, { signal });
    },
    [departmentId]
  );

  const { record, isLoading, error, reload } = useHrRecord<HrDepartment>(fetchDepartment);

  const employeeQuery = useMemo<HrEmployeeListQuery>(
    () => ({ page: 1, pageSize: 25, sort: 'name', sort_dir: 'asc', ...(departmentId ? { department_id: departmentId } : {}) }),
    [departmentId]
  );
  const {
    items: employees,
    isLoading: employeesLoading,
    error: employeesError,
  } = useHrList<HrEmployeeView, HrEmployeeListQuery>(
    (query, signal) => listEmployees(query, { signal }),
    employeeQuery
  );

  return (
    <FormPageLayout
      title="Department"
      description="One department with its parent reference, its audit metadata and its links."
      backTo="/erp5/departments"
      backLabel="Back to the department list"
    >
      <RecordStateBoundary
        isLoading={isLoading}
        error={error}
        onRetry={reload}
        notFoundTitle="Department not found"
        notFoundMessage="This department does not exist, or it was removed."
      >
        {record ? (
          <>
            <div className="cs-erp5-detail-actions">
              <Link
                className="cs-erp5-button cs-erp5-button-primary"
                to={`/erp5/departments/${record.id}/edit`}
              >
                Edit department
              </Link>
            </div>
            <RecordDetail
              caption="Department"
              items={[
                { label: 'Code', value: record.code },
                { label: 'Name', value: record.name },
                {
                  label: 'Parent department',
                  value: departmentLookup.isLoading
                    ? '…'
                    : departmentLabel(record.parent_id, departmentLookup),
                },
                { label: 'Department id', value: record.id },
                { label: 'Created', value: record.created_at },
                { label: 'Updated', value: record.updated_at },
              ]}
            />

            <section className="cs-erp5-linked-records" aria-labelledby="erp5-department-employees-heading">
              <h2 id="erp5-department-employees-heading" className="cs-erp5-detail-section-title">
                Employees
              </h2>
              {employeesError ? (
                <p className="cs-erp5-detail-hint">
                  Employees could not be loaded: {employeesError.message}
                </p>
              ) : (
                <EmployeesTable
                  employees={employees}
                  departmentLookup={departmentLookup}
                  isLoading={employeesLoading}
                />
              )}
            </section>
          </>
        ) : null}
      </RecordStateBoundary>
    </FormPageLayout>
  );
};

export default DepartmentDetailPage;
