/**
 * ERP-1 Products & Inventory — Product Creation Modal
 *
 * Provides an accessible modal dialog containing the product creation form,
 * client-side field validation, double-submission prevention, and server
 * validation error mapping.
 *
 * Conforms to Acceptance Criteria for Issue #116 (ERP1-20):
 * - Validates required fields, email format, phone numbers, and decimal ranges.
 * - Client submission button disables during inflight request to prevent double-submit.
 * - Server validation errors (400) map directly to corresponding input fields with error text.
 * - Successful submission closes modal, updates table cache, and shows confirmation toast.
 *
 * @module erp1/web/components/ProductCreateModal
 */

import React, { useEffect } from 'react';
import type { Category, Product, CreateProductInput } from '@clearshift/contracts';
import { Dialog, FormField, Alert } from '@cs/ui';
import { useProductForm, type ProductFormValues } from '../hooks/useProductForm.js';
import { createProduct } from '../api/erp-1.js';

export interface ProductCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories?: readonly Category[] | undefined;
  onProductCreated?: ((product: Product) => void) | undefined;
  initialValues?: Partial<ProductFormValues> | undefined;
  /** Optional custom submit implementation for mocking/testing */
  onSubmitProduct?: ((input: CreateProductInput) => Promise<Product>) | undefined;
}

export const ProductCreateModal: React.FC<ProductCreateModalProps> = ({
  isOpen,
  onClose,
  categories = [],
  onProductCreated,
  initialValues,
  onSubmitProduct = createProduct,
}) => {
  const {
    values,
    errors,
    isSubmitting,
    submitError,
    handleChange,
    handleSubmit,
    reset,
  } = useProductForm({
    initialValues,
    onSubmit: onSubmitProduct,
    onSuccess: (product) => {
      reset();
      if (onProductCreated) {
        onProductCreated(product);
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

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Product"
      description="Add a new catalog product with pricing, unit of measure, and inventory tracking."
      className="cs-erp1-create-modal"
    >
      <form
        noValidate
        onSubmit={handleSubmit}
        className="cs-erp1-create-form"
        data-testid="product-create-form"
      >
        {/* Server Level Error Alert */}
        {submitError && (
          <div className="cs-erp1-form-alert mb-4">
            <Alert
              variant="error"
              title={
                submitError.status === 400
                  ? 'Please correct the validation errors below'
                  : 'Product Creation Failed'
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

        {/* 1. Primary Identifiers: Name & SKU */}
        <div className="cs-erp1-form-row">
          <FormField
            id="product-name"
            label="Product Name"
            required
            {...(errors.name ? { error: errors.name } : {})}
            helperText="Clear descriptive title of the catalog item."
          >
            <input
              type="text"
              name="name"
              value={values.name}
              placeholder="e.g. Industrial Steel Hex Bolt M8"
              disabled={isSubmitting}
              onChange={(e) => handleChange('name', e.target.value)}
            />
          </FormField>

          <FormField
            id="product-sku"
            label="SKU (Stock Keeping Unit)"
            required
            {...(errors.sku ? { error: errors.sku } : {})}
            helperText="Unique identifier; normalized automatically to uppercase."
          >
            <input
              type="text"
              name="sku"
              value={values.sku}
              placeholder="e.g. BLT-HEX-001"
              disabled={isSubmitting}
              onChange={(e) => handleChange('sku', e.target.value)}
            />
          </FormField>
        </div>

        {/* 2. Categorization & Unit of Measure */}
        <div className="cs-erp1-form-row">
          <FormField
            id="product-category"
            label="Category"
            {...(errors.categoryId ? { error: errors.categoryId } : {})}
            helperText="Catalog categorization (one-level hierarchy)."
          >
            <select
              name="categoryId"
              value={values.categoryId}
              disabled={isSubmitting}
              onChange={(e) => handleChange('categoryId', e.target.value)}
            >
              <option value="">Select a category (optional)</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name} ({cat.code})
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="product-uom"
            label="Unit of Measure"
            required
            {...(errors.unitOfMeasure ? { error: errors.unitOfMeasure } : {})}
            helperText="Standard unit for stock counting (FR-ERP1-04)."
          >
            <select
              name="unitOfMeasure"
              value={values.unitOfMeasure}
              disabled={isSubmitting}
              onChange={(e) => handleChange('unitOfMeasure', e.target.value)}
            >
              <option value="pcs">Pieces (pcs)</option>
              <option value="kg">Kilograms (kg)</option>
              <option value="g">Grams (g)</option>
              <option value="litre">Litres (litre)</option>
              <option value="metre">Metres (metre)</option>
              <option value="box">Boxes (box)</option>
            </select>
          </FormField>
        </div>

        {/* 3. Pricing & Currency */}
        <div className="cs-erp1-form-row">
          <FormField
            id="product-price"
            label="Unit Price"
            required
            {...(errors.price ? { error: errors.price } : {})}
            helperText="Base sales price (non-negative, up to 4 decimal places)."
          >
            <input
              type="text"
              inputMode="decimal"
              name="price"
              value={values.price}
              placeholder="0.0000"
              disabled={isSubmitting}
              onChange={(e) => handleChange('price', e.target.value)}
            />
          </FormField>

          <FormField
            id="product-currency"
            label="Currency"
            required
            {...(errors.currency ? { error: errors.currency } : {})}
            helperText="Explicit ISO 4217 uppercase currency code."
          >
            <input
              type="text"
              name="currency"
              value={values.currency}
              maxLength={3}
              placeholder="USD"
              disabled={isSubmitting}
              onChange={(e) => handleChange('currency', e.target.value.toUpperCase())}
            />
          </FormField>
        </div>

        {/* 4. Tax Rate */}
        <div className="cs-erp1-form-row">
          <FormField
            id="product-tax-rate"
            label="Tax Rate (%)"
            {...(errors.taxRate ? { error: errors.taxRate } : {})}
            helperText="Percentage between 0.00% and 100.00%."
          >
            <input
              type="text"
              inputMode="decimal"
              name="taxRate"
              value={values.taxRate}
              placeholder="0.00"
              disabled={isSubmitting}
              onChange={(e) => handleChange('taxRate', e.target.value)}
            />
          </FormField>
        </div>

        {/* 5. Contact & Notification Information (Email format & Phone validation) */}
        <div className="cs-erp1-form-row">
          <FormField
            id="product-notification-email"
            label="Notification Email"
            {...(errors.notificationEmail ? { error: errors.notificationEmail } : {})}
            helperText="Contact email for inventory and reorder alerts."
          >
            <input
              type="email"
              name="notificationEmail"
              value={values.notificationEmail}
              placeholder="supplier@example.com"
              disabled={isSubmitting}
              onChange={(e) => handleChange('notificationEmail', e.target.value)}
            />
          </FormField>

          <FormField
            id="product-contact-phone"
            label="Contact Phone"
            {...(errors.contactPhone ? { error: errors.contactPhone } : {})}
            helperText="Supplier or support phone number (min 7 digits)."
          >
            <input
              type="tel"
              name="contactPhone"
              value={values.contactPhone}
              placeholder="+1-555-019-2834"
              disabled={isSubmitting}
              onChange={(e) => handleChange('contactPhone', e.target.value)}
            />
          </FormField>
        </div>

        {/* Modal Form Actions */}
        <div className="cs-erp1-modal-actions mt-6 pt-4 border-t border-[var(--cs-border)] flex items-center justify-end gap-3">
          <button
            type="button"
            className="cs-erp1-btn cs-erp1-btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="cs-erp1-btn cs-erp1-btn-primary"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Create Product'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default ProductCreateModal;
