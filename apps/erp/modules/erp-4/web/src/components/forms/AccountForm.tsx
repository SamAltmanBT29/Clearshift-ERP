/**
 * ERP-4 Finance and Accounting — Account Creation / Edit Form
 *
 * Implements:
 * - Real-time client-side field validation (required fields, email format, phone numbers, decimal ranges)
 * - Integration with Zod / CreateAccountRequestSchema
 * - Double-submission prevention with inflight disabled states
 * - Direct mapping of server validation errors (HTTP 400) to field error text
 *
 * Conforms to Acceptance Criteria for Issue #176 (ERP4-20):
 * - AC1: Form validates required fields, email format, phone numbers, and decimal ranges before submission.
 * - AC2: Client submission button disables during inflight request to prevent double-submit.
 * - AC3: Server validation errors (400) map directly to corresponding input fields with error text.
 * - AC4: Successful submission closes modal, updates table cache, and shows confirmation toast.
 *
 * @module erp4/web/components/forms/AccountForm
 */

import React, { useState } from 'react';
import type { Account, AccountType } from '@clearshift/contracts';
import { CreateAccountRequestSchema } from '@clearshift/contracts';
import { FormField } from '@cs/ui';

export interface AccountFormData {
  code: string;
  name: string;
  type: AccountType;
  currency_code: string;
  is_posting_account: boolean;
  description?: string | null | undefined;
  parent_id?: string | null | undefined;
  opening_balance?: string | null | undefined;
  contact_email?: string | null | undefined;
  contact_phone?: string | null | undefined;
}

export type AccountFormField =
  | 'code'
  | 'name'
  | 'type'
  | 'currency_code'
  | 'opening_balance'
  | 'contact_email'
  | 'contact_phone'
  | 'description'
  | 'parent_id'
  | 'is_posting_account';

export type AccountFormErrors = Partial<Record<AccountFormField, string>>;

export interface AccountFormProps {
  initialData?: Partial<Account> | undefined;
  isEdit?: boolean | undefined;
  onSubmit: (data: AccountFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean | undefined;
}

function extractErrorMessage(err: unknown): string {
  if (!err) return 'An unexpected error occurred.';
  if (typeof err === 'string') return err;
  const errObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
  if (typeof errObj['message'] === 'string') return errObj['message'];
  return 'Failed to save account. Please check inputs and try again.';
}

export const AccountForm: React.FC<AccountFormProps> = ({
  initialData,
  isEdit = false,
  onSubmit,
  onCancel,
  isLoading = false,
}) => {
  const [formData, setFormData] = useState<AccountFormData>({
    code: initialData?.code || '',
    name: initialData?.name || '',
    type: (initialData?.type as AccountType) || 'asset',
    currency_code: initialData?.currency_code || 'USD',
    is_posting_account: initialData?.is_posting_account ?? true,
    description: initialData?.description || '',
    parent_id: initialData?.parent_id || '',
    opening_balance: '',
    contact_email: '',
    contact_phone: '',
  });

  const [fieldErrors, setFieldErrors] = useState<AccountFormErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Field-level validation rule engine conforming to AC1
   */
  const validateField = (field: AccountFormField, value: unknown): string | null => {
    const strVal = typeof value === 'string' ? value.trim() : '';

    switch (field) {
      case 'code':
        if (!strVal) return 'Account code is required';
        if (!/^[A-Za-z0-9_-]+$/.test(strVal)) {
          return 'Code must be alphanumeric with hyphens or underscores (e.g. 1010-OP)';
        }
        if (strVal.length > 32) return 'Code cannot exceed 32 characters';
        return null;

      case 'name':
        if (!strVal) return 'Account name is required';
        if (strVal.length < 2) return 'Account name must be at least 2 characters';
        if (strVal.length > 255) return 'Account name cannot exceed 255 characters';
        return null;

      case 'type':
        if (!value) return 'Account type is required';
        if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(String(value).toLowerCase())) {
          return 'Valid account type is required (Asset, Liability, Equity, Income, Expense)';
        }
        return null;

      case 'currency_code':
        if (!strVal) return 'Currency code is required';
        if (!/^[A-Za-z]{3}$/.test(strVal)) {
          return 'Currency must be a 3-letter ISO code (e.g. USD, EUR, INR)';
        }
        return null;

      case 'contact_email':
        if (strVal && strVal.length > 0) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(strVal)) {
            return 'Please enter a valid email address (e.g. finance@example.com)';
          }
        }
        return null;

      case 'contact_phone':
        if (strVal && strVal.length > 0) {
          const phoneRegex = /^\+?[0-9\s\-()]{7,25}$/;
          if (!phoneRegex.test(strVal)) {
            return 'Phone number must be a valid format (min 7 digits, e.g. +1-555-0199)';
          }
        }
        return null;

