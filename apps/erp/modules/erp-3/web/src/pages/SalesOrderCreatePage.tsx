/**
 * ERP-3 Sales Orders and Invoices — Sales Order Create Route Page
 *
 * @module erp3/web/pages/SalesOrderCreatePage
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { OrderCreatePage } from './OrderCreatePage.js';
import { ERP3_BASE_PATH } from '../route-manifest.js';

export const SalesOrderCreatePage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <OrderCreatePage
      onBack={() => navigate(`${ERP3_BASE_PATH}/sales-orders`)}
      onOrderCreated={(order) => navigate(`${ERP3_BASE_PATH}/sales-orders/${order.id}`)}
    />
  );
};

export default SalesOrderCreatePage;
