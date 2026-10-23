/**
 * ERP-2 Vendors & Purchasing — Purchase Orders List Page
 *
 * @module erp2/web/pages/PurchaseOrdersListPage
 */

import React from 'react';
import { PageTitle } from '@cs/ui';
import { Link } from 'react-router-dom';

export const PurchaseOrdersListPage: React.FC = () => {
  return (
    <div className="cs-page-container">
      <PageTitle
        title="Purchase orders"
        subtitle="Manage procurement orders, line items, and lifecycle status"
        actions={
          <Link
            to="/erp2/purchase-orders/new"
            className="cs-button cs-button-primary"
            role="button"
          >
            New purchase order
          </Link>
        }
      />
      <div className="cs-card">
        <p className="text-sm text-[var(--cs-text-muted)]">
          List of purchase orders with statuses Draft, Sent, Received, and Closed.
        </p>
      </div>
    </div>
  );
};

export default PurchaseOrdersListPage;
