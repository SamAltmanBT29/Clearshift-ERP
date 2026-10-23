/**
 * ERP-3 Sales Orders and Invoices — Sales Orders List Page
 *
 * Delegates data fetching, loading skeleton, and empty states to OrdersListPage.
 *
 * @module erp3/web/pages/SalesOrdersListPage
 */

import React from 'react';
import { OrdersListPage } from './OrdersListPage.js';

export const SalesOrdersListPage: React.FC = () => {
  return <OrdersListPage initialTab="orders" />;
};

export default SalesOrdersListPage;
