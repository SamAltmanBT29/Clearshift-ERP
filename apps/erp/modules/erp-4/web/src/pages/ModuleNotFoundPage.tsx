/**
 * ERP-4 Finance and Accounting — Module Not Found Catch-All Page
 *
 * @module erp4/web/pages/ModuleNotFoundPage
 */

import React from 'react';
import { PageTitle } from '@cs/ui';
import { Link } from 'react-router-dom';

export const ModuleNotFoundPage: React.FC = () => {
  return (
    <div className="cs-page-container">
      <PageTitle
        title="Screen not found"
        subtitle="The requested path does not exist in Finance & Accounting"
        actions={
          <Link
            to="/erp4/accounts"
            className="cs-button cs-button-primary"
            role="button"
          >
            Go to Chart of Accounts
          </Link>
        }
      />
      <div className="cs-card" role="alert">
        <p className="text-sm text-[var(--cs-text-muted)]">
          Please check the URL or select a resource from the navigation menu.
        </p>
      </div>
    </div>
  );
};

export default ModuleNotFoundPage;
