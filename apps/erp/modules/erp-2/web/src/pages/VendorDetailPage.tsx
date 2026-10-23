/**
 * ERP-2 Vendors & Purchasing — Vendor Detail Page
 *
 * @module erp2/web/pages/VendorDetailPage
 */

import React from 'react';
import { PageTitle } from '@cs/ui';
import { Link, useParams } from 'react-router-dom';

export const VendorDetailPage: React.FC = () => {
  const { vendorId } = useParams<{ vendorId: string }>();

  return (
    <div className="cs-page-container">
      <PageTitle
        title="Vendor"
        subtitle={`Vendor record profile and purchasing history · ${vendorId ?? ''}`}
        actions={
          <div className="flex gap-2">
            <Link
              to="/erp2/vendors"
              className="cs-button cs-button-secondary"
              role="button"
            >
              Back to vendors
            </Link>
            {vendorId && (
              <Link
                to={`/erp2/vendors/${vendorId}/edit`}
                className="cs-button cs-button-primary"
                role="button"
              >
                Edit vendor
              </Link>
            )}
          </div>
        }
      />
      <div className="cs-card">
        <p className="text-sm text-[var(--cs-text-muted)]">
          Vendor details view showing masked bank details and terms.
        </p>
      </div>
    </div>
  );
};

export default VendorDetailPage;
