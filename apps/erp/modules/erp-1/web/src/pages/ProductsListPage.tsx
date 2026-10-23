import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  Product,
  Category,
  UnitOfMeasure,
  ProductSortField,
  StockStatusFilter,
  ProductListQuery,
} from '@clearshift/contracts';
import { PageTitle, Alert } from '@cs/ui';
import {
  fetchProducts,
  fetchCategories,
  buildProductQueryParams,
  Erp1ApiError,
} from '../api/erp-1.js';
import { SearchBar } from '../components/SearchBar.js';
import {
  FacetedFilterSidebar,
  type FacetedFiltersState,
} from '../components/FacetedFilterSidebar.js';
import {
  FilterPillTags,
  type ActiveFiltersState,
} from '../components/FilterPillTags.js';
import { SortingControls } from '../components/SortingControls.js';
import { ProductsTable, type ProductWithStock } from '../components/ProductsTable.js';
import {
  ProductsLoadingSkeleton,
  EmptyProductsView,
  ErrorProductsView,
  AccessDeniedProductsView,
} from '../components/StateViews.js';
import { ProductCreateModal } from '../components/ProductCreateModal.js';
import { ProductDetailPage } from './ProductDetailPage.js';
import { ProductImportPage } from './ProductImportPage.js';

export interface ProductsListPageProps {
  /** Optional initial filters passed by host shell or router */
  initialFilters?: Partial<ProductListQuery> | undefined;
  /** Optional callback when URL query changes */
  onQueryChange?: ((queryString: string) => void) | undefined;
  /** Optional callback when operator triggers "Add Product" action */
  onCreateProduct?: (() => void) | undefined;
  /** Optional callback when a product is created successfully */
  onProductCreated?: ((product: Product) => void) | undefined;
  /** Optional callback when a product is selected for detail/edit */
  onSelectProduct?: ((product: Product) => void) | undefined;
  /** Optional initial view: list or import */
  initialView?: 'list' | 'import' | undefined;
  /** Optional callback when navigating to migration kit import */
  onNavigateImport?: (() => void) | undefined;
  /** Optional permissions array for access control */
  userPermissions?: readonly string[] | undefined;
}


function parseFiltersFromUrl(): Partial<ProductListQuery> {
  if (typeof window === 'undefined' || !window.location) {
    return {};
  }
  const params = new URLSearchParams(window.location.search);
  const q: Partial<ProductListQuery> = {};

  const search = params.get('search');
  if (search) q.search = search;

  const categoryId = params.get('categoryId');
  if (categoryId) q.categoryId = categoryId;

  const unitOfMeasure = params.get('unitOfMeasure');
  if (unitOfMeasure) q.unitOfMeasure = unitOfMeasure as UnitOfMeasure;

  const stockStatus = params.get('stockStatus');
  if (stockStatus) q.stockStatus = stockStatus as StockStatusFilter;

  const minPrice = params.get('minPrice');
  if (minPrice) q.minPrice = minPrice;

  const maxPrice = params.get('maxPrice');
  if (maxPrice) q.maxPrice = maxPrice;

  const sortBy = params.get('sortBy');
  if (sortBy) q.sortBy = sortBy as ProductSortField;

  const sortDirection = params.get('sortDirection');
  if (sortDirection === 'asc' || sortDirection === 'desc') {
    q.sortDirection = sortDirection;
  }

  const page = params.get('page');
  if (page) q.page = parseInt(page, 10) || 1;

  const pageSize = params.get('pageSize');
  if (pageSize) q.pageSize = parseInt(pageSize, 10) || 25;

  return q;
}

function syncUrlWithFilters(
  query: Partial<ProductListQuery>,
  onQueryChange?: ((qs: string) => void) | undefined
) {
  if (typeof window === 'undefined' || !window.history || !window.location) {
    return;
  }
  const qs = buildProductQueryParams(query);
  const newUrl = `${window.location.pathname}${qs}${window.location.hash || ''}`;
  window.history.replaceState(null, '', newUrl);
  if (onQueryChange) {
    onQueryChange(qs);
  }
}

