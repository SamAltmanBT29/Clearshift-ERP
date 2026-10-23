/**
 * ERP-3 Sales Orders and Invoices — Invoice Edit Route Page
 *
 * @module erp3/web/pages/InvoiceEditRoutePage
 */

import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { PageTitle, Alert } from '@cs/ui';
import { ERP3_BASE_PATH } from '../route-manifest.js';

export const InvoiceEditRoutePage: React.FC = () => {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();

  return (
    <div className="cs-module-root">
      <nav className="cs-back-nav" aria-label="Invoice edit navigation">
        <button
          type="button"
          className="cs-btn-back"
          onClick={() => navigate(`${ERP3_BASE_PATH}/invoices/${invoiceId ?? ''}`)}
          aria-label="Back to Invoice"
        >
          ← Back to Invoice
        </button>
      </nav>
      <header className="cs-page-header">
        <PageTitle
          title="Edit invoice"
          subtitle={`Editing invoice ${invoiceId ?? ''}. In V1, posted billing invoices cannot be modified.`}
        />
      </header>
      <Alert variant="info" title="Invoice Editing">
        <p>
          Billing invoices reflect immutable financial records. To settle an invoice, record a
          payment on the detail view.
        </p>
        <p>
          <Link className="cs-erp3-link" to={`${ERP3_BASE_PATH}/invoices/${invoiceId ?? ''}`}>
            Return to Invoice Detail
          </Link>
        </p>
      </Alert>
    </div>
  );
};

export default InvoiceEditRoutePage;
