/**
 * ERP-4 Finance and Accounting — Module Route Table
 *
 * Route definitions for React Router:
 *
 *   `/erp4`                              → `RequireAuth`  (Authentication guard)
 *     └─ (layout)                        → `ModuleShell`  (Landmarks, banner, navigation, breadcrumbs)
 *          └─ (index)                    → redirects to `/erp4/accounts`
 *          └─ `accounts`                 → `AccountsListPage`
 *          └─ `accounts/new`             → `AccountCreatePage`
 *          └─ `accounts/:accountId`      → `AccountDetailPage`
 *          └─ `accounts/:accountId/edit` → `AccountEditPage`
 *          └─ `journal-entries`          → `JournalEntriesListPage`
 *          └─ `journal-entries/new`      → `JournalEntryFormPage`
 *          └─ `journal-entries/:entryId` → `JournalEntryDetailPage`
 *          └─ `journal-entries/:entryId/edit` → `JournalEntryDetailPage`
 *          └─ `trial-balance`            → `TrialBalancePage`
 *          └─ `migration/profile`        → `DataHealthProfilePage`
 *          └─ `migration/clean`          → `DataCleaningReviewPage`
 *          └─ `migration/mapping`        → `DataMappingConfigPage`
 *          └─ `*`                        → `ModuleNotFoundPage`
 *
 * Architecture references:
 * - ClearShift V1 Master Architecture Spec §3.1 & §6.1
 * - SDS ClearShift ERP v2.0 §4.4 & §4.9
 * - Gate G1 & Issue #172 (ERP4-16)
 *
 * @module erp4/web/routes
 */

import React from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth.js';
import { ModuleShell } from './components/ModuleShell.js';
import { AccountsListPage } from './pages/AccountsListPage.js';
import { AccountCreatePage } from './pages/AccountCreatePage.js';
import { AccountDetailPage } from './pages/AccountDetailPage.js';
import { AccountEditPage } from './pages/AccountEditPage.js';
import { JournalEntriesListPage } from './pages/JournalEntriesListPage.js';
import { JournalEntryFormPage } from './pages/JournalEntryFormPage.js';
import { JournalEntryDetailPage } from './pages/JournalEntryDetailPage.js';
import { TrialBalancePage } from './pages/TrialBalancePage.js';
import { DataHealthProfilePage } from './pages/DataHealthProfilePage.js';
import { DataCleaningReviewPage } from './pages/DataCleaningReviewPage.js';
import { DataMappingConfigPage } from './pages/DataMappingConfigPage.js';
import { ModuleNotFoundPage } from './pages/ModuleNotFoundPage.js';
import { ERP4_BASE_PATH } from './route-manifest.js';

export const erp4Routes: RouteObject[] = [
  {
    id: 'erp4',
    path: ERP4_BASE_PATH,
    element: <RequireAuth />,
    children: [
      {
        id: 'erp4-shell',
        element: <ModuleShell />,
        children: [
          {
            id: 'erp4-index',
            index: true,
            element: <Navigate to="/erp4/accounts" replace />,
          },
          {
            id: 'erp4-accounts',
            path: 'accounts',
            element: <AccountsListPage />,
          },
          {
            id: 'erp4-accounts-create',
            path: 'accounts/new',
            element: <AccountCreatePage />,
          },
          {
            id: 'erp4-accounts-detail',
            path: 'accounts/:accountId',
            element: <AccountDetailPage />,
          },
          {
            id: 'erp4-accounts-edit',
            path: 'accounts/:accountId/edit',
            element: <AccountEditPage />,
          },
          {
            id: 'erp4-journal-entries',
            path: 'journal-entries',
            element: <JournalEntriesListPage />,
          },
          {
            id: 'erp4-journal-entries-create',
            path: 'journal-entries/new',
            element: <JournalEntryFormPage />,
          },
          {
            id: 'erp4-journal-entries-detail',
            path: 'journal-entries/:entryId',
            element: <JournalEntryDetailPage />,
          },
          {
            id: 'erp4-journal-entries-edit',
            path: 'journal-entries/:entryId/edit',
            element: <JournalEntryDetailPage />,
          },
          {
            id: 'erp4-trial-balance',
            path: 'trial-balance',
            element: <TrialBalancePage />,
          },
          {
            id: 'erp4-migration-profile',
            path: 'migration/profile',
            element: <DataHealthProfilePage />,
          },
          {
            id: 'erp4-migration-clean',
            path: 'migration/clean',
            element: <DataCleaningReviewPage />,
          },
          {
            id: 'erp4-migration-mapping',
            path: 'migration/mapping',
            element: <DataMappingConfigPage />,
          },
          {
            id: 'erp4-not-found',
            path: '*',
            element: <ModuleNotFoundPage />,
          },
        ],
      },
    ],
  },
];

export default erp4Routes;
