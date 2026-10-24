/**
 * ERP-3 Sales Orders & Invoices — Exact Duplicate Key Policy & Human Review Domain
 *
 * Implements deterministic duplicate key matching and review invariants (ERP3-12 / KIT-10 / Issue #148):
 *   1. Key Normalization: Pure functions for trimming, case-folding, and delimiter stripping.
 *   2. Deterministic Matching: Exact boolean key equality (confidence 1.0); fuzzy/heuristic matching strictly out of scope.
 *   3. Ambiguity Classification: Conflicting candidate keys are flagged as AMBIGUOUS and held for human review.
 *   4. Prohibition of Fuzzy Auto-Merge: Guard forbidding automated merge sagas without explicit human authorization.
 *   5. Human Review Decision Rules: Validation of operator merge decisions and audit payloads.
 *
 * Side-effect free: no I/O, no database connection, no network calls.
 *
 * @module erp3/domain/duplicate-policy
 */

import { randomUUID } from 'node:crypto';
import {
  normalizeOrderNumber,
  normalizeInvoiceNumber,
  type Erp3DuplicateCandidateRecord,
  type Erp3DuplicateMatchKind,
  type Erp3MergeDecisionType,
  type Erp3ReviewDuplicateRequest,
  type SalesOrder,
  type Invoice,
  type Payment,
} from '@clearshift/contracts';
import { Erp3DomainError, ERP3_DOMAIN_ERROR_CODES } from './rules.js';

export { normalizeOrderNumber, normalizeInvoiceNumber };

// ─────────────────────────────────────────────────────────────────────────────
// Normalization Primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes payment reference strings for exact matching (uppercase, trimmed, delimiters stripped).
 */
