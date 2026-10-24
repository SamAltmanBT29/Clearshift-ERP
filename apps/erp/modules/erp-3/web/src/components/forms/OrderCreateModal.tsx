/**
 * ERP-3 Sales Orders & Invoices — Sales Order Creation Modal
 *
 * Provides an accessible modal dialog containing the sales order creation form,
 * client-side field validation, double-submission prevention, and server
 * validation error mapping.
 *
 * Conforms to Acceptance Criteria for Issue #156 (ERP3-20):
 * - AC1: Form validates required fields, email format, phone numbers, and decimal ranges before submission.
 * - AC2: Client submission button disables during inflight request to prevent double-submit.
 * - AC3: Server validation errors (400) map directly to corresponding input fields with error text.
 * - AC4: Successful submission closes modal, updates table cache, and shows confirmation toast.
 *
 * @module erp3/web/components/forms/OrderCreateModal
 */

import React, { useEffect } from 'react';
import type { CreateSalesOrderInput, SalesOrder } from '@clearshift/contracts';
import { Dialog, FormField, Alert } from '@cs/ui';
import { useOrderForm, type OrderFormValues } from '../../hooks/useOrderForm.js';
import { createSalesOrder } from '../../api/erp-3.js';

export interface OrderCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderCreated?: ((order: SalesOrder) => void) | undefined;
  initialValues?: Partial<OrderFormValues> | undefined;
  /** Optional custom submit implementation for mocking/testing */
  onSubmitOrder?: ((input: CreateSalesOrderInput) => Promise<SalesOrder>) | undefined;
}

