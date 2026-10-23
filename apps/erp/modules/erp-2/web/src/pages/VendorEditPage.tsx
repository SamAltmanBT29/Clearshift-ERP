/**
 * ERP-2 Vendors & Purchasing — Vendor Edit Page
 *
 * @module erp2/web/pages/VendorEditPage
 */

import React from 'react';
import { PageTitle } from '@cs/ui';
import { Link, useParams } from 'react-router-dom';

export const VendorEditPage: React.FC = () => {
  const { vendorId } = useParams<{ vendorId: string }>();

  return (
    <div className="cs-page-container">
      <PageTitle
        title="Edit vendor"
        subtitle={`Update vendor company profile and settings · ${vendorId ?? ''}`}
        actions={
          <Link
            to={vendorId ? `/erp2/vendors/${vendorId}` : '/erp2/vendors'}
            className="cs-button cs-button-secondary"
            role="button"
          >
            Cancel
          </Link>
        }
      />
      <div className="cs-card">
        <p className="text-sm text-[var(--cs-text-muted)]">
          Edit vendor details and banking records.
        </p>
      </div>
    </div>
  );
};

export default VendorEditPage;
