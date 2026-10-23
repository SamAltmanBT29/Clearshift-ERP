import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CategoryListQuerySchema,
  CreateProductInputSchema,
  ProductListQuerySchema,
  ProductSchema,
  SetOpeningStockInputSchema,
  UpdateCategoryInputSchema,
} from '../src/erp-1.js';

const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';

describe('ERP-1 Products & Inventory contracts', () => {
  describe('Product money and currency contracts', () => {
    it('accepts SDS numeric(19,4) price precision', () => {
      const parsed = ProductSchema.parse({
        id: PRODUCT_ID,
        name: 'Synthetic Widget',
        sku: 'WDG-001',
        normalizedSku: 'WDG-001',
        unitOfMeasure: 'pcs',
        price: '19.9900',
        currency: 'USD',
        taxRate: '5.00',
        createdAt: '2026-10-22T10:00:00.000Z',
        updatedAt: '2026-10-22T10:00:00.000Z',
      });

      expect(parsed.price).toBe('19.9900');
      expect(parsed.currency).toBe('USD');
    });

    it('rejects more than four decimal places in a price', () => {
      expect(
        ProductSchema.safeParse({
          id: PRODUCT_ID,
          name: 'Synthetic Widget',
          sku: 'WDG-001',
          normalizedSku: 'WDG-001',
          unitOfMeasure: 'pcs',
          price: '19.99000',
          currency: 'USD',
          createdAt: '2026-10-22T10:00:00.000Z',
          updatedAt: '2026-10-22T10:00:00.000Z',
        }).success
      ).toBe(false);
    });

    it('requires an explicit uppercase ISO 4217 currency on create', () => {
      const base = {
        name: 'Synthetic Widget',
        sku: 'WDG-001',
        unitOfMeasure: 'pcs',
        price: 19.5,
      };

      expect(CreateProductInputSchema.safeParse(base).success).toBe(false);
      expect(
        CreateProductInputSchema.safeParse({ ...base, currency: 'usd' }).success
      ).toBe(false);

      const parsed = CreateProductInputSchema.parse({ ...base, currency: 'USD' });
      expect(parsed.price).toBe('19.5000');
      expect(parsed.currency).toBe('USD');
    });

    it('rejects malformed decimal strings instead of partially parsing them', () => {
      const base = {
        name: 'Synthetic Widget',
        sku: 'WDG-001',
        unitOfMeasure: 'pcs',
        currency: 'USD',
      };

      expect(
        CreateProductInputSchema.safeParse({ ...base, price: '12abc' }).success
      ).toBe(false);
      expect(
        CreateProductInputSchema.safeParse({ ...base, price: '0x10' }).success
      ).toBe(false);
      expect(
        CreateProductInputSchema.safeParse({ ...base, price: '19.99000' }).success
      ).toBe(false);
    });

    it('normalizes stock quantities to four decimal places', () => {
      const parsed = SetOpeningStockInputSchema.parse({
        productId: PRODUCT_ID,
        quantity: '150.5',
      });
      expect(parsed.quantity).toBe('150.5000');

      expect(() =>
        SetOpeningStockInputSchema.parse({
          productId: PRODUCT_ID,
          quantity: '-0.0001',
        })
      ).toThrow(/Stock quantity cannot become negative/);
    });
  });

  describe('Pagination contracts', () => {
    it('uses the architecture default page size of 25 and caps it at 100', () => {
      expect(ProductListQuerySchema.parse({}).pageSize).toBe(25);
      expect(CategoryListQuerySchema.parse({}).pageSize).toBe(25);
      expect(ProductListQuerySchema.safeParse({ pageSize: 100 }).success).toBe(true);
      expect(ProductListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    });

    it('accepts product search and category filters', () => {
      const parsed = ProductListQuerySchema.parse({
        search: 'widget',
        categoryId: PRODUCT_ID,
      });
      expect(parsed.search).toBe('widget');
      expect(parsed.categoryId).toBe(PRODUCT_ID);
    });
  });

  describe('Category edit contract', () => {
    it('accepts a partial category update', () => {
      expect(UpdateCategoryInputSchema.parse({ name: 'Renamed' })).toEqual({
        name: 'Renamed',
      });
    });
  });

  describe('ERP-1 OpenAPI document', () => {
    const content = readFileSync(
      resolve(__dirname, '../openapi/erp-1.yaml'),
      'utf8'
    );

    it('documents every required ERP-1 endpoint', () => {
      const requiredPaths = [
        '/api/v1/erp-products/products:',
        '/api/v1/erp-products/products/{id}:',
        '/api/v1/erp-products/categories:',
        '/api/v1/erp-products/categories/{id}:',
        '/api/v1/erp-products/stock:',
        '/api/v1/erp-products/stock/opening:',
      ];

      for (const path of requiredPaths) {
        expect(content).toContain(path);
      }
      expect(content).toContain('operationId: updateErp1Category');
      expect(content).toContain('operationId: getErp1Product');
    });

    it('uses the shared flat pagination response instead of an undefined PaginationMeta', () => {
      expect(content).not.toContain('PaginationMeta');
      expect(content).toContain('ProductListResponse:');
      expect(content).toContain('CategoryListResponse:');
      expect(content).toContain('required: [items, page, pageSize, total]');
    });

    it('documents numeric(19,4) strings and explicit currency', () => {
      expect(content).toContain('pattern: \'^\\d+(\\.\\d{1,4})?$\'');
      expect(content).toContain('Currency:');
      expect(content).toContain("pattern: '^[A-Z]{3}$'");
      expect(content).toContain('required: [name, sku, unitOfMeasure, price, currency]');
    });

    it('resolves every local component schema reference', () => {
      const componentNames = new Set(
        [...content.matchAll(/^    ([A-Za-z0-9]+):$/gm)].map((match) => match[1])
      );
      const localRefs = [
        ...content.matchAll(/\$ref: '#\/components\/schemas\/([A-Za-z0-9]+)'/g),
      ].map((match) => match[1]);

      expect(localRefs.length).toBeGreaterThan(0);
      for (const ref of localRefs) {
        expect(componentNames.has(ref as string), `missing component ${ref}`).toBe(true);
      }
    });
  });
});
