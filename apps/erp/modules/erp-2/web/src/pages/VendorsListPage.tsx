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
import { ErrorState, AccessDeniedState, EmptyState, SkeletonTable } from '../components/StateViews.js';

export const VendorsListPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'vendors' | 'orders'>('vendors');

  // Vendors state
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsTotal, setVendorsTotal] = useState(0);
  const [vendorsTotalPages, setVendorsTotalPages] = useState(1);
  const [isVendorsLoading, setIsVendorsLoading] = useState(false);
  const [vendorsError, setVendorsError] = useState<{ message: string; isForbidden: boolean } | null>(null);

  const [vendorFilters, setVendorFilters] = useState<VendorListQuery>({
    page: 1,
    pageSize: 20,
    search: '',
  });

  // Purchase Orders state
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [isOrdersLoading, setIsOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<{ message: string; isForbidden: boolean } | null>(null);

  const [orderFilters, setOrderFilters] = useState<PurchaseOrderListQuery>({
    page: 1,
    pageSize: 20,
    status: undefined,
    vendor_id: undefined,
  });

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
    } else {
      loadOrders(orderFilters);
    }
  }, [activeTab, vendorFilters, orderFilters, loadVendors, loadOrders]);

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
              onPageChange={(newPage) => setVendorFilters((prev) => ({ ...prev, page: newPage }))}
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
              onPageChange={(newPage) => setOrderFilters((prev) => ({ ...prev, page: newPage }))}
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
