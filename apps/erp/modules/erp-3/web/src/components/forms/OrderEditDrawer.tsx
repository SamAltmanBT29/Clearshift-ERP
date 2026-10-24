/**
 * ERP-3 Sales Orders & Invoices — Sales Order Edit Drawer Form
 *
 * Drawer form allowing updating allowlisted sales order attributes with
 * client & server validation, permission checking, and 409 concurrent conflict handling.
 *
 * Conforms to Acceptance Criteria for Issue #157 (ERP3-21):
 * - AC2: Inline edit or drawer form allows updating allowlisted fields with permission checking.
 * - AC4: Concurrent modification conflicts (409) prompt user to refresh and re-apply changes.
 *
 * @module erp3/web/components/forms/OrderEditDrawer
 */

import React, { useState, useEffect } from 'react';
import type { SalesOrder } from '@clearshift/contracts';
import { Dialog, FormField, Alert } from '@cs/ui';
import { updateSalesOrder, type UpdateSalesOrderInput, type UpdateOrderOptions, ApiError } from '../../api/erp-3.js';

export interface OrderEditDrawerProps {
  readonly isOpen: boolean;
  readonly order: SalesOrder;
  readonly canEdit?: boolean;
  readonly onClose: () => void;
  readonly onOrderUpdated?: (updated: SalesOrder) => void;
  readonly onSaved?: (updated: SalesOrder) => void;
  readonly onRefreshOrder?: () => void;
  /** Optional custom submit implementation for mocking/testing */
  readonly onSubmitUpdate?: (
    id: string,
    input: UpdateSalesOrderInput,
    options?: UpdateOrderOptions
  ) => Promise<SalesOrder>;
}

interface FormErrors {
  orderDate?: string;
  currency?: string;
  customerEmail?: string;
  customerPhone?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9\s\-()]{7,20}$/;

