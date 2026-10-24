/**
 * ERP-5 HR & Employees — Leave Detail Screen
 *
 * The read-only view of one leave record, including the status the server
 * computed and the transitions the V1 state matrix still allows.
 *
 * @module erp5/web/pages/LeaveDetailPage
 */

import React, { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  HR_LEAVE_STATUS_TRANSITIONS,
  type HrLeave,
  type LeaveStatus,
} from '@clearshift/contracts';
import { getLeave } from '../api/erp-5.js';
import { FormPageLayout } from '../components/FormPageLayout.js';
import { RecordDetail } from '../components/RecordDetail.js';
import { RecordStateBoundary } from '../components/RecordStateBoundary.js';
import { useHrRecord } from '../hooks/useHrRecord.js';

const STATUS_LABELS: Readonly<Record<LeaveStatus, string>> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const LeaveDetailPage: React.FC = () => {
  const { leaveId } = useParams<{ leaveId: string }>();

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
      title="Leave record"
      description="One leave request with its period, its type and the status the module computed."
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
          <>
            <div className="cs-erp5-detail-actions">
              <Link
                className="cs-erp5-button cs-erp5-button-primary"
                to={`/erp5/leave/${record.id}/edit`}
              >
                Edit leave record
              </Link>
            </div>
            <RecordDetail
              caption="Leave record"
              items={[
                {
                  label: 'Employee',
                  value: (
                    <Link className="cs-erp5-row-link" to={`/erp5/employees/${record.employee_id}`}>
                      {record.employee_id}
                    </Link>
                  ),
                },
                { label: 'From', value: record.date_from },
                { label: 'To', value: record.date_to },
                { label: 'Type', value: record.type },
                {
                  label: 'Status',
                  value: STATUS_LABELS[record.status],
                  helperText:
                    (HR_LEAVE_STATUS_TRANSITIONS[record.status] ?? []).length === 0
                      ? 'The record is decided — a decision is never reversed.'
                      : 'The record is still open and can be decided once.',
                },
                { label: 'Leave id', value: record.id },
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

export default LeaveDetailPage;
