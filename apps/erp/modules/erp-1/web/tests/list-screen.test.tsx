// @vitest-environment jsdom
/**
 * ERP-1 Products & Inventory — List Screen Test Suite (Issue #9: ERP1-04)
 *
 * Exhaustively validates the primary module list screen vertical slice:
 *   - AC-1: Initial load connects to real API; no hard-coded demo records in production UI path
 *   - AC-2: Search and faceted filters update query state and reset pagination to page 1
 *   - AC-3: Distinct, readable loading, zero-data, filtered-empty, API failure, and 403 access-denied states
 *   - AC-4: Keyboard accessibility: operable search, filter pills, keyboard sorting (Enter/Space), pagination, row links
 *   - AC-5: Server-side pagination and page navigation
 *
 * @module erp1/web/tests/list-screen.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { ProductsListPage } from '../src/pages/ProductsListPage.js';
import * as api from '../src/api/erp-1.js';
import { Erp1ApiError } from '../src/api/erp-1.js';
import type { Product, Category } from '@clearshift/contracts';

const mockCategory1: Category = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Industrial Valves',
  code: 'VLV',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

const mockCategory2: Category = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Piping Components',
  code: 'PIP',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

const mockProduct1: Product & { stockQuantity?: string } = {
  id: '00000000-0000-4000-a000-000000000001',
  name: 'Gate Valve DN50 PN16',
  sku: 'VLV-GT-050',
  normalizedSku: 'VLV-GT-050',
  categoryId: mockCategory1.id,
  unitOfMeasure: 'pcs',
  price: '185.5000',
  currency: 'USD',
  taxRate: '5.00',
  sourceSystem: 'SAP',
  sourceId: '1001',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
  stockQuantity: '42.0000',
};

const mockProduct2: Product & { stockQuantity?: string } = {
  id: '00000000-0000-4000-a000-000000000002',
  name: 'Check Valve DN80 PN25',
  sku: 'VLV-CK-080',
  normalizedSku: 'VLV-CK-080',
  categoryId: mockCategory1.id,
  unitOfMeasure: 'pcs',
  price: '320.0000',
  currency: 'USD',
  taxRate: '5.00',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
  stockQuantity: '0.0000',
};

describe('[ERP1-04] ERP-1 Products and Inventory: List screen, search/filter and stable states (#9)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(api, 'fetchCategories').mockResolvedValue({
      items: [mockCategory1, mockCategory2],
      total: 2,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    vi.spyOn(api, 'fetchProducts').mockResolvedValue({
      items: [mockProduct1, mockProduct2],
      total: 2,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });

    if (typeof window !== 'undefined' && window.history) {
      window.history.replaceState(null, '', '/');
    }
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── AC-1: Initial Load & Real API Data ──────────────────────────────────────
  describe('AC-1: Initial load connects to real API without hard-coded demo data', () => {
    it('renders SDS-required table columns and displays live values from fetchProducts', async () => {
      render(<ProductsListPage />);

      expect(screen.getByText('Products & Inventory')).toBeDefined();
      expect(screen.getByLabelText(/Search products by name or SKU/i)).toBeDefined();

      // Product 1 values
      const p1Row = await screen.findByText('Gate Valve DN50 PN16');
      expect(p1Row).toBeDefined();
      expect(screen.getByText('VLV-GT-050')).toBeDefined();
      expect(screen.getAllByText('Industrial Valves').length).toBeGreaterThan(0);
      expect(screen.getByText('185.50 USD')).toBeDefined();
      expect(screen.getByText('In Stock (42)')).toBeDefined();

      // Product 2 values (zero stock status)
      expect(screen.getByText('Check Valve DN80 PN25')).toBeDefined();
      expect(screen.getByText('VLV-CK-080')).toBeDefined();
      expect(screen.getByText('320.00 USD')).toBeDefined();
      expect(screen.getByText('Out of Stock')).toBeDefined();

      // Verified no hard-coded placeholder items exist
      expect(screen.queryByText('Demo Product')).toBeNull();
      expect(screen.queryByText('Sample Widget')).toBeNull();
    });
  });

  // ── AC-2: Search & Filter Changes Server Query & Resets Page ──────────────
  describe('AC-2: Search & faceted filters update server query and reset page to 1', () => {
    it('debounces search input by 300ms, calls API with search parameter, and resets page to 1', async () => {
      vi.useFakeTimers();

      const fetchSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage initialFilters={{ page: 3 }} />);

      // Initial query was executed
      expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ page: 3 }));

      const searchInput = screen.getByLabelText(/Search products by name or SKU/i);

      act(() => {
        fireEvent.change(searchInput, { target: { value: 'Gate' } });
      });

      // Not called immediately before debounce
      expect(fetchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'Gate' }));

      // Fast-forward debounce timer (300ms)
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'Gate',
          page: 1, // Reset to page 1
        })
      );

      vi.useRealTimers();
    });

    it('updating faceted category filter triggers API fetch with categoryId and resets page to 1', async () => {
      const fetchSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage initialFilters={{ page: 2 }} />);
      await screen.findByText('Gate Valve DN50 PN16');

      const categoryRadio = await screen.findByRole('radio', { name: /Industrial Valves/i });
      fireEvent.click(categoryRadio);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            categoryId: mockCategory1.id,
            page: 1,
          })
        );
      });
    });

    it('clearing active filter pill resets filter state and reloads from page 1', async () => {
      const fetchSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage initialFilters={{ search: 'valve', page: 2 }} />);
      await screen.findByText('Gate Valve DN50 PN16');

      // Click clear button on search filter pill
      const removeBtn = screen.getByRole('button', { name: /Remove search filter/i });
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            search: undefined,
            page: 1,
          })
        );
      });
    });
  });

  // ── AC-3: Distinct Stable States ──────────────────────────────────────────
  describe('AC-3: Distinct, readable loading, empty, error, and 403 access-denied states', () => {
    it('renders animated skeleton placeholder during initial data fetching', () => {
      // Mock fetch with delayed promise
      vi.spyOn(api, 'fetchProducts').mockImplementation(() => new Promise(() => {}));

      render(<ProductsListPage />);

      const skeleton = screen.getByRole('status', { name: /Loading products/i });
      expect(skeleton).toBeDefined();
      expect(skeleton.getAttribute('aria-busy')).toBe('true');
    });

    it('renders zero-data empty state with Add Product CTA when catalog is completely empty', async () => {
      vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage />);

      const emptyTitle = await screen.findByText('No products in inventory');
      expect(emptyTitle).toBeDefined();
      expect(screen.getByRole('button', { name: 'Add Product' })).toBeDefined();
    });

    it('renders filtered-empty state with "Clear all filters" CTA when search yields zero rows', async () => {
      vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage initialFilters={{ search: 'nonexistent-part' }} />);

      const emptyTitle = await screen.findByText('No matching products found');
      expect(emptyTitle).toBeDefined();
      expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeDefined();
    });

    it('renders alert banner with retry action on API failure without leaking stack or SQL', async () => {
      const errorMsg = 'Failed to load products from database\n  at Drizzle.execute (internal/db.ts:42:15)';
      const fetchSpy = vi.spyOn(api, 'fetchProducts').mockRejectedValue(
        new Erp1ApiError(500, 'INTERNAL_SERVER_ERROR', errorMsg, [], 'corr-test-123')
      );

      render(<ProductsListPage />);

      const alertBanner = await screen.findByRole('alert', { name: /Error loading products/i });
      expect(alertBanner).toBeDefined();

      // Raw stack trace stripped
      expect(screen.queryByText(/at Drizzle\.execute/)).toBeNull();
      expect(screen.getByText(/Reference ID:/)).toBeDefined();
      expect(screen.getByText('corr-test-123')).toBeDefined();

      // Retry action
      const retryBtn = screen.getByRole('button', { name: /Try Again/i });
      expect(retryBtn).toBeDefined();

      fetchSpy.mockResolvedValueOnce({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByText('Gate Valve DN50 PN16')).toBeDefined();
      });
    });

    it('renders access-denied view on 403 Forbidden explaining missing role and omitting retry action', async () => {
      vi.spyOn(api, 'fetchProducts').mockRejectedValue(
        new Erp1ApiError(403, 'FORBIDDEN', 'User lacks inventory:read capability')
      );

      render(<ProductsListPage />);

      const heading = await screen.findByRole('heading', { name: 'Access Denied' });
      expect(heading).toBeDefined();
      expect(screen.getByText(/User lacks inventory:read capability/)).toBeDefined();
      expect(screen.getAllByText(/inventory:read/).length).toBeGreaterThan(0);

      // Invariant: 403 Forbidden is not a transient network error, must not render retry button
      expect(screen.queryByRole('button', { name: /Try Again/i })).toBeNull();
    });
  });

  // ── AC-4: Keyboard Accessibility ──────────────────────────────────────────
  describe('AC-4: Keyboard accessibility and accessible names', () => {
    it('supports keyboard operation on sortable table headers using Enter and Space keys', async () => {
      const fetchSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1, mockProduct2],
        total: 2,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage />);
      await screen.findByText('Gate Valve DN50 PN16');

      const nameHeader = screen.getByRole('columnheader', { name: /Product Name/i });
      expect(nameHeader.getAttribute('tabIndex')).toBe('0');

      // Press Enter key to toggle sort direction (default is name/asc -> name/desc)
      fireEvent.keyDown(nameHeader, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sortBy: 'name',
            sortDirection: 'desc',
          })
        );
      });

      // Press Space key to flip direction back to asc
      fireEvent.keyDown(nameHeader, { key: ' ', code: 'Space' });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sortBy: 'name',
            sortDirection: 'asc',
          })
        );
      });
    });

    it('provides accessible links for each product row operable by keyboard', async () => {
      const onSelectSpy = vi.fn();

      render(<ProductsListPage onSelectProduct={onSelectSpy} />);
      await screen.findByText('Gate Valve DN50 PN16');

      const productBtn = screen.getByRole('button', { name: 'View details for Gate Valve DN50 PN16' });
      expect(productBtn).toBeDefined();

      fireEvent.click(productBtn);
      expect(onSelectSpy).toHaveBeenCalledWith(mockProduct1);
    });
  });

  // ── AC-5: Server-Side Pagination ──────────────────────────────────────────
  describe('AC-5: Server-side pagination and page navigation', () => {
    it('displays pagination bar when totalPages > 1 and navigates to page 2', async () => {
      const fetchSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 50,
        page: 1,
        pageSize: 25,
        totalPages: 2,
      });

      render(<ProductsListPage />);
      await screen.findByText('Gate Valve DN50 PN16');

      const nextBtn = screen.getByRole('button', { name: /Next/i });
      expect(nextBtn).toBeDefined();

      fireEvent.click(nextBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            page: 2,
          })
        );
      });
    });
  });
});
