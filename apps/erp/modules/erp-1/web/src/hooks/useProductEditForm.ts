/**
 * ERP-1 Products & Inventory — Product Edit Form Hook
 *
 * Manages form state, client-side validation, server error mapping,
 * double-submission prevention, and concurrent modification conflicts (409)
 * for updating allowlisted product attributes.
 *
 * @module erp1/web/hooks/useProductEditForm
 */

import { useState, useCallback, useEffect } from 'react';
import type {
  Product,
  UnitOfMeasure,
  UpdateProductInput,
} from '@clearshift/contracts';
import { updateProduct, Erp1ApiError } from '../api/erp-1.js';

export interface ProductEditFormValues {
  name: string;
  categoryId: string;
  unitOfMeasure: UnitOfMeasure;
  price: string;
  currency: string;
  taxRate: string;
  notificationEmail: string;
  contactPhone: string;
}

export interface ProductEditFormErrors {
  name?: string;
  categoryId?: string;
  unitOfMeasure?: string;
  price?: string;
  currency?: string;
  taxRate?: string;
  notificationEmail?: string;
  contactPhone?: string;
  general?: string;
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_REGEX = /^\+?[0-9\s\-()]{7,20}$/;
export const ISO_CURRENCY_REGEX = /^[A-Z]{3}$/;

export function validateProductEditForm(values: ProductEditFormValues): ProductEditFormErrors {
  const errors: ProductEditFormErrors = {};

  // 1. Name is required
  if (!values.name || values.name.trim() === '') {
    errors.name = 'Product name is required';
  }

  // 2. Unit of Measure
  const validUnits: UnitOfMeasure[] = ['pcs', 'kg', 'g', 'litre', 'metre', 'box'];
  if (!validUnits.includes(values.unitOfMeasure)) {
    errors.unitOfMeasure = 'Please select a valid unit of measure';
  }

  // 3. Price must be a valid non-negative decimal
  if (!values.price || values.price.trim() === '') {
    errors.price = 'Price is required';
  } else {
    const numPrice = Number(values.price);
    if (isNaN(numPrice) || numPrice < 0) {
      errors.price = 'Price must be greater than or equal to 0';
    }
  }

  // 4. Currency must be uppercase ISO 4217 3-letter code
  if (!values.currency || !ISO_CURRENCY_REGEX.test(values.currency.trim())) {
    errors.currency = 'Currency must be an uppercase 3-letter ISO 4217 code (e.g. USD, EUR)';
  }

  // 5. Tax rate must be valid decimal percentage between 0 and 100
  if (values.taxRate && values.taxRate.trim() !== '') {
    const numTax = Number(values.taxRate);
    if (isNaN(numTax) || numTax < 0 || numTax > 100) {
      errors.taxRate = 'Tax rate must be between 0.00% and 100.00%';
    }
  }

  // 6. Notification email format
  if (values.notificationEmail && values.notificationEmail.trim() !== '') {
    if (!EMAIL_REGEX.test(values.notificationEmail.trim())) {
      errors.notificationEmail = 'Invalid email address format (e.g. alerts@example.com)';
    }
  }

  // 7. Contact phone format
  if (values.contactPhone && values.contactPhone.trim() !== '') {
    if (!PHONE_REGEX.test(values.contactPhone.trim())) {
      errors.contactPhone = 'Invalid phone number format (min 7 digits, e.g. +1-555-019-2834)';
    }
  }

  return errors;
}

export function productToFormValues(product: Product): ProductEditFormValues {
  return {
    name: product.name,
    categoryId: product.categoryId || '',
    unitOfMeasure: product.unitOfMeasure,
    price: product.price,
    currency: product.currency,
    taxRate: product.taxRate || '0.00',
    notificationEmail: product.notificationEmail || '',
    contactPhone: product.contactPhone || '',
  };
}

export interface UseProductEditFormOptions {
  product: Product;
  onSuccess?: (updated: Product) => void;
  canEdit?: boolean;
}

export interface UseProductEditFormReturn {
  values: ProductEditFormValues;
  errors: ProductEditFormErrors;
  isSubmitting: boolean;
  isConflict: boolean;
  conflictMessage: string | null;
  serverError: string | null;
  handleChange: (field: keyof ProductEditFormValues, value: string) => void;
  handleSubmit: (e?: React.FormEvent) => Promise<boolean>;
  resetForm: () => void;
  clearConflict: () => void;
}

export function useProductEditForm({
  product,
  onSuccess,
  canEdit = true,
}: UseProductEditFormOptions): UseProductEditFormReturn {
  const [values, setValues] = useState<ProductEditFormValues>(() => productToFormValues(product));
  const [errors, setErrors] = useState<ProductEditFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConflict, setIsConflict] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Synchronize when product changes
  useEffect(() => {
    setValues(productToFormValues(product));
    setErrors({});
    setIsConflict(false);
    setConflictMessage(null);
    setServerError(null);
  }, [product]);

