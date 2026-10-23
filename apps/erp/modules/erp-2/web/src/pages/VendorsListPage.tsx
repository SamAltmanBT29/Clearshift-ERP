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
import { ErrorState, AccessDeniedState } from '../components/StateViews.js';

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

// ─── Component ────────────────────────────────────────────────────────────────

export const VendorsListPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'vendors' | 'orders'>('vendors');

  // ── Vendor sidebar collapse ──
  const [vendorSidebarOpen, setVendorSidebarOpen] = useState(true);
  const [poSidebarOpen, setPoSidebarOpen] = useState(true);

  // ── Vendors state ──
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsTotal, setVendorsTotal] = useState(0);
  const [vendorsTotalPages, setVendorsTotalPages] = useState(1);
  const [isVendorsLoading, setIsVendorsLoading] = useState(false);
  const [vendorsError, setVendorsError] = useState<{ message: string; isForbidden: boolean } | null>(null);

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
  const [ordersError, setOrdersError] = useState<{ message: string; isForbidden: boolean } | null>(null);

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
    } catch (err: any) {
      const isForbidden = err instanceof ApiError ? err.status === 403 : err?.status === 403;
      setVendorsError({
        message: err?.message || 'Failed to fetch vendors from server.',
        isForbidden,
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
    } catch (err: any) {
      const isForbidden = err instanceof ApiError ? err.status === 403 : err?.status === 403;
      setOrdersError({
        message: err?.message || 'Failed to fetch purchase orders from server.',
        isForbidden,
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

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="cs-module-root">
      {/* Page Header */}
      <header className="cs-page-header">
        <h1 className="cs-page-title">Vendors &amp; Purchasing</h1>
        <p className="cs-page-description">
          Manage supplier catalog, masked bank details, purchase order lifecycles, and product-linked line items (ERP-2).
        </p>
      </header>

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
                />
              ) : (
                <ErrorState
                  title="Failed to Load Vendors"
                  message={vendorsError.message}
                  onRetry={() => loadVendors(vendorFilters, vendorSort)}
                />
              )
            ) : (
              <VendorsTable
                vendors={vendors}
                isLoading={isVendorsLoading}
                total={vendorsTotal}
                page={vendorFilters.page || 1}
                pageSize={vendorFilters.pageSize || 20}
                totalPages={vendorsTotalPages}
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
                />
              ) : (
                <ErrorState
                  title="Failed to Load Purchase Orders"
                  message={ordersError.message}
                  onRetry={() => loadOrders(orderFilters, orderSort)}
                />
              )
            ) : (
              <PurchaseOrdersTable
                purchaseOrders={orders}
                isLoading={isOrdersLoading}
                total={ordersTotal}
                page={orderFilters.page || 1}
                pageSize={orderFilters.pageSize || 20}
                totalPages={ordersTotalPages}
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
    </div>
  );
};

export default VendorsListPage;
