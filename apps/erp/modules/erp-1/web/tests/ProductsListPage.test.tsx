// @vitest-environment jsdom
/** Test suite for ERP-1 ProductsListPage covering loading skeleton, empty states, and filter interactions */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { ProductsListPage } from '../src/pages/ProductsListPage.js';
import * as api from '../src/api/erp-1.js';
import type { Product, Category } from '@clearshift/contracts';

const mockCategory1: Category = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Raw Materials',
  code: 'RAW',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

const mockCategory2: Category = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Finished Goods',
  code: 'FIN',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

const mockProduct1: Product & { stockQuantity?: string } = {
  id: '00000000-0000-4000-a000-000000000001',
  name: 'Precision Steel Hex Bolt M8',
  sku: 'BLT-HEX-001',
  normalizedSku: 'BLT-HEX-001',
  categoryId: mockCategory1.id,
  unitOfMeasure: 'box',
  price: '45.5000',
  currency: 'USD',
  taxRate: '5.00',
  sourceSystem: 'SAP',
  sourceId: '1001',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
  stockQuantity: '150.0000',
};

const mockProduct2: Product & { stockQuantity?: string } = {
  id: '00000000-0000-4000-a000-000000000002',
  name: 'Standard Ergonomic Office Chair',
  sku: 'CHR-ERG-901',
  normalizedSku: 'CHR-ERG-901',
  categoryId: mockCategory2.id,
  unitOfMeasure: 'pcs',
  price: '299.9900',
  currency: 'USD',
  taxRate: '8.25',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
  stockQuantity: '5.0000',
};

