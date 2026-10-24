import React from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth.js';
import { ModuleShell } from './components/ModuleShell.js';
import { BatchListPage } from './pages/BatchListPage.js';
import { NewBatchWizardPage } from './pages/NewBatchWizardPage.js';
import { ProfileReportPage } from './pages/ProfileReportPage.js';
import { MappingRulesPage } from './pages/MappingRulesPage.js';
import { DuplicateReviewPage } from './pages/DuplicateReviewPage.js';
import { RunResultPage } from './pages/RunResultPage.js';
import { ReconciliationPage } from './pages/ReconciliationPage.js';
import { RejectListPage } from './pages/RejectListPage.js';
import { ModuleNotFoundPage } from './pages/ModuleNotFoundPage.js';
import { MIGRATION_KIT_BASE_PATH } from './route-manifest.js';

export const migrationKitRoutes: RouteObject[] = [
  {
    id: 'migration-kit',
    path: MIGRATION_KIT_BASE_PATH,
    element: <RequireAuth />,
    children: [
      {
        id: 'migration-kit-shell',
        element: <ModuleShell />,
        children: [
          { id: 'migration-kit-index', index: true, element: <Navigate to="/kit/batches" replace /> },
          { id: 'migration-kit-batches', path: 'batches', element: <BatchListPage /> },
          { id: 'migration-kit-batch-new', path: 'batches/new', element: <NewBatchWizardPage /> },
          { id: 'migration-kit-profile', path: 'batches/:batchId/profile', element: <ProfileReportPage /> },
          { id: 'migration-kit-mapping', path: 'batches/:batchId/mapping', element: <MappingRulesPage /> },
          { id: 'migration-kit-duplicates', path: 'batches/:batchId/duplicates', element: <DuplicateReviewPage /> },
          { id: 'migration-kit-result', path: 'batches/:batchId/result', element: <RunResultPage /> },
          { id: 'migration-kit-reconciliation', path: 'batches/:batchId/reconciliation', element: <ReconciliationPage /> },
          { id: 'migration-kit-rejects', path: 'batches/:batchId/rejects', element: <RejectListPage /> },
          { id: 'migration-kit-not-found', path: '*', element: <ModuleNotFoundPage /> },
        ],
      },
    ],
  },
];

export const kitRoutes = migrationKitRoutes;
export const routes = migrationKitRoutes;
export default migrationKitRoutes;