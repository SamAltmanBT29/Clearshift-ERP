/**
 * ERP-5 HR & Employees — Form Controls
 *
 * The building blocks of the module's forms. Every control is built on the
 * shared `FormField` of `@cs/ui`, so the label, the helper text and the
 * error are associated with the control exactly as the platform does it.
 *
 * One rule the forms follow: **the form does not use the browser's own
 * validation.** The `<form>` carries `noValidate`, so an invalid value
 * produces the *contract's* field-level message instead of a native bubble
 * that says nothing about the module's rules. The server re-validates the
 * payload either way.
 *
 * @module erp5/web/components/forms/FormControls
 */

import React from 'react';
import { FormField } from '@cs/ui';

export interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly required?: boolean | undefined;
  readonly error?: string | undefined;
  readonly helperText?: string | undefined;
  readonly type?: 'text' | 'date' | 'month' | 'number' | undefined;
  readonly placeholder?: string | undefined;
  readonly maxLength?: number | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly autoComplete?: string | undefined;
}

export const TextField: React.FC<TextFieldProps> = ({
  id,
  label,
  value,
  onChange,
  required = false,
  error,
  helperText,
  type = 'text',
  placeholder,
  maxLength,
  disabled = false,
  readOnly = false,
  autoComplete,
}) => (
  <FormField
    id={id}
    label={label}
    required={required}
    {...(error ? { error } : {})}
    {...(helperText ? { helperText } : {})}
  >
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      readOnly={readOnly}
      autoComplete={autoComplete}
      onChange={(event) => onChange(event.target.value)}
    />
  </FormField>
);

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly required?: boolean | undefined;
  readonly error?: string | undefined;
  readonly helperText?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** The label of the empty option, when the field is optional. */
  readonly placeholder?: string | undefined;
}

export const SelectField: React.FC<SelectFieldProps> = ({
  id,
  label,
  value,
  options,
  onChange,
  required = false,
  error,
  helperText,
  disabled = false,
  placeholder,
}) => (
  <FormField
    id={id}
    label={label}
    required={required}
    {...(error ? { error } : {})}
    {...(helperText ? { helperText } : {})}
  >
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </FormField>
);

export interface ReadOnlyValueProps {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly helperText?: string | undefined;
}

/**
 * A value the operator may read but not write.
 *
 * It is rendered as **text**, never as an input. A read-only field that is
 * still a form control is a field the browser can be talked into changing;
 * a value that is not a control at all cannot be edited, and the client
 * never sends it — the API's strict request schemas refuse it as well.
 */
export const ReadOnlyValue: React.FC<ReadOnlyValueProps> = ({ label, value, helperText }) => (
  <div className="cs-erp5-readonly">
    <dt className="cs-erp5-readonly-label">{label}</dt>
    <dd className="cs-erp5-readonly-value">{value}</dd>
    {helperText ? <p className="cs-erp5-readonly-hint">{helperText}</p> : null}
  </div>
);

export interface FormActionsProps {
  readonly isSubmitting: boolean;
  readonly isDirty: boolean;
  readonly submitLabel: string;
  readonly cancelLabel?: string | undefined;
  readonly onCancel: () => void;
  /**
   * Whether the submit stays disabled until something changed.
   *
   * An **edit** screen has nothing to save until a field changed, so it waits
   * for the operator. A **create** screen is incomplete from the first
   * moment, so its submit is always available — otherwise the operator could
   * never ask the contract which fields are still missing.
   */
  readonly requiresChange?: boolean | undefined;
  /** Explains why the submit is disabled. */
  readonly disabledHint?: string | undefined;
}

export const FormActions: React.FC<FormActionsProps> = ({
  isSubmitting,
  isDirty,
  submitLabel,
  cancelLabel = 'Cancel',
  onCancel,
  requiresChange = false,
  disabledHint,
}) => {
  const isDisabled = isSubmitting || (requiresChange && !isDirty);

  return (
    <div className="cs-erp5-form-actions">
      <button
        type="submit"
        className="cs-erp5-button cs-erp5-button-primary"
        disabled={isDisabled}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? 'Saving…' : submitLabel}
      </button>
      <button
        type="button"
        className="cs-erp5-button cs-erp5-button-secondary"
        onClick={onCancel}
        disabled={isSubmitting}
      >
        {cancelLabel}
      </button>
      {requiresChange && !isDirty && disabledHint ? (
        <p className="cs-erp5-form-hint">{disabledHint}</p>
      ) : null}
    </div>
  );
};
