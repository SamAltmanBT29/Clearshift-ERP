import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { PageTitle } from '@cs/ui';
import type { CreatePurchaseOrderRequest } from '@clearshift/contracts';
import { PurchaseOrderForm } from '../components/forms/PurchaseOrderForm.js';
import { createPurchaseOrder } from '../api/erp-2.js';

export const PurchaseOrderCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialVendorId = searchParams.get('vendor_id') || '';

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const handleSubmit = async (data: CreatePurchaseOrderRequest) => {
    setIsSubmitting(true);
    setServerError(null);
    try {
      const created = await createPurchaseOrder(data);
      navigate(`/erp2/purchase-orders/${created.id}`);
    } catch (err: any) {
      setServerError(err?.message || 'Failed to create purchase order on server.');
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="cs-page-container">
      <PageTitle
        title="New Purchase Order"
        subtitle="Create a purchase order with validated ERP-1 product lines and server-calculated totals"
        actions={
          <Link
            to="/erp2/purchase-orders"
            className="cs-button cs-button-secondary"
            role="button"
            aria-label="Back to purchase orders list"
          >
            ← Back to Purchase Orders
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

      <PurchaseOrderForm
        initialVendorId={initialVendorId}
        onSubmit={handleSubmit}
        onCancel={() => navigate('/erp2/purchase-orders')}
        isLoading={isSubmitting}
      />
    </div>
  );
};

export default PurchaseOrderCreatePage;
