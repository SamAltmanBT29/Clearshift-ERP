/**
 * ERP-2 Vendors & Purchasing — Domain Rules Unit Tests
 *
 * Exhaustively tests pure domain invariants without database or network I/O:
 *   - FR-ERP2-02, FR-ERP2-06: Bank details masking and format assertion
 *   - FR-ERP2-04: Strict unidirectional status machine (Draft -> Sent -> Received -> Closed)
 *   - FR-ERP2-05: Server-side calculated order totals and decimal rounding
 *   - BR-ERP2-01: Line quantity and price constraints
 *
 * @module erp2/tests/domain/rules.test
 */

import { describe, it, expect } from 'vitest';
import {
  Erp2DomainError,
  maskBankDetails,
  assertValidBankDetails,
  assertValidPoStatusTransition,
  calculatePoLinesAndTotal,
  ALLOWED_PO_STATUS_TRANSITIONS,
} from '../../src/domain/rules.js';

describe('ERP-2 Domain Rules — Pure Invariants', () => {
  describe('Bank Details Masking (FR-ERP2-02, FR-ERP2-06)', () => {
    it('masks standard 12 to 16 digit account numbers with XXXX-XXXX-7890 format', () => {
      expect(maskBankDetails('1234567890123456')).toBe('XXXX-XXXX-3456');
      expect(maskBankDetails('98765432101234')).toBe('XXXX-XXXX-1234');
      expect(maskBankDetails('40001234567890')).toBe('XXXX-XXXX-7890');
    });

    it('ignores non-digit characters and correctly masks last 4 digits', () => {
      expect(maskBankDetails('1234-5678-9012-7890')).toBe('XXXX-XXXX-7890');
      expect(maskBankDetails('GB29 XBAR 1234 5678 9999')).toBe('XXXX-XXXX-9999');
    });

    it('pads short account strings with leading zeros', () => {
      expect(maskBankDetails('99')).toBe('XXXX-XXXX-0099');
    });

    it('returns null for empty, null or undefined input', () => {
      expect(maskBankDetails(null)).toBeNull();
      expect(maskBankDetails(undefined)).toBeNull();
      expect(maskBankDetails('')).toBeNull();
    });

    it('assertValidBankDetails accepts valid strings and nullish values', () => {
      expect(() => assertValidBankDetails(null)).not.toThrow();
      expect(() => assertValidBankDetails(undefined)).not.toThrow();
      expect(() => assertValidBankDetails('123456789')).not.toThrow();
    });

    it('assertValidBankDetails throws for strings shorter than 4 characters', () => {
      expect(() => assertValidBankDetails('123')).toThrowError(Erp2DomainError);
      expect(() => assertValidBankDetails('   ')).toThrowError(Erp2DomainError);
    });
  });

  describe('Purchase Order Status Transitions (FR-ERP2-04)', () => {
    it('allows valid forward sequential transitions', () => {
      expect(() => assertValidPoStatusTransition('Draft', 'Sent')).not.toThrow();
      expect(() => assertValidPoStatusTransition('Sent', 'Received')).not.toThrow();
      expect(() => assertValidPoStatusTransition('Received', 'Closed')).not.toThrow();
    });

    it('rejects skipping states in forward flow', () => {
      expect(() => assertValidPoStatusTransition('Draft', 'Received')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertValidPoStatusTransition('Draft', 'Closed')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertValidPoStatusTransition('Sent', 'Closed')).toThrowError(
        Erp2DomainError
      );
    });

    it('rejects backward transitions', () => {
      expect(() => assertValidPoStatusTransition('Sent', 'Draft')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertValidPoStatusTransition('Received', 'Sent')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertValidPoStatusTransition('Received', 'Draft')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertValidPoStatusTransition('Closed', 'Received')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertValidPoStatusTransition('Closed', 'Draft')).toThrowError(
        Erp2DomainError
      );
    });

    it('rejects self-transitions', () => {
      expect(() => assertValidPoStatusTransition('Draft', 'Draft')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertValidPoStatusTransition('Sent', 'Sent')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertValidPoStatusTransition('Received', 'Received')).toThrowError(
        Erp2DomainError
      );
      expect(() => assertValidPoStatusTransition('Closed', 'Closed')).toThrowError(
        Erp2DomainError
      );
    });

    it('has empty allowed transitions for Closed terminal state', () => {
      expect(ALLOWED_PO_STATUS_TRANSITIONS['Closed']).toEqual([]);
    });
  });

  describe('Order Total Recomputation & Decimal Arithmetic (FR-ERP2-05, BR-ERP2-01)', () => {
    const prodA = '00000000-0000-0000-0000-0000000000aa';
    const prodB = '00000000-0000-0000-0000-0000000000bb';

    it('accurately computes line totals and overall total with 2 decimal places', () => {
      const { lines, total } = calculatePoLinesAndTotal([
        { product_id: prodA, quantity: '10.00', price: '15.50' }, // 155.00
        { product_id: prodB, quantity: '3.00', price: '20.25' },  // 60.75
      ]);

      expect(total).toBe('215.75');
      expect(lines).toHaveLength(2);
      expect(lines[0].line_total).toBe('155.00');
      expect(lines[1].line_total).toBe('60.75');
    });

    it('applies standard half-up currency rounding for fractional cent values', () => {
      const { lines, total } = calculatePoLinesAndTotal([
        { product_id: prodA, quantity: '3', price: '1.333' }, // 3 * 1.333 = 3.999 -> 4.00
      ]);

      expect(lines[0].line_total).toBe('4.00');
      expect(total).toBe('4.00');
    });

    it('rejects empty order lines', () => {
      expect(() => calculatePoLinesAndTotal([])).toThrowError(Erp2DomainError);
    });

    it('rejects zero or negative quantities', () => {
      expect(() =>
        calculatePoLinesAndTotal([{ product_id: prodA, quantity: '0.00', price: '10.00' }])
      ).toThrowError(Erp2DomainError);

      expect(() =>
        calculatePoLinesAndTotal([{ product_id: prodA, quantity: '-5.00', price: '10.00' }])
      ).toThrowError(Erp2DomainError);
    });

    it('rejects negative prices', () => {
      expect(() =>
        calculatePoLinesAndTotal([{ product_id: prodA, quantity: '1.00', price: '-1.00' }])
      ).toThrowError(Erp2DomainError);
    });

    it('allows zero price (e.g. promotional or warranty items)', () => {
      const { lines, total } = calculatePoLinesAndTotal([
        { product_id: prodA, quantity: '1.00', price: '0.00' },
      ]);
      expect(lines[0].line_total).toBe('0.00');
      expect(total).toBe('0.00');
    });

    it('rejects non-numeric quantity or price strings', () => {
      expect(() =>
        calculatePoLinesAndTotal([{ product_id: prodA, quantity: 'invalid', price: '10.00' }])
      ).toThrowError(Erp2DomainError);

      expect(() =>
        calculatePoLinesAndTotal([{ product_id: prodA, quantity: '10.00', price: 'invalid' }])
      ).toThrowError(Erp2DomainError);
    });
  });
});
