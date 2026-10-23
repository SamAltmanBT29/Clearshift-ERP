/**
 * ERP-5 HR & Employees — Form Hook
 *
 * One form mechanism for the module's create and edit screens.
 *
 * **The validation is the contract's.** The hook is handed the *same* Zod
 * schema the API validates the payload with — `CreateHrEmployeeRequestSchema`,
 * `UpdateHrLeaveRequestSchema` and so on, straight out of
 * `@clearshift/contracts`. The client therefore never re-states a rule: the
 * message the operator reads on the field is the message the contract
 * defines, and a rule that changes in the contract changes in the browser in
 * the same commit.
 *
 * The schema is typed **structurally** on purpose. The contracts package
 * carries its own Zod major, and the hook must not be coupled to it.
 *
 * Two rules the hook enforces on its own:
 *
 *   - a value that is empty is **not** sent as an empty string. An empty
 *     optional field is dropped; an empty required field fails the contract;
 *   - only the fields whose value actually changed are reported as changed,
 *     so an edit sends a patch of what the operator touched.
 *
 * The server stays authoritative. The client validation exists to give the
 * operator a field-level answer without a round trip; the API re-validates
 * every payload and is the only authority.
 *
 * @module erp5/web/hooks/useHrForm
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { HrApiError } from '../api/erp-5.js';

/** One issue of a failed validation. */
export interface HrFormIssue {
  readonly path: (string | number)[];
  readonly message: string;
  readonly code?: string | undefined;
}

/**
 * The structural shape of a Zod schema.
 *
 * The module is not coupled to a Zod major version: it only needs
 * `safeParse` and the shape of its result.
 */
export interface HrFormSchema<TValues> {
  safeParse(
    data: unknown
  ):
    | { readonly success: true; readonly data: TValues }
    | {
        readonly success: false;
        /** Zod 3 carries the issues on the error object. */
        readonly error?: { readonly issues: readonly HrFormIssue[] } | undefined;
        /** Zod 4 carries them on the result itself. */
        readonly issues?: readonly HrFormIssue[] | undefined;
      };
}

/** The values a form holds — every field is a string in the browser. */
export type HrFormValues = Record<string, string>;

export interface UseHrFormOptions<TValues> {
  /** The contract schema the payload is validated with. */
  readonly schema: HrFormSchema<TValues>;
  /** The values the form starts with. */
  readonly initialValues: HrFormValues;
  /**
   * Called with the validated values and the names of the fields that
   * changed once the contract accepted them.
   */
  readonly onSubmit: (
    values: TValues,
    changedFields: readonly string[]
  ) => Promise<void>;
}

export interface UseHrFormResult {
  /** The current values, as strings. */
  readonly values: HrFormValues;
  /** The field-level messages of the last validation. */
  readonly errors: Readonly<Record<string, string>>;
  /** The names of the fields whose value differs from the initial value. */
  readonly changedFields: readonly string[];
  /** True while the submit is in flight. */
  readonly isSubmitting: boolean;
  /** True when the current values satisfy the contract. */
  readonly isValid: boolean;
  /** True when the operator has changed something. */
  readonly isDirty: boolean;
  /** The failure of the last submit, or `null`. */
  readonly submitError: HrApiError | null;
  /** Sets one field. */
  readonly setValue: (field: string, value: string) => void;
  /** Sets several fields at once. */
  readonly setValues: (values: Partial<Record<string, string>>) => void;
  /** The submit handler of the `<form>`. */
  readonly handleSubmit: (event: { preventDefault: () => void }) => void;
  /** Clears the failure of the last submit. */
  readonly clearSubmitError: () => void;
}

/**
 * An empty string means "not provided".
 *
 * The contract decides what a missing value means: an optional field is
 * simply absent, a required field fails.
 */
function withoutEmptyValues(values: HrFormValues): HrFormValues {
  const normalised: Record<string, string> = {};
  for (const [field, value] of Object.entries(values)) {
    if (value !== '') {
      normalised[field] = value;
    }
  }
  return normalised;
}

/** The issues of a failed validation, whichever Zod major produced them. */
function readIssues(result: {
  readonly error?: { readonly issues: readonly HrFormIssue[] } | undefined;
  readonly issues?: readonly HrFormIssue[] | undefined;
}): readonly HrFormIssue[] {
  return result.issues ?? result.error?.issues ?? [];
}

function issuesToErrors(issues: readonly HrFormIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== 'string') {
      continue;
    }
    // The first issue of a field wins — it is the most specific one.
    if (errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

/**
 * Keeps only the fields that changed.
 *
 * An edit sends a patch of what the operator touched, so a field the API
 * never accepted — a protected, a masked or a system-maintained one — cannot
 * ride along with a legitimate change.
 */
export function pickChangedFields<T extends Record<string, unknown>>(
  source: T,
  fields: readonly string[]
): Partial<T> {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined) {
      picked[field] = value;
    }
  }
  return picked as Partial<T>;
}

export function useHrForm<TValues>(  options: UseHrFormOptions<TValues>
): UseHrFormResult {
  const { schema, initialValues, onSubmit } = options;

  const [values, setValues] = useState<HrFormValues>(initialValues);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<HrApiError | null>(null);

  // The initial values are read through a ref: they are the baseline of the
  // "changed" computation and must not re-trigger anything when they change.
  const initialRef = useRef(initialValues);
  initialRef.current = initialValues;

  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  const changedFields = useMemo<readonly string[]>(() => {
    const baseline = initialRef.current;
    return Object.keys(values).filter((field) => values[field] !== baseline[field]);
  }, [values]);

  const isDirty = changedFields.length > 0;

  const validation = useMemo(() => {
    const result = schemaRef.current.safeParse(withoutEmptyValues(values));
    if (result.success) {
      return { valid: true as const, errors: {} as Record<string, string> };
    }
    return { valid: false as const, errors: issuesToErrors(readIssues(result)) };
  }, [values]);

  const setValue = useCallback((field: string, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setSubmitError(null);
  }, []);

  const setValuesMany = useCallback((next: Partial<Record<string, string>>) => {
    setValues((current) => {
      const merged: HrFormValues = { ...current };
      for (const [field, value] of Object.entries(next)) {
        if (value !== undefined) {
          merged[field] = value;
        }
      }
      return merged;
    });
    setSubmitError(null);
  }, []);

  const handleSubmit = useCallback(
    (event: { preventDefault: () => void }) => {
      event.preventDefault();
      if (isSubmitting) {
        return;
      }

      const result = schemaRef.current.safeParse(withoutEmptyValues(values));

      if (!result.success) {
        // The contract refused the values — nothing is sent, so nothing can
        // be mutated.
        setErrors(issuesToErrors(readIssues(result)));
        setSubmitError(null);
        return;
      }

      setErrors({});
      setIsSubmitting(true);
      setSubmitError(null);

      onSubmitRef
        .current(result.data, changedFields)
        .catch((cause: unknown) => {
          setSubmitError(
            cause instanceof Error && 'status' in cause
              ? (cause as HrApiError)
              : new HrApiError(0, 'HR_API_UNREACHABLE', 'The change could not be saved.')
          );
        })
        .finally(() => {
          setIsSubmitting(false);
        });
    },
    [changedFields, isSubmitting, values]
  );

  const clearSubmitError = useCallback(() => {
    setSubmitError(null);
  }, []);

  return {
    values,
    errors,
    changedFields,
    isSubmitting,
    isValid: validation.valid,
    isDirty,
    submitError,
    setValue,
    setValues: setValuesMany,
    handleSubmit,
    clearSubmitError,
  };
}
