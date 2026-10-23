/**
 * ERP-1 Products & Inventory — Product Creation Form Hook
 *
 * Lightweight React hook managing product form state, client-side validation,
 * field-level error mapping, inflight double-submission prevention, and
 * server (400/409) validation error mapping.
 *
 * @module erp1/web/hooks/useProductForm
 */

import { useState, useCallback, useMemo } from 'react';
import type { CreateProductInput, Product } from '@clearshift/contracts';
import { Erp1ApiError } from '../api/erp-1.js';

export interface ProductFormValues {
  name: string;
  sku: string;
  categoryId: string;
  unitOfMeasure: string;
  price: string;
  currency: string;
  taxRate: string;
  notificationEmail: string;
  contactPhone: string;
}

export interface ProductFormErrors {
  name?: string | undefined;
  sku?: string | undefined;
  categoryId?: string | undefined;
  unitOfMeasure?: string | undefined;
  price?: string | undefined;
  currency?: string | undefined;
  taxRate?: string | undefined;
  notificationEmail?: string | undefined;
  contactPhone?: string | undefined;
  [key: string]: string | undefined;
}

export const DEFAULT_PRODUCT_FORM_VALUES: ProductFormValues = {
  name: '',
  sku: '',
  categoryId: '',
  unitOfMeasure: 'pcs',
  price: '',
  currency: 'USD',
  taxRate: '0.00',
  notificationEmail: '',
  contactPhone: '',
};

const VALID_UOMS = new Set(['pcs', 'kg', 'g', 'litre', 'metre', 'box']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9\s\-()]{7,20}$/;
const DECIMAL_4_PATTERN = /^\d+(\.\d{1,4})?$/;
const DECIMAL_2_PATTERN = /^\d+(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Normalizes snake_case or variant field names from API into camelCase form keys.
 */
const FIELD_NAME_MAP: Record<string, keyof ProductFormValues> = {
  name: 'name',
  sku: 'sku',
  categoryId: 'categoryId',
  category_id: 'categoryId',
  unitOfMeasure: 'unitOfMeasure',
  unit_of_measure: 'unitOfMeasure',
  price: 'price',
  currency: 'currency',
  taxRate: 'taxRate',
  tax_rate: 'taxRate',
  notificationEmail: 'notificationEmail',
  notification_email: 'notificationEmail',
  contactPhone: 'contactPhone',
  contact_phone: 'contactPhone',
};

/**
 * Synchronous client-side validation conforming to Acceptance Criterion 1:
 * Validates required fields, email format, phone numbers, and decimal ranges before submission.
 */
export function validateProductForm(values: ProductFormValues): ProductFormErrors {
  const errors: ProductFormErrors = {};

  // 1. Required: Product Name
  if (!values.name || !values.name.trim()) {
    errors.name = 'Product name is required';
  }

  // 2. Required: SKU
  if (!values.sku || !values.sku.trim()) {
    errors.sku = 'SKU is required';
  }

  // 3. Required: Unit of Measure
  if (!values.unitOfMeasure || !values.unitOfMeasure.trim()) {
    errors.unitOfMeasure = 'Unit of measure is required';
  } else if (!VALID_UOMS.has(values.unitOfMeasure.trim())) {
    errors.unitOfMeasure = 'Unit of measure must be one of: pcs, kg, g, litre, metre, box';
  }

  // 4. Required & Decimal Range: Unit Price
  if (!values.price || !values.price.trim()) {
    errors.price = 'Price is required';
  } else {
    const trimmedPrice = values.price.trim();
    const num = Number(trimmedPrice);
    if (isNaN(num)) {
      errors.price = 'Price must be a valid non-negative decimal with up to 4 decimal places';
    } else if (num < 0) {
      errors.price = 'Price must be greater than or equal to 0';
    } else if (!DECIMAL_4_PATTERN.test(trimmedPrice)) {
      errors.price = 'Price must be a valid non-negative decimal with up to 4 decimal places';
    }
  }

  // 5. Required: Currency (ISO 4217 uppercase code)
  if (!values.currency || !values.currency.trim()) {
    errors.currency = 'Currency is required';
  } else if (!CURRENCY_PATTERN.test(values.currency.trim().toUpperCase())) {
    errors.currency = 'Currency must be an uppercase 3-letter ISO 4217 code (e.g. USD, EUR)';
  }

  // 6. Decimal Range: Tax Rate (optional, defaults to 0.00, range 0.00 to 100.00)
  if (values.taxRate && values.taxRate.trim()) {
    const trimmedTax = values.taxRate.trim();
    if (!DECIMAL_2_PATTERN.test(trimmedTax) || isNaN(Number(trimmedTax))) {
      errors.taxRate = 'Tax rate must be a valid decimal percentage with up to 2 decimal places';
    } else {
      const numTax = Number(trimmedTax);
      if (numTax < 0 || numTax > 100) {
        errors.taxRate = 'Tax rate must be between 0.00% and 100.00%';
      }
    }
  }

  // 7. Email Format: Notification Email (optional, but must be valid if provided)
  if (values.notificationEmail && values.notificationEmail.trim()) {
    const trimmedEmail = values.notificationEmail.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      errors.notificationEmail = 'Invalid email address format (e.g. alerts@example.com)';
    }
  }

  // 8. Phone Numbers: Contact Phone (optional, but must be valid if provided)
  if (values.contactPhone && values.contactPhone.trim()) {
    const trimmedPhone = values.contactPhone.trim();
    if (!PHONE_PATTERN.test(trimmedPhone)) {
      errors.contactPhone = 'Invalid phone number format (min 7 digits, e.g. +1-555-019-2834)';
    }
  }

  return errors;
}

