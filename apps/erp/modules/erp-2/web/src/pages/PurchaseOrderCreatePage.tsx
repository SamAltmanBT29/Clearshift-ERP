/**
 * ERP-2 Vendors & Purchasing — Purchase Order Create Page
 *
 * @module erp2/web/pages/PurchaseOrderCreatePage
 */

import React from 'react';
import { PageTitle } from '@cs/ui';
import { Link } from 'react-router-dom';

export const PurchaseOrderCreatePage: React.FC = () => {
  return (
    <div className="cs-page-container">
      <PageTitle
        title="New purchase order"
        subtitle="Create a purchase order with validated ERP-1 product lines"
        actions={
          <Link
            to="/erp2/purchase-orders"
            className="cs-button cs-button-secondary"
            role="button"
          >
            Back to purchase orders
          </Link>
        }
      />
      <div className="cs-card">
        <p className="text-sm text-[var(--cs-text-muted)]">
          Create purchase order form with line item product picker and server-calculated totals.
        </p>
      </div>
    </div>
  );
};

export default PurchaseOrderCreatePage;
