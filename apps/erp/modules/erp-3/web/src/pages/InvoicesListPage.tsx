/**
 * ERP-3 Sales Orders and Invoices — Invoices List Page
 *
 * Delegates data fetching, loading skeleton, and empty states to OrdersListPage.
 *
 * @module erp3/web/pages/InvoicesListPage
 */

import React from 'react';
import { OrdersListPage } from './OrdersListPage.js';

export const InvoicesListPage: React.FC = () => {
  return <OrdersListPage initialTab="invoices" />;
};

export default InvoicesListPage;
