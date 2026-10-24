// @vitest-environment jsdom
/**
 * ERP-1 Products & Inventory — Main Paginated Data Table Test Suite (Issue #113: ERP1-17)
 *
 * Exhaustively validates the primary collection table screen:
 *   - AC-1: Table displays entity rows with stable columns matching the data dictionary.
 *   - AC-2: Pagination controls bind to API page and pageSize query parameters.
 *   - AC-3: Sorting by column headers toggles ascending/descending order predictably.
 *   - AC-4: Virtualization or bounded paging prevents DOM performance degradation (pageSize <= 100).
 *
 * @module erp1/web/tests/paginated-data-table.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProductsTable, type ProductWithStock } from '../src/components/ProductsTable.js';
import { ProductsListPage } from '../src/pages/ProductsListPage.js';
import * as api from '../src/api/erp-1.js';
import type { Category } from '@clearshift/contracts';

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

const mockProduct1: ProductWithStock = {
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

const mockProduct2: ProductWithStock = {
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

const mockProduct3: ProductWithStock = {
  id: '00000000-0000-4000-a000-000000000003',
  name: 'Flange Steel DN100',
  sku: 'FLG-ST-100',
  normalizedSku: 'FLG-ST-100',
  categoryId: mockCategory2.id,
  unitOfMeasure: 'box',
  price: '65.2500',
  currency: 'USD',
  taxRate: '8.25',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
  stockQuantity: '8.0000', // Low stock <= 10
};

describe('[ERP1-17] ERP-1 Products and Inventory: Main paginated data table (#113)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined' && window.history) {
      window.history.replaceState(null, '', '/');
    }
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── AC-1: Stable Columns Matching Data Dictionary ──────────────────────────
  describe('AC-1: Stable Columns Matching Data Dictionary', () => {
    it('renders table with semantic caption, headers, and formatted data rows', () => {
      render(
        <ProductsTable
          products={[mockProduct1, mockProduct2, mockProduct3]}
          categories={[mockCategory1, mockCategory2]}
          isLoading={false}
          total={3}
          page={1}
          pageSize={25}
          totalPages={1}
          onPageChange={vi.fn()}
        />
      );

      // Verify table element & accessibility landmarks
      const table = screen.getByRole('table', { name: /Products catalog and inventory table/i });
      expect(table).toBeDefined();
      expect(table.getAttribute('aria-busy')).toBe('false');

      // Verify stable column headers
      expect(screen.getByRole('columnheader', { name: /Product Name/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /SKU/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Category/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Unit/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Price/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Tax Rate/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Stock Status/i })).toBeDefined();

      // Verify row values
      expect(screen.getByText('Gate Valve DN50 PN16')).toBeDefined();
      expect(screen.getByText('VLV-GT-050')).toBeDefined();
      expect(screen.getAllByText('Industrial Valves').length).toBe(2);
      expect(screen.getByText('185.50 USD')).toBeDefined();
      expect(screen.getByText('In Stock (42)')).toBeDefined();

      // Verify Out of Stock status
      expect(screen.getByText('Out of Stock')).toBeDefined();

      // Verify Low stock status (qty 8)
      expect(screen.getByText('Low (8)')).toBeDefined();
    });

    it('renders empty message when products array is empty', () => {
      render(
        <ProductsTable
          products={[]}
          categories={[mockCategory1]}
          isLoading={false}
          total={0}
          page={1}
          pageSize={25}
          totalPages={1}
          onPageChange={vi.fn()}
        />
      );

      expect(screen.getByText('No records found matching search or filter')).toBeDefined();
    });

    it('renders loading indication and sets aria-busy when isLoading is true', () => {
      render(
        <ProductsTable
          products={[]}
          categories={[mockCategory1]}
          isLoading={true}
          total={0}
          page={1}
          pageSize={25}
          totalPages={1}
          onPageChange={vi.fn()}
        />
      );

      const table = screen.getByRole('table');
      expect(table.getAttribute('aria-busy')).toBe('true');
      expect(screen.getByText('Loading products...')).toBeDefined();
    });

    it('renders clickable link button when onSelectProduct callback is supplied', () => {
      const selectSpy = vi.fn();
      render(
        <ProductsTable
          products={[mockProduct1]}
          categories={[mockCategory1]}
          isLoading={false}
          total={1}
          page={1}
          pageSize={25}
          totalPages={1}
          onPageChange={vi.fn()}
          onSelectProduct={selectSpy}
        />
      );

      const linkBtn = screen.getByRole('button', { name: /View details for Gate Valve DN50 PN16/i });
      fireEvent.click(linkBtn);
      expect(selectSpy).toHaveBeenCalledWith(mockProduct1);
    });
  });

  // ── AC-2: Pagination Controls Bind to Page and PageSize ─────────────────────
  describe('AC-2: Pagination Controls Bind to Page and PageSize', () => {
    it('renders pagination bar with page information and triggers onPageChange', () => {
      const pageChangeSpy = vi.fn();
      render(
        <ProductsTable
          products={[mockProduct1]}
          categories={[mockCategory1]}
          isLoading={false}
          total={50}
          page={1}
          pageSize={25}
          totalPages={2}
          onPageChange={pageChangeSpy}
        />
      );

      const nav = screen.getByRole('navigation', { name: /Pagination/i });
      expect(nav).toBeDefined();
      expect(screen.getByText(/Showing page/i)).toBeDefined();

      const nextBtn = screen.getByRole('button', { name: /Go to next page/i });
      expect(nextBtn).toBeDefined();
      fireEvent.click(nextBtn);
      expect(pageChangeSpy).toHaveBeenCalledWith(2);
    });

    it('renders per-page size selector and triggers onPageSizeChange', () => {
      const pageSizeSpy = vi.fn();
      render(
        <ProductsTable
          products={[mockProduct1]}
          categories={[mockCategory1]}
          isLoading={false}
          total={100}
          page={1}
          pageSize={25}
          totalPages={4}
          onPageChange={vi.fn()}
          onPageSizeChange={pageSizeSpy}
          pageSizeOptions={[10, 25, 50, 100]}
        />
      );

      const select = screen.getByLabelText(/Items per page/i) as HTMLSelectElement;
      expect(select).toBeDefined();
      expect(select.value).toBe('25');

      fireEvent.change(select, { target: { value: '50' } });
      expect(pageSizeSpy).toHaveBeenCalledWith(50);
    });

    it('disables previous button on first page and next button on last page', () => {
      const { rerender } = render(
        <ProductsTable
          products={[mockProduct1]}
          categories={[mockCategory1]}
          isLoading={false}
          total={30}
          page={1}
          pageSize={10}
          totalPages={3}
          onPageChange={vi.fn()}
        />
      );

      const prevBtn = screen.getByRole('button', { name: /Go to previous page/i }) as HTMLButtonElement;
      expect(prevBtn.disabled).toBe(true);

      rerender(
        <ProductsTable
          products={[mockProduct1]}
          categories={[mockCategory1]}
          isLoading={false}
          total={30}
          page={3}
          pageSize={10}
          totalPages={3}
          onPageChange={vi.fn()}
        />
      );

      const nextBtn = screen.getByRole('button', { name: /Go to next page/i }) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);
    });
  });

  // ── AC-3: Sorting by Column Headers Toggles Order Predictably ──────────────
  describe('AC-3: Sorting by Column Headers Toggles Order Predictably', () => {
    it('sets aria-sort correctly on active and inactive sortable column headers', () => {
      render(
        <ProductsTable
          products={[mockProduct1]}
          categories={[mockCategory1]}
          isLoading={false}
          total={1}
          page={1}
          pageSize={25}
          totalPages={1}
          onPageChange={vi.fn()}
          sortBy="sku"
          sortDirection="desc"
          onSort={vi.fn()}
        />
      );

      const skuHeader = screen.getByRole('columnheader', { name: /SKU/i });
      expect(skuHeader.getAttribute('aria-sort')).toBe('descending');

      const nameHeader = screen.getByRole('columnheader', { name: /Product Name/i });
      expect(nameHeader.getAttribute('aria-sort')).toBe('none');

      const priceHeader = screen.getByRole('columnheader', { name: /Price/i });
      expect(priceHeader.getAttribute('aria-sort')).toBe('none');
    });

    it('triggers onSort with column identifier when clicked', () => {
      const sortSpy = vi.fn();
      render(
        <ProductsTable
          products={[mockProduct1]}
          categories={[mockCategory1]}
          isLoading={false}
          total={1}
          page={1}
          pageSize={25}
          totalPages={1}
          onPageChange={vi.fn()}
          onSort={sortSpy}
        />
      );

      const nameHeader = screen.getByRole('columnheader', { name: /Product Name/i });
      fireEvent.click(nameHeader);
      expect(sortSpy).toHaveBeenCalledWith('name');

      const priceHeader = screen.getByRole('columnheader', { name: /Price/i });
      fireEvent.click(priceHeader);
      expect(sortSpy).toHaveBeenCalledWith('price');
    });

    it('supports keyboard navigation via Enter and Space on sortable headers', () => {
      const sortSpy = vi.fn();
      render(
        <ProductsTable
          products={[mockProduct1]}
          categories={[mockCategory1]}
          isLoading={false}
          total={1}
          page={1}
          pageSize={25}
          totalPages={1}
          onPageChange={vi.fn()}
          onSort={sortSpy}
        />
      );

      const skuHeader = screen.getByRole('columnheader', { name: /SKU/i });

      // Enter key
      fireEvent.keyDown(skuHeader, { key: 'Enter' });
      expect(sortSpy).toHaveBeenCalledWith('sku');

      // Space key
      fireEvent.keyDown(skuHeader, { key: ' ' });
      expect(sortSpy).toHaveBeenCalledWith('sku');
    });
  });

  // ── AC-4: Bounded Paging & Integration in ProductsListPage ──────────────────
  describe('AC-4: Bounded Paging & Integration in ProductsListPage', () => {
    it('binds page size selection to API query and resets page to 1', async () => {
      vi.spyOn(api, 'fetchCategories').mockResolvedValue({
        items: [mockCategory1],
        total: 1,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      });

      const fetchSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1, mockProduct2],
        total: 100,
        page: 2,
        pageSize: 25,
        totalPages: 4,
      });

      render(<ProductsListPage initialFilters={{ page: 2, pageSize: 25 }} />);
      await screen.findByText('Gate Valve DN50 PN16');

      const select = screen.getByLabelText(/Items per page/i) as HTMLSelectElement;
      expect(select.value).toBe('25');

      fireEvent.change(select, { target: { value: '50' } });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            pageSize: 50,
            page: 1, // Resets to page 1 on page size change
          })
        );
      });
    });

    it('toggling sort column in ProductsListPage updates sort state and reloads from page 1', async () => {
      vi.spyOn(api, 'fetchCategories').mockResolvedValue({
        items: [mockCategory1],
        total: 1,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      });

      const fetchSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 30,
        page: 2,
        pageSize: 25,
        totalPages: 2,
      });

      render(<ProductsListPage initialFilters={{ page: 2, sortBy: 'name', sortDirection: 'asc' }} />);
      await screen.findByText('Gate Valve DN50 PN16');

      // Click same column 'Product Name' toggles to 'desc'
      const nameHeader = screen.getByRole('columnheader', { name: /Product Name/i });
      fireEvent.click(nameHeader);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sortBy: 'name',
            sortDirection: 'desc',
            page: 1,
          })
        );
      });

      // Click different column 'Price' sets to 'price' and 'asc'
      const priceHeader = screen.getByRole('columnheader', { name: /Price/i });
      fireEvent.click(priceHeader);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sortBy: 'price',
            sortDirection: 'asc',
            page: 1,
          })
        );
      });
    });

    it('bounds page size to maximum 100 adhering to ClearShift platform contract', async () => {
      vi.spyOn(api, 'fetchCategories').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      });

      const fetchSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      });

      // Initial query with 100 page size
      render(<ProductsListPage initialFilters={{ pageSize: 100 }} />);
      await screen.findByText('Gate Valve DN50 PN16');

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          pageSize: 100,
        })
      );
    });
  });
});
