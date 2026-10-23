/**
 * ERP-1 Products & Inventory — Migration Kit Field Registry Tests (KIT-14 / ERP1-22)
 *
 * Verifies:
 * - Registration of ERP-1 target schema metadata with the shared MigrationKitRegistry.
 * - Entity definitions and schema compliance for Products, Categories, Warehouses, and Stock Levels.
 * - Non-negotiable domain rules:
 *   - SKU uniqueness after normalization (BR-ERP1-01, FR-ERP1-01)
 *   - Fixed V1 unit of measure list (pcs, kg, g, litre, metre, box) (FR-ERP1-04)
 *   - Decimal price and non-negative money types (FR-ERP1-02)
 *   - Non-negative stock quantities (BR-ERP1-02, FR-ERP1-06)
 *   - Raw source value preservation (KIT-08)
 * - Validation of metadata payloads against @clearshift/contracts Zod schemas.
 */

import { describe, it, expect } from 'vitest';
import { ModuleMigrationMetadataSchema } from '@clearshift/contracts';
import { migrationKitRegistry } from '@cs/kit';
import {
  erp1KitMetadata,
  erp1ProductsMetadata,
  erp1CategoriesMetadata,
  erp1WarehousesMetadata,
  erp1StockLevelsMetadata,
} from '../../src/kit/field-registry.js';

