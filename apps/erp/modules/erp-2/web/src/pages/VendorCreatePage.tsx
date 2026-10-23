import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { PageTitle } from '@cs/ui';
import { VendorForm, type VendorFormData } from '../components/forms/VendorForm.js';
import { createVendor } from '../api/erp-2.js';

export const VendorCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const handleSubmit = async (data: VendorFormData) => {
    setIsSubmitting(true);
    setServerError(null);
    try {
      const created = await createVendor({
        ...data,
        currency: data.currency || 'USD',
      });
      navigate(`/erp2/vendors/${created.id}`);
    } catch (err: any) {
      setServerError(err?.message || 'Failed to create vendor record on server.');
      throw err; // Allow form to show field-level error mapping
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="cs-page-container">
      <PageTitle
        title="New Vendor"
        subtitle="Register a new vendor master profile with masked banking details (ERP-2)"
        actions={
          <Link
            to="/erp2/vendors"
            className="cs-button cs-button-secondary"
            role="button"
            aria-label="Back to vendors list"
          >
            ← Back to Vendors
          </Link>
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
        isEdit={false}
        onSubmit={handleSubmit}
        onCancel={() => navigate('/erp2/vendors')}
        isLoading={isSubmitting}
      />
    </div>
  );
};

export default VendorCreatePage;
