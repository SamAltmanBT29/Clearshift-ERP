// @vitest-environment jsdom
/**
 * Test suite for ERP-1 Products and Inventory: Loading, empty, error and access-denied states (#115)
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
import { ProductsListPage } from '../src/pages/ProductsListPage.js';
import {
  ProductsLoadingSkeleton,
  EmptyProductsView,
  ErrorProductsView,
  AccessDeniedProductsView,
  sanitizeErrorMessage,
} from '../src/components/StateViews.js';
import * as api from '../src/api/erp-1.js';
import { Erp1ApiError } from '../src/api/erp-1.js';
import type { Product, Category } from '@clearshift/contracts';

const mockCategory: Category = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Industrial Hardware',
  code: 'IND',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

const mockProduct: Product & { stockQuantity?: string } = {
  id: '00000000-0000-4000-8000-000000000010',
  name: 'Titanium Hex Bolt',
  sku: 'HEX-TIT-001',
  normalizedSku: 'HEX-TIT-001',
  categoryId: mockCategory.id,
  unitOfMeasure: 'pcs',
  price: '15.5000',
  currency: 'USD',
  taxRate: '0.05',
  sourceSystem: null,
  sourceId: null,
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
  stockQuantity: '150.0000',
};

describe('ERP-1 Products & Inventory: State Views (#115)', () => {
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
        'Database connection timed out\n' +
        '    at Client._query (/Users/dev/node_modules/pg/lib/client.js:526:19)\n' +
        '    at async listProducts (/Users/dev/erp-1/src/service.ts:89:12)\n' +
        '    at async RouteHandler (/Users/dev/erp-1/src/routes.ts:34:5)';

      const sanitized = sanitizeErrorMessage(rawErrorWithStack);
      expect(sanitized).toBe('Database connection timed out');
      expect(sanitized).not.toContain('at Client._query');
      expect(sanitized).not.toContain('/Users/dev/');
      expect(sanitized).not.toContain('node_modules');
    });

    it('sanitizes internal SQL and ORM syntax error dumps to a safe message', () => {
      const sqlError = 'error: syntax error at or near "FROM" in select * from erp1_products';
      const sanitized = sanitizeErrorMessage(sqlError);

      expect(sanitized).toBe(
        'A database connection error occurred while retrieving products. Please try again or contact support.'
      );
      expect(sanitized).not.toContain('syntax error at or near');
      expect(sanitized).not.toContain('select * from');
    });

    it('sanitizes low-level socket and connection errors', () => {
      const socketError = 'connect ECONNREFUSED 127.0.0.1:5432';
      const sanitized = sanitizeErrorMessage(socketError);

      expect(sanitized).toBe(
        'A database connection error occurred while retrieving products. Please try again or contact support.'
      );
      expect(sanitized).not.toContain('127.0.0.1:5432');
    });

    it('preserves user-facing domain and envelope error messages', () => {
      const friendlyMessage = 'Products catalog service is temporarily unavailable due to routine maintenance.';
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

  describe('2. Acceptance Criterion 1: Table displays animated skeleton placeholder during initial fetching', () => {
    it('renders accessible animated skeleton placeholder with status role and aria-busy', () => {
      render(<ProductsLoadingSkeleton columns={7} rows={6} />);

      const skeletonRegion = screen.getByRole('status');
      expect(skeletonRegion).toBeDefined();
      expect(skeletonRegion.getAttribute('aria-busy')).toBe('true');
      expect(skeletonRegion.getAttribute('aria-label')).toBe('Loading products table');
      expect(skeletonRegion.textContent).toContain('Loading products, please wait...');
    });

    it('displays loading skeleton during initial data fetching and replaces it once data arrives', async () => {
      let resolveProductsPromise: (val: any) => void;
      const productsPromise = new Promise((resolve) => {
        resolveProductsPromise = resolve;
      });

      vi.spyOn(api, 'fetchCategories').mockResolvedValue({
        items: [mockCategory],
        total: 1,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      });

      vi.spyOn(api, 'fetchProducts').mockImplementation(() => productsPromise as any);

      render(<ProductsListPage />);

      // While fetch is pending, skeleton is visible
      const skeleton = screen.getByRole('status', { name: /Loading products table/i });
      expect(skeleton).toBeDefined();
      expect(skeleton.getAttribute('aria-busy')).toBe('true');
      expect(screen.queryByRole('table')).toBeNull();

      // Resolve the products API call
      resolveProductsPromise!({
        items: [mockProduct],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      // After promise resolves, skeleton disappears and table appears
      await waitFor(() => {
        expect(screen.queryByRole('status', { name: /Loading products table/i })).toBeNull();
        expect(screen.getByRole('table')).toBeDefined();
        expect(screen.getByText('Titanium Hex Bolt')).toBeDefined();
      });
    });
  });

  describe('3. Acceptance Criterion 2: Zero-data condition shows helpful empty state with call-to-action button', () => {
    it('shows helpful zero-data empty state with "Add Product" call-to-action button when catalog has no records', () => {
      const handleCreate = vi.fn();
      render(
        <EmptyProductsView
          hasActiveFilters={false}
          onClearFilters={vi.fn()}
          onCreateProduct={handleCreate}
        />
      );

      expect(screen.getByText('No products in inventory')).toBeDefined();
      expect(
        screen.getByText(
          'No products have been recorded in the catalog yet. Add your first product to begin tracking inventory and stock levels.'
        )
      ).toBeDefined();

      const ctaButton = screen.getByRole('button', { name: /Add Product/i });
      expect(ctaButton).toBeDefined();

      fireEvent.click(ctaButton);
      expect(handleCreate).toHaveBeenCalledTimes(1);
    });

    it('shows filtered empty state with "Clear all filters" call-to-action button when query returns 0 matches', () => {
      const handleClear = vi.fn();
      render(
        <EmptyProductsView
          hasActiveFilters={true}
          onClearFilters={handleClear}
        />
      );

      expect(screen.getByText('No matching products found')).toBeDefined();
      expect(
        screen.getByText(
          'No products match the selected filters or search query. Try adjusting your search term or clearing active filters.'
        )
      ).toBeDefined();

      const clearBtn = screen.getByRole('button', { name: /Clear all filters/i });
      expect(clearBtn).toBeDefined();

      fireEvent.click(clearBtn);
      expect(handleClear).toHaveBeenCalledTimes(1);
    });

    it('integrates zero-data empty state with CTA button on ProductsListPage when API returns 0 items', async () => {
      const handleCreateProduct = vi.fn();

      vi.spyOn(api, 'fetchCategories').mockResolvedValue({
        items: [mockCategory],
        total: 1,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      });

      vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 0,
      });

      render(<ProductsListPage onCreateProduct={handleCreateProduct} />);

      await waitFor(() => {
        expect(screen.getByText('No products in inventory')).toBeDefined();
      });

      const addBtn = screen.getByRole('button', { name: /Add Product/i });
      expect(addBtn).toBeDefined();

      fireEvent.click(addBtn);
      expect(handleCreateProduct).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Acceptance Criterion 3: API failure displays alert banner with retry action; raw error stack traces are hidden', () => {
    it('renders alert banner with sanitized message and retry button when standalone ErrorProductsView is rendered', () => {
      const handleRetry = vi.fn();
      const rawErrorWithStack = new Error(
        'Internal Server Error: Database failure\n  at runQuery (/app/db.ts:10:5)'
      );

      render(
        <ErrorProductsView
          error={rawErrorWithStack}
          onRetry={handleRetry}
        />
      );

      const alertBanner = screen.getByRole('alert');
      expect(alertBanner).toBeDefined();
      expect(screen.getByText('Unable to load products')).toBeDefined();

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
      const errorWithCorrId = new Erp1ApiError(
        500,
        'SERVER_ERROR',
        'Products service encountered an error',
        [],
        'corr-erp1-abc-123'
      );

      render(<ErrorProductsView error={errorWithCorrId} onRetry={vi.fn()} />);

      expect(screen.getByText(/Reference ID:/i)).toBeDefined();
      expect(screen.getByText('corr-erp1-abc-123')).toBeDefined();
    });

    it('displays alert banner on API failure in ProductsListPage, hides stack traces, and recovers on retry', async () => {
      vi.spyOn(api, 'fetchCategories').mockResolvedValue({
        items: [mockCategory],
        total: 1,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      });

      const rawInternalError = new Erp1ApiError(
        500,
        'DATABASE_TIMEOUT',
        'Query execution timed out after 30000ms\n    at PostgresDriver.execute (/node_modules/drizzle-orm/pg.js:42:10)'
      );

      const fetchSpy = vi.spyOn(api, 'fetchProducts')
        .mockRejectedValueOnce(rawInternalError)
        .mockResolvedValueOnce({
          items: [mockProduct],
          total: 1,
          page: 1,
          pageSize: 25,
          totalPages: 1,
        });

      render(<ProductsListPage />);

      // Wait for error state to render
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeDefined();
        expect(screen.getByText('Unable to load products')).toBeDefined();
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
        expect(screen.getByText('Titanium Hex Bolt')).toBeDefined();
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('5. Acceptance Criterion 4: 403 Forbidden response renders access-denied view explaining missing role', () => {
    it('renders access-denied view with missing role explanation and without a retry button', () => {
      render(
        <AccessDeniedProductsView
          message="User session lacks the required permissions for products and inventory."
          requiredCapability="inventory:read"
        />
      );

      const accessDeniedRegion = screen.getByRole('region', { name: /Access Denied/i });
      expect(accessDeniedRegion).toBeDefined();

      expect(screen.getByText('Access Denied')).toBeDefined();
      expect(
        screen.getByText('User session lacks the required permissions for products and inventory.')
      ).toBeDefined();
      expect(screen.getByText('inventory:read')).toBeDefined();
      expect(screen.getByText(/inventory:manage/)).toBeDefined();
      expect(
        screen.getByText('Please contact your system administrator to assign the necessary role to your account.')
      ).toBeDefined();

      // CRITICAL: A 403 Forbidden state must NEVER show a retry action
      expect(screen.queryByRole('button', { name: /Try Again/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    });

    it('renders AccessDeniedProductsView when ProductsListPage receives HTTP 403 Forbidden', async () => {
      vi.spyOn(api, 'fetchCategories').mockResolvedValue({
        items: [mockCategory],
        total: 1,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      });

      const forbiddenError = new Erp1ApiError(
        403,
        'FORBIDDEN',
        'You do not have permission to view inventory and catalog records.'
      );

      vi.spyOn(api, 'fetchProducts').mockRejectedValue(forbiddenError);

      render(<ProductsListPage />);

      await waitFor(() => {
        expect(screen.getByRole('region', { name: /Access Denied/i })).toBeDefined();
      });

      expect(screen.getByText('Access Denied')).toBeDefined();
      expect(
        screen.getByText('You do not have permission to view inventory and catalog records.')
      ).toBeDefined();
      expect(screen.getByText('inventory:read')).toBeDefined();

      // Must NOT display retry button
      expect(screen.queryByRole('button', { name: /Try Again/i })).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
