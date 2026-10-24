/**
 * ERP-3 Sales Orders & Invoices — Main List Page
 *
 * Implements search, filters, and sorting controls for ERP3-18 (Issue #154):
 *   - Debounced search bar (300ms) via SearchBar component (AC1)
 *   - Faceted filter sidebar (status and currency for orders & invoices) (AC2)
 *   - Active filter pill tags with individual clear + Clear All (AC3)
 *   - Empty state with informative message and reset action (AC4)
 *   - URL query parameter sync for search, status, currency, page, pageSize, sort, order
 *
 * @module erp3/web/pages/OrdersListPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  SalesOrder,
  SalesOrdersFilterQuery,
  Invoice,
  InvoicesFilterQuery,
} from '@clearshift/contracts';
import { fetchSalesOrders, fetchInvoices, ApiError } from '../api/erp-3.js';
import { OrdersTable } from '../components/OrdersTable.js';
import { InvoicesTable } from '../components/InvoicesTable.js';
import { FilterBar, InvoiceFilterBar } from '../components/FilterBar.js';
import { SalesOrderFilterSidebar, InvoiceFilterSidebar } from '../components/FilterSidebar.js';
import { FilterPillTags } from '../components/FilterPillTags.js';
import type { Erp3ActiveFilters, Erp3FilterKey } from '../components/FilterPillTags.js';
import { ErrorState, AccessDeniedState, sanitizeErrorMessage } from '../components/StateViews.js';
import { Alert } from '@cs/ui';
import { OrderCreatePage } from './OrderCreatePage.js';
import { OrderDetailPage } from './OrderDetailPage.js';
import { InvoiceCreatePage } from './InvoiceCreatePage.js';
import { InvoiceDetailPage } from './InvoiceDetailPage.js';
import { OrderCreateModal } from '../components/forms/OrderCreateModal.js';

export type OrdersViewMode =
  | 'list'
  | 'create-order'
  | 'order-detail'
  | 'create-invoice'
  | 'invoice-detail';

export interface PageErrorState {
  message: string;
  isForbidden: boolean;
  correlationId?: string | undefined;
}

export interface OrdersListPageProps {
  initialTab?: 'orders' | 'invoices';
  initialCreateModalOpen?: boolean;
  createMode?: 'modal' | 'page';
  onOrderCreated?: (order: SalesOrder) => void;
}

// ─── URL Query State Helpers ──────────────────────────────────────────────────

function parseOrderFiltersFromUrl(): Partial<SalesOrdersFilterQuery> {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  const q: Partial<SalesOrdersFilterQuery> = {};
  const search = p.get('search');
  if (search) q.search = search;
  const status = p.get('status');
  if (status) q.status = status as SalesOrdersFilterQuery['status'];
  const currency = p.get('currency');
  if (currency) q.currency = currency;
  const customer_golden_id = p.get('customer_golden_id');
  if (customer_golden_id) q.customer_golden_id = customer_golden_id;
  const page = p.get('page');
  if (page) q.page = Number(page);
  const pageSize = p.get('pageSize');
  if (pageSize) q.pageSize = Math.min(100, Number(pageSize));
  return q;
}

function parseInvoiceFiltersFromUrl(): Partial<InvoicesFilterQuery> {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  const q: Partial<InvoicesFilterQuery> = {};
  const search = p.get('search');
  if (search) q.search = search;
  const status = p.get('status');
  if (status) q.status = status as InvoicesFilterQuery['status'];
  const currency = p.get('currency');
  if (currency) q.currency = currency;
  const customer_golden_id = p.get('customer_golden_id');
  if (customer_golden_id) q.customer_golden_id = customer_golden_id;
  const order_id = p.get('order_id');
  if (order_id) q.order_id = order_id;
  const page = p.get('page');
  if (page) q.page = Number(page);
  const pageSize = p.get('pageSize');
  if (pageSize) q.pageSize = Math.min(100, Number(pageSize));
  return q;
}

function parseInitialTabFromUrl(defaultTab: 'orders' | 'invoices'): 'orders' | 'invoices' {
  if (typeof window === 'undefined') return defaultTab;
  const p = new URLSearchParams(window.location.search);
  const tab = p.get('tab');
  if (tab === 'orders' || tab === 'invoices') return tab;
  return defaultTab;
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

// ─── Component ────────────────────────────────────────────────────────────────

export const OrdersListPage: React.FC<OrdersListPageProps> = ({
  initialTab = 'orders',
  initialCreateModalOpen = false,
  createMode = 'page',
  onOrderCreated,
}) => {
  const [activeTab, setActiveTab] = useState<'orders' | 'invoices'>(() =>
    parseInitialTabFromUrl(initialTab)
  );
  const [viewMode, setViewMode] = useState<OrdersViewMode>('list');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(initialCreateModalOpen);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Sidebar toggle state
  const [orderSidebarOpen, setOrderSidebarOpen] = useState(true);
  const [invoiceSidebarOpen, setInvoiceSidebarOpen] = useState(true);

  // Sales Orders state
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [isOrdersLoading, setIsOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<PageErrorState | null>(null);

  const [orderFilters, setOrderFilters] = useState<Partial<SalesOrdersFilterQuery>>(() => ({
    page: 1,
    pageSize: 20,
    search: '',
    status: undefined,
    currency: undefined,
    customer_golden_id: undefined,
    ...parseOrderFiltersFromUrl(),
  }));
  const [orderSortField, setOrderSortField] = useState<string | undefined>(undefined);
  const [orderSortDirection, setOrderSortDirection] = useState<'asc' | 'desc'>('asc');

  // Invoices state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesTotal, setInvoicesTotal] = useState(0);
  const [invoicesTotalPages, setInvoicesTotalPages] = useState(1);
  const [isInvoicesLoading, setIsInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState<PageErrorState | null>(null);

  const [invoiceFilters, setInvoiceFilters] = useState<Partial<InvoicesFilterQuery>>(() => ({
    page: 1,
    pageSize: 20,
    search: '',
    status: undefined,
    currency: undefined,
    customer_golden_id: undefined,
    order_id: undefined,
    ...parseInvoiceFiltersFromUrl(),
  }));
  const [invoiceSortField, setInvoiceSortField] = useState<string | undefined>(undefined);
  const [invoiceSortDirection, setInvoiceSortDirection] = useState<'asc' | 'desc'>('asc');

  // Sort handlers
  const handleOrderSortChange = (field: string) => {
    if (orderSortField === field) {
      setOrderSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderSortField(field);
      setOrderSortDirection('asc');
    }
  };

  const handleOrderPageSizeChange = (newPageSize: number) => {
    setOrderFilters((prev) => ({
      ...prev,
      pageSize: newPageSize,
      page: 1,
    }));
  };

  const handleInvoiceSortChange = (field: string) => {
    if (invoiceSortField === field) {
      setInvoiceSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setInvoiceSortField(field);
      setInvoiceSortDirection('asc');
    }
  };

  const handleInvoicePageSizeChange = (newPageSize: number) => {
    setInvoiceFilters((prev) => ({
      ...prev,
      pageSize: newPageSize,
      page: 1,
    }));
  };

  // Pill tag handlers for orders
  const orderActivePillFilters: Erp3ActiveFilters = {
    search: orderFilters.search,
    status: orderFilters.status,
    currency: orderFilters.currency,
    customer_golden_id: orderFilters.customer_golden_id,
  };

  const handleRemoveOrderFilter = useCallback((key: Erp3FilterKey) => {
    setOrderFilters((prev) => ({
      ...prev,
      [key]: key === 'search' ? '' : undefined,
      page: 1,
    }));
  }, []);

  const handleClearAllOrderFilters = useCallback(() => {
    setOrderFilters({
      page: 1,
      pageSize: 20,
      search: '',
      status: undefined,
      currency: undefined,
      customer_golden_id: undefined,
    });
    setOrderSortField(undefined);
    setOrderSortDirection('asc');
  }, []);

  // Pill tag handlers for invoices
  const invoiceActivePillFilters: Erp3ActiveFilters = {
    search: invoiceFilters.search,
    status: invoiceFilters.status,
    currency: invoiceFilters.currency,
    customer_golden_id: invoiceFilters.customer_golden_id,
    order_id: invoiceFilters.order_id,
  };

  const handleRemoveInvoiceFilter = useCallback((key: Erp3FilterKey) => {
    setInvoiceFilters((prev) => ({
      ...prev,
      [key]: key === 'search' ? '' : undefined,
      page: 1,
    }));
  }, []);

  const handleClearAllInvoiceFilters = useCallback(() => {
    setInvoiceFilters({
      page: 1,
      pageSize: 20,
      search: '',
      status: undefined,
      currency: undefined,
      customer_golden_id: undefined,
      order_id: undefined,
    });
    setInvoiceSortField(undefined);
    setInvoiceSortDirection('asc');
  }, []);

  // Load Sales Orders
  const loadOrders = useCallback(async (filters: Partial<SalesOrdersFilterQuery>) => {
    setIsOrdersLoading(true);
    setOrdersError(null);
    try {
      const response = await fetchSalesOrders(filters);
      setOrders(response.items);
      setOrdersTotal(response.total);
      setOrdersTotalPages(response.totalPages);
    } catch (err: any) {
      const isForbidden =
        (err instanceof ApiError && err.status === 403) ||
        err?.status === 403 ||
        err?.code === 'FORBIDDEN';

      let correlationId: string | undefined;
      if (err?.correlationId) correlationId = String(err.correlationId);
      else if (err?.details?.correlationId) correlationId = String(err.details.correlationId);

      const rawMsg = err?.message || 'Failed to fetch sales orders from server.';
      const sanitized = sanitizeErrorMessage(rawMsg);

      setOrdersError({
        message: sanitized,
        isForbidden: Boolean(isForbidden),
        correlationId,
      });
    } finally {
      setIsOrdersLoading(false);
    }
  }, []);

  // Load Invoices
  const loadInvoices = useCallback(async (filters: Partial<InvoicesFilterQuery>) => {
    setIsInvoicesLoading(true);
    setInvoicesError(null);
    try {
      const response = await fetchInvoices(filters);
      setInvoices(response.items);
      setInvoicesTotal(response.total);
      setInvoicesTotalPages(response.totalPages);
    } catch (err: any) {
      const isForbidden =
        (err instanceof ApiError && err.status === 403) ||
        err?.status === 403 ||
        err?.code === 'FORBIDDEN';

      let correlationId: string | undefined;
      if (err?.correlationId) correlationId = String(err.correlationId);
      else if (err?.details?.correlationId) correlationId = String(err.details.correlationId);

      const rawMsg = err?.message || 'Failed to fetch invoices from server.';
      const sanitized = sanitizeErrorMessage(rawMsg);

      setInvoicesError({
        message: sanitized,
        isForbidden: Boolean(isForbidden),
        correlationId,
      });
    } finally {
      setIsInvoicesLoading(false);
    }
  }, []);

  // Effect to load on filter or tab change & sync URL query state
  useEffect(() => {
    if (viewMode === 'list') {
      if (activeTab === 'orders') {
        updateUrl({
          tab: 'orders',
          search: orderFilters.search,
          status: orderFilters.status,
          currency: orderFilters.currency,
          customer_golden_id: orderFilters.customer_golden_id,
          page: orderFilters.page !== 1 ? orderFilters.page : undefined,
          pageSize: orderFilters.pageSize !== 20 ? orderFilters.pageSize : undefined,
          sort: orderSortField,
          order: orderSortField ? orderSortDirection : undefined,
        });
        loadOrders(orderFilters);
      } else {
        updateUrl({
          tab: 'invoices',
          search: invoiceFilters.search,
          status: invoiceFilters.status,
          currency: invoiceFilters.currency,
          customer_golden_id: invoiceFilters.customer_golden_id,
          order_id: invoiceFilters.order_id,
          page: invoiceFilters.page !== 1 ? invoiceFilters.page : undefined,
          pageSize: invoiceFilters.pageSize !== 20 ? invoiceFilters.pageSize : undefined,
          sort: invoiceSortField,
          order: invoiceSortField ? invoiceSortDirection : undefined,
        });
        loadInvoices(invoiceFilters);
      }
    }
  }, [
    viewMode,
    activeTab,
    orderFilters,
    invoiceFilters,
    orderSortField,
    orderSortDirection,
    invoiceSortField,
    invoiceSortDirection,
    loadOrders,
    loadInvoices,
  ]);

  // View dispatchers
  if (viewMode === 'create-order') {
    return (
      <OrderCreatePage
        onBack={() => {
          setViewMode('list');
          loadOrders(orderFilters);
        }}
        onOrderCreated={(created) => {
          setSelectedOrderId(created.id);
          setSelectedOrder(created);
          setViewMode('order-detail');
          loadOrders(orderFilters);
        }}
      />
    );
  }

  if (viewMode === 'order-detail' && selectedOrderId) {
    return (
      <OrderDetailPage
        orderId={selectedOrderId}
        onBack={() => {
          setViewMode('list');
          loadOrders(orderFilters);
        }}
        onCreateInvoice={(ord) => {
          setSelectedOrderId(ord.id);
          setSelectedOrder(ord);
          setViewMode('create-invoice');
        }}
      />
    );
  }

  if (viewMode === 'create-invoice') {
    return (
      <InvoiceCreatePage
        initialOrderId={selectedOrderId || ''}
        initialOrder={selectedOrder}
        onBack={() => {
          setViewMode('list');
          loadInvoices(invoiceFilters);
        }}
        onInvoiceCreated={(created) => {
          setSelectedInvoiceId(created.id);
          setViewMode('invoice-detail');
          loadInvoices(invoiceFilters);
        }}
      />
    );
  }

  if (viewMode === 'invoice-detail' && selectedInvoiceId) {
    return (
      <InvoiceDetailPage
        invoiceId={selectedInvoiceId}
        onBack={() => {
          setViewMode('list');
          loadInvoices(invoiceFilters);
        }}
        onViewOrder={(ordId) => {
          setSelectedOrderId(ordId);
          setViewMode('order-detail');
        }}
      />
    );
  }

  return (
    <div className="cs-module-root">
      {/* Page Header with Action Buttons */}
      <header className="cs-page-header">
        <div className="cs-header-actions-row">
          <div>
            <h1 className="cs-page-title">Sales Orders & Invoices</h1>
            <p className="cs-page-description">
              Manage customer purchase orders, line items, billing invoices, and payment statuses (ERP-3).
            </p>
          </div>
          <div className="cs-top-actions">
            <button
              type="button"
              className="cs-btn-primary"
              onClick={() => {
                if (createMode === 'modal') {
                  setIsCreateModalOpen(true);
                } else {
                  setViewMode('create-order');
                }
              }}
              aria-label="Create new sales order"
            >
              + New Sales Order
            </button>
            <button
              type="button"
              className="cs-btn-secondary"
              onClick={() => setIsCreateModalOpen(true)}
              aria-label="Open sales order creation modal"
              data-testid="open-order-create-modal"
            >
              + Order Modal
            </button>
            <button
              type="button"
              className="cs-btn-secondary"
              onClick={() => {
                setSelectedOrder(null);
                setViewMode('create-invoice');
              }}
              aria-label="Create new invoice"
            >
              + New Invoice
            </button>
          </div>
        </div>
      </header>

      {/* Confirmation Toast (AC4) */}
      {toastMessage && (
        <div className="cs-erp3-toast-container" role="status" aria-live="polite">
          <Alert
            variant="success"
            title="Success"
            onDismiss={() => setToastMessage(null)}
          >
            {toastMessage}
          </Alert>
        </div>
      )}

      {/* Tabs navigation */}
      <nav className="cs-tabs-container" aria-label="Order and invoice views">
        <button
          type="button"
          className={`cs-tab-btn ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => setActiveTab('orders')}
          aria-selected={activeTab === 'orders'}
          role="tab"
        >
          Sales Orders {ordersTotal > 0 && `(${ordersTotal})`}
        </button>
        <button
          type="button"
          className={`cs-tab-btn ${activeTab === 'invoices' ? 'active' : ''}`}
          onClick={() => setActiveTab('invoices')}
          aria-selected={activeTab === 'invoices'}
          role="tab"
        >
          Invoices {invoicesTotal > 0 && `(${invoicesTotal})`}
        </button>
      </nav>

      {/* Main Tab Content */}
      {activeTab === 'orders' ? (
        <div className="cs-tab-content cs-erp3-content-with-sidebar">
          {/* Faceted Filter Sidebar (AC2) */}
          <SalesOrderFilterSidebar
            filters={{
              status: orderFilters.status,
              currency: orderFilters.currency,
            }}
            onFilterChange={(updated) =>
              setOrderFilters((prev) => ({ ...prev, ...updated, page: 1 }))
            }
            onResetFilters={handleClearAllOrderFilters}
            isLoading={isOrdersLoading}
            isOpen={orderSidebarOpen}
            onToggle={() => setOrderSidebarOpen((v) => !v)}
          />

          <div className="cs-erp3-content-main">
            {/* Filter Bar with Debounced Search (AC1) */}
            <FilterBar
              filters={orderFilters}
              onFilterChange={(updated) =>
                setOrderFilters((prev) => ({ ...prev, ...updated, page: 1 }))
              }
              onReset={handleClearAllOrderFilters}
              isLoading={isOrdersLoading}
              onToggleSidebar={() => setOrderSidebarOpen((v) => !v)}
              isSidebarOpen={orderSidebarOpen}
            />

            {/* Active Filter Pill Tags (AC3) */}
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
                  message="You do not have permission to view sales orders in ERP-3. Please check your role assignments."
                  requiredCapability="orders:read"
                />
              ) : (
                <ErrorState
                  title="Failed to Load Sales Orders"
                  message={ordersError.message}
                  correlationId={ordersError.correlationId}
                  onRetry={() => loadOrders(orderFilters)}
                />
              )
            ) : (
              <OrdersTable
                orders={orders}
                isLoading={isOrdersLoading}
                total={ordersTotal}
                page={orderFilters.page || 1}
                pageSize={orderFilters.pageSize || 20}
                totalPages={ordersTotalPages}
                sortField={orderSortField}
                sortDirection={orderSortDirection}
                onSortChange={handleOrderSortChange}
                onPageChange={(newPage) =>
                  setOrderFilters((prev) => ({ ...prev, page: newPage }))
                }
                onPageSizeChange={handleOrderPageSizeChange}
                onRefresh={handleClearAllOrderFilters}
                onSelectOrder={(ord) => {
                  setSelectedOrderId(ord.id);
                  setSelectedOrder(ord);
                  setViewMode('order-detail');
                }}
                hasActiveFilters={Boolean(
                  orderFilters.search ||
                    orderFilters.status ||
                    orderFilters.currency ||
                    orderFilters.customer_golden_id
                )}
                onCreateOrder={() => {
                  if (createMode === 'modal') {
                    setIsCreateModalOpen(true);
                  } else {
                    setViewMode('create-order');
                  }
                }}
                onClearFilters={handleClearAllOrderFilters}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="cs-tab-content cs-erp3-content-with-sidebar">
          {/* Faceted Filter Sidebar for Invoices (AC2) */}
          <InvoiceFilterSidebar
            filters={{
              status: invoiceFilters.status,
              currency: invoiceFilters.currency,
            }}
            onFilterChange={(updated) =>
              setInvoiceFilters((prev) => ({ ...prev, ...updated, page: 1 }))
            }
            onResetFilters={handleClearAllInvoiceFilters}
            isLoading={isInvoicesLoading}
            isOpen={invoiceSidebarOpen}
            onToggle={() => setInvoiceSidebarOpen((v) => !v)}
          />

          <div className="cs-erp3-content-main">
            {/* Filter Bar with Debounced Search for Invoices (AC1) */}
            <InvoiceFilterBar
              filters={invoiceFilters}
              onFilterChange={(updated) =>
                setInvoiceFilters((prev) => ({ ...prev, ...updated, page: 1 }))
              }
              onReset={handleClearAllInvoiceFilters}
              isLoading={isInvoicesLoading}
              onToggleSidebar={() => setInvoiceSidebarOpen((v) => !v)}
              isSidebarOpen={invoiceSidebarOpen}
            />

            {/* Active Filter Pill Tags for Invoices (AC3) */}
            <FilterPillTags
              filters={invoiceActivePillFilters}
              onRemoveFilter={handleRemoveInvoiceFilter}
              onClearAll={handleClearAllInvoiceFilters}
              disabled={isInvoicesLoading}
            />

            {invoicesError ? (
              invoicesError.isForbidden ? (
                <AccessDeniedState
                  title="Access Denied"
                  message="You do not have permission to view billing invoices in ERP-3. Please check your role assignments."
                  requiredCapability="orders:read"
                />
              ) : (
                <ErrorState
                  title="Failed to Load Invoices"
                  message={invoicesError.message}
                  correlationId={invoicesError.correlationId}
                  onRetry={() => loadInvoices(invoiceFilters)}
                />
              )
            ) : (
              <InvoicesTable
                invoices={invoices}
                isLoading={isInvoicesLoading}
                total={invoicesTotal}
                page={invoiceFilters.page || 1}
                pageSize={invoiceFilters.pageSize || 20}
                totalPages={invoicesTotalPages}
                sortField={invoiceSortField}
                sortDirection={invoiceSortDirection}
                onSortChange={handleInvoiceSortChange}
                onPageChange={(newPage) =>
                  setInvoiceFilters((prev) => ({ ...prev, page: newPage }))
                }
                onPageSizeChange={handleInvoicePageSizeChange}
                onRefresh={handleClearAllInvoiceFilters}
                onSelectInvoice={(inv) => {
                  setSelectedInvoiceId(inv.id);
                  setViewMode('invoice-detail');
                }}
                hasActiveFilters={Boolean(
                  invoiceFilters.search ||
                    invoiceFilters.status ||
                    invoiceFilters.currency ||
                    invoiceFilters.customer_golden_id ||
                    invoiceFilters.order_id
                )}
                onCreateInvoice={() => {
                  setSelectedOrder(null);
                  setViewMode('create-invoice');
                }}
                onClearFilters={handleClearAllInvoiceFilters}
              />
            )}
          </div>
        </div>
      )}
      {/* Sales Order Creation Modal (Issue #156 / ERP3-20) */}
      <OrderCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onOrderCreated={(created) => {
          setOrders((prev) => [created, ...prev]);
          setOrdersTotal((prev) => prev + 1);
          setToastMessage(
            `Sales order ${created.order_number || created.id} created successfully.`
          );
          if (onOrderCreated) {
            onOrderCreated(created);
          }
          setIsCreateModalOpen(false);
        }}
      />
    </div>
  );
};
