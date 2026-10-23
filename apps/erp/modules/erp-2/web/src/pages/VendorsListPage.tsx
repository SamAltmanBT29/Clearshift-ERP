/**
 * ERP-2 Vendors & Purchasing — Vendors List Page
 *
 * @module erp2/web/pages/VendorsListPage
 */

import React from 'react';
import { PageTitle } from '@cs/ui';
import { Link } from 'react-router-dom';

export const VendorsListPage: React.FC = () => {
  return (
    <div className="cs-page-container">
      <PageTitle
        title="Vendors"
        subtitle="Manage supplier records, tax numbers and banking information"
        actions={
          <Link
            to="/erp2/vendors/new"
            className="cs-button cs-button-primary"
            role="button"
          >
            New vendor
          </Link>
        }
      />
      <div className="cs-card">
        <p className="text-sm text-[var(--cs-text-muted)]">
          Search and view vendor catalog with server-masked bank details.
        </p>
      </div>
    </div>
  );
};

export default VendorsListPage;
