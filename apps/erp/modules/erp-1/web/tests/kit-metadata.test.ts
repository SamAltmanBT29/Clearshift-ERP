/**
 * ERP-1 Products & Inventory — Web Kit Metadata Tests (ERP1-22)
 *
 * Verifies:
 * - Web kit metadata auto-registration in MigrationKitRegistry.
 * - Supply of target field definitions, human-readable labels, enum options, and required constraints.
 * - Exported entity definitions for Products, Categories, Warehouses, Stock Levels.
 */

import { describe, it, expect } from 'vitest';
import { migrationKitRegistry } from '@cs/kit';
import {
  erp1WebKitMetadata,
  erp1ProductsTargetMetadata,
  erp1CategoriesTargetMetadata,
  erp1WarehousesTargetMetadata,
  erp1StockLevelsTargetMetadata,
} from '../src/kit-metadata.js';

describe('ERP-1 Web Kit Metadata (ERP1-22)', () => {
  it('registers erp1 module metadata in the central registry (AC 1)', () => {
    const reg = migrationKitRegistry.get('erp1');
    expect(reg).toBeDefined();
    expect(reg?.moduleId).toBe('erp1');
    expect(reg?.moduleName).toBe('ERP-1 Products and Inventory');
    expect(reg?.defaultEntity).toBe('products');
  });

  it('contains all 4 domain entities', () => {
    expect(Object.keys(erp1WebKitMetadata.entities)).toEqual([
      'products',
      'categories',
      'warehouses',
      'stock_levels',
    ]);
  });

  it('supplies full target field definitions with data types and labels (AC 2)', () => {
    const fields = erp1ProductsTargetMetadata.fields;
    const nameField = fields.find((f) => f.name === 'name');
    const skuField = fields.find((f) => f.name === 'sku');
    const uomField = fields.find((f) => f.name === 'unitOfMeasure');
    const priceField = fields.find((f) => f.name === 'price');
    const currField = fields.find((f) => f.name === 'currency');

    expect(nameField).toMatchObject({
      name: 'name',
      label: 'Product Name',
      type: 'string',
      required: true,
    });
    expect(skuField).toMatchObject({
      name: 'sku',
      label: 'Stock Keeping Unit (SKU)',
      type: 'string',
      required: true,
    });
    expect(uomField).toMatchObject({
      name: 'unitOfMeasure',
      label: 'Unit of Measure',
      type: 'enum',
      required: true,
      enumOptions: ['pcs', 'kg', 'g', 'litre', 'metre', 'box'],
    });
    expect(priceField).toMatchObject({
      name: 'price',
      label: 'Unit Price',
      type: 'decimal',
      required: true,
    });
    expect(currField).toMatchObject({
      name: 'currency',
      label: 'Currency Code (ISO-4217)',
      type: 'string',
      required: true,
    });
  });

  it('supplies category, warehouse, and stock level metadata', () => {
    expect(erp1CategoriesTargetMetadata.fields.map((f) => f.name)).toEqual(['name', 'code']);
    expect(erp1WarehousesTargetMetadata.fields.map((f) => f.name)).toEqual(['name', 'code', 'isDefault']);
    expect(erp1StockLevelsTargetMetadata.fields.map((f) => f.name)).toEqual(['productId', 'warehouseId', 'quantity']);
  });
});
