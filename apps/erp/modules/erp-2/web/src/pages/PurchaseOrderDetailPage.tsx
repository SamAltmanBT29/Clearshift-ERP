/**
 * ERP-2 Vendors & Purchasing — Purchase Order Detail Page
 *
 * @module erp2/web/pages/PurchaseOrderDetailPage
 */

import React from 'react';
import { PageTitle } from '@cs/ui';
import { Link, useParams } from 'react-router-dom';

export const PurchaseOrderDetailPage: React.FC = () => {
  const { purchaseOrderId } = useParams<{ purchaseOrderId: string }>();

  return (
    <div className="cs-page-container">
      <PageTitle
        title="Purchase order"
        subtitle={`Order details, lines, and lifecycle state · ${purchaseOrderId ?? ''}`}
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
          Purchase order detail with forward-only status actions (Draft &rarr; Sent &rarr; Received &rarr; Closed).
        </p>
      </div>
    </div>
  );
};

export default PurchaseOrderDetailPage;