export const OrderEditDrawer: React.FC<OrderEditDrawerProps> = ({
  isOpen,
  order,
  canEdit = true,
  onClose,
  onOrderUpdated,
  onSaved,
  onRefreshOrder,
  onSubmitUpdate = updateSalesOrder,
}) => {
  const [orderDate, setOrderDate] = useState(order.order_date || '');
  const [currency, setCurrency] = useState(order.currency || 'USD');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');

  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConflict, setIsConflict] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Sync state when order prop updates or modal opens
  useEffect(() => {
    if (isOpen) {
      setOrderDate(order.order_date || '');
      setCurrency(order.currency || 'USD');
      setErrors({});
      setIsConflict(false);
      setConflictMessage(null);
      setServerError(null);
    }
  }, [isOpen, order]);

  const isOrderEditable = order.status === 'Open';
  const isFormDisabled = !canEdit || !isOrderEditable || isSubmitting;

  const validate = (): boolean => {
    const errs: FormErrors = {};

    if (!orderDate || !/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) {
      errs.orderDate = 'Order date is required and must be in YYYY-MM-DD format';
    }

    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      errs.currency = 'Currency must be an uppercase 3-letter ISO code';
    }

    if (customerEmail && customerEmail.trim() && !EMAIL_PATTERN.test(customerEmail.trim())) {
      errs.customerEmail = 'Invalid email address format (e.g. customer@example.com)';
    }

    if (customerPhone && customerPhone.trim() && !PHONE_PATTERN.test(customerPhone.trim())) {
      errs.customerPhone = 'Invalid phone number format (min 7 digits)';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleRefreshAndReapply = () => {
    setIsConflict(false);
    setConflictMessage(null);
    setServerError(null);
    if (onRefreshOrder) {
      onRefreshOrder();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !isOrderEditable) return;
    if (isSubmitting) return;

    if (!validate()) return;

    setIsSubmitting(true);
    setServerError(null);
    setIsConflict(false);

    try {
      const payload: UpdateSalesOrderInput = {
        order_date: orderDate,
        currency,
        notes: notes.trim() || undefined,
        customer_email: customerEmail.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
      };

      const updated = await onSubmitUpdate(order.id, payload, {
        version: order.updated_at,
      });

      setIsSubmitting(false);
      onOrderUpdated?.(updated);
      onSaved?.(updated);
      onClose();
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
  };

  const orderDateErr = errors.orderDate;
  const currencyErr = errors.currency;
  const emailErr = errors.customerEmail;
  const phoneErr = errors.customerPhone;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Sales Order: ${order.order_number}`}
      description="Update allowlisted sales order attributes. Order number and customer golden ID remain immutable (BR-ERP3-01)."
      className="cs-erp3-edit-modal"
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        className="cs-erp3-edit-form"
        aria-label="Edit sales order form"
      >
        {/* Permission Denied Alert */}
        {!canEdit && (
          <div style={{ marginBottom: '16px' }}>
            <Alert variant="warning" title="Read-Only Mode">
              You do not have write permissions for sales orders (requires <code>orders:write</code>). All fields are disabled.
            </Alert>
          </div>
        )}

        {/* Closed/Invoiced Status Warning */}
        {canEdit && !isOrderEditable && (
          <div style={{ marginBottom: '16px' }}>
            <Alert variant="info" title="Order Lifecycle Locked">
              This sales order is in <strong>{order.status}</strong> status. In V1, sales orders that have been invoiced or closed cannot be modified.
            </Alert>
          </div>
        )}

        {/* Concurrent Conflict Alert (409) */}
        {isConflict && (
          <div
            style={{ marginBottom: '16px' }}
            role="alert"
            data-testid="drawer-conflict-alert"
          >
            <Alert variant="error" title="Concurrent Modification Conflict">
              <p>
                {conflictMessage ||
                  'This record was modified by another operator or background job while you were editing.'}
              </p>
              <div style={{ marginTop: '12px' }}>
                <button
                  type="button"
                  className="cs-erp3-btn cs-erp3-btn-primary"
                  onClick={handleRefreshAndReapply}
                  data-testid="drawer-refresh-btn"
                >
                  Refresh Record and Re-apply Changes
                </button>
              </div>
            </Alert>
          </div>
        )}

        {/* Server Error Alert */}
        {serverError && !isConflict && (
          <div style={{ marginBottom: '16px' }} role="alert">
            <Alert variant="error" title="Update Failed">
              <p>{serverError}</p>
            </Alert>
          </div>
        )}

        {/* 1. Primary Identifiers (Read-only / Immutable) */}
        <div className="cs-erp3-form-row">
          <FormField
            id="edit-order-number"
            label="Order Number (Immutable Key)"
            helperText="Permanent human-readable identifier (BR-ERP3-01)."
          >
            <input
              type="text"
              id="edit-order-number"
              value={order.order_number}
              disabled
              readOnly
              className="cs-input-disabled cs-mono"
            />
          </FormField>

          <FormField
            id="edit-customer-gid"
            label="Customer Golden ID (Immutable)"
            helperText="Hub Identity customer UUID (ADR-003)."
          >
            <input
              type="text"
              id="edit-customer-gid"
              value={order.customer_golden_id}
              disabled
              readOnly
              className="cs-input-disabled cs-mono"
            />
          </FormField>
        </div>

        {/* 2. Allowlisted Editable Attributes */}
        <div className="cs-erp3-form-row">
          <FormField
            id="edit-order-date"
            label="Order Date"
            required
            {...(orderDateErr ? { error: orderDateErr } : {})}
            helperText="Order posting date in YYYY-MM-DD format."
          >
            <input
              type="date"
              id="edit-order-date"
              name="orderDate"
              value={orderDate}
              disabled={isFormDisabled}
              onChange={(e) => setOrderDate(e.target.value)}
            />
          </FormField>

          <FormField
            id="edit-currency"
            label="Currency"
            required
            {...(currencyErr ? { error: currencyErr } : {})}
            helperText="ISO 4217 3-letter currency code."
          >
            <select
              id="edit-currency"
              name="currency"
              value={currency}
              disabled={isFormDisabled}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="USD">USD - US Dollar</option>
              <option value="EUR">EUR - Euro</option>
              <option value="GBP">GBP - British Pound</option>
              <option value="INR">INR - Indian Rupee</option>
            </select>
          </FormField>
        </div>

        {/* 3. Contact Email & Phone */}
        <div className="cs-erp3-form-row">
          <FormField
            id="edit-customer-email"
            label="Customer Email"
            {...(emailErr ? { error: emailErr } : {})}
            helperText="Customer contact or billing notification email."
          >
            <input
              type="email"
              id="edit-customer-email"
              name="customerEmail"
              placeholder="customer@example.com"
              value={customerEmail}
              disabled={isFormDisabled}
              onChange={(e) => setCustomerEmail(e.target.value)}
            />
          </FormField>

          <FormField
            id="edit-customer-phone"
            label="Contact Phone"
            {...(phoneErr ? { error: phoneErr } : {})}
            helperText="Customer contact phone (min 7 digits)."
          >
            <input
              type="tel"
              id="edit-customer-phone"
              name="customerPhone"
              placeholder="+1-555-019-2834"
              value={customerPhone}
              disabled={isFormDisabled}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </FormField>
        </div>

        {/* 4. Notes */}
        <div style={{ marginTop: '8px' }}>
          <FormField
            id="edit-order-notes"
            label="Delivery Notes / Instructions"
            helperText="Optional special handling or shipping instructions."
          >
            <textarea
              id="edit-order-notes"
              name="notes"
              rows={2}
              placeholder="Special instructions..."
              value={notes}
              disabled={isFormDisabled}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormField>
        </div>

        {/* Actions */}
        <div className="cs-erp3-modal-actions mt-6 pt-4 border-t border-[var(--cs-border)] flex items-center justify-end gap-3">
          <button
            type="button"
            className="cs-erp3-btn cs-erp3-btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
            data-testid="drawer-cancel-btn"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="cs-erp3-btn cs-erp3-btn-primary"
            disabled={isFormDisabled}
            aria-busy={isSubmitting}
            data-testid="drawer-save-btn"
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default OrderEditDrawer;
