/**
 * ERP-2 Vendors & Purchasing — Purchase Orders List Page
 *
 * Implements main paginated collection screen for Purchase Orders conforming to SDS §4.3 & §4.9:
 *   - Server-side bounded pagination with page and pageSize query parameters
 *   - Sortable column headers toggling ascending/descending order
 *   - Status and vendor filtering via PurchaseOrderFilterBar
 *   - URL search parameter synchronization
 *
 * @module erp2/web/pages/PurchaseOrdersListPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PageTitle } from '@cs/ui';
import type { PurchaseOrder, PurchaseOrderListQuery, PurchaseOrderStatus } from '@clearshift/contracts';
import { fetchPurchaseOrders, ApiError } from '../api/erp-2.js';
import { PurchaseOrdersTable } from '../components/PurchaseOrdersTable.js';
import { PurchaseOrderFilterBar } from '../components/FilterBar.js';
import {
  ErrorState,
  AccessDeniedState,
  PurchaseOrdersLoadingSkeleton,
  sanitizeErrorMessage,
} from '../components/StateViews.js';

interface PageErrorInfo {
  message: string;
  isForbidden: boolean;
  correlationId?: string | undefined;
}

export const PurchaseOrdersListPage: React.FC = () => {
  // Read initial parameters from window.location if present
  const getInitialParams = () => {
    if (typeof window === 'undefined' || !window.location || !window.location.search) {
      return {};
    }
    const params = new URLSearchParams(window.location.search);
    const pageStr = params.get('page');
    const pageSizeStr = params.get('pageSize');
    return {
      page: pageStr ? Math.max(1, parseInt(pageStr, 10) || 1) : 1,
      pageSize: pageSizeStr
        ? Math.min(100, Math.max(1, parseInt(pageSizeStr, 10) || 20))
        : 20,
      status: (params.get('status') as PurchaseOrderStatus | null) || undefined,
      vendor_id: params.get('vendor_id') || undefined,
      sort: params.get('sort') || undefined,
      order: (params.get('order') as 'asc' | 'desc' | null) || 'asc',
    };
  };

  const initial = getInitialParams();

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [isOrdersLoading, setIsOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<PageErrorInfo | null>(null);

  const [orderFilters, setOrderFilters] = useState<PurchaseOrderListQuery>({
    page: initial.page || 1,
    pageSize: initial.pageSize || 20,
    status: initial.status,
    vendor_id: initial.vendor_id,
  });

  const [orderSort, setOrderSort] = useState<{ field: string | undefined; direction: 'asc' | 'desc' }>({
    field: initial.sort,
    direction: initial.order || 'asc',
  });

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

  const loadOrders = useCallback(async (filters: PurchaseOrderListQuery) => {
    setIsOrdersLoading(true);
    setOrdersError(null);
    try {
      const response = await fetchPurchaseOrders(filters);
      setOrders(response.items || []);
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

  useEffect(() => {
    loadOrders(orderFilters);
    updateUrlParams({
      page: orderFilters.page,
      pageSize: orderFilters.pageSize,
      status: orderFilters.status,
      vendor_id: orderFilters.vendor_id,
      sort: orderSort.field,
      order: orderSort.direction,
    });
  }, [orderFilters, orderSort, loadOrders, updateUrlParams]);

  const handleOrderSortChange = (field: string) => {
    setOrderSort((prev) => {
      const nextDir = prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc';
      return { field, direction: nextDir };
    });
  };

  return (
    <div className="cs-page-container">
      <PageTitle
        title="Purchase orders"
        subtitle="Manage procurement orders, line items, and lifecycle status (ERP-2)"
        actions={
          <Link
            to="/erp2/purchase-orders/new"
            className="cs-button cs-button-primary"
            role="button"
          >
            New purchase order
          </Link>
        }
      />

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
            requiredCapability="module.read"
          />
        ) : (
          <ErrorState
            title="Failed to Load Purchase Orders"
            message={ordersError.message}
            correlationId={ordersError.correlationId}
            onRetry={() => loadOrders(orderFilters)}
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
          sortField={orderSort.field}
          sortDirection={orderSort.direction}
          hasActiveFilters={Boolean(orderFilters.status || orderFilters.vendor_id)}
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
    </div>
  );
};

export default PurchaseOrdersListPage;