export const OrderCreateModal: React.FC<OrderCreateModalProps> = ({
  isOpen,
  onClose,
  onOrderCreated,
  initialValues,
  onSubmitOrder = createSalesOrder,
}) => {
  const {
    values,
    errors,
    isSubmitting,
    submitError,
    lineCalculations,
    orderTotals,
    handleChange,
    handleLineChange,
    handleAddLine,
    handleRemoveLine,
    handleSubmit,
    reset,
  } = useOrderForm({
    initialValues,
    onSubmit: onSubmitOrder,
    onSuccess: (order) => {
      reset();
      if (onOrderCreated) {
        onOrderCreated(order);
      }
      onClose();
    },
  });

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  const customerGidError = errors.customerGoldenId || errors.customer_golden_id;
  const orderDateError = errors.orderDate || errors.order_date;
  const currencyError = errors.currency;
  const customerEmailError = errors.customerEmail || errors.customer_email;
  const customerPhoneError = errors.customerPhone || errors.customer_phone;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Sales Order"
      description="Enter customer Golden ID, order date, currency, and line items with real-time tax calculation."
      className="cs-erp3-create-modal"
    >
      <form
        noValidate
        onSubmit={handleSubmit}
        className="cs-erp3-create-form"
        data-testid="order-create-form"
      >
        {/* Server Level Error Alert */}
        {submitError && (
          <div className="cs-erp3-form-alert mb-4">
            <Alert
              variant="error"
              title={
                submitError.status === 400
                  ? 'Please correct the validation errors below'
                  : 'Sales Order Creation Failed'
              }
            >
              <p className="text-sm">{submitError.message}</p>
              {submitError.correlationId && (
                <p className="text-xs text-[var(--cs-text-muted)] mt-1">
                  Reference ID: <code>{submitError.correlationId}</code>
                </p>
              )}
            </Alert>
          </div>
        )}

        {/* General Form Error Alert */}
        {errors.general && (!submitError || errors.general !== submitError.message) && (
          <div className="cs-erp3-form-alert mb-4">
            <Alert variant="error" title="Validation Error">
              <p className="text-sm">{errors.general}</p>
            </Alert>
          </div>
        )}

        {/* 1. Customer Golden ID */}
        <div className="cs-erp3-form-section">
          <FormField
            id="order-customer-gid"
            label="Customer Golden ID"
            required
            {...(customerGidError ? { error: customerGidError } : {})}
            helperText="Hub-verified customer Golden ID (UUID v4 per ADR-003)."
          >
            <input
              type="text"
              name="customerGoldenId"
              value={values.customerGoldenId}
              placeholder="e.g. 55555555-0003-4000-8000-000000000001"
              disabled={isSubmitting}
              onChange={(e) => handleChange('customerGoldenId', e.target.value)}
            />
          </FormField>
        </div>

        {/* 2. Order Date & Currency */}
        <div className="cs-erp3-form-row">
          <FormField
            id="order-date"
            label="Order Date"
            required
            {...(orderDateError ? { error: orderDateError } : {})}
            helperText="Order posting date in YYYY-MM-DD format."
          >
            <input
              type="date"
              name="orderDate"
              value={values.orderDate}
              disabled={isSubmitting}
              onChange={(e) => handleChange('orderDate', e.target.value)}
            />
          </FormField>

          <FormField
            id="order-currency"
            label="Currency"
            required
            {...(currencyError ? { error: currencyError } : {})}
            helperText="ISO 4217 3-letter currency code."
          >
            <select
              name="currency"
              value={values.currency}
              disabled={isSubmitting}
              onChange={(e) => handleChange('currency', e.target.value)}
            >
              <option value="USD">USD - US Dollar</option>
              <option value="EUR">EUR - Euro</option>
              <option value="GBP">GBP - British Pound</option>
              <option value="INR">INR - Indian Rupee</option>
            </select>
          </FormField>
        </div>

        {/* 3. Customer Email & Contact Phone (AC1: email & phone formats) */}
        <div className="cs-erp3-form-row">
          <FormField
            id="order-customer-email"
            label="Customer Email"
            {...(customerEmailError ? { error: customerEmailError } : {})}
            helperText="Notification or confirmation email (optional)."
          >
            <input
              type="email"
              name="customerEmail"
              value={values.customerEmail}
              placeholder="customer@example.com"
              disabled={isSubmitting}
              onChange={(e) => handleChange('customerEmail', e.target.value)}
            />
          </FormField>

          <FormField
            id="order-customer-phone"
            label="Contact Phone"
            {...(customerPhoneError ? { error: customerPhoneError } : {})}
            helperText="Customer contact phone number (optional, min 7 digits)."
          >
            <input
              type="tel"
              name="customerPhone"
              value={values.customerPhone}
              placeholder="+1-555-019-2834"
              disabled={isSubmitting}
              onChange={(e) => handleChange('customerPhone', e.target.value)}
            />
          </FormField>
        </div>

        {/* 4. Order Line Items Section */}
        <div className="cs-erp3-line-items-section mt-4 pt-3 border-t border-[var(--cs-border)]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-[var(--cs-text)]">
              Order Line Items ({values.lines.length})
            </h4>
            <button
              type="button"
              className="cs-erp3-btn cs-erp3-btn-secondary text-xs px-2.5 py-1"
              onClick={handleAddLine}
              disabled={isSubmitting}
              aria-label="Add Line Item"
            >
              + Add Line Item
            </button>
          </div>

          {errors.linesGeneral && (
            <p className="text-xs text-[var(--cs-err)] mb-2" role="alert">
              ⚠ {errors.linesGeneral}
            </p>
          )}

          <div className="space-y-3">
            {values.lines.map((line, idx) => {
              const lineErr = errors.lines?.[idx];
              const lineCalc = lineCalculations[idx];

              return (
                <div
                  key={line.id}
                  className="p-3 rounded border border-[var(--cs-border)] bg-[var(--cs-surface)] space-y-2"
                  data-testid={`order-line-${idx}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--cs-text-muted)]">
                      Line #{idx + 1}
                    </span>
                    {values.lines.length > 1 && (
                      <button
                        type="button"
                        className="text-xs text-[var(--cs-err)] hover:underline"
                        onClick={() => handleRemoveLine(idx)}
                        disabled={isSubmitting}
                        aria-label={`Remove Line ${idx + 1}`}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {/* Line Item: Product ID */}
                  {(() => {
                    const lineProductIdError = lineErr?.productId;
                    const lineQuantityError = lineErr?.quantity;
                    const linePriceError = lineErr?.price;
                    const lineTaxRateError = lineErr?.taxRate;

                    return (
                      <>
                        <FormField
                          id={`order-line-${idx}-product-id`}
                          label="Product ID"
                          required
                          {...(lineProductIdError ? { error: lineProductIdError } : {})}
                          helperText="Catalog product UUID."
                        >
                          <input
                            type="text"
                            name={`lines[${idx}].productId`}
                            value={line.productId}
                            placeholder="e.g. 00000000-0000-4000-b000-000000000001"
                            disabled={isSubmitting}
                            onChange={(e) => handleLineChange(idx, 'productId', e.target.value)}
                          />
                        </FormField>

                        {/* Line Item: Quantity, Price, Tax Rate */}
                        <div className="grid grid-cols-3 gap-2">
                          <FormField
                            id={`order-line-${idx}-quantity`}
                            label="Quantity"
                            required
                            {...(lineQuantityError ? { error: lineQuantityError } : {})}
                          >
                            <input
                              type="text"
                              name={`lines[${idx}].quantity`}
                              value={line.quantity}
                              placeholder="1.0000"
                              disabled={isSubmitting}
                              onChange={(e) => handleLineChange(idx, 'quantity', e.target.value)}
                            />
                          </FormField>

                          <FormField
                            id={`order-line-${idx}-price`}
                            label="Unit Price"
                            required
                            {...(linePriceError ? { error: linePriceError } : {})}
                          >
                            <input
                              type="text"
                              name={`lines[${idx}].price`}
                              value={line.price}
                              placeholder="100.0000"
                              disabled={isSubmitting}
                              onChange={(e) => handleLineChange(idx, 'price', e.target.value)}
                            />
                          </FormField>

                          <FormField
                            id={`order-line-${idx}-tax-rate`}
                            label="Tax Rate (%)"
                            {...(lineTaxRateError ? { error: lineTaxRateError } : {})}
                          >
                            <input
                              type="text"
                              name={`lines[${idx}].taxRate`}
                              value={line.taxRate}
                              placeholder="10.0000"
                              disabled={isSubmitting}
                              onChange={(e) => handleLineChange(idx, 'taxRate', e.target.value)}
                            />
                          </FormField>
                        </div>
                      </>
                    );
                  })()}

                  {/* Computed line total */}
                  {lineCalc && (
                    <div className="text-right text-xs text-[var(--cs-text-muted)] pt-1">
                      Subtotal: <span className="font-mono">{lineCalc.subtotal}</span> | Tax: <span className="font-mono">{lineCalc.tax_amount}</span> | Total:{' '}
                      <strong className="font-mono text-[var(--cs-text)]">
                        {lineCalc.line_total} {values.currency}
                      </strong>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 5. Live Computed Order Totals Card */}
        <div className="cs-totals-summary-card mt-4 p-3 rounded bg-[var(--cs-surface-subtle,var(--cs-surface))] border border-[var(--cs-border)] text-sm space-y-1">
          <div className="flex justify-between text-xs text-[var(--cs-text-muted)]">
            <span>Subtotal:</span>
            <span className="font-mono">${orderTotals.subtotal} {values.currency}</span>
          </div>
          <div className="flex justify-between text-xs text-[var(--cs-text-muted)]">
            <span>Tax Amount:</span>
            <span className="font-mono">${orderTotals.taxTotal} {values.currency}</span>
          </div>
          <div className="flex justify-between text-sm font-semibold text-[var(--cs-text)] pt-1 border-t border-[var(--cs-border)]">
            <span>Order Total:</span>
            <span className="font-mono">${orderTotals.total} {values.currency}</span>
          </div>
        </div>

        {/* Modal Form Actions */}
        <div className="cs-erp3-modal-actions mt-6 pt-4 border-t border-[var(--cs-border)] flex items-center justify-end gap-3">
          <button
            type="button"
            className="cs-erp3-btn cs-erp3-btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="cs-erp3-btn cs-erp3-btn-primary"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Create Sales Order'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default OrderCreateModal;