describe('ERP-1 Field Registry for Migration Kit (ERP1-22)', () => {
  it('registers ERP-1 metadata into central MigrationKitRegistry on import (AC 1)', () => {
    const registered = migrationKitRegistry.get('erp1');
    expect(registered).toBeDefined();
    expect(registered?.moduleId).toBe('erp1');
    expect(registered?.moduleName).toBe('ERP-1 Products and Inventory');
    expect(registered?.defaultEntity).toBe('products');
  });

  it('validates against ModuleMigrationMetadataSchema from @clearshift/contracts', () => {
    const parseResult = ModuleMigrationMetadataSchema.safeParse(erp1KitMetadata);
    expect(parseResult.success).toBe(true);
  });

  describe('Products Target Schema (erp1_products)', () => {
    it('defines primary table attributes and keys', () => {
      expect(erp1ProductsMetadata.entity).toBe('products');
      expect(erp1ProductsMetadata.targetTable).toBe('erp1_products');
      expect(erp1ProductsMetadata.primaryKey).toBe('id');
      expect(erp1ProductsMetadata.naturalKey).toBe('sku');
      expect(erp1ProductsMetadata.schemaVersion).toBe(1);
    });

    it('enforces required primary fields: name, sku, unitOfMeasure, price, currency', () => {
      const requiredFieldNames = erp1ProductsMetadata.fields
        .filter((f) => f.required)
        .map((f) => f.name);

      expect(requiredFieldNames).toContain('name');
      expect(requiredFieldNames).toContain('sku');
      expect(requiredFieldNames).toContain('unitOfMeasure');
      expect(requiredFieldNames).toContain('price');
      expect(requiredFieldNames).toContain('currency');
    });

    it('defines optional fields: categoryId, taxRate, notificationEmail, contactPhone, sourceSystem, sourceId', () => {
      const optionalFieldNames = erp1ProductsMetadata.fields
        .filter((f) => !f.required)
        .map((f) => f.name);

      expect(optionalFieldNames).toContain('categoryId');
      expect(optionalFieldNames).toContain('taxRate');
      expect(optionalFieldNames).toContain('notificationEmail');
      expect(optionalFieldNames).toContain('contactPhone');
      expect(optionalFieldNames).toContain('sourceSystem');
      expect(optionalFieldNames).toContain('sourceId');
    });

    it('enforces fixed list of V1 units of measure (FR-ERP1-04)', () => {
      const uomField = erp1ProductsMetadata.fields.find((f) => f.name === 'unitOfMeasure');
      expect(uomField).toBeDefined();
      expect(uomField?.type).toBe('enum');
      expect(uomField?.enumOptions).toEqual(['pcs', 'kg', 'g', 'litre', 'metre', 'box']);
      expect(uomField?.rules).toContain('FR-ERP1-04');
    });

    it('specifies decimal types for price and taxRate (FR-ERP1-02)', () => {
      const priceField = erp1ProductsMetadata.fields.find((f) => f.name === 'price');
      const taxField = erp1ProductsMetadata.fields.find((f) => f.name === 'taxRate');

      expect(priceField?.type).toBe('decimal');
      expect(taxField?.type).toBe('decimal');
      expect(priceField?.rules).toContain('FR-ERP1-02');
      expect(priceField?.rules).toContain('BR-ERP1-01');
    });

    it('provides standard legacy mapping defaults', () => {
      expect(erp1ProductsMetadata.mappingDefaults).toEqual(
        expect.objectContaining({
          name: 'product_name',
          sku: 'sku_code',
          unitOfMeasure: 'unit',
          price: 'unit_price',
          currency: 'currency_code',
        })
      );
    });

    it('documents governing business validation rules', () => {
      const ruleCodes = erp1ProductsMetadata.validationRules?.map((r) => r.code);
      expect(ruleCodes).toContain('BR-ERP1-01');
      expect(ruleCodes).toContain('FR-ERP1-04');
      expect(ruleCodes).toContain('FR-ERP1-02');
      expect(ruleCodes).toContain('RL-01');
      expect(ruleCodes).toContain('KIT-08');
    });
  });

  describe('Categories Target Schema (erp1_categories)', () => {
    it('defines required name and code for one-level hierarchy (FR-ERP1-03)', () => {
      expect(erp1CategoriesMetadata.entity).toBe('categories');
      expect(erp1CategoriesMetadata.targetTable).toBe('erp1_categories');
      expect(erp1CategoriesMetadata.primaryKey).toBe('id');
      expect(erp1CategoriesMetadata.naturalKey).toBe('code');

      const names = erp1CategoriesMetadata.fields.map((f) => f.name);
      expect(names).toEqual(['name', 'code']);

      const requiredNames = erp1CategoriesMetadata.fields
        .filter((f) => f.required)
        .map((f) => f.name);
      expect(requiredNames).toEqual(['name', 'code']);
    });
  });

  describe('Warehouses Target Schema (erp1_warehouses)', () => {
    it('defines warehouse attributes enforcing single-facility V1 scope (FR-ERP1-05)', () => {
      expect(erp1WarehousesMetadata.entity).toBe('warehouses');
      expect(erp1WarehousesMetadata.targetTable).toBe('erp1_warehouses');

      const fieldNames = erp1WarehousesMetadata.fields.map((f) => f.name);
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('code');
      expect(fieldNames).toContain('isDefault');

      const isDefaultField = erp1WarehousesMetadata.fields.find((f) => f.name === 'isDefault');
      expect(isDefaultField?.type).toBe('boolean');
      expect(isDefaultField?.required).toBe(false);
    });
  });

  describe('Stock Levels Target Schema (erp1_stock_levels)', () => {
    it('defines non-negative quantity and foreign key links (FR-ERP1-06, BR-ERP1-02)', () => {
      expect(erp1StockLevelsMetadata.entity).toBe('stock_levels');
      expect(erp1StockLevelsMetadata.targetTable).toBe('erp1_stock_levels');

      const qtyField = erp1StockLevelsMetadata.fields.find((f) => f.name === 'quantity');
      expect(qtyField?.type).toBe('decimal');
      expect(qtyField?.required).toBe(true);
      expect(qtyField?.rules).toContain('BR-ERP1-02');

      const productFk = erp1StockLevelsMetadata.fields.find((f) => f.name === 'productId');
      const warehouseFk = erp1StockLevelsMetadata.fields.find((f) => f.name === 'warehouseId');
      expect(productFk?.type).toBe('uuid');
      expect(warehouseFk?.type).toBe('uuid');
    });
  });
});
