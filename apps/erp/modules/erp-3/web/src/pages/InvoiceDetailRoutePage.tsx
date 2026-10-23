/**
 * ERP-3 Sales Orders and Invoices — Invoice Detail Route Page
 *
 * @module erp3/web/pages/InvoiceDetailRoutePage
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { InvoiceDetailPage } from './InvoiceDetailPage.js';
import { ERP3_BASE_PATH } from '../route-manifest.js';

export const InvoiceDetailRoutePage: React.FC = () => {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();

  return (
    <InvoiceDetailPage
      invoiceId={invoiceId || ''}
      onBack={() => navigate(`${ERP3_BASE_PATH}/invoices`)}
      onViewOrder={(orderId) => navigate(`${ERP3_BASE_PATH}/sales-orders/${orderId}`)}
    />
  );
};

export default InvoiceDetailRoutePage;
