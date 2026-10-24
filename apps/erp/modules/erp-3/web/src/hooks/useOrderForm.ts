/**
 * ERP-3 Sales Orders & Invoices — Sales Order Form Hook
 *
 * Lightweight React hook managing sales order form state, client-side Zod/regex validation,
 * field-level error mapping, inflight double-submission prevention, and
 * server (400/409) validation error mapping.
 *
 * Conforms to Acceptance Criteria for Issue #156 (ERP3-20):
 * - AC1: Form validates required fields, email format, phone numbers, and decimal ranges before submission.
 * - AC2: Client submission button disables during inflight request to prevent double-submit.
 * - AC3: Server validation errors (400) map directly to corresponding input fields with error text.
 * - AC4: Successful submission closes modal, updates table cache, and shows confirmation toast.
 *
 * @module erp3/web/hooks/useOrderForm
 */

import { useState, useCallback, useMemo } from 'react';
import type { CreateSalesOrderInput, SalesOrder } from '@clearshift/contracts';
import { calculateLineAmounts, CustomerGoldenIdSchema, OrdersUuid } from '@clearshift/contracts';
import { ApiError } from '../api/erp-3.js';

export interface OrderFormLineItem {
  id: string;
  productId: string;
  productName?: string;
  quantity: string;
  price: string;
  taxRate: string;
}

export interface OrderFormValues {
  customerGoldenId: string;
  orderDate: string;
  currency: string;
  customerEmail: string;
  customerPhone: string;
  notes: string;
  lines: OrderFormLineItem[];
}

export interface OrderLineErrors {
  productId?: string | undefined;
  quantity?: string | undefined;
  price?: string | undefined;
  taxRate?: string | undefined;
}

export interface OrderFormErrors {
  customerGoldenId?: string | undefined;
  customer_golden_id?: string | undefined;
  orderDate?: string | undefined;
  order_date?: string | undefined;
  currency?: string | undefined;
  customerEmail?: string | undefined;
  customer_email?: string | undefined;
  customerPhone?: string | undefined;
  customer_phone?: string | undefined;
  linesGeneral?: string | undefined;
  lines?: {
    [lineIndex: number]: OrderLineErrors;
  } | undefined;
  general?: string | undefined;
  [key: string]: any;
}

export const DEFAULT_ORDER_LINE: OrderFormLineItem = {
  id: 'line-0',
  productId: '',
  quantity: '1',
  price: '100.0000',
  taxRate: '10.0000',
};

export const DEFAULT_ORDER_FORM_VALUES: OrderFormValues = {
  customerGoldenId: '',
  orderDate: new Date().toISOString().split('T')[0] || '2026-10-24',
  currency: 'USD',
  customerEmail: '',
  customerPhone: '',
  notes: '',
  lines: [{ ...DEFAULT_ORDER_LINE }],
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9\s\-()]{7,20}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DECIMAL_4_PATTERN = /^\d+(\.\d{1,4})?$/;

/**
 * Normalizes snake_case, camelCase, or path identifiers into form keys.
 */
const FIELD_NAME_MAP: Record<string, keyof OrderFormValues> = {
  customerGoldenId: 'customerGoldenId',
  customer_golden_id: 'customerGoldenId',
  orderDate: 'orderDate',
  order_date: 'orderDate',
  currency: 'currency',
  customerEmail: 'customerEmail',
  customer_email: 'customerEmail',
  email: 'customerEmail',
  notificationEmail: 'customerEmail',
  notification_email: 'customerEmail',
  customerPhone: 'customerPhone',
  customer_phone: 'customerPhone',
  phone: 'customerPhone',
  contactPhone: 'customerPhone',
  contact_phone: 'customerPhone',
  notes: 'notes',
};

/**
 * Synchronous client-side validation conforming to Acceptance Criterion 1:
 * Validates required fields, email format, phone numbers, and decimal ranges before submission.
 */
