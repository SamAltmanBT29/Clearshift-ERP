/**
 * ERP-2 Vendors & Purchasing — Relationships, State Transitions & Read Model Consistency Test Suite
 *
 * Exhaustively validates Issue #21 (ERP2-06):
 *   - AC-1: Mandatory relationship validation & invalid reference handling
 *   - AC-2: Enumeration validation (PO status & currency code)
 *   - AC-3: Complete state transition matrix (allowed, backward, skipping, terminal, no-op)
 *   - AC-4: Read-model consistency assertions for vendors and purchase orders (lines & totals)
 *   - AC-5 & AC-6: Provenance completeness & optional link warning generation without synthetic rows
 *
 * @module erp2/tests/domain/relationships.test
 */

import { describe, it, expect } from 'vitest';
import {
  ERP2_DOMAIN_RULES,
  ERP2_OPTIONAL_REFERENCE_ABSENT,
  type PurchaseOrder,
  type Vendor,
} from '@clearshift/contracts';
import {
  handleOptionalRelationship,
  assertSourceIdentityIsComplete,
  assertValidPurchaseOrderStatus,
  assertValidCurrencyCode,
  assertVendorCurrencyConsistency,
  assertPurchaseOrderStatusTransition,
  assertVendorReadConsistency,
  assertPurchaseOrderReadConsistency,
} from '../../src/domain/relationships.js';
import { Erp2DomainError } from '../../src/domain/rules.js';