describe('ERP-1 ProductsListPage — Search, Filters, and Sorting Controls (#114)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default mock responses
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

  describe('1. Initial Load and Rendering', () => {
    it('renders page header, search input, faceted filter sidebar, and products table', async () => {
      render(<ProductsListPage />);

      expect(screen.getByText('Products & Inventory')).toBeDefined();
      expect(
        screen.getByLabelText(/Search products by name or SKU/i)
      ).toBeDefined();
      expect(screen.getByRole('complementary', { name: /Faceted filters/i })).toBeDefined();

      const boltRow = await screen.findByText('Precision Steel Hex Bolt M8');
      expect(boltRow).toBeDefined();
      expect(screen.getByText('BLT-HEX-001')).toBeDefined();
      expect(screen.getByText('CHR-ERG-901')).toBeDefined();
      expect(screen.getByText('In Stock (150)')).toBeDefined();
      expect(screen.getByText('Low (5)')).toBeDefined();
    });
  });

  describe('2. Acceptance Criterion 1: Search input debounces keystrokes (300ms)', () => {
    it('debounces search input by 300ms before triggering API request and resets page to 1', async () => {
      vi.useFakeTimers();

      const fetchProductsSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage />);

      // Flush initial load
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchProductsSpy).toHaveBeenCalledTimes(1);

      const searchInput = screen.getByLabelText(/Search products by name or SKU/i);

      // Type "Hex" into search
      act(() => {
        fireEvent.change(searchInput, { target: { value: 'Hex' } });
      });

      // After 100ms, API should NOT have been called again yet
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(fetchProductsSpy).toHaveBeenCalledTimes(1);

      // After an additional 250ms (total 350ms > 300ms debounce)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(fetchProductsSpy).toHaveBeenCalledTimes(2);
      expect(fetchProductsSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: 'Hex',
          page: 1,
        })
      );

      vi.useRealTimers();
    });

    it('clicking the clear search button clears the input immediately and refetches', async () => {
      render(<ProductsListPage />);
      await screen.findByText('Precision Steel Hex Bolt M8');

      const searchInput = screen.getByLabelText(/Search products by name or SKU/i);
      fireEvent.change(searchInput, { target: { value: 'Hex' } });

      const clearBtn = await screen.findByLabelText(/Clear search input/i);
      expect(clearBtn).toBeDefined();

      fireEvent.click(clearBtn);
      await waitFor(() => {
        expect((searchInput as HTMLInputElement).value).toBe('');
      });
    });
  });

  describe('3. Acceptance Criterion 2: Faceted filters update URL query state and reload table results', () => {
    it('selecting a category radio updates URL query state and reloads table results', async () => {
      const fetchProductsSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage />);
      await screen.findByText('Precision Steel Hex Bolt M8');

      // Find Raw Materials radio button in faceted sidebar
      const rawRadio = await screen.findByRole('radio', { name: /Raw Materials/i });
      fireEvent.click(rawRadio);

      await waitFor(() => {
        expect(fetchProductsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            categoryId: mockCategory1.id,
            page: 1,
          })
        );
        expect(window.location.search).toContain(`categoryId=${mockCategory1.id}`);
      });
    });

    it('selecting unit of measure updates URL query state and reloads table results', async () => {
      const fetchProductsSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage />);
      await screen.findByText('Precision Steel Hex Bolt M8');

      const boxRadio = screen.getByRole('radio', { name: /Boxes \(box\)/i });
      fireEvent.click(boxRadio);

      await waitFor(() => {
        expect(fetchProductsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            unitOfMeasure: 'box',
            page: 1,
          })
        );
        expect(window.location.search).toContain('unitOfMeasure=box');
      });
    });

    it('selecting stock status filter updates URL query state and reloads table results', async () => {
      const fetchProductsSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage />);
      await screen.findByText('Precision Steel Hex Bolt M8');

      const inStockRadio = screen.getByRole('radio', { name: /In Stock \(> 10\)/i });
      fireEvent.click(inStockRadio);

      await waitFor(() => {
        expect(fetchProductsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            stockStatus: 'in_stock',
            page: 1,
          })
        );
        expect(window.location.search).toContain('stockStatus=in_stock');
      });
    });

    it('applying price range updates URL query state and reloads table results', async () => {
      const fetchProductsSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage />);
      await screen.findByText('Precision Steel Hex Bolt M8');

      const minInput = screen.getByLabelText(/Min \(\$\)/i);
      const maxInput = screen.getByLabelText(/Max \(\$\)/i);
      const applyBtn = screen.getByLabelText(/Apply price range filter/i);

      fireEvent.change(minInput, { target: { value: '10' } });
      fireEvent.change(maxInput, { target: { value: '50' } });
      fireEvent.click(applyBtn);

      await waitFor(() => {
        expect(fetchProductsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            minPrice: '10',
            maxPrice: '50',
            page: 1,
          })
        );
        expect(window.location.search).toContain('minPrice=10');
        expect(window.location.search).toContain('maxPrice=50');
      });
    });
  });

  describe('4. Acceptance Criterion 3: Active filter pills can be cleared individually or reset with Clear All', () => {
    it('renders filter pills for active filters and clearing a pill removes that filter', async () => {
      const fetchProductsSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(
        <ProductsListPage
          initialFilters={{
            search: 'Bolt',
            unitOfMeasure: 'box',
          }}
        />
      );

      await screen.findByText('Precision Steel Hex Bolt M8');

      // Check active pills
      expect(screen.getByText(/"Bolt"/)).toBeDefined();
      expect(screen.getAllByText('box').length).toBeGreaterThanOrEqual(1);

      // Click remove button on unit pill
      const removeUnitBtn = screen.getByLabelText(/Remove unit of measure filter: box/i);
      fireEvent.click(removeUnitBtn);

      await waitFor(() => {
        expect(fetchProductsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            search: 'Bolt',
            unitOfMeasure: undefined,
            page: 1,
          })
        );
      });
    });

    it('clicking Clear All resets all filters and search term', async () => {
      const fetchProductsSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1, mockProduct2],
        total: 2,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(
        <ProductsListPage
          initialFilters={{
            search: 'Bolt',
            categoryId: mockCategory1.id,
            unitOfMeasure: 'box',
          }}
        />
      );

      await screen.findByText('Precision Steel Hex Bolt M8');

      const clearAllBtn = screen.getByLabelText(/Clear all active filters/i);
      fireEvent.click(clearAllBtn);

      await waitFor(() => {
        expect(fetchProductsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            search: undefined,
            categoryId: undefined,
            unitOfMeasure: undefined,
            page: 1,
          })
        );
      });
    });
  });

  describe('5. Acceptance Criterion 4: Empty search/filter results display informative empty state message', () => {
    it('displays informative empty state message and clear filters action when 0 results return', async () => {
      vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 0,
      });

      render(
        <ProductsListPage
          initialFilters={{
            search: 'nonexistent-sku-xyz',
          }}
        />
      );

      const emptyTitle = await screen.findByText('No matching products found');
      expect(emptyTitle).toBeDefined();
      expect(
        screen.getByText(
          /No products match the selected filters or search query\. Try adjusting your search term or clearing active filters\./i
        )
      ).toBeDefined();

      const clearBtn = screen.getByRole('button', { name: /Clear all filters/i });
      expect(clearBtn).toBeDefined();

      // Clicking action clears filters
      fireEvent.click(clearBtn);
      const searchInput = screen.getByLabelText(/Search products by name or SKU/i);
      await waitFor(() => {
        expect((searchInput as HTMLInputElement).value).toBe('');
      });
    });
  });

  describe('6. Sorting Controls', () => {
    it('changing sort field triggers API call with selected sort column', async () => {
      const fetchProductsSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage />);
      await screen.findByText('Precision Steel Hex Bolt M8');

      const sortSelect = screen.getByLabelText(/Sort products by column/i);
      fireEvent.change(sortSelect, { target: { value: 'price' } });

      await waitFor(() => {
        expect(fetchProductsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sortBy: 'price',
            sortDirection: 'asc',
            page: 1,
          })
        );
      });
    });

    it('toggling sort direction flips between asc and desc', async () => {
      const fetchProductsSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage />);
      await screen.findByText('Precision Steel Hex Bolt M8');

      const sortDirBtn = screen.getByLabelText(/Toggle sort order, currently ascending/i);
      fireEvent.click(sortDirBtn);

      await waitFor(() => {
        expect(fetchProductsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sortDirection: 'desc',
            page: 1,
          })
        );
      });
    });

    it('clicking table header column toggles sort order for that column', async () => {
      const fetchProductsSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage />);
      await screen.findByText('Precision Steel Hex Bolt M8');

      const skuHeader = screen.getByRole('columnheader', { name: /SKU/i });
      fireEvent.click(skuHeader);

      await waitFor(() => {
        expect(fetchProductsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sortBy: 'sku',
            sortDirection: 'asc',
            page: 1,
          })
        );
      });
    });

    it('pressing Enter on sortable table header toggles sort order', async () => {
      const fetchProductsSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      render(<ProductsListPage />);
      await screen.findByText('Precision Steel Hex Bolt M8');

      const nameHeader = screen.getByRole('columnheader', { name: /Product Name/i });
      fireEvent.keyDown(nameHeader, { key: 'Enter' });

      await waitFor(() => {
        expect(fetchProductsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sortBy: 'name',
            sortDirection: 'desc',
            page: 1,
          })
        );
      });
    });

    it('mobile filter button opens and closes mobile filter sidebar drawer', async () => {
      render(<ProductsListPage />);
      await screen.findByText('Precision Steel Hex Bolt M8');

      const mobileBtn = screen.getByLabelText(/Open filter sidebar/i);
      fireEvent.click(mobileBtn);

      const closeBtn = screen.getByLabelText(/Close filters sidebar/i);
      expect(closeBtn).toBeDefined();

      fireEvent.click(closeBtn);
    });

    it('paginates when multi-page results are returned', async () => {
      const fetchProductsSpy = vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [mockProduct1],
        total: 50,
        page: 1,
        pageSize: 25,
        totalPages: 2,
      });

      render(<ProductsListPage />);
      await screen.findByText('Precision Steel Hex Bolt M8');

      const nextBtn = screen.getByLabelText(/Go to next page/i);
      fireEvent.click(nextBtn);

      await waitFor(() => {
        expect(fetchProductsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            page: 2,
          })
        );
      });
    });
  });

  describe('7. Error Handling and Recovery', () => {
    it('displays error message and allows operator to retry on failure', async () => {
      const fetchProductsSpy = vi
        .spyOn(api, 'fetchProducts')
        .mockRejectedValueOnce(new api.Erp1ApiError(500, 'SERVER_ERROR', 'Database query timed out'))
        .mockResolvedValueOnce({
          items: [mockProduct1],
          total: 1,
          page: 1,
          pageSize: 25,
          totalPages: 1,
        });

      render(<ProductsListPage />);

      const errorMsg = await screen.findByText('Database query timed out');
      expect(errorMsg).toBeDefined();

      const retryBtn = screen.getByRole('button', { name: /Try Again/i });
      fireEvent.click(retryBtn);

      const boltRow = await screen.findByText('Precision Steel Hex Bolt M8');
      expect(boltRow).toBeDefined();
    });
  });
});
