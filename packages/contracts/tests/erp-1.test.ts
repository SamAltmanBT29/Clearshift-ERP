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
  UpdateProductInputSchema,
  ProductLinkedRecordsSchema,
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

    it('validates email format and phone numbers when provided', () => {
      const base = {
        name: 'Synthetic Widget',
        sku: 'WDG-001',
        unitOfMeasure: 'pcs',
        currency: 'USD',
        price: '19.99',
      };

      // Valid email and phone
      const valid = CreateProductInputSchema.safeParse({
        ...base,
        notificationEmail: 'supplier@example.com',
        contactPhone: '+1-555-019-2834',
      });
      expect(valid.success).toBe(true);

      // Invalid email
      const invalidEmail = CreateProductInputSchema.safeParse({
        ...base,
        notificationEmail: 'invalid-email-address',
      });
      expect(invalidEmail.success).toBe(false);

      // Invalid phone
      const invalidPhone = CreateProductInputSchema.safeParse({
        ...base,
        contactPhone: 'bad-phone',
      });
      expect(invalidPhone.success).toBe(false);
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

    it('accepts faceted filters and sorting controls (ERP1-18)', () => {
      const parsed = ProductListQuerySchema.parse({
        search: 'bolts',
        categoryId: PRODUCT_ID,
        unitOfMeasure: 'box',
        stockStatus: 'in_stock',
        minPrice: '10.50',
        maxPrice: '100.00',
        sortBy: 'price',
        sortDirection: 'asc',
      });
      expect(parsed.unitOfMeasure).toBe('box');
      expect(parsed.stockStatus).toBe('in_stock');
      expect(parsed.minPrice).toBe('10.5000');
      expect(parsed.maxPrice).toBe('100.0000');
      expect(parsed.sortBy).toBe('price');
      expect(parsed.sortDirection).toBe('asc');
    });

    it('handles empty string filter values by converting them to undefined', () => {
      const parsed = ProductListQuerySchema.parse({
        categoryId: '',
        unitOfMeasure: '',
        stockStatus: '',
        minPrice: '',
        maxPrice: '',
        sortBy: '',
      });
      expect(parsed.categoryId).toBeUndefined();
      expect(parsed.unitOfMeasure).toBeUndefined();
      expect(parsed.stockStatus).toBeUndefined();
      expect(parsed.minPrice).toBeUndefined();
      expect(parsed.maxPrice).toBeUndefined();
      expect(parsed.sortBy).toBeUndefined();
    });
  });

  describe('Category edit contract', () => {
    it('accepts a partial category update', () => {
      expect(UpdateCategoryInputSchema.parse({ name: 'Renamed' })).toEqual({
        name: 'Renamed',
      });
    });
  });

  describe('Product edit contract (ERP1-21)', () => {
    it('accepts partial product updates for allowlisted fields', () => {
      const parsed = UpdateProductInputSchema.parse({
        name: 'Updated Widget Name',
        price: '29.99',
        currency: 'EUR',
        taxRate: '12.50',
        unitOfMeasure: 'box',
        notificationEmail: 'ops@clearshift.internal',
        contactPhone: '+1-555-888-9999',
        version: '2026-10-23T12:00:00.000Z',
      });

      expect(parsed.name).toBe('Updated Widget Name');
      expect(parsed.price).toBe('29.9900');
      expect(parsed.currency).toBe('EUR');
      expect(parsed.taxRate).toBe('12.50');
      expect(parsed.unitOfMeasure).toBe('box');
      expect(parsed.notificationEmail).toBe('ops@clearshift.internal');
      expect(parsed.contactPhone).toBe('+1-555-888-9999');
      expect(parsed.version).toBe('2026-10-23T12:00:00.000Z');
    });

    it('rejects invalid email and phone in update payload', () => {
      expect(
        UpdateProductInputSchema.safeParse({
          notificationEmail: 'not-an-email',
        }).success
      ).toBe(false);

      expect(
        UpdateProductInputSchema.safeParse({
          contactPhone: 'abc',
        }).success
      ).toBe(false);
    });

    it('rejects negative prices in update payload', () => {
      expect(() =>
        UpdateProductInputSchema.parse({
          price: '-10.00',
        })
      ).toThrow(/Price must be greater than or equal to 0/);
    });
  });

  describe('Product linked records contract (ERP1-21)', () => {
    it('validates linked stock, purchasing, and sales records', () => {
      const parsed = ProductLinkedRecordsSchema.parse({
        productId: PRODUCT_ID,
        stockLevels: [
          {
            warehouseId: '00000000-0000-4000-8000-000000000010',
            warehouseCode: 'WH-01',
            warehouseName: 'Central Logistics Hub',
            quantity: '340.0000',
            unitOfMeasure: 'pcs',
            updatedAt: '2026-10-23T08:00:00.000Z',
          },
        ],
        purchaseOrders: [
          {
            id: '00000000-0000-4000-8000-000000000020',
            purchaseOrderId: '00000000-0000-4000-8000-000000000021',
            poNumber: 'PO-2026-0041',
            vendorName: 'Apex Precision Supplies',
            orderDate: '2026-10-15',
            quantity: '500.0000',
            unitPrice: '14.5000',
            currency: 'USD',
            status: 'received',
          },
        ],
        salesOrders: [
          {
            id: '00000000-0000-4000-8000-000000000030',
            orderId: '00000000-0000-4000-8000-000000000031',
            orderNumber: 'SO-2026-1089',
            customerGoldenId: 'CUST-GLD-88219',
            orderDate: '2026-10-20',
            quantity: '25.0000',
            unitPrice: '29.9900',
            lineTotal: '749.7500',
            currency: 'USD',
            status: 'invoiced',
          },
        ],
      });

      expect(parsed.stockLevels).toHaveLength(1);
      expect(parsed.purchaseOrders).toHaveLength(1);
      expect(parsed.salesOrders).toHaveLength(1);
      expect(parsed.purchaseOrders[0]?.poNumber).toBe('PO-2026-0041');
      expect(parsed.salesOrders[0]?.customerGoldenId).toBe('CUST-GLD-88219');
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
        '/api/v1/erp-products/products/{id}/linked-records:',
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
      expect(content).toContain('operationId: getErp1ProductLinkedRecords');
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

    it('validates DirtyDataProfileReport and DataQualityRule schemas', async () => {
      const {
        DataQualityRuleSchema,
        DirtyDataProfileReportSchema,
      } = await import('../src/erp-1.js');

      const rule = DataQualityRuleSchema.parse({
        rule_id: 'PRD-001',
        version: '1.0.0',
        record_type: 'product',
        field: 'name',
        condition: 'product name is empty or whitespace',
        action: 'reject',
        reason_code: 'PRODUCT_NAME_REQUIRED',
        explanation: 'Product name is mandatory.',
        doc_reference: 'FR-ERP1-01',
      });
      expect(rule.rule_id).toBe('PRD-001');

      const expectedProfile = JSON.parse(
        readFileSync(resolve(__dirname, '../../../sample-data/erp-1/expected-profile.json'), 'utf8')
      );
      const parsedReport = DirtyDataProfileReportSchema.parse(expectedProfile);
      expect(parsedReport.module).toBe('erp1');
      expect(parsedReport.reconciliation.is_balanced).toBe(true);
      expect(parsedReport.reconciliation.unaccounted).toBe(0);
    });
  });
});
