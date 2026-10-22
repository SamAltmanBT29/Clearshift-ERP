/**
 * ERP-5 HR & Employees — Employee Form
 *
 * The create and edit screen of an employee.
 *
 * **The validation is the contract's.** The form is handed
 * `CreateHrEmployeeRequestSchema` or `UpdateHrEmployeeRequestSchema` — the
 * very objects the API validates the payload with — so the message the
 * operator reads on a field is the message the contract defines. BR-ERP5-01
 * is therefore enforced in the browser by the contract's own refinement, and
 * again by the API.
 *
 * **The masked salary is never an input.** The API returns `salary_display`,
 * never the raw column (BR-ERP5-02), so the edit form cannot prefill a
 * salary. The field starts empty and an empty field is *not sent* — the
 * salary is simply left alone. The masked value is shown beside it as a
 * read-only value, which is text and not a form control.
 *
 * @module erp5/web/components/forms/EmployeeForm
 */

import React, { useMemo } from 'react';
import { Alert } from '@cs/ui';
import {
  CreateHrEmployeeRequestSchema,
  UpdateHrEmployeeRequestSchema,
  type CreateHrEmployeeRequest,
  type HrEmployeeView,
  type UpdateHrEmployeeRequest,
} from '@clearshift/contracts';
import { createEmployee, updateEmployee } from '../../api/erp-5.js';
import { useHrForm, pickChangedFields, type HrFormValues } from '../../hooks/useHrForm.js';
import type { DepartmentOption } from '../../hooks/useDepartmentLookup.js';
import { FormActions, ReadOnlyValue, SelectField, TextField } from './FormControls.js';

export interface EmployeeFormProps {
  readonly mode: 'create' | 'edit';
  /** The record being edited — required in edit mode. */
  readonly employee?: HrEmployeeView | undefined;
  readonly departments: readonly DepartmentOption[];
  /** Called with the saved record. */
  readonly onSaved: (employee: HrEmployeeView) => void;
  readonly onCancel: () => void;
}

