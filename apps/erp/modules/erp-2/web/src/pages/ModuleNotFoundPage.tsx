/**
 * ERP-2 Vendors & Purchasing — Module Not Found Catch-All Page
 *
 * @module erp2/web/pages/ModuleNotFoundPage
 */

import React from 'react';
import { PageTitle } from '@cs/ui';
import { Link } from 'react-router-dom';

export const ModuleNotFoundPage: React.FC = () => {
  return (
    <div className="cs-page-container">
      <PageTitle
        title="Screen not found"
        subtitle="The requested path does not exist in Vendors & Purchasing"
        actions={
          <Link
            to="/erp2/vendors"
            className="cs-button cs-button-primary"
            role="button"
          >
            Go to vendors
          </Link>
        }
      />
      <div className="cs-card">
        <p className="text-sm text-[var(--cs-text-muted)]">
          Please check the URL or select a resource from the navigation menu.
        </p>
      </div>
    </div>
  );
};

export default ModuleNotFoundPage;
