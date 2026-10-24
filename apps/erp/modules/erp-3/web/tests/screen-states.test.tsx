// @vitest-environment jsdom
/**
 * Test suite for ERP-3 Sales Orders & Invoices: Loading, empty, error and access-denied states (ERP3-19 / Issue #155)
 *
 * Acceptance Criteria:
 *   [✓] 1. Table displays animated skeleton placeholder during initial data fetching.
 *   [✓] 2. Zero-data condition shows helpful empty state with call-to-action button.
 *   [✓] 3. API failure displays alert banner with retry action; raw error stack traces are hidden.
 *   [✓] 4. 403 Forbidden response renders access-denied view explaining missing role.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OrdersListPage } from '../src/pages/OrdersListPage.js';
import {
  SkeletonTable,
  SalesOrdersLoadingSkeleton,
  InvoicesLoadingSkeleton,
  EmptySalesOrdersView,
  EmptyInvoicesView,
  ErrorState,
  ErrorSalesOrdersView,
  ErrorInvoicesView,
  AccessDeniedState,
  sanitizeErrorMessage,
} from '../src/components/StateViews.js';
import * as api from '../src/api/erp-3.js';
import { ApiError } from '../src/api/erp-3.js';
import type { SalesOrder, Invoice } from '@clearshift/contracts';

const mockOrder: SalesOrder = {
  id: '30000000-0000-4000-8000-000000000001',
  order_number: 'SO-2026-0042',
  customer_golden_id: '50000000-0000-4000-8000-000000000001',
  order_date: '2026-10-24',
  status: 'Open',
  currency: 'USD',
  total: '2400.0000',
  lines: [
    {
      id: '31000000-0000-4000-8000-000000000001',
      order_id: '30000000-0000-4000-8000-000000000001',
      product_id: '10000000-0000-4000-8000-000000000001',
      quantity: '20.0000',
      price: '100.0000',
      tax_rate: '20.0000',
      tax_amount: '400.0000',
      line_total: '2400.0000',
      created_at: '2026-10-24T00:00:00Z',
    },
  ],
  source_system: null,
  source_id: null,
  created_at: '2026-10-24T00:00:00Z',
  updated_at: '2026-10-24T00:00:00Z',
};

const mockInvoice: Invoice = {
  id: '40000000-0000-4000-8000-000000000001',
  invoice_number: 'INV-2026-0088',
  order_id: mockOrder.id,
  customer_golden_id: mockOrder.customer_golden_id,
  invoice_date: '2026-10-24',
  due_date: '2026-11-24',
  status: 'Open',
  currency: 'USD',
  total: '2400.0000',
  lines: [],
  source_system: null,
  source_id: null,
  created_at: '2026-10-24T00:00:00Z',
  updated_at: '2026-10-24T00:00:00Z',
};

describe('ERP-3 Sales Orders & Invoices: State Views (ERP3-19 / Issue #155)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    if (typeof window !== 'undefined' && window.history) {
      window.history.replaceState(null, '', '/');
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  describe('1. Error Message Sanitization (Hides Raw Error Stack Traces)', () => {
    it('strips multiline JavaScript stack traces ("at Object.run...")', () => {
      const rawErrorWithStack =
        'Database connection pool exhausted\n' +
        '    at Client._query (/Users/dev/node_modules/pg/lib/client.js:526:19)\n' +
        '    at async listSalesOrders (/Users/dev/erp-3/src/service.ts:42:15)\n' +
        '    at async RouteHandler (/Users/dev/erp-3/src/routes.ts:18:5)';

      const sanitized = sanitizeErrorMessage(rawErrorWithStack);
      expect(sanitized).toBe('Database connection pool exhausted');
      expect(sanitized).not.toContain('at Client._query');
      expect(sanitized).not.toContain('/Users/dev/');
      expect(sanitized).not.toContain('node_modules');
    });

    it('sanitizes internal SQL and ORM syntax error dumps to a safe message', () => {
      const sqlError = 'error: syntax error at or near "SELECT" in select * from erp3_sales_orders';
      const sanitized = sanitizeErrorMessage(sqlError);

      expect(sanitized).toBe(
        'A database connection error occurred while retrieving sales orders. Please try again or contact support.'
      );
      expect(sanitized).not.toContain('syntax error at or near');
      expect(sanitized).not.toContain('select * from');
    });

    it('sanitizes low-level socket and connection errors', () => {
      const socketError = 'connect ECONNREFUSED 127.0.0.1:5432';
      const sanitized = sanitizeErrorMessage(socketError);

      expect(sanitized).toBe(
        'A database connection error occurred while retrieving sales orders. Please try again or contact support.'
      );
      expect(sanitized).not.toContain('127.0.0.1:5432');
    });

    it('preserves user-facing domain and envelope error messages', () => {
      const friendlyMessage = 'Sales order service is temporarily unavailable due to routine database maintenance.';
      const sanitized = sanitizeErrorMessage(friendlyMessage);

      expect(sanitized).toBe(friendlyMessage);
    });

    it('handles null, undefined, and non-error inputs gracefully', () => {
      expect(sanitizeErrorMessage(null)).toBe(
        'An unexpected error occurred while communicating with the server.'
      );
      expect(sanitizeErrorMessage(undefined)).toBe(
        'An unexpected error occurred while communicating with the server.'
      );
      expect(sanitizeErrorMessage({})).toBe(
        'An unexpected error occurred while communicating with the server.'
      );
    });
  });

  describe('2. Acceptance Criterion 1: Table displays animated skeleton placeholder during initial data fetching', () => {
    it('renders accessible animated skeleton placeholder with status role and aria-busy', () => {
      render(<SkeletonTable columns={8} rows={6} ariaLabel="Loading sales orders data" />);

      const skeletonRegion = screen.getByRole('status', { name: /Loading sales orders data/i });
      expect(skeletonRegion).toBeDefined();
      expect(skeletonRegion.getAttribute('aria-busy')).toBe('true');
      expect(skeletonRegion.textContent).toContain('Loading data from API, please wait...');
    });

    it('renders dedicated SalesOrdersLoadingSkeleton and InvoicesLoadingSkeleton components', () => {
      const { unmount } = render(<SalesOrdersLoadingSkeleton />);
      expect(screen.getByRole('status', { name: /Loading sales orders data/i })).toBeDefined();
      unmount();

      render(<InvoicesLoadingSkeleton />);
      expect(screen.getByRole('status', { name: /Loading invoices data/i })).toBeDefined();
    });

    it('displays loading skeleton during initial data fetching and replaces it once data arrives', async () => {
      let resolveOrdersPromise: (val: any) => void;
      const ordersPromise = new Promise((resolve) => {
        resolveOrdersPromise = resolve;
      });

      vi.spyOn(api, 'fetchInvoices').mockResolvedValue({
        items: [mockInvoice],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      vi.spyOn(api, 'fetchSalesOrders').mockImplementation(() => ordersPromise as any);

      render(<OrdersListPage />);

      // While fetch is pending, skeleton is visible
      const skeleton = screen.getByRole('status', { name: /Loading sales orders data/i });
      expect(skeleton).toBeDefined();
      expect(skeleton.getAttribute('aria-busy')).toBe('true');
      expect(screen.queryByText('SO-2026-0042')).toBeNull();

      // Resolve the sales orders API call
      resolveOrdersPromise!({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      // After promise resolves, skeleton disappears and order row appears
      await waitFor(() => {
        expect(screen.queryByRole('status', { name: /Loading sales orders data/i })).toBeNull();
        expect(screen.getByText('SO-2026-0042')).toBeDefined();
      });
    });
  });

  describe('3. Acceptance Criterion 2: Zero-data condition shows helpful empty state with call-to-action button', () => {
    it('shows helpful zero-data empty state with "+ New Sales Order" call-to-action button when sales order catalog has no records', () => {
      const handleCreate = vi.fn();
      render(
        <EmptySalesOrdersView
          hasActiveFilters={false}
          onClearFilters={vi.fn()}
          onCreateOrder={handleCreate}
        />
      );

      expect(screen.getByText('No sales orders found')).toBeDefined();
      expect(
        screen.getByText(/No orders match your current filter selection or search query\. No sales orders have been recorded yet\./i)
      ).toBeDefined();

      const ctaButton = screen.getByRole('button', { name: /\+ New Sales Order/i });
      expect(ctaButton).toBeDefined();

      fireEvent.click(ctaButton);
      expect(handleCreate).toHaveBeenCalledTimes(1);
    });

    it('shows helpful zero-data empty state with "+ New Invoice" call-to-action button when invoices catalog has no records', () => {
      const handleCreate = vi.fn();
      render(
        <EmptyInvoicesView
          hasActiveFilters={false}
          onClearFilters={vi.fn()}
          onCreateInvoice={handleCreate}
        />
      );

      expect(screen.getByText('No invoices found')).toBeDefined();
      expect(
        screen.getByText(/No invoices match your current filter selection or search query\. No billing invoices have been recorded yet\./i)
      ).toBeDefined();

      const ctaButton = screen.getByRole('button', { name: /\+ New Invoice/i });
      expect(ctaButton).toBeDefined();

      fireEvent.click(ctaButton);
      expect(handleCreate).toHaveBeenCalledTimes(1);
    });

    it('shows filtered empty state with "Clear all filters" call-to-action button when query returns 0 matches', () => {
      const handleClear = vi.fn();
      render(
        <EmptySalesOrdersView
          hasActiveFilters={true}
          onClearFilters={handleClear}
        />
      );

      expect(screen.getByText('No sales orders found')).toBeDefined();
      expect(
        screen.getByText('No orders match your current filter selection or search query.')
      ).toBeDefined();

      const clearBtn = screen.getByRole('button', { name: /Clear Filters & Reload|Clear all filters/i });
      expect(clearBtn).toBeDefined();

      fireEvent.click(clearBtn);
      expect(handleClear).toHaveBeenCalledTimes(1);
    });

    it('integrates zero-data empty state with CTA button on OrdersListPage when API returns 0 items', async () => {
      vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      render(<OrdersListPage />);

      await waitFor(() => {
        expect(screen.getByText('No sales orders found')).toBeDefined();
      });

      const addBtn = screen.getByRole('button', { name: /\+ New Sales Order/i });
      expect(addBtn).toBeDefined();

      fireEvent.click(addBtn);

      // Verify it switched view mode to create-order
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /New Sales Order/i })).toBeDefined();
      });
    });
  });

  describe('4. Acceptance Criterion 3: API failure displays alert banner with retry action; raw error stack traces are hidden', () => {
    it('renders alert banner with sanitized message and retry button when standalone ErrorSalesOrdersView is rendered', () => {
      const handleRetry = vi.fn();
      const rawErrorWithStack = new Error(
        'Internal Server Error: Database failure\n  at runQuery (/app/db.ts:10:5)'
      );

      render(
        <ErrorSalesOrdersView
          error={rawErrorWithStack}
          onRetry={handleRetry}
        />
      );

      const alertBanner = screen.getByRole('alert');
      expect(alertBanner).toBeDefined();
      expect(screen.getByText('Unable to load sales orders')).toBeDefined();

      // Verify raw stack trace is hidden
      expect(screen.queryByText(/at runQuery/)).toBeNull();
      expect(screen.queryByText(/\/app\/db\.ts/)).toBeNull();
      expect(screen.getByText('Internal Server Error: Database failure')).toBeDefined();

      // Verify retry action
      const retryBtn = screen.getByRole('button', { name: /Try Again/i });
      expect(retryBtn).toBeDefined();

      fireEvent.click(retryBtn);
      expect(handleRetry).toHaveBeenCalledTimes(1);
    });

    it('displays correlation reference ID when present on API error envelope', () => {
      const errorWithCorrId = new ApiError(
        500,
        'SERVER_ERROR',
        'Sales orders service encountered an unexpected error',
        { correlationId: 'corr-erp3-abc-999' }
      );

      render(<ErrorSalesOrdersView error={errorWithCorrId} onRetry={vi.fn()} />);

      expect(screen.getByText(/Reference ID:/i)).toBeDefined();
      expect(screen.getByText('corr-erp3-abc-999')).toBeDefined();
    });

    it('displays alert banner on API failure in OrdersListPage, hides stack traces, and recovers on retry', async () => {
      const rawInternalError = new ApiError(
        500,
        'DATABASE_TIMEOUT',
        'Query execution timed out after 30000ms\n    at PostgresDriver.execute (/node_modules/drizzle-orm/pg.js:42:10)'
      );

      const fetchSpy = vi.spyOn(api, 'fetchSalesOrders')
        .mockRejectedValueOnce(rawInternalError)
        .mockResolvedValueOnce({
          items: [mockOrder],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });

      render(<OrdersListPage />);

      // Wait for error state to render
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeDefined();
        expect(screen.getByText('Failed to Load Sales Orders')).toBeDefined();
      });

      // Raw stack trace is hidden
      expect(screen.queryByText(/PostgresDriver\.execute/)).toBeNull();
      expect(screen.queryByText(/drizzle-orm/)).toBeNull();
      expect(screen.getByText('Query execution timed out after 30000ms')).toBeDefined();

      // Retry button is present
      const retryButton = screen.getByRole('button', { name: /Try Again/i });
      expect(retryButton).toBeDefined();

      // Trigger retry
      fireEvent.click(retryButton);

      // Verify table recovers
      await waitFor(() => {
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByText('SO-2026-0042')).toBeDefined();
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('5. Acceptance Criterion 4: 403 Forbidden response renders access-denied view explaining missing role', () => {
    it('renders access-denied view with missing role explanation and without a retry button', () => {
      render(
        <AccessDeniedState
          message="User session lacks the required permissions for sales orders and invoices."
          requiredCapability="orders:read"
        />
      );

      const accessDeniedRegion = screen.getByRole('region', { name: /Access Denied/i });
      expect(accessDeniedRegion).toBeDefined();

      expect(screen.getByText('Access Denied')).toBeDefined();
      expect(
        screen.getByText('User session lacks the required permissions for sales orders and invoices.')
      ).toBeDefined();
      expect(screen.getByText('orders:read')).toBeDefined();
      expect(screen.getByText(/orders:manage/)).toBeDefined();
      expect(
        screen.getByText('Please contact your system administrator to assign the necessary role to your account.')
      ).toBeDefined();

      // CRITICAL: A 403 Forbidden state must NEVER show a retry action
      expect(screen.queryByRole('button', { name: /Try Again/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    });

    it('renders AccessDeniedState when OrdersListPage receives HTTP 403 Forbidden for Sales Orders', async () => {
      const forbiddenError = new ApiError(
        403,
        'FORBIDDEN',
        'You do not have permission to view sales orders in ERP-3.'
      );

      vi.spyOn(api, 'fetchSalesOrders').mockRejectedValue(forbiddenError);

      render(<OrdersListPage />);

      await waitFor(() => {
        expect(screen.getByRole('region', { name: /Access Denied/i })).toBeDefined();
      });

      expect(screen.getByText('Access Denied')).toBeDefined();
      expect(
        screen.getByText(/You do not have permission to view sales orders in ERP-3/i)
      ).toBeDefined();
      expect(screen.getByText('orders:read')).toBeDefined();

      // Must NOT display retry button or error alert
      expect(screen.queryByRole('button', { name: /Try Again/i })).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('renders AccessDeniedState when OrdersListPage receives HTTP 403 Forbidden for Invoices', async () => {
      vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      const forbiddenError = new ApiError(
        403,
        'FORBIDDEN',
        'You do not have permission to view billing invoices in ERP-3.'
      );

      vi.spyOn(api, 'fetchInvoices').mockRejectedValue(forbiddenError);

      render(<OrdersListPage initialTab="invoices" />);

      await waitFor(() => {
        expect(screen.getByRole('region', { name: /Access Denied/i })).toBeDefined();
      });

      expect(screen.getByText('Access Denied')).toBeDefined();
      expect(
        screen.getByText(/You do not have permission to view billing invoices in ERP-3/i)
      ).toBeDefined();
      expect(screen.getByText('orders:read')).toBeDefined();

      // Must NOT display retry button
      expect(screen.queryByRole('button', { name: /Try Again/i })).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
