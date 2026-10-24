// @vitest-environment jsdom
/**
 * Test suite for ERP-2 Vendors & Purchasing: Loading, empty, error and access-denied states (ERP2-19 / Issue #135)
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
import { MemoryRouter } from 'react-router-dom';
import { VendorsListPage } from '../src/pages/VendorsListPage.js';
import { PurchaseOrdersListPage } from '../src/pages/PurchaseOrdersListPage.js';
import {
  VendorsLoadingSkeleton,
  PurchaseOrdersLoadingSkeleton,
  EmptyVendorsView,
  EmptyPurchaseOrdersView,
  ErrorVendorsView,
  ErrorPurchaseOrdersView,
  ErrorState,
  AccessDeniedState,
  sanitizeErrorMessage,
} from '../src/components/StateViews.js';
import * as api from '../src/api/erp-2.js';
import { ApiError } from '../src/api/erp-2.js';
import type { Vendor, PurchaseOrder } from '@clearshift/contracts';

const mockVendor: Vendor = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Global Supply Matrix LLC',
  tax_number: 'US-EIN-987654321',
  email: 'procurement@globalsupply.com',
  phone: '+1-555-0144',
  address_line: '500 Logistics Boulevard',
  city: 'Detroit',
  country: 'United States',
  bank_masked: 'XXXX-XXXX-4321',
  currency: 'USD',
  source_system: null,
  source_id: null,
  created_at: '2026-10-23T00:00:00Z',
  updated_at: '2026-10-23T00:00:00Z',
};

const mockOrder: PurchaseOrder = {
  id: '22222222-2222-2222-2222-222222222222',
  po_number: 'PO-2026-0042',
  vendor_id: mockVendor.id,
  order_date: '2026-10-24',
  status: 'Draft',
  currency: 'USD',
  total: '4500.00',
  lines: [
    {
      id: '33333333-3333-3333-3333-333333333333',
      po_id: '22222222-2222-2222-2222-222222222222',
      product_id: '44444444-4444-4444-4444-444444444444',
      quantity: '30.00',
      price: '150.00',
      line_total: '4500.00',
    },
  ],
  created_at: '2026-10-24T00:00:00Z',
  updated_at: '2026-10-24T00:00:00Z',
};

describe('ERP-2 Vendors & Purchasing: State Views (ERP2-19 / Issue #135)', () => {
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
        '    at async listVendors (/Users/dev/erp-2/src/service.ts:42:15)\n' +
        '    at async RouteHandler (/Users/dev/erp-2/src/routes.ts:18:5)';

      const sanitized = sanitizeErrorMessage(rawErrorWithStack);
      expect(sanitized).toBe('Database connection pool exhausted');
      expect(sanitized).not.toContain('at Client._query');
      expect(sanitized).not.toContain('/Users/dev/');
      expect(sanitized).not.toContain('node_modules');
    });

    it('sanitizes internal SQL and ORM syntax error dumps to a safe message', () => {
      const sqlError = 'error: syntax error at or near "FROM" in select * from erp2_vendors';
      const sanitized = sanitizeErrorMessage(sqlError);

      expect(sanitized).toBe(
        'A database connection error occurred while communicating with the server. Please try again or contact support.'
      );
      expect(sanitized).not.toContain('syntax error at or near');
      expect(sanitized).not.toContain('select * from');
      expect(sanitized).not.toContain('erp2_vendors');
    });

    it('sanitizes low-level socket and connection errors', () => {
      const socketError = 'connect ECONNREFUSED 127.0.0.1:5432';
      const sanitized = sanitizeErrorMessage(socketError);

      expect(sanitized).toBe(
        'A database connection error occurred while communicating with the server. Please try again or contact support.'
      );
      expect(sanitized).not.toContain('127.0.0.1:5432');
    });

    it('preserves user-facing domain and envelope error messages', () => {
      const friendlyMessage = 'Vendor service is undergoing scheduled maintenance.';
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
    it('renders accessible animated skeleton placeholder with status role and aria-busy for vendors', () => {
      render(<VendorsLoadingSkeleton columns={7} rows={6} />);

      const skeletonRegion = screen.getByRole('status', { name: /Loading vendors table/i });
      expect(skeletonRegion).toBeDefined();
      expect(skeletonRegion.getAttribute('aria-busy')).toBe('true');
      expect(skeletonRegion.getAttribute('aria-label')).toBe('Loading vendors table');
      expect(skeletonRegion.textContent).toContain('Loading vendors, please wait...');
    });

    it('renders accessible animated skeleton placeholder for purchase orders', () => {
      render(<PurchaseOrdersLoadingSkeleton columns={7} rows={6} />);

      const skeletonRegion = screen.getByRole('status', { name: /Loading purchase orders table/i });
      expect(skeletonRegion).toBeDefined();
      expect(skeletonRegion.getAttribute('aria-busy')).toBe('true');
      expect(skeletonRegion.textContent).toContain('Loading purchase orders, please wait...');
    });

    it('displays loading skeleton during initial data fetching on VendorsListPage and replaces it once data arrives', async () => {
      let resolveVendorsPromise: (val: unknown) => void;
      const vendorsPromise = new Promise((resolve) => {
        resolveVendorsPromise = resolve;
      });

      vi.spyOn(api, 'fetchVendors').mockImplementation(() => vendorsPromise as any);
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<VendorsListPage />);

      // While fetch is pending, skeleton is visible
      const skeleton = screen.getByRole('status', { name: /Loading vendors table/i });
      expect(skeleton).toBeDefined();
      expect(skeleton.getAttribute('aria-busy')).toBe('true');
      expect(screen.queryByText('Global Supply Matrix LLC')).toBeNull();

      // Resolve the vendors API call
      resolveVendorsPromise!({
        items: [mockVendor],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      // After promise resolves, skeleton disappears and table appears
      await waitFor(() => {
        expect(screen.queryByRole('status', { name: /Loading vendors table/i })).toBeNull();
        expect(screen.getByRole('table')).toBeDefined();
        expect(screen.getByText('Global Supply Matrix LLC')).toBeDefined();
        expect(screen.getByText('US-EIN-987654321')).toBeDefined();
      });
    });

    it('displays loading skeleton during initial data fetching on PurchaseOrdersListPage and replaces it once data arrives', async () => {
      let resolveOrdersPromise: (val: unknown) => void;
      const ordersPromise = new Promise((resolve) => {
        resolveOrdersPromise = resolve;
      });

      vi.spyOn(api, 'fetchPurchaseOrders').mockImplementation(() => ordersPromise as any);

      render(
        <MemoryRouter>
          <PurchaseOrdersListPage />
        </MemoryRouter>
      );

      const skeleton = screen.getByRole('status', { name: /Loading purchase orders table/i });
      expect(skeleton).toBeDefined();
      expect(skeleton.getAttribute('aria-busy')).toBe('true');

      resolveOrdersPromise!({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      await waitFor(() => {
        expect(screen.queryByRole('status', { name: /Loading purchase orders table/i })).toBeNull();
        expect(screen.getByRole('table')).toBeDefined();
        expect(screen.getByText('PO-2026-0042')).toBeDefined();
      });
    });
  });

  describe('3. Acceptance Criterion 2: Zero-data condition shows helpful empty state with call-to-action button', () => {
    it('shows helpful zero-data empty state with "Add Vendor" call-to-action button when vendor master has no records', () => {
      const handleCreate = vi.fn();
      render(
        <EmptyVendorsView
          hasActiveFilters={false}
          onClearFilters={vi.fn()}
          onCreateVendor={handleCreate}
        />
      );

      expect(screen.getByText('No vendors in supplier master')).toBeDefined();
      expect(
        screen.getByText(
          'No vendor profiles have been recorded in the supplier master yet. Add your first vendor to establish supplier coordinates.'
        )
      ).toBeDefined();

      const ctaButton = screen.getByRole('button', { name: /Add Vendor/i });
      expect(ctaButton).toBeDefined();

      fireEvent.click(ctaButton);
      expect(handleCreate).toHaveBeenCalledTimes(1);
    });

    it('shows filtered empty state with "Clear all filters" call-to-action button when vendor query returns 0 matches', () => {
      const handleClear = vi.fn();
      render(
        <EmptyVendorsView
          hasActiveFilters={true}
          onClearFilters={handleClear}
        />
      );

      expect(screen.getByText('No matching vendors found')).toBeDefined();
      expect(
        screen.getByText(
          'No vendor profiles match the selected filters or search query. Try adjusting your search term or clearing active filters.'
        )
      ).toBeDefined();

      const clearBtn = screen.getByRole('button', { name: /Clear all filters/i });
      expect(clearBtn).toBeDefined();

      fireEvent.click(clearBtn);
      expect(handleClear).toHaveBeenCalledTimes(1);
    });

    it('shows helpful zero-data empty state with "New Purchase Order" CTA button for purchase orders', () => {
      const handleCreatePO = vi.fn();
      render(
        <EmptyPurchaseOrdersView
          hasActiveFilters={false}
          onClearFilters={vi.fn()}
          onCreatePurchaseOrder={handleCreatePO}
        />
      );

      expect(screen.getByText('No purchase orders in ledger')).toBeDefined();
      expect(
        screen.getByText(
          'No purchase orders have been recorded in the procurement ledger yet. Create your first purchase order to begin tracking supplier orders.'
        )
      ).toBeDefined();

      const ctaBtn = screen.getByRole('button', { name: /New Purchase Order/i });
      expect(ctaBtn).toBeDefined();

      fireEvent.click(ctaBtn);
      expect(handleCreatePO).toHaveBeenCalledTimes(1);
    });

    it('integrates zero-data empty state with CTA button on VendorsListPage when API returns 0 vendors', async () => {
      const handleCreateVendor = vi.fn();

      vi.spyOn(api, 'fetchVendors').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      render(<VendorsListPage onCreateVendor={handleCreateVendor} />);

      await waitFor(() => {
        expect(screen.getByText('No vendors in supplier master')).toBeDefined();
      });

      const addBtn = screen.getByRole('button', { name: /Add Vendor/i });
      expect(addBtn).toBeDefined();

      fireEvent.click(addBtn);
      expect(handleCreateVendor).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Acceptance Criterion 3: API failure displays alert banner with retry action; raw error stack traces are hidden', () => {
    it('renders alert banner with sanitized message and retry button when standalone ErrorVendorsView is rendered', () => {
      const handleRetry = vi.fn();
      const rawErrorWithStack = new Error(
        'Internal Server Error: Database failure\n  at runQuery (/app/db.ts:10:5)'
      );

      render(
        <ErrorVendorsView
          error={rawErrorWithStack}
          onRetry={handleRetry}
        />
      );

      const alertBanner = screen.getByRole('alert');
      expect(alertBanner).toBeDefined();
      expect(screen.getByText('Unable to load vendors')).toBeDefined();

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
        'Vendor service encountered an unexpected error'
      );
      (errorWithCorrId as any).correlationId = 'corr-erp2-xyz-789';

      render(<ErrorState error={errorWithCorrId} onRetry={vi.fn()} />);

      expect(screen.getByText(/Reference ID:/i)).toBeDefined();
      expect(screen.getByText('corr-erp2-xyz-789')).toBeDefined();
    });

    it('displays alert banner on API failure in VendorsListPage, hides stack traces, and recovers on retry', async () => {
      const rawInternalError = new ApiError(
        500,
        'DATABASE_TIMEOUT',
        'Query execution timed out after 30000ms\n    at PostgresDriver.execute (/node_modules/drizzle-orm/pg.js:42:10)'
      );

      const fetchSpy = vi.spyOn(api, 'fetchVendors')
        .mockRejectedValueOnce(rawInternalError)
        .mockResolvedValueOnce({
          items: [mockVendor],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });

      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<VendorsListPage />);

      // Wait for error alert banner to render
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeDefined();
        expect(screen.getByText('Failed to Load Vendors')).toBeDefined();
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
        expect(screen.getByText('Global Supply Matrix LLC')).toBeDefined();
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('5. Acceptance Criterion 4: 403 Forbidden response renders access-denied view explaining missing role', () => {
    it('renders access-denied view with missing role explanation and without a retry button', () => {
      render(
        <AccessDeniedState
          message="User session lacks the required permissions for vendors and purchasing."
          requiredCapability="module.read"
        />
      );

      const accessDeniedRegion = screen.getByRole('region', { name: /Access Denied/i });
      expect(accessDeniedRegion).toBeDefined();

      expect(screen.getByText('Access Denied')).toBeDefined();
      expect(
        screen.getByText('User session lacks the required permissions for vendors and purchasing.')
      ).toBeDefined();
      expect(screen.getByText('module.read')).toBeDefined();
      expect(screen.getByText(/module.write/)).toBeDefined();
      expect(
        screen.getByText('Please contact your system administrator to assign the necessary role to your account.')
      ).toBeDefined();

      // CRITICAL: A 403 Forbidden state must NEVER show a retry action
      expect(screen.queryByRole('button', { name: /Try Again/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    });

    it('renders AccessDeniedState when VendorsListPage receives HTTP 403 Forbidden', async () => {
      const forbiddenError = new ApiError(
        403,
        'FORBIDDEN',
        'You do not have permission to view vendor profiles. Please check your role assignments.'
      );

      vi.spyOn(api, 'fetchVendors').mockRejectedValue(forbiddenError);
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<VendorsListPage />);

      await waitFor(() => {
        expect(screen.getByRole('region', { name: /Access Denied/i })).toBeDefined();
      });

      expect(screen.getByText('Access Denied')).toBeDefined();
      expect(
        screen.getByText('You do not have permission to view vendor profiles. Please check your role assignments.')
      ).toBeDefined();
      expect(screen.getByText('module.read')).toBeDefined();

      // Must NOT display retry button or error alert
      expect(screen.queryByRole('button', { name: /Try Again/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    });

    it('renders AccessDeniedState when PurchaseOrdersListPage receives HTTP 403 Forbidden', async () => {
      const forbiddenError = new ApiError(
        403,
        'FORBIDDEN',
        'You do not have permission to view purchase orders. Please check your role assignments.'
      );

      vi.spyOn(api, 'fetchPurchaseOrders').mockRejectedValue(forbiddenError);

      render(
        <MemoryRouter>
          <PurchaseOrdersListPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByRole('region', { name: /Access Denied/i })).toBeDefined();
      });

      expect(screen.getByText('Access Denied')).toBeDefined();
      expect(
        screen.getByText('You do not have permission to view purchase orders. Please check your role assignments.')
      ).toBeDefined();
      expect(screen.getByText('module.read')).toBeDefined();

      // Must NOT display retry button
      expect(screen.queryByRole('button', { name: /Try Again/i })).toBeNull();
    });
  });
});
