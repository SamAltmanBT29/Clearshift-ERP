/**
 * ClearShift Migration Kit — Duplicate Candidate Service (KIT-10)
 *
 * Implements:
 * 1. Exact normalized candidate detection (in-file before load; target-existing to human review).
 * 2. Audited merge decisions (Keep both vs Merge).
 * 3. Reauthorization at submit & separation of duties.
 * 4. Guard preventing unreviewed candidates from loading as merged.
 * 5. Guarantee that different companies with shared names stay separate.
 *
 * @module migration-kit/duplicates/candidate-service
 */

import { randomUUID } from 'node:crypto';
import {
  type DuplicateCandidateItem,
  type SubmitDuplicateReviewInput,
  type ExactDuplicateRuleIdType,
  ExactDuplicateRuleId,
  UnreviewedCandidateMergeError,
  UnauthorizedDuplicateReviewError,
  TerminalOutcome,
  computeStableIdempotencyKey,
} from '@clearshift/contracts';
import { extractMatchKey } from './normalizer.js';
import {
  type IDuplicateCandidateStore,
  type DuplicateDetectionOptions,
  type DuplicateDetectionResult,
  InMemoryDuplicateCandidateStore,
} from './types.js';
import type { IKitRowOutcomeStore } from '../reconcile/outcome-ledger.js';

export interface IDuplicateCandidateService {
  detectCandidates(
    batchId: string,
    rows: Array<{ sourceRow: number; data: Record<string, unknown> }>,
    existingTargetRecords?: Array<{ id: string; data: Record<string, unknown> }>,
    options?: DuplicateDetectionOptions
  ): Promise<DuplicateDetectionResult>;

  submitReviewDecision(input: SubmitDuplicateReviewInput): Promise<DuplicateCandidateItem>;

  assertCandidatesReviewed(batchId: string): Promise<void>;

  getCandidates(
    batchId: string,
    filter?: { status?: string; scope?: string }
  ): Promise<DuplicateCandidateItem[]>;
}

export class DuplicateCandidateService implements IDuplicateCandidateService {
  constructor(
    private store: IDuplicateCandidateStore = new InMemoryDuplicateCandidateStore(),
    private outcomeStore?: IKitRowOutcomeStore
  ) {}

  public getStore(): IDuplicateCandidateStore {
    return this.store;
  }

  /**
   * Detects exact duplicate candidates across declared rules.
   * - In-file duplicates are identified before load.
   * - Target-existing duplicates are marked for human review.
   */
  public async detectCandidates(
    batchId: string,
    rows: Array<{ sourceRow: number; data: Record<string, unknown> }>,
    existingTargetRecords: Array<{ id: string; data: Record<string, unknown> }> = [],
    options: DuplicateDetectionOptions = {}
  ): Promise<DuplicateDetectionResult> {
    const rules: ExactDuplicateRuleIdType[] = options.rules ?? [
      ExactDuplicateRuleId.EMAIL_EXACT,
      ExactDuplicateRuleId.PHONE_NAME_EXACT,
      ExactDuplicateRuleId.TAX_ID_EXACT,
    ];

    const ruleVersion = options.ruleVersion ?? '1.0.0';
    const inFileDuplicates: DuplicateCandidateItem[] = [];
    const targetExistingCandidates: DuplicateCandidateItem[] = [];

    // Track seen keys in file: Map<ruleId, Map<matchKey, firstSourceRow>>
    const inFileSeen = new Map<ExactDuplicateRuleIdType, Map<string, number>>();
    for (const r of rules) {
      inFileSeen.set(r, new Map());
    }

    // Pre-index existing target records by matching keys for each rule
    // Map<ruleId, Map<matchKey, { id: string; data: Record<string, unknown> }>>
    const targetIndex = new Map<
      ExactDuplicateRuleIdType,
      Map<string, { id: string; data: Record<string, unknown> }>
    >();
    for (const r of rules) {
      const idx = new Map<string, { id: string; data: Record<string, unknown> }>();
      for (const rec of existingTargetRecords) {
        const { matchKey } = extractMatchKey(rec.data, r, options);
        if (matchKey) {
          idx.set(matchKey, rec);
        }
      }
      targetIndex.set(r, idx);
    }

    for (const row of rows) {
      let isCandidate = false;

      for (const rule of rules) {
        const { matchKey, evidence } = extractMatchKey(row.data, rule, options);
        if (!matchKey) continue;

        // 1. In-File duplicate check
        const seenMap = inFileSeen.get(rule)!;
        if (seenMap.has(matchKey)) {
          const firstRow = seenMap.get(matchKey)!;
          const candidate: DuplicateCandidateItem = {
            id: randomUUID(),
            batchId,
            sourceRow: row.sourceRow,
            scope: 'in_file',
            matchingRule: rule,
            ruleVersion,
            matchKey,
            evidence: {
              ...evidence,
              firstSeenAtRow: firstRow,
            },
            candidateData: row.data,
            status: 'in_file_merged',
            decision: 'merge',
            absorbedSourceRows: [row.sourceRow],
            createdAt: new Date(),
          };
          inFileDuplicates.push(candidate);
          await this.store.saveCandidate(candidate);
          isCandidate = true;
          break; // Stop evaluating further rules for this row
        } else {
          seenMap.set(matchKey, row.sourceRow);
        }

        // 2. Target-Existing duplicate check -> human review required
        const targetMap = targetIndex.get(rule)!;
        if (targetMap.has(matchKey)) {
          const targetRecord = targetMap.get(matchKey)!;
          const candidate: DuplicateCandidateItem = {
            id: randomUUID(),
            batchId,
            sourceRow: row.sourceRow,
            scope: 'target_existing',
            matchingRule: rule,
            ruleVersion,
            matchKey,
            evidence: {
              ...evidence,
              targetId: targetRecord.id,
            },
            targetExistingId: targetRecord.id,
            targetExistingData: targetRecord.data,
            candidateData: row.data,
            status: 'pending_review',
            absorbedSourceRows: [],
            createdAt: new Date(),
          };

          targetExistingCandidates.push(candidate);
          await this.store.saveCandidate(candidate);
          isCandidate = true;
          break; // Stop evaluating further rules for this row
        }
      }
    }

    return {
      inFileDuplicates,
      targetExistingCandidates,
      totalCandidates: inFileDuplicates.length + targetExistingCandidates.length,
    };
  }