export interface UseProductFormOptions {
  initialValues?: Partial<ProductFormValues> | undefined;
  onSubmit: (input: CreateProductInput) => Promise<Product>;
  onSuccess?: ((product: Product) => void) | undefined;
}

export interface UseProductFormResult {
  values: ProductFormValues;
  errors: ProductFormErrors;
  isSubmitting: boolean;
  isValid: boolean;
  isDirty: boolean;
  submitError: Erp1ApiError | null;
  handleChange: (field: keyof ProductFormValues, value: string) => void;
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  reset: () => void;
  clearError: (field: keyof ProductFormValues) => void;
  clearSubmitError: () => void;
  setFieldError: (field: keyof ProductFormValues, message: string) => void;
}

export function useProductForm(options: UseProductFormOptions): UseProductFormResult {
  const { initialValues, onSubmit, onSuccess } = options;

  const resolvedInitialValues = useMemo<ProductFormValues>(
    () => ({
      ...DEFAULT_PRODUCT_FORM_VALUES,
      ...initialValues,
    }),
    [initialValues]
  );

  const [values, setValues] = useState<ProductFormValues>(resolvedInitialValues);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<Erp1ApiError | null>(null);

  const isDirty = useMemo(() => {
    return Object.keys(values).some(
      (k) =>
        values[k as keyof ProductFormValues] !==
        resolvedInitialValues[k as keyof ProductFormValues]
    );
  }, [values, resolvedInitialValues]);

  const isValid = useMemo(() => {
    return Object.keys(validateProductForm(values)).length === 0;
  }, [values]);

  const handleChange = useCallback((field: keyof ProductFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (prev[field]) {
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return prev;
    });
    setSubmitError(null);
  }, []);

  const clearError = useCallback((field: keyof ProductFormValues) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const setFieldError = useCallback((field: keyof ProductFormValues, message: string) => {
    setErrors((prev) => ({ ...prev, [field]: message }));
  }, []);

  const clearSubmitError = useCallback(() => {
    setSubmitError(null);
  }, []);

  const reset = useCallback(() => {
    setValues(resolvedInitialValues);
    setErrors({});
    setIsSubmitting(false);
    setSubmitError(null);
  }, [resolvedInitialValues]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e && e.preventDefault) {
        e.preventDefault();
      }

      // AC 2: Client submission button disables during inflight request to prevent double-submit
      if (isSubmitting) {
        return;
      }

      // AC 1: Validate required fields, email format, phone numbers, and decimal ranges
      const validationErrors = validateProductForm(values);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        setSubmitError(null);
        return;
      }

      setErrors({});
      setSubmitError(null);
      setIsSubmitting(true);

      try {
        const input: CreateProductInput = {
          name: values.name.trim(),
          sku: values.sku.trim(),
          categoryId: values.categoryId.trim() ? values.categoryId.trim() : null,
          unitOfMeasure: values.unitOfMeasure.trim() as any,
          price: values.price.trim(),
          currency: values.currency.trim().toUpperCase(),
          taxRate: values.taxRate.trim() || '0.00',
          ...(values.notificationEmail.trim()
            ? { notificationEmail: values.notificationEmail.trim() }
            : {}),
          ...(values.contactPhone.trim()
            ? { contactPhone: values.contactPhone.trim() }
            : {}),
        };

        const created = await onSubmit(input);
        setIsSubmitting(false);
        if (onSuccess) {
          onSuccess(created);
        }
      } catch (err: any) {
        setIsSubmitting(false);
        if (err instanceof Erp1ApiError) {
          // AC 3: Server validation errors (400) map directly to corresponding input fields with error text
          if (err.status === 400 && err.details && err.details.length > 0) {
            const fieldErrors: Record<string, string> = {};
            for (const detail of err.details) {
              if (detail.field) {
                const mapped = FIELD_NAME_MAP[detail.field] || (detail.field as keyof ProductFormValues);
                fieldErrors[mapped] = detail.message;
              }
            }
            setErrors((prev) => ({ ...prev, ...fieldErrors }));
          } else if (err.status === 409) {
            setErrors((prev) => ({
              ...prev,
              sku: err.message || 'A product with this SKU already exists',
            }));
          }
          setSubmitError(err);
        } else {
          setSubmitError(
            new Erp1ApiError(
              err?.status || 500,
              err?.code || 'UNKNOWN_ERROR',
              err?.message || 'Failed to create product'
            )
          );
        }
      }
    },
    [isSubmitting, values, onSubmit, onSuccess]
  );

  return {
    values,
    errors,
    isSubmitting,
    isValid,
    isDirty,
    submitError,
    handleChange,
    handleSubmit,
    reset,
    clearError,
    clearSubmitError,
    setFieldError,
  };
}
