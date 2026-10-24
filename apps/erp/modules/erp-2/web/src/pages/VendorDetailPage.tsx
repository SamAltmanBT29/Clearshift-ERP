import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PageTitle } from '@cs/ui';
import type { Vendor } from '@clearshift/contracts';
import { fetchVendorById, updateVendor, ApiError } from '../api/erp-2.js';
import { ErrorState, SkeletonTable } from '../components/StateViews.js';
import { VendorAuditPanel, resolveVendorGoldenId } from '../components/VendorAuditPanel.js';
import { VendorLinkedOrdersTable } from '../components/VendorLinkedOrdersTable.js';
import { VendorEditDrawer } from '../components/VendorEditDrawer.js';
import { getSession } from '../auth/session.js';

export interface VendorDetailPageProps {
  vendorId?: string;
  initialVendor?: Vendor | null;
  userPermissions?: readonly string[];
  onVendorUpdated?: (updated: Vendor) => void;
}

interface InlineFormErrors {
  name?: string;
  tax_number?: string;
  email?: string;
  phone?: string;
  form?: string;
}

export const VendorDetailPage: React.FC<VendorDetailPageProps> = ({
  vendorId: propVendorId,
  initialVendor = null,
  userPermissions,
  onVendorUpdated,
}) => {
  const { vendorId: routeVendorId } = useParams<{ vendorId: string }>();
  const vendorId = propVendorId ?? routeVendorId;

  const [vendor, setVendor] = useState<Vendor | null>(initialVendor);
  const [isLoading, setIsLoading] = useState(!initialVendor);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Workflow states: drawer, inline edit, toast, conflict
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isInlineEdit, setIsInlineEdit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [inlineErrors, setInlineErrors] = useState<InlineFormErrors>({});

  // Inline form state
  const [inlineData, setInlineData] = useState({
    name: '',
    tax_number: '',
    email: '',
    phone: '',
    currency: 'USD',
    address_line: '',
    city: '',
    country: '',
  });

  // Permission calculation
  const canEdit = React.useMemo(() => {
    if (userPermissions && userPermissions.length > 0) {
      return (
        userPermissions.includes('erp:vendors:write') ||
        userPermissions.includes('vendors:write') ||
        userPermissions.includes('admin') ||
        userPermissions.includes('procurement_manager')
      );
    }
    const session = getSession();
    if (!session) return true; // Default permissive in local dev if no JWT
    return (
      session.roles.includes('erp:vendors:write') ||
      session.roles.includes('vendors:write') ||
      session.roles.includes('admin') ||
      session.roles.includes('procurement_manager')
    );
  }, [userPermissions]);

  const loadVendor = useCallback(async (id: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await fetchVendorById(id);
      setVendor(data);
      setInlineData({
        name: data.name,
        tax_number: data.tax_number,
        email: data.email,
        phone: data.phone || '',
        currency: data.currency,
        address_line: data.address_line || '',
        city: data.city || '',
        country: data.country || '',
      });
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load vendor profile from server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialVendor) {
      setVendor(initialVendor);
      setInlineData({
        name: initialVendor.name,
        tax_number: initialVendor.tax_number,
        email: initialVendor.email,
        phone: initialVendor.phone || '',
        currency: initialVendor.currency,
        address_line: initialVendor.address_line || '',
        city: initialVendor.city || '',
        country: initialVendor.country || '',
      });
      setIsLoading(false);
    } else if (vendorId) {
      loadVendor(vendorId);
    } else {
      setLoadError('No vendor ID specified in route.');
      setIsLoading(false);
    }
  }, [vendorId, initialVendor, loadVendor]);

  const handleRefreshRecord = async () => {
    if (!vendorId) return;
    setConflictError(null);
    await loadVendor(vendorId);
    setToastMessage('Record refreshed to latest version from server.');
  };

  const handleSaveInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorId || !vendor) return;

    // Client-side validations
    const errors: InlineFormErrors = {};
    if (!inlineData.name.trim()) errors.name = 'Legal name is required.';
    if (!inlineData.tax_number.trim()) errors.tax_number = 'Tax number is required.';
    if (!inlineData.email.trim()) {
      errors.email = 'Procurement email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inlineData.email)) {
      errors.email = 'Please provide a valid email address.';
    }
    if (inlineData.phone && !/^\+?[0-9\s\-()]{7,25}$/.test(inlineData.phone)) {
      errors.phone = 'Phone number format is invalid.';
    }

    if (Object.keys(errors).length > 0) {
      setInlineErrors(errors);
      return;
    }

    setInlineErrors({});
    setIsSubmitting(true);
    setConflictError(null);

    try {
      const updated = await updateVendor(vendorId, {
        name: inlineData.name.trim(),
        tax_number: inlineData.tax_number.trim(),
        email: inlineData.email.trim(),
        phone: inlineData.phone.trim() || undefined,
        currency: inlineData.currency as any,
        address_line: inlineData.address_line.trim() || undefined,
        city: inlineData.city.trim() || undefined,
        country: inlineData.country.trim() || undefined,
      });

      setVendor(updated);
      setIsInlineEdit(false);
      setToastMessage(`Vendor "${updated.name}" updated successfully.`);
      if (onVendorUpdated) {
        onVendorUpdated(updated);
      }
    } catch (err: any) {
      if (err?.status === 409 || err?.code === 'CONFLICT' || err?.message?.toLowerCase().includes('conflict')) {
        setConflictError(
          err?.message ||
            'Concurrent Modification Conflict (HTTP 409): This record was updated by another operator or background job while you were editing. To prevent data corruption, your changes were not applied.'
        );
      } else {
        setInlineErrors({ form: err?.message || 'Failed to save changes.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="cs-page-container">
        <PageTitle title="Vendor Profile" subtitle="Loading record from API..." />
        <SkeletonTable columns={4} rows={4} />
      </div>
    );
  }

  if (loadError || !vendor) {
    return (
      <div className="cs-page-container">
        <PageTitle
          title="Vendor Profile"
          actions={
            <Link to="/erp2/vendors" className="cs-button cs-button-secondary" role="button">
              ← Back to Vendors
            </Link>
          }
        />
        <ErrorState
          title="Failed to Load Vendor Profile"
          message={loadError || 'Vendor record not found.'}
          onRetry={vendorId ? () => loadVendor(vendorId) : undefined}
        />
      </div>
    );
  }

  const goldenId = resolveVendorGoldenId(vendor);

  return (
    <div className="cs-page-container" data-testid="vendor-detail-page">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="cs-erp2-toast-container" role="status" aria-live="polite" data-testid="detail-toast-alert">
          <div className="cs-erp2-toast">
            <span className="cs-erp2-toast-text">
              <span className="cs-erp2-toast-icon">✓</span> {toastMessage}
            </span>
            <button
              type="button"
              className="cs-erp2-toast-close"
              onClick={() => setToastMessage(null)}
              aria-label="Dismiss message"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Concurrent Modification Conflict Banner (AC 4) */}
      {conflictError && (
        <div
          className="cs-error-box cs-conflict-banner"
          role="alert"
          data-testid="concurrent-conflict-banner"
          style={{
            marginBottom: '20px',
            border: '2px solid var(--color-border-error, #f87171)',
            backgroundColor: '#fef2f2',
            padding: '16px',
            borderRadius: '6px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '15px', color: '#991b1b' }}>
                ⚠️ Concurrent Modification Conflict (HTTP 409)
              </p>
              <p style={{ margin: 0, fontSize: '13px', color: '#7f1d1d' }}>
                {conflictError}
              </p>
            </div>
          </div>
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="cs-button cs-button-primary"
              onClick={handleRefreshRecord}
              data-testid="conflict-refresh-btn"
            >
              🔄 Refresh Record and Re-apply Changes
            </button>
            <button
              type="button"
              className="cs-button cs-button-secondary"
              onClick={() => setConflictError(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span
          className="cs-badge cs-badge-golden"
          style={{ fontSize: '12px', fontWeight: 600 }}
          data-testid="header-golden-id-badge"
          title="Canonical Golden ID"
        >
          {goldenId}
        </span>
      </div>

      <PageTitle
        title={vendor.name}
        subtitle={`Vendor procurement profile · Tax Number: ${vendor.tax_number}`}
        actions={
          <div className="flex gap-2">
            {canEdit ? (
              <>
                <Link
                  to={`/erp2/vendors/${vendor.id}/edit`}
                  className="cs-button cs-button-primary"
                  role="button"
                  aria-label="Edit vendor profile"
                  data-testid="edit-vendor-btn"
                >
                  Edit Vendor
                </Link>
                <button
                  type="button"
                  className="cs-button cs-button-secondary"
                  onClick={() => setIsDrawerOpen(true)}
                  data-testid="edit-drawer-btn"
                  aria-label="Edit vendor via drawer"
                >
                  Edit Drawer
                </button>
                <button
                  type="button"
                  className={`cs-button ${isInlineEdit ? 'cs-button-secondary' : 'cs-button-primary'}`}
                  onClick={() => setIsInlineEdit(!isInlineEdit)}
                  data-testid="inline-edit-toggle-btn"
                  aria-label={isInlineEdit ? 'Cancel inline editing' : 'Edit vendor inline'}
                >
                  {isInlineEdit ? 'Cancel Inline Edit' : 'Inline Edit'}
                </button>
              </>
            ) : (
              <span
                className="cs-badge cs-badge-draft"
                data-testid="permission-denied-badge"
                title="Write permission required to edit vendor"
                style={{ padding: '6px 10px', fontSize: '12px' }}
              >
                Read Only (Permission: erp:vendors:write required)
              </span>
            )}
            <Link
              to={`/erp2/purchase-orders/new?vendor_id=${vendor.id}`}
              className="cs-button cs-button-secondary"
              role="button"
              aria-label="Create purchase order for vendor"
            >
              + Create PO
            </Link>
            <Link
              to="/erp2/vendors"
              className="cs-button cs-button-secondary"
              role="button"
              aria-label="Back to vendors list"
            >
              ← Back to Vendors
            </Link>
          </div>
        }
      />

      {/* Main Vendor Details Card (Read View or Inline Edit Mode) */}
      <div className="cs-card" data-testid="vendor-details-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 className="cs-section-subtitle" style={{ margin: 0 }}>
            Procurement Details
          </h3>
          {isInlineEdit && (
            <span className="cs-badge cs-badge-active" style={{ fontSize: '12px' }}>
              Editing Allowlisted Fields
            </span>
          )}
        </div>

        {inlineErrors.form && (
          <div className="cs-error-box" role="alert" style={{ marginBottom: '16px' }}>
            <p className="cs-error-desc" style={{ margin: 0 }}>
              {inlineErrors.form}
            </p>
          </div>
        )}

        {isInlineEdit ? (
          <form onSubmit={handleSaveInline} data-testid="vendor-inline-edit-form">
            <div className="cs-detail-grid">
              <div className="cs-form-field">
                <label className="cs-form-label" htmlFor="inline-name">
                  Legal Name <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="inline-name"
                  type="text"
                  className={`cs-form-input ${inlineErrors.name ? 'cs-form-input--error' : ''}`}
                  value={inlineData.name}
                  onChange={(e) => setInlineData({ ...inlineData, name: e.target.value })}
                  disabled={isSubmitting}
                  aria-invalid={!!inlineErrors.name}
                />
                {inlineErrors.name && (
                  <p className="cs-form-error" role="alert">
                    {inlineErrors.name}
                  </p>
                )}
              </div>

              <div className="cs-form-field">
                <label className="cs-form-label" htmlFor="inline-tax">
                  Tax Number / EIN <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="inline-tax"
                  type="text"
                  className={`cs-form-input cs-cell-mono ${inlineErrors.tax_number ? 'cs-form-input--error' : ''}`}
                  value={inlineData.tax_number}
                  onChange={(e) => setInlineData({ ...inlineData, tax_number: e.target.value })}
                  disabled={isSubmitting}
                  aria-invalid={!!inlineErrors.tax_number}
                />
                {inlineErrors.tax_number && (
                  <p className="cs-form-error" role="alert">
                    {inlineErrors.tax_number}
                  </p>
                )}
              </div>

              <div className="cs-form-field">
                <label className="cs-form-label" htmlFor="inline-email">
                  Procurement Email <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="inline-email"
                  type="email"
                  className={`cs-form-input ${inlineErrors.email ? 'cs-form-input--error' : ''}`}
                  value={inlineData.email}
                  onChange={(e) => setInlineData({ ...inlineData, email: e.target.value })}
                  disabled={isSubmitting}
                  aria-invalid={!!inlineErrors.email}
                />
                {inlineErrors.email && (
                  <p className="cs-form-error" role="alert">
                    {inlineErrors.email}
                  </p>
                )}
              </div>

              <div className="cs-form-field">
                <label className="cs-form-label" htmlFor="inline-phone">
                  Phone Number
                </label>
                <input
                  id="inline-phone"
                  type="text"
                  className={`cs-form-input ${inlineErrors.phone ? 'cs-form-input--error' : ''}`}
                  value={inlineData.phone}
                  onChange={(e) => setInlineData({ ...inlineData, phone: e.target.value })}
                  disabled={isSubmitting}
                  aria-invalid={!!inlineErrors.phone}
                />
                {inlineErrors.phone && (
                  <p className="cs-form-error" role="alert">
                    {inlineErrors.phone}
                  </p>
                )}
              </div>

              <div className="cs-form-field">
                <label className="cs-form-label" htmlFor="inline-currency">
                  Default Currency
                </label>
                <select
                  id="inline-currency"
                  className="cs-form-select"
                  value={inlineData.currency}
                  onChange={(e) => setInlineData({ ...inlineData, currency: e.target.value })}
                  disabled={isSubmitting}
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="INR">INR (₹)</option>
                </select>
              </div>

              <div className="cs-form-field">
                <label className="cs-form-label" htmlFor="inline-address">
                  Street Address
                </label>
                <input
                  id="inline-address"
                  type="text"
                  className="cs-form-input"
                  value={inlineData.address_line}
                  onChange={(e) => setInlineData({ ...inlineData, address_line: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>

              <div className="cs-form-field">
                <label className="cs-form-label" htmlFor="inline-city">
                  City
                </label>
                <input
                  id="inline-city"
                  type="text"
                  className="cs-form-input"
                  value={inlineData.city}
                  onChange={(e) => setInlineData({ ...inlineData, city: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>

              <div className="cs-form-field">
                <label className="cs-form-label" htmlFor="inline-country">
                  Country
                </label>
                <input
                  id="inline-country"
                  type="text"
                  className="cs-form-input"
                  value={inlineData.country}
                  onChange={(e) => setInlineData({ ...inlineData, country: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div style={{ marginTop: '20px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="cs-button cs-button-secondary"
                onClick={() => setIsInlineEdit(false)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="cs-button cs-button-primary"
                disabled={isSubmitting}
                data-testid="inline-save-btn"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        ) : (
          <div className="cs-detail-grid">
            <div className="cs-detail-item">
              <span className="cs-detail-label">Legal Name</span>
              <span className="cs-detail-value" data-testid="detail-vendor-name">
                {vendor.name}
              </span>
            </div>

            <div className="cs-detail-item">
              <span className="cs-detail-label">Tax Number</span>
              <span className="cs-detail-value cs-cell-mono" data-testid="detail-tax-number">
                {vendor.tax_number}
              </span>
            </div>

            <div className="cs-detail-item">
              <span className="cs-detail-label">Procurement Email</span>
              <span className="cs-detail-value" data-testid="detail-email">
                {vendor.email}
              </span>
            </div>

            <div className="cs-detail-item">
              <span className="cs-detail-label">Phone</span>
              <span className="cs-detail-value" data-testid="detail-phone">
                {vendor.phone || '—'}
              </span>
            </div>

            <div className="cs-detail-item">
              <span className="cs-detail-label">Default Currency</span>
              <span className="cs-detail-value cs-cell-mono" data-testid="detail-currency">
                {vendor.currency}
              </span>
            </div>

            <div className="cs-detail-item">
              <span className="cs-detail-label">Banking Account</span>
              <span className="cs-detail-value cs-cell-masked" data-testid="detail-bank-masked">
                {vendor.bank_masked || '—'}{' '}
                {vendor.bank_masked && (
                  <span className="cs-badge cs-badge-draft" style={{ fontSize: '11px', marginLeft: '6px' }}>
                    Server-Masked
                  </span>
                )}
              </span>
            </div>

            <div className="cs-detail-item">
              <span className="cs-detail-label">Street Address</span>
              <span className="cs-detail-value" data-testid="detail-address">
                {vendor.address_line || '—'}
              </span>
            </div>

            <div className="cs-detail-item">
              <span className="cs-detail-label">City</span>
              <span className="cs-detail-value" data-testid="detail-city">
                {vendor.city || '—'}
              </span>
            </div>

            <div className="cs-detail-item">
              <span className="cs-detail-label">Country</span>
              <span className="cs-detail-value" data-testid="detail-country">
                {vendor.country || '—'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Audit Metadata & Canonical Identity Panel (AC 1) */}
      <VendorAuditPanel vendor={vendor} />

      {/* Linked Purchase Orders Sub-Table & ERP-4 Links (AC 3) */}
      <VendorLinkedOrdersTable
        vendorId={vendor.id}
        vendorName={vendor.name}
        currency={vendor.currency}
      />

      {/* Edit Drawer Modal (AC 2) */}
      <VendorEditDrawer
        isOpen={isDrawerOpen}
        vendor={vendor}
        canEdit={canEdit}
        onClose={() => setIsDrawerOpen(false)}
        onVendorUpdated={(updated) => {
          setVendor(updated);
          setToastMessage(`Vendor "${updated.name}" updated successfully.`);
          if (onVendorUpdated) {
            onVendorUpdated(updated);
          }
        }}
        onConflict={(err) => {
          setConflictError(
            err?.message ||
              'Concurrent Modification Conflict (HTTP 409): This record was updated by another operator or background job while you were editing. To prevent data corruption, your changes were not applied.'
          );
        }}
      />
    </div>
  );
};

export default VendorDetailPage;
