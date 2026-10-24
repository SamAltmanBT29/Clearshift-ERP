import React, { useState, useMemo } from 'react';
import type { CreatePurchaseOrderRequest, CreatePurchaseOrderLineRequest } from '@clearshift/contracts';
import { calculateLineTotal, calculateOrderTotal, CreatePurchaseOrderRequestSchema } from '@clearshift/contracts';

export interface PoLineItem {
  product_id: string;
  quantity: string;
  price: string;
}

export interface PurchaseOrderFormProps {
  initialVendorId?: string;
  onSubmit: (data: CreatePurchaseOrderRequest) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export interface PoHeaderErrors {
  vendor_id?: string;
  po_number?: string;
  order_date?: string;
  currency?: string;
  lines?: string;
}

export interface PoLineErrors {
  product_id?: string;
  quantity?: string;
  price?: string;
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const PurchaseOrderForm: React.FC<PurchaseOrderFormProps> = ({
  initialVendorId = '',
  onSubmit,
  onCancel,
  isLoading = false,
}) => {
  const [poNumber, setPoNumber] = useState('');
  const [vendorId, setVendorId] = useState(initialVendorId);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState('USD');
  const [lines, setLines] = useState<PoLineItem[]>([
    { product_id: '', quantity: '1.00', price: '0.00' },
  ]);

  const [fieldErrors, setFieldErrors] = useState<PoHeaderErrors>({});
  const [lineErrors, setLineErrors] = useState<PoLineErrors[]>([{}]);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Live calculated line totals & overall order total
  const computedLines = useMemo(() => {
    return lines.map((line) => {
      const q = line.quantity.trim();
      const p = line.price.trim();
      if (!q || !p || isNaN(Number(q)) || isNaN(Number(p)) || Number(q) <= 0 || Number(p) < 0) {
        return { ...line, line_total: '0.00' };
      }
      try {
        const total = calculateLineTotal(q, p);
        return { ...line, line_total: total };
      } catch {
        return { ...line, line_total: '0.00' };
      }
    });
  }, [lines]);

  const computedOrderTotal = useMemo(() => {
    try {
      return calculateOrderTotal(computedLines);
    } catch {
      return '0.00';
    }
  }, [computedLines]);

  const handleAddLine = () => {
    setLines((prev) => [...prev, { product_id: '', quantity: '1.00', price: '0.00' }]);
    setLineErrors((prev) => [...prev, {}]);
  };

  const handleRemoveLine = (idx: number) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, i) => i !== idx));
    setLineErrors((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleLineChange = (idx: number, field: keyof PoLineItem, value: string) => {
    setLines((prev) => {
      const copy = [...prev];
      const current = copy[idx];
      if (current) {
        copy[idx] = { ...current, [field]: value };
      }
      return copy;
    });

    // Clear field-level error on change
    setLineErrors((prev) => {
      const copy = [...prev];
      const current = copy[idx];
      if (current && current[field]) {
        const lineErr = { ...current };
        delete lineErr[field];
        copy[idx] = lineErr;
      }
      return copy;
    });
  };

  const validate = (): boolean => {
    const errors: PoHeaderErrors = {};
    const lErrors: PoLineErrors[] = [];
    let hasLineErr = false;

    if (!vendorId || !UUID_REGEX.test(vendorId.trim())) {
      errors.vendor_id = 'Valid Vendor UUID is required';
    }
    if (!orderDate || !/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) {
      errors.order_date = 'Order date must be in YYYY-MM-DD format';
    }
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      errors.currency = 'Currency must be a 3-letter ISO code';
    }

    if (lines.length === 0) {
      errors.lines = 'At least one line item is required';
    }

    lines.forEach((l) => {
      const err: PoLineErrors = {};
      if (!l.product_id || !UUID_REGEX.test(l.product_id.trim())) {
        err.product_id = 'Product UUID is required (ERP-1)';
      }
      if (!l.quantity || isNaN(Number(l.quantity)) || Number(l.quantity) <= 0) {
        err.quantity = 'Quantity must be > 0';
      }
      if (l.price === '' || isNaN(Number(l.price)) || Number(l.price) < 0) {
        err.price = 'Price must be >= 0';
      }
      if (Object.keys(err).length > 0) {
        hasLineErr = true;
      }
      lErrors.push(err);
    });

    setFieldErrors(errors);
    setLineErrors(lErrors);

    return Object.keys(errors).length === 0 && !hasLineErr;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);

    if (!validate()) {
      return;
    }

    const payload: CreatePurchaseOrderRequest = {
      vendor_id: vendorId.trim(),
      order_date: orderDate,
      currency: currency.toUpperCase(),
      lines: lines.map((l) => ({
        product_id: l.product_id.trim(),
        quantity: l.quantity.trim(),
        price: l.price.trim(),
      })),
    };

    if (poNumber && poNumber.trim() !== '') {
      payload.po_number = poNumber.trim();
    }

    // Zod schema validation check
    const parsed = CreatePurchaseOrderRequestSchema.safeParse(payload);
    if (!parsed.success) {
      setGeneralError(parsed.error.issues[0]?.message || 'Invalid purchase order submission.');
      return;
    }

    try {
      await onSubmit(payload);
    } catch (err: any) {
      setGeneralError(err?.message || 'Failed to create purchase order. Server rejected submission.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="cs-form-card" noValidate aria-label="Purchase order form">
      {generalError && (
        <div className="cs-error-box" role="alert" style={{ marginBottom: '16px' }}>
          <p className="cs-error-desc" style={{ margin: 0 }}>
            {generalError}
          </p>
        </div>
      )}

      {/* PO Header Details */}
      <h3 className="cs-section-subtitle" style={{ marginTop: 0, marginBottom: '12px' }}>
        Order Header
      </h3>

      <div className="cs-form-grid" style={{ marginBottom: '24px' }}>
        {/* Vendor UUID */}
        <div className="cs-form-field cs-col-span-2">
          <label htmlFor="po-vendor-id-input" className="cs-form-label">
            Vendor UUID <span className="cs-required">*</span>
          </label>
          <input
            id="po-vendor-id-input"
            type="text"
            className={`cs-input cs-cell-mono ${fieldErrors.vendor_id ? 'cs-input-error' : ''}`}
            placeholder="00000000-0000-0000-0000-000000000001"
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              if (fieldErrors.vendor_id) {
                setFieldErrors((prev) => {
                  const updated = { ...prev };
                  delete updated.vendor_id;
                  return updated;
                });
              }
            }}
            disabled={isLoading}
            aria-invalid={!!fieldErrors.vendor_id}
            aria-describedby={fieldErrors.vendor_id ? 'po-vendor-id-error' : undefined}
          />
          {fieldErrors.vendor_id && (
            <span id="po-vendor-id-error" className="cs-field-error" role="alert">
              {fieldErrors.vendor_id}
            </span>
          )}
          <span className="cs-field-helper">References existing vendor record in ERP-2.</span>
        </div>

        {/* PO Number */}
        <div className="cs-form-field">
          <label htmlFor="po-number-input" className="cs-form-label">
            PO Number (Optional)
          </label>
          <input
            id="po-number-input"
            type="text"
            className="cs-input cs-cell-mono"
            placeholder="Leave blank for auto-generated"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            disabled={isLoading}
          />
        </div>

        {/* Order Date */}
        <div className="cs-form-field">
          <label htmlFor="po-order-date-input" className="cs-form-label">
            Order Date <span className="cs-required">*</span>
          </label>
          <input
            id="po-order-date-input"
            type="date"
            className={`cs-input ${fieldErrors.order_date ? 'cs-input-error' : ''}`}
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            disabled={isLoading}
            aria-invalid={!!fieldErrors.order_date}
            aria-describedby={fieldErrors.order_date ? 'po-order-date-error' : undefined}
          />
          {fieldErrors.order_date && (
            <span id="po-order-date-error" className="cs-field-error" role="alert">
              {fieldErrors.order_date}
            </span>
          )}
        </div>

        {/* Currency */}
        <div className="cs-form-field">
          <label htmlFor="po-currency-input" className="cs-form-label">
            Currency
          </label>
          <input
            id="po-currency-input"
            type="text"
            maxLength={3}
            className="cs-input cs-cell-mono"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            disabled={isLoading}
          />
        </div>
      </div>

      {/* Line Items Table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 className="cs-section-subtitle" style={{ margin: 0 }}>
          Purchase Order Lines <span className="cs-required">*</span>
        </h3>
        <button
          type="button"
          className="cs-btn-secondary"
          onClick={handleAddLine}
          disabled={isLoading}
          aria-label="Add item line"
        >
          + Add Line
        </button>
      </div>

      {fieldErrors.lines && (
        <span className="cs-field-error" role="alert" style={{ display: 'block', marginBottom: '12px' }}>
          {fieldErrors.lines}
        </span>
      )}

      <div className="cs-table-card" style={{ marginBottom: '16px' }}>
        <table className="cs-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: '45%' }}>
                ERP-1 Product UUID <span className="cs-required">*</span>
              </th>
              <th scope="col" style={{ width: '18%' }}>
                Quantity <span className="cs-required">*</span>
              </th>
              <th scope="col" style={{ width: '18%' }}>
                Unit Price <span className="cs-required">*</span>
              </th>
              <th scope="col" className="cs-cell-number" style={{ width: '14%' }}>
                Line Total
              </th>
              <th scope="col" style={{ width: '5%' }}>
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx}>
                <td>
                  <input
                    type="text"
                    className={`cs-input cs-cell-mono ${lineErrors[idx]?.product_id ? 'cs-input-error' : ''}`}
                    placeholder="Product UUID from ERP-1"
                    aria-label={`Product UUID for line ${idx + 1}`}
                    value={line.product_id}
                    onChange={(e) => handleLineChange(idx, 'product_id', e.target.value)}
                    disabled={isLoading}
                  />
                  {lineErrors[idx]?.product_id && (
                    <span className="cs-field-error" role="alert">
                      {lineErrors[idx].product_id}
                    </span>
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className={`cs-input cs-cell-mono ${lineErrors[idx]?.quantity ? 'cs-input-error' : ''}`}
                    placeholder="1.00"
                    aria-label={`Quantity for line ${idx + 1}`}
                    value={line.quantity}
                    onChange={(e) => handleLineChange(idx, 'quantity', e.target.value)}
                    disabled={isLoading}
                  />
                  {lineErrors[idx]?.quantity && (
                    <span className="cs-field-error" role="alert">
                      {lineErrors[idx].quantity}
                    </span>
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={`cs-input cs-cell-mono ${lineErrors[idx]?.price ? 'cs-input-error' : ''}`}
                    placeholder="0.00"
                    aria-label={`Unit price for line ${idx + 1}`}
                    value={line.price}
                    onChange={(e) => handleLineChange(idx, 'price', e.target.value)}
                    disabled={isLoading}
                  />
                  {lineErrors[idx]?.price && (
                    <span className="cs-field-error" role="alert">
                      {lineErrors[idx].price}
                    </span>
                  )}
                </td>
                <td className="cs-cell-number" style={{ verticalAlign: 'middle' }}>
                  <strong className="cs-cell-mono">
                    {Number(computedLines[idx]?.line_total || 0).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </td>
                <td style={{ verticalAlign: 'middle', textAlign: 'center' }}>
                  <button
                    type="button"
                    className="cs-btn-secondary"
                    style={{ padding: '0 8px', height: '32px' }}
                    onClick={() => handleRemoveLine(idx)}
                    disabled={isLoading || lines.length <= 1}
                    aria-label={`Remove line ${idx + 1}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Order Total Read-Only Summary */}
      <div className="cs-summary-card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
              Server-Calculated Order Total (Read-Only):
            </span>
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {currency}{' '}
            {Number(computedOrderTotal).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
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
          aria-label="Create Purchase Order"
        >
          {isLoading ? 'Creating Order...' : 'Create Purchase Order'}
        </button>
      </footer>
    </form>
  );
};
