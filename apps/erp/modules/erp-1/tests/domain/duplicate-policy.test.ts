/**
 * ERP-1 Products & Inventory — Exact Duplicate Key Policy Domain Tests
 *
 * Tests prove:
 *   1. Key Normalization: Pure functions produce deterministic strings across variations.
 *   2. Deterministic Matching: Exact boolean key equality (confidence 1.0).
 *   3. Ambiguity Detection: Conflicting candidate keys are flagged as AMBIGUOUS_CANDIDATE.
 *   4. Prohibition of Fuzzy Auto-Merge: System strictly rejects fuzzy heuristics and automated merges.
 *   5. Human Merge Decision Validation: Enforces required distinct IDs and documented rationale.
 *
 * @module erp1/tests/domain/duplicate-policy.test.ts
 */

import { describe, it, expect } from 'vitest';
import { normalizeSku, type Product, type Category } from '@clearshift/contracts';
import {
  normalizeProductName,
  normalizeCategoryCode,
  extractProductKeys,
  extractCategoryKeys,
  classifyProductCandidate,
  classifyCategoryCandidate,
  assertNoFuzzyAutoMerge,
  assertValidHumanMergeDecision,
} from '../../src/domain/duplicate-policy.js';

const sampleProducts: Product[] = [
  {
    id: 'a1111111-1111-4111-8111-111111111111',
    name: 'Standard Steel Bolt M8',
    sku: 'BOLT-M8-STD',
    normalizedSku: 'BOLT-M8-STD',
    categoryId: 'c1111111-1111-4111-8111-111111111111',
    unitOfMeasure: 'pcs',
    price: '0.45',
    currency: 'USD',
    taxRate: '0.20',
    createdAt: '2026-10-23T00:00:00Z',
    updatedAt: '2026-10-23T00:00:00Z',
  },
  {
    id: 'a2222222-2222-4222-8222-222222222222',
    name: 'Industrial Lubricant 5L',
    sku: 'LUB-IND-5L',
    normalizedSku: 'LUB-IND-5L',
    categoryId: 'c2222222-2222-4222-8222-222222222222',
    unitOfMeasure: 'litre',
    price: '34.90',
    currency: 'USD',
    taxRate: '0.20',
    createdAt: '2026-10-23T00:00:00Z',
    updatedAt: '2026-10-23T00:00:00Z',
  },
];

const sampleCategories: Category[] = [
  {
    id: 'c1111111-1111-4111-8111-111111111111',
    name: 'Fasteners & Hardware',
    code: 'CAT-FASTENERS',
    createdAt: '2026-10-23T00:00:00Z',
    updatedAt: '2026-10-23T00:00:00Z',
  },
];

describe('ERP-1 Exact Duplicate Key Policy (AC1: Normalized Exact Keys)', () => {
  describe('SKU Normalization', () => {
    it('normalizes SKU by trimming leading/trailing whitespace and uppercasing', () => {
      expect(normalizeSku('  bolt-m8-std  ')).toBe('BOLT-M8-STD');
      expect(normalizeSku('sku-prod-001')).toBe('SKU-PROD-001');
      expect(normalizeSku('  LUB-ind-5L ')).toBe('LUB-IND-5L');
    });

    it('handles empty or non-string input safely', () => {
      expect(normalizeSku('')).toBe('');
      expect(normalizeSku(null as unknown as string)).toBe('');
      expect(normalizeSku(undefined as unknown as string)).toBe('');
    });
  });

  describe('Product Name and Category Code Normalization', () => {
    it('normalizes product name by trimming and lowercasing', () => {
      expect(normalizeProductName('  Standard Steel Bolt M8  ')).toBe('standard steel bolt m8');
      expect(normalizeProductName('')).toBe('');
    });

    it('normalizes category code by trimming and uppercasing', () => {
      expect(normalizeCategoryCode('  cat-fasteners  ')).toBe('CAT-FASTENERS');
      expect(normalizeCategoryCode('')).toBe('');
    });
  });

  describe('Key Extraction', () => {
    it('extracts normalized and raw keys from product records', () => {
      const keys = extractProductKeys({
        sku: '  bolt-m8-std  ',
        name: '  Standard Steel Bolt M8  ',
      });
      expect(keys.normalizedSku).toBe('BOLT-M8-STD');
      expect(keys.normalizedName).toBe('standard steel bolt m8');
      expect(keys.rawSku).toBe('  bolt-m8-std  ');
      expect(keys.rawName).toBe('  Standard Steel Bolt M8  ');
    });

    it('extracts normalized and raw keys from category records', () => {
      const keys = extractCategoryKeys({
        code: '  cat-fasteners  ',
        name: '  Fasteners & Hardware  ',
      });
      expect(keys.normalizedCode).toBe('CAT-FASTENERS');
      expect(keys.normalizedName).toBe('fasteners & hardware');
      expect(keys.rawCode).toBe('  cat-fasteners  ');
      expect(keys.rawName).toBe('  Fasteners & Hardware  ');
    });
  });
});

