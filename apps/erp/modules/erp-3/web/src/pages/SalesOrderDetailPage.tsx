/**
 * ERP-3 Sales Orders and Invoices — Sales Order Detail Route Page
 *
 * @module erp3/web/pages/SalesOrderDetailPage
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { OrderDetailPage } from './OrderDetailPage.js';
import { ERP3_BASE_PATH } from '../route-manifest.js';

export const SalesOrderDetailPage: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();

  return (
    <OrderDetailPage
      orderId={orderId || ''}
      onBack={() => navigate(`${ERP3_BASE_PATH}/sales-orders`)}
      onCreateInvoice={(order) =>
        navigate(`${ERP3_BASE_PATH}/invoices/new?orderId=${encodeURIComponent(order.id)}`)
      }
    />
  );
};

export default SalesOrderDetailPage;
