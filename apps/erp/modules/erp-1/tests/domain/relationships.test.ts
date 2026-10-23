/**
 * ERP-1 Products & Inventory — Relationships, State Transitions & Read Model Consistency Test Suite
 *
 * Exhaustively validates Issue #11 (ERP1-06):
 *   - AC-1: Mandatory & optional relationship validation (category, warehouse, product)
 *   - AC-2: Enumeration validation (unitOfMeasure, currency, stockStatus, productStatus)
 *   - AC-3: State transition matrix (stock status & product lifecycle: allowed, terminal, backward, no-op)
 *   - AC-4: Read-model consistency assertions for products, stock levels, and categories
 *   - AC-5: Cross-module private table write isolation and contract-safe resolving
 *   - AC-6: Domain invariants (SKU uniqueness, non-negative stock, one warehouse)
 *   - AC-7: Provenance pair completeness (source_system + source_id)
 *
 * @module erp1/tests/domain/relationships.test
 */

import { describe, it, expect } from 'vitest';
import {
  ERP1_DOMAIN_RULES,
  ERP1_OPTIONAL_REFERENCE_ABSENT,
  ERP1_UNITS_OF_MEASURE,
  ERP1_STOCK_STATUSES,
  ERP1_PRODUCT_STATUSES,
  type Product,
  type StockLevel,
  type Category,
} from '@clearshift/contracts';
import {
  handleOptionalRelationship,
  assertSourceIdentityIsComplete,
  assertValidUnitOfMeasure,
  assertValidCurrencyCode,
  assertValidStockStatus,
  assertValidProductStatus,
  deriveStockStatus,
  assertStockStatusTransition,
  assertProductStatusTransition,
  assertProductReadConsistency,
  assertStockLevelReadConsistency,
  assertCategoryReadConsistency,
  assertNoCrossModulePrivateTableWrite,
} from '../../src/domain/relationships.js';
import { Erp1DomainError } from '../../src/domain/rules.js';
import { Erp1Service } from '../../src/services/erp1.service.js';
import { InMemoryErp1Repository } from '../../src/services/repository.js';
import { createErp1Resolver } from '../../src/public.js';

