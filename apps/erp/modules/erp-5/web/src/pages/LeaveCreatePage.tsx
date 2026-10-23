/**
 * ERP-5 HR & Employees — Leave Create Screen
 *
 * @module erp5/web/pages/LeaveCreatePage
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FormPageLayout } from '../components/FormPageLayout.js';
import { LeaveForm } from '../components/forms/LeaveForm.js';
import { useEmployeeLookup } from '../hooks/useEmployeeLookup.js';

export const LeaveCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const employeeLookup = useEmployeeLookup();

  return (
    <FormPageLayout
      title="New leave record"
      description="Record a leave request. The end date can never precede the start date, and the record is created as pending."
      backTo="/erp5/leave"
      backLabel="Back to the leave list"
    >
      <LeaveForm
        mode="create"
        employees={employeeLookup.options}
        onSaved={(leaveRecord) => {
          navigate(`/erp5/leave/${leaveRecord.id}`);
        }}
        onCancel={() => {
          navigate('/erp5/leave');
        }}
      />
    </FormPageLayout>
  );
};

export default LeaveCreatePage;