export function validateOrderForm(values: OrderFormValues): OrderFormErrors {
  const errors: OrderFormErrors = {};

  // 1. Required: Customer Golden ID (ADR-003 UUID v4)
  if (!values.customerGoldenId || !values.customerGoldenId.trim()) {
    errors.customerGoldenId = 'Customer Golden ID is required';
  } else {
    const gidResult = CustomerGoldenIdSchema.safeParse(values.customerGoldenId.trim());
    if (!gidResult.success) {
      errors.customerGoldenId = 'Customer Golden ID is required and must be a valid UUID (ADR-003)';
    }
  }

  // 2. Required: Order Date (YYYY-MM-DD format)
  if (!values.orderDate || !values.orderDate.trim()) {
    errors.orderDate = 'Order date is required';
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.orderDate.trim())) {
    errors.orderDate = 'Order date is required and must be in YYYY-MM-DD format';
  }

  // 3. Required: Currency (3-letter uppercase ISO code)
  if (!values.currency || !values.currency.trim()) {
    errors.currency = 'Currency is required';
  } else if (!CURRENCY_PATTERN.test(values.currency.trim().toUpperCase())) {
    errors.currency = 'Currency must be an uppercase 3-letter ISO 4217 code (e.g. USD, EUR)';
  }

  // 4. Email Format: Customer / Notification Email (optional, but must be valid if provided)
  if (values.customerEmail && values.customerEmail.trim()) {
    const trimmedEmail = values.customerEmail.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      errors.customerEmail = 'Invalid email address format (e.g. customer@example.com)';
    }
  }

  // 5. Phone Numbers: Contact Phone (optional, but must be valid if provided)
  if (values.customerPhone && values.customerPhone.trim()) {
    const trimmedPhone = values.customerPhone.trim();
    if (!PHONE_PATTERN.test(trimmedPhone)) {
      errors.customerPhone = 'Invalid phone number format (min 7 digits, e.g. +1-555-019-2834)';
    }
  }

  // 6. Lines Validation (must have at least one line item)
  if (!values.lines || values.lines.length === 0) {
    errors.linesGeneral = 'At least one line item is required';
  } else {
    const lineErrors: { [key: number]: OrderLineErrors } = {};
    values.lines.forEach((l, idx) => {
      const itemErr: OrderLineErrors = {};

      // Required: Product ID (UUID format)
      if (!l.productId || !l.productId.trim()) {
        itemErr.productId = 'Product ID is required';
      } else if (!OrdersUuid.safeParse(l.productId.trim()).success) {
        itemErr.productId = 'Product ID is required and must be a valid UUID';
      }

      // Decimal Range: Quantity (must be positive > 0, up to 4 decimal places)
      if (!l.quantity || !l.quantity.trim()) {
        itemErr.quantity = 'Quantity is required';
      } else {
        const qtyNum = Number(l.quantity.trim());
        if (isNaN(qtyNum)) {
          itemErr.quantity = 'Quantity must be a valid decimal number';
        } else if (qtyNum <= 0) {
          itemErr.quantity = 'Quantity must be greater than zero';
        } else if (!DECIMAL_4_PATTERN.test(l.quantity.trim())) {
          itemErr.quantity = 'Quantity must have at most 4 decimal places';
        }
      }

      // Decimal Range: Price (must be non-negative >= 0, up to 4 decimal places)
      if (l.price === undefined || l.price === null || !l.price.trim()) {
        itemErr.price = 'Price is required';
      } else {
        const priceNum = Number(l.price.trim());
        if (isNaN(priceNum)) {
          itemErr.price = 'Price must be a valid non-negative decimal';
        } else if (priceNum < 0) {
          itemErr.price = 'Price must be greater than or equal to 0';
        } else if (!DECIMAL_4_PATTERN.test(l.price.trim())) {
          itemErr.price = 'Price must be a valid non-negative decimal with up to 4 decimal places';
        }
      }

      // Decimal Range: Tax Rate (must be between 0.00% and 100.00%)
      if (l.taxRate && l.taxRate.trim()) {
        const taxNum = Number(l.taxRate.trim());
        if (isNaN(taxNum)) {
          itemErr.taxRate = 'Tax rate must be a valid decimal percentage';
        } else if (taxNum < 0 || taxNum > 100) {
          itemErr.taxRate = 'Tax rate must be between 0.00% and 100.00%';
        } else if (!DECIMAL_4_PATTERN.test(l.taxRate.trim())) {
          itemErr.taxRate = 'Tax rate must have at most 4 decimal places';
        }
      }

      if (Object.keys(itemErr).length > 0) {
        lineErrors[idx] = itemErr;
      }
    });

    if (Object.keys(lineErrors).length > 0) {
      errors.lines = lineErrors;
    }
  }

  return errors;
}

export interface UseOrderFormOptions {
  initialValues?: Partial<OrderFormValues> | undefined;
  onSubmit: (input: CreateSalesOrderInput) => Promise<SalesOrder>;
  onSuccess?: ((order: SalesOrder) => void) | undefined;
}

export interface SubmitErrorInfo {
  status: number;
  code: string;
  message: string;
  correlationId?: string | undefined;
}

export interface UseOrderFormResult {
  values: OrderFormValues;
  errors: OrderFormErrors;
  isSubmitting: boolean;
  isValid: boolean;
  isDirty: boolean;
  submitError: SubmitErrorInfo | null;
  lineCalculations: Array<{ subtotal: string; tax_amount: string; line_total: string }>;
  orderTotals: { subtotal: string; taxTotal: string; total: string };
  handleChange: (field: keyof OrderFormValues, value: string) => void;
  handleLineChange: (index: number, field: keyof OrderFormLineItem, value: string) => void;
  handleAddLine: () => void;
  handleRemoveLine: (index: number) => void;
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  reset: () => void;
  clearError: (field: string) => void;
  clearSubmitError: () => void;
  setFieldError: (field: string, message: string) => void;
}

