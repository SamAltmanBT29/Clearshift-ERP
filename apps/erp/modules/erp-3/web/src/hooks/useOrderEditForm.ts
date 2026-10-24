/**
 * ERP-3 Sales Orders & Invoices — Sales Order Edit Form Hook
 *
 * Manages sales order inline & drawer edit state, client validation for allowlisted
 * attributes, permission checking, double-submission prevention, and HTTP 409
 * concurrent modification conflict handling.
 *
 * Conforms to Acceptance Criteria for Issue #157 (ERP3-21):
 * - AC2: Inline edit or drawer form allows updating allowlisted fields with permission checking.
 * - AC4: Concurrent modification conflicts (409) prompt user to refresh and re-apply changes.
 *
 * @module erp3/web/hooks/useOrderEditForm
 */

import { useState, useCallback, useEffect } from 'react';
import type { SalesOrder } from '@clearshift/contracts';
import { updateSalesOrder, type UpdateSalesOrderInput, type UpdateOrderOptions, ApiError } from '../api/erp-3.js';

export interface OrderEditFormValues {
  orderDate: string;
  currency: string;
  customerEmail: string;
  customerPhone: string;
  notes: string;
}

export type OrderEditFormErrors = Partial<Record<keyof OrderEditFormValues, string>>;

export interface UseOrderEditFormOptions {
  order: SalesOrder;
  canEdit?: boolean;
  onSubmit?: (
    id: string,
    input: UpdateSalesOrderInput,
    options?: UpdateOrderOptions
  ) => Promise<SalesOrder>;
  onSuccess?: (updated: SalesOrder) => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9\s\-()]{7,20}$/;

export function useOrderEditForm(options: UseOrderEditFormOptions) {
  const { order, canEdit = true, onSubmit = updateSalesOrder, onSuccess } = options;

  const [values, setValues] = useState<OrderEditFormValues>({
    orderDate: order.order_date || '',
    currency: order.currency || 'USD',
    customerEmail: '',
    customerPhone: '',
    notes: '',
  });

  const [errors, setErrors] = useState<OrderEditFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConflict, setIsConflict] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Sync values when order prop updates
  useEffect(() => {
    setValues({
      orderDate: order.order_date || '',
      currency: order.currency || 'USD',
      customerEmail: '',
      customerPhone: '',
      notes: '',
    });
    setErrors({});
    setIsConflict(false);
    setConflictMessage(null);
    setServerError(null);
  }, [order]);

  const handleChange = useCallback((field: keyof OrderEditFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (prev[field]) {
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return prev;
    });
    setIsConflict(false);
    setServerError(null);
  }, []);

  const validate = useCallback((): boolean => {
    const errs: OrderEditFormErrors = {};

    if (!values.orderDate || !/^\d{4}-\d{2}-\d{2}$/.test(values.orderDate)) {
      errs.orderDate = 'Order date is required and must be in YYYY-MM-DD format';
    }

    if (!values.currency || !/^[A-Z]{3}$/.test(values.currency)) {
      errs.currency = 'Currency must be an uppercase 3-letter ISO code';
    }

    if (values.customerEmail && values.customerEmail.trim() && !EMAIL_PATTERN.test(values.customerEmail.trim())) {
      errs.customerEmail = 'Invalid email address format (e.g. customer@example.com)';
    }

    if (values.customerPhone && values.customerPhone.trim() && !PHONE_PATTERN.test(values.customerPhone.trim())) {
      errs.customerPhone = 'Invalid phone number format (min 7 digits)';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [values]);

  const resetForm = useCallback(() => {
    setValues({
      orderDate: order.order_date || '',
      currency: order.currency || 'USD',
      customerEmail: '',
      customerPhone: '',
      notes: '',
    });
    setErrors({});
    setIsSubmitting(false);
    setIsConflict(false);
    setConflictMessage(null);
    setServerError(null);
  }, [order]);

  const clearConflict = useCallback(() => {
    setIsConflict(false);
    setConflictMessage(null);
  }, []);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e && e.preventDefault) {
        e.preventDefault();
      }

      if (!canEdit || order.status !== 'Open') {
        return;
      }

      if (isSubmitting) {
        return;
      }

      if (!validate()) {
        return;
      }

      setIsSubmitting(true);
      setServerError(null);
      setIsConflict(false);

      try {
        const payload: UpdateSalesOrderInput = {
          order_date: values.orderDate,
          currency: values.currency,
          notes: values.notes.trim() || undefined,
          customer_email: values.customerEmail.trim() || undefined,
          customer_phone: values.customerPhone.trim() || undefined,
        };

        const updated = await onSubmit(order.id, payload, {
          version: order.updated_at,
        });

        setIsSubmitting(false);
        if (onSuccess) {
          onSuccess(updated);
        }
      } catch (err: any) {
        setIsSubmitting(false);

        if (err instanceof ApiError && err.status === 409) {
          setIsConflict(true);
          setConflictMessage(
            err.message || 'Concurrent modification conflict: record was modified by another operator.'
          );
        } else if (err?.status === 409) {
          setIsConflict(true);
          setConflictMessage(
            err.message || 'Concurrent modification conflict: record was modified by another operator.'
          );
        } else {
          setServerError(err?.message || 'Failed to update sales order.');
        }
      }
    },
    [canEdit, isSubmitting, order, validate, values, onSubmit, onSuccess]
  );

  return {
    values,
    errors,
    isSubmitting,
    isConflict,
    conflictMessage,
    serverError,
    handleChange,
    handleSubmit,
    resetForm,
    clearConflict,
  };
}
