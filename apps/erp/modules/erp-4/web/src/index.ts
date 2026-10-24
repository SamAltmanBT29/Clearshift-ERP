/**
 * ERP-4 Finance and Accounting — Web Package Entry Point
 *
 * Public exports for the shared application shell, router, and page components.
 *
 * @module erp4/web
 */

export * from './route-manifest.js';
export * from './routes.js';
export * from './auth/RequireAuth.js';
export * from './auth/session.js';
export * from './components/ModuleShell.js';
export * from './components/ModuleNav.js';
export * from './components/ModuleBreadcrumbs.js';
export * from './components/AccountsTable.js';
export * from './components/JournalEntriesTable.js';
export * from './components/TrialBalanceTable.js';
export * from './components/FilterBar.js';
export * from './components/StateViews.js';
export * from './components/Toast.js';
export * from './components/forms/AccountForm.js';
export * from './components/forms/AccountCreateModal.js';
export * from './components/AccessDeniedView.js';
export * from './components/AccountAuditPanel.js';
export * from './components/AccountLinkedRecordsTable.js';
export * from './components/AccountEditDrawer.js';
export * from './components/Toast.js';
export * from './utils/error-sanitizer.js';
export * from './pages/AccountsListPage.js';
export * from './pages/AccountCreatePage.js';
export * from './pages/AccountDetailPage.js';
export * from './pages/AccountEditPage.js';
export * from './pages/JournalEntriesListPage.js';
export * from './pages/JournalEntryFormPage.js';
export * from './pages/JournalEntryDetailPage.js';
export * from './pages/TrialBalancePage.js';
export * from './pages/DataHealthProfilePage.js';
export * from './pages/DataCleaningReviewPage.js';
export * from './pages/DataMappingConfigPage.js';
export * from './pages/ModuleNotFoundPage.js';
