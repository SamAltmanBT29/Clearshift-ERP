import React, { useState, useMemo } from 'react';
import type { CreateSalesOrderInput, CreateSalesOrderLineInput } from '@clearshift/contracts';
import { calculateLineAmounts, CustomerGoldenIdSchema } from '@clearshift/contracts';

export interface OrderFormProps {
  initialValues?: Partial<CreateSalesOrderInput>;
  onSubmit: (data: CreateSalesOrderInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  apiError?: string | null;
}

interface FormLineItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  taxRate: string;
}

export const OrderForm: React.FC<OrderFormProps> = ({
  initialValues,
  onSubmit,
  onCancel,
  isLoading = false,
  apiError = null,
}) => {
  const [customerGoldenId, setCustomerGoldenId] = useState(initialValues?.customerGoldenId || '');
  const [orderDate, setOrderDate] = useState(
    initialValues?.orderDate || new Date().toISOString().split('T')[0] || ''
  );
  const [currencyCode, setCurrencyCode] = useState(initialValues?.currencyCode || 'USD');
  const [notes, setNotes] = useState(initialValues?.notes || '');

  const [lines, setLines] = useState<FormLineItem[]>(() => {
    if (initialValues?.lines && initialValues.lines.length > 0) {
      return initialValues.lines.map((l, idx) => ({
        id: `line-${idx}`,
        productId: l.productId || '',
        productName: l.productName || '',
        quantity: l.quantity || 1,
        unitPrice: l.unitPrice || '0.00',
        taxRate: l.taxRate || '0.10',
      }));
    }
    return [
      {
        id: 'line-0',
        productId: '',
        productName: '',
        quantity: 1,
        unitPrice: '100.00',
        taxRate: '0.10',
      },
    ];
  });

  const [errors, setErrors] = useState<{
    customerGoldenId?: string | undefined;
    orderDate?: string | undefined;
    lines?: { [key: number]: { productId?: string | undefined; quantity?: string | undefined; unitPrice?: string | undefined; taxRate?: string | undefined } } | undefined;
    general?: string | undefined;
  }>({});

  // Compute live line amounts and order totals
  const lineCalculations = useMemo(() => {
    return lines.map((line) => {
      const qty = Math.max(0, Math.floor(line.quantity || 0));
      return calculateLineAmounts(qty, line.unitPrice || '0.00', line.taxRate || '0.00');
    });
  }, [lines]);

  const orderTotals = useMemo(() => {
    let subtotalCents = 0;
    let taxCents = 0;
    let totalCents = 0;

    for (const calc of lineCalculations) {
      subtotalCents += Math.round(parseFloat(calc.subtotal || '0') * 100);
      taxCents += Math.round(parseFloat(calc.taxAmount || '0') * 100);
      totalCents += Math.round(parseFloat(calc.lineTotal || '0') * 100);
    }

    return {
      subtotal: (subtotalCents / 100).toFixed(2),
      taxTotal: (taxCents / 100).toFixed(2),
      total: (totalCents / 100).toFixed(2),
    };
  }, [lineCalculations]);

  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `line-${Date.now()}`,
        productId: '',
        productName: '',
        quantity: 1,
        unitPrice: '0.00',
        taxRate: '0.10',
      },
    ]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => {
      if (!prev.lines) return prev;
      const updatedLines = { ...prev.lines };
      delete updatedLines[index];
      return { ...prev, lines: updatedLines };
    });
  };

  const handleLineChange = (index: number, field: keyof FormLineItem, value: any) => {
    setLines((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index]!, [field]: value };
      return copy;
    });

    // Clear line error if modified
    if (errors.lines && errors.lines[index]) {
      setErrors((prev) => ({
        ...prev,
        lines: {
          ...prev.lines,
          [index]: {
            ...prev.lines?.[index],
            [field]: undefined,
          },
        },
      }));
    }
  };

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    let isValid = true;

    // Customer Golden ID validation
    const gidResult = CustomerGoldenIdSchema.safeParse(customerGoldenId.trim());
    if (!gidResult.success) {
      newErrors.customerGoldenId = 'Customer Golden ID is required and must follow the gid-<identifier> format (e.g. gid-cust-001)';
      isValid = false;
    }

    // Order date validation
    if (!orderDate || !/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) {
      newErrors.orderDate = 'Order date is required and must be in YYYY-MM-DD format';
      isValid = false;
    }

    // Lines validation
    if (lines.length === 0) {
      newErrors.general = 'At least one line item is required';
      isValid = false;
    } else {
      const lineErrors: { [key: number]: any } = {};
      lines.forEach((l, idx) => {
        const itemErr: any = {};
        if (!l.productId.trim()) {
          itemErr.productId = 'Product ID is required';
          isValid = false;
        }
        if (!l.quantity || l.quantity < 1 || !Number.isInteger(Number(l.quantity))) {
          itemErr.quantity = 'Quantity must be a positive integer';
          isValid = false;
        }
        if (!l.unitPrice || isNaN(Number(l.unitPrice)) || Number(l.unitPrice) < 0) {
          itemErr.unitPrice = 'Price must be a valid positive decimal';
          isValid = false;
        }
        if (l.taxRate === undefined || isNaN(Number(l.taxRate)) || Number(l.taxRate) < 0) {
          itemErr.taxRate = 'Tax rate must be a valid non-negative decimal';
          isValid = false;
        }
        if (Object.keys(itemErr).length > 0) {
          lineErrors[idx] = itemErr;
        }
      });
      if (Object.keys(lineErrors).length > 0) {
        newErrors.lines = lineErrors;
      }
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const payload: CreateSalesOrderInput = {
      customerGoldenId: customerGoldenId.trim(),
      orderDate,
      currencyCode: currencyCode.toUpperCase(),
      notes: notes.trim() || undefined,
      lines: lines.map((l) => ({
        productId: l.productId.trim(),
        productName: l.productName.trim() || undefined,
        quantity: Math.floor(Number(l.quantity)),
        unitPrice: Number(l.unitPrice).toFixed(2),
        taxRate: Number(l.taxRate).toFixed(2),
      })),
    };

    await onSubmit(payload);
  };

  return (
    <form className="cs-form-card" onSubmit={handleSubmit} noValidate>
      {apiError && (
        <div className="cs-form-error-banner" role="alert" aria-live="assertive">
          <span className="cs-error-icon" aria-hidden="true">⚠️</span>
          <div>
            <strong>Error saving sales order:</strong>
            <p>{apiError}</p>
          </div>
        </div>
      )}

      {errors.general && (
        <div className="cs-form-error-banner" role="alert">
          <p>{errors.general}</p>
        </div>
      )}

      <div className="cs-form-section">
        <h3 className="cs-form-section-title">Order Information</h3>
        <div className="cs-form-grid">
          <div className="cs-form-field">
            <label htmlFor="order-customer-gid" className="cs-form-label">
              Customer Golden ID <span className="cs-required-marker">*</span>
            </label>
            <input
              id="order-customer-gid"
              type="text"
              className={`cs-input ${errors.customerGoldenId ? 'cs-input-error' : ''}`}
              placeholder="e.g. gid-cust-001"
              value={customerGoldenId}
              onChange={(e) => {
                setCustomerGoldenId(e.target.value);
                if (errors.customerGoldenId) setErrors((prev) => ({ ...prev, customerGoldenId: undefined }));
              }}
              disabled={isLoading}
              aria-invalid={!!errors.customerGoldenId}
              aria-describedby={errors.customerGoldenId ? 'order-customer-gid-err' : 'order-customer-gid-help'}
              required
            />
            {errors.customerGoldenId ? (
              <span id="order-customer-gid-err" className="cs-field-error" role="alert">
                {errors.customerGoldenId}
              </span>
            ) : (
              <span id="order-customer-gid-help" className="cs-field-helper">
                Hub-verified entity reference (format: gid-&lt;identifier&gt;)
              </span>
            )}
          </div>

          <div className="cs-form-field">
            <label htmlFor="order-date" className="cs-form-label">
              Order Date <span className="cs-required-marker">*</span>
            </label>
            <input
              id="order-date"
              type="date"
              className={`cs-input ${errors.orderDate ? 'cs-input-error' : ''}`}
              value={orderDate}
              onChange={(e) => {
                setOrderDate(e.target.value);
                if (errors.orderDate) setErrors((prev) => ({ ...prev, orderDate: undefined }));
              }}
              disabled={isLoading}
              aria-invalid={!!errors.orderDate}
              aria-describedby={errors.orderDate ? 'order-date-err' : undefined}
              required
            />
            {errors.orderDate && (
              <span id="order-date-err" className="cs-field-error" role="alert">
                {errors.orderDate}
              </span>
            )}
          </div>

          <div className="cs-form-field">
            <label htmlFor="order-currency" className="cs-form-label">
              Currency
            </label>
            <select
              id="order-currency"
              className="cs-select"
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value)}
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
          <label htmlFor="order-notes" className="cs-form-label">
            Notes / Instructions
          </label>
          <textarea
            id="order-notes"
            className="cs-textarea"
            rows={2}
            placeholder="Optional order notes or delivery instructions..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="cs-form-section">
        <div className="cs-section-header-row">
          <h3 className="cs-form-section-title">Order Line Items</h3>
          <button
            type="button"
            className="cs-btn-secondary cs-btn-sm"
            onClick={handleAddLine}
            disabled={isLoading}
            aria-label="Add line item"
          >
            + Add Line Item
          </button>
        </div>

        <div className="cs-lines-table-wrapper">
          <table className="cs-table cs-lines-table" aria-label="Order line items">
            <thead>
              <tr>
                <th style={{ width: '22%' }}>Product ID *</th>
                <th style={{ width: '25%' }}>Product Name</th>
                <th style={{ width: '12%', textAlign: 'right' }}>Qty *</th>
                <th style={{ width: '14%', textAlign: 'right' }}>Unit Price *</th>
                <th style={{ width: '12%', textAlign: 'right' }}>Tax Rate</th>
                <th style={{ width: '15%', textAlign: 'right' }}>Line Total</th>
                <th style={{ width: '8%', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const lineErr = errors.lines?.[idx];
                const calc = lineCalculations[idx];

                return (
                  <tr key={line.id}>
                    <td>
                      <input
                        type="text"
                        className={`cs-input cs-input-sm ${lineErr?.productId ? 'cs-input-error' : ''}`}
                        placeholder="e.g. PROD-101"
                        value={line.productId}
                        onChange={(e) => handleLineChange(idx, 'productId', e.target.value)}
                        disabled={isLoading}
                        aria-label={`Line ${idx + 1} Product ID`}
                        required
                      />
                      {lineErr?.productId && (
                        <span className="cs-field-error-xs" role="alert">
                          {lineErr.productId}
                        </span>
                      )}
                    </td>
                    <td>
                      <input
                        type="text"
                        className="cs-input cs-input-sm"
                        placeholder="Description (optional)"
                        value={line.productName}
                        onChange={(e) => handleLineChange(idx, 'productName', e.target.value)}
                        disabled={isLoading}
                        aria-label={`Line ${idx + 1} Product Name`}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className={`cs-input cs-input-sm cs-text-right ${lineErr?.quantity ? 'cs-input-error' : ''}`}
                        value={line.quantity}
                        onChange={(e) => handleLineChange(idx, 'quantity', parseInt(e.target.value, 10) || 0)}
                        disabled={isLoading}
                        aria-label={`Line ${idx + 1} Quantity`}
                        required
                      />
                      {lineErr?.quantity && (
                        <span className="cs-field-error-xs" role="alert">
                          {lineErr.quantity}
                        </span>
                      )}
                    </td>
                    <td>
                      <input
                        type="text"
                        className={`cs-input cs-input-sm cs-text-right ${lineErr?.unitPrice ? 'cs-input-error' : ''}`}
                        placeholder="0.00"
                        value={line.unitPrice}
                        onChange={(e) => handleLineChange(idx, 'unitPrice', e.target.value)}
                        disabled={isLoading}
                        aria-label={`Line ${idx + 1} Unit Price`}
                        required
                      />
                      {lineErr?.unitPrice && (
                        <span className="cs-field-error-xs" role="alert">
                          {lineErr.unitPrice}
                        </span>
                      )}
                    </td>
                    <td>
                      <input
                        type="text"
                        className={`cs-input cs-input-sm cs-text-right ${lineErr?.taxRate ? 'cs-input-error' : ''}`}
                        placeholder="0.10"
                        value={line.taxRate}
                        onChange={(e) => handleLineChange(idx, 'taxRate', e.target.value)}
                        disabled={isLoading}
                        aria-label={`Line ${idx + 1} Tax Rate`}
                      />
                      {lineErr?.taxRate && (
                        <span className="cs-field-error-xs" role="alert">
                          {lineErr.taxRate}
                        </span>
                      )}
                    </td>
                    <td className="cs-mono cs-text-right" style={{ fontWeight: 600 }}>
                      ${calc?.lineTotal || '0.00'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="cs-btn-danger cs-btn-xs"
                        onClick={() => handleRemoveLine(idx)}
                        disabled={lines.length <= 1 || isLoading}
                        aria-label={`Remove line ${idx + 1}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Live Computed Totals Summary Card */}
        <div className="cs-totals-summary-card">
          <div className="cs-totals-row">
            <span>Subtotal:</span>
            <span className="cs-mono">${orderTotals.subtotal} {currencyCode}</span>
          </div>
          <div className="cs-totals-row">
            <span>Tax (BR-ERP3-02 rounded):</span>
            <span className="cs-mono">${orderTotals.taxTotal} {currencyCode}</span>
          </div>
          <div className="cs-totals-row cs-totals-final">
            <strong>Order Total:</strong>
            <strong className="cs-mono">${orderTotals.total} {currencyCode}</strong>
          </div>
        </div>
      </div>

      <footer className="cs-form-actions">
        <button
          type="button"
          className="cs-btn-secondary"
          onClick={onCancel}
          disabled={isLoading}
          aria-label="Cancel creating sales order"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="cs-btn-primary"
          disabled={isLoading}
          aria-label="Save sales order"
        >
          {isLoading ? 'Saving Sales Order...' : 'Create Sales Order'}
        </button>
      </footer>
    </form>
  );
};