describe('ERP-2 Domain Relationships & State Transitions (Issue #21 / ERP2-06)', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Optional Relationship Handling (AC-7)
  // ───────────────────────────────────────────────────────────────────────────
  describe('handleOptionalRelationship', () => {
    it('returns null and approved warning when optional link is absent', () => {
      const resNull = handleOptionalRelationship(null, 'source_system', 'provenance_system');
      expect(resNull.value).toBeNull();
      expect(resNull.warning).toBeDefined();
      expect(resNull.warning?.code).toBe(ERP2_OPTIONAL_REFERENCE_ABSENT);
      expect(resNull.warning?.relationship).toBe('provenance_system');
      expect(resNull.warning?.field).toBe('source_system');
      expect(resNull.warning?.message).toContain('No synthetic record was created');

      const resUndef = handleOptionalRelationship(undefined, 'phone', 'vendor_phone');
      expect(resUndef.value).toBeNull();
      expect(resUndef.warning?.code).toBe(ERP2_OPTIONAL_REFERENCE_ABSENT);

      const resEmpty = handleOptionalRelationship('', 'city', 'vendor_city');
      expect(resEmpty.value).toBeNull();
      expect(resEmpty.warning?.code).toBe(ERP2_OPTIONAL_REFERENCE_ABSENT);
    });

    it('returns provided value and no warning when link is present', () => {
      const res = handleOptionalRelationship('sys-alpha', 'source_system', 'provenance_system');
      expect(res.value).toBe('sys-alpha');
      expect(res.warning).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Provenance Pair Completeness
  // ───────────────────────────────────────────────────────────────────────────
  describe('assertSourceIdentityIsComplete', () => {
    it('accepts both null or both defined', () => {
      expect(() => assertSourceIdentityIsComplete(null, null)).not.toThrow();
      expect(() => assertSourceIdentityIsComplete(undefined, undefined)).not.toThrow();
      expect(() => assertSourceIdentityIsComplete('legacy-db', 'VND-001')).not.toThrow();
    });

    it('rejects partial source identity with stable error code', () => {
      expect(() => assertSourceIdentityIsComplete('legacy-db', null)).toThrowError(
        Erp2DomainError
      );
      try {
        assertSourceIdentityIsComplete('legacy-db', null);
      } catch (err) {
        expect((err as Erp2DomainError).code).toBe(ERP2_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE);
        expect((err as Erp2DomainError).field).toBe('source_id');
      }

      try {
        assertSourceIdentityIsComplete(null, 'VND-001');
      } catch (err) {
        expect((err as Erp2DomainError).code).toBe(ERP2_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE);
        expect((err as Erp2DomainError).field).toBe('source_system');
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Enumeration Rules (AC-2)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Enumeration validations', () => {
    describe('assertValidPurchaseOrderStatus', () => {
      it('accepts all approved statuses', () => {
        expect(() => assertValidPurchaseOrderStatus('Draft')).not.toThrow();
        expect(() => assertValidPurchaseOrderStatus('Sent')).not.toThrow();
        expect(() => assertValidPurchaseOrderStatus('Received')).not.toThrow();
        expect(() => assertValidPurchaseOrderStatus('Closed')).not.toThrow();
      });

      it('rejects unknown or invalid status values with stable code', () => {
        const invalidStatuses = ['Pending', 'Cancelled', 'Processing', 'draft', ''];
        for (const s of invalidStatuses) {
          expect(() => assertValidPurchaseOrderStatus(s)).toThrowError(Erp2DomainError);
          try {
            assertValidPurchaseOrderStatus(s);
          } catch (err) {
            expect((err as Erp2DomainError).code).toBe(ERP2_DOMAIN_RULES.INVALID_PO_STATUS);
            expect((err as Erp2DomainError).field).toBe('status');
          }
        }
      });
    });

    describe('assertValidCurrencyCode', () => {
      it('accepts valid 3-letter uppercase ISO currency codes', () => {
        expect(() => assertValidCurrencyCode('USD')).not.toThrow();
        expect(() => assertValidCurrencyCode('EUR')).not.toThrow();
        expect(() => assertValidCurrencyCode('GBP')).not.toThrow();
        expect(() => assertValidCurrencyCode('INR')).not.toThrow();
      });

      it('rejects lowercase, empty or malformed currency codes', () => {
        const invalid = ['usd', 'US', 'USDD', '123', ''];
        for (const c of invalid) {
          expect(() => assertValidCurrencyCode(c)).toThrowError(Erp2DomainError);
          try {
            assertValidCurrencyCode(c);
          } catch (err) {
            expect((err as Erp2DomainError).code).toBe(ERP2_DOMAIN_RULES.INVALID_CURRENCY_CODE);
          }
        }
      });
    });

    describe('assertVendorCurrencyConsistency', () => {
      it('accepts matching currencies', () => {
        expect(() => assertVendorCurrencyConsistency('USD', 'USD')).not.toThrow();
        expect(() => assertVendorCurrencyConsistency('EUR', 'EUR')).not.toThrow();
      });

      it('rejects currency mismatch between vendor and purchase order', () => {
        expect(() => assertVendorCurrencyConsistency('USD', 'EUR')).toThrowError(Erp2DomainError);
        try {
          assertVendorCurrencyConsistency('USD', 'EUR');
        } catch (err) {
          expect((err as Erp2DomainError).code).toBe(ERP2_DOMAIN_RULES.CURRENCY_MISMATCH);
        }
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. State Transition Matrix (AC-3)
  // ───────────────────────────────────────────────────────────────────────────
  describe('assertPurchaseOrderStatusTransition', () => {
    it('allows valid sequential forward transitions', () => {
      expect(() => assertPurchaseOrderStatusTransition('Draft', 'Sent')).not.toThrow();
      expect(() => assertPurchaseOrderStatusTransition('Sent', 'Received')).not.toThrow();
      expect(() => assertPurchaseOrderStatusTransition('Received', 'Closed')).not.toThrow();
    });

    it('allows identical status as a valid no-op', () => {
      expect(() => assertPurchaseOrderStatusTransition('Draft', 'Draft')).not.toThrow();
      expect(() => assertPurchaseOrderStatusTransition('Sent', 'Sent')).not.toThrow();
      expect(() => assertPurchaseOrderStatusTransition('Received', 'Received')).not.toThrow();
      expect(() => assertPurchaseOrderStatusTransition('Closed', 'Closed')).not.toThrow();
    });

    it('rejects forward state skipping with INVALID_STATUS_TRANSITION', () => {
      expect(() => assertPurchaseOrderStatusTransition('Draft', 'Received')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertPurchaseOrderStatusTransition('Draft', 'Closed')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertPurchaseOrderStatusTransition('Sent', 'Closed')).toThrowError(
        Erp2DomainError
      );

      try {
        assertPurchaseOrderStatusTransition('Draft', 'Closed');
      } catch (err) {
        expect((err as Erp2DomainError).code).toBe(ERP2_DOMAIN_RULES.INVALID_STATUS_TRANSITION);
      }
    });

    it('rejects backward transitions with INVALID_STATUS_TRANSITION', () => {
      expect(() => assertPurchaseOrderStatusTransition('Sent', 'Draft')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertPurchaseOrderStatusTransition('Received', 'Sent')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertPurchaseOrderStatusTransition('Received', 'Draft')).toThrowError(
        Erp2DomainError
      );
    });

    it('rejects any transition from terminal Closed state', () => {
      expect(() => assertPurchaseOrderStatusTransition('Closed', 'Draft')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertPurchaseOrderStatusTransition('Closed', 'Sent')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertPurchaseOrderStatusTransition('Closed', 'Received')).toThrowError(
        Erp2DomainError
      );

      try {
        assertPurchaseOrderStatusTransition('Closed', 'Draft');
      } catch (err) {
        const domainErr = err as Erp2DomainError;
        expect(domainErr.code).toBe(ERP2_DOMAIN_RULES.INVALID_STATUS_TRANSITION);
        expect(domainErr.message).toContain('terminal status "Closed"');
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Read-Model Consistency Assertions (AC-4)
  // ───────────────────────────────────────────────────────────────────────────
  describe('assertVendorReadConsistency', () => {
    const validVendor: Vendor = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Acme Industrial Supplies',
      tax_number: 'TX-998877',
      email: 'orders@acme.com',
      phone: '+1-555-0100',
      address_line: '100 Parkway',
      city: 'Chicago',
      country: 'USA',
      bank_masked: 'XXXX-XXXX-7890',
      currency: 'USD',
      source_system: 'ERP-LEGACY',
      source_id: 'V-100',
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    };

    it('passes for consistent vendor read model', () => {
      expect(() => assertVendorReadConsistency(validVendor)).not.toThrow();
    });

    it('rejects vendor with unmasked or invalid bank details format', () => {
      const badBank = { ...validVendor, bank_masked: '123456789012' };
      expect(() => assertVendorReadConsistency(badBank)).toThrowError(Erp2DomainError);

      try {
        assertVendorReadConsistency(badBank);
      } catch (err) {
        expect((err as Erp2DomainError).code).toBe(ERP2_DOMAIN_RULES.READ_MODEL_INCONSISTENT);
        expect((err as Erp2DomainError).field).toBe('bank_masked');
      }
    });

    it('rejects vendor with missing mandatory link or field', () => {
      const missingName = { ...validVendor, name: '' };
      expect(() => assertVendorReadConsistency(missingName)).toThrowError(Erp2DomainError);

      const missingTax = { ...validVendor, tax_number: '' };
      expect(() => assertVendorReadConsistency(missingTax)).toThrowError(Erp2DomainError);
    });

    it('rejects vendor with partial provenance identity', () => {
      const partialSource = { ...validVendor, source_system: 'SYS', source_id: null };
      expect(() => assertVendorReadConsistency(partialSource)).toThrowError(Erp2DomainError);
    });
  });

  describe('assertPurchaseOrderReadConsistency', () => {
    const validPO: PurchaseOrder = {
      id: 'po-00000000-0000-0000-0000-000000000001',
      po_number: 'PO-2026-0001',
      vendor_id: '00000000-0000-0000-0000-000000000001',
      order_date: '2026-10-20',
      status: 'Draft',
      currency: 'USD',
      total: '215.75',
      lines: [
        {
          id: 'line-1',
          po_id: 'po-00000000-0000-0000-0000-000000000001',
          product_id: 'prod-00000000-0000-0000-0000-000000000001',
          quantity: '10.00',
          price: '15.50',
          line_total: '155.00',
        },
        {
          id: 'line-2',
          po_id: 'po-00000000-0000-0000-0000-000000000001',
          product_id: 'prod-00000000-0000-0000-0000-000000000002',
          quantity: '3.00',
          price: '20.25',
          line_total: '60.75',
        },
      ],
      created_at: '2026-10-20T10:00:00.000Z',
      updated_at: '2026-10-20T10:00:00.000Z',
    };

    it('passes for consistent purchase order with verified lines and computed totals', () => {
      expect(() => assertPurchaseOrderReadConsistency(validPO)).not.toThrow();
    });

    it('rejects purchase order if line total does not equal quantity * price', () => {
      const corruptLinePO: PurchaseOrder = {
        ...validPO,
        lines: [
          {
            ...validPO.lines[0]!,
            line_total: '99.99', // should be 155.00
          },
          validPO.lines[1]!,
        ],
      };

      expect(() => assertPurchaseOrderReadConsistency(corruptLinePO)).toThrowError(
        Erp2DomainError
      );
      try {
        assertPurchaseOrderReadConsistency(corruptLinePO);
      } catch (err) {
        expect((err as Erp2DomainError).code).toBe(ERP2_DOMAIN_RULES.READ_MODEL_INCONSISTENT);
        expect((err as Erp2DomainError).field).toContain('line_total');
      }
    });

    it('rejects purchase order if overall total does not equal sum of lines', () => {
      const corruptTotalPO: PurchaseOrder = {
        ...validPO,
        total: '500.00', // actual sum is 215.75
      };

      expect(() => assertPurchaseOrderReadConsistency(corruptTotalPO)).toThrowError(
        Erp2DomainError
      );
      try {
        assertPurchaseOrderReadConsistency(corruptTotalPO);
      } catch (err) {
        expect((err as Erp2DomainError).code).toBe(ERP2_DOMAIN_RULES.READ_MODEL_INCONSISTENT);
        expect((err as Erp2DomainError).field).toBe('total');
      }
    });

    it('rejects purchase order with empty lines list', () => {
      const emptyLinesPO: PurchaseOrder = {
        ...validPO,
        lines: [],
      };

      expect(() => assertPurchaseOrderReadConsistency(emptyLinesPO)).toThrowError(
        Erp2DomainError
      );
    });

    it('rejects purchase order with invalid status', () => {
      const badStatusPO = {
        ...validPO,
        status: 'InvalidStatus' as any,
      };

      expect(() => assertPurchaseOrderReadConsistency(badStatusPO)).toThrowError(
        Erp2DomainError
      );
    });
  });
});
