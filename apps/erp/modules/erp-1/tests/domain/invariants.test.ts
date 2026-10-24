/**
 * ERP-1 Domain Invariants Automated Test Suite
 *
 * Asserts all specified domain invariants:
 *   - BR-ERP1-01: SKU is unique in the database, not only in the UI.
 *   - BR-ERP1-02: Stock quantity cannot become negative.
 *   - FR-ERP1-03: Category hierarchy is one level only.
 *   - FR-ERP1-04: Unit of measure is from the fixed V1 list (pcs, kg, g, litre, metre, box).
 *   - FR-ERP1-05: Single warehouse invariant in V1.
 *   - Decimal price and explicit uppercase ISO-4217 currency.
 *
 * @module erp1/tests/domain/invariants
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryErp1Repository } from '../../src/services/repository.js';
import { Erp1Service } from '../../src/services/erp1.service.js';
import {
  validateUnitOfMeasure,
  validateCurrency,
  validateStockNonNegative,
  validateDecimalPrice,
  validateCategoryHierarchy,
  ALLOWED_UNITS_OF_MEASURE,
} from '../../src/domain/rules.js';

describe('ERP-1 Domain Invariants Suite', () => {
  let repository: InMemoryErp1Repository;
  let service: Erp1Service;

  beforeEach(() => {
    repository = new InMemoryErp1Repository(true);
    service = new Erp1Service({ repository });
  });

  describe('BR-ERP1-01: SKU Uniqueness Invariant', () => {
    it('creates product when SKU is unique', async () => {
      const prod = await service.createProduct({
        name: 'Unique Widget',
        sku: 'WDG-UNIQ-001',
        unitOfMeasure: 'pcs',
        price: '19.9900',
        currency: 'USD',
        taxRate: '0.00',
      });
      expect(prod.id).toBeDefined();
      expect(prod.normalizedSku).toBe('WDG-UNIQ-001');
    });

    it('rejects exact duplicate SKU with 409 DUPLICATE_SKU', async () => {
      await service.createProduct({
        name: 'Original Widget',
        sku: 'WDG-DUP-001',
        unitOfMeasure: 'pcs',
        price: '19.9900',
        currency: 'USD',
        taxRate: '0.00',
      });

      await expect(
        service.createProduct({
          name: 'Duplicate Widget',
          sku: 'WDG-DUP-001',
          unitOfMeasure: 'pcs',
          price: '29.9900',
          currency: 'USD',
          taxRate: '0.00',
        })
      ).rejects.toThrowError(/already exists/i);
    });

    it('rejects case-variant duplicate SKU (normalized uppercase matching)', async () => {
      await service.createProduct({
        name: 'Case Test',
        sku: 'CASE-001',
        unitOfMeasure: 'pcs',
        price: '10.0000',
        currency: 'USD',
        taxRate: '0.00',
      });

      await expect(
        service.createProduct({
          name: 'Lowercase Conflict',
          sku: 'case-001',
          unitOfMeasure: 'pcs',
          price: '10.0000',
          currency: 'USD',
          taxRate: '0.00',
        })
      ).rejects.toThrowError(/already exists/i);
    });

    it('rejects updating an existing product to an already-used SKU', async () => {
      const p1 = await service.createProduct({
        name: 'Product 1',
        sku: 'SKU-001',
        unitOfMeasure: 'pcs',
        price: '10.0000',
        currency: 'USD',
        taxRate: '0.00',
      });
      const p2 = await service.createProduct({
        name: 'Product 2',
        sku: 'SKU-002',
        unitOfMeasure: 'pcs',
        price: '15.0000',
        currency: 'USD',
        taxRate: '0.00',
      });

      await expect(
        service.updateProduct(p2.id, { sku: 'SKU-001' })
      ).rejects.toThrowError(/already exists/i);

      // Self-update with same SKU should succeed
      const updated = await service.updateProduct(p1.id, { name: 'Product 1 Renamed', sku: 'SKU-001' });
      expect(updated.name).toBe('Product 1 Renamed');
    });
  });

  describe('BR-ERP1-02: Non-Negative Stock Invariant', () => {
    it('accepts zero and positive opening stock quantities', async () => {
      const prod = await service.createProduct({
        name: 'Stock Item',
        sku: 'STK-001',
        unitOfMeasure: 'kg',
        price: '5.5000',
        currency: 'USD',
        taxRate: '0.00',
      });

      const wh = await service.getDefaultWarehouse();
      expect(wh).not.toBeNull();

      const zeroStock = await service.setOpeningStock({
        productId: prod.id,
        warehouseId: wh!.id,
        quantity: '0.0000',
        idempotencyKey: 'inv-test-zero-stock',
      });
      expect(zeroStock.entity.quantity).toBe('0.0000');

      const posStock = await service.setOpeningStock({
        productId: prod.id,
        warehouseId: wh!.id,
        quantity: '125.7500',
        idempotencyKey: 'inv-test-pos-stock',
      });
      expect(posStock.entity.quantity).toBe('125.7500');
    });

    it('rejects negative stock quantities', async () => {
      const prod = await service.createProduct({
        name: 'Stock Item 2',
        sku: 'STK-002',
        unitOfMeasure: 'litre',
        price: '12.0000',
        currency: 'USD',
        taxRate: '0.00',
      });
      const wh = await service.getDefaultWarehouse();
      expect(wh).not.toBeNull();

      await expect(
        service.setOpeningStock({
          productId: prod.id,
          warehouseId: wh!.id,
          quantity: '-1.0000',
          idempotencyKey: 'inv-test-neg-stock',
        })
      ).rejects.toThrowError(/negative/i);

      expect(() => validateStockNonNegative('-0.0001')).toThrowError(/negative/i);
    });
  });

  describe('FR-ERP1-03: Category Hierarchy Invariant (One Level Only)', () => {
    it('creates top-level category successfully', async () => {
      const cat = await service.createCategory({
        name: 'Electronics',
        code: 'CAT-ELEC',
      });
      expect(cat.id).toBeDefined();
      expect(cat.name).toBe('Electronics');
    });

    it('rejects nested subcategories with parentId', () => {
      expect(() => validateCategoryHierarchy(true)).toThrowError(/one level only/i);
    });
  });

  describe('FR-ERP1-04: Fixed Units of Measure Invariant', () => {
    it('accepts all 6 allowed units: pcs, kg, g, litre, metre, box', () => {
      for (const unit of ALLOWED_UNITS_OF_MEASURE) {
        expect(validateUnitOfMeasure(unit)).toBe(unit);
      }
    });

    it('rejects disallowed units of measure', () => {
      expect(() => validateUnitOfMeasure('yard')).toThrowError(/invalid unit/i);
      expect(() => validateUnitOfMeasure('ton')).toThrowError(/invalid unit/i);
      expect(() => validateUnitOfMeasure('dozen')).toThrowError(/invalid unit/i);
    });
  });

  describe('Explicit Currency & Decimal Pricing Invariants', () => {
    it('requires explicit uppercase ISO-4217 currency', () => {
      expect(validateCurrency('USD')).toBe('USD');
      expect(validateCurrency('EUR')).toBe('EUR');
      expect(validateCurrency('GBP')).toBe('GBP');
      expect(() => validateCurrency('usd')).toThrowError(/uppercase ISO-4217/i);
      expect(() => validateCurrency('US')).toThrowError(/uppercase ISO-4217/i);
      expect(() => validateCurrency('USDT')).toThrowError(/uppercase ISO-4217/i);
    });

    it('enforces non-negative decimal price formatting', () => {
      expect(validateDecimalPrice('19.99')).toBe('19.9900');
      expect(validateDecimalPrice(0)).toBe('0.0000');
      expect(() => validateDecimalPrice('-5.00')).toThrowError(/non-negative/i);
    });
  });

  describe('FR-ERP1-05: Single Default Warehouse Invariant', () => {
    it('provides standard default warehouse WH-01 in V1', async () => {
      const wh = await service.getDefaultWarehouse();
      expect(wh).not.toBeNull();
      expect(wh!.code).toBe('WH-01');
      expect(wh!.isDefault).toBe(true);
    });
  });
});