export function normalizePaymentReference(ref: string): string {
  if (typeof ref !== 'string') return '';
  return ref.trim().toUpperCase().replace(/[\s\-_/]/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Key Extraction
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizedOrderKeys {
  readonly normalizedOrderNumber: string;
  readonly rawOrderNumber: string;
}

export interface NormalizedInvoiceKeys {
  readonly normalizedInvoiceNumber: string;
  readonly rawInvoiceNumber: string;
}

export interface NormalizedPaymentKeys {
  readonly normalizedReference: string;
  readonly rawReference: string;
  readonly invoiceId: string;
}

export function extractOrderKeys(
  record: Partial<SalesOrder> | Record<string, unknown>
): NormalizedOrderKeys {
  const rawOrderNumber = typeof record['order_number'] === 'string' ? record['order_number'] : '';
  return {
    normalizedOrderNumber: normalizeOrderNumber(rawOrderNumber),
    rawOrderNumber,
  };
}

export function extractInvoiceKeys(
  record: Partial<Invoice> | Record<string, unknown>
): NormalizedInvoiceKeys {
  const rawInvoiceNumber = typeof record['invoice_number'] === 'string' ? record['invoice_number'] : '';
  return {
    normalizedInvoiceNumber: normalizeInvoiceNumber(rawInvoiceNumber),
    rawInvoiceNumber,
  };
}

export function extractPaymentKeys(
  record: Partial<Payment> | Record<string, unknown>
): NormalizedPaymentKeys {
  const rawReference = typeof record['reference'] === 'string' ? record['reference'] : '';
  const invoiceId = typeof record['invoice_id'] === 'string' ? record['invoice_id'] : '';
  return {
    normalizedReference: normalizePaymentReference(rawReference),
    rawReference,
    invoiceId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification Results
// ─────────────────────────────────────────────────────────────────────────────

export type Erp3DuplicateClassificationType = 'UNIQUE' | 'EXACT_DUPLICATE' | 'AMBIGUOUS_CANDIDATE';

export interface Erp3MatchOutcome {
  readonly classification: Erp3DuplicateClassificationType;
  readonly candidate?: Erp3DuplicateCandidateRecord | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Matching Classifiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies an incoming sales order candidate against existing orders deterministically.
 */
export function classifySalesOrderCandidate(
  incoming: Record<string, unknown>,
  existingOrders: readonly (Partial<SalesOrder> | Record<string, unknown>)[]
): Erp3MatchOutcome {
  const incomingKeys = extractOrderKeys(incoming);

  if (!incomingKeys.normalizedOrderNumber) {
    return { classification: 'UNIQUE' };
  }

  const matches = existingOrders.filter((order) => {
    const raw = typeof order['order_number'] === 'string' ? order['order_number'] : '';
    return normalizeOrderNumber(raw) === incomingKeys.normalizedOrderNumber;
  });

  if (matches.length > 1) {
    const candidate: Erp3DuplicateCandidateRecord = {
      candidate_id: randomUUID(),
      entity: 'sales_order',
      match_kind: 'AMBIGUOUS',
      status: 'PENDING_REVIEW',
      matching_key: 'order_number',
      matching_value: incomingKeys.rawOrderNumber,
      incoming_record: incoming,
      existing_record: matches[0]! as Record<string, unknown>,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    };
    return { classification: 'AMBIGUOUS_CANDIDATE', candidate };
  }

  if (matches.length === 1) {
    const target = matches[0]!;
    // If incoming customer_golden_id is specified and differs from target -> ambiguous collision
    const incomingCid = incoming['customer_golden_id'];
    const targetCid = target['customer_golden_id'];
    if (incomingCid && targetCid && incomingCid !== targetCid) {
      const candidate: Erp3DuplicateCandidateRecord = {
        candidate_id: randomUUID(),
        entity: 'sales_order',
        match_kind: 'AMBIGUOUS',
        status: 'PENDING_REVIEW',
        matching_key: 'order_number',
        matching_value: incomingKeys.rawOrderNumber,
        incoming_record: incoming,
        existing_record: target as Record<string, unknown>,
        confidence: 1.0,
        created_at: new Date().toISOString(),
      };
      return { classification: 'AMBIGUOUS_CANDIDATE', candidate };
    }

    const candidate: Erp3DuplicateCandidateRecord = {
      candidate_id: randomUUID(),
      entity: 'sales_order',
      match_kind: 'EXACT_ORDER_NUMBER',
      status: 'PENDING_REVIEW',
      matching_key: 'order_number',
      matching_value: incomingKeys.rawOrderNumber,
      incoming_record: incoming,
      existing_record: target as Record<string, unknown>,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    };
    return { classification: 'EXACT_DUPLICATE', candidate };
  }

  return { classification: 'UNIQUE' };
}

/**
 * Classifies an incoming invoice candidate against existing invoices deterministically.
 */
export function classifyInvoiceCandidate(
  incoming: Record<string, unknown>,
  existingInvoices: readonly (Partial<Invoice> | Record<string, unknown>)[]
): Erp3MatchOutcome {
  const incomingKeys = extractInvoiceKeys(incoming);

  if (!incomingKeys.normalizedInvoiceNumber) {
    return { classification: 'UNIQUE' };
  }

  const matches = existingInvoices.filter((inv) => {
    const raw = typeof inv['invoice_number'] === 'string' ? inv['invoice_number'] : '';
    return normalizeInvoiceNumber(raw) === incomingKeys.normalizedInvoiceNumber;
  });

  if (matches.length > 1) {
    const candidate: Erp3DuplicateCandidateRecord = {
      candidate_id: randomUUID(),
      entity: 'invoice',
      match_kind: 'AMBIGUOUS',
      status: 'PENDING_REVIEW',
      matching_key: 'invoice_number',
      matching_value: incomingKeys.rawInvoiceNumber,
      incoming_record: incoming,
      existing_record: matches[0]! as Record<string, unknown>,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    };
    return { classification: 'AMBIGUOUS_CANDIDATE', candidate };
  }

  if (matches.length === 1) {
    const candidate: Erp3DuplicateCandidateRecord = {
      candidate_id: randomUUID(),
      entity: 'invoice',
      match_kind: 'EXACT_INVOICE_NUMBER',
      status: 'PENDING_REVIEW',
      matching_key: 'invoice_number',
      matching_value: incomingKeys.rawInvoiceNumber,
      incoming_record: incoming,
      existing_record: matches[0]! as Record<string, unknown>,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    };
    return { classification: 'EXACT_DUPLICATE', candidate };
  }

  return { classification: 'UNIQUE' };
}

/**
 * Classifies an incoming payment candidate against existing payments deterministically.
 */
export function classifyPaymentCandidate(
  incoming: Record<string, unknown>,
  existingPayments: readonly (Partial<Payment> | Record<string, unknown>)[]
): Erp3MatchOutcome {
  const incomingKeys = extractPaymentKeys(incoming);

  if (!incomingKeys.normalizedReference || !incomingKeys.invoiceId) {
    return { classification: 'UNIQUE' };
  }

  const matches = existingPayments.filter((pmt) => {
    const rawRef = typeof pmt['reference'] === 'string' ? pmt['reference'] : '';
    const invId = typeof pmt['invoice_id'] === 'string' ? pmt['invoice_id'] : '';
    return (
      invId === incomingKeys.invoiceId &&
      normalizePaymentReference(rawRef) === incomingKeys.normalizedReference
    );
  });

  if (matches.length > 0) {
    const candidate: Erp3DuplicateCandidateRecord = {
      candidate_id: randomUUID(),
      entity: 'payment',
      match_kind: 'EXACT_PAYMENT_REFERENCE',
      status: 'PENDING_REVIEW',
      matching_key: 'reference',
      matching_value: incomingKeys.rawReference,
      incoming_record: incoming,
      existing_record: matches[0]! as Record<string, unknown>,
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
    throw new Erp3DomainError(
      'FUZZY_AUTO_MERGE_PROHIBITED',
      'Fuzzy duplicate matching scoring is strictly out of scope for ClearShift V1. Only deterministic exact key matching is supported.',
      'confidence',
      { confidence: options.confidence }
    );
  }

  if (options.isAutoMerge === true) {
    throw new Erp3DomainError(
      'FUZZY_AUTO_MERGE_PROHIBITED',
      'Automatic target-side duplicate merging is strictly prohibited in V1. Duplicate resolution requires an authorized human decision.',
      'isAutoMerge'
    );
  }
}

/**
 * Validates a human merge decision payload before execution and audit logging.
 */
export function assertValidHumanMergeDecision(
  request: Erp3ReviewDuplicateRequest
): void {
  if (!['MERGE', 'REJECT', 'KEEP_BOTH'].includes(request.decision)) {
    throw new Erp3DomainError(
      'INVALID_MERGE_DECISION',
      `Invalid merge decision '${request.decision}'. Allowed decisions are MERGE, REJECT, KEEP_BOTH.`,
      'decision',
      { decision: request.decision }
    );
  }

  if (request.decision === 'MERGE') {
    if (!request.kept_id) {
      throw new Erp3DomainError(
        'INVALID_MERGE_DECISION',
        "Decision 'MERGE' requires a valid 'kept_id' indicating the target record to retain.",
        'kept_id'
      );
    }
    if (!request.merged_id) {
      throw new Erp3DomainError(
        'INVALID_MERGE_DECISION',
        "Decision 'MERGE' requires a valid 'merged_id' indicating the candidate record being absorbed.",
        'merged_id'
      );
    }
    if (request.kept_id === request.merged_id) {
      throw new Erp3DomainError(
        'MERGE_TARGET_IDENTICAL',
        'Cannot merge a record into itself. kept_id and merged_id must be distinct UUIDs.',
        'kept_id',
        { kept_id: request.kept_id, merged_id: request.merged_id }
      );
    }
  }

  if (typeof request.rationale !== 'string' || request.rationale.trim().length < 5) {
    throw new Erp3DomainError(
      'INVALID_MERGE_DECISION',
      'A documented human review rationale of at least 5 characters is required.',
      'rationale'
    );
  }
}
