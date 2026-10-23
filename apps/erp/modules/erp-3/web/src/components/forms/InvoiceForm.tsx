import React, { useState } from 'react';
import type { CreateInvoiceInput, SalesOrder } from '@clearshift/contracts';
import { CustomerGoldenIdSchema, OrdersUuid } from '@clearshift/contracts';

export interface InvoiceFormProps {
  initialValues?: Partial<CreateInvoiceInput> & { notes?: string };
  sourceOrder?: SalesOrder | null;
  onSubmit: (data: CreateInvoiceInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  apiError?: string | null;
}

const DEFAULT_FALLBACK_CUSTOMER_ID = '55555555-0003-4000-8000-000000000001';
const DEFAULT_FALLBACK_PRODUCT_ID = '11111111-0001-4000-8000-000000000001';

export const InvoiceForm: React.FC<InvoiceFormProps> = ({
  initialValues,
  sourceOrder = null,
  onSubmit,
  onCancel,
  isLoading = false,
  apiError = null,
}) => {
  const [orderId, setOrderId] = useState(
    initialValues?.order_id !== undefined
      ? initialValues.order_id || ''
      : sourceOrder?.id || ''
  );
  const [customerGoldenId, setCustomerGoldenId] = useState(
    initialValues?.customer_golden_id ||
      sourceOrder?.customer_golden_id ||
      DEFAULT_FALLBACK_CUSTOMER_ID
  );
  const [currency, setCurrency] = useState(
    initialValues?.currency || sourceOrder?.currency || 'USD'
  );
  const [invoiceDate, setInvoiceDate] = useState(
    initialValues?.invoice_date || new Date().toISOString().split('T')[0] || ''
  );
  // Default due date to +30 days
  const [dueDate, setDueDate] = useState(() => {
    if (initialValues?.due_date !== undefined) return initialValues.due_date;
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0] || '';
  });
  const [notes, setNotes] = useState(initialValues?.notes || '');

  const [lines] = useState(() => {
    if (initialValues?.lines && initialValues.lines.length > 0) {
      return initialValues.lines;
    }
    if (sourceOrder?.lines && sourceOrder.lines.length > 0) {
      return sourceOrder.lines.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        price: l.price,
        tax_rate: l.tax_rate,
      }));
    }
    return [
      {
        product_id: DEFAULT_FALLBACK_PRODUCT_ID,
        quantity: '1.0000',
        price: '100.0000',
        tax_rate: '10.0000',
      },
    ];
  });

  const [errors, setErrors] = useState<{
    order_id?: string | undefined;
    customer_golden_id?: string | undefined;
    invoice_date?: string | undefined;
    due_date?: string | undefined;
    general?: string | undefined;
  }>({});

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    let isValid = true;

    if (!orderId.trim() || !OrdersUuid.safeParse(orderId.trim()).success) {
      newErrors.order_id = 'Sales Order ID is required and must be a valid UUID';
      isValid = false;
    }

    if (!CustomerGoldenIdSchema.safeParse(customerGoldenId.trim()).success) {
      newErrors.customer_golden_id = 'Customer Golden ID is required and must be a valid UUID';
      isValid = false;
    }

    if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
      newErrors.invoice_date = 'Invoice date is required and must be in YYYY-MM-DD format';
      isValid = false;
    }

    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      newErrors.due_date =
        'Due date is required (DR-2 / V1_30 §8: mandatory for overdue calculation)';
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    await onSubmit({
      order_id: orderId.trim(),
      customer_golden_id: customerGoldenId.trim(),
      invoice_date: invoiceDate,
      due_date: dueDate,
      currency: currency.toUpperCase(),
      lines,
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
              className={`cs-input ${errors.order_id ? 'cs-input-error' : ''}`}
              placeholder="e.g. aaaaaaaa-0003-4000-8000-000000000001"
              value={orderId}
              onChange={(e) => {
                setOrderId(e.target.value);
                if (errors.order_id) setErrors((prev) => ({ ...prev, order_id: undefined }));
              }}
              disabled={isLoading}
              aria-invalid={!!errors.order_id}
              aria-describedby={errors.order_id ? 'invoice-order-id-err' : 'invoice-order-id-help'}
              required
            />
            {errors.order_id ? (
              <span id="invoice-order-id-err" className="cs-field-error" role="alert">
                {errors.order_id}
              </span>
            ) : (
              <span id="invoice-order-id-help" className="cs-field-helper">
                UUID reference to the sales order being invoiced
              </span>
            )}
          </div>

          <div className="cs-form-field">
            <label htmlFor="invoice-customer-gid" className="cs-form-label">
              Customer Golden ID <span className="cs-required-marker">*</span>
            </label>
            <input
              id="invoice-customer-gid"
              type="text"
              className={`cs-input ${errors.customer_golden_id ? 'cs-input-error' : ''}`}
              placeholder="e.g. 55555555-0003-4000-8000-000000000001"
              value={customerGoldenId}
              onChange={(e) => {
                setCustomerGoldenId(e.target.value);
                if (errors.customer_golden_id) {
                  setErrors((prev) => ({ ...prev, customer_golden_id: undefined }));
                }
              }}
              disabled={isLoading}
              aria-invalid={!!errors.customer_golden_id}
              required
            />
            {errors.customer_golden_id && (
              <span className="cs-field-error" role="alert">
                {errors.customer_golden_id}
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
              className={`cs-input ${errors.invoice_date ? 'cs-input-error' : ''}`}
              value={invoiceDate}
              onChange={(e) => {
                setInvoiceDate(e.target.value);
                if (errors.invoice_date) {
                  setErrors((prev) => ({ ...prev, invoice_date: undefined }));
                }
              }}
              disabled={isLoading}
              aria-invalid={!!errors.invoice_date}
              aria-describedby={errors.invoice_date ? 'invoice-date-err' : undefined}
              required
            />
            {errors.invoice_date && (
              <span id="invoice-date-err" className="cs-field-error" role="alert">
                {errors.invoice_date}
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
              className={`cs-input ${errors.due_date ? 'cs-input-error' : ''}`}
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                if (errors.due_date) setErrors((prev) => ({ ...prev, due_date: undefined }));
              }}
              disabled={isLoading}
              aria-invalid={!!errors.due_date}
              aria-describedby={errors.due_date ? 'invoice-due-date-err' : 'invoice-due-date-help'}
              required
            />
            {errors.due_date ? (
              <span id="invoice-due-date-err" className="cs-field-error" role="alert">
                {errors.due_date}
              </span>
            ) : (
              <span id="invoice-due-date-help" className="cs-field-helper">
                Required in V1 (DR-2): Status derives to Overdue when UTC calendar date &gt; due date
              </span>
            )}
          </div>

          <div className="cs-form-field">
            <label htmlFor="invoice-currency" className="cs-form-label">
              Currency
            </label>
            <select
              id="invoice-currency"
              className="cs-select"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={isLoading}
            >
              <option value="USD">USD - US Dollar</option>
              <option value="EUR">EUR - Euro</option>
              <option value="GBP">GBP - British Pound</option>
              <option value="INR">INR - Indian Rupee</option>
            </select>
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
