/**
 * ERP-5 HR & Employees — Department Create Screen
 *
 * @module erp5/web/pages/DepartmentCreatePage
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FormPageLayout } from '../components/FormPageLayout.js';
import { DepartmentForm } from '../components/forms/DepartmentForm.js';
import { useDepartmentLookup } from '../hooks/useDepartmentLookup.js';

export const DepartmentCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const departmentLookup = useDepartmentLookup();

  return (
    <FormPageLayout
      title="New department"
      description="Create a department. A department may reference an optional parent department."
      backTo="/erp5/departments"
      backLabel="Back to the department list"
    >
      <DepartmentForm
        mode="create"
        departments={departmentLookup.options}
        onSaved={(department) => {
          navigate(`/erp5/departments/${department.id}`);
        }}
        onCancel={() => {
          navigate('/erp5/departments');
        }}
      />
    </FormPageLayout>
  );
};

export default DepartmentCreatePage;
