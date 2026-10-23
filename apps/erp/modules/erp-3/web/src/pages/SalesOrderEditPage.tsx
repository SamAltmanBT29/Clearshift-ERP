/**
 * ERP-3 Sales Orders and Invoices — Sales Order Edit Route Page
 *
 * @module erp3/web/pages/SalesOrderEditPage
 */

import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { PageTitle, Alert } from '@cs/ui';
import { ERP3_BASE_PATH } from '../route-manifest.js';

export const SalesOrderEditPage: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();

  return (
    <div className="cs-module-root">
      <nav className="cs-back-nav" aria-label="Sales order edit navigation">
        <button
          type="button"
          className="cs-btn-back"
          onClick={() => navigate(`${ERP3_BASE_PATH}/sales-orders/${orderId ?? ''}`)}
          aria-label="Back to Sales Order"
        >
          ← Back to Sales Order
        </button>
      </nav>
      <header className="cs-page-header">
        <PageTitle
          title="Edit sales order"
          subtitle={`Editing order ${orderId ?? ''}. In V1, sales orders that have been invoiced or closed cannot be modified.`}
        />
      </header>
      <Alert variant="info" title="Order Editing">
        <p>
          Order modification requires open status. To inspect lines or advance lifecycle status,
          visit the detail view.
        </p>
        <p>
          <Link className="cs-erp3-link" to={`${ERP3_BASE_PATH}/sales-orders/${orderId ?? ''}`}>
            Return to Order Detail
          </Link>
        </p>
      </Alert>
    </div>
  );
};

export default SalesOrderEditPage;
