/**
 * ERP-2 Vendors & Purchasing — Exact Duplicate Key Policy & Human Review Domain
 *
 * Implements deterministic duplicate key matching and review invariants (ERP2-12 / KIT-10 / Issue #128):
 *   1. Key Normalization: Pure functions for trimming, case-folding, and separator stripping.
 *   2. Deterministic Matching: Exact boolean key equality (confidence 1.0); fuzzy/heuristic matching strictly out of scope.
 *   3. Ambiguity Classification: Conflicting candidate keys are flagged as AMBIGUOUS and held for human review.
 *   4. Prohibition of Fuzzy Auto-Merge: Guard forbidding automated merge sagas without explicit human authorization.
 *   5. Human Review Decision Rules: Validation of operator merge decisions and audit payloads.
 *
 * Side-effect free: no I/O, no database connection, no network calls.
 *
 * @module erp2/domain/duplicate-policy
 */

import { randomUUID } from 'node:crypto';
import {
  ERP2_DOMAIN_RULES,
  normalizeTaxNumber,
  normalizeEmail,
  normalizePoNumber,
  type DuplicateCandidateRecord,
  type DuplicateMatchKind,
  type MergeDecisionType,
  type ReviewDuplicateRequest,
  type Vendor,
  type PurchaseOrder,
} from '@clearshift/contracts';
import { Erp2DomainError } from './rules.js';

export { normalizeTaxNumber, normalizeEmail, normalizePoNumber };

// ─────────────────────────────────────────────────────────────────────────────
// Key Extraction
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizedVendorKeys {
  readonly normalizedTaxNumber: string;
  readonly normalizedEmail: string;
  readonly rawTaxNumber: string;
  readonly rawEmail: string;
}

export interface NormalizedPoKeys {
  readonly normalizedPoNumber: string;
  readonly rawPoNumber: string;
}

/**
 * Extracts normalized duplicate matching keys from a vendor payload.
 */
export function extractVendorKeys(
  record: Partial<Vendor> | Record<string, unknown>
): NormalizedVendorKeys {
  const rawTaxNumber = typeof record['tax_number'] === 'string' ? record['tax_number'] : '';
  const rawEmail = typeof record['email'] === 'string' ? record['email'] : '';

  return {
    normalizedTaxNumber: normalizeTaxNumber(rawTaxNumber),
    normalizedEmail: normalizeEmail(rawEmail),
    rawTaxNumber,
    rawEmail,
  };
}

/**
 * Extracts normalized duplicate matching keys from a purchase order payload.
 */
