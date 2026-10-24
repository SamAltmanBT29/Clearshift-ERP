/**
 * ERP-4 Finance & Accounting — Module Route Table
 *
 * Route definitions for React Router:
 *
 *   `/erp4`                    → `RequireAuth`  (Authentication guard)
 *     └─ (layout)              → accounts overview / journal management
 *
 * @module erp4/web/routes
 */

import React from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth.js';
import { AccountsListPage } from './pages/AccountsListPage.js';
import { ERP4_BASE_PATH } from './route-manifest.js';

export const erp4Routes: RouteObject[] = [
  {
    id: 'erp4',
    path: ERP4_BASE_PATH,
    element: <RequireAuth />,
    children: [
      {
        id: 'erp4-index',
        index: true,
        element: <AccountsListPage />,
      },
      {
        id: 'erp4-accounts',
        path: 'accounts',
        element: <AccountsListPage />,
      },
      {
        id: 'erp4-catchall',
        path: '*',
        element: <Navigate to="/erp4" replace />,
      },
    ],
  },
];
