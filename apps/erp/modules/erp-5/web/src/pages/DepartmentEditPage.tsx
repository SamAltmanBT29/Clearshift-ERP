/**
 * ERP-5 HR & Employees — Department Edit Screen
 *
 * @module erp5/web/pages/DepartmentEditPage
 */

import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { HrDepartment } from '@clearshift/contracts';
import { getDepartment } from '../api/erp-5.js';
import { FormPageLayout } from '../components/FormPageLayout.js';
import { RecordStateBoundary } from '../components/RecordStateBoundary.js';
import { DepartmentForm } from '../components/forms/DepartmentForm.js';
import { useDepartmentLookup } from '../hooks/useDepartmentLookup.js';
import { useHrRecord } from '../hooks/useHrRecord.js';

export const DepartmentEditPage: React.FC = () => {
  const navigate = useNavigate();
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

  return (
    <FormPageLayout
      title="Edit department"
      description="Change the name, the code or the parent of a department."
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
          <DepartmentForm
            mode="edit"
            department={record}
            departments={departmentLookup.options}
            onSaved={(department) => {
              navigate(`/erp5/departments/${department.id}`);
            }}
            onCancel={() => {
              navigate(`/erp5/departments/${record.id}`);
            }}
          />
        ) : null}
      </RecordStateBoundary>
    </FormPageLayout>
  );
};

export default DepartmentEditPage;
