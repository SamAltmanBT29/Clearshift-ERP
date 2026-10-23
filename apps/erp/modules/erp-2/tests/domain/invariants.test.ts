import { describe, expect, it } from 'vitest';
import {
  ALLOWED_PO_STATUS_TRANSITIONS,
  Erp2DomainError,
  assertValidBankDetails,
  assertValidPoStatusTransition,
  calculatePoLinesAndTotal,
  maskBankDetails,
} from '../../src/domain/rules.js';

const PRODUCT = '11111111-1111-4111-8111-111111111111';

function expectDomainError(fn: () => unknown, code: string, field?: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(Erp2DomainError);
    expect((e as Erp2DomainError).code).toBe(code);
    if (field) expect((e as Erp2DomainError).field).toBe(field);
    return;
  }
  throw new Error(`Expected Erp2DomainError ${code} but nothing was thrown`);
}

describe('ERP-2 bank detail masking (FR-ERP2-02/06)', () => {
  it('masks to XXXX-XXXX-<last4>', () => {
    expect(maskBankDetails('123456787890')).toBe('XXXX-XXXX-7890');
  });
  it('ignores separators and spaces', () => {
    expect(maskBankDetails('1234-5678 7890')).toBe('XXXX-XXXX-7890');
  });
  it('never leaks the leading digits', () => {
    const masked = maskBankDetails('99887766554433')!;
    expect(masked).not.toContain('9988');
    expect(masked).toMatch(/^XXXX-XXXX-\d{4}$/);
  });
  it('uses last 4 digits of an alphanumeric IBAN', () => {
    expect(maskBankDetails('GB82WEST12345698765432')).toBe('XXXX-XXXX-5432');
  });
  it.each([null, undefined, ''])('returns null for empty input %s', (v) => {
    expect(maskBankDetails(v as string | null | undefined)).toBeNull();
  });
  it('rejects bank details shorter than 4 chars', () => {
    expectDomainError(() => assertValidBankDetails('12'), 'INVALID_BANK_DETAILS', 'bank_details');
  });
  it('rejects whitespace-only bank details', () => {
    expectDomainError(() => assertValidBankDetails('      '), 'INVALID_BANK_DETAILS');
  });
  it('accepts null/undefined/4-char bank details', () => {
    expect(() => assertValidBankDetails(undefined)).not.toThrow();
    expect(() => assertValidBankDetails(null)).not.toThrow();
    expect(() => assertValidBankDetails('1234')).not.toThrow();
  });
});

describe('ERP-2 PO status flow (FR-ERP2-04)', () => {
  const ALL = ['Draft', 'Sent', 'Received', 'Closed'] as const;

  it.each(
    ALL.flatMap((from) =>
      ALL.map((to) => [from, to, ALLOWED_PO_STATUS_TRANSITIONS[from].includes(to)] as const),
    ),
  )('%s -> %s allowed=%s', (from, to, allowed) => {
    if (allowed) {
      expect(() => assertValidPoStatusTransition(from, to)).not.toThrow();
    } else {
      expectDomainError(() => assertValidPoStatusTransition(from, to), 'INVALID_STATUS_TRANSITION', 'status');
    }
  });

  it('only the three forward steps are allowed', () => {
    expect(ALLOWED_PO_STATUS_TRANSITIONS).toEqual({
      Draft: ['Sent'],
      Sent: ['Received'],
      Received: ['Closed'],
      Closed: [],
    });
  });

  it('error context carries current, target and allowed', () => {
    try {
      assertValidPoStatusTransition('Sent', 'Draft');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Erp2DomainError).context).toMatchObject({
        currentStatus: 'Sent',
        targetStatus: 'Draft',
        allowed: ['Received'],
      });
    }
  });
});

describe('ERP-2 server-side totals (FR-ERP2-05, BR-ERP2-01)', () => {
  it('computes line_total and total with 2dp strings', () => {
    const r = calculatePoLinesAndTotal([
      { product_id: PRODUCT, quantity: 2, price: '10.50' },
      { product_id: PRODUCT, quantity: '3', price: 4 },
    ]);
    expect(r.lines.map((l) => l.line_total)).toEqual(['21.00', '12.00']);
    expect(r.total).toBe('33.00');
  });
  it('avoids binary float error (0.1 * 3)', () => {
    const r = calculatePoLinesAndTotal([{ product_id: PRODUCT, quantity: 3, price: '0.1' }]);
    expect(r.total).toBe('0.30');
  });
  it('rounds half-up at 2dp (3 x 0.335 = 1.005 -> 1.01)', () => {
    const r = calculatePoLinesAndTotal([{ product_id: PRODUCT, quantity: 3, price: '0.335' }]);
    expect(r.lines[0]!.line_total).toBe('1.01');
  });
  it('total is the sum of the rounded line totals', () => {
    const r = calculatePoLinesAndTotal([
      { product_id: PRODUCT, quantity: 1, price: '0.005' },
      { product_id: PRODUCT, quantity: 1, price: '0.005' },
    ]);
    expect(r.total).toBe('0.02');
  });
  it('allows a zero price (boundary)', () => {
    const r = calculatePoLinesAndTotal([{ product_id: PRODUCT, quantity: 5, price: 0 }]);
    expect(r.total).toBe('0.00');
  });
  it('handles large amounts without precision loss', () => {
    const r = calculatePoLinesAndTotal([{ product_id: PRODUCT, quantity: '1000000', price: '9999999999.99' }]);
    expect(r.total).toBe('9999999999990000.00');
  });
  it('rejects an empty line list', () => {
    expectDomainError(() => calculatePoLinesAndTotal([]), 'EMPTY_ORDER_LINES', 'lines');
  });
  it('rejects quantity 0', () => {
    expectDomainError(
      () => calculatePoLinesAndTotal([{ product_id: PRODUCT, quantity: 0, price: 1 }]),
      'QUANTITY_MUST_BE_POSITIVE',
      'lines.0.quantity',
    );
  });
  it('rejects negative quantity', () => {
    expectDomainError(
      () => calculatePoLinesAndTotal([{ product_id: PRODUCT, quantity: -1, price: 1 }]),
      'QUANTITY_MUST_BE_POSITIVE',
    );
  });
  it('rejects negative price', () => {
    expectDomainError(
      () => calculatePoLinesAndTotal([{ product_id: PRODUCT, quantity: 1, price: '-0.01' }]),
      'PRICE_MUST_BE_NON_NEGATIVE',
      'lines.0.price',
    );
  });
  it('rejects non-numeric quantity', () => {
    expectDomainError(
      () => calculatePoLinesAndTotal([{ product_id: PRODUCT, quantity: 'abc', price: 1 }]),
      'INVALID_QUANTITY',
    );
  });
  it('rejects non-numeric price', () => {
    expectDomainError(
      () => calculatePoLinesAndTotal([{ product_id: PRODUCT, quantity: 1, price: 'free' }]),
      'INVALID_PRICE',
    );
  });
  it('reports the failing line index', () => {
    expectDomainError(
      () =>
        calculatePoLinesAndTotal([
          { product_id: PRODUCT, quantity: 1, price: 1 },
          { product_id: PRODUCT, quantity: 1, price: -5 },
        ]),
      'PRICE_MUST_BE_NON_NEGATIVE',
      'lines.1.price',
    );
  });
});
