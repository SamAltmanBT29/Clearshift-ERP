/**
 * ERP-2 Vendors & Purchasing — Vendor Create Page
 *
 * @module erp2/web/pages/VendorCreatePage
 */

import React from 'react';
import { PageTitle } from '@cs/ui';
import { Link } from 'react-router-dom';

export const VendorCreatePage: React.FC = () => {
  return (
    <div className="cs-page-container">
      <PageTitle
        title="New vendor"
        subtitle="Register a new vendor master record"
        actions={
          <Link
            to="/erp2/vendors"
            className="cs-button cs-button-secondary"
            role="button"
          >
            Back to vendors
          </Link>
        }
      />
      <div className="cs-card">
        <p className="text-sm text-[var(--cs-text-muted)]">
          Vendor creation form with server-side bank details masking.
        </p>
      </div>
    </div>
  );
};

export default VendorCreatePage;