export function useOrderForm(options: UseOrderFormOptions): UseOrderFormResult {
  const { initialValues, onSubmit, onSuccess } = options;

  const resolvedInitialValues = useMemo<OrderFormValues>(
    () => ({
      ...DEFAULT_ORDER_FORM_VALUES,
      ...initialValues,
      lines:
        initialValues?.lines && initialValues.lines.length > 0
          ? initialValues.lines.map((l, idx) => ({
              id: l.id || `line-${idx}`,
              productId: l.productId || '',
              quantity: l.quantity || '1',
              price: l.price || '0.0000',
              taxRate: l.taxRate || '10.0000',
            }))
          : [{ ...DEFAULT_ORDER_LINE }],
    }),
    [initialValues]
  );

  const [values, setValues] = useState<OrderFormValues>(resolvedInitialValues);
  const [errors, setErrors] = useState<OrderFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitErrorInfo | null>(null);

  // Compute live line amounts and order totals via canonical contracts helper
  const lineCalculations = useMemo(() => {
    return values.lines.map((line) => {
      const qty = Number(line.quantity) > 0 ? line.quantity : '0';
      const price = !isNaN(Number(line.price)) && Number(line.price) >= 0 ? line.price : '0';
      const rate = !isNaN(Number(line.taxRate)) && Number(line.taxRate) >= 0 ? line.taxRate : '0';
      return calculateLineAmounts(qty, price, rate);
    });
  }, [values.lines]);

  const orderTotals = useMemo(() => {
    let subtotalNum = 0;
    let taxNum = 0;
    let totalNum = 0;

    for (const calc of lineCalculations) {
      subtotalNum += parseFloat(calc.subtotal || '0');
      taxNum += parseFloat(calc.tax_amount || '0');
      totalNum += parseFloat(calc.line_total || '0');
    }

    return {
      subtotal: subtotalNum.toFixed(2),
      taxTotal: taxNum.toFixed(2),
      total: totalNum.toFixed(2),
    };
  }, [lineCalculations]);

  const isDirty = useMemo(() => {
    return (
      values.customerGoldenId !== resolvedInitialValues.customerGoldenId ||
      values.orderDate !== resolvedInitialValues.orderDate ||
      values.currency !== resolvedInitialValues.currency ||
      values.customerEmail !== resolvedInitialValues.customerEmail ||
      values.customerPhone !== resolvedInitialValues.customerPhone ||
      values.notes !== resolvedInitialValues.notes ||
      values.lines.length !== resolvedInitialValues.lines.length
    );
  }, [values, resolvedInitialValues]);

  const isValid = useMemo(() => {
    const errs = validateOrderForm(values);
    return Object.keys(errs).length === 0;
  }, [values]);

  const handleChange = useCallback((field: keyof OrderFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (prev[field] || prev[field === 'customerGoldenId' ? 'customer_golden_id' : field]) {
        const next = { ...prev };
        delete next[field];
        if (field === 'customerGoldenId') delete next.customer_golden_id;
        if (field === 'orderDate') delete next.order_date;
        if (field === 'customerEmail') delete next.customer_email;
        if (field === 'customerPhone') delete next.customer_phone;
        return next;
      }
      return prev;
    });
    setSubmitError(null);
  }, []);

  const handleLineChange = useCallback(
    (index: number, field: keyof OrderFormLineItem, value: string) => {
      setValues((prev) => {
        const lines = [...prev.lines];
        lines[index] = { ...lines[index]!, [field]: value };
        return { ...prev, lines };
      });

      setErrors((prev) => {
        if (!prev.lines || !prev.lines[index]) return prev;
        const lineErr = { ...prev.lines[index] };
        delete lineErr[field as keyof OrderLineErrors];
        const nextLines = { ...prev.lines, [index]: lineErr };
        if (Object.keys(lineErr).length === 0) {
          delete nextLines[index];
        }
        return { ...prev, lines: Object.keys(nextLines).length > 0 ? nextLines : undefined };
      });
      setSubmitError(null);
    },
    []
  );

  const handleAddLine = useCallback(() => {
    setValues((prev) => ({
      ...prev,
      lines: [
        ...prev.lines,
        {
          id: `line-${Date.now()}-${prev.lines.length}`,
          productId: '',
          quantity: '1',
          price: '0.0000',
          taxRate: '10.0000',
        },
      ],
    }));
    setErrors((prev) => {
      if (prev.linesGeneral) {
        const next = { ...prev };
        delete next.linesGeneral;
        return next;
      }
      return prev;
    });
  }, []);

  const handleRemoveLine = useCallback((index: number) => {
    setValues((prev) => {
      if (prev.lines.length <= 1) return prev;
      return {
        ...prev,
        lines: prev.lines.filter((_, i) => i !== index),
      };
    });

    setErrors((prev) => {
      if (!prev.lines) return prev;
      const updatedLines = { ...prev.lines };
      delete updatedLines[index];
      return { ...prev, lines: Object.keys(updatedLines).length > 0 ? updatedLines : undefined };
    });
  }, []);

  const clearError = useCallback((field: string) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const setFieldError = useCallback((field: string, message: string) => {
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
      const validationErrors = validateOrderForm(values);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        setSubmitError(null);
        return;
      }

      setErrors({});
      setSubmitError(null);
      setIsSubmitting(true);

      try {
        const payload: CreateSalesOrderInput = {
          customer_golden_id: values.customerGoldenId.trim(),
          order_date: values.orderDate.trim(),
          currency: values.currency.trim().toUpperCase(),
          lines: values.lines.map((l) => ({
            product_id: l.productId.trim(),
            quantity: Number(l.quantity).toFixed(4),
            price: Number(l.price).toFixed(4),
            tax_rate: Number(l.taxRate || '0').toFixed(4),
          })),
        };

        const created = await onSubmit(payload);
        setIsSubmitting(false);
        if (onSuccess) {
          onSuccess(created);
        }
      } catch (err: any) {
        setIsSubmitting(false);

        let errorStatus = 500;
        let errorCode = 'UNKNOWN_ERROR';
        let errorMessage = 'Failed to create sales order';
        let correlationId: string | undefined = undefined;
        let details: any = null;

        if (err instanceof ApiError) {
          errorStatus = err.status;
          errorCode = err.code;
          errorMessage = err.message;
          details = err.details;
        } else if (err && typeof err === 'object') {
          errorStatus = err.status || 500;
          errorCode = err.code || 'UNKNOWN_ERROR';
          errorMessage = err.message || 'Failed to create sales order';
          details = err.details;
        }

        if (details && typeof details === 'object' && 'correlationId' in details) {
          correlationId = details.correlationId;
        }

        // AC 3: Server validation errors (400) map directly to corresponding input fields with error text
        if (errorStatus === 400 && details) {
          const detailList = Array.isArray(details)
            ? details
            : Array.isArray(details.errors)
            ? details.errors
            : [];

          const fieldErrors: OrderFormErrors = {};
          const mappedLineErrors: { [key: number]: OrderLineErrors } = {};

          for (const item of detailList) {
            const rawField = item.field || (Array.isArray(item.path) ? item.path.join('.') : item.path);
            const msg = item.message || errorMessage;

            if (rawField) {
              // Check if field is a line item path, e.g. "lines.0.quantity" or "lines[0].price"
              const lineMatch = rawField.match(/^lines[\[\.](\d+)[\]\.]?(.*)$/);
              if (lineMatch) {
                const lineIndex = parseInt(lineMatch[1]!, 10);
                const lineProp = lineMatch[2]!.replace(/^\./, '');
                if (!mappedLineErrors[lineIndex]) {
                  mappedLineErrors[lineIndex] = {};
                }
                if (lineProp === 'product_id' || lineProp === 'productId') {
                  mappedLineErrors[lineIndex]!.productId = msg;
                } else if (lineProp === 'quantity') {
                  mappedLineErrors[lineIndex]!.quantity = msg;
                } else if (lineProp === 'price') {
                  mappedLineErrors[lineIndex]!.price = msg;
                } else if (lineProp === 'tax_rate' || lineProp === 'taxRate') {
                  mappedLineErrors[lineIndex]!.taxRate = msg;
                } else {
                  mappedLineErrors[lineIndex]!.quantity = msg;
                }
              } else {
                const mappedName = FIELD_NAME_MAP[rawField] || rawField;
                fieldErrors[mappedName] = msg;
                // Also set snake_case alias for template mapping
                fieldErrors[rawField] = msg;
              }
            }
          }

          if (Object.keys(mappedLineErrors).length > 0) {
            fieldErrors.lines = mappedLineErrors;
          }

          setErrors((prev) => ({
            ...prev,
            ...fieldErrors,
          }));
        } else if (errorStatus === 409) {
          setErrors((prev) => ({
            ...prev,
            general: errorMessage || 'A sales order with this order number or reference already exists',
          }));
        }

        setSubmitError({
          status: errorStatus,
          code: errorCode,
          message: errorMessage,
          correlationId,
        });
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
    lineCalculations,
    orderTotals,
    handleChange,
    handleLineChange,
    handleAddLine,
    handleRemoveLine,
    handleSubmit,
    reset,
    clearError,
    clearSubmitError,
    setFieldError,
  };
}
