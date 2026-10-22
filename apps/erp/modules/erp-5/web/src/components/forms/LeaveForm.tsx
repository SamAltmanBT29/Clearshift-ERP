/**
 * ERP-5 HR & Employees — Leave Form
 *
 * The create and edit screen of a leave record.
 *
 * Three rules of the contract shape this form:
 *
 *   - **The employee is immutable.** A leave is a fact about one employee
 *     and is never re-parented, so the edit screen shows it as a read-only
 *     value and the contract's update schema does not accept it at all.
 *   - **The status is a transition, not a field.** The V1 leave state matrix
 *     (ERP5-06) allows `pending → approved | rejected`; `approved` and
 *     `rejected` are terminal. The form therefore offers **only** the
 *     transitions the matrix allows, and a record that is already decided
 *     offers none — the status is then a read-only, server-computed value.
 *   - **A decision is irreversible.** Changing the status is confirmed once,
 *     in plain words, before the record is written.
 *
 * @module erp5/web/components/forms/LeaveForm
 */

import React, { useMemo, useRef, useState } from 'react';
import { Alert } from '@cs/ui';
import {
  CreateHrLeaveRequestSchema,
  HR_LEAVE_STATUS_TRANSITIONS,
  UpdateHrLeaveRequestSchema,
  type CreateHrLeaveRequest,
  type HrLeave,
  type LeaveStatus,
  type UpdateHrLeaveRequest,
} from '@clearshift/contracts';
import { createLeave, updateLeave } from '../../api/erp-5.js';
import { pickChangedFields, useHrForm, type HrFormValues } from '../../hooks/useHrForm.js';
import type { EmployeeOption } from '../../hooks/useEmployeeLookup.js';
import { ConfirmActionDialog } from './ConfirmActionDialog.js';
import { FormActions, ReadOnlyValue, SelectField, TextField } from './FormControls.js';

export interface LeaveFormProps {
  readonly mode: 'create' | 'edit';
  /** The record being edited — required in edit mode. */
  readonly leaveRecord?: HrLeave | undefined;
  /** The employees a leave record can belong to. */
  readonly employees: readonly EmployeeOption[];
  readonly onSaved: (leaveRecord: HrLeave) => void;
  readonly onCancel: () => void;
}

const TYPE_OPTIONS = [
  { value: 'sick', label: 'Sick' },
  { value: 'holiday', label: 'Holiday' },
  { value: 'other', label: 'Other' },
];

