/**
 * ERP-5 HR & Employees — Leave Edit Screen
 *
 * @module erp5/web/pages/LeaveEditPage
 */

import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { HrLeave } from '@clearshift/contracts';
import { getLeave } from '../api/erp-5.js';
import { FormPageLayout } from '../components/FormPageLayout.js';
import { RecordStateBoundary } from '../components/RecordStateBoundary.js';
import { LeaveForm } from '../components/forms/LeaveForm.js';
import { useEmployeeLookup } from '../hooks/useEmployeeLookup.js';
import { useHrRecord } from '../hooks/useHrRecord.js';

export const LeaveEditPage: React.FC = () => {
  const navigate = useNavigate();
  const { leaveId } = useParams<{ leaveId: string }>();
  const employeeLookup = useEmployeeLookup();

  const fetchLeave = useCallback(
    (signal: AbortSignal) => {
      if (!leaveId) {
        return Promise.reject(new Error('The leave id is missing from the route.'));
      }
      return getLeave(leaveId, { signal });
    },
    [leaveId]
  );

  const { record, isLoading, error, reload } = useHrRecord<HrLeave>(fetchLeave);

  return (
    <FormPageLayout
      title="Edit leave record"
      description="Change the period or the type of a leave record, and decide it once. The employee of a record never changes."
      backTo="/erp5/leave"
      backLabel="Back to the leave list"
    >
      <RecordStateBoundary
        isLoading={isLoading}
        error={error}
        onRetry={reload}
        notFoundTitle="Leave record not found"
        notFoundMessage="This leave record does not exist, or it was removed."
      >
        {record ? (
          <LeaveForm
            mode="edit"
            leaveRecord={record}
            employees={employeeLookup.options}
            onSaved={(leaveRecord) => {
              navigate(`/erp5/leave/${leaveRecord.id}`);
            }}
            onCancel={() => {
              navigate(`/erp5/leave/${record.id}`);
            }}
          />
        ) : null}
      </RecordStateBoundary>
    </FormPageLayout>
  );
};

export default LeaveEditPage;
