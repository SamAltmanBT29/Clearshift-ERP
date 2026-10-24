/**
 * ERP-2 Vendors & Purchasing — Module Route Table
 *
 * Route definitions for React Router:
 *
 *   `/erp2`                    → `RequireAuth`  (Authentication guard)
 *     └─ (layout)              → `ModuleShell`  (Landmarks, banner, navigation, breadcrumbs)
 *          └─ (index)          → redirects to `/erp2/vendors`
 *          └─ `vendors`        → `VendorsListPage`
 *          └─ `vendors/new`    → `VendorCreatePage`
 *          └─ `vendors/:id`    → `VendorDetailPage`
 *          └─ `vendors/:id/edit` → `VendorEditPage`
 *          └─ `purchase-orders` → `PurchaseOrdersListPage`
 *          └─ `purchase-orders/new` → `PurchaseOrderCreatePage`
 *          └─ `purchase-orders/:id` → `PurchaseOrderDetailPage`
 *          └─ `import-receipts` → `ImportReceiptsListPage`
 *          └─ `*`              → `ModuleNotFoundPage`
 *
 * Every screen is nested inside both the authentication gate and the module layout shell.
 *
 * Architecture references:
 * - ClearShift V1 Master Architecture Spec §3.1 & §6.1
 * - SDS ClearShift ERP v2.0 §4.3 & §4.9
 * - Issue #132 (ERP2-16)
 *
 * @module erp2/web/routes
 */

import React from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth.js';
import { ModuleShell } from './components/ModuleShell.js';
import { VendorsListPage } from './pages/VendorsListPage.js';
import { VendorCreatePage } from './pages/VendorCreatePage.js';
import { VendorDetailPage } from './pages/VendorDetailPage.js';
import { VendorEditPage } from './pages/VendorEditPage.js';
import { PurchaseOrdersListPage } from './pages/PurchaseOrdersListPage.js';
import { PurchaseOrderCreatePage } from './pages/PurchaseOrderCreatePage.js';
import { PurchaseOrderDetailPage } from './pages/PurchaseOrderDetailPage.js';
import { ImportReceiptsListPage } from './pages/ImportReceiptsListPage.js';
import { DuplicateCandidatesPage } from './pages/DuplicateCandidatesPage.js';
import { VendorRejectionReviewPage } from './pages/VendorRejectionReviewPage.js';
import { ModuleNotFoundPage } from './pages/ModuleNotFoundPage.js';
import { ERP2_BASE_PATH } from './route-manifest.js';

export const erp2Routes: RouteObject[] = [
  {
    id: 'erp2',
    path: ERP2_BASE_PATH,
    element: <RequireAuth />,
    children: [
      {
        id: 'erp2-shell',
        element: <ModuleShell />,
        children: [
          {
            id: 'erp2-index',
            index: true,
            element: <Navigate to="/erp2/vendors" replace />,
          },
          {
            id: 'erp2-vendors',
            path: 'vendors',
            element: <VendorsListPage />,
          },
          {
            id: 'erp2-vendors-create',
            path: 'vendors/new',
            element: <VendorCreatePage />,
          },
          {
            id: 'erp2-vendors-detail',
            path: 'vendors/:vendorId',
            element: <VendorDetailPage />,
          },
          {
            id: 'erp2-vendors-edit',
            path: 'vendors/:vendorId/edit',
            element: <VendorEditPage />,
          },
          {
            id: 'erp2-purchase-orders',
            path: 'purchase-orders',
            element: <PurchaseOrdersListPage />,
          },
          {
            id: 'erp2-purchase-orders-create',
            path: 'purchase-orders/new',
            element: <PurchaseOrderCreatePage />,
          },
          {
            id: 'erp2-purchase-orders-detail',
            path: 'purchase-orders/:purchaseOrderId',
            element: <PurchaseOrderDetailPage />,
          },
          {
            id: 'erp2-import-receipts',
            path: 'import-receipts',
            element: <ImportReceiptsListPage />,
          },
          {
            id: 'erp2-duplicates',
            path: 'duplicates',
            element: <DuplicateCandidatesPage />,
          },
          {
            id: 'erp2-rejection-review',
            path: 'rejection-review',
            element: <VendorRejectionReviewPage />,
          },
          {
            id: 'erp2-not-found',
            path: '*',
            element: <ModuleNotFoundPage />,
          },
        ],
      },
    ],
  },
];

export default erp2Routes;
