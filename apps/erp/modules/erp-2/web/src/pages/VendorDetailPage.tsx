import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PageTitle } from '@cs/ui';
import type { Vendor } from '@clearshift/contracts';
import { fetchVendorById } from '../api/erp-2.js';
import { ErrorState, SkeletonTable } from '../components/StateViews.js';

export const VendorDetailPage: React.FC = () => {
  const { vendorId } = useParams<{ vendorId: string }>();

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadVendor = useCallback(async (id: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await fetchVendorById(id);
      setVendor(data);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load vendor profile from server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (vendorId) {
      loadVendor(vendorId);
    } else {
      setLoadError('No vendor ID specified in route.');
      setIsLoading(false);
    }
  }, [vendorId, loadVendor]);

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

  return (
    <div className="cs-page-container">
      <PageTitle
        title={vendor.name}
        subtitle={`Vendor procurement profile · Tax Number: ${vendor.tax_number}`}
        actions={
          <div className="flex gap-2">
            <Link
              to={`/erp2/vendors/${vendor.id}/edit`}
              className="cs-button cs-button-primary"
              role="button"
              aria-label="Edit vendor profile"
            >
              Edit Vendor
            </Link>
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

      {/* Main Vendor Details Card */}
      <div className="cs-card">
        <h3 className="cs-section-subtitle" style={{ marginTop: 0, marginBottom: '16px' }}>
          Procurement Details
        </h3>

        <div className="cs-detail-grid">
          <div className="cs-detail-item">
            <span className="cs-detail-label">Legal Name</span>
            <span className="cs-detail-value">{vendor.name}</span>
          </div>

          <div className="cs-detail-item">
            <span className="cs-detail-label">Tax Number</span>
            <span className="cs-detail-value cs-cell-mono">{vendor.tax_number}</span>
          </div>

          <div className="cs-detail-item">
            <span className="cs-detail-label">Procurement Email</span>
            <span className="cs-detail-value">{vendor.email}</span>
          </div>

          <div className="cs-detail-item">
            <span className="cs-detail-label">Phone</span>
            <span className="cs-detail-value">{vendor.phone || '—'}</span>
          </div>

          <div className="cs-detail-item">
            <span className="cs-detail-label">Default Currency</span>
            <span className="cs-detail-value cs-cell-mono">{vendor.currency}</span>
          </div>

          <div className="cs-detail-item">
            <span className="cs-detail-label">Banking Account</span>
            <span className="cs-detail-value cs-cell-masked">
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
            <span className="cs-detail-value">{vendor.address_line || '—'}</span>
          </div>

          <div className="cs-detail-item">
            <span className="cs-detail-label">City</span>
            <span className="cs-detail-value">{vendor.city || '—'}</span>
          </div>

          <div className="cs-detail-item">
            <span className="cs-detail-label">Country</span>
            <span className="cs-detail-value">{vendor.country || '—'}</span>
          </div>
        </div>

        {/* Audit & Provenance Footer */}
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: 'var(--color-text-muted)',
          }}
        >
          <div>
            Record ID: <span className="cs-cell-mono">{vendor.id}</span>
          </div>
          <div>
            Created: {new Date(vendor.created_at).toLocaleDateString()} · Updated:{' '}
            {new Date(vendor.updated_at).toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VendorDetailPage;
