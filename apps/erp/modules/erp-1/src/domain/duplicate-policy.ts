/**
 * ERP-1 Products & Inventory — Exact Duplicate Key Policy & Human Review Domain
 *
 * Implements deterministic duplicate key matching and review invariants (ERP1-12 / KIT-10 / Issue #108):
 *   1. Key Normalization: Pure functions for trimming, case-folding, and separator stripping.
 *   2. Deterministic Matching: Exact boolean key equality (confidence 1.0); fuzzy/heuristic matching strictly out of scope.
 *   3. Ambiguity Classification: Conflicting candidate keys are flagged as AMBIGUOUS and held for human review.
 *   4. Prohibition of Fuzzy Auto-Merge: Guard forbidding automated merge sagas without explicit human authorization.
 *   5. Human Review Decision Rules: Validation of operator merge decisions and audit payloads.
 *
 * Side-effect free: no I/O, no database connection, no network calls.
 *
 * @module erp1/domain/duplicate-policy
 */

import { randomUUID } from 'node:crypto';
import {
  ERP1_DOMAIN_RULES,
  normalizeSku,
  type Erp1DuplicateCandidateRecord as DuplicateCandidateRecord,
  type Erp1DuplicateMatchKind as DuplicateMatchKind,
  type Erp1MergeDecisionType as MergeDecisionType,
  type ReviewErp1DuplicateRequest as ReviewDuplicateRequest,
  type Product,
  type Category,
} from '@clearshift/contracts';
import { Erp1DomainError } from './rules.js';

export type { DuplicateCandidateRecord, DuplicateMatchKind, MergeDecisionType, ReviewDuplicateRequest };

// ─────────────────────────────────────────────────────────────────────────────
// Normalization Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a product name: trims whitespace and lowercases.
 */
export function normalizeProductName(name: string): string {
  if (!name || typeof name !== 'string') return '';
  return name.trim().toLowerCase();
}

/**
 * Normalizes a category code: trims whitespace and uppercases.
 */
