/**
 * ERP-1 Products & Inventory — Product Edit Drawer / Modal Form
 *
 * Drawer form allowing updating allowlisted product attributes with
 * client & server validation, permission checking, and 409 concurrent conflict handling.
 *
 * @module erp1/web/components/ProductEditDrawer
 */

import React from 'react';
import type { Product, Category, UnitOfMeasure } from '@clearshift/contracts';
import { Dialog, FormField, Alert } from '@cs/ui';
import { useProductEditForm } from '../hooks/useProductEditForm.js';

export interface ProductEditDrawerProps {
  readonly isOpen: boolean;
  readonly product: Product;
  readonly categories: readonly Category[];
  readonly canEdit?: boolean;
  readonly onClose: () => void;
  readonly onProductUpdated: (updated: Product) => void;
  readonly onRefreshProduct?: () => void;
}

export const ProductEditDrawer: React.FC<ProductEditDrawerProps> = ({
  isOpen,
  product,
  categories,
  canEdit = true,
  onClose,
  onProductUpdated,
  onRefreshProduct,
}) => {
  const {
    values,
    errors,
    isSubmitting,
    isConflict,
    conflictMessage,
    serverError,
    handleChange,
    handleSubmit,
    resetForm,
    clearConflict,
  } = useProductEditForm({
    product,
    canEdit,
    onSuccess: (updated) => {
      onProductUpdated(updated);
      onClose();
    },
  });

  const handleCancel = () => {
    resetForm();
    onClose();
  };

  const handleRefreshAndReapply = () => {
    clearConflict();
    if (onRefreshProduct) {
      onRefreshProduct();
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleCancel}
      title={`Edit Product: ${product.name}`}
      description="Update allowlisted product attributes. Master SKU and creation audit history remain immutable (BR-ERP1-01)."
      className="cs-erp1-edit-modal"
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        className="cs-erp1-edit-form"
        aria-label="Edit product form"
      >
        {/* Permission Denied Alert */}
        {!canEdit && (
          <div style={{ marginBottom: '16px' }}>
            <Alert variant="warning" title="Read-Only Mode">
              You do not have write permissions for products (requires <code>inventory:write</code>). All fields are disabled.
            </Alert>
          </div>
        )}

        {/* Concurrent Conflict Alert (409) */}
        {isConflict && (
          <div style={{ marginBottom: '16px' }} role="alert" data-testid="drawer-conflict-alert">
            <Alert variant="error" title="Concurrent Modification Conflict">
              <p>{conflictMessage || 'This record was modified by another operator or background job while you were editing.'}</p>
              <div style={{ marginTop: '12px' }}>
                <button
                  type="button"
                  className="cs-erp1-btn cs-erp1-btn-primary"
                  onClick={handleRefreshAndReapply}
                  data-testid="drawer-refresh-btn"
                >
                  🔄 Refresh and Re-apply Changes
                </button>
              </div>
            </Alert>
          </div>
        )}

        {/* Top Server Error */}
        {serverError && !isConflict && (
          <div style={{ marginBottom: '16px' }} role="alert">
            <Alert variant="error" title="Update Failed">
              {serverError}
            </Alert>
          </div>
        )}

        {/* Read-Only SKU & System Metadata */}
        <div className="cs-erp1-form-row">
          <div className="cs-erp1-field-group">
            <label className="cs-erp1-label" htmlFor="edit-sku-disabled">
              SKU (Immutable Master Key) <span className="cs-erp1-text-muted">🔒</span>
            </label>
            <input
              id="edit-sku-disabled"
              type="text"
              className="cs-erp1-input cs-erp1-mono"
              value={product.sku}
              disabled
              readOnly
              title="SKU cannot be altered after creation to preserve relational integrity across modules (BR-ERP1-01)."
            />
            <span className="cs-erp1-field-hint">
              Preserves relational integrity with ERP-2 POs, ERP-3 orders, and barcodes.
            </span>
          </div>

          <div className="cs-erp1-field-group">
            <label className="cs-erp1-label" htmlFor="edit-category">
              Category
            </label>
            <select
              id="edit-category"
              className="cs-erp1-select"
              value={values.categoryId}
              onChange={(e) => handleChange('categoryId', e.target.value)}
              disabled={isSubmitting || !canEdit}
            >
              <option value="">-- Uncategorized --</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name} ({cat.code})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Product Name */}
        <div style={{ marginBottom: '16px' }}>
          <FormField
            label="Product Name"
            required
            id="edit-product-name"
            {...(errors.name ? { error: errors.name } : {})}
          >
            <input
              id="edit-product-name"
              type="text"
              className="cs-erp1-input"
              value={values.name}
              onChange={(e) => handleChange('name', e.target.value)}
              disabled={isSubmitting || !canEdit}
              aria-invalid={Boolean(errors.name)}
              placeholder="e.g. Precision Industrial Bearing"
            />
          </FormField>
        </div>

        {/* Unit of Measure & Currency */}
        <div className="cs-erp1-form-row">
          <div className="cs-erp1-field-group">
            <FormField
              label="Unit of Measure"
              required
              id="edit-unit-measure"
              {...(errors.unitOfMeasure ? { error: errors.unitOfMeasure } : {})}
            >
              <select
                id="edit-unit-measure"
                className="cs-erp1-select"
                value={values.unitOfMeasure}
                onChange={(e) => handleChange('unitOfMeasure', e.target.value as UnitOfMeasure)}
                disabled={isSubmitting || !canEdit}
                aria-invalid={Boolean(errors.unitOfMeasure)}
              >
                <option value="pcs">pcs (Pieces)</option>
                <option value="kg">kg (Kilograms)</option>
                <option value="g">g (Grams)</option>
                <option value="litre">litre (Litres)</option>
                <option value="metre">metre (Metres)</option>
                <option value="box">box (Boxes)</option>
              </select>
            </FormField>
          </div>

          <div className="cs-erp1-field-group">
            <FormField
              label="Currency (ISO 4217)"
              required
              id="edit-currency"
              {...(errors.currency ? { error: errors.currency } : {})}
            >
              <input
                id="edit-currency"
                type="text"
                className="cs-erp1-input cs-erp1-mono"
                maxLength={3}
                value={values.currency}
                onChange={(e) => handleChange('currency', e.target.value.toUpperCase())}
                disabled={isSubmitting || !canEdit}
                aria-invalid={Boolean(errors.currency)}
                placeholder="USD"
              />
            </FormField>
          </div>
        </div>

        {/* Price & Tax Rate */}
        <div className="cs-erp1-form-row">
          <div className="cs-erp1-field-group">
            <FormField
              label="Unit Price"
              required
              id="edit-price"
              {...(errors.price ? { error: errors.price } : {})}
            >
              <input
                id="edit-price"
                type="text"
                inputMode="decimal"
                className="cs-erp1-input cs-erp1-mono"
                value={values.price}
                onChange={(e) => handleChange('price', e.target.value)}
                disabled={isSubmitting || !canEdit}
                aria-invalid={Boolean(errors.price)}
                placeholder="0.0000"
              />
            </FormField>
          </div>

          <div className="cs-erp1-field-group">
            <FormField
              label="Tax Rate (%)"
              id="edit-tax-rate"
              {...(errors.taxRate ? { error: errors.taxRate } : {})}
            >
              <input
                id="edit-tax-rate"
                type="text"
                inputMode="decimal"
                className="cs-erp1-input cs-erp1-mono"
                value={values.taxRate}
                onChange={(e) => handleChange('taxRate', e.target.value)}
                disabled={isSubmitting || !canEdit}
                aria-invalid={Boolean(errors.taxRate)}
                placeholder="0.00"
              />
            </FormField>
          </div>
        </div>

        {/* Contact Information */}
        <div className="cs-erp1-form-row">
          <div className="cs-erp1-field-group">
            <FormField
              label="Notification Email"
              id="edit-notification-email"
              {...(errors.notificationEmail ? { error: errors.notificationEmail } : {})}
            >
              <input
                id="edit-notification-email"
                type="email"
                className="cs-erp1-input"
                value={values.notificationEmail}
                onChange={(e) => handleChange('notificationEmail', e.target.value)}
                disabled={isSubmitting || !canEdit}
                aria-invalid={Boolean(errors.notificationEmail)}
                placeholder="alerts@supplier.com"
              />
            </FormField>
          </div>

          <div className="cs-erp1-field-group">
            <FormField
              label="Contact Phone"
              id="edit-contact-phone"
              {...(errors.contactPhone ? { error: errors.contactPhone } : {})}
            >
              <input
                id="edit-contact-phone"
                type="tel"
                className="cs-erp1-input"
                value={values.contactPhone}
                onChange={(e) => handleChange('contactPhone', e.target.value)}
                disabled={isSubmitting || !canEdit}
                aria-invalid={Boolean(errors.contactPhone)}
                placeholder="+1-555-019-2834"
              />
            </FormField>
          </div>
        </div>

        {/* Drawer Actions */}
        <div className="cs-erp1-modal-actions">
          <button
            type="button"
            className="cs-erp1-btn cs-erp1-btn-secondary"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="cs-erp1-btn cs-erp1-btn-primary"
            disabled={isSubmitting || !canEdit}
            aria-busy={isSubmitting}
            data-testid="drawer-save-btn"
          >
            {isSubmitting ? 'Saving Changes...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default ProductEditDrawer;