describe('ERP-1 Deterministic Matching (AC2: Flag Identical Keys as Candidates)', () => {
  it('flags incoming record with identical raw SKU as EXACT duplicate candidate', () => {
    const incoming = {
      sku: 'BOLT-M8-STD',
      name: 'Standard Steel Bolt M8 Alternate Supplier',
      unitOfMeasure: 'pcs',
      price: '0.42',
    };
    const result = classifyProductCandidate(incoming, sampleProducts);
    expect(result.classification).toBe('EXACT_DUPLICATE');
    expect(result.candidate).toBeDefined();
    expect(result.candidate?.match_kind).toBe('EXACT');
    expect(result.candidate?.confidence).toBe(1.0);
    expect(result.candidate?.matching_key).toBe('sku');
    expect(result.candidate?.matching_value).toBe('BOLT-M8-STD');
    expect(result.candidate?.status).toBe('PENDING_REVIEW');
  });

  it('flags incoming record with case/whitespace variations as NORMALIZED_EXACT duplicate candidate', () => {
    const incoming = {
      sku: '  bolt-m8-std  ',
      name: 'Standard Steel Bolt M8',
      unitOfMeasure: 'pcs',
      price: '0.45',
    };
    const result = classifyProductCandidate(incoming, sampleProducts);
    expect(result.classification).toBe('EXACT_DUPLICATE');
    expect(result.candidate).toBeDefined();
    expect(result.candidate?.match_kind).toBe('NORMALIZED_EXACT');
    expect(result.candidate?.confidence).toBe(1.0);
    expect(result.candidate?.matching_value).toBe('BOLT-M8-STD');
  });

  it('flags category candidate with identical normalized code as duplicate candidate', () => {
    const incoming = {
      code: 'cat-fasteners',
      name: 'Fasteners',
    };
    const result = classifyCategoryCandidate(incoming, sampleCategories);
    expect(result.classification).toBe('EXACT_DUPLICATE');
    expect(result.candidate).toBeDefined();
    expect(result.candidate?.match_kind).toBe('NORMALIZED_EXACT');
    expect(result.candidate?.matching_key).toBe('code');
    expect(result.candidate?.matching_value).toBe('CAT-FASTENERS');
  });

  it('returns UNIQUE when no matching keys exist in target database', () => {
    const incoming = {
      sku: 'NEW-WIDGET-001',
      name: 'Completely Unique Widget',
      unitOfMeasure: 'pcs',
      price: '19.99',
    };
    const result = classifyProductCandidate(incoming, sampleProducts);
    expect(result.classification).toBe('UNIQUE');
    expect(result.candidate).toBeUndefined();
  });
});

describe('ERP-1 Ambiguity Detection & Review Hold (AC3: No Fuzzy Auto-Merge)', () => {
  it('classifies multiple conflicting matches as AMBIGUOUS_CANDIDATE held for review', () => {
    const productsWithDuplicates: Product[] = [
      ...sampleProducts,
      {
        ...sampleProducts[0]!,
        id: 'a3333333-3333-4333-8333-333333333333',
        name: 'Another Duplicate Item',
      },
    ];

    const incoming = {
      sku: 'BOLT-M8-STD',
      name: 'Incoming Test Item',
    };

    const result = classifyProductCandidate(incoming, productsWithDuplicates);
    expect(result.classification).toBe('AMBIGUOUS_CANDIDATE');
    expect(result.candidate?.match_kind).toBe('AMBIGUOUS_MULTI_MATCH');
    expect(result.candidate?.status).toBe('PENDING_REVIEW');
  });

  it('strictly rejects automated merge sagas (FUZZY_AUTO_MERGE_FORBIDDEN)', () => {
    expect(() => {
      assertNoFuzzyAutoMerge({ isAutoMerge: true });
    }).toThrowError(/Automated target-side merge sagas are strictly forbidden in ClearShift V1/);
  });

  it('strictly rejects fuzzy or probabilistic match scoring (PROBABILISTIC_SCORING_FORBIDDEN)', () => {
    expect(() => {
      assertNoFuzzyAutoMerge({ confidence: 0.85 });
    }).toThrowError(/Fuzzy\/probabilistic match scoring \(confidence 0.85\) is prohibited in V1/);

    expect(() => {
      assertNoFuzzyAutoMerge({ confidence: 1.0 });
    }).not.toThrow();
  });
});

describe('ERP-1 Human Merge Decisions (AC4: Audited Decisions)', () => {
  it('validates that decision requires documented rationale with >= 5 characters', () => {
    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: 'a1111111-1111-4111-8111-111111111111',
        decision: 'REJECT',
        rationale: 'ok',
      });
    }).toThrowError(/review rationale of at least 5 characters is mandatory/);

    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: 'a1111111-1111-4111-8111-111111111111',
        decision: 'REJECT',
        rationale: 'Valid documented rejection reason',
      });
    }).not.toThrow();
  });

  it('enforces kept_id and merged_id presence and distinctness for MERGE decisions', () => {
    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: 'a1111111-1111-4111-8111-111111111111',
        decision: 'MERGE',
        rationale: 'Merge duplicate vendor into golden master',
      });
    }).toThrowError(/kept_id is required/);

    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: 'a1111111-1111-4111-8111-111111111111',
        decision: 'MERGE',
        kept_id: 'a1111111-1111-4111-8111-111111111111',
        rationale: 'Merge duplicate vendor into golden master',
      });
    }).toThrowError(/merged_id is required/);

    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: 'a1111111-1111-4111-8111-111111111111',
        decision: 'MERGE',
        kept_id: 'a1111111-1111-4111-8111-111111111111',
        merged_id: 'a1111111-1111-4111-8111-111111111111',
        rationale: 'Merge duplicate vendor into golden master',
      });
    }).toThrowError(/kept_id and merged_id must be distinct entities/);

    expect(() => {
      assertValidHumanMergeDecision({
        candidate_id: 'a1111111-1111-4111-8111-111111111111',
        decision: 'MERGE',
        kept_id: 'a1111111-1111-4111-8111-111111111111',
        merged_id: 'a2222222-2222-4222-8222-222222222222',
        rationale: 'Merge duplicate vendor into golden master',
      });
    }).not.toThrow();
  });
});
