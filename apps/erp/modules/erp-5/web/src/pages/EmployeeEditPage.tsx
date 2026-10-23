/**
 * ERP-5 HR & Employees — Employee Edit Screen
 *
 * @module erp5/web/pages/EmployeeEditPage
 */

import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { HrEmployeeView } from '@clearshift/contracts';
import { getEmployee } from '../api/erp-5.js';
import { FormPageLayout } from '../components/FormPageLayout.js';
import { RecordStateBoundary } from '../components/RecordStateBoundary.js';
import { EmployeeForm } from '../components/forms/EmployeeForm.js';
import { useDepartmentLookup } from '../hooks/useDepartmentLookup.js';
import { useHrRecord } from '../hooks/useHrRecord.js';

export const EmployeeEditPage: React.FC = () => {
  const navigate = useNavigate();
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

  return (
    <FormPageLayout
      title="Edit employee"
      description="Change the mutable fields of a staff record. The identifier, the currency and the timestamps are system-maintained."
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
          <EmployeeForm
            mode="edit"
            employee={record}
            departments={departmentLookup.options}
            onSaved={(employee) => {
              navigate(`/erp5/employees/${employee.id}`);
            }}
            onCancel={() => {
              navigate(`/erp5/employees/${record.id}`);
            }}
          />
        ) : null}
      </RecordStateBoundary>
    </FormPageLayout>
  );
};

export default EmployeeEditPage;
