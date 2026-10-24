/**
 * ERP-1 Products & Inventory Web Module Entrypoint
 *
 * Exports primary collection screens, search/filter bars, faceted sidebar,
 * active filter pills, sorting controls, table, API client, and state boundaries.
 *
 * @module erp1/web
 */

export * from './api/erp-1.js';
export * from './hooks/useDebouncedValue.js';
export * from './hooks/useProductForm.js';
export * from './hooks/useProductEditForm.js';
export * from './components/SearchBar.js';
export * from './components/FacetedFilterSidebar.js';
export * from './components/FilterPillTags.js';
export * from './components/SortingControls.js';
export * from './components/ProductsTable.js';
export * from './components/StateViews.js';
export * from './components/ProductCreateModal.js';
export * from './components/ProductAuditPanel.js';
export * from './components/ProductLinkedRecordsTable.js';
export * from './components/ProductEditDrawer.js';
export * from './components/DuplicateReviewModal.js';
export * from './pages/ProductsListPage.js';
export * from './pages/ProductDetailPage.js';
export * from './pages/ProductImportPage.js';
export * from './pages/ProductRejectionReviewPage.js';
export * from './pages/DuplicateCandidatesPage.js';
export * from './pages/CategoriesListPage.js';
export * from './pages/StockLevelsListPage.js';
export * from './pages/ProductCreatePage.js';
export * from './pages/ProductEditPage.js';
export * from './pages/ModuleNotFoundPage.js';
export * from './kit-metadata.js';
export * from './rejection-context.js';
export * from './route-manifest.js';
export * from './routes.js';
export * from './auth/session.js';
export * from './auth/RequireAuth.js';
export * from './components/ModuleShell.js';
export * from './components/ModuleNav.js';
export * from './components/ModuleBreadcrumbs.js';
