/**
 * ERP-3 Sales Orders and Invoices — Module Route Table
 *
 * The React Router route objects of the module.
 *
 * The nesting is deliberate:
 *
 *   `/erp3`                → `RequireAuth`  — authentication gate for the module
 *     └─ (layout)          → `ModuleShell`  — landmarks, navigation, title
 *          └─ (children)   → the screens
 *
 * A screen can therefore never render outside the shell, and no screen can
 * render at all without a session.
 *
 * Architecture reference: ClearShift V1 Master Architecture Spec §3.1
 * (`/erp3/{sales-orders,invoices,payments}`) and §6.1 (slot 16 — route table
 * registration).
 *
 * @module erp3/web/routes
 */

import React from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth.js';
import { RequireErp3Permission } from './auth/RequireErp3Permission.js';
import { ModuleShell } from './components/ModuleShell.js';
import { SalesOrdersListPage } from './pages/SalesOrdersListPage.js';
import { SalesOrderCreatePage } from './pages/SalesOrderCreatePage.js';
import { SalesOrderDetailPage } from './pages/SalesOrderDetailPage.js';
import { SalesOrderEditPage } from './pages/SalesOrderEditPage.js';
import { InvoicesListPage } from './pages/InvoicesListPage.js';
import { InvoiceCreateRoutePage } from './pages/InvoiceCreateRoutePage.js';
import { InvoiceDetailRoutePage } from './pages/InvoiceDetailRoutePage.js';
import { InvoiceEditRoutePage } from './pages/InvoiceEditRoutePage.js';
import { PaymentsListPage } from './pages/PaymentsListPage.js';
import { ModuleNotFoundPage } from './pages/ModuleNotFoundPage.js';
import { ERP3_BASE_PATH } from './route-manifest.js';

export const erp3Routes: RouteObject[] = [
  {
    id: 'erp3',
    path: ERP3_BASE_PATH,
    element: <RequireAuth />,
    children: [
      {
        id: 'erp3-shell',
        element: <ModuleShell />,
        children: [
          {
            id: 'erp3-index',
            index: true,
            element: <Navigate to="/erp3/sales-orders" replace />,
          },
          {
            id: 'erp3-sales-orders',
            path: 'sales-orders',
            element: <RequireErp3Permission permission="SALES_ORDERS_READ"><SalesOrdersListPage /></RequireErp3Permission>,
          },
          {
            id: 'erp3-sales-orders-create',
            path: 'sales-orders/new',
            element: <RequireErp3Permission permission="SALES_ORDERS_CREATE"><SalesOrderCreatePage /></RequireErp3Permission>,
          },
          {
            id: 'erp3-sales-orders-detail',
            path: 'sales-orders/:orderId',
            element: <RequireErp3Permission permission="SALES_ORDERS_READ"><SalesOrderDetailPage /></RequireErp3Permission>,
          },
          {
            id: 'erp3-sales-orders-edit',
            path: 'sales-orders/:orderId/edit',
            element: <RequireErp3Permission permission="SALES_ORDERS_UPDATE"><SalesOrderEditPage /></RequireErp3Permission>,
          },
          {
            id: 'erp3-invoices',
            path: 'invoices',
            element: <RequireErp3Permission permission="INVOICES_READ"><InvoicesListPage /></RequireErp3Permission>,
          },
          {
            id: 'erp3-invoices-create',
            path: 'invoices/new',
            element: <RequireErp3Permission permission="INVOICES_CREATE"><InvoiceCreateRoutePage /></RequireErp3Permission>,
          },
          {
            id: 'erp3-invoices-detail',
            path: 'invoices/:invoiceId',
            element: <RequireErp3Permission permission="INVOICES_READ"><InvoiceDetailRoutePage /></RequireErp3Permission>,
          },
          {
            id: 'erp3-invoices-edit',
            path: 'invoices/:invoiceId/edit',
            element: <RequireErp3Permission permission="INVOICES_READ"><InvoiceEditRoutePage /></RequireErp3Permission>,
          },
          {
            id: 'erp3-payments',
            path: 'payments',
            element: <RequireErp3Permission permission="PAYMENTS_READ"><PaymentsListPage /></RequireErp3Permission>,
          },
          {
            id: 'erp3-not-found',
            path: '*',
            element: <ModuleNotFoundPage />,
          },
        ],
      },
    ],
  },
];

export default erp3Routes;
