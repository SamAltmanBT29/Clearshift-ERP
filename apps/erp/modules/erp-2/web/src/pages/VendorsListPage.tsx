/**
 * ERP-2 Vendors & Purchasing — Main List Page
 *
 * Implements search, filters, and sorting controls for ERP2-18 (Issue #134):
 *   - Debounced search bar (300ms) via SearchBar component (AC1)
 *   - Faceted filter sidebar (currency for vendors, status for POs) (AC2)
 *   - Active filter pill tags with individual clear + Clear All (AC3)
 *   - Empty state with informative message when no results match (AC4)
 *   - URL query parameter sync for search, status, currency, page, pageSize, sort, order
 *
 * @module erp2/web/pages/VendorsListPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  Vendor,
  VendorListQuery,
  PurchaseOrder,
  PurchaseOrderListQuery,
} from '@clearshift/contracts';
import { fetchVendors, fetchPurchaseOrders, ApiError } from '../api/erp-2.js';
import { VendorsTable } from '../components/VendorsTable.js';
import { PurchaseOrdersTable } from '../components/PurchaseOrdersTable.js';
import { VendorFilterBar, PurchaseOrderFilterBar } from '../components/FilterBar.js';
import { VendorFilterSidebar, POFilterSidebar } from '../components/FilterSidebar.js';
import { FilterPillTags } from '../components/FilterPillTags.js';
import type { Erp2ActiveFilters, Erp2FilterKey } from '../components/FilterPillTags.js';
import {
  ErrorState,
  AccessDeniedState,
  VendorsLoadingSkeleton,
  PurchaseOrdersLoadingSkeleton,
  sanitizeErrorMessage,
} from '../components/StateViews.js';
import { VendorCreateModal, PurchaseOrderCreateModal } from '../components/forms/index.js';
import { VendorImportPage } from './VendorImportPage.js';

// ─── URL param helpers ─────────────────────────────────────────────────────────

function parseVendorFiltersFromUrl(): Partial<VendorListQuery & { currency?: string | undefined }> {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  const q: Partial<VendorListQuery & { currency?: string | undefined }> = {};
  const search = p.get('search');
  if (search) q.search = search;
  const currency = p.get('currency');
  if (currency) q.currency = currency;
  const page = p.get('page');
  if (page) q.page = Number(page);
  const pageSize = p.get('pageSize');
  if (pageSize) q.pageSize = Math.min(100, Number(pageSize));
  return q;
}

function parsePOFiltersFromUrl(): Partial<PurchaseOrderListQuery> {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  const q: Partial<PurchaseOrderListQuery> = {};
  const status = p.get('status');
  if (status) q.status = status as PurchaseOrderListQuery['status'];
  const vendor_id = p.get('vendor_id');
  if (vendor_id) q.vendor_id = vendor_id;
  const page = p.get('page');
  if (page) q.page = Number(page);
  const pageSize = p.get('pageSize');
  if (pageSize) q.pageSize = Math.min(100, Number(pageSize));
  return q;
}

function updateUrl(params: Record<string, string | number | undefined>) {
  if (typeof window === 'undefined') return;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) {
      p.set(k, String(v));
    }
  }
  const qs = p.toString();
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

// ─── Sorting state ────────────────────────────────────────────────────────────

interface SortState {
  field: string | undefined;
  direction: 'asc' | 'desc';
}

const DEFAULT_VENDOR_SORT: SortState = { field: undefined, direction: 'asc' };
const DEFAULT_ORDER_SORT: SortState = { field: undefined, direction: 'asc' };

export interface VendorsListPageProps {
  onCreateVendor?: (() => void) | undefined;
  onCreatePurchaseOrder?: (() => void) | undefined;
  onNavigateImport?: (() => void) | undefined;
  onNavigateRejections?: (() => void) | undefined;
  initialView?: 'list' | 'import' | undefined;
}

interface PageErrorInfo {
  message: string;
  isForbidden: boolean;
  correlationId?: string | undefined;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const VendorsListPage: React.FC<VendorsListPageProps> = ({
  onCreateVendor,
  onCreatePurchaseOrder,
  onNavigateImport,
  onNavigateRejections,
  initialView = 'list',
}) => {
  const [activeTab, setActiveTab] = useState<'vendors' | 'orders'>('vendors');
  const [isImportView, setIsImportView] = useState<boolean>(initialView === 'import');

  // ── Modal & Toast states (AC4) ──
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── Vendor sidebar collapse ──
  const [vendorSidebarOpen, setVendorSidebarOpen] = useState(true);
  const [poSidebarOpen, setPoSidebarOpen] = useState(true);

  // ── Vendors state ──
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsTotal, setVendorsTotal] = useState(0);
  const [vendorsTotalPages, setVendorsTotalPages] = useState(1);
  const [isVendorsLoading, setIsVendorsLoading] = useState(true);
  const [vendorsError, setVendorsError] = useState<PageErrorInfo | null>(null);

  const [vendorFilters, setVendorFilters] = useState<VendorListQuery & { currency?: string | undefined }>(() => ({
    page: 1,
    pageSize: 20,
    search: '',
    ...parseVendorFiltersFromUrl(),
  }));
  const [vendorSort, setVendorSort] = useState<SortState>(DEFAULT_VENDOR_SORT);

  // ── Purchase Orders state ──
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [isOrdersLoading, setIsOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<PageErrorInfo | null>(null);

  const [orderFilters, setOrderFilters] = useState<PurchaseOrderListQuery>(() => ({
    page: 1,
    pageSize: 20,
    status: undefined,
    vendor_id: undefined,
    ...parsePOFiltersFromUrl(),
  }));
  const [orderSort, setOrderSort] = useState<SortState>(DEFAULT_ORDER_SORT);

  // ── Data loaders ──
  const loadVendors = useCallback(async (filters: VendorListQuery & { currency?: string | undefined }, sort: SortState) => {
    setIsVendorsLoading(true);
    setVendorsError(null);
    try {
      const response = await fetchVendors({
        page: filters.page,
        pageSize: filters.pageSize,
        search: filters.search,
        // currency is a client-side facet (not in API) — filtered locally below
      });
      let items = response.items || [];
      // Client-side currency filter (API does not support currency query)
      if (filters.currency) {
        items = items.filter((v) => v.currency === filters.currency);
      }
      // Client-side sort (already sorted server-side if sort.field undefined)
      if (sort.field) {
        items = [...items].sort((a, b) => {
          const valA = (a as Record<string, unknown>)[sort.field!];
          const valB = (b as Record<string, unknown>)[sort.field!];
          if (valA === valB) return 0;
          if (valA == null) return 1;
          if (valB == null) return -1;
          const cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
          return sort.direction === 'desc' ? -cmp : cmp;
        });
      }
      setVendors(items);
      setVendorsTotal(response.total || 0);
      setVendorsTotalPages(response.totalPages || 1);
    } catch (err: unknown) {
      const isForbidden = err instanceof ApiError ? err.status === 403 : (err as { status?: number })?.status === 403;
      const correlationId = (err as { correlationId?: string })?.correlationId;
      setVendorsError({
        message: sanitizeErrorMessage(err),
        isForbidden,
        correlationId,
      });
    } finally {
      setIsVendorsLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async (filters: PurchaseOrderListQuery, sort: SortState) => {
    setIsOrdersLoading(true);
    setOrdersError(null);
    try {
      const response = await fetchPurchaseOrders({
        page: filters.page,
        pageSize: filters.pageSize,
        status: filters.status,
        vendor_id: filters.vendor_id,
      });
      let items = response.items || [];
      if (sort.field) {
        items = [...items].sort((a, b) => {
          const valA = (a as Record<string, unknown>)[sort.field!];
          const valB = (b as Record<string, unknown>)[sort.field!];
          if (valA === valB) return 0;
          if (valA == null) return 1;
          if (valB == null) return -1;
          const cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
          return sort.direction === 'desc' ? -cmp : cmp;
        });
      }
      setOrders(items);
      setOrdersTotal(response.total || 0);
      setOrdersTotalPages(response.totalPages || 1);
    } catch (err: unknown) {
      const isForbidden = err instanceof ApiError ? err.status === 403 : (err as { status?: number })?.status === 403;
      const correlationId = (err as { correlationId?: string })?.correlationId;
      setOrdersError({
        message: sanitizeErrorMessage(err),
        isForbidden,
        correlationId,
      });
    } finally {
      setIsOrdersLoading(false);
    }
  }, []);

  // ── Effects ──
  useEffect(() => {
    if (activeTab === 'vendors') {
      updateUrl({
        search: vendorFilters.search,
        currency: vendorFilters.currency,
        page: vendorFilters.page !== 1 ? vendorFilters.page : undefined,
        pageSize: vendorFilters.pageSize !== 20 ? vendorFilters.pageSize : undefined,
        sort: vendorSort.field,
        order: vendorSort.field ? vendorSort.direction : undefined,
      });
      loadVendors(vendorFilters, vendorSort);
    }
  }, [activeTab, vendorFilters, vendorSort, loadVendors]);

  useEffect(() => {
    if (activeTab === 'orders') {
      updateUrl({
        status: orderFilters.status,
        vendor_id: orderFilters.vendor_id,
        page: orderFilters.page !== 1 ? orderFilters.page : undefined,
        pageSize: orderFilters.pageSize !== 20 ? orderFilters.pageSize : undefined,
        sort: orderSort.field,
        order: orderSort.field ? orderSort.direction : undefined,
      });
      loadOrders(orderFilters, orderSort);
    }
  }, [activeTab, orderFilters, orderSort, loadOrders]);

  // ── Sort handlers ──
  const handleVendorSortChange = useCallback((field: string) => {
    setVendorSort((prev) => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const handleOrderSortChange = useCallback((field: string) => {
    setOrderSort((prev) => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  // ── Pill tag handlers for vendors ──
  const vendorActivePillFilters: Erp2ActiveFilters = {
    search: vendorFilters.search,
    currency: vendorFilters.currency,
  };

  const handleRemoveVendorFilter = useCallback((key: Erp2FilterKey) => {
    setVendorFilters((prev) => ({
      ...prev,
      [key]: key === 'search' ? '' : undefined,
      page: 1,
    }));
  }, []);

  const handleClearAllVendorFilters = useCallback(() => {
    setVendorFilters({ page: 1, pageSize: 20, search: '' });
    setVendorSort(DEFAULT_VENDOR_SORT);
  }, []);

  // ── Pill tag handlers for orders ──
  const orderActivePillFilters: Erp2ActiveFilters = {
    status: orderFilters.status,
    vendor_id: orderFilters.vendor_id,
  };

  const handleRemoveOrderFilter = useCallback((key: Erp2FilterKey) => {
    setOrderFilters((prev) => ({
      ...prev,
      [key]: undefined,
      page: 1,
    }));
  }, []);

  const handleClearAllOrderFilters = useCallback(() => {
    setOrderFilters({ page: 1, pageSize: 20, status: undefined, vendor_id: undefined });
    setOrderSort(DEFAULT_ORDER_SORT);
  }, []);

  const handleCreateVendor = useCallback(() => {
    if (onCreateVendor) {
      onCreateVendor();
    } else if (typeof window !== 'undefined' && window.location) {
      window.location.href = '/erp2/vendors/new';
    }
  }, [onCreateVendor]);

  const handleCreatePurchaseOrder = useCallback(() => {
    if (onCreatePurchaseOrder) {
      onCreatePurchaseOrder();
    } else if (typeof window !== 'undefined' && window.location) {
      window.location.href = '/erp2/purchase-orders/new';
    }
  }, [onCreatePurchaseOrder]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (isImportView) {
    return (
      <VendorImportPage
        onNavigateBack={() => setIsImportView(false)}
      />
    );
  }

  return (
    <div className="cs-module-root">
      {/* Page Header */}
      <header className="cs-page-header">
        <div className="cs-page-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 className="cs-page-title">Vendors &amp; Purchasing</h1>
            <p className="cs-page-description">
              Manage supplier catalog, masked bank details, purchase order lifecycles, and product-linked line items (ERP-2).
            </p>
          </div>
          <div className="cs-page-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className="cs-btn-secondary"
              data-testid="btn-view-rejections"
              onClick={() => onNavigateRejections?.()}
              aria-label="View Migration Rejections"
              title="Review rejected rows from most recent import batch"
            >
              View Rejections
            </button>
            <button
              type="button"
              className="cs-btn-secondary cs-import-btn"
              data-testid="btn-import-data"
              onClick={() => {
                setIsImportView(true);
                onNavigateImport?.();
              }}
              aria-label="Import Data"
              title="Import data through shared Migration Kit wizard"
            >
              Import Data
            </button>
            {activeTab === 'vendors' ? (
              vendorsTotal > 0 && (
                <button
                  type="button"
                  className="cs-btn-primary"
                  onClick={onCreateVendor ?? (() => setIsVendorModalOpen(true))}
                  aria-label="Add Vendor"
                >
                  + Add Vendor
                </button>
              )
            ) : (
              ordersTotal > 0 && (
                <button
                  type="button"
                  className="cs-btn-primary"
                  onClick={onCreatePurchaseOrder ?? (() => setIsPoModalOpen(true))}
                  aria-label="New Purchase Order"
                >
                  + New Purchase Order
                </button>
              )
            )}
          </div>
        </div>
      </header>

      {/* Confirmation Toast Notification (AC4) */}
      {toastMessage && (
        <div
          className="cs-erp2-toast-container"
          role="status"
          aria-live="polite"
          style={{ marginBottom: '16px' }}
        >
          <div className="cs-erp2-toast" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--color-bg-surface, #f0fdf4)', border: '1px solid var(--color-border-success, #86efac)', borderRadius: '6px', color: 'var(--color-text-success, #166534)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="cs-erp2-toast-icon" aria-hidden="true">✓</span>
              <span className="cs-erp2-toast-text" style={{ fontWeight: 500 }}>{toastMessage}</span>
            </div>
            <button
              type="button"
              className="cs-erp2-toast-close"
              aria-label="Close notification"
              onClick={() => setToastMessage(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '4px' }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <nav className="cs-tabs-container" aria-label="Vendors and purchase order views">
        <button
          type="button"
          className={`cs-tab-btn ${activeTab === 'vendors' ? 'active' : ''}`}
          onClick={() => setActiveTab('vendors')}
          aria-selected={activeTab === 'vendors'}
          role="tab"
        >
          Vendors {vendorsTotal > 0 && `(${vendorsTotal})`}
        </button>
        <button
          type="button"
          className={`cs-tab-btn ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => setActiveTab('orders')}
          aria-selected={activeTab === 'orders'}
          role="tab"
        >
          Purchase Orders {ordersTotal > 0 && `(${ordersTotal})`}
        </button>
      </nav>

      {/* ── Vendors Tab ── */}
      {activeTab === 'vendors' ? (
        <main className="cs-erp2-content-with-sidebar">
          {/* Faceted filter sidebar */}
          <VendorFilterSidebar
            filters={{ currency: vendorFilters.currency }}
            onFilterChange={(updated) =>
              setVendorFilters((prev) => ({
                ...prev,
                currency: updated.currency !== undefined ? updated.currency : prev.currency,
                page: 1,
              }))
            }
            onResetFilters={handleClearAllVendorFilters}
            isLoading={isVendorsLoading}
            isOpen={vendorSidebarOpen}
            onToggle={() => setVendorSidebarOpen((v) => !v)}
          />

          <div className="cs-erp2-content-main">
            {/* Debounced search bar (AC1) */}
            <VendorFilterBar
              filters={vendorFilters}
              onFilterChange={(updated) =>
                setVendorFilters((prev) => ({ ...prev, ...updated, page: 1 }))
              }
              onReset={handleClearAllVendorFilters}
              isLoading={isVendorsLoading}
            />

            {/* Active filter pills (AC3) */}
            <FilterPillTags
              filters={vendorActivePillFilters}
              onRemoveFilter={handleRemoveVendorFilter}
              onClearAll={handleClearAllVendorFilters}
              disabled={isVendorsLoading}
            />

            {vendorsError ? (
              vendorsError.isForbidden ? (
                <AccessDeniedState
                  title="Access Denied"
                  message="You do not have permission to view vendor profiles. Please check your role assignments."
                  requiredCapability="module.read"
                />
              ) : (
                <ErrorState
                  title="Failed to Load Vendors"
                  message={vendorsError.message}
                  correlationId={vendorsError.correlationId}
                  onRetry={() => loadVendors(vendorFilters, vendorSort)}
                />
              )
            ) : isVendorsLoading ? (
              <VendorsLoadingSkeleton />
            ) : (
              <VendorsTable
                vendors={vendors}
                isLoading={isVendorsLoading}
                total={vendorsTotal}
                page={vendorFilters.page || 1}
                pageSize={vendorFilters.pageSize || 20}
                totalPages={vendorsTotalPages}
                hasActiveFilters={Boolean(vendorFilters.search || vendorFilters.currency)}
                onCreateVendor={onCreateVendor}
                onPageChange={(newPage: number) =>
                  setVendorFilters((prev) => ({
                    ...prev,
                    page: Math.max(1, Math.min(newPage, vendorsTotalPages || 1)),
                  }))
                }
                onRefresh={handleClearAllVendorFilters}
              />
            )}
          </div>
        </main>
      ) : (
        /* ── Purchase Orders Tab ── */
        <main className="cs-erp2-content-with-sidebar">
          {/* Faceted filter sidebar */}
          <POFilterSidebar
            filters={{ status: orderFilters.status }}
            onFilterChange={(updated) =>
              setOrderFilters((prev) => ({ ...prev, ...updated, page: 1 }))
            }
            onResetFilters={handleClearAllOrderFilters}
            isLoading={isOrdersLoading}
            isOpen={poSidebarOpen}
            onToggle={() => setPoSidebarOpen((v) => !v)}
          />

          <div className="cs-erp2-content-main">
            {/* Status filter bar */}
            <PurchaseOrderFilterBar
              filters={orderFilters}
              onFilterChange={(updated) =>
                setOrderFilters((prev) => ({ ...prev, ...updated, page: 1 }))
              }
              onReset={handleClearAllOrderFilters}
              isLoading={isOrdersLoading}
            />

            {/* Active filter pills (AC3) */}
            <FilterPillTags
              filters={orderActivePillFilters}
              onRemoveFilter={handleRemoveOrderFilter}
              onClearAll={handleClearAllOrderFilters}
              disabled={isOrdersLoading}
            />

            {ordersError ? (
              ordersError.isForbidden ? (
                <AccessDeniedState
                  title="Access Denied"
                  message="You do not have permission to view purchase orders. Please check your role assignments."
                  requiredCapability="module.read"
                />
              ) : (
                <ErrorState
                  title="Failed to Load Purchase Orders"
                  message={ordersError.message}
                  correlationId={ordersError.correlationId}
                  onRetry={() => loadOrders(orderFilters, orderSort)}
                />
              )
            ) : isOrdersLoading ? (
              <PurchaseOrdersLoadingSkeleton />
            ) : (
              <PurchaseOrdersTable
                purchaseOrders={orders}
                isLoading={isOrdersLoading}
                total={ordersTotal}
                page={orderFilters.page || 1}
                pageSize={orderFilters.pageSize || 20}
                totalPages={ordersTotalPages}
                hasActiveFilters={Boolean(orderFilters.status || orderFilters.vendor_id)}
                onCreatePurchaseOrder={onCreatePurchaseOrder}
                onPageChange={(newPage: number) =>
                  setOrderFilters((prev) => ({
                    ...prev,
                    page: Math.max(1, Math.min(newPage, ordersTotalPages || 1)),
                  }))
                }
                onRefresh={handleClearAllOrderFilters}
              />
            )}
          </div>
        </main>
      )}

      {/* Vendor Creation Modal (AC4) */}
      <VendorCreateModal
        isOpen={isVendorModalOpen}
        onClose={() => setIsVendorModalOpen(false)}
        onVendorCreated={(created) => {
          // Update table cache
          setVendors((prev) => [created, ...prev]);
          setVendorsTotal((prev) => prev + 1);
          // Show confirmation toast
          setToastMessage(`Vendor "${created.name}" created successfully.`);
        }}
      />

      {/* Purchase Order Creation Modal (AC4) */}
      <PurchaseOrderCreateModal
        isOpen={isPoModalOpen}
        onClose={() => setIsPoModalOpen(false)}
        onOrderCreated={(created) => {
          // Update table cache
          setOrders((prev) => [created, ...prev]);
          setOrdersTotal((prev) => prev + 1);
          // Show confirmation toast
          setToastMessage(`Purchase Order "${created.po_number}" created successfully.`);
        }}
      />
    </div>
  );
};

export default VendorsListPage;
