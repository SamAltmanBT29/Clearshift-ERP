import React, { useState } from 'react';
import type { CreateInvoiceInput } from '@clearshift/contracts';

export interface InvoiceFormProps {
  initialValues?: Partial<CreateInvoiceInput>;
  onSubmit: (data: CreateInvoiceInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  apiError?: string | null;
}

export const InvoiceForm: React.FC<InvoiceFormProps> = ({
  initialValues,
  onSubmit,
  onCancel,
  isLoading = false,
  apiError = null,
}) => {
  const [orderId, setOrderId] = useState(initialValues?.orderId || '');
  const [invoiceDate, setInvoiceDate] = useState(
    initialValues?.invoiceDate || new Date().toISOString().split('T')[0] || ''
  );
  // Default due date to +30 days
  const [dueDate, setDueDate] = useState(() => {
    if (initialValues?.dueDate !== undefined) return initialValues.dueDate;
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0] || '';
  });
  const [notes, setNotes] = useState(initialValues?.notes || '');

  const [errors, setErrors] = useState<{
    orderId?: string | undefined;
    invoiceDate?: string | undefined;
    dueDate?: string | undefined;
    general?: string | undefined;
  }>({});

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    let isValid = true;

    if (!orderId.trim()) {
      newErrors.orderId = 'Sales Order ID is required';
      isValid = false;
    }

    if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
      newErrors.invoiceDate = 'Invoice date is required and must be in YYYY-MM-DD format';
      isValid = false;
    }

    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      newErrors.dueDate = 'Due date is required (FR-ERP3-05: required for overdue status calculation)';
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    await onSubmit({
      orderId: orderId.trim(),
      invoiceDate,
      dueDate,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <form className="cs-form-card" onSubmit={handleSubmit} noValidate>
      {apiError && (
        <div className="cs-form-error-banner" role="alert" aria-live="assertive">
          <span className="cs-error-icon" aria-hidden="true">⚠️</span>
          <div>
            <strong>Error creating invoice:</strong>
            <p>{apiError}</p>
          </div>
        </div>
      )}

      <div className="cs-form-section">
        <h3 className="cs-form-section-title">Invoice Details</h3>
        <div className="cs-form-grid">
          <div className="cs-form-field">
            <label htmlFor="invoice-order-id" className="cs-form-label">
              Sales Order ID <span className="cs-required-marker">*</span>
            </label>
            <input
              id="invoice-order-id"
              type="text"
              className={`cs-input ${errors.orderId ? 'cs-input-error' : ''}`}
              placeholder="e.g. so-001 or UUID"
              value={orderId}
              onChange={(e) => {
                setOrderId(e.target.value);
                if (errors.orderId) setErrors((prev) => ({ ...prev, orderId: undefined }));
              }}
              disabled={isLoading}
              aria-invalid={!!errors.orderId}
              aria-describedby={errors.orderId ? 'invoice-order-id-err' : 'invoice-order-id-help'}
              required
            />
            {errors.orderId ? (
              <span id="invoice-order-id-err" className="cs-field-error" role="alert">
                {errors.orderId}
              </span>
            ) : (
              <span id="invoice-order-id-help" className="cs-field-helper">
                Reference to the sales order being invoiced (one invoice per order in V1)
              </span>
            )}
          </div>

          <div className="cs-form-field">
            <label htmlFor="invoice-date" className="cs-form-label">
              Invoice Date <span className="cs-required-marker">*</span>
            </label>
            <input
              id="invoice-date"
              type="date"
              className={`cs-input ${errors.invoiceDate ? 'cs-input-error' : ''}`}
              value={invoiceDate}
              onChange={(e) => {
                setInvoiceDate(e.target.value);
                if (errors.invoiceDate) setErrors((prev) => ({ ...prev, invoiceDate: undefined }));
              }}
              disabled={isLoading}
              aria-invalid={!!errors.invoiceDate}
              aria-describedby={errors.invoiceDate ? 'invoice-date-err' : undefined}
              required
            />
            {errors.invoiceDate && (
              <span id="invoice-date-err" className="cs-field-error" role="alert">
                {errors.invoiceDate}
              </span>
            )}
          </div>

          <div className="cs-form-field">
            <label htmlFor="invoice-due-date" className="cs-form-label">
              Due Date <span className="cs-required-marker">*</span>
            </label>
            <input
              id="invoice-due-date"
              type="date"
              className={`cs-input ${errors.dueDate ? 'cs-input-error' : ''}`}
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                if (errors.dueDate) setErrors((prev) => ({ ...prev, dueDate: undefined }));
              }}
              disabled={isLoading}
              aria-invalid={!!errors.dueDate}
              aria-describedby={errors.dueDate ? 'invoice-due-date-err' : 'invoice-due-date-help'}
              required
            />
            {errors.dueDate ? (
              <span id="invoice-due-date-err" className="cs-field-error" role="alert">
                {errors.dueDate}
              </span>
            ) : (
              <span id="invoice-due-date-help" className="cs-field-helper">
                Required in V1: Status derives to Overdue when UTC calendar date &gt; due date
              </span>
            )}
          </div>
        </div>

        <div className="cs-form-field" style={{ marginTop: '16px' }}>
          <label htmlFor="invoice-notes" className="cs-form-label">
            Payment Terms & Notes
          </label>
          <textarea
            id="invoice-notes"
            className="cs-textarea"
            rows={2}
            placeholder="Payment instructions, bank wire details, or invoice memo..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isLoading}
          />
        </div>
      </div>

      <footer className="cs-form-actions">
        <button
          type="button"
          className="cs-btn-secondary"
          onClick={onCancel}
          disabled={isLoading}
          aria-label="Cancel invoice creation"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="cs-btn-primary"
          disabled={isLoading}
          aria-label="Generate invoice"
        >
          {isLoading ? 'Creating Invoice...' : 'Generate Invoice'}
        </button>
      </footer>
    </form>
  );
};