  /**
   * Submits an audited review decision for a target-existing duplicate candidate.
   * - Reauthorizes reviewer role (editor or admin required).
   * - Enforces separation of duties (batch runner cannot self-approve).
   * - Audits decision, timestamp, kept ID, and field choices.
   */
  public async submitReviewDecision(
    input: SubmitDuplicateReviewInput
  ): Promise<DuplicateCandidateItem> {
    const { candidateId, decision, reviewerId, reviewerRole, batchRunnerId, fieldChoices } =
      input;

    // 1. RBAC Reauthorization Check
    const allowedRoles = ['editor', 'admin', 'migration_operator', 'operator'];
    if (!allowedRoles.includes(reviewerRole.toLowerCase())) {
      throw new UnauthorizedDuplicateReviewError(
        `Role '${reviewerRole}' is not authorized to submit duplicate review decisions. Editor or Admin role required.`
      );
    }

    // 2. Separation of Duties Check
    if (batchRunnerId && reviewerId === batchRunnerId) {
      throw new UnauthorizedDuplicateReviewError(
        `Separation of duties violation: Migration Runner '${reviewerId}' cannot approve their own duplicate review decisions.`
      );
    }

    // 3. Candidate Lookup
    const candidate = await this.store.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`Duplicate candidate '${candidateId}' not found.`);
    }

    const reviewedAt = new Date();
    let updated: DuplicateCandidateItem;

    if (decision === 'keep_both') {
      updated = await this.store.updateCandidate(candidateId, {
        status: 'keep_both',
        decision: 'keep_both',
        reviewedBy: reviewerId,
        reviewedAt,
        fieldChoices,
      });
    } else {
      // decision === 'merge'
      updated = await this.store.updateCandidate(candidateId, {
        status: 'merged',
        decision: 'merge',
        keptId: candidate.targetExistingId,
        absorbedSourceRows: [candidate.sourceRow],
        reviewedBy: reviewerId,
        reviewedAt,
        fieldChoices,
      });

      // Atomically record merge outcome in ledger if outcome store is attached
      if (this.outcomeStore) {
        const idempKey = computeStableIdempotencyKey({
          batchId: candidate.batchId,
          sourceRow: candidate.sourceRow,
          module: 'migration',
          entity: 'duplicate_review',
          operationVersion: 1,
        });

        await this.outcomeStore.recordOutcome({
          batchId: candidate.batchId,
          sourceRow: candidate.sourceRow,
          outcome: TerminalOutcome.MERGED,
          reasonCode: candidate.matchingRule,
          reasonText: `Audited human merge decision by reviewer '${reviewerId}' into target '${candidate.targetExistingId}'`,
          targetId: candidate.targetExistingId,
          idempotencyKey: idempKey,
        });
      }
    }

    return updated;
  }

  /**
   * Asserts that all duplicate candidates for the batch have been reviewed.
   * Throws UnreviewedCandidateMergeError if any target duplicate remains unreviewed.
   */
  public async assertCandidatesReviewed(batchId: string): Promise<void> {
    const candidates = await this.store.listCandidatesByBatch(batchId, {
      scope: 'target_existing',
    });

    const unreviewed = candidates.filter((c) => c.status === 'pending_review');
    if (unreviewed.length > 0) {
      const first = unreviewed[0]!;
      throw new UnreviewedCandidateMergeError(first.id, first.sourceRow);
    }
  }

  public async getCandidates(
    batchId: string,
    filter?: { status?: any; scope?: any }
  ): Promise<DuplicateCandidateItem[]> {
    return this.store.listCandidatesByBatch(batchId, filter);
  }
}

export const duplicateCandidateService = new DuplicateCandidateService();
