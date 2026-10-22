/**
 * ERP-5 HR & Employees — Employee Create Screen
 *
 * @module erp5/web/pages/EmployeeCreatePage
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { EmployeeForm } from '../components/forms/EmployeeForm.js';
import { FormPageLayout } from '../components/FormPageLayout.js';
import { useDepartmentLookup } from '../hooks/useDepartmentLookup.js';

export const EmployeeCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const departmentLookup = useDepartmentLookup();

  return (
    <FormPageLayout
      title="New employee"
      description="Create a staff record. The employee number is unique and the join date can never precede the birth date."
      backTo="/erp5/employees"
      backLabel="Back to the employee list"
    >
      <EmployeeForm
        mode="create"
        departments={departmentLookup.options}
        onSaved={(employee) => {
          navigate(`/erp5/employees/${employee.id}`);
        }}
        onCancel={() => {
          navigate('/erp5/employees');
        }}
      />
    </FormPageLayout>
  );
};

export default EmployeeCreatePage;
