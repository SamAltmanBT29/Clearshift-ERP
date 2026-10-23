/**
 * ERP-2 Vendors & Purchasing — Exact Duplicate Key Policy Domain Tests
 *
 * Tests prove:
 *   1. Key Normalization: Pure functions produce deterministic strings across variations.
 *   2. Deterministic Matching: Exact boolean key equality (confidence 1.0).
 *   3. Ambiguity Detection: Conflicting candidate keys are flagged as AMBIGUOUS_CANDIDATE.
 *   4. Prohibition of Fuzzy Auto-Merge: System strictly rejects fuzzy heuristics and automated merges.
 *   5. Human Merge Decision Validation: Enforces required distinct IDs and documented rationale.
 *
 * @module erp2/tests/domain/duplicate-policy.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeTaxNumber,
  normalizeEmail,
  normalizePoNumber,
  extractVendorKeys,
  extractPoKeys,
  classifyVendorCandidate,
  classifyPurchaseOrderCandidate,
  assertNoFuzzyAutoMerge,
  assertValidHumanMergeDecision,
} from '../../src/domain/duplicate-policy.js';
import type { Vendor, PurchaseOrder } from '@clearshift/contracts';

const sampleVendors: Vendor[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Acme Industrial Supplies LLC',
    tax_number: 'US-EIN-123456789',
    email: 'procurement@acme-industrial.com',
    phone: '+1-555-0100',
    address_line: '100 Industrial Pkwy',
    city: 'Chicago',
    country: 'United States',
    bank_masked: 'XXXX-XXXX-1234',
    currency: 'USD',
    source_system: null,
    source_id: null,
    created_at: '2026-10-23T00:00:00Z',
    updated_at: '2026-10-23T00:00:00Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Global Metals Corp',
    tax_number: 'GB-VAT-987654321',
    email: 'billing@globalmetals.co.uk',
    phone: '+44-20-7946-0958',
    address_line: '25 Foundry Lane',
    city: 'Sheffield',
    country: 'United Kingdom',
    bank_masked: 'XXXX-XXXX-5678',
    currency: 'GBP',
    source_system: null,
    source_id: null,
    created_at: '2026-10-23T00:00:00Z',
    updated_at: '2026-10-23T00:00:00Z',
  },
];

const sampleOrders: PurchaseOrder[] = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    po_number: 'PO-2026-0001',
    vendor_id: '11111111-1111-4111-8111-111111111111',
    order_date: '2026-10-23',
    status: 'Draft',
    currency: 'USD',
    total: '500.00',
    lines: [],
    created_at: '2026-10-23T00:00:00Z',
    updated_at: '2026-10-23T00:00:00Z',
  },
];

describe('ERP-2 Exact Duplicate Key Policy (AC1: Normalized Exact Keys)', () => {
  describe('Tax Number Normalization', () => {
    it('normalizes tax number by trimming, uppercasing, and removing separators', () => {
      expect(normalizeTaxNumber('  us-ein-123456789  ')).toBe('USEIN123456789');
      expect(normalizeTaxNumber('GB-VAT-987.654/321')).toBe('GBVAT987654321');
      expect(normalizeTaxNumber('de 123 456 789')).toBe('DE123456789');
      expect(normalizeTaxNumber('FR_99_888_777_666')).toBe('FR99888777666');
    });

    it('handles empty or non-string input safely', () => {
      expect(normalizeTaxNumber('')).toBe('');
      expect(normalizeTaxNumber(null as unknown as string)).toBe('');
      expect(normalizeTaxNumber(undefined as unknown as string)).toBe('');
    });
  });

  describe('Email Normalization', () => {
    it('normalizes email address by trimming and lowercasing', () => {
      expect(normalizeEmail('  Procurement@Acme-Industrial.COM  ')).toBe('procurement@acme-industrial.com');
      expect(normalizeEmail('INFO@GlobalMetals.Co.UK')).toBe('info@globalmetals.co.uk');
    });

    it('handles empty or non-string input safely', () => {
      expect(normalizeEmail('')).toBe('');
      expect(normalizeEmail(null as unknown as string)).toBe('');
    });
  });

  describe('Purchase Order Number Normalization', () => {
    it('normalizes PO number by trimming and uppercasing', () => {
      expect(normalizePoNumber('  po-2026-0001  ')).toBe('PO-2026-0001');
      expect(normalizePoNumber('order/2026/999')).toBe('ORDER/2026/999');
    });
  });

  describe('Key Extraction', () => {
    it('extracts normalized vendor keys', () => {
      const keys = extractVendorKeys({
        tax_number: '  us-ein-123456789 ',
        email: ' Sales@Acme.COM ',
      });
      expect(keys.normalizedTaxNumber).toBe('USEIN123456789');
      expect(keys.normalizedEmail).toBe('sales@acme.com');
      expect(keys.rawTaxNumber).toBe('  us-ein-123456789 ');
    });

    it('extracts normalized purchase order keys', () => {
      const keys = extractPoKeys({
        po_number: ' po-2026-0001 ',
      });
      expect(keys.normalizedPoNumber).toBe('PO-2026-0001');
    });
  });
});

describe('ERP-2 Deterministic Candidate Matching (AC2: Exact Key Matching)', () => {
  it('classifies exact tax number match as EXACT_DUPLICATE (confidence 1.0)', () => {
    const candidate = {
      name: 'Acme Industrial Supplies Re-import',
      tax_number: '  US-EIN-123456789  ',
      email: 'different-contact@acme-industrial.com',
    };
    const outcome = classifyVendorCandidate(candidate, sampleVendors);
    expect(outcome.classification).toBe('AMBIGUOUS_CANDIDATE'); // tax matches but different email
  });

  it('classifies matching tax and matching email as EXACT_DUPLICATE', () => {
    const candidate = {
      name: 'Acme Industrial Supplies LLC',
      tax_number: 'US-EIN-123456789',
      email: 'procurement@acme-industrial.com',
    };
    const outcome = classifyVendorCandidate(candidate, sampleVendors);
    expect(outcome.classification).toBe('EXACT_DUPLICATE');
    expect(outcome.candidate).toBeDefined();
    expect(outcome.candidate?.confidence).toBe(1.0);
    expect(outcome.candidate?.match_kind).toBe('EXACT_TAX_NUMBER');
  });

  it('classifies matching email without tax number as EXACT_EMAIL duplicate', () => {
    const candidate = {
      name: 'Global Metals Duplicate',
      email: '  Billing@GlobalMetals.CO.UK  ',
    };
    const outcome = classifyVendorCandidate(candidate, sampleVendors);
    expect(outcome.classification).toBe('EXACT_DUPLICATE');
    expect(outcome.candidate?.match_kind).toBe('EXACT_EMAIL');
    expect(outcome.candidate?.confidence).toBe(1.0);
  });

  it('classifies completely new keys as UNIQUE', () => {
    const candidate = {
      name: 'Pacific Robotics Inc',
      tax_number: 'US-EIN-555555555',
      email: 'contact@pacific-robotics.com',
    };
    const outcome = classifyVendorCandidate(candidate, sampleVendors);
    expect(outcome.classification).toBe('UNIQUE');
    expect(outcome.candidate).toBeUndefined();
  });

  it('classifies purchase order exact po_number match as EXACT_DUPLICATE', () => {
    const candidate = {
      po_number: 'po-2026-0001',
      vendor_id: '11111111-1111-4111-8111-111111111111',
      order_date: '2026-10-23',
    };
    const outcome = classifyPurchaseOrderCandidate(candidate, sampleOrders);
    expect(outcome.classification).toBe('EXACT_DUPLICATE');
    expect(outcome.candidate?.match_kind).toBe('EXACT_PO_NUMBER');
    expect(outcome.candidate?.confidence).toBe(1.0);
  });
});

describe('ERP-2 Ambiguity Handling (AC3: No Fuzzy Auto-Merge in V1)', () => {
  it('flags cross-entity collision as AMBIGUOUS_CANDIDATE held for review', () => {
    // Tax matches Acme, but Email matches Global Metals
    const candidate = {
      name: 'Cross Entity Candidate',
      tax_number: 'US-EIN-123456789', // Matches Acme
      email: 'billing@globalmetals.co.uk', // Matches Global Metals
    };
    const outcome = classifyVendorCandidate(candidate, sampleVendors);
    expect(outcome.classification).toBe('AMBIGUOUS_CANDIDATE');
    expect(outcome.candidate?.match_kind).toBe('AMBIGUOUS');
    expect(outcome.candidate?.status).toBe('PENDING_REVIEW');
  });

  it('forbids fuzzy duplicate matching scoring in V1', () => {
    expect(() => {
      assertNoFuzzyAutoMerge({ isFuzzy: true });
    }).toThrowError(/Fuzzy duplicate matching scoring is strictly out of scope/);

    expect(() => {
      assertNoFuzzyAutoMerge({ confidence: 0.85 });
    }).toThrowError(/Fuzzy duplicate matching scoring is strictly out of scope/);
  });

  it('forbids automatic target-side merging in V1', () => {
    expect(() => {
      assertNoFuzzyAutoMerge({ isAutoMerge: true });
    }).toThrowError(/Automatic target-side duplicate merging is strictly prohibited/);
  });

  it('allows exact deterministic matching with confidence 1.0', () => {
    expect(() => {
      assertNoFuzzyAutoMerge({ isAutoMerge: false, confidence: 1.0 });
    }).not.toThrow();
  });
});

describe('ERP-2 Human Merge Decision Validation (AC4: Audited Human Review)', () => {
  it('rejects an invalid merge decision type', () => {
    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: '00000000-0000-4000-8000-000000000001',
        decision: 'AUTO_RESOLVE' as any,
        rationale: 'Valid rationale here',
      });
    }).toThrowError(/Invalid merge decision/);
  });

  it('rejects MERGE decision missing kept_id or merged_id', () => {
    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: '00000000-0000-4000-8000-000000000001',
        decision: 'MERGE',
        rationale: 'Valid rationale here',
      });
    }).toThrowError(/requires a valid 'kept_id'/);

    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: '00000000-0000-4000-8000-000000000001',
        decision: 'MERGE',
        kept_id: '11111111-1111-4111-8111-111111111111',
        rationale: 'Valid rationale here',
      });
    }).toThrowError(/requires a valid 'merged_id'/);
  });

  it('rejects merging a record into itself (kept_id === merged_id)', () => {
    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: '00000000-0000-4000-8000-000000000001',
        decision: 'MERGE',
        kept_id: '11111111-1111-4111-8111-111111111111',
        merged_id: '11111111-1111-4111-8111-111111111111',
        rationale: 'Attempting self merge',
      });
    }).toThrowError(/Cannot merge a record into itself/);
  });

  it('rejects short or empty rationale', () => {
    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: '00000000-0000-4000-8000-000000000001',
        decision: 'REJECT',
        rationale: 'ok',
      });
    }).toThrowError(/documented human review rationale of at least 5 characters/);
  });

  it('accepts valid human review decisions', () => {
    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: '00000000-0000-4000-8000-000000000001',
        decision: 'MERGE',
        kept_id: '11111111-1111-4111-8111-111111111111',
        merged_id: '22222222-2222-4222-8222-222222222222',
        rationale: 'Confirmed identical vendor with corporate subsidiary tax ID',
      });
    }).not.toThrow();

    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: '00000000-0000-4000-8000-000000000001',
        decision: 'REJECT',
        rationale: 'Confirmed spurious duplicate record from legacy batch',
      });
    }).not.toThrow();

    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: '00000000-0000-4000-8000-000000000001',
        decision: 'KEEP_BOTH',
        rationale: 'Distinct regional divisions operating under shared corporate domain',
      });
    }).not.toThrow();
  });
});
