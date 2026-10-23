import React, { useState } from 'react';
import type { Vendor } from '@clearshift/contracts';
import { CreateVendorRequestSchema, UpdateVendorRequestSchema } from '@clearshift/contracts';

export interface VendorFormData {
  name: string;
  tax_number: string;
  email: string;
  phone?: string | null;
  address_line?: string | null;
  city?: string | null;
  country?: string | null;
  currency?: string;
  bank_details?: string | null;
}

export type VendorFormField =
  | 'name'
  | 'tax_number'
  | 'email'
  | 'phone'
  | 'address_line'
  | 'city'
  | 'country'
  | 'currency'
  | 'bank_details';

export type VendorFormErrors = Partial<Record<VendorFormField, string>>;

export interface VendorFormProps {
  initialData?: Partial<Vendor>;
  isEdit?: boolean;
  onSubmit: (data: VendorFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export const VendorForm: React.FC<VendorFormProps> = ({
  initialData,
  isEdit = false,
  onSubmit,
  onCancel,
  isLoading = false,
}) => {
  const [formData, setFormData] = useState<VendorFormData>({
    name: initialData?.name || '',
    tax_number: initialData?.tax_number || '',
    email: initialData?.email || '',
    phone: initialData?.phone || '',
    address_line: initialData?.address_line || '',
    city: initialData?.city || '',
    country: initialData?.country || '',
    currency: initialData?.currency || 'USD',
    bank_details: '',
  });

  const [fieldErrors, setFieldErrors] = useState<VendorFormErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const validateField = (name: VendorFormField, value: any): string | null => {
    if (name === 'name' && (!value || value.trim() === '')) {
      return 'Vendor name is required';
    }
    if (name === 'tax_number' && (!value || value.trim() === '')) {
      return 'Tax number is required';
    }
    if (name === 'email') {
      if (!value || value.trim() === '') return 'Email is required';
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) return 'Valid email is required';
    }
    if (name === 'currency' && value && !/^[A-Z]{3}$/.test(value)) {
      return 'Currency must be a 3-letter ISO code (e.g. USD)';
    }
    if (name === 'bank_details' && value && value.trim().length > 0 && value.trim().length < 4) {
      return 'Bank details must be at least 4 characters';
    }
    return null;
  };

  const handleChange = (name: VendorFormField, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    const error = validateField(name, value);
    setFieldErrors((prev) => {
      const updated = { ...prev };
      if (error) {
        updated[name] = error;
      } else {
        delete updated[name];
      }
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);

    // Run schema validation
    const payload: Record<string, unknown> = {
      name: formData.name.trim(),
      tax_number: formData.tax_number.trim(),
      email: formData.email.trim(),
      phone: formData.phone?.trim() || null,
      address_line: formData.address_line?.trim() || null,
      city: formData.city?.trim() || null,
      country: formData.country?.trim() || null,
      currency: (formData.currency?.trim() || 'USD').toUpperCase(),
    };

    if (formData.bank_details && formData.bank_details.trim() !== '') {
      payload['bank_details'] = formData.bank_details.trim();
    } else if (!isEdit) {
      payload['bank_details'] = null;
    }

    const schema = isEdit ? UpdateVendorRequestSchema : CreateVendorRequestSchema;
    const result = schema.safeParse(payload);

    if (!result.success) {
      const errors: VendorFormErrors = {};
      result.error.issues.forEach((issue) => {
        const fieldName = String(issue.path[0]) as VendorFormField;
        if (!errors[fieldName]) {
          errors[fieldName] = issue.message;
        }
      });
      setFieldErrors(errors);
      return;
    }

    try {
      await onSubmit(payload as unknown as VendorFormData);
    } catch (err: any) {
      setGeneralError(err?.message || 'Failed to save vendor. Please check inputs and try again.');
      if (err?.details && Array.isArray(err.details)) {
        const serverErrors: VendorFormErrors = {};
        err.details.forEach((issue: any) => {
          const field = issue.path?.[0] as VendorFormField;
          if (field) {
            serverErrors[field] = issue.message;
          }
        });
        setFieldErrors((prev) => ({ ...prev, ...serverErrors }));
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="cs-form-card" noValidate aria-label="Vendor form">
      {generalError && (
        <div className="cs-error-box" role="alert" style={{ marginBottom: '16px' }}>
          <p className="cs-error-desc" style={{ margin: 0 }}>
            {generalError}
          </p>
        </div>
      )}

      <div className="cs-form-grid">
        {/* Vendor Name */}
        <div className="cs-form-field">
          <label htmlFor="vendor-name-input" className="cs-form-label">
            Legal Name <span className="cs-required">*</span>
          </label>
          <input
            id="vendor-name-input"
            type="text"
            className={`cs-input ${fieldErrors.name ? 'cs-input-error' : ''}`}
            placeholder="e.g. Acme Industrial Supplies LLC"
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            disabled={isLoading}
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? 'vendor-name-error' : undefined}
          />
          {fieldErrors.name && (
            <span id="vendor-name-error" className="cs-field-error" role="alert">
              {fieldErrors.name}
            </span>
          )}
        </div>

        {/* Tax Number */}
        <div className="cs-form-field">
          <label htmlFor="vendor-tax-input" className="cs-form-label">
            Tax Number / EIN <span className="cs-required">*</span>
          </label>
          <input
            id="vendor-tax-input"
            type="text"
            className={`cs-input cs-cell-mono ${fieldErrors.tax_number ? 'cs-input-error' : ''}`}
            placeholder="e.g. US-EIN-123456789"
            value={formData.tax_number}
            onChange={(e) => handleChange('tax_number', e.target.value)}
            disabled={isLoading}
            aria-invalid={!!fieldErrors.tax_number}
            aria-describedby={fieldErrors.tax_number ? 'vendor-tax-error' : undefined}
          />
          {fieldErrors.tax_number && (
            <span id="vendor-tax-error" className="cs-field-error" role="alert">
              {fieldErrors.tax_number}
            </span>
          )}
        </div>

        {/* Email */}
        <div className="cs-form-field">
          <label htmlFor="vendor-email-input" className="cs-form-label">
            Procurement Email <span className="cs-required">*</span>
          </label>
          <input
            id="vendor-email-input"
            type="email"
            className={`cs-input ${fieldErrors.email ? 'cs-input-error' : ''}`}
            placeholder="e.g. procurement@acme-industrial.com"
            value={formData.email}
            onChange={(e) => handleChange('email', e.target.value)}
            disabled={isLoading}
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? 'vendor-email-error' : undefined}
          />
          {fieldErrors.email && (
            <span id="vendor-email-error" className="cs-field-error" role="alert">
              {fieldErrors.email}
            </span>
          )}
        </div>

        {/* Phone */}
        <div className="cs-form-field">
          <label htmlFor="vendor-phone-input" className="cs-form-label">
            Phone Number
          </label>
          <input
            id="vendor-phone-input"
            type="tel"
            className="cs-input"
            placeholder="e.g. +1-555-0199"
            value={formData.phone || ''}
            onChange={(e) => handleChange('phone', e.target.value)}
            disabled={isLoading}
          />
        </div>

        {/* Currency */}
        <div className="cs-form-field">
          <label htmlFor="vendor-currency-input" className="cs-form-label">
            Currency (ISO 4217)
          </label>
          <input
            id="vendor-currency-input"
            type="text"
            maxLength={3}
            className={`cs-input cs-cell-mono ${fieldErrors.currency ? 'cs-input-error' : ''}`}
            placeholder="USD"
            value={formData.currency || 'USD'}
            onChange={(e) => handleChange('currency', e.target.value.toUpperCase())}
            disabled={isLoading}
            aria-invalid={!!fieldErrors.currency}
            aria-describedby={fieldErrors.currency ? 'vendor-currency-error' : undefined}
          />
          {fieldErrors.currency && (
            <span id="vendor-currency-error" className="cs-field-error" role="alert">
              {fieldErrors.currency}
            </span>
          )}
        </div>

        {/* Address Line */}
        <div className="cs-form-field cs-col-span-2">
          <label htmlFor="vendor-address-input" className="cs-form-label">
            Street Address
          </label>
          <input
            id="vendor-address-input"
            type="text"
            className="cs-input"
            placeholder="e.g. 100 Industrial Parkway"
            value={formData.address_line || ''}
            onChange={(e) => handleChange('address_line', e.target.value)}
            disabled={isLoading}
          />
        </div>

        {/* City */}
        <div className="cs-form-field">
          <label htmlFor="vendor-city-input" className="cs-form-label">
            City
          </label>
          <input
            id="vendor-city-input"
            type="text"
            className="cs-input"
            placeholder="e.g. Chicago"
            value={formData.city || ''}
            onChange={(e) => handleChange('city', e.target.value)}
            disabled={isLoading}
          />
        </div>

        {/* Country */}
        <div className="cs-form-field">
          <label htmlFor="vendor-country-input" className="cs-form-label">
            Country
          </label>
          <input
            id="vendor-country-input"
            type="text"
            className="cs-input"
            placeholder="e.g. United States"
            value={formData.country || ''}
            onChange={(e) => handleChange('country', e.target.value)}
            disabled={isLoading}
          />
        </div>

        {/* Bank Account Details */}
        <div className="cs-form-field cs-col-span-2">
          <label htmlFor="vendor-bank-input" className="cs-form-label">
            Bank Account Details
          </label>
          {isEdit && initialData?.bank_masked && (
            <div className="cs-helper-masked" style={{ marginBottom: '6px' }}>
              Current on file:{' '}
              <span className="cs-cell-masked">
                {initialData.bank_masked}
              </span>{' '}
              (Server-masked)
            </div>
          )}
          <input
            id="vendor-bank-input"
            type="text"
            className={`cs-input cs-cell-mono ${fieldErrors.bank_details ? 'cs-input-error' : ''}`}
            placeholder={
              isEdit
                ? 'Enter new account number to replace existing details...'
                : 'e.g. 1234567890 (will be masked to XXXX-XXXX-7890 server-side)'
            }
            value={formData.bank_details || ''}
            onChange={(e) => handleChange('bank_details', e.target.value)}
            disabled={isLoading}
            aria-invalid={!!fieldErrors.bank_details}
            aria-describedby={fieldErrors.bank_details ? 'vendor-bank-error' : undefined}
          />
          {fieldErrors.bank_details && (
            <span id="vendor-bank-error" className="cs-field-error" role="alert">
              {fieldErrors.bank_details}
            </span>
          )}
          <span className="cs-field-helper">
            Account numbers are masked upon server-side serialization format: XXXX-XXXX-7890.
          </span>
        </div>
      </div>

      <footer className="cs-form-actions">
        <button
          type="button"
          className="cs-btn-secondary"
          onClick={onCancel}
          disabled={isLoading}
          aria-label="Cancel"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="cs-btn-primary"
          disabled={isLoading}
          aria-label={isEdit ? 'Save Changes' : 'Create Vendor'}
        >
          {isLoading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Vendor'}
        </button>
      </footer>
    </form>
  );
};