  const handleChange = useCallback((field: keyof ProductEditFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      delete next.general;
      return next;
    });
    setServerError(null);
  }, []);

  const resetForm = useCallback(() => {
    setValues(productToFormValues(product));
    setErrors({});
    setIsConflict(false);
    setConflictMessage(null);
    setServerError(null);
  }, [product]);

  const clearConflict = useCallback(() => {
    setIsConflict(false);
    setConflictMessage(null);
  }, []);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent): Promise<boolean> => {
      if (e) {
        e.preventDefault();
      }

      if (!canEdit) {
        setServerError('Permission Denied: You do not have permission to edit products (requires inventory:write).');
        return false;
      }

      if (isSubmitting) {
        return false;
      }

      // Client validation
      const validationErrors = validateProductEditForm(values);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        return false;
      }

      setIsSubmitting(true);
      setErrors({});
      setServerError(null);
      setIsConflict(false);
      setConflictMessage(null);

      const payload: UpdateProductInput = {
        name: values.name.trim(),
        unitOfMeasure: values.unitOfMeasure,
        price: values.price.trim(),
        currency: values.currency.trim().toUpperCase(),
        ...(values.categoryId.trim() ? { categoryId: values.categoryId.trim() } : { categoryId: null }),
        ...(values.taxRate.trim() ? { taxRate: values.taxRate.trim() } : {}),
        ...(values.notificationEmail.trim() ? { notificationEmail: values.notificationEmail.trim() } : {}),
        ...(values.contactPhone.trim() ? { contactPhone: values.contactPhone.trim() } : {}),
        version: product.updatedAt,
      };

      try {
        const updated = await updateProduct(product.id, payload, { version: product.updatedAt });
        setIsSubmitting(false);
        if (onSuccess) {
          onSuccess(updated);
        }
        return true;
      } catch (err: any) {
        setIsSubmitting(false);

        if (err instanceof Erp1ApiError) {
          if (err.isConflict) {
            setIsConflict(true);
            setConflictMessage(
              err.message ||
                'Concurrent modification conflict: This product was updated by another operator or background job. Please refresh and re-apply your changes.'
            );
            return false;
          }

          if (err.isPermissionDenied) {
            setServerError('Permission Denied: You lack required permissions to update this product.');
            return false;
          }

          if (err.details && err.details.length > 0) {
            const mappedErrors: ProductEditFormErrors = {};
            for (const detail of err.details) {
              if (detail.field) {
                const camelField = detail.field.replace(/_([a-z])/g, (_, letter) =>
                  letter.toUpperCase()
                ) as keyof ProductEditFormErrors;
                mappedErrors[camelField] = detail.message;
              }
            }
            if (Object.keys(mappedErrors).length > 0) {
              setErrors(mappedErrors);
            }
          }

          setServerError(err.message || 'Server rejected the update request.');
          return false;
        }

        setServerError(err?.message || 'Failed to communicate with ERP-1 server');
        return false;
      }
    },
    [canEdit, isSubmitting, values, product, onSuccess]
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
