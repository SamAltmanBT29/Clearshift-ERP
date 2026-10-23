import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchProducts,
  fetchCategories,
  fetchStock,
  createProduct,
  buildProductQueryParams,
  Erp1ApiError,
  ERP1_API_BASE,
} from '../src/api/erp-1.js';

describe('ERP-1 API Client Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('buildProductQueryParams', () => {
    it('serializes standard pagination parameters', () => {
      const qs = buildProductQueryParams({ page: 2, pageSize: 50 });
      expect(qs).toBe('?page=2&pageSize=50');
    });

    it('serializes search, category, unit, stock, and price filters', () => {
      const qs = buildProductQueryParams({
        page: 1,
        pageSize: 25,
        search: 'hex bolt',
        categoryId: '00000000-0000-4000-8000-000000000001',
        unitOfMeasure: 'box',
        stockStatus: 'in_stock',
        minPrice: '10.0000',
        maxPrice: '100.0000',
        sortBy: 'price',
        sortDirection: 'asc',
      });

      expect(qs).toContain('search=hex+bolt');
      expect(qs).toContain('categoryId=00000000-0000-4000-8000-000000000001');
      expect(qs).toContain('unitOfMeasure=box');
      expect(qs).toContain('stockStatus=in_stock');
      expect(qs).toContain('minPrice=10.0000');
      expect(qs).toContain('maxPrice=100.0000');
      expect(qs).toContain('sortBy=price');
      expect(qs).toContain('sortDirection=asc');
    });

    it('omits all-stock filter and empty strings', () => {
      const qs = buildProductQueryParams({
        search: '',
        categoryId: ' ',
        stockStatus: 'all',
      });
      expect(qs).toBe('');
    });
  });

  describe('fetchProducts', () => {
    it('makes GET request to /products with proper parameters', async () => {
      const mockResponse = {
        items: [
          {
            id: 'prod-1',
            name: 'Widget A',
            sku: 'WDG-001',
            normalizedSku: 'WDG-001',
            unitOfMeasure: 'pcs',
            price: '19.9900',
            currency: 'USD',
            taxRate: '0.00',
            createdAt: '2026-10-23T00:00:00Z',
            updatedAt: '2026-10-23T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });
      vi.stubGlobal('fetch', fetchSpy);

      const result = await fetchProducts({ search: 'Widget', page: 1 });
      expect(result).toEqual(mockResponse);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${ERP1_API_BASE}/products?page=1&search=Widget`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
        })
      );
    });

    it('normalizes standard error envelope on failure', async () => {
      const errorEnvelope = {
        code: 'VALIDATION_ERROR',
        message: 'Invalid category UUID',
        details: [{ field: 'categoryId', message: 'Must be UUID' }],
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => errorEnvelope,
      });
      vi.stubGlobal('fetch', fetchSpy);

      await expect(fetchProducts({ categoryId: 'invalid-id' })).rejects.toThrow(
        'Invalid category UUID'
      );
    });

    it('throws Erp1ApiError with network error status 0 on fetch failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('Network connection failed'))
      );

      try {
        await fetchProducts({});
        expect.fail('Should have thrown an error');
      } catch (err: any) {
        expect(err).toBeInstanceOf(Erp1ApiError);
        expect(err.status).toBe(0);
        expect(err.code).toBe('NETWORK_ERROR');
        expect(err.message).toBe('Network connection failed');
      }
    });
  });

  describe('fetchCategories', () => {
    it('fetches categories for faceted sidebar', async () => {
      const mockCategories = {
        items: [
          {
            id: 'cat-1',
            name: 'Raw Materials',
            code: 'RAW',
            createdAt: '2026-10-23T00:00:00Z',
            updatedAt: '2026-10-23T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 100,
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockCategories,
        })
      );

      const result = await fetchCategories();
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.code).toBe('RAW');
    });
  });

  describe('fetchStock', () => {
    it('fetches stock level by product id', async () => {
      const mockStock = {
        id: 'stock-1',
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: '50.0000',
        updatedAt: '2026-10-23T00:00:00Z',
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockStock,
        })
      );

      const result = await fetchStock('prod-1');
      expect(result.quantity).toBe('50.0000');
    });
  });

  describe('createProduct', () => {
    it('sends POST request to /products with JSON payload', async () => {
      const newProductPayload = {
        name: 'Industrial Valve 2-inch',
        sku: 'VLV-IND-002',
        unitOfMeasure: 'pcs' as const,
        price: '85.5000',
        currency: 'USD',
        taxRate: '5.00',
      };

      const mockCreatedProduct = {
        id: 'prod-new-1',
        ...newProductPayload,
        normalizedSku: 'VLV-IND-002',
        categoryId: null,
        sourceSystem: null,
        sourceId: null,
        createdAt: '2026-10-23T00:00:00Z',
        updatedAt: '2026-10-23T00:00:00Z',
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockCreatedProduct,
      });
      vi.stubGlobal('fetch', fetchSpy);

      const result = await createProduct(newProductPayload);
      expect(result).toEqual(mockCreatedProduct);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${ERP1_API_BASE}/products`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(newProductPayload),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
        })
      );
    });

    it('throws Erp1ApiError with status 400 and details on validation failure', async () => {
      const errorPayload = {
        code: 'VALIDATION_ERROR',
        message: 'Product validation failed',
        details: [
          { field: 'sku', message: 'SKU already exists' },
          { field: 'price', message: 'Price must be greater than or equal to 0' },
        ],
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          json: async () => errorPayload,
        })
      );

      try {
        await createProduct({
          name: 'Bad Product',
          sku: 'DUPLICATE',
          unitOfMeasure: 'pcs' as const,
          price: '-10',
          currency: 'USD',
        });
        expect.fail('Should have thrown Erp1ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(Erp1ApiError);
        expect(err.status).toBe(400);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.details).toHaveLength(2);
        expect(err.details[0]?.field).toBe('sku');
      }
    });
  });
});
