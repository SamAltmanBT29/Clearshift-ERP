import React, { useState, useMemo } from 'react';
import type { CreateSalesOrderInput } from '@clearshift/contracts';
import { calculateLineAmounts, CustomerGoldenIdSchema, OrdersUuid } from '@clearshift/contracts';

export interface OrderFormProps {
  initialValues?: Partial<CreateSalesOrderInput> & { notes?: string };
  onSubmit: (data: CreateSalesOrderInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  apiError?: string | null;
}

interface FormLineItem {
  id: string;
  product_id: string;
  productName: string;
  quantity: string;
  price: string;
  tax_rate: string;
}

export const OrderForm: React.FC<OrderFormProps> = ({
  initialValues,
  onSubmit,
  onCancel,
  isLoading = false,
  apiError = null,
}) => {
  const [customerGoldenId, setCustomerGoldenId] = useState(
    initialValues?.customer_golden_id || ''
  );
  const [orderDate, setOrderDate] = useState(
    initialValues?.order_date || new Date().toISOString().split('T')[0] || ''
  );
  const [currency, setCurrency] = useState(initialValues?.currency || 'USD');
  const [notes, setNotes] = useState(initialValues?.notes || '');

  const [lines, setLines] = useState<FormLineItem[]>(() => {
    if (initialValues?.lines && initialValues.lines.length > 0) {
      return initialValues.lines.map((l, idx) => ({
        id: `line-${idx}`,
        product_id: l.product_id || '',
        productName: '',
        quantity: l.quantity || '1',
        price: l.price || '0.0000',
        tax_rate: l.tax_rate || '10.0000',
      }));
    }
    return [
      {
        id: 'line-0',
        product_id: '',
        productName: '',
        quantity: '1',
        price: '100.0000',
        tax_rate: '10.0000',
      },
    ];
  });

  const [errors, setErrors] = useState<{
    customer_golden_id?: string | undefined;
    order_date?: string | undefined;
    lines?: {
      [key: number]: {
        product_id?: string | undefined;
        quantity?: string | undefined;
        price?: string | undefined;
        tax_rate?: string | undefined;
      };
    } | undefined;
    general?: string | undefined;
  }>({});

  // Compute live line amounts and order totals via canonical helper (⚠️ DR-1 pending)
  const lineCalculations = useMemo(() => {
    return lines.map((line) => {
      const qty = Number(line.quantity) > 0 ? line.quantity : '0';
      const price = !isNaN(Number(line.price)) && Number(line.price) >= 0 ? line.price : '0';
      const rate = !isNaN(Number(line.tax_rate)) && Number(line.tax_rate) >= 0 ? line.tax_rate : '0';
      return calculateLineAmounts(qty, price, rate);
    });
  }, [lines]);

  const orderTotals = useMemo(() => {
    let subtotalNum = 0;
    let taxNum = 0;
    let totalNum = 0;

    for (const calc of lineCalculations) {
      subtotalNum += parseFloat(calc.subtotal || '0');
      taxNum += parseFloat(calc.tax_amount || '0');
      totalNum += parseFloat(calc.line_total || '0');
    }

    return {
      subtotal: subtotalNum.toFixed(2),
      taxTotal: taxNum.toFixed(2),
      total: totalNum.toFixed(2),
    };
  }, [lineCalculations]);

  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `line-${Date.now()}`,
        product_id: '',
        productName: '',
        quantity: '1',
        price: '0.0000',
        tax_rate: '10.0000',
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

  const handleLineChange = (index: number, field: keyof FormLineItem, value: string) => {
    setLines((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index]!, [field]: value };
      return copy;
    });

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

    // Customer Golden ID validation (ADR-003 UUID)
    const gidResult = CustomerGoldenIdSchema.safeParse(customerGoldenId.trim());
    if (!gidResult.success) {
      newErrors.customer_golden_id =
        'Customer Golden ID is required and must be a valid UUID (ADR-003)';
      isValid = false;
    }

