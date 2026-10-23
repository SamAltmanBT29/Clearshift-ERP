import React, { useState } from 'react';
import type { CreatePaymentInput, Invoice, PaymentMethod } from '@clearshift/contracts';

export interface PaymentModalProps {
  isOpen: boolean;
  invoice: Invoice;
  paidAmount?: string;
  onClose: () => void;
  onSubmit: (data: CreatePaymentInput) => Promise<void>;
  isLoading?: boolean;
  apiError?: string | null;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  invoice,
  paidAmount = '0.0000',
  onClose,
  onSubmit,
  isLoading = false,
  apiError = null,
}) => {
  const totalFormatted2Dp = parseFloat(invoice.total || '0').toFixed(2);
  const paidFormatted2Dp = parseFloat(paidAmount || '0').toFixed(2);
  const remainingCents = Math.max(
    0,
    Math.round(parseFloat(invoice.total || '0') * 100) -
      Math.round(parseFloat(paidAmount || '0') * 100)
  );
  const remainingAmount2Dp = (remainingCents / 100).toFixed(2);

  const [amount, setAmount] = useState(remainingAmount2Dp);
  const [paidAt, setPaidAt] = useState(new Date().toISOString().split('T')[0] || '');
  const [method, setMethod] = useState<PaymentMethod>('bank');
  const [reference, setReference] = useState('');

  const [errors, setErrors] = useState<{
    amount?: string | undefined;
    paid_at?: string | undefined;
  }>({});

  if (!isOpen) return null;

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    let isValid = true;

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      newErrors.amount = 'Payment amount must be greater than zero';
      isValid = false;
    } else if (Math.round(numAmount * 100) !== remainingCents) {
      newErrors.amount = `V1 requires full invoice settlement ($${remainingAmount2Dp} ${invoice.currency})`;
      isValid = false;
    }

    if (!paidAt || !/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
      newErrors.paid_at = 'Payment date is required and must be in YYYY-MM-DD format';
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const isoPaidAt = paidAt.includes('T') ? paidAt : `${paidAt}T00:00:00.000Z`;

    await onSubmit({
      invoice_id: invoice.id,
      amount: parseFloat(amount).toFixed(4),
      paid_at: isoPaidAt,
      method,
    });
  };

  return (
    <div className="cs-modal-overlay" role="presentation">
      <div
        className="cs-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-modal-title"
      >
        <header className="cs-modal-header">
          <h2 id="payment-modal-title" className="cs-modal-title">
            Record Payment for {invoice.invoice_number}
          </h2>
          <button
            type="button"
            className="cs-modal-close"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close payment modal"
          >
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <div className="cs-modal-body">
            {apiError && (
              <div className="cs-form-error-banner" role="alert">
                <span className="cs-error-icon" aria-hidden="true">⚠️</span>
                <div>
                  <strong>Error processing payment:</strong>
                  <p>{apiError}</p>
                </div>
              </div>
            )}

            {/* Invoice Summary Box */}
            <div className="cs-invoice-balance-box">
              <div className="cs-balance-item">
                <span className="cs-balance-label">Invoice Total:</span>
                <span className="cs-balance-value">${totalFormatted2Dp} {invoice.currency}</span>
              </div>
              <div className="cs-balance-item">
                <span className="cs-balance-label">Already Paid:</span>
                <span className="cs-balance-value">${paidFormatted2Dp} {invoice.currency}</span>
              </div>
              <div className="cs-balance-item cs-balance-due">
                <span className="cs-balance-label">Remaining Balance Due:</span>
                <span className="cs-balance-value">${remainingAmount2Dp} {invoice.currency}</span>
              </div>
            </div>

            <div className="cs-form-field" style={{ marginTop: '16px' }}>
              <label htmlFor="payment-amount" className="cs-form-label">
                Payment Amount ({invoice.currency}) <span className="cs-required-marker">*</span>
              </label>
              <input
                id="payment-amount"
                type="text"
                className={`cs-input ${errors.amount ? 'cs-input-error' : ''}`}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (errors.amount) setErrors((prev) => ({ ...prev, amount: undefined }));
                }}
                disabled={isLoading}
                aria-invalid={!!errors.amount}
                aria-describedby={errors.amount ? 'payment-amount-err' : 'payment-amount-help'}
                required
              />
              {errors.amount ? (
                <span id="payment-amount-err" className="cs-field-error" role="alert">
                  {errors.amount}
                </span>
              ) : (
                <span id="payment-amount-help" className="cs-field-helper">
                  V1 policy: full payment transitions invoice to Paid status automatically (FR-ERP3-04)
                </span>
              )}
            </div>

            <div className="cs-form-grid" style={{ marginTop: '14px' }}>
              <div className="cs-form-field">
                <label htmlFor="payment-date" className="cs-form-label">
                  Payment Date <span className="cs-required-marker">*</span>
                </label>
                <input
                  id="payment-date"
                  type="date"
                  className={`cs-input ${errors.paid_at ? 'cs-input-error' : ''}`}
                  value={paidAt}
                  onChange={(e) => {
                    setPaidAt(e.target.value);
                    if (errors.paid_at) setErrors((prev) => ({ ...prev, paid_at: undefined }));
                  }}
                  disabled={isLoading}
                  aria-invalid={!!errors.paid_at}
                  aria-describedby={errors.paid_at ? 'payment-date-err' : undefined}
                  required
                />
                {errors.paid_at && (
                  <span id="payment-date-err" className="cs-field-error" role="alert">
                    {errors.paid_at}
                  </span>
                )}
              </div>

              <div className="cs-form-field">
                <label htmlFor="payment-method" className="cs-form-label">
                  Payment Method <span className="cs-required-marker">*</span>
                </label>
                <select
                  id="payment-method"
                  className="cs-select"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  disabled={isLoading}
                >
                  <option value="bank">Bank Transfer / Wire</option>
                  <option value="card">Credit / Debit Card</option>
                  <option value="cash">Cash Settlement</option>
                </select>
              </div>
            </div>

            <div className="cs-form-field" style={{ marginTop: '14px' }}>
              <label htmlFor="payment-ref" className="cs-form-label">
                Reference / Transaction ID
              </label>
              <input
                id="payment-ref"
                type="text"
                className="cs-input"
                placeholder="e.g. TXN-WIRE-98721, check number, or receipt note"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>

          <footer className="cs-modal-actions">
            <button
              type="button"
              className="cs-btn-secondary"
              onClick={onClose}
              disabled={isLoading}
              aria-label="Cancel payment"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cs-btn-primary"
              disabled={isLoading}
              aria-label="Confirm payment submission"
            >
              {isLoading ? 'Recording Payment...' : `Record Payment ($${amount})`}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};