export const ProductsListPage: React.FC<ProductsListPageProps> = ({
  initialFilters,
  onQueryChange,
  onCreateProduct,
  onProductCreated,
  onSelectProduct,
  initialView,
  onNavigateImport,
  userPermissions,
}) => {

  // 1. Initial State Resolution from URL or Props
  const urlFilters = useMemo(() => parseFiltersFromUrl(), []);
  const initial = { ...urlFilters, ...initialFilters };

  const [search, setSearch] = useState<string>(initial.search || '');
  const [categoryId, setCategoryId] = useState<string | undefined>(initial.categoryId);
  const [unitOfMeasure, setUnitOfMeasure] = useState<UnitOfMeasure | undefined>(initial.unitOfMeasure);
  const [stockStatus, setStockStatus] = useState<StockStatusFilter | undefined>(initial.stockStatus);
  const [minPrice, setMinPrice] = useState<string | undefined>(
    initial.minPrice !== undefined ? String(initial.minPrice) : undefined
  );
  const [maxPrice, setMaxPrice] = useState<string | undefined>(
    initial.maxPrice !== undefined ? String(initial.maxPrice) : undefined
  );
  const [sortBy, setSortBy] = useState<ProductSortField>(initial.sortBy || 'name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(initial.sortDirection || 'asc');
  const [page, setPage] = useState<number>(initial.page || 1);
  const [pageSize, setPageSize] = useState<number>(initial.pageSize || 25);

  // Mobile sidebar drawer state
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Creation modal & Confirmation toast state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Selected product detail view state
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  // Migration Kit import view state
  const [isImportView, setIsImportView] = useState<boolean>(initialView === 'import');


  // 2. Data state
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Erp1ApiError | null>(null);

  // Load Categories on mount for facet sidebar
  useEffect(() => {
    let active = true;
    fetchCategories({ page: 1, pageSize: 100 })
      .then((res) => {
        if (active) {
          setCategories(res.items);
        }
      })
      .catch((err) => {
        console.error('Failed to load categories for filter sidebar:', err);
      });
    return () => {
      active = false;
    };
  }, []);

  // 3. Construct active query
  const activeQuery = useMemo<ProductListQuery>(
    () => ({
      search: search.trim() ? search.trim() : undefined,
      categoryId,
      unitOfMeasure,
      stockStatus: stockStatus && stockStatus !== 'all' ? stockStatus : undefined,
      minPrice: minPrice ? minPrice : undefined,
      maxPrice: maxPrice ? maxPrice : undefined,
      sortBy,
      sortDirection,
      page,
      pageSize,
    }),
    [search, categoryId, unitOfMeasure, stockStatus, minPrice, maxPrice, sortBy, sortDirection, page, pageSize]
  );

  // 4. Fetch Products whenever active query changes
  const executeFetch = useCallback(async (queryToFetch: ProductListQuery) => {
    setIsLoading(true);
    setError(null);
    try {
      // Synchronize URL query state
      syncUrlWithFilters(queryToFetch, onQueryChange);

      const response = await fetchProducts(queryToFetch);
      setProducts(response.items as ProductWithStock[]);
      setTotal(response.total);
      setTotalPages(response.totalPages || Math.ceil(response.total / (queryToFetch.pageSize || 25)) || 1);
    } catch (err: any) {
      if (err instanceof Erp1ApiError) {
        setError(err);
      } else {
        setError(
          new Erp1ApiError(
            err?.status || 500,
            err?.code || 'UNKNOWN_ERROR',
            err?.message || 'Failed to fetch products from server'
          )
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [onQueryChange]);

  useEffect(() => {
    executeFetch(activeQuery);
  }, [activeQuery, executeFetch]);

  // Popstate listener to handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseFiltersFromUrl();
      setSearch(parsed.search || '');
      setCategoryId(parsed.categoryId);
      setUnitOfMeasure(parsed.unitOfMeasure);
      setStockStatus(parsed.stockStatus);
      setMinPrice(parsed.minPrice !== undefined ? String(parsed.minPrice) : undefined);
      setMaxPrice(parsed.maxPrice !== undefined ? String(parsed.maxPrice) : undefined);
      setSortBy(parsed.sortBy || 'name');
      setSortDirection(parsed.sortDirection || 'asc');
      setPage(parsed.page || 1);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Handlers for search, facets, pills, and sorting
  const handleSearchChange = (newSearch: string) => {
    setSearch(newSearch);
    setPage(1); // Reset pagination on search change
  };

  const handleFacetedChange = (updated: Partial<FacetedFiltersState>) => {
    if ('categoryId' in updated) setCategoryId(updated.categoryId);
    if ('unitOfMeasure' in updated) setUnitOfMeasure(updated.unitOfMeasure);
    if ('stockStatus' in updated) setStockStatus(updated.stockStatus);
    if ('minPrice' in updated) setMinPrice(updated.minPrice);
    if ('maxPrice' in updated) setMaxPrice(updated.maxPrice);
    setPage(1); // Reset pagination on filter change
  };

  const handleRemoveFilterPill = (filterKey: keyof ActiveFiltersState) => {
    switch (filterKey) {
      case 'search':
        setSearch('');
        break;
      case 'categoryId':
        setCategoryId(undefined);
        break;
      case 'unitOfMeasure':
        setUnitOfMeasure(undefined);
        break;
      case 'stockStatus':
        setStockStatus(undefined);
        break;
      case 'minPrice':
        setMinPrice(undefined);
        break;
      case 'maxPrice':
        setMaxPrice(undefined);
        break;
      case 'sortBy':
      case 'sortDirection':
        setSortBy('name');
        setSortDirection('asc');
        break;
    }
    setPage(1);
  };

  const handleClearAll = () => {
    setSearch('');
    setCategoryId(undefined);
    setUnitOfMeasure(undefined);
    setStockStatus(undefined);
    setMinPrice(undefined);
    setMaxPrice(undefined);
    setSortBy('name');
    setSortDirection('asc');
    setPage(1);
  };

  const handleSortChange = (newSortBy: ProductSortField, newDirection: 'asc' | 'desc') => {
    setSortBy(newSortBy);
    setSortDirection(newDirection);
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleOpenCreateModal = useCallback(() => {
    setIsCreateModalOpen(true);
    if (onCreateProduct) {
      onCreateProduct();
    }
  }, [onCreateProduct]);

  const hasActiveFilters = Boolean(
    search.trim() ||
      categoryId ||
      unitOfMeasure ||
      (stockStatus && stockStatus !== 'all') ||
      minPrice ||
      maxPrice ||
      (sortBy && sortBy !== 'name')
  );

  const facetedState: FacetedFiltersState = {
    categoryId,
    unitOfMeasure,
    stockStatus,
    minPrice,
    maxPrice,
  };

  const activePillsState: ActiveFiltersState = {
    search,
    categoryId,
    unitOfMeasure,
    stockStatus,
    minPrice,
    maxPrice,
    sortBy,
    sortDirection,
  };

  if (isImportView) {
    return (
      <ProductImportPage
        onNavigateBack={() => setIsImportView(false)}
      />
    );
  }

  if (selectedProductId) {
    const selectedProd = products.find((p) => p.id === selectedProductId) || null;
    return (
      <ProductDetailPage
        productId={selectedProductId}
        initialProduct={selectedProd}
        categories={categories}
        {...(userPermissions ? { userPermissions } : {})}
        onBack={() => setSelectedProductId(null)}
        onProductUpdated={(updated) => {
          setProducts((prev) =>
            prev.map((p) => (p.id === updated.id ? ({ ...p, ...updated } as ProductWithStock) : p))
          );
        }}
      />
    );
  }


  return (
    <div className="cs-erp1-module-root">
      {/* 1. Header */}
      <PageTitle
        title="Products & Inventory"
        subtitle="Search, filter, and manage catalog items, units of measure, and warehouse stock levels (ERP-1)."
      />

      {/* Confirmation Toast */}
      {toastMessage && (
        <div className="cs-erp1-toast-container" role="status" aria-live="polite">
          <Alert
            variant="success"
            title="Success"
            onDismiss={() => setToastMessage(null)}
          >
            {toastMessage}
          </Alert>
        </div>
      )}

      {/* 2. Top Toolbar (Search, Sort, Mobile Filter Toggle, Add Product) */}
      <div className="cs-erp1-toolbar">
        <div className="cs-erp1-toolbar-search">
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            disabled={isLoading}
          />
        </div>

        <div className="cs-erp1-toolbar-actions">
          <button
            type="button"
            className="cs-erp1-mobile-filter-btn"
            onClick={() => setIsMobileSidebarOpen(true)}
            aria-label="Open filter sidebar"
          >
            Filters {hasActiveFilters && '(Active)'}
          </button>

          <SortingControls
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            disabled={isLoading}
          />

          <button
            type="button"
            className="cs-erp1-btn cs-erp1-btn-secondary cs-erp1-import-btn"
            data-testid="btn-import-products"
            onClick={() => {
              setIsImportView(true);
              onNavigateImport?.();
            }}
            title="Import catalog data through shared Migration Kit wizard"
          >
            📥 Migration Kit
          </button>

          <button
            type="button"
            className="cs-erp1-btn cs-erp1-btn-primary cs-erp1-add-product-btn"
            onClick={handleOpenCreateModal}
          >
            + New Product
          </button>

        </div>
      </div>

      {/* 3. Active Filter Pill Tags */}
      <FilterPillTags
        filters={activePillsState}
        categories={categories}
        onRemoveFilter={handleRemoveFilterPill}
        onClearAll={handleClearAll}
        disabled={isLoading}
      />

      {/* 4. Main Two-Column Layout (Sidebar + Results) */}
      <div className="cs-erp1-layout-container">
        {/* Faceted Sidebar */}
        <FacetedFilterSidebar
          categories={categories}
          filters={facetedState}
          onFilterChange={handleFacetedChange}
          onResetFilters={handleClearAll}
          isLoading={isLoading}
          isOpenMobile={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
        />

        {/* Results Area */}
        <main className="cs-erp1-results-container" aria-label="Products list and results">
          {error?.isPermissionDenied ? (
            <AccessDeniedProductsView
              message={error.message}
              requiredCapability="inventory:read"
            />
          ) : error ? (
            <ErrorProductsView
              error={error}
              message={error.message}
              onRetry={() => executeFetch(activeQuery)}
            />
          ) : isLoading ? (
            <ProductsLoadingSkeleton />
          ) : products.length === 0 ? (
            <EmptyProductsView
              hasActiveFilters={hasActiveFilters}
              onClearFilters={handleClearAll}
              onCreateProduct={handleOpenCreateModal}
            />
          ) : (
            <ProductsTable
              products={products}
              categories={categories}
              isLoading={isLoading}
              total={total}
              page={page}
              pageSize={pageSize}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSort={(column) => {
                const nextDirection =
                  sortBy === column && sortDirection === 'asc' ? 'desc' : 'asc';
                handleSortChange(column, nextDirection);
              }}
              onSelectProduct={(p) => {
                setSelectedProductId(p.id);
                if (onSelectProduct) {
                  onSelectProduct(p);
                }
              }}
            />
          )}
        </main>
      </div>

      {/* Product Creation Modal */}
      <ProductCreateModal
        isOpen={isCreateModalOpen}
        categories={categories}
        onClose={() => setIsCreateModalOpen(false)}
        onProductCreated={(created) => {
          // Update table cache
          setProducts((prev) => [created as ProductWithStock, ...prev]);
          setTotal((prev) => prev + 1);
          // Show confirmation toast
          setToastMessage(`Product "${created.name}" (${created.sku}) created successfully.`);
          if (onProductCreated) {
            onProductCreated(created);
          }
        }}
      />
    </div>
  );
};

export default ProductsListPage;
