/**
 * ERP-5 HR & Employees — Department Form
 *
 * The create and edit screen of a department.
 *
 * The contract decides the two rules this form has to respect:
 *
 *   - `parent_id` is **nullable**. On an edit, an empty parent means
 *     *"clear the parent"* and is sent as an explicit `null` — which is the
 *     only way the contract accepts a cleared reference;
 *   - a department may not be its own parent. The API refuses the
 *     self-reference, and the form does not offer the department itself as a
 *     parent.
 *
 * @module erp5/web/components/forms/DepartmentForm
 */

import React, { useMemo } from 'react';
import { Alert } from '@cs/ui';
import {
  CreateHrDepartmentRequestSchema,
  UpdateHrDepartmentRequestSchema,
  type CreateHrDepartmentRequest,
  type HrDepartment,
  type UpdateHrDepartmentRequest,
} from '@clearshift/contracts';
import { createDepartment, updateDepartment } from '../../api/erp-5.js';
import { pickChangedFields, useHrForm, type HrFormValues } from '../../hooks/useHrForm.js';
import type { DepartmentOption } from '../../hooks/useDepartmentLookup.js';
import { FormActions, ReadOnlyValue, SelectField, TextField } from './FormControls.js';

export interface DepartmentFormProps {
  readonly mode: 'create' | 'edit';
  /** The record being edited — required in edit mode. */
  readonly department?: HrDepartment | undefined;
  /** The departments that may be chosen as a parent. */
  readonly departments: readonly DepartmentOption[];
  readonly onSaved: (department: HrDepartment) => void;
  readonly onCancel: () => void;
}

export const DepartmentForm: React.FC<DepartmentFormProps> = ({
  mode,
  department,
  departments,
  onSaved,
  onCancel,
}) => {
  const isEdit = mode === 'edit';

  const initialValues = useMemo<HrFormValues>(() => {
    if (!isEdit) {
      return { name: '', code: '', parent_id: '' };
    }
    return {
      name: department?.name ?? '',
      code: department?.code ?? '',
      parent_id: department?.parent_id ?? '',
    };
  }, [isEdit, department]);

  const form = useHrForm<CreateHrDepartmentRequest | UpdateHrDepartmentRequest>({
    schema: isEdit ? UpdateHrDepartmentRequestSchema : CreateHrDepartmentRequestSchema,
    initialValues,
    onSubmit: async (parsed, changedFields) => {
      if (isEdit) {
        const patch = pickChangedFields(
          parsed as Record<string, unknown>,
          changedFields
        ) as UpdateHrDepartmentRequest;
        // A cleared parent is sent as an explicit `null` — the contract
        // accepts `null` to clear the reference and `undefined` to leave it
        // alone. An empty field is therefore not "absent" here.
        if (changedFields.includes('parent_id')) {
          patch.parent_id =
            form.values['parent_id'] === '' ? null : (patch.parent_id ?? null);
        }
        const saved = await updateDepartment(department?.id ?? '', patch);
        onSaved(saved);
        return;
      }
      const payload = parsed as CreateHrDepartmentRequest;
      const created = await createDepartment({
        ...payload,
        ...(payload.parent_id === undefined ? {} : { parent_id: payload.parent_id }),
      });
      onSaved(created);
    },
  });

  const parentOptions = departments
    .filter((option) => option.id !== department?.id)
    .map((option) => ({ value: option.id, label: option.name }));

  return (
    <form className="cs-erp5-form" noValidate onSubmit={form.handleSubmit}>
      {form.submitError ? (
        <Alert variant="error" title="The department could not be saved">
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
          id="department-name"
          label="Name"
          value={form.values['name'] ?? ''}
          onChange={(value) => form.setValue('name', value)}
          required
          maxLength={255}
          error={form.errors['name']}
        />
        <TextField
          id="department-code"
          label="Code"
          value={form.values['code'] ?? ''}
          onChange={(value) => form.setValue('code', value)}
          required
          maxLength={32}
          error={form.errors['code']}
          helperText="Unique across the module. Letters, digits, hyphen and underscore only."
        />
        <SelectField
          id="department-parent"
          label="Parent department"
          value={form.values['parent_id'] ?? ''}
          options={parentOptions}
          onChange={(value) => form.setValue('parent_id', value)}
          error={form.errors['parent_id']}
          placeholder="No parent"
          helperText={
            isEdit
              ? 'Choose a parent, or clear it to detach the department from its parent.'
              : 'Optional. A department may sit at the top of the hierarchy.'
          }
        />
      </div>

      {isEdit ? (
        <dl className="cs-erp5-readonly-list">
          <ReadOnlyValue label="Department id" value={department?.id ?? '—'} />
          <ReadOnlyValue label="Created" value={department?.created_at ?? '—'} />
          <ReadOnlyValue label="Updated" value={department?.updated_at ?? '—'} />
        </dl>
      ) : null}

      <FormActions
        isSubmitting={form.isSubmitting}
        isDirty={form.isDirty}
        submitLabel={isEdit ? 'Save changes' : 'Create department'}
        requiresChange={isEdit}
        onCancel={onCancel}
        disabledHint={isEdit ? 'Change a field to enable the save.' : undefined}
      />
    </form>
  );
};

export default DepartmentForm;
