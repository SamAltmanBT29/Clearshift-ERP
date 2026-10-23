import React, { useState, useEffect, useCallback } from 'react';
import type {
  SalesOrder,
  SalesOrdersFilterQuery,
  Invoice,
  InvoicesFilterQuery,
} from '@clearshift/contracts';
import { fetchSalesOrders, fetchInvoices } from '../api/erp-3.js';
import { OrdersTable } from '../components/OrdersTable.js';
import { InvoicesTable } from '../components/InvoicesTable.js';
import { FilterBar, InvoiceFilterBar } from '../components/FilterBar.js';
import { ErrorState, EmptyState } from '../components/StateViews.js';
import { OrderCreatePage } from './OrderCreatePage.js';
import { OrderDetailPage } from './OrderDetailPage.js';
import { InvoiceCreatePage } from './InvoiceCreatePage.js';
import { InvoiceDetailPage } from './InvoiceDetailPage.js';

export type OrdersViewMode =
  | 'list'
  | 'create-order'
  | 'order-detail'
  | 'create-invoice'
  | 'invoice-detail';

export const OrdersListPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'orders' | 'invoices'>('orders');
  const [viewMode, setViewMode] = useState<OrdersViewMode>('list');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Sales Orders state
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [isOrdersLoading, setIsOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const [orderFilters, setOrderFilters] = useState<SalesOrdersFilterQuery>({
    page: 1,
    pageSize: 20,
    search: '',
    status: undefined,
  });

  // Invoices state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesTotal, setInvoicesTotal] = useState(0);
  const [invoicesTotalPages, setInvoicesTotalPages] = useState(1);
  const [isInvoicesLoading, setIsInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);

  const [invoiceFilters, setInvoiceFilters] = useState<InvoicesFilterQuery>({
    page: 1,
    pageSize: 20,
    search: '',
    status: undefined,
  });

  // Load Sales Orders
  const loadOrders = useCallback(async (filters: SalesOrdersFilterQuery) => {
    setIsOrdersLoading(true);
    setOrdersError(null);
    try {
      const response = await fetchSalesOrders(filters);
      setOrders(response.items);
      setOrdersTotal(response.total);
      setOrdersTotalPages(response.totalPages);
    } catch (err: any) {
      setOrdersError(err?.message || 'Failed to fetch sales orders from server.');
    } finally {
      setIsOrdersLoading(false);
    }
  }, []);

  // Load Invoices
  const loadInvoices = useCallback(async (filters: InvoicesFilterQuery) => {
    setIsInvoicesLoading(true);
    setInvoicesError(null);
    try {
      const response = await fetchInvoices(filters);
      setInvoices(response.items);
      setInvoicesTotal(response.total);
      setInvoicesTotalPages(response.totalPages);
    } catch (err: any) {
      setInvoicesError(err?.message || 'Failed to fetch invoices from server.');
    } finally {
      setIsInvoicesLoading(false);
    }
  }, []);

  // Effect to load on filter or tab change
  useEffect(() => {
    if (viewMode === 'list') {
      if (activeTab === 'orders') {
        loadOrders(orderFilters);
      } else {
        loadInvoices(invoiceFilters);
      }
    }
  }, [viewMode, activeTab, orderFilters, invoiceFilters, loadOrders, loadInvoices]);

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
          setViewMode('create-invoice');
        }}
      />
    );
  }

  if (viewMode === 'create-invoice') {
    return (
      <InvoiceCreatePage
        initialOrderId={selectedOrderId || ''}
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
              onClick={() => setViewMode('create-order')}
              aria-label="Create new sales order"
            >
              + New Sales Order
            </button>
            <button
              type="button"
              className="cs-btn-secondary"
              onClick={() => setViewMode('create-invoice')}
              aria-label="Create new invoice"
            >
              + New Invoice
            </button>
          </div>
        </div>
      </header>

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
        <main>
          <FilterBar
            filters={orderFilters}
            onFilterChange={(updated) => setOrderFilters((prev) => ({ ...prev, ...updated, page: 1 }))}
            onReset={() => setOrderFilters({ page: 1, pageSize: 20, search: '', status: undefined })}
            isLoading={isOrdersLoading}
          />

          {ordersError ? (
            <ErrorState
              title="Failed to Load Sales Orders"
              message={ordersError}
              onRetry={() => loadOrders(orderFilters)}
            />
          ) : (
            <OrdersTable
              orders={orders}
              isLoading={isOrdersLoading}
              total={ordersTotal}
              page={orderFilters.page || 1}
              pageSize={orderFilters.pageSize || 20}
              totalPages={ordersTotalPages}
              onPageChange={(newPage) => setOrderFilters((prev) => ({ ...prev, page: newPage }))}
              onRefresh={() => setOrderFilters({ page: 1, pageSize: 20, search: '', status: undefined })}
              onSelectOrder={(ord) => {
                setSelectedOrderId(ord.id);
                setViewMode('order-detail');
              }}
            />
          )}
        </main>
      ) : (
        <main>
          <InvoiceFilterBar
            filters={invoiceFilters}
            onFilterChange={(updated) => setInvoiceFilters((prev) => ({ ...prev, ...updated, page: 1 }))}
            onReset={() => setInvoiceFilters({ page: 1, pageSize: 20, search: '', status: undefined })}
            isLoading={isInvoicesLoading}
          />

          {invoicesError ? (
            <ErrorState
              title="Failed to Load Invoices"
              message={invoicesError}
              onRetry={() => loadInvoices(invoiceFilters)}
            />
          ) : (
            <InvoicesTable
              invoices={invoices}
              isLoading={isInvoicesLoading}
              total={invoicesTotal}
              page={invoiceFilters.page || 1}
              pageSize={invoiceFilters.pageSize || 20}
              totalPages={invoicesTotalPages}
              onPageChange={(newPage) => setInvoiceFilters((prev) => ({ ...prev, page: newPage }))}
              onRefresh={() => setInvoiceFilters({ page: 1, pageSize: 20, search: '', status: undefined })}
              onSelectInvoice={(inv) => {
                setSelectedInvoiceId(inv.id);
                setViewMode('invoice-detail');
              }}
            />
          )}
        </main>
      )}
    </div>
  );
};