      case 'opening_balance':
        if (strVal && strVal.length > 0) {
          const num = Number(strVal);
          if (isNaN(num)) {
            return 'Opening balance must be a valid decimal number';
          }
          if (num < 0) {
            return 'Opening balance must be a non-negative decimal amount (>= 0.00)';
          }
          if (num > 999999999.99) {
            return 'Opening balance cannot exceed 999,999,999.99';
          }
          if (!/^\d+(\.\d{1,4})?$/.test(strVal)) {
            return 'Decimal precision must not exceed 4 fractional digits';
          }
        }
        return null;

      case 'description':
        if (strVal && strVal.length > 2000) {
          return 'Description cannot exceed 2000 characters';
        }
        return null;

      default:
        return null;
    }
  };

  const handleFieldChange = (field: AccountFormField, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));

    // Real-time field error clearing / updating
    const err = validateField(field, value);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) {
        next[field] = err;
      } else {
        delete next[field];
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);

    // 1. Comprehensive Client-Side Field-Level Validation (AC1)
    const errors: AccountFormErrors = {};
    const fieldsToValidate: AccountFormField[] = [
      'code',
      'name',
      'type',
      'currency_code',
      'opening_balance',
      'contact_email',
      'contact_phone',
      'description',
    ];

    fieldsToValidate.forEach((field) => {
      const err = validateField(field, formData[field]);
      if (err) {
        errors[field] = err;
      }
    });

    // 2. Schema SafeParse Validation
    const schemaPayload: Record<string, unknown> = {
      code: formData.code.trim(),
      name: formData.name.trim(),
      type: formData.type,
      currency_code: formData.currency_code.trim().toUpperCase(),
      description: formData.description?.trim() || null,
      parent_id: formData.parent_id?.trim() || null,
      is_posting_account: formData.is_posting_account,
    };

    const schemaResult = CreateAccountRequestSchema.safeParse(schemaPayload);
    if (!schemaResult.success) {
      schemaResult.error.issues.forEach((issue) => {
        const fieldName = String(issue.path[0]) as AccountFormField;
        if (!errors[fieldName]) {
          errors[fieldName] = issue.message;
        }
      });
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    // 3. Double-Submit Protection: Disable submit button during request (AC2)
    setIsSubmitting(true);

    try {
      await onSubmit({
        ...formData,
        code: formData.code.trim(),
        name: formData.name.trim(),
        currency_code: formData.currency_code.trim().toUpperCase(),
        description: formData.description?.trim() || null,
        parent_id: formData.parent_id?.trim() || null,
      });
    } catch (err: unknown) {
      // 4. Server Validation Errors (400) Mapping Directly to Fields (AC3)
      const errObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
      const status = typeof errObj['status'] === 'number' ? errObj['status'] : 0;
      const details = errObj['details'];

      setGeneralError(extractErrorMessage(err));

      if (status === 400 || errObj['code'] === 'VALIDATION_ERROR') {
        const mappedServerErrors: AccountFormErrors = {};

        if (Array.isArray(details)) {
          details.forEach((issue: unknown) => {
            const issueObj = typeof issue === 'object' && issue !== null ? (issue as Record<string, unknown>) : {};
            const pathArr = Array.isArray(issueObj['path']) ? issueObj['path'] : [];
            const field = String(pathArr[0] || issueObj['field'] || '') as AccountFormField;
            const message = String(issueObj['message'] || 'Invalid value');

            if (field && !mappedServerErrors[field]) {
              mappedServerErrors[field] = message;
            }
          });
        }

        if (Object.keys(mappedServerErrors).length > 0) {
          setFieldErrors((prev) => ({ ...prev, ...mappedServerErrors }));
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isButtonDisabled = isLoading || isSubmitting;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {generalError && (
        <div
          role="alert"
          className="p-3 rounded-md border border-[var(--cs-err,#dc2626)] bg-[var(--cs-err-bg,#fef2f2)] text-[var(--cs-err,#dc2626)] text-sm flex items-center gap-2 mb-4"
        >
          <span aria-hidden="true">⚠</span>
          <span>{generalError}</span>
        </div>
      )}

      {/* Account Code & Currency Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          id="account-code"
          label="Account Code"
          required
          {...(fieldErrors.code ? { error: fieldErrors.code } : {})}
          helperText="Unique identifier e.g. 1010, 2000-AP"
          disabled={isButtonDisabled || isEdit}
        >
          <input
            type="text"
            value={formData.code}
            onChange={(e) => handleFieldChange('code', e.target.value)}
            placeholder="e.g. 1010"
            autoComplete="off"
          />
        </FormField>

        <FormField
          id="account-currency"
          label="Currency Code"
          required
          {...(fieldErrors.currency_code ? { error: fieldErrors.currency_code } : {})}
          helperText="3-letter ISO code e.g. USD, EUR, INR"
          disabled={isButtonDisabled || isEdit}
        >
          <input
            type="text"
            value={formData.currency_code}
            onChange={(e) => handleFieldChange('currency_code', e.target.value.toUpperCase())}
            placeholder="USD"
            maxLength={3}
          />
        </FormField>
      </div>

      {/* Account Name */}
      <FormField
        id="account-name"
        label="Account Name"
        required
        {...(fieldErrors.name ? { error: fieldErrors.name } : {})}
        helperText="Descriptive title of the general ledger account"
        disabled={isButtonDisabled}
      >
        <input
          type="text"
          value={formData.name}
          onChange={(e) => handleFieldChange('name', e.target.value)}
          placeholder="e.g. Operating Checking Account"
        />
      </FormField>

      {/* Account Type */}
      <FormField
        id="account-type"
        label="Account Category / Type"
        required
        {...(fieldErrors.type ? { error: fieldErrors.type } : {})}
        helperText="Balance sheet or income statement classification"
        disabled={isButtonDisabled || isEdit}
      >
        <select
          value={formData.type}
          onChange={(e) => handleFieldChange('type', e.target.value as AccountType)}
        >
          <option value="asset">Asset (Normal Debit)</option>
          <option value="liability">Liability (Normal Credit)</option>
          <option value="equity">Equity (Normal Credit)</option>
          <option value="income">Income / Revenue (Normal Credit)</option>
          <option value="expense">Expense (Normal Debit)</option>
        </select>
      </FormField>

      {/* Decimal Range: Opening Balance (AC1) */}
      <FormField
        id="account-opening-balance"
        label="Opening Balance (Decimal Range: 0.00 to 999,999,999.99)"
        {...(fieldErrors.opening_balance ? { error: fieldErrors.opening_balance } : {})}
        helperText="Optional initial ledger balance in currency precision"
        disabled={isButtonDisabled || isEdit}
      >
        <input
          type="text"
          inputMode="decimal"
          value={formData.opening_balance || ''}
          onChange={(e) => handleFieldChange('opening_balance', e.target.value)}
          placeholder="0.00"
        />
      </FormField>

      {/* Email Format & Phone Numbers (AC1) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          id="account-contact-email"
          label="Contact Email"
          {...(fieldErrors.contact_email ? { error: fieldErrors.contact_email } : {})}
          helperText="Financial notifications & statements email"
          disabled={isButtonDisabled}
        >
          <input
            type="email"
            value={formData.contact_email || ''}
            onChange={(e) => handleFieldChange('contact_email', e.target.value)}
            placeholder="finance-team@company.com"
          />
        </FormField>

        <FormField
          id="account-contact-phone"
          label="Contact Phone"
          {...(fieldErrors.contact_phone ? { error: fieldErrors.contact_phone } : {})}
          helperText="Standard phone format e.g. +1-555-0199"
          disabled={isButtonDisabled}
        >
          <input
            type="tel"
            value={formData.contact_phone || ''}
            onChange={(e) => handleFieldChange('contact_phone', e.target.value)}
            placeholder="+1-555-0199"
          />
        </FormField>
      </div>

      {/* Description */}
      <FormField
        id="account-description"
        label="Description / Purpose"
        {...(fieldErrors.description ? { error: fieldErrors.description } : {})}
        helperText="Optional explanation for internal audit and reporting"
        disabled={isButtonDisabled}
      >
        <textarea
          rows={3}
          value={formData.description || ''}
          onChange={(e) => handleFieldChange('description', e.target.value)}
          placeholder="Primary operational cash account used for payroll and AP disbursements."
        />
      </FormField>

      {/* Form Action Buttons (AC2: Double-Submit Prevention) */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--cs-border,#e5e7eb)]">
        <button
          type="button"
          onClick={onCancel}
          disabled={isButtonDisabled}
          className="px-4 py-2 text-sm font-medium rounded border border-[var(--cs-border,#d1d5db)] bg-[var(--cs-bg,#ffffff)] text-[var(--cs-text,#374151)] hover:bg-[var(--cs-surface,#f3f4f6)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Cancel
        </button>

        <button
          type="submit"
          disabled={isButtonDisabled}
          className="px-4 py-2 text-sm font-medium rounded bg-[var(--cs-accent,#2563eb)] text-white hover:bg-[var(--cs-accent-hover,#1d4ed8)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          aria-busy={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <span className="inline-block animate-spin" aria-hidden="true">
                ⏳
              </span>
              <span>Saving Account...</span>
            </>
          ) : (
            <span>{isEdit ? 'Update Account' : 'Create Account'}</span>
          )}
        </button>
      </div>
    </form>
  );
};

export default AccountForm;
