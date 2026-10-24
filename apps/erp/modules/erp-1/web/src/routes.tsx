/**
 * ERP-1 Products & Inventory — Module Route Table
 *
 * The React Router route objects of the module:
 *   `/erp1`                → `RequireAuth`  — authentication gate for the module
 *     └─ (layout)          → `ModuleShell`  — landmarks, navigation, title
 *          └─ (children)   → the screens
 *
 * @module erp1/web/routes
 */

import React from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth.js';
import { ModuleShell } from './components/ModuleShell.js';
import { ProductsListPage } from './pages/ProductsListPage.js';
import { ProductCreatePage } from './pages/ProductCreatePage.js';
import { ProductDetailPage } from './pages/ProductDetailPage.js';
import { ProductEditPage } from './pages/ProductEditPage.js';
import { CategoriesListPage } from './pages/CategoriesListPage.js';
import { StockLevelsListPage } from './pages/StockLevelsListPage.js';
import { DuplicateCandidatesPage } from './pages/DuplicateCandidatesPage.js';
import { ProductImportPage } from './pages/ProductImportPage.js';
import { ProductRejectionReviewPage } from './pages/ProductRejectionReviewPage.js';
import { ModuleNotFoundPage } from './pages/ModuleNotFoundPage.js';
import { ERP1_BASE_PATH } from './route-manifest.js';

export const erp1Routes: RouteObject[] = [
  {
    id: 'erp1',
    path: ERP1_BASE_PATH,
    element: <RequireAuth />,
    children: [
      {
        id: 'erp1-shell',
        element: <ModuleShell />,
        children: [
          {
            id: 'erp1-index',
            index: true,
            element: <Navigate to={`${ERP1_BASE_PATH}/products`} replace />,
          },
          {
            id: 'erp1-products',
            path: 'products',
            element: <ProductsListPage />,
          },
          {
            id: 'erp1-products-create',
            path: 'products/new',
            element: <ProductCreatePage />,
          },
          {
            id: 'erp1-products-detail',
            path: 'products/:productId',
            element: <ProductDetailPage />,
          },
          {
            id: 'erp1-products-edit',
            path: 'products/:productId/edit',
            element: <ProductEditPage />,
          },
          {
            id: 'erp1-categories',
            path: 'categories',
            element: <CategoriesListPage />,
          },
          {
            id: 'erp1-stock',
            path: 'stock',
            element: <StockLevelsListPage />,
          },
          {
            id: 'erp1-duplicates',
            path: 'duplicates',
            element: <DuplicateCandidatesPage />,
          },
          {
            id: 'erp1-import',
            path: 'import',
            element: <ProductImportPage />,
          },
          {
            id: 'erp1-rejections',
            path: 'rejections',
            element: <ProductRejectionReviewPage />,
          },
          {
            id: 'erp1-not-found',
            path: '*',
            element: <ModuleNotFoundPage />,
          },
        ],
      },
    ],
  },
];

export default erp1Routes;