export function normalizeCategoryCode(code: string): string {
  if (!code || typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Key Extraction
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizedProductKeys {
  readonly normalizedSku: string;
  readonly normalizedName: string;
  readonly rawSku: string;
  readonly rawName: string;
}

export interface NormalizedCategoryKeys {
  readonly normalizedCode: string;
  readonly normalizedName: string;
  readonly rawCode: string;
  readonly rawName: string;
}

export function extractProductKeys(
  record: Partial<Product> | Record<string, unknown>
): NormalizedProductKeys {
  const rawSku = typeof record['sku'] === 'string' ? record['sku'] : '';
  const rawName = typeof record['name'] === 'string' ? record['name'] : '';

  return {
    normalizedSku: normalizeSku(rawSku),
    normalizedName: normalizeProductName(rawName),
    rawSku,
    rawName,
  };
}

export function extractCategoryKeys(
  record: Partial<Category> | Record<string, unknown>
): NormalizedCategoryKeys {
  const rawCode = typeof record['code'] === 'string' ? record['code'] : '';
  const rawName = typeof record['name'] === 'string' ? record['name'] : '';

  return {
    normalizedCode: normalizeCategoryCode(rawCode),
    normalizedName: normalizeProductName(rawName),
    rawCode,
    rawName,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification Result
// ─────────────────────────────────────────────────────────────────────────────

export type DuplicateClassificationType = 'UNIQUE' | 'EXACT_DUPLICATE' | 'AMBIGUOUS_CANDIDATE';

export interface ProductMatchOutcome {
  readonly classification: DuplicateClassificationType;
  readonly candidate?: DuplicateCandidateRecord | undefined;
}

export interface CategoryMatchOutcome {
  readonly classification: DuplicateClassificationType;
  readonly candidate?: DuplicateCandidateRecord | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Matching Classifier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies an incoming product candidate against existing target products deterministically.
 *
 * Rules:
 *   - Matches strictly on exact normalized SKU equality.
 *   - Confidence is always 1.0 (exact key match).
 *   - If normalized SKU matches multiple products (unlikely due to uniqueness constraint), outcome is AMBIGUOUS_CANDIDATE.
 *   - If normalized SKU matches exactly one product, outcome is EXACT_DUPLICATE.
 *   - If no keys match, outcome is UNIQUE.
 */
export function classifyProductCandidate(
  incoming: Record<string, unknown>,
  existingProducts: readonly Product[]
): ProductMatchOutcome {
  const incomingKeys = extractProductKeys(incoming);

  if (!incomingKeys.normalizedSku) {
    return { classification: 'UNIQUE' };
  }

  const skuMatches = existingProducts.filter((p) => {
    const existingSku = p.normalizedSku || normalizeSku(p.sku);
    return existingSku === incomingKeys.normalizedSku;
  });

  if (skuMatches.length === 0) {
    return { classification: 'UNIQUE' };
  }

  if (skuMatches.length > 1) {
    const candidate: DuplicateCandidateRecord = {
      candidate_id: randomUUID(),
      entity: 'product' as any,
      match_kind: 'AMBIGUOUS_MULTI_MATCH',
      status: 'PENDING_REVIEW',
      matching_key: 'sku',
      matching_value: incomingKeys.normalizedSku,
      incoming_record: incoming,
      existing_record: skuMatches[0] as unknown as Record<string, unknown>,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    };
    return { classification: 'AMBIGUOUS_CANDIDATE', candidate };
  }

  const matchedProduct = skuMatches[0]!;
  const isExactRaw = matchedProduct.sku === incomingKeys.rawSku;
  const matchKind: DuplicateMatchKind = isExactRaw ? 'EXACT' : 'NORMALIZED_EXACT';

  const candidate: DuplicateCandidateRecord = {
    candidate_id: randomUUID(),
    entity: 'product' as any,
    match_kind: matchKind,
    status: 'PENDING_REVIEW',
    matching_key: 'sku',
    matching_value: incomingKeys.normalizedSku,
    incoming_record: incoming,
    existing_record: matchedProduct as unknown as Record<string, unknown>,
    confidence: 1.0,
    created_at: new Date().toISOString(),
  };

  return { classification: 'EXACT_DUPLICATE', candidate };
}

/**
 * Classifies an incoming category candidate against existing target categories deterministically.
 */
export function classifyCategoryCandidate(
  incoming: Record<string, unknown>,
  existingCategories: readonly Category[]
): CategoryMatchOutcome {
  const incomingKeys = extractCategoryKeys(incoming);

  if (!incomingKeys.normalizedCode) {
    return { classification: 'UNIQUE' };
  }

  const codeMatches = existingCategories.filter(
    (c) => normalizeCategoryCode(c.code) === incomingKeys.normalizedCode
  );

  if (codeMatches.length === 0) {
    return { classification: 'UNIQUE' };
  }

  if (codeMatches.length > 1) {
    const candidate: DuplicateCandidateRecord = {
      candidate_id: randomUUID(),
      entity: 'category' as any,
      match_kind: 'AMBIGUOUS_MULTI_MATCH',
      status: 'PENDING_REVIEW',
      matching_key: 'code',
      matching_value: incomingKeys.normalizedCode,
      incoming_record: incoming,
      existing_record: codeMatches[0] as unknown as Record<string, unknown>,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    };
    return { classification: 'AMBIGUOUS_CANDIDATE', candidate };
  }

  const matchedCategory = codeMatches[0]!;
  const isExactRaw = matchedCategory.code === incomingKeys.rawCode;
  const matchKind: DuplicateMatchKind = isExactRaw ? 'EXACT' : 'NORMALIZED_EXACT';

  const candidate: DuplicateCandidateRecord = {
    candidate_id: randomUUID(),
    entity: 'category' as any,
    match_kind: matchKind,
    status: 'PENDING_REVIEW',
    matching_key: 'code',
    matching_value: incomingKeys.normalizedCode,
    incoming_record: incoming,
    existing_record: matchedCategory as unknown as Record<string, unknown>,
    confidence: 1.0,
    created_at: new Date().toISOString(),
  };

  return { classification: 'EXACT_DUPLICATE', candidate };
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant & Review Guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guard: Enforces that probabilistic/fuzzy auto-merging is strictly rejected in V1.
 */
export function assertNoFuzzyAutoMerge(options: {
  isAutoMerge?: boolean | undefined;
  confidence?: number | undefined;
}): void {
  if (options.isAutoMerge) {
    throw new Erp1DomainError(
      'FUZZY_AUTO_MERGE_FORBIDDEN',
      'Automated target-side merge sagas are strictly forbidden in ClearShift V1. Human approval is required.',
      'merge_policy'
    );
  }

  if (options.confidence !== undefined && options.confidence < 1.0) {
    throw new Erp1DomainError(
      'PROBABILISTIC_SCORING_FORBIDDEN',
      `Fuzzy/probabilistic match scoring (confidence ${options.confidence}) is prohibited in V1. Only deterministic exact key matches (confidence 1.0) are supported.`,
      'confidence'
    );
  }
}

/**
 * Validates human review decision parameters.
 */
export function assertValidHumanMergeDecision(request: ReviewDuplicateRequest): void {
  if (!request.rationale || request.rationale.trim().length < 5) {
    throw new Erp1DomainError(
      'INVALID_REVIEW_RATIONALE',
      'A documented review rationale of at least 5 characters is mandatory for auditing.',
      'rationale'
    );
  }

  if (request.decision === 'MERGE') {
    if (!request.kept_id) {
      throw new Erp1DomainError(
        'MISSING_KEPT_ID',
        'kept_id is required when executing a MERGE decision.',
        'kept_id'
      );
    }
    if (!request.merged_id) {
      throw new Erp1DomainError(
        'MISSING_MERGED_ID',
        'merged_id is required when executing a MERGE decision.',
        'merged_id'
      );
    }
    if (request.kept_id === request.merged_id) {
      throw new Erp1DomainError(
        'IDENTICAL_MERGE_TARGETS',
        'kept_id and merged_id must be distinct entities.',
        'kept_id'
      );
    }
  }
}