    // Order date validation
    if (!orderDate || !/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) {
      newErrors.order_date = 'Order date is required and must be in YYYY-MM-DD format';
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
        if (!OrdersUuid.safeParse(l.product_id.trim()).success) {
          itemErr.product_id = 'Product ID is required and must be a valid UUID';
          isValid = false;
        }
        if (!l.quantity || isNaN(Number(l.quantity)) || Number(l.quantity) <= 0) {
          itemErr.quantity = 'Quantity must be greater than zero';
          isValid = false;
        }
        if (l.price === '' || isNaN(Number(l.price)) || Number(l.price) < 0) {
          itemErr.price = 'Price must be a valid non-negative decimal';
          isValid = false;
        }
        if (l.tax_rate === '' || isNaN(Number(l.tax_rate)) || Number(l.tax_rate) < 0) {
          itemErr.tax_rate = 'Tax rate must be a valid non-negative percentage';
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
      customer_golden_id: customerGoldenId.trim(),
      order_date: orderDate,
      currency: currency.toUpperCase(),
      lines: lines.map((l) => ({
        product_id: l.product_id.trim(),
        quantity: Number(l.quantity).toFixed(4),
        price: Number(l.price).toFixed(4),
        tax_rate: Number(l.tax_rate).toFixed(4),
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
              aria-describedby={
                errors.customer_golden_id ? 'order-customer-gid-err' : 'order-customer-gid-help'
              }
              required
            />
            {errors.customer_golden_id ? (
              <span id="order-customer-gid-err" className="cs-field-error" role="alert">
                {errors.customer_golden_id}
              </span>
            ) : (
              <span id="order-customer-gid-help" className="cs-field-helper">
                Hub-verified customer Golden ID (UUID v4 per ADR-003)
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
              className={`cs-input ${errors.order_date ? 'cs-input-error' : ''}`}
              value={orderDate}
              onChange={(e) => {
                setOrderDate(e.target.value);
                if (errors.order_date) setErrors((prev) => ({ ...prev, order_date: undefined }));
              }}
              disabled={isLoading}
              aria-invalid={!!errors.order_date}
              aria-describedby={errors.order_date ? 'order-date-err' : undefined}
              required
            />
            {errors.order_date && (
              <span id="order-date-err" className="cs-field-error" role="alert">
                {errors.order_date}
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
                <th style={{ width: '22%' }}>Product ID (UUID) *</th>
                <th style={{ width: '25%' }}>Product Name</th>
                <th style={{ width: '12%', textAlign: 'right' }}>Qty *</th>
                <th style={{ width: '14%', textAlign: 'right' }}>Unit Price *</th>
                <th style={{ width: '12%', textAlign: 'right' }}>Tax Rate (%)</th>
                <th style={{ width: '15%', textAlign: 'right' }}>Line Total</th>
                <th style={{ width: '8%', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const lineErr = errors.lines?.[idx];
                const calc = lineCalculations[idx];
                const formattedLineTotal = parseFloat(calc?.line_total || '0').toFixed(2);

                return (
                  <tr key={line.id}>
                    <td>
                      <input
                        type="text"
                        className={`cs-input cs-input-sm ${lineErr?.product_id ? 'cs-input-error' : ''}`}
                        placeholder="e.g. 11111111-0001-4000-8000-000000000001"
                        value={line.product_id}
                        onChange={(e) => handleLineChange(idx, 'product_id', e.target.value)}
                        disabled={isLoading}
                        aria-label={`Line ${idx + 1} Product ID`}
                        required
                      />
                      {lineErr?.product_id && (
                        <span className="cs-field-error-xs" role="alert">
                          {lineErr.product_id}
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
                        onChange={(e) => handleLineChange(idx, 'quantity', e.target.value)}
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
                        className={`cs-input cs-input-sm cs-text-right ${lineErr?.price ? 'cs-input-error' : ''}`}
                        placeholder="0.0000"
                        value={line.price}
                        onChange={(e) => handleLineChange(idx, 'price', e.target.value)}
                        disabled={isLoading}
                        aria-label={`Line ${idx + 1} Unit Price`}
                        required
                      />
                      {lineErr?.price && (
                        <span className="cs-field-error-xs" role="alert">
                          {lineErr.price}
                        </span>
                      )}
                    </td>
                    <td>
                      <input
                        type="text"
                        className={`cs-input cs-input-sm cs-text-right ${lineErr?.tax_rate ? 'cs-input-error' : ''}`}
                        placeholder="10.0000"
                        value={line.tax_rate}
                        onChange={(e) => handleLineChange(idx, 'tax_rate', e.target.value)}
                        disabled={isLoading}
                        aria-label={`Line ${idx + 1} Tax Rate`}
                      />
                      {lineErr?.tax_rate && (
                        <span className="cs-field-error-xs" role="alert">
                          {lineErr.tax_rate}
                        </span>
                      )}
                    </td>
                    <td className="cs-mono cs-text-right" style={{ fontWeight: 600 }}>
                      ${formattedLineTotal}
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
            <span className="cs-mono">${orderTotals.subtotal} {currency}</span>
          </div>
          <div className="cs-totals-row">
            <span>Tax (BR-ERP3-02 preview):</span>
            <span className="cs-mono">${orderTotals.taxTotal} {currency}</span>
          </div>
          <div className="cs-totals-row cs-totals-final">
            <strong>Order Total:</strong>
            <strong className="cs-mono">${orderTotals.total} {currency}</strong>
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
