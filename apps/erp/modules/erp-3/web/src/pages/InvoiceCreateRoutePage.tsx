/**
 * ERP-3 Sales Orders and Invoices — Invoice Create Route Page
 *
 * @module erp3/web/pages/InvoiceCreateRoutePage
 */

import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { InvoiceCreatePage } from './InvoiceCreatePage.js';
import { ERP3_BASE_PATH } from '../route-manifest.js';

export const InvoiceCreateRoutePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId') || '';

  return (
    <InvoiceCreatePage
      initialOrderId={orderId}
      onBack={() => navigate(`${ERP3_BASE_PATH}/invoices`)}
      onInvoiceCreated={(invoice) => navigate(`${ERP3_BASE_PATH}/invoices/${invoice.id}`)}
    />
  );
};

export default InvoiceCreateRoutePage;
