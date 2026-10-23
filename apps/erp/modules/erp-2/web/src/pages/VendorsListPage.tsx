/**
 * ERP-2 Vendors & Purchasing — Vendors and Purchase Orders Primary Collection Page
 *
 * Implements main paginated collection screen conforming to SDS §4.3 & §4.9:
 *   - Tabbed view: Vendors master catalog and Purchase Orders
 *   - Server-side bounded pagination with page and pageSize query parameters
 *   - Sortable column headers toggling ascending/descending order
 *   - URL search parameter synchronization
 *
 * @module erp2/web/pages/VendorsListPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  Vendor,
  VendorListQuery,
  PurchaseOrder,
  PurchaseOrderListQuery,
  PurchaseOrderStatus,
} from '@clearshift/contracts';
import { fetchVendors, fetchPurchaseOrders, ApiError } from '../api/erp-2.js';
import { VendorsTable } from '../components/VendorsTable.js';
import { PurchaseOrdersTable } from '../components/PurchaseOrdersTable.js';
import { VendorFilterBar, PurchaseOrderFilterBar } from '../components/FilterBar.js';
import { ErrorState, AccessDeniedState } from '../components/StateViews.js';

export const VendorsListPage: React.FC = () => {
  // Read initial parameters from window.location if present
  const getInitialParams = () => {
    if (typeof window === 'undefined' || !window.location || !window.location.search) {
      return {};
    }
    const params = new URLSearchParams(window.location.search);
    const pageStr = params.get('page');
    const pageSizeStr = params.get('pageSize');
    return {
      tab: params.get('tab') === 'orders' ? ('orders' as const) : ('vendors' as const),
      page: pageStr ? Math.max(1, parseInt(pageStr, 10) || 1) : 1,
      pageSize: pageSizeStr
        ? Math.min(100, Math.max(1, parseInt(pageSizeStr, 10) || 20))
        : 20,
      search: params.get('search') || '',
      status: (params.get('status') as PurchaseOrderStatus | null) || undefined,
      sort: params.get('sort') || undefined,
      order: (params.get('order') as 'asc' | 'desc' | null) || 'asc',
    };
  };

  const initial = getInitialParams();

  const [activeTab, setActiveTab] = useState<'vendors' | 'orders'>(initial.tab || 'vendors');

  // Vendors state
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsTotal, setVendorsTotal] = useState(0);
  const [vendorsTotalPages, setVendorsTotalPages] = useState(1);
  const [isVendorsLoading, setIsVendorsLoading] = useState(false);
  const [vendorsError, setVendorsError] = useState<{ message: string; isForbidden: boolean } | null>(null);

  const [vendorFilters, setVendorFilters] = useState<VendorListQuery>({
    page: initial.page || 1,
    pageSize: initial.pageSize || 20,
    search: initial.search || '',
  });

  const [vendorSort, setVendorSort] = useState<{ field: string | undefined; direction: 'asc' | 'desc' }>({
    field: initial.sort,
    direction: initial.order || 'asc',
  });

  // Purchase Orders state
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [isOrdersLoading, setIsOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<{ message: string; isForbidden: boolean } | null>(null);

  const [orderFilters, setOrderFilters] = useState<PurchaseOrderListQuery>({
    page: initial.page || 1,
    pageSize: initial.pageSize || 20,
    status: initial.status,
    vendor_id: undefined,
  });

  const [orderSort, setOrderSort] = useState<{ field: string | undefined; direction: 'asc' | 'desc' }>({
    field: initial.sort,
    direction: initial.order || 'asc',
  });

  // URL search parameter synchronization
  const updateUrlParams = useCallback((newParams: Record<string, string | number | undefined | null>) => {
    if (typeof window === 'undefined' || !window.history || !window.location) return;
    const current = new URLSearchParams(window.location.search);
    for (const [key, val] of Object.entries(newParams)) {
      if (val === undefined || val === null || val === '') {
        current.delete(key);
      } else {
        current.set(key, String(val));
      }
    }
    const newSearch = current.toString();
    const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`;
    window.history.replaceState(null, '', newUrl);
  }, []);

  // Load Vendors
  const loadVendors = useCallback(async (filters: VendorListQuery) => {
    setIsVendorsLoading(true);
    setVendorsError(null);
    try {
      const response = await fetchVendors(filters);
      setVendors(response.items || []);
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

  // Load Purchase Orders
  const loadOrders = useCallback(async (filters: PurchaseOrderListQuery) => {
    setIsOrdersLoading(true);
    setOrdersError(null);
    try {
      const response = await fetchPurchaseOrders(filters);
      setOrders(response.items || []);
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

  // Effect to load data when tab or respective filters change
  useEffect(() => {
    if (activeTab === 'vendors') {
      loadVendors(vendorFilters);
      updateUrlParams({
        tab: 'vendors',
        page: vendorFilters.page,
        pageSize: vendorFilters.pageSize,
        search: vendorFilters.search,
        sort: vendorSort.field,
        order: vendorSort.direction,
      });
    } else {
      loadOrders(orderFilters);
      updateUrlParams({
        tab: 'orders',
        page: orderFilters.page,
        pageSize: orderFilters.pageSize,
        status: orderFilters.status,
        sort: orderSort.field,
        order: orderSort.direction,
      });
    }
  }, [
    activeTab,
    vendorFilters,
    orderFilters,
    vendorSort,
    orderSort,
    loadVendors,
    loadOrders,
    updateUrlParams,
  ]);

  const handleVendorSortChange = (field: string) => {
    setVendorSort((prev) => {
      const nextDir = prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc';
      return { field, direction: nextDir };
    });
  };

  const handleOrderSortChange = (field: string) => {
    setOrderSort((prev) => {
      const nextDir = prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc';
      return { field, direction: nextDir };
    });
  };

  return (
    <div className="cs-module-root">
      {/* Page Header */}
      <header className="cs-page-header">
        <h1 className="cs-page-title">Vendors & Purchasing</h1>
        <p className="cs-page-description">
          Manage supplier catalog, masked bank details, purchase order lifecycles, and product-linked line items (ERP-2).
        </p>
      </header>

      {/* Tabs navigation */}
      <nav className="cs-tabs-container" aria-label="Vendors and purchase order views">
        <button
          type="button"
          className={`cs-tab-btn ${activeTab === 'vendors' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('vendors');
            updateUrlParams({ tab: 'vendors' });
          }}
          aria-selected={activeTab === 'vendors'}
          role="tab"
        >
          Vendors {vendorsTotal > 0 && `(${vendorsTotal})`}
        </button>
        <button
          type="button"
          className={`cs-tab-btn ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('orders');
            updateUrlParams({ tab: 'orders' });
          }}
          aria-selected={activeTab === 'orders'}
          role="tab"
        >
          Purchase Orders {ordersTotal > 0 && `(${ordersTotal})`}
        </button>
      </nav>

      {/* Main Tab Content */}
      {activeTab === 'vendors' ? (
        <main>
          <VendorFilterBar
            filters={vendorFilters}
            onFilterChange={(updated) =>
              setVendorFilters((prev) => ({ ...prev, ...updated, page: 1 }))
            }
            onReset={() => setVendorFilters({ page: 1, pageSize: 20, search: '' })}
            isLoading={isVendorsLoading}
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
                onRetry={() => loadVendors(vendorFilters)}
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
              sortField={vendorSort.field}
              sortDirection={vendorSort.direction}
              onSortChange={handleVendorSortChange}
              onPageChange={(newPage) =>
                setVendorFilters((prev) => ({
                  ...prev,
                  page: Math.max(1, Math.min(newPage, vendorsTotalPages || 1)),
                }))
              }
              onPageSizeChange={(newPageSize) =>
                setVendorFilters((prev) => ({
                  ...prev,
                  pageSize: Math.min(100, Math.max(1, newPageSize)),
                  page: 1,
                }))
              }
              onRefresh={() => setVendorFilters({ page: 1, pageSize: 20, search: '' })}
            />
          )}
        </main>
      ) : (
        <main>
          <PurchaseOrderFilterBar
            filters={orderFilters}
            onFilterChange={(updated) =>
              setOrderFilters((prev) => ({ ...prev, ...updated, page: 1 }))
            }
            onReset={() =>
              setOrderFilters({ page: 1, pageSize: 20, status: undefined, vendor_id: undefined })
            }
            isLoading={isOrdersLoading}
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
                onRetry={() => loadOrders(orderFilters)}
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
              sortField={orderSort.field}
              sortDirection={orderSort.direction}
              onSortChange={handleOrderSortChange}
              onPageChange={(newPage) =>
                setOrderFilters((prev) => ({
                  ...prev,
                  page: Math.max(1, Math.min(newPage, ordersTotalPages || 1)),
                }))
              }
              onPageSizeChange={(newPageSize) =>
                setOrderFilters((prev) => ({
                  ...prev,
                  pageSize: Math.min(100, Math.max(1, newPageSize)),
                  page: 1,
                }))
              }
              onRefresh={() =>
                setOrderFilters({ page: 1, pageSize: 20, status: undefined, vendor_id: undefined })
              }
            />
          )}
        </main>
      )}
    </div>
  );
};

export default VendorsListPage;
