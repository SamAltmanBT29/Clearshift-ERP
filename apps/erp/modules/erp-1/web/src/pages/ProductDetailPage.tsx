/**
 * ERP-1 Products & Inventory — Product Detail & Edit Screen
 *
 * Full lifecycle detail/edit workflow:
 * 1. Displays all primary attributes, created_at, updated_at, and Golden ID (AC 1).
 * 2. Inline edit mode and edit drawer form for allowlisted fields with permission checking (AC 2).
 * 3. Linked entity sub-tables for inventory stock, ERP-2 purchasing, and ERP-3 sales (AC 3).
 * 4. Concurrent modification conflict (409) banner prompting user to refresh and re-apply (AC 4).
 *
 * @module erp1/web/pages/ProductDetailPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  Product,
  Category,
  UnitOfMeasure,
  ProductLinkedRecords,
} from '@clearshift/contracts';
import { PageTitle, Alert, StatusBadge, FormField } from '@cs/ui';
import {
  fetchProductById,
  fetchCategories,
  fetchProductLinkedRecords,
  Erp1ApiError,
} from '../api/erp-1.js';
import { ProductAuditPanel } from '../components/ProductAuditPanel.js';
import { ProductLinkedRecordsTable } from '../components/ProductLinkedRecordsTable.js';
import { ProductEditDrawer } from '../components/ProductEditDrawer.js';
import {
  useProductEditForm,
  type ProductEditFormValues,
} from '../hooks/useProductEditForm.js';
import { ProductsLoadingSkeleton, ErrorProductsView, AccessDeniedProductsView } from '../components/StateViews.js';

export interface ProductDetailPageProps {
  productId: string;
  initialProduct?: Product | null;
  categories?: readonly Category[];
  userPermissions?: readonly string[];
  onBack?: () => void;
  onNavigateModule?: (module: 'erp2' | 'erp3' | 'erp1', recordId: string) => void;
  onProductUpdated?: (updated: Product) => void;
}

export function resolveStockStatus(quantityStr?: string): {
  label: string;
  variant: 'success' | 'warning' | 'error' | 'neutral';
} {
  if (quantityStr === undefined || quantityStr === null) {
    return { label: 'In Stock', variant: 'success' };
  }
  const qty = Number(quantityStr);
  if (isNaN(qty) || qty <= 0) {
    return { label: 'Out of Stock', variant: 'error' };
  }
  if (qty <= 10) {
    return { label: `Low (${qty})`, variant: 'warning' };
  }
  return { label: `In Stock (${qty})`, variant: 'success' };
}

export const ProductDetailPage: React.FC<ProductDetailPageProps> = ({
  productId,
  initialProduct = null,
  categories: initialCategories = [],
  userPermissions = ['inventory:read', 'inventory:write'],
  onBack,
  onNavigateModule,
  onProductUpdated,
}) => {
  const [product, setProduct] = useState<Product | null>(initialProduct);
  const [categories, setCategories] = useState<Category[]>(() =>
    initialCategories.length > 0 ? [...initialCategories] : []
  );
  const [linkedRecords, setLinkedRecords] = useState<ProductLinkedRecords | null>(null);

  const [isLoading, setIsLoading] = useState(!initialProduct);
  const [isLinkedLoading, setIsLinkedLoading] = useState(false);
  const [error, setError] = useState<Erp1ApiError | null>(null);

  // Workflow modes
  const [isInlineEditMode, setIsInlineEditMode] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Permission calculation
  const canEdit =
    userPermissions.includes('inventory:write') ||
    userPermissions.includes('products:write') ||
    userPermissions.includes('admin');

  // Load Categories
  useEffect(() => {
    if (initialCategories && initialCategories.length > 0) return;
    let isMounted = true;
    fetchCategories({ page: 1, pageSize: 100 })
      .then((res) => {
        if (isMounted) setCategories(res.items);
      })
      .catch(() => {
        // Fallback silently if categories fail to load
      });
    return () => {
      isMounted = false;
    };
  }, [initialCategories]);

  // Fetch product and linked records
  const loadProductData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const prod = await fetchProductById(productId);
      setProduct(prod);
    } catch (err: any) {
      if (err instanceof Erp1ApiError) {
        setError(err);
      } else {
        setError(new Erp1ApiError(0, 'UNKNOWN', err?.message || 'Failed to load product'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [productId]);

  const loadLinkedRecords = useCallback(async () => {
    setIsLinkedLoading(true);
    try {
      const linked = await fetchProductLinkedRecords(productId);
      setLinkedRecords(linked);
    } catch {
      // If linked records endpoint fails or has no rows, provide synthetic empty structure
      setLinkedRecords({
        productId,
        stockLevels: [],
        purchaseOrders: [],
        salesOrders: [],
      });
    } finally {
      setIsLinkedLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    if (!initialProduct) {
      loadProductData();
    }
    loadLinkedRecords();
  }, [initialProduct, loadProductData, loadLinkedRecords]);

  // Hook for inline editing
  const {
    values,
    errors,
    isSubmitting,
    isConflict,
    conflictMessage,
    serverError,
    handleChange,
    handleSubmit: handleInlineSubmit,
    resetForm,
    clearConflict,
  } = useProductEditForm({
    product: product || {
      id: productId,
      name: '',
      sku: '',
      normalizedSku: '',
      unitOfMeasure: 'pcs',
      price: '0.0000',
      currency: 'USD',
      taxRate: '0.00',
      createdAt: '',
      updatedAt: '',
    },
    canEdit,
    onSuccess: (updated) => {
      setProduct(updated);
      setIsInlineEditMode(false);
      setToastMessage(`Product "${updated.name}" updated successfully.`);
      if (onProductUpdated) {
        onProductUpdated(updated);
      }
    },
  });

  const handleRefresh = async () => {
    clearConflict();
    setError(null);
    await loadProductData();
    await loadLinkedRecords();
    setToastMessage('Record refreshed to latest version from server.');
  };

  const categoryMap = React.useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach((cat) => map.set(cat.id, cat));
    return map;
  }, [categories]);

  // Loading state
  if (isLoading) {
    return (
      <div className="cs-erp1-root" aria-busy="true">
        <div style={{ marginBottom: '16px' }}>
          <button
            type="button"
            className="cs-erp1-btn cs-erp1-btn-secondary"
            onClick={onBack}
            aria-label="Back to products list"
          >
            ← Back to Products
          </button>
        </div>
        <ProductsLoadingSkeleton />
      </div>
    );
  }

  // Error state
  if (error || !product) {
    if (error?.isPermissionDenied) {
      return (
        <div className="cs-erp1-root">
          <div style={{ marginBottom: '16px' }}>
            <button type="button" className="cs-erp1-btn cs-erp1-btn-secondary" onClick={onBack}>
              ← Back to Products
            </button>
          </div>
          <AccessDeniedProductsView message={error.message} requiredCapability="inventory:read" />
        </div>
      );
    }

    return (
      <div className="cs-erp1-root">
        <div style={{ marginBottom: '16px' }}>
          <button type="button" className="cs-erp1-btn cs-erp1-btn-secondary" onClick={onBack}>
            ← Back to Products
          </button>
        </div>
        <ErrorProductsView
          error={error || new Error('Product not found')}
          message={error?.message || 'Product record could not be found.'}
          onRetry={loadProductData}
        />
      </div>
    );
  }

  const currentCategory = product.categoryId ? categoryMap.get(product.categoryId) : null;
  const stockInfo = resolveStockStatus(
    linkedRecords?.stockLevels?.[0]?.quantity
  );

  return (
    <div className="cs-erp1-root cs-erp1-detail-page" data-testid="product-detail-page">
      {/* 1. Back Navigation & Toast Banner */}
      <div className="cs-erp1-detail-top-nav">
        <button
          type="button"
          className="cs-erp1-btn cs-erp1-btn-secondary"
          onClick={onBack}
          aria-label="Back to products list"
        >
          ← Back to Products List
        </button>

        {toastMessage && (
          <div
            className="cs-erp1-toast-container"
            role="status"
            aria-live="polite"
            data-testid="detail-toast-alert"
          >
            <Alert
              variant="success"
              title="Success"
              onDismiss={() => setToastMessage(null)}
            >
              {toastMessage}
            </Alert>
          </div>
        )}
      </div>

      {/* 2. Concurrent Conflict Alert Banner (AC 4) */}
      {isConflict && (
        <div
          className="cs-erp1-conflict-banner"
          role="alert"
          data-testid="concurrent-conflict-banner"
          style={{ marginBottom: '20px' }}
        >
          <Alert variant="error" title="Concurrent Modification Conflict (HTTP 409)">
            <p>
              {conflictMessage ||
                'This record was updated by another operator or background job while you were editing. To prevent data corruption, your changes were not applied.'}
            </p>
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="cs-erp1-btn cs-erp1-btn-primary"
                onClick={handleRefresh}
                data-testid="conflict-refresh-btn"
              >
                🔄 Refresh Record and Re-apply Changes
              </button>
              <button
                type="button"
                className="cs-erp1-btn cs-erp1-btn-secondary"
                onClick={clearConflict}
              >
                Dismiss
              </button>
            </div>
          </Alert>
        </div>
      )}

      {/* Top Server Error */}
      {serverError && !isConflict && (
        <div style={{ marginBottom: '20px' }} role="alert">
          <Alert variant="error" title="Action Failed">
            {serverError}
          </Alert>
        </div>
      )}

      {/* 3. Detail Header */}
      <header className="cs-erp1-detail-header">
        <div className="cs-erp1-detail-title-block">
          <div className="cs-erp1-detail-badges">
            <code className="cs-erp1-sku-pill" title="SKU" data-testid="detail-sku">
              {product.sku}
            </code>
            {currentCategory && (
              <span className="cs-erp1-category-badge" title={currentCategory.name}>
                {currentCategory.name}
              </span>
            )}
            <StatusBadge label={stockInfo.label} variant={stockInfo.variant} />
          </div>
          <PageTitle
            title={product.name}
            subtitle={`Internal UUID: ${product.id} • SKU: ${product.sku} • Currency: ${product.currency}`}
          />
        </div>

        {/* Action Controls */}
        <div className="cs-erp1-detail-actions">
          <button
            type="button"
            className="cs-erp1-btn cs-erp1-btn-secondary"
            onClick={handleRefresh}
            title="Reload latest record from server"
            aria-label="Refresh record"
            data-testid="detail-refresh-btn"
          >
            🔄 Refresh
          </button>

          {!isInlineEditMode ? (
            <>
              <button
                type="button"
                className="cs-erp1-btn cs-erp1-btn-primary"
                onClick={() => {
                  if (!canEdit) {
                    setToastMessage('Access Denied: You do not have write permissions for products.');
                    return;
                  }
                  setIsInlineEditMode(true);
                }}
                disabled={!canEdit}
                aria-label="Enable inline editing"
                data-testid="enable-inline-edit-btn"
              >
                ✏️ Inline Edit
              </button>
              <button
                type="button"
                className="cs-erp1-btn cs-erp1-btn-secondary"
                onClick={() => {
                  if (!canEdit) {
                    setToastMessage('Access Denied: You do not have write permissions for products.');
                    return;
                  }
                  setIsDrawerOpen(true);
                }}
                disabled={!canEdit}
                aria-label="Open edit drawer"
                data-testid="open-edit-drawer-btn"
              >
                📑 Edit Drawer
              </button>
            </>
          ) : (
            <div className="cs-erp1-inline-actions">
              <button
                type="button"
                className="cs-erp1-btn cs-erp1-btn-secondary"
                onClick={() => {
                  resetForm();
                  setIsInlineEditMode(false);
                }}
                disabled={isSubmitting}
                data-testid="inline-cancel-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                className="cs-erp1-btn cs-erp1-btn-primary"
                onClick={(e) => handleInlineSubmit(e)}
                disabled={isSubmitting || !canEdit}
                aria-busy={isSubmitting}
                data-testid="inline-save-btn"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 4. Primary Attributes View & Inline Edit Form (AC 1 & AC 2) */}
      <section
        className="cs-erp1-card cs-erp1-attributes-card"
        aria-label="Product primary attributes"
      >
        <header className="cs-erp1-card-header">
          <h3 className="cs-erp1-card-title">
            {isInlineEditMode ? 'Edit Allowlisted Attributes' : 'Primary Attributes'}
          </h3>
          <span className="cs-erp1-card-subtitle">
            {isInlineEditMode
              ? 'Update mutable fields. Master SKU remains immutable.'
              : 'Core product master data and pricing specifications'}
          </span>
        </header>

        {isInlineEditMode ? (
          /* Inline Edit Mode */
          <form
            onSubmit={handleInlineSubmit}
            noValidate
            className="cs-erp1-inline-form"
            data-testid="inline-edit-form"
          >
            <div className="cs-erp1-form-row">
              <div className="cs-erp1-field-group">
                <label className="cs-erp1-label" htmlFor="inline-sku-readonly">
                  SKU (Immutable Master Key) <span className="cs-erp1-text-muted">🔒</span>
                </label>
                <input
                  id="inline-sku-readonly"
                  type="text"
                  className="cs-erp1-input cs-erp1-mono"
                  value={product.sku}
                  disabled
                  readOnly
                  title="SKU cannot be altered after creation (BR-ERP1-01)."
                />
              </div>

              <div className="cs-erp1-field-group">
                <label className="cs-erp1-label" htmlFor="inline-category-select">
                  Category
                </label>
                <select
                  id="inline-category-select"
                  className="cs-erp1-select"
                  value={values.categoryId}
                  onChange={(e) => handleChange('categoryId', e.target.value)}
                  disabled={isSubmitting}
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

            <div style={{ marginBottom: '16px' }}>
              <FormField
                label="Product Name"
                required
                id="inline-name"
                {...(errors.name ? { error: errors.name } : {})}
              >
                <input
                  id="inline-name"
                  type="text"
                  className="cs-erp1-input"
                  value={values.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(errors.name)}
                />
              </FormField>
            </div>

            <div className="cs-erp1-form-row">
              <div className="cs-erp1-field-group">
                <FormField
                  label="Unit of Measure"
                  required
                  id="inline-unit"
                  {...(errors.unitOfMeasure ? { error: errors.unitOfMeasure } : {})}
                >
                  <select
                    id="inline-unit"
                    className="cs-erp1-select"
                    value={values.unitOfMeasure}
                    onChange={(e) => handleChange('unitOfMeasure', e.target.value as UnitOfMeasure)}
                    disabled={isSubmitting}
                  >
                    <option value="pcs">pcs</option>
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="litre">litre</option>
                    <option value="metre">metre</option>
                    <option value="box">box</option>
                  </select>
                </FormField>
              </div>

              <div className="cs-erp1-field-group">
                <FormField
                  label="Currency (ISO 4217)"
                  required
                  id="inline-currency"
                  {...(errors.currency ? { error: errors.currency } : {})}
                >
                  <input
                    id="inline-currency"
                    type="text"
                    maxLength={3}
                    className="cs-erp1-input cs-erp1-mono"
                    value={values.currency}
                    onChange={(e) => handleChange('currency', e.target.value.toUpperCase())}
                    disabled={isSubmitting}
                  />
                </FormField>
              </div>
            </div>

            <div className="cs-erp1-form-row">
              <div className="cs-erp1-field-group">
                <FormField
                  label="Unit Price"
                  required
                  id="inline-price"
                  {...(errors.price ? { error: errors.price } : {})}
                >
                  <input
                    id="inline-price"
                    type="text"
                    inputMode="decimal"
                    className="cs-erp1-input cs-erp1-mono"
                    value={values.price}
                    onChange={(e) => handleChange('price', e.target.value)}
                    disabled={isSubmitting}
                  />
                </FormField>
              </div>

              <div className="cs-erp1-field-group">
                <FormField
                  label="Tax Rate (%)"
                  id="inline-tax-rate"
                  {...(errors.taxRate ? { error: errors.taxRate } : {})}
                >
                  <input
                    id="inline-tax-rate"
                    type="text"
                    inputMode="decimal"
                    className="cs-erp1-input cs-erp1-mono"
                    value={values.taxRate}
                    onChange={(e) => handleChange('taxRate', e.target.value)}
                    disabled={isSubmitting}
                  />
                </FormField>
              </div>
            </div>

            <div className="cs-erp1-form-row">
              <div className="cs-erp1-field-group">
                <FormField
                  label="Notification Email"
                  id="inline-email"
                  {...(errors.notificationEmail ? { error: errors.notificationEmail } : {})}
                >
                  <input
                    id="inline-email"
                    type="email"
                    className="cs-erp1-input"
                    value={values.notificationEmail}
                    onChange={(e) => handleChange('notificationEmail', e.target.value)}
                    disabled={isSubmitting}
                  />
                </FormField>
              </div>

              <div className="cs-erp1-field-group">
                <FormField
                  label="Contact Phone"
                  id="inline-phone"
                  {...(errors.contactPhone ? { error: errors.contactPhone } : {})}
                >
                  <input
                    id="inline-phone"
                    type="tel"
                    className="cs-erp1-input"
                    value={values.contactPhone}
                    onChange={(e) => handleChange('contactPhone', e.target.value)}
                    disabled={isSubmitting}
                  />
                </FormField>
              </div>
            </div>

            <div className="cs-erp1-inline-footer">
              <button
                type="button"
                className="cs-erp1-btn cs-erp1-btn-secondary"
                onClick={() => {
                  resetForm();
                  setIsInlineEditMode(false);
                }}
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
                {isSubmitting ? 'Saving Changes...' : 'Save Changes'}
              </button>
            </div>
          </form>
        ) : (
          /* View Mode */
          <div className="cs-erp1-attributes-grid" data-testid="attributes-view-grid">
            <div className="cs-erp1-attr-box">
              <span className="cs-erp1-attr-label">Product Name</span>
              <span className="cs-erp1-attr-value" data-testid="attr-name">
                {product.name}
              </span>
            </div>

            <div className="cs-erp1-attr-box">
              <span className="cs-erp1-attr-label">SKU Code</span>
              <span className="cs-erp1-attr-value cs-erp1-mono" data-testid="attr-sku">
                {product.sku}
              </span>
            </div>

            <div className="cs-erp1-attr-box">
              <span className="cs-erp1-attr-label">Category</span>
              <span className="cs-erp1-attr-value" data-testid="attr-category">
                {currentCategory ? (
                  <span className="cs-erp1-category-badge">{currentCategory.name}</span>
                ) : (
                  <span className="cs-erp1-text-muted">— Uncategorized —</span>
                )}
              </span>
            </div>

            <div className="cs-erp1-attr-box">
              <span className="cs-erp1-attr-label">Unit of Measure</span>
              <span className="cs-erp1-attr-value" data-testid="attr-unit">
                <span className="cs-erp1-unit-pill">{product.unitOfMeasure}</span>
              </span>
            </div>

            <div className="cs-erp1-attr-box">
              <span className="cs-erp1-attr-label">Unit Price</span>
              <span className="cs-erp1-attr-value cs-erp1-price-amount" data-testid="attr-price">
                ${Number(product.price).toFixed(2)} {product.currency}
              </span>
            </div>

            <div className="cs-erp1-attr-box">
              <span className="cs-erp1-attr-label">Tax Rate</span>
              <span className="cs-erp1-attr-value cs-erp1-mono" data-testid="attr-tax-rate">
                {Number(product.taxRate || '0').toFixed(2)}%
              </span>
            </div>

            <div className="cs-erp1-attr-box">
              <span className="cs-erp1-attr-label">Notification Email</span>
              <span className="cs-erp1-attr-value" data-testid="attr-email">
                {product.notificationEmail ? (
                  <a href={`mailto:${product.notificationEmail}`} className="cs-erp1-link">
                    {product.notificationEmail}
                  </a>
                ) : (
                  <span className="cs-erp1-text-muted">— None specified —</span>
                )}
              </span>
            </div>

            <div className="cs-erp1-attr-box">
              <span className="cs-erp1-attr-label">Contact Phone</span>
              <span className="cs-erp1-attr-value cs-erp1-mono" data-testid="attr-phone">
                {product.contactPhone ? (
                  <a href={`tel:${product.contactPhone}`} className="cs-erp1-link">
                    {product.contactPhone}
                  </a>
                ) : (
                  <span className="cs-erp1-text-muted">— None specified —</span>
                )}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* 5. Audit Metadata Panel (AC 1) */}
      <ProductAuditPanel product={product} />

      {/* 6. Linked Records Sub-Tables (AC 3) */}
      <ProductLinkedRecordsTable
        linkedRecords={linkedRecords}
        isLoading={isLinkedLoading}
        onNavigateModule={onNavigateModule}
      />

      {/* 7. Edit Drawer Modal Form (AC 2) */}
      <ProductEditDrawer
        isOpen={isDrawerOpen}
        product={product}
        categories={categories}
        canEdit={canEdit}
        onClose={() => setIsDrawerOpen(false)}
        onProductUpdated={(updated) => {
          setProduct(updated);
          setToastMessage(`Product "${updated.name}" updated successfully via drawer.`);
          if (onProductUpdated) {
            onProductUpdated(updated);
          }
        }}
        onRefreshProduct={handleRefresh}
      />
    </div>
  );
};

export default ProductDetailPage;