describe('ERP-1 Domain Relationships & State Transitions (Issue #11 / ERP1-06)', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Optional Relationship Handling (AC-1)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Optional Relationship Handling', () => {
    it('returns null and approved warning when optional link is absent', () => {
      const resNull = handleOptionalRelationship(null, 'categoryId', 'category');
      expect(resNull.value).toBeNull();
      expect(resNull.warning).toBeDefined();
      expect(resNull.warning?.code).toBe(ERP1_OPTIONAL_REFERENCE_ABSENT);
      expect(resNull.warning?.relationship).toBe('category');
      expect(resNull.warning?.field).toBe('categoryId');
      expect(resNull.warning?.message).toContain('No synthetic record was created');

      const resUndef = handleOptionalRelationship(undefined, 'notificationEmail', 'email');
      expect(resUndef.value).toBeNull();
      expect(resUndef.warning?.code).toBe(ERP1_OPTIONAL_REFERENCE_ABSENT);

      const resEmpty = handleOptionalRelationship('', 'contactPhone', 'phone');
      expect(resEmpty.value).toBeNull();
      expect(resEmpty.warning?.code).toBe(ERP1_OPTIONAL_REFERENCE_ABSENT);
    });

    it('returns provided value and no warning when link is present', () => {
      const res = handleOptionalRelationship(
        '00000000-0000-4000-8000-000000000001',
        'categoryId',
        'category'
      );
      expect(res.value).toBe('00000000-0000-4000-8000-000000000001');
      expect(res.warning).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Provenance Pair Completeness (AC-7)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Provenance Completeness (source_system + source_id)', () => {
    it('accepts both null, both undefined, or both defined', () => {
      expect(() => assertSourceIdentityIsComplete(null, null)).not.toThrow();
      expect(() => assertSourceIdentityIsComplete(undefined, undefined)).not.toThrow();
      expect(() => assertSourceIdentityIsComplete('SAP-PROD', 'MAT-10492')).not.toThrow();
    });

    it('rejects partial source identity with SOURCE_IDENTITY_INCOMPLETE', () => {
      expect(() => assertSourceIdentityIsComplete('SAP-PROD', null)).toThrowError(
        Erp1DomainError
      );
      try {
        assertSourceIdentityIsComplete('SAP-PROD', null);
      } catch (err) {
        expect((err as Erp1DomainError).code).toBe(ERP1_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE);
        expect((err as Erp1DomainError).field).toBe('source_id');
      }

      try {
        assertSourceIdentityIsComplete(null, 'MAT-10492');
      } catch (err) {
        expect((err as Erp1DomainError).code).toBe(ERP1_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE);
        expect((err as Erp1DomainError).field).toBe('source_system');
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Enumeration Rules (AC-2)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Enumeration validations', () => {
    describe('assertValidUnitOfMeasure', () => {
      it('accepts all approved units of measure per FR-ERP1-04', () => {
        for (const uom of ERP1_UNITS_OF_MEASURE) {
          expect(() => assertValidUnitOfMeasure(uom)).not.toThrow();
        }
      });

      it('rejects unapproved units of measure with INVALID_UNIT_OF_MEASURE', () => {
        const invalid = ['palette', 'barrel', 'ton', 'yard', 'pack'];
        for (const val of invalid) {
          expect(() => assertValidUnitOfMeasure(val)).toThrowError(Erp1DomainError);
          try {
            assertValidUnitOfMeasure(val);
          } catch (err) {
            expect((err as Erp1DomainError).code).toBe(ERP1_DOMAIN_RULES.INVALID_UNIT_OF_MEASURE);
            expect((err as Erp1DomainError).field).toBe('unitOfMeasure');
          }
        }
      });
    });

    describe('assertValidCurrencyCode', () => {
      it('accepts valid uppercase ISO 4217 3-letter codes', () => {
        expect(() => assertValidCurrencyCode('USD')).not.toThrow();
        expect(() => assertValidCurrencyCode('EUR')).not.toThrow();
        expect(() => assertValidCurrencyCode('GBP')).not.toThrow();
        expect(() => assertValidCurrencyCode('JPY')).not.toThrow();
      });

      it('rejects lowercase, invalid length, or non-alpha currencies with INVALID_CURRENCY_CODE', () => {
        const invalid = ['usd', 'US', 'USDT', '123', ''];
        for (const val of invalid) {
          expect(() => assertValidCurrencyCode(val)).toThrowError(Erp1DomainError);
          try {
            assertValidCurrencyCode(val);
          } catch (err) {
            expect((err as Erp1DomainError).code).toBe(ERP1_DOMAIN_RULES.INVALID_CURRENCY_CODE);
            expect((err as Erp1DomainError).field).toBe('currency');
          }
        }
      });
    });

    describe('assertValidStockStatus', () => {
      it('accepts all approved stock statuses', () => {
        for (const status of ERP1_STOCK_STATUSES) {
          expect(() => assertValidStockStatus(status)).not.toThrow();
        }
      });

      it('rejects invalid stock statuses with INVALID_STOCK_STATUS', () => {
        const invalid = ['surplus', 'pending', 'available', 'archived'];
        for (const val of invalid) {
          expect(() => assertValidStockStatus(val)).toThrowError(Erp1DomainError);
          try {
            assertValidStockStatus(val);
          } catch (err) {
            expect((err as Erp1DomainError).code).toBe(ERP1_DOMAIN_RULES.INVALID_STOCK_STATUS);
            expect((err as Erp1DomainError).field).toBe('stockStatus');
          }
        }
      });
    });

    describe('assertValidProductStatus', () => {
      it('accepts all approved product lifecycle statuses', () => {
        for (const status of ERP1_PRODUCT_STATUSES) {
          expect(() => assertValidProductStatus(status)).not.toThrow();
        }
      });

      it('rejects invalid product lifecycle statuses with INVALID_PRODUCT_STATUS', () => {
        const invalid = ['deleted', 'pending_approval', 'legacy'];
        for (const val of invalid) {
          expect(() => assertValidProductStatus(val)).toThrowError(Erp1DomainError);
          try {
            assertValidProductStatus(val);
          } catch (err) {
            expect((err as Erp1DomainError).code).toBe(ERP1_DOMAIN_RULES.INVALID_PRODUCT_STATUS);
            expect((err as Erp1DomainError).field).toBe('status');
          }
        }
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. State Transitions (AC-3)
  // ───────────────────────────────────────────────────────────────────────────
  describe('State Transitions & Status Derivation', () => {
    describe('deriveStockStatus', () => {
      it('derives out_of_stock when quantity is 0 or negative', () => {
        expect(deriveStockStatus('0')).toBe('out_of_stock');
        expect(deriveStockStatus('0.0000')).toBe('out_of_stock');
        expect(deriveStockStatus(0)).toBe('out_of_stock');
        expect(deriveStockStatus('-5.00')).toBe('out_of_stock');
      });

      it('derives low_stock when 0 < quantity <= 10', () => {
        expect(deriveStockStatus('0.50')).toBe('low_stock');
        expect(deriveStockStatus('5.0000')).toBe('low_stock');
        expect(deriveStockStatus('10.0000')).toBe('low_stock');
        expect(deriveStockStatus(10)).toBe('low_stock');
      });

      it('derives in_stock when quantity > 10', () => {
        expect(deriveStockStatus('10.0001')).toBe('in_stock');
        expect(deriveStockStatus('50.0000')).toBe('in_stock');
        expect(deriveStockStatus(100)).toBe('in_stock');
      });
    });

    describe('assertStockStatusTransition', () => {
      it('permits valid inventory status transitions between out_of_stock, low_stock, and in_stock', () => {
        expect(() => assertStockStatusTransition('out_of_stock', 'in_stock', '50.00')).not.toThrow();
        expect(() => assertStockStatusTransition('out_of_stock', 'low_stock', '5.00')).not.toThrow();
        expect(() => assertStockStatusTransition('in_stock', 'low_stock', '8.00')).not.toThrow();
        expect(() => assertStockStatusTransition('in_stock', 'out_of_stock', '0.00')).not.toThrow();
        expect(() => assertStockStatusTransition('low_stock', 'in_stock', '25.00')).not.toThrow();
        expect(() => assertStockStatusTransition('low_stock', 'out_of_stock', '0.00')).not.toThrow();
      });

      it('permits identical state transition as a valid no-op', () => {
        expect(() => assertStockStatusTransition('in_stock', 'in_stock', '15.00')).not.toThrow();
        expect(() => assertStockStatusTransition('out_of_stock', 'out_of_stock', '0.00')).not.toThrow();
      });

      it('strictly rejects any transition leading to negative stock (BR-ERP1-02)', () => {
        expect(() => assertStockStatusTransition('in_stock', 'out_of_stock', '-1.00')).toThrowError(
          Erp1DomainError
        );
        try {
          assertStockStatusTransition('in_stock', 'out_of_stock', '-1.00');
        } catch (err) {
          expect((err as Erp1DomainError).code).toBe(ERP1_DOMAIN_RULES.NEGATIVE_STOCK);
        }
      });
    });

    describe('assertProductStatusTransition', () => {
      it('permits valid forward transitions in product lifecycle', () => {
        // draft -> active
        expect(() => assertProductStatusTransition('draft', 'active')).not.toThrow();
        // draft -> archived
        expect(() => assertProductStatusTransition('draft', 'archived')).not.toThrow();
        // active -> discontinued
        expect(() => assertProductStatusTransition('active', 'discontinued')).not.toThrow();
        // active -> archived
        expect(() => assertProductStatusTransition('active', 'archived')).not.toThrow();
        // discontinued -> active (reactivate)
        expect(() => assertProductStatusTransition('discontinued', 'active')).not.toThrow();
        // discontinued -> archived
        expect(() => assertProductStatusTransition('discontinued', 'archived')).not.toThrow();
      });

      it('permits identical status as a valid no-op', () => {
        expect(() => assertProductStatusTransition('active', 'active')).not.toThrow();
        expect(() => assertProductStatusTransition('draft', 'draft')).not.toThrow();
      });

      it('rejects transitions from terminal status (archived)', () => {
        expect(() => assertProductStatusTransition('archived', 'active')).toThrowError(
          Erp1DomainError
        );
        try {
          assertProductStatusTransition('archived', 'active');
        } catch (err) {
          expect((err as Erp1DomainError).code).toBe(ERP1_DOMAIN_RULES.INVALID_STATUS_TRANSITION);
          expect((err as Erp1DomainError).message).toContain('terminal status "archived"');
        }
      });

      it('rejects forbidden backward transitions to draft', () => {
        expect(() => assertProductStatusTransition('active', 'draft')).toThrowError(
          Erp1DomainError
        );
        expect(() => assertProductStatusTransition('discontinued', 'draft')).toThrowError(
          Erp1DomainError
        );
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Read Model Consistency Assertions (AC-4)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Read Model Consistency Assertions', () => {
    const validProduct: Product = {
      id: '00000000-0000-4000-8000-000000000010',
      name: 'Hydraulic Piston Pump H50',
      sku: 'PMP-HYD-050',
      normalizedSku: 'PMP-HYD-050',
      categoryId: '00000000-0000-4000-8000-000000000001',
      unitOfMeasure: 'pcs',
      price: '450.0000',
      currency: 'USD',
      taxRate: '5.00',
      notificationEmail: 'supplier@hydraulics.test',
      contactPhone: '+1-555-019-2834',
      sourceSystem: 'SAP-PROD',
      sourceId: '10042',
      goldenId: 'GLD-SAP-10042',
      createdAt: '2026-10-20T10:00:00Z',
      updatedAt: '2026-10-23T14:30:00Z',
    };

    it('asserts valid product read model passes consistency checks', () => {
      expect(() => assertProductReadConsistency(validProduct)).not.toThrow();
    });

    it('rejects product with normalizedSku mismatching normalizeSku(sku)', () => {
      const inconsistent = { ...validProduct, normalizedSku: 'WRONG-SKU' };
      expect(() => assertProductReadConsistency(inconsistent)).toThrowError(Erp1DomainError);
      try {
        assertProductReadConsistency(inconsistent);
      } catch (err) {
        expect((err as Erp1DomainError).code).toBe(ERP1_DOMAIN_RULES.READ_MODEL_INCONSISTENT);
        expect((err as Erp1DomainError).field).toBe('normalizedSku');
      }
    });

    it('rejects product with negative price or invalid currency', () => {
      expect(() => assertProductReadConsistency({ ...validProduct, price: '-10.0000' })).toThrowError(
        Erp1DomainError
      );
      expect(() => assertProductReadConsistency({ ...validProduct, currency: 'usd' })).toThrowError(
        Erp1DomainError
      );
    });

    it('asserts valid stock level read model passes consistency check', () => {
      const validStock: StockLevel = {
        id: '00000000-0000-4000-8000-000000000020',
        productId: validProduct.id,
        warehouseId: '00000000-0000-4000-8000-000000000002',
        quantity: '85.0000',
        updatedAt: '2026-10-23T12:00:00Z',
      };

      expect(() => assertStockLevelReadConsistency(validStock, 'in_stock')).not.toThrow();
    });

    it('rejects stock level read model if derived status conflicts with expected', () => {
      const stock: StockLevel = {
        id: '00000000-0000-4000-8000-000000000020',
        productId: validProduct.id,
        warehouseId: '00000000-0000-4000-8000-000000000002',
        quantity: '0.0000',
        updatedAt: '2026-10-23T12:00:00Z',
      };

      // quantity 0 is out_of_stock, expecting in_stock must throw
      expect(() => assertStockLevelReadConsistency(stock, 'in_stock')).toThrowError(
        Erp1DomainError
      );
    });

    it('asserts category is single-level (FR-ERP1-03) and rejects nested parents', () => {
      const validCat: Category = {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Hydraulics',
        code: 'HYD',
        createdAt: '2026-10-23T00:00:00Z',
        updatedAt: '2026-10-23T00:00:00Z',
      };
      expect(() => assertCategoryReadConsistency(validCat)).not.toThrow();

      // Prohibited parent hierarchy
      const nestedCat = { ...validCat, parentId: '00000000-0000-4000-8000-000000000099' } as any;
      expect(() => assertCategoryReadConsistency(nestedCat)).toThrowError(Erp1DomainError);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Cross-Module Boundaries & Isolation (AC-5)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Cross-Module Boundaries & Isolation', () => {
    it('permits module-owned tables inside erp1 schema', () => {
      expect(() => assertNoCrossModulePrivateTableWrite('erp1.products')).not.toThrow();
      expect(() => assertNoCrossModulePrivateTableWrite('erp1.categories')).not.toThrow();
      expect(() => assertNoCrossModulePrivateTableWrite('erp1.stock_levels')).not.toThrow();
      expect(() => assertNoCrossModulePrivateTableWrite('erp1.warehouses')).not.toThrow();
      expect(() => assertNoCrossModulePrivateTableWrite('erp1.import_receipts')).not.toThrow();
    });

    it('strictly forbids writes to sibling private tables (erp2, erp3, erp4, erp5, crm)', () => {
      const forbidden = [
        'erp2.vendors',
        'erp2.purchase_orders',
        'erp3.sales_orders',
        'erp3.invoices',
        'erp4.accounts',
        'erp4.journal_entries',
        'erp5.employees',
        'crm.contacts',
      ];

      for (const table of forbidden) {
        expect(() => assertNoCrossModulePrivateTableWrite(table)).toThrowError(Erp1DomainError);
        try {
          assertNoCrossModulePrivateTableWrite(table);
        } catch (err) {
          expect((err as Erp1DomainError).code).toBe(
            ERP1_DOMAIN_RULES.CROSS_MODULE_WRITE_FORBIDDEN
          );
        }
      }
    });

    it('cross-module reads use contract-safe resolver without writing private tables', async () => {
      const repo = new InMemoryErp1Repository(true);
      const resolver = createErp1Resolver(repo);

      // Warehouse WH-01 seeded
      const whExists = await resolver.exists('warehouse', '00000000-0000-4000-8000-000000000002');
      expect(whExists).toBe(true);

      const wh = await resolver.get('warehouse', '00000000-0000-4000-8000-000000000002');
      expect(wh).toEqual(
        expect.objectContaining({
          id: '00000000-0000-4000-8000-000000000002',
          code: 'WH-01',
          name: 'Main Warehouse',
        })
      );

      // Unknown reference resolves to null safely
      const unknown = await resolver.get('product', '00000000-0000-4000-8000-999999999999');
      expect(unknown).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Domain Invariant Integration with Service Layer (AC-1, AC-6)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Service Domain Invariants', () => {
    it('asserts SKU uniqueness after normalization and rejects duplicate create', async () => {
      const repo = new InMemoryErp1Repository(true);
      const service = new Erp1Service({ repository: repo });

      await service.createProduct({
        name: 'Precision Bearing 10mm',
        sku: 'BRG-10MM',
        unitOfMeasure: 'pcs',
        price: '15.5000',
        currency: 'USD',
      });

      // Attempting to insert lowercase duplicate must be rejected
      await expect(
        service.createProduct({
          name: 'Precision Bearing 10mm Duplicate',
          sku: 'brg-10mm',
          unitOfMeasure: 'pcs',
          price: '16.0000',
          currency: 'USD',
        })
      ).rejects.toThrow();
    });

    it('rejects referenced category that does not exist before committing product', async () => {
      const repo = new InMemoryErp1Repository(true);
      const service = new Erp1Service({ repository: repo });

      await expect(
        service.createProduct({
          name: 'Piston Ring',
          sku: 'PST-001',
          categoryId: '00000000-0000-4000-8000-999999999999',
          unitOfMeasure: 'pcs',
          price: '25.0000',
          currency: 'USD',
        })
      ).rejects.toThrow();
    });

    it('rejects partial provenance on product create', async () => {
      const repo = new InMemoryErp1Repository(true);
      const service = new Erp1Service({ repository: repo });

      await expect(
        service.createProduct({
          name: 'Piston Ring',
          sku: 'PST-002',
          unitOfMeasure: 'pcs',
          price: '25.0000',
          currency: 'USD',
          sourceSystem: 'SAP-PROD',
          // sourceId missing!
        })
      ).rejects.toThrowError(Erp1DomainError);
    });
  });
});
