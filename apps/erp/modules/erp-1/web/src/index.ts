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
export * from './pages/ProductsListPage.js';
export * from './pages/ProductDetailPage.js';
export * from './pages/ProductImportPage.js';
export * from './pages/ProductRejectionReviewPage.js';
export * from './kit-metadata.js';
export * from './rejection-context.js';



