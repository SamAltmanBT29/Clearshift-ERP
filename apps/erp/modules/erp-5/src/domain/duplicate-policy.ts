/**
 * ERP-5 HR — Exact Duplicate Key Policy
 *
 * Implements deterministic duplicate key matching for HR entities.
 *
 * @module erp5/domain/duplicate-policy
 */

import { randomUUID } from 'node:crypto';
import type {
  HrEmployee,
  HrDepartment,
} from '@clearshift/contracts';

export type DuplicateClassificationType = 'UNIQUE' | 'EXACT_DUPLICATE' | 'AMBIGUOUS_CANDIDATE';

export interface DuplicateCandidateRecord {
  readonly candidate_id: string;
  readonly entity: 'employee' | 'department';
  readonly match_kind: 'EXACT' | 'NORMALIZED_EXACT' | 'AMBIGUOUS_MULTI_MATCH';
  readonly status: 'PENDING_REVIEW' | 'MERGED' | 'REJECTED';
  readonly matching_key: string;
  readonly matching_value: string;
  readonly incoming_record: any;
  readonly existing_record: any;
  readonly confidence: number;
  readonly created_at: string;
}

export interface MatchOutcome {
  readonly classification: DuplicateClassificationType;
  readonly candidate?: DuplicateCandidateRecord;
}

/**
 * Classifies employee candidates based on employee_no.
 */
export function classifyEmployeeCandidate(
  incoming: any,
  existing: readonly HrEmployee[]
): MatchOutcome {
  const key = incoming.employee_no?.trim().toUpperCase();
  if (!key) return { classification: 'UNIQUE' };

  const matches = existing.filter(e => e.employee_no.trim().toUpperCase() === key);

  if (matches.length === 0) return { classification: 'UNIQUE' };
  if (matches.length > 1) {
    return {
      classification: 'AMBIGUOUS_CANDIDATE',
      candidate: {
        candidate_id: randomUUID(),
        entity: 'employee',
        match_kind: 'AMBIGUOUS_MULTI_MATCH',
        status: 'PENDING_REVIEW',
        matching_key: 'employee_no',
        matching_value: key,
        incoming_record: incoming,
        existing_record: matches[0],
        confidence: 1.0,
        created_at: new Date().toISOString(),
      }
    };
  }

  const matched = matches[0]!;
  return {
    classification: 'EXACT_DUPLICATE',
    candidate: {
      candidate_id: randomUUID(),
      entity: 'employee',
      match_kind: matched.employee_no === incoming.employee_no ? 'EXACT' : 'NORMALIZED_EXACT',
      status: 'PENDING_REVIEW',
      matching_key: 'employee_no',
      matching_value: key,
      incoming_record: incoming,
      existing_record: matched,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    }
  };
}

/**
 * Classifies department candidates based on code.
 */
export function classifyDepartmentCandidate(
  incoming: any,
  existing: readonly HrDepartment[]
): MatchOutcome {
  const key = incoming.code?.trim().toUpperCase();
  if (!key) return { classification: 'UNIQUE' };

  const matches = existing.filter(d => d.code.trim().toUpperCase() === key);

  if (matches.length === 0) return { classification: 'UNIQUE' };
  if (matches.length > 1) {
    return {
      classification: 'AMBIGUOUS_CANDIDATE',
      candidate: {
        candidate_id: randomUUID(),
        entity: 'department',
        match_kind: 'AMBIGUOUS_MULTI_MATCH',
        status: 'PENDING_REVIEW',
        matching_key: 'code',
        matching_value: key,
        incoming_record: incoming,
        existing_record: matches[0],
        confidence: 1.0,
        created_at: new Date().toISOString(),
      }
    };
  }

  const matched = matches[0]!;
  return {
    classification: 'EXACT_DUPLICATE',
    candidate: {
      candidate_id: randomUUID(),
      entity: 'department',
      match_kind: matched.code === incoming.code ? 'EXACT' : 'NORMALIZED_EXACT',
      status: 'PENDING_REVIEW',
      matching_key: 'code',
      matching_value: key,
      incoming_record: incoming,
      existing_record: matched,
      confidence: 1.0,
      created_at: new Date().toISOString(),
    }
  };
}