export function extractPoKeys(
  record: Partial<PurchaseOrder> | Record<string, unknown>
): NormalizedPoKeys {
  const rawPoNumber = typeof record['po_number'] === 'string' ? record['po_number'] : '';

  return {
    normalizedPoNumber: normalizePoNumber(rawPoNumber),
    rawPoNumber,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification Result
// ─────────────────────────────────────────────────────────────────────────────

export type DuplicateClassificationType = 'UNIQUE' | 'EXACT_DUPLICATE' | 'AMBIGUOUS_CANDIDATE';

export interface VendorMatchOutcome {
  readonly classification: DuplicateClassificationType;
  readonly candidate?: DuplicateCandidateRecord | undefined;
}

export interface PoMatchOutcome {
  readonly classification: DuplicateClassificationType;
  readonly candidate?: DuplicateCandidateRecord | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Matching Classifier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies an incoming vendor candidate against existing target vendors deterministically.
 *
 * Rules:
 *   - Matches strictly on exact normalized string equality.
 *   - If tax number matches Vendor A and email matches Vendor B (different entities),
 *     or if keys conflict, outcome is AMBIGUOUS_CANDIDATE (held for human review).
 *   - If tax number or email matches exactly one existing vendor, outcome is EXACT_DUPLICATE.
 *   - If no keys match, outcome is UNIQUE.
 */
export function classifyVendorCandidate(
  incoming: Record<string, unknown>,
  existingVendors: readonly Vendor[]
): VendorMatchOutcome {
  const incomingKeys = extractVendorKeys(incoming);

  if (!incomingKeys.normalizedTaxNumber && !incomingKeys.normalizedEmail) {
    return { classification: 'UNIQUE' };
  }

  const taxMatches = incomingKeys.normalizedTaxNumber
    ? existingVendors.filter(
        (v) => normalizeTaxNumber(v.tax_number) === incomingKeys.normalizedTaxNumber
      )
    : [];

  const emailMatches = incomingKeys.normalizedEmail
    ? existingVendors.filter(
        (v) => normalizeEmail(v.email) === incomingKeys.normalizedEmail
      )
    : [];

  // Check for ambiguous multi-target or cross-target matches
  const hasTaxMatch = taxMatches.length > 0;
  const hasEmailMatch = emailMatches.length > 0;

  if (hasTaxMatch && hasEmailMatch) {
    const taxTarget = taxMatches[0]!;
    const emailTarget = emailMatches[0]!;

    if (taxTarget.id !== emailTarget.id || taxMatches.length > 1 || emailMatches.length > 1) {
      // Conflicting entities match on different keys -> AMBIGUOUS
      const candidate: DuplicateCandidateRecord = {
        candidate_id: randomUUID(),
        entity: 'vendor',
        match_kind: 'AMBIGUOUS',
        status: 'PENDING_REVIEW',
        matching_key: 'tax_number,email',
        matching_value: `${incomingKeys.rawTaxNumber} / ${incomingKeys.rawEmail}`,
        incoming_record: incoming,
        existing_record: taxTarget as unknown as Record<string, unknown>,
        confidence: 1.0,
        created_at: new Date().toISOString(),
      };
      return { classification: 'AMBIGUOUS_CANDIDATE', candidate };
    }

    // Both match the same single existing vendor -> EXACT_DUPLICATE on tax number
    const candidate: DuplicateCandidateRecord = {
      candidate_id: randomUUID(),
      entity: 'vendor',
      match_kind: 'EXACT_TAX_NUMBER',
      status: 'PENDING_REVIEW',
      matching_key: 'tax_number',
      matching_value: incomingKeys.rawTaxNumber,
      incoming_record: incoming,
      existing_record: taxTarget as unknown as Record<string, unknown>,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    };
    return { classification: 'EXACT_DUPLICATE', candidate };
  }

  if (hasTaxMatch) {
    if (taxMatches.length > 1) {
      const candidate: DuplicateCandidateRecord = {
        candidate_id: randomUUID(),
        entity: 'vendor',
        match_kind: 'AMBIGUOUS',
        status: 'PENDING_REVIEW',
        matching_key: 'tax_number',
        matching_value: incomingKeys.rawTaxNumber,
        incoming_record: incoming,
        existing_record: taxMatches[0]! as unknown as Record<string, unknown>,
        confidence: 1.0,
        created_at: new Date().toISOString(),
      };
      return { classification: 'AMBIGUOUS_CANDIDATE', candidate };
    }

    const taxTarget = taxMatches[0]!;
    // If incoming has email and target has email, but they differ -> AMBIGUOUS
    if (
      incomingKeys.normalizedEmail &&
      taxTarget.email &&
      normalizeEmail(taxTarget.email) !== incomingKeys.normalizedEmail
    ) {
      const candidate: DuplicateCandidateRecord = {
        candidate_id: randomUUID(),
        entity: 'vendor',
        match_kind: 'AMBIGUOUS',
        status: 'PENDING_REVIEW',
        matching_key: 'tax_number',
        matching_value: incomingKeys.rawTaxNumber,
        incoming_record: incoming,
        existing_record: taxTarget as unknown as Record<string, unknown>,
        confidence: 1.0,
        created_at: new Date().toISOString(),
      };
      return { classification: 'AMBIGUOUS_CANDIDATE', candidate };
    }

    const candidate: DuplicateCandidateRecord = {
      candidate_id: randomUUID(),
      entity: 'vendor',
      match_kind: 'EXACT_TAX_NUMBER',
      status: 'PENDING_REVIEW',
      matching_key: 'tax_number',
      matching_value: incomingKeys.rawTaxNumber,
      incoming_record: incoming,
      existing_record: taxTarget as unknown as Record<string, unknown>,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    };
    return { classification: 'EXACT_DUPLICATE', candidate };
  }

  if (hasEmailMatch) {
    if (emailMatches.length > 1) {
      const candidate: DuplicateCandidateRecord = {
        candidate_id: randomUUID(),
        entity: 'vendor',
        match_kind: 'AMBIGUOUS',
        status: 'PENDING_REVIEW',
        matching_key: 'email',
        matching_value: incomingKeys.rawEmail,
        incoming_record: incoming,
        existing_record: emailMatches[0]! as unknown as Record<string, unknown>,
        confidence: 1.0,
        created_at: new Date().toISOString(),
      };
      return { classification: 'AMBIGUOUS_CANDIDATE', candidate };
    }

    const emailTarget = emailMatches[0]!;
    // If incoming has tax number and target has tax number, but they differ -> AMBIGUOUS
    if (
      incomingKeys.normalizedTaxNumber &&
      emailTarget.tax_number &&
      normalizeTaxNumber(emailTarget.tax_number) !== incomingKeys.normalizedTaxNumber
    ) {
      const candidate: DuplicateCandidateRecord = {
        candidate_id: randomUUID(),
        entity: 'vendor',
        match_kind: 'AMBIGUOUS',
        status: 'PENDING_REVIEW',
        matching_key: 'email',
        matching_value: incomingKeys.rawEmail,
        incoming_record: incoming,
        existing_record: emailTarget as unknown as Record<string, unknown>,
        confidence: 1.0,
        created_at: new Date().toISOString(),
      };
      return { classification: 'AMBIGUOUS_CANDIDATE', candidate };
    }

    const candidate: DuplicateCandidateRecord = {
      candidate_id: randomUUID(),
      entity: 'vendor',
      match_kind: 'EXACT_EMAIL',
      status: 'PENDING_REVIEW',
      matching_key: 'email',
      matching_value: incomingKeys.rawEmail,
      incoming_record: incoming,
      existing_record: emailTarget as unknown as Record<string, unknown>,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    };
    return { classification: 'EXACT_DUPLICATE', candidate };
  }

  return { classification: 'UNIQUE' };
}

/**
 * Classifies an incoming purchase order candidate against existing purchase orders deterministically.
 */
export function classifyPurchaseOrderCandidate(
  incoming: Record<string, unknown>,
  existingPurchaseOrders: readonly PurchaseOrder[]
): PoMatchOutcome {
  const incomingKeys = extractPoKeys(incoming);

  if (!incomingKeys.normalizedPoNumber) {
    return { classification: 'UNIQUE' };
  }

  const matches = existingPurchaseOrders.filter(
    (po) => normalizePoNumber(po.po_number) === incomingKeys.normalizedPoNumber
  );

  if (matches.length > 0) {
    const candidate: DuplicateCandidateRecord = {
      candidate_id: randomUUID(),
      entity: 'purchase_order',
      match_kind: 'EXACT_PO_NUMBER',
      status: 'PENDING_REVIEW',
      matching_key: 'po_number',
      matching_value: incomingKeys.rawPoNumber,
      incoming_record: incoming,
      existing_record: matches[0]! as unknown as Record<string, unknown>,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    };
    return { classification: 'EXACT_DUPLICATE', candidate };
  }

  return { classification: 'UNIQUE' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant Guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enforces the non-negotiable ClearShift V1 invariant:
 * No fuzzy matching and no automated merge sagas are permitted.
 * Any attempt to execute a merge without explicit human review or with
 * confidence < 1.0 is rejected.
 */
export function assertNoFuzzyAutoMerge(options: {
  readonly confidence?: number | undefined;
  readonly isAutoMerge?: boolean | undefined;
  readonly isFuzzy?: boolean | undefined;
}): void {
  if (options.isFuzzy === true || (typeof options.confidence === 'number' && options.confidence < 1.0)) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.FUZZY_AUTO_MERGE_PROHIBITED,
      'Fuzzy duplicate matching scoring is strictly out of scope for ClearShift V1. Only deterministic exact key matching is supported.',
      'confidence',
      { confidence: options.confidence }
    );
  }

  if (options.isAutoMerge === true) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.FUZZY_AUTO_MERGE_PROHIBITED,
      'Automatic target-side duplicate merging is strictly prohibited in V1. Duplicate resolution requires an authorized human decision.',
      'isAutoMerge'
    );
  }
}

/**
 * Validates a human merge decision payload before execution and audit logging.
 */
export function assertValidHumanMergeDecision(
  request: ReviewDuplicateRequest
): void {
  if (!['MERGE', 'REJECT', 'KEEP_BOTH'].includes(request.decision)) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.INVALID_MERGE_DECISION,
      `Invalid merge decision '${request.decision}'. Allowed decisions are MERGE, REJECT, KEEP_BOTH.`,
      'decision',
      { decision: request.decision }
    );
  }

  if (request.decision === 'MERGE') {
    if (!request.kept_id) {
      throw new Erp2DomainError(
        ERP2_DOMAIN_RULES.INVALID_MERGE_DECISION,
        "Decision 'MERGE' requires a valid 'kept_id' indicating the target record to retain.",
        'kept_id'
      );
    }
    if (!request.merged_id) {
      throw new Erp2DomainError(
        ERP2_DOMAIN_RULES.INVALID_MERGE_DECISION,
        "Decision 'MERGE' requires a valid 'merged_id' indicating the candidate record being absorbed.",
        'merged_id'
      );
    }
    if (request.kept_id === request.merged_id) {
      throw new Erp2DomainError(
        ERP2_DOMAIN_RULES.MERGE_TARGET_IDENTICAL,
        'Cannot merge a record into itself. kept_id and merged_id must be distinct UUIDs.',
        'kept_id',
        { kept_id: request.kept_id, merged_id: request.merged_id }
      );
    }
  }

  if (typeof request.rationale !== 'string' || request.rationale.trim().length < 5) {
    throw new Erp2DomainError(
      ERP2_DOMAIN_RULES.INVALID_MERGE_DECISION,
      'A documented human review rationale of at least 5 characters is required.',
      'rationale'
    );
  }
}
