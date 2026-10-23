import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { PageTitle } from '@cs/ui';
import type { Vendor } from '@clearshift/contracts';
import { VendorForm, type VendorFormData } from '../components/forms/VendorForm.js';
import { fetchVendorById, updateVendor } from '../api/erp-2.js';
import { ErrorState, SkeletonTable } from '../components/StateViews.js';

export const VendorEditPage: React.FC = () => {
  const { vendorId } = useParams<{ vendorId: string }>();
  const navigate = useNavigate();

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

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
      setLoadError('No vendor ID specified.');
      setIsLoading(false);
    }
  }, [vendorId, loadVendor]);

  const handleSubmit = async (data: VendorFormData) => {
    if (!vendorId) return;
    setIsSubmitting(true);
    setServerError(null);
    try {
      await updateVendor(vendorId, data);
      navigate(`/erp2/vendors/${vendorId}`);
    } catch (err: any) {
      setServerError(err?.message || 'Failed to update vendor record.');
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="cs-page-container">
        <PageTitle title="Edit Vendor" subtitle="Loading vendor data..." />
        <SkeletonTable columns={4} rows={4} />
      </div>
    );
  }

  if (loadError || !vendor) {
    return (
      <div className="cs-page-container">
        <PageTitle
          title="Edit Vendor"
          actions={
            <Link to="/erp2/vendors" className="cs-button cs-button-secondary" role="button">
              ← Back to Vendors
            </Link>
          }
        />
        <ErrorState
          title="Failed to Load Vendor"
          message={loadError || 'Vendor record not found.'}
          onRetry={vendorId ? () => loadVendor(vendorId) : undefined}
        />
      </div>
    );
  }

  return (
    <div className="cs-page-container">
      <PageTitle
        title={`Edit ${vendor.name}`}
        subtitle={`Update vendor procurement profile · ${vendor.tax_number}`}
        actions={
          <div className="flex gap-2">
            <Link
              to={`/erp2/vendors/${vendor.id}`}
              className="cs-button cs-button-secondary"
              role="button"
              aria-label="View vendor profile"
            >
              View Profile
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

      {serverError && (
        <div className="cs-error-box" role="alert">
          <p className="cs-error-desc" style={{ margin: 0 }}>
            {serverError}
          </p>
        </div>
      )}

      <VendorForm
        initialData={vendor}
        isEdit={true}
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/erp2/vendors/${vendor.id}`)}
        isLoading={isSubmitting}
      />
    </div>
  );
};

export default VendorEditPage;