export const EmployeeForm: React.FC<EmployeeFormProps> = ({
  mode,
  employee,
  departments,
  onSaved,
  onCancel,
}) => {
  const isEdit = mode === 'edit';

  const initialValues = useMemo<HrFormValues>(() => {
    if (!isEdit) {
      return {
        employee_no: '',
        first_name: '',
        last_name: '',
        birth_date: '',
        join_date: '',
        department_id: '',
        job_title: '',
        salary: '',
        currency_code: 'INR',
      };
    }
    return {
      employee_no: employee?.employee_no ?? '',
      first_name: employee?.first_name ?? '',
      last_name: employee?.last_name ?? '',
      birth_date: employee?.birth_date ?? '',
      join_date: employee?.join_date ?? '',
      department_id: employee?.department_id ?? '',
      job_title: employee?.job_title ?? '',
      // The raw salary is never returned by the API, so the field starts
      // empty and an empty field is left out of the patch.
      salary: '',
    };
  }, [isEdit, employee]);

  const form = useHrForm<CreateHrEmployeeRequest | UpdateHrEmployeeRequest>({
    schema: isEdit ? UpdateHrEmployeeRequestSchema : CreateHrEmployeeRequestSchema,
    initialValues,
    onSubmit: async (parsed, changedFields) => {
      if (isEdit) {
        // The mode is fixed for the lifetime of the form, so the cast is
        // sound: the edit branch only ever parses the update schema.
        const patch = pickChangedFields(
          parsed as Record<string, unknown>,
          changedFields
        ) as UpdateHrEmployeeRequest;
        const saved = await updateEmployee(employee?.id ?? '', patch);
        onSaved(saved);
        return;
      }
      const saved = await createEmployee(parsed as CreateHrEmployeeRequest);
      onSaved(saved);
    },
  });

  const departmentOptions = departments.map((department) => ({
    value: department.id,
    label: department.name,
  }));

  return (
    <form className="cs-erp5-form" noValidate onSubmit={form.handleSubmit}>
      {form.submitError ? (
        <Alert variant="error" title="The employee could not be saved">
          <p>{form.submitError.message}</p>
          {form.submitError.correlationId ? (
            <p>
              Reference: <code>{form.submitError.correlationId}</code>
            </p>
          ) : null}
        </Alert>
      ) : null}

      <div className="cs-erp5-form-grid">
        <TextField
          id="employee-no"
          label="Employee number"
          value={form.values['employee_no'] ?? ''}
          onChange={(value) => form.setValue('employee_no', value)}
          required
          maxLength={32}
          error={form.errors['employee_no']}
          helperText="Unique across the module. Letters, digits, hyphen and underscore only."
        />
        <TextField
          id="employee-first-name"
          label="First name"
          value={form.values['first_name'] ?? ''}
          onChange={(value) => form.setValue('first_name', value)}
          required
          maxLength={120}
          error={form.errors['first_name']}
        />
        <TextField
          id="employee-last-name"
          label="Last name"
          value={form.values['last_name'] ?? ''}
          onChange={(value) => form.setValue('last_name', value)}
          required
          maxLength={120}
          error={form.errors['last_name']}
        />
        <TextField
          id="employee-birth-date"
          label="Birth date"
          type="date"
          value={form.values['birth_date'] ?? ''}
          onChange={(value) => form.setValue('birth_date', value)}
          required
          error={form.errors['birth_date']}
          helperText="YYYY-MM-DD."
        />
        <TextField
          id="employee-join-date"
          label="Join date"
          type="date"
          value={form.values['join_date'] ?? ''}
          onChange={(value) => form.setValue('join_date', value)}
          required
          error={form.errors['join_date']}
          helperText="Never before the birth date (BR-ERP5-01)."
        />
        <SelectField
          id="employee-department"
          label="Department"
          value={form.values['department_id'] ?? ''}
          options={departmentOptions}
          onChange={(value) => form.setValue('department_id', value)}
          required
          error={form.errors['department_id']}
          placeholder="Select a department"
        />
        <TextField
          id="employee-job-title"
          label="Job title"
          value={form.values['job_title'] ?? ''}
          onChange={(value) => form.setValue('job_title', value)}
          required
          maxLength={120}
          error={form.errors['job_title']}
        />
        <TextField
          id="employee-salary"
          label="Salary"
          value={form.values['salary'] ?? ''}
          onChange={(value) => form.setValue('salary', value)}
          required={!isEdit}
          error={form.errors['salary']}
          helperText={
            isEdit
              ? 'Leave empty to keep the current salary. The raw value is never returned by the API.'
              : 'A non-negative decimal with up to four decimal places.'
          }
        />
        {isEdit ? (
          <ReadOnlyValue
            label="Current salary"
            value={employee?.salary_display ?? '—'}
            helperText="Masked by the API (BR-ERP5-02)."
          />
        ) : (
          <TextField
            id="employee-currency"
            label="Currency"
            value={form.values['currency_code'] ?? ''}
            onChange={(value) => form.setValue('currency_code', value)}
            maxLength={3}
            error={form.errors['currency_code']}
            helperText="ISO 4217 code. Defaults to INR and cannot be changed afterwards."
          />
        )}
      </div>

      {isEdit ? (
        <dl className="cs-erp5-readonly-list">
          <ReadOnlyValue label="Employee id" value={employee?.id ?? '—'} />
          <ReadOnlyValue
            label="Currency"
            value={employee?.currency_code ?? '—'}
            helperText="Set on create and immutable afterwards."
          />
          <ReadOnlyValue label="Created" value={employee?.created_at ?? '—'} />
          <ReadOnlyValue label="Updated" value={employee?.updated_at ?? '—'} />
        </dl>
      ) : null}

      <FormActions
        isSubmitting={form.isSubmitting}
        isDirty={form.isDirty}
        submitLabel={isEdit ? 'Save changes' : 'Create employee'}
        requiresChange={isEdit}
        onCancel={onCancel}
        disabledHint={isEdit ? 'Change a field to enable the save.' : undefined}
      />
    </form>
  );
};

export default EmployeeForm;