const STATUS_LABELS: Readonly<Record<LeaveStatus, string>> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const LeaveForm: React.FC<LeaveFormProps> = ({
  mode,
  leaveRecord,
  employees,
  onSaved,
  onCancel,
}) => {
  const isEdit = mode === 'edit';
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmedStatusRef = useRef<string | null>(null);

  const initialValues = useMemo<HrFormValues>(() => {
    if (!isEdit) {
      return { employee_id: '', date_from: '', date_to: '', type: 'sick' };
    }
    // The employee of a record is immutable, and the status is a transition
    // and not a field: neither is a value of the form, so neither can end
    // up in the patch.
    return {
      date_from: leaveRecord?.date_from ?? '',
      date_to: leaveRecord?.date_to ?? '',
      type: leaveRecord?.type ?? 'sick',
      status: '',
    };
  }, [isEdit, leaveRecord]);

  const form = useHrForm<CreateHrLeaveRequest | UpdateHrLeaveRequest>({
    schema: isEdit ? UpdateHrLeaveRequestSchema : CreateHrLeaveRequestSchema,
    initialValues,
    onSubmit: async (parsed, changedFields) => {
      if (isEdit) {
        const patch = pickChangedFields(
          parsed as Record<string, unknown>,
          changedFields
        ) as UpdateHrLeaveRequest;
        const saved = await updateLeave(leaveRecord?.id ?? '', patch);
        onSaved(saved);
        return;
      }
      const saved = await createLeave(parsed as CreateHrLeaveRequest);
      onSaved(saved);
    },
  });

  /**
   * The transitions the contract allows from the current status. A record
   * that is already decided offers none — the status is then read-only.
   */
  const allowedTransitions = useMemo<readonly LeaveStatus[]>(
    () =>
      isEdit
        ? (HR_LEAVE_STATUS_TRANSITIONS[leaveRecord?.status ?? 'pending'] ?? [])
        : [],
    [isEdit, leaveRecord]
  );

  const selectedStatus = form.values['status'] ?? '';
  const statusChanged = form.changedFields.includes('status');
  const needsConfirmation =
    statusChanged && confirmedStatusRef.current !== selectedStatus;

  const handleFormSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (needsConfirmation) {
      setIsConfirming(true);
      return;
    }
    form.handleSubmit(event);
  };

  const confirmStatusChange = () => {
    confirmedStatusRef.current = selectedStatus;
    setIsConfirming(false);
    form.handleSubmit({ preventDefault: () => undefined });
  };

  const cancelStatusChange = () => {
    // The status goes back to the value the record had, so a cancelled
    // confirmation leaves no half-made change behind.
    confirmedStatusRef.current = null;
    setIsConfirming(false);
    form.setValue('status', initialValues['status'] ?? '');
  };

  const employeeOptions = employees.map((employee) => ({
    value: employee.id,
    label: employee.label,
  }));

  return (
    <form className="cs-erp5-form" noValidate onSubmit={handleFormSubmit}>
      {form.submitError ? (
        <Alert variant="error" title="The leave record could not be saved">
          <p>{form.submitError.message}</p>
          {form.submitError.correlationId ? (
            <p>
              Reference: <code>{form.submitError.correlationId}</code>
            </p>
          ) : null}
        </Alert>
      ) : null}

      <div className="cs-erp5-form-grid">
        {isEdit ? (
          <ReadOnlyValue
            label="Employee"
            value={leaveRecord?.employee_id ?? '—'}
            helperText="A leave belongs to one employee and is never re-parented."
          />
        ) : (
          <SelectField
            id="leave-employee"
            label="Employee"
            value={form.values['employee_id'] ?? ''}
            options={employeeOptions}
            onChange={(value) => form.setValue('employee_id', value)}
            required
            error={form.errors['employee_id']}
            placeholder="Select an employee"
            helperText={`The first ${employees.length} employees of the module. Use the leave list to reach an employee outside that page.`}
          />
        )}
        <TextField
          id="leave-date-from"
          label="From"
          type="date"
          value={form.values['date_from'] ?? ''}
          onChange={(value) => form.setValue('date_from', value)}
          required
          error={form.errors['date_from']}
          helperText="YYYY-MM-DD."
        />
        <TextField
          id="leave-date-to"
          label="To"
          type="date"
          value={form.values['date_to'] ?? ''}
          onChange={(value) => form.setValue('date_to', value)}
          required
          error={form.errors['date_to']}
          helperText="Never before the start date."
        />
        <SelectField
          id="leave-type"
          label="Type"
          value={form.values['type'] ?? ''}
          options={TYPE_OPTIONS}
          onChange={(value) => form.setValue('type', value)}
          required
          error={form.errors['type']}
        />

        {isEdit && allowedTransitions.length > 0 ? (
          <>
            <ReadOnlyValue
              label="Status"
              value={STATUS_LABELS[leaveRecord?.status ?? 'pending']}
              helperText="The status the module computed for this record."
            />
            <SelectField
              id="leave-status"
              label="Decide this record"
              value={selectedStatus}
              options={allowedTransitions.map((status) => ({
                value: status,
                label: STATUS_LABELS[status],
              }))}
              onChange={(value) => form.setValue('status', value)}
              error={form.errors['status']}
              placeholder="Leave the record as it is"
              helperText="A decision is final and cannot be reversed."
            />
          </>
        ) : (
          <ReadOnlyValue
            label="Status"
            value={STATUS_LABELS[leaveRecord?.status ?? 'pending']}
            helperText={
              isEdit
                ? 'The record is already decided — a decision is never reversed.'
                : 'A new leave record is created as pending. The status is set by the server.'
            }
          />
        )}
      </div>

      {isEdit ? (
        <dl className="cs-erp5-readonly-list">
          <ReadOnlyValue label="Leave id" value={leaveRecord?.id ?? '—'} />
          <ReadOnlyValue label="Created" value={leaveRecord?.created_at ?? '—'} />
          <ReadOnlyValue label="Updated" value={leaveRecord?.updated_at ?? '—'} />
        </dl>
      ) : null}

      <FormActions
        isSubmitting={form.isSubmitting}
        isDirty={form.isDirty}
        submitLabel={isEdit ? 'Save changes' : 'Create leave record'}
        requiresChange={isEdit}
        onCancel={onCancel}
        disabledHint={isEdit ? 'Change a field to enable the save.' : undefined}
      />

      <ConfirmActionDialog
        isOpen={isConfirming}
        title="Decide this leave record"
        confirmLabel={STATUS_LABELS[(selectedStatus as LeaveStatus) ?? 'pending']}
        cancelLabel="Keep the current value"
        onConfirm={confirmStatusChange}
        onCancel={cancelStatusChange}
        message={
          <>
            <p>
              A leave record is decided once. The status becomes{' '}
              <strong>{STATUS_LABELS[(selectedStatus as LeaveStatus) ?? 'pending']}</strong> and
              cannot be changed afterwards.
            </p>
            <p>The decision is written to the module and is visible to every reader.</p>
          </>
        }
      />
    </form>
  );
};

export default LeaveForm;
