/**
 * ERP-5 HR & Employees — Department Detail Screen
 *
 * @module erp5/web/pages/DepartmentDetailPage
 */

import React, { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { HrDepartment } from '@clearshift/contracts';
import { getDepartment } from '../api/erp-5.js';
import { FormPageLayout } from '../components/FormPageLayout.js';
import { RecordDetail } from '../components/RecordDetail.js';
import { RecordStateBoundary } from '../components/RecordStateBoundary.js';
import { departmentLabel } from '../hooks/useDepartmentLookup.js';
import { useDepartmentLookup } from '../hooks/useDepartmentLookup.js';
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
          </>
        ) : null}
      </RecordStateBoundary>
    </FormPageLayout>
  );
};

export default DepartmentDetailPage;
