import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  erp1Categories,
  erp1Warehouses,
  erp1Products,
  erp1StockLevels,
  erp1ImportReceipts,
  unitOfMeasureEnum,
} from '../../db/schema.js';
import {
  UnitOfMeasureSchema,
  normalizeSku,
  CreateProductInputSchema,
  CreateCategoryInputSchema,
  SetOpeningStockInputSchema,
  ProductSchema,
} from '@clearshift/contracts';

describe('[ERP1-01] Products and Inventory V1 Schema & Invariant Tests', () => {
  describe('Drizzle Schema & Table Definitions', () => {
    it('defines erp1 schema tables with correct columns and constraints', () => {
      expect(erp1Categories).toBeDefined();
      expect(erp1Warehouses).toBeDefined();
      expect(erp1Products).toBeDefined();
      expect(erp1StockLevels).toBeDefined();
      expect(erp1ImportReceipts).toBeDefined();

      // Check product column mappings
      expect(erp1Products.id).toBeDefined();
      expect(erp1Products.sku).toBeDefined();
      expect(erp1Products.normalizedSku).toBeDefined();
      expect(erp1Products.price).toBeDefined();
      expect(erp1Products.taxRate).toBeDefined();
      expect(erp1Products.unitOfMeasure).toBeDefined();
    });

    it('uses SDS numeric(19,4) precision for money and quantities', () => {
      const productConfig = getTableConfig(erp1Products);
      const stockConfig = getTableConfig(erp1StockLevels);
      const price = productConfig.columns.find((column) => column.name === 'price');
      const quantity = stockConfig.columns.find((column) => column.name === 'quantity');

      expect(price?.getSQLType()).toBe('numeric(19, 4)');
      expect(quantity?.getSQLType()).toBe('numeric(19, 4)');
    });

    it('requires an explicit currency without an implicit database default', () => {
      const productConfig = getTableConfig(erp1Products);
      const currency = productConfig.columns.find((column) => column.name === 'currency');

      expect(currency?.notNull).toBe(true);
      expect(currency?.default).toBeUndefined();
    });

    it('prevents a second V1 warehouse with a database unique index', () => {
      const warehouseConfig = getTableConfig(erp1Warehouses);
      const indexNames = warehouseConfig.indexes.map((idx) => idx.config.name);

      expect(indexNames).toContain('erp1_warehouses_single_idx');
    });

    it('enforces fixed list of allowed units of measure (FR-ERP1-04)', () => {
      const allowedUoms = ['pcs', 'kg', 'g', 'litre', 'metre', 'box'];
      for (const uom of allowedUoms) {
        expect(UnitOfMeasureSchema.safeParse(uom).success).toBe(true);
      }

      // Disallowed units must be rejected
      const disallowedUoms = ['dozen', 'pound', 'gallons', 'inch', ''];
      for (const uom of disallowedUoms) {
        expect(UnitOfMeasureSchema.safeParse(uom).success).toBe(false);
      }
    });
  });

  describe('Domain Invariants', () => {
    describe('BR-ERP1-01: SKU Uniqueness & Normalization', () => {
      it('normalizes SKU deterministically to uppercase trimmed format', () => {
        expect(normalizeSku('  sku-101-abc  ')).toBe('SKU-101-ABC');
        expect(normalizeSku('prod_Widget')).toBe('PROD_WIDGET');
      });

      it('rejects product creation when required SKU or name is empty', () => {
        const invalidProduct = {
          name: '',
          sku: 'SKU-001',
          unitOfMeasure: 'pcs',
          price: '29.99',
          currency: 'USD',
        };
        expect(CreateProductInputSchema.safeParse(invalidProduct).success).toBe(false);

        const missingSku = {
          name: 'Valid Name',
          sku: '   ',
          unitOfMeasure: 'pcs',
          price: '29.99',
          currency: 'USD',
        };
        expect(CreateProductInputSchema.safeParse(missingSku).success).toBe(false);
      });
    });

    describe('Price and Tax Decimal Invariants', () => {
      it('accepts valid non-negative decimal prices and normalizes to four decimal places', () => {
        const parsed = CreateProductInputSchema.parse({
          name: 'Heavy Duty Widget',
          sku: 'WDG-001',
          unitOfMeasure: 'pcs',
          price: 19.5,
          currency: 'USD',
          taxRate: 5,
        });

        expect(parsed.price).toBe('19.5000');
        expect(parsed.taxRate).toBe('5.00');
      });

      it('requires an explicit uppercase ISO 4217 currency', () => {
        const base = {
          name: 'Widget',
          sku: 'WDG-CUR',
          unitOfMeasure: 'pcs',
          price: '15.00',
        };

        expect(CreateProductInputSchema.safeParse(base).success).toBe(false);
        expect(
          CreateProductInputSchema.safeParse({ ...base, currency: 'usd' }).success
        ).toBe(false);
        expect(
          CreateProductInputSchema.safeParse({ ...base, currency: 'USD' }).success
        ).toBe(true);
      });

      it('rejects negative price', () => {
        expect(() => {
          CreateProductInputSchema.parse({
            name: 'Widget',
            sku: 'WDG-002',
            unitOfMeasure: 'pcs',
            price: -10,
            currency: 'USD',
          });
        }).toThrow(/Price must be greater than or equal to 0/);
      });

      it('rejects negative tax rate', () => {
        expect(() => {
          CreateProductInputSchema.parse({
            name: 'Widget',
            sku: 'WDG-003',
            unitOfMeasure: 'pcs',
            price: '15.00',
            currency: 'USD',
            taxRate: -2,
          });
        }).toThrow(/Tax rate must be non-negative/);
      });
    });

    describe('BR-ERP1-02: Non-negative Stock Quantities', () => {
      it('accepts valid non-negative opening stock quantities', () => {
        const validOpening = SetOpeningStockInputSchema.parse({
          productId: '00000000-0000-4000-8000-000000000001',
          quantity: '150.00',
        });
        expect(validOpening.quantity).toBe('150.0000');

        const zeroOpening = SetOpeningStockInputSchema.parse({
          productId: '00000000-0000-4000-8000-000000000001',
          quantity: 0,
        });
        expect(zeroOpening.quantity).toBe('0.0000');
      });

      it('strictly blocks negative stock quantity with clear error (BR-ERP1-02)', () => {
        expect(() => {
          SetOpeningStockInputSchema.parse({
            productId: '00000000-0000-4000-8000-000000000001',
            quantity: -5,
          });
        }).toThrow(/Stock quantity cannot become negative \(BR-ERP1-02\)/);

        expect(() => {
          SetOpeningStockInputSchema.parse({
            productId: '00000000-0000-4000-8000-000000000001',
            quantity: '-0.01',
          });
        }).toThrow(/Stock quantity cannot become negative \(BR-ERP1-02\)/);
      });
    });

    describe('FR-ERP1-03: Single-Level Categories', () => {
      it('validates category input requiring name and code without recursive parent hierarchy', () => {
        const validCategory = CreateCategoryInputSchema.parse({
          name: 'Electronic Components',
          code: 'ELEC',
        });
        expect(validCategory.name).toBe('Electronic Components');
        expect(validCategory.code).toBe('ELEC');

        // Missing name or code fails
        expect(CreateCategoryInputSchema.safeParse({ name: 'Only Name' }).success).toBe(false);
      });
    });
  });

  describe('Guarded Migration Script SQL Verification', () => {
    it('verifies erp1_v1.sql defines all tables, constraints and idempotent guards', () => {
      const sqlPath = resolve(process.cwd(), 'packages/database/migrations/erp1_v1.sql');
      const sqlContent = readFileSync(sqlPath, 'utf8');

      // Schema and migration tracking
      expect(sqlContent).toContain('CREATE SCHEMA IF NOT EXISTS erp1;');
      expect(sqlContent).toContain("public.schema_migrations WHERE migration = 'erp1_v1'");
      expect(sqlContent).toContain("INSERT INTO public.schema_migrations (migration)");
      expect(sqlContent).toContain("VALUES ('erp1_v1')");

      // Tables
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS erp1.categories');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS erp1.warehouses');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS erp1.products');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS erp1.stock_levels');
      expect(sqlContent).toContain('CREATE TABLE IF NOT EXISTS erp1.import_receipts');

      // Constraints
      expect(sqlContent).toContain('NUMERIC(19, 4)');
      expect(sqlContent).toContain('CONSTRAINT check_erp1_products_price_non_negative CHECK (price >= 0)');
      expect(sqlContent).toContain('CONSTRAINT check_erp1_products_tax_rate_non_negative CHECK (tax_rate >= 0)');
      expect(sqlContent).toContain('CONSTRAINT check_erp1_products_currency_format CHECK (currency ~ \'^[A-Z]{3}$\')');
      expect(sqlContent).toContain('CONSTRAINT check_erp1_stock_quantity_non_negative CHECK (quantity >= 0)');
      expect(sqlContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS erp1_products_sku_idx');
      expect(sqlContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS erp1_products_normalized_sku_idx');
      expect(sqlContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS erp1_stock_levels_product_warehouse_idx');
      expect(sqlContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS erp1_warehouses_single_idx');
      expect(sqlContent).not.toContain("currency        VARCHAR(3)           NOT NULL DEFAULT 'USD'");

      // KIT-08 receipt shape
      expect(sqlContent).toContain('source_row        INTEGER      NOT NULL');
      expect(sqlContent).toContain('entity            VARCHAR(64)  NOT NULL');
      expect(sqlContent).toContain('schema_version    INTEGER      NOT NULL DEFAULT 1');
      expect(sqlContent).toContain('check_erp1_import_receipts_kind_allowed');

      // updated_at triggers
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION erp1.set_updated_at()');
      expect(sqlContent).toContain('CREATE TRIGGER products_set_updated_at');

      // Seeds
      expect(sqlContent).toContain("INSERT INTO erp1.warehouses");
      expect(sqlContent).toContain("INSERT INTO erp1.categories");
    });
  });
});
