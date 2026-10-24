/**
 * ERP-3 Sales Orders & Invoices — Exact Duplicate Key Policy Domain Tests
 *
 * Tests prove:
 *   1. Key Normalization: Pure functions produce deterministic strings across variations.
 *   2. Deterministic Matching: Exact boolean key equality (confidence 1.0).
 *   3. Ambiguity Detection: Conflicting candidate keys are flagged as AMBIGUOUS_CANDIDATE.
 *   4. Prohibition of Fuzzy Auto-Merge: System strictly rejects fuzzy heuristics and automated merges.
 *   5. Human Merge Decision Validation: Enforces required distinct IDs and documented rationale.
 *
 * @module erp3/tests/domain/duplicate-policy.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeOrderNumber,
  normalizeInvoiceNumber,
  normalizePaymentReference,
  extractOrderKeys,
  extractInvoiceKeys,
  extractPaymentKeys,
  classifySalesOrderCandidate,
  classifyInvoiceCandidate,
  classifyPaymentCandidate,
  assertNoFuzzyAutoMerge,
  assertValidHumanMergeDecision,
} from '../../src/domain/duplicate-policy.js';
import type { SalesOrder, Invoice, Payment } from '@clearshift/contracts';

const sampleOrders: Partial<SalesOrder>[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    order_number: 'SO-2026-0001',
    customer_golden_id: 'c0000000-0000-4000-8000-000000000001',
    order_date: '2026-04-01',
    status: 'Open',
    currency: 'USD',
    total: '100.0000',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    order_number: 'SO-2026-0002',
    customer_golden_id: 'c0000000-0000-4000-8000-000000000002',
    order_date: '2026-04-02',
    status: 'Invoiced',
    currency: 'USD',
    total: '250.0000',
  },
];

const sampleInvoices: Partial<Invoice>[] = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    invoice_number: 'INV-2026-0001',
    order_id: '11111111-1111-4111-8111-111111111111',
    invoice_date: '2026-04-01',
    due_date: '2026-04-30',
    status: 'Open',
    currency: 'USD',
    total: '100.0000',
  },
];

const samplePayments: Partial<Payment>[] = [
  {
    id: '44444444-4444-4444-8444-444444444444',
    invoice_id: '33333333-3333-4333-8333-333333333333',
    payment_date: '2026-04-05',
    payment_method: 'card',
    amount: '100.0000',
    reference: 'PAY-REF-999',
  },
];

describe('ERP-3 Exact Duplicate Key Policy (AC1: Normalized Exact Keys)', () => {
  describe('Order Number Normalization', () => {
    it('normalizes order number by trimming, uppercasing, and stripping delimiters', () => {
      expect(normalizeOrderNumber('  so-2026-0001  ')).toBe('SO20260001');
      expect(normalizeOrderNumber('SO_2026/0002')).toBe('SO20260002');
      expect(normalizeOrderNumber('so 2026 0003')).toBe('SO20260003');
    });

    it('handles empty or non-string input safely', () => {
      expect(normalizeOrderNumber('')).toBe('');
      expect(normalizeOrderNumber(null as unknown as string)).toBe('');
      expect(normalizeOrderNumber(undefined as unknown as string)).toBe('');
    });
  });

  describe('Invoice Number Normalization', () => {
    it('normalizes invoice number by trimming, uppercasing, and stripping delimiters', () => {
      expect(normalizeInvoiceNumber('  inv-2026-0001  ')).toBe('INV20260001');
      expect(normalizeInvoiceNumber('INV_2026_0002')).toBe('INV20260002');
    });

    it('handles empty or non-string input safely', () => {
      expect(normalizeInvoiceNumber('')).toBe('');
      expect(normalizeInvoiceNumber(null as unknown as string)).toBe('');
    });
  });

  describe('Payment Reference Normalization', () => {
    it('normalizes payment reference', () => {
      expect(normalizePaymentReference('  pay-ref-999  ')).toBe('PAYREF999');
      expect(normalizePaymentReference('TXN_123_ABC')).toBe('TXN123ABC');
    });
  });

  describe('Key Extraction Helpers', () => {
    it('extracts normalized order keys', () => {
      const keys = extractOrderKeys({ order_number: ' SO-2026-0001 ' });
      expect(keys.normalizedOrderNumber).toBe('SO20260001');
      expect(keys.rawOrderNumber).toBe(' SO-2026-0001 ');
    });

    it('extracts normalized invoice keys', () => {
      const keys = extractInvoiceKeys({ invoice_number: ' INV-001 ' });
      expect(keys.normalizedInvoiceNumber).toBe('INV001');
      expect(keys.rawInvoiceNumber).toBe(' INV-001 ');
    });

    it('extracts normalized payment keys', () => {
      const keys = extractPaymentKeys({ reference: ' REF-01 ', invoice_id: 'inv-uuid' });
      expect(keys.normalizedReference).toBe('REF01');
      expect(keys.invoiceId).toBe('inv-uuid');
    });
  });
});

describe('ERP-3 Exact Duplicate Matching (AC2: Deterministic Exact Matching)', () => {
  it('flags incoming record with identical normalized order number as EXACT_DUPLICATE', () => {
    const incoming = {
      order_number: '  so_2026_0001  ',
      customer_golden_id: 'c0000000-0000-4000-8000-000000000001',
    };
    const outcome = classifySalesOrderCandidate(incoming, sampleOrders);

    expect(outcome.classification).toBe('EXACT_DUPLICATE');
    expect(outcome.candidate).toBeDefined();
    expect(outcome.candidate?.confidence).toBe(1.0);
    expect(outcome.candidate?.match_kind).toBe('EXACT_ORDER_NUMBER');
    expect(outcome.candidate?.matching_key).toBe('order_number');
    expect(outcome.candidate?.status).toBe('PENDING_REVIEW');
  });

  it('classifies distinct order number as UNIQUE', () => {
    const incoming = {
      order_number: 'SO-2026-9999',
      customer_golden_id: 'c0000000-0000-4000-8000-000000000001',
    };
    const outcome = classifySalesOrderCandidate(incoming, sampleOrders);
    expect(outcome.classification).toBe('UNIQUE');
    expect(outcome.candidate).toBeUndefined();
  });

  it('flags matching invoice number as EXACT_DUPLICATE', () => {
    const incoming = { invoice_number: '  inv-2026-0001  ' };
    const outcome = classifyInvoiceCandidate(incoming, sampleInvoices);
    expect(outcome.classification).toBe('EXACT_DUPLICATE');
    expect(outcome.candidate?.match_kind).toBe('EXACT_INVOICE_NUMBER');
    expect(outcome.candidate?.confidence).toBe(1.0);
  });

  it('flags matching payment reference on same invoice as EXACT_DUPLICATE', () => {
    const incoming = {
      reference: 'pay_ref_999',
      invoice_id: '33333333-3333-4333-8333-333333333333',
    };
    const outcome = classifyPaymentCandidate(incoming, samplePayments);
    expect(outcome.classification).toBe('EXACT_DUPLICATE');
    expect(outcome.candidate?.match_kind).toBe('EXACT_PAYMENT_REFERENCE');
  });
});

describe('ERP-3 Ambiguity Detection & Human Review Holding (AC3)', () => {
  it('flags collision with conflicting customer Golden ID as AMBIGUOUS_CANDIDATE', () => {
    const incoming = {
      order_number: 'SO-2026-0001',
      customer_golden_id: 'different-customer-golden-id',
    };
    const outcome = classifySalesOrderCandidate(incoming, sampleOrders);
    expect(outcome.classification).toBe('AMBIGUOUS_CANDIDATE');
    expect(outcome.candidate?.match_kind).toBe('AMBIGUOUS');
    expect(outcome.candidate?.confidence).toBe(1.0);
  });
});

describe('ERP-3 Prohibition of Fuzzy Auto-Merge (AC3 Invariant)', () => {
  it('throws domain error if confidence < 1.0 (fuzzy matching attempt)', () => {
    expect(() => {
      assertNoFuzzyAutoMerge({ confidence: 0.95 });
    }).toThrowError(/Fuzzy duplicate matching scoring is strictly out of scope/);
  });

  it('throws domain error if autoMerge is attempted without human approval', () => {
    expect(() => {
      assertNoFuzzyAutoMerge({ isAutoMerge: true });
    }).toThrowError(/Automatic target-side duplicate merging is strictly prohibited/);
  });

  it('passes when confidence is 1.0 and isAutoMerge is false', () => {
    expect(() => {
      assertNoFuzzyAutoMerge({ confidence: 1.0, isAutoMerge: false });
    }).not.toThrow();
  });
});

describe('ERP-3 Human Merge Decision Validation (AC4)', () => {
  it('validates successful MERGE decision with distinct kept_id and merged_id', () => {
    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: '123e4567-e89b-12d3-a456-426614174000',
        decision: 'MERGE',
        kept_id: '11111111-1111-4111-8111-111111111111',
        merged_id: '22222222-2222-4222-8222-222222222222',
        rationale: 'Confirmed duplicate order entries from legacy migration',
      });
    }).not.toThrow();
  });

  it('rejects MERGE decision when kept_id equals merged_id', () => {
    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: '123e4567-e89b-12d3-a456-426614174000',
        decision: 'MERGE',
        kept_id: '11111111-1111-4111-8111-111111111111',
        merged_id: '11111111-1111-4111-8111-111111111111',
        rationale: 'Same ID merge attempt',
      });
    }).toThrowError(/kept_id and merged_id must be distinct UUIDs/);
  });

  it('rejects decisions with rationale shorter than 5 characters', () => {
    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: '123e4567-e89b-12d3-a456-426614174000',
        decision: 'REJECT',
        rationale: 'bad',
      });
    }).toThrowError(/documented human review rationale of at least 5 characters is required/);
  });
});
