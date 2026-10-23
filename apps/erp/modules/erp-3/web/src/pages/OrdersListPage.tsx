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
import { ErrorState, EmptyState, SkeletonTable } from '../components/StateViews.js';

export const OrdersListPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'orders' | 'invoices'>('orders');

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
    if (activeTab === 'orders') {
      loadOrders(orderFilters);
    } else {
      loadInvoices(invoiceFilters);
    }
  }, [activeTab, orderFilters, invoiceFilters, loadOrders, loadInvoices]);

  return (
    <div className="cs-module-root">
      {/* Page Header */}
      <header className="cs-page-header">
        <h1 className="cs-page-title">Sales Orders & Invoices</h1>
        <p className="cs-page-description">
          Manage customer purchase orders, line items, billing invoices, and payment statuses (ERP-3).
        </p>
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
            />
          )}
        </main>
      )}
    </div>
  );
};
