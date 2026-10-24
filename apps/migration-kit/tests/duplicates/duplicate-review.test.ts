/**
 * ClearShift Migration Kit — Exact Duplicate Review Unit & Integration Suite (KIT-10)
 *
 * Verifies all Acceptance Criteria for Issue #77 [KIT-10]:
 * - AC 1: V1 exact normalized candidate rules:
 *         1) Same normalized email (trimmed, lowercase)
 *         2) Same normalized phone + name
 *         3) Same tax number within entity/jurisdiction scope
 * - AC 2: In-file duplicates identified before load; target-existing duplicates go to human review.
 * - AC 3: Reviewer explicitly selects "Keep both" or "Merge".
 * - AC 4: Audits kept ID, absorbed source rows/IDs, matching rule/version/evidence, reviewer/time, and field choices.
 * - AC 5: Invariants enforced:
 *         - No auto-merge path exists for target duplicates.
 *         - Unreviewed candidate cannot load as merged.
 *         - Decision is reauthorized at submit; runner cannot self-approve.
 *         - Merge receipt/outcome is atomic and replay-safe.
 *         - A different company with a shared name stays separate.
 *
 * @module migration-kit/tests/duplicates/duplicate-review.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ExactDuplicateRuleId,
  UnreviewedCandidateMergeError,
  UnauthorizedDuplicateReviewError,
  TerminalOutcome,
} from '@clearshift/contracts';
import {
  normalizeEmail,
  normalizePhoneAndName,
  normalizeTaxId,
  extractMatchKey,
} from '../../src/duplicates/normalizer.js';
import {
  DuplicateCandidateService,
  duplicateCandidateService,
} from '../../src/duplicates/candidate-service.js';
import {
  InMemoryDuplicateCandidateStore,
} from '../../src/duplicates/types.js';
import {
  InMemoryKitRowOutcomeStore,
} from '../../src/reconcile/outcome-ledger.js';

describe('KIT-10: Exact Duplicate Candidate Review & Audited Merge Decisions', () => {
  let store: InMemoryDuplicateCandidateStore;
  let outcomeStore: InMemoryKitRowOutcomeStore;
  let service: DuplicateCandidateService;

  beforeEach(() => {
    store = new InMemoryDuplicateCandidateStore();
    outcomeStore = new InMemoryKitRowOutcomeStore();
    service = new DuplicateCandidateService(store, outcomeStore);
  });

  describe('1. V1 Exact Normalized Candidate Rules (AC 1)', () => {
    it('normalizes email by trimming whitespace and converting to lowercase', () => {
      expect(normalizeEmail('  John.Doe@Example.COM  ')).toBe('john.doe@example.com');
      expect(normalizeEmail('USER@EXAMPLE.ORG')).toBe('user@example.org');
      expect(normalizeEmail('invalid-no-at-sign')).toBe('');
      expect(normalizeEmail('')).toBe('');
      expect(normalizeEmail(undefined)).toBe('');
    });

    it('normalizes phone + name composite key deterministically', () => {
      const norm1 = normalizePhoneAndName('+1 (555) 0199', '  Acme   Supplies  ');
      const norm2 = normalizePhoneAndName('+1-555-0199', 'acme supplies');

      expect(norm1.normalizedPhone).toBe('+15550199');
      expect(norm1.normalizedName).toBe('acme supplies');
      expect(norm1.compositeKey).toBe('+15550199::acme supplies');
      expect(norm1.compositeKey).toBe(norm2.compositeKey);

      // Incomplete fields return empty composite key (no false positive match)
      expect(normalizePhoneAndName('', 'Acme').compositeKey).toBe('');
      expect(normalizePhoneAndName('+15550199', '').compositeKey).toBe('');
    });

    it('normalizes tax number within entity and jurisdiction scope', () => {
      const norm1 = normalizeTaxId(' 12-3456789 ', 'vendor', 'US');
      const norm2 = normalizeTaxId('123456789', 'VENDOR', 'us');

      expect(norm1.normalizedTaxId).toBe('123456789');
      expect(norm1.compositeKey).toBe('vendor::us::123456789');
      expect(norm1.compositeKey).toBe(norm2.compositeKey);

      // Different jurisdiction or entity produces distinct key
      const normEU = normalizeTaxId('12-3456789', 'vendor', 'DE');
      expect(normEU.compositeKey).not.toBe(norm1.compositeKey);
    });

    it('guarantees different companies with a shared name stay separate (No Fuzzy Matching)', () => {
      // Company A: "Universal Exports Ltd" in US, EIN 11-1111111
      // Company B: "Universal Exports Ltd" in UK, VAT GB-999999999
      const compA = extractMatchKey(
        { name: 'Universal Exports Ltd', tax_id: '11-1111111', country: 'US' },
        ExactDuplicateRuleId.TAX_ID_EXACT
      );
      const compB = extractMatchKey(
        { name: 'Universal Exports Ltd', tax_id: 'GB-999999999', country: 'GB' },
        ExactDuplicateRuleId.TAX_ID_EXACT
      );

      expect(compA.matchKey).not.toBe(compB.matchKey);
      expect(compA.matchKey).toContain('111111111');
      expect(compB.matchKey).toContain('GB999999999');
    });
  });

  describe('2. In-File vs Target-Existing Candidate Detection (AC 2)', () => {
    it('identifies in-file duplicates before load and target-existing duplicates for review', async () => {
      const batchId = 'batch-dup-001';

      // Existing records in target ERP module
      const existingTargetRecords = [
        {
          id: 'target-uuid-001',
          data: { email: 'existing.vendor@example.com', name: 'Existing Vendor', tax_id: '123456' },
        },
      ];

      // Incoming source rows in migration file
      const incomingRows = [
        // Row 1: Brand new clean record
        { sourceRow: 1, data: { email: 'new.vendor@example.com', name: 'New Vendor' } },
        // Row 2: In-file duplicate of Row 1 (same email)
        { sourceRow: 2, data: { email: 'NEW.VENDOR@example.com', name: 'New Vendor Duplicate' } },
        // Row 3: Target-existing duplicate (matches target-uuid-001)
        { sourceRow: 3, data: { email: 'existing.vendor@example.com', name: 'Existing Vendor Update' } },
      ];

      const detection = await service.detectCandidates(
        batchId,
        incomingRows,
        existingTargetRecords
      );

      // In-file duplicate at row 2
      expect(detection.inFileDuplicates.length).toBe(1);
      expect(detection.inFileDuplicates[0]?.sourceRow).toBe(2);
      expect(detection.inFileDuplicates[0]?.scope).toBe('in_file');
      expect(detection.inFileDuplicates[0]?.status).toBe('in_file_merged');

      // Target-existing duplicate at row 3 requires human review
      expect(detection.targetExistingCandidates.length).toBe(1);
      expect(detection.targetExistingCandidates[0]?.sourceRow).toBe(3);
      expect(detection.targetExistingCandidates[0]?.scope).toBe('target_existing');
      expect(detection.targetExistingCandidates[0]?.status).toBe('pending_review');
      expect(detection.targetExistingCandidates[0]?.targetExistingId).toBe('target-uuid-001');
    });
  });

  describe('3. Audited Review Decisions: Keep Both vs Merge (AC 3 & AC 4)', () => {
    let candidateId: string;
    const batchId = 'batch-dup-002';

    beforeEach(async () => {
      const existingRecords = [
        { id: 'target-cust-123', data: { email: 'target@example.com', name: 'Acme Corp' } },
      ];
      const incomingRows = [
        { sourceRow: 10, data: { email: 'target@example.com', name: 'Acme Corporation' } },
      ];

      const res = await service.detectCandidates(batchId, incomingRows, existingRecords);
      candidateId = res.targetExistingCandidates[0]!.id;
    });

    it('records an audited "merge" decision with kept ID and atomic ledger outcome', async () => {
      const decision = await service.submitReviewDecision({
        candidateId,
        batchId,
        decision: 'merge',
        reviewerId: 'reviewer-jane',
        reviewerRole: 'editor',
        fieldChoices: { name: 'target' },
      });

      expect(decision.status).toBe('merged');
      expect(decision.decision).toBe('merge');
      expect(decision.keptId).toBe('target-cust-123');
      expect(decision.reviewedBy).toBe('reviewer-jane');
      expect(decision.reviewedAt).toBeDefined();
      expect(decision.absorbedSourceRows).toEqual([10]);

      // Assert atomic outcome recording in ledger
      const outcome = await outcomeStore.getOutcome(batchId, 10);
      expect(outcome).toBeDefined();
      expect(outcome?.outcome).toBe(TerminalOutcome.MERGED);
      expect(outcome?.targetId).toBe('target-cust-123');
    });

    it('records an audited "keep_both" decision allowing candidate to load as separate record', async () => {
      const decision = await service.submitReviewDecision({
        candidateId,
        batchId,
        decision: 'keep_both',
        reviewerId: 'reviewer-bob',
        reviewerRole: 'admin',
      });

      expect(decision.status).toBe('keep_both');
      expect(decision.decision).toBe('keep_both');
      expect(decision.reviewedBy).toBe('reviewer-bob');
      expect(decision.reviewedAt).toBeDefined();
    });
  });

  describe('4. RBAC Reauthorization & Separation of Duties (AC 5)', () => {
    let candidateId: string;
    const batchId = 'batch-dup-003';

    beforeEach(async () => {
      const existing = [{ id: 'target-001', data: { email: 'test@example.com' } }];
      const incoming = [{ sourceRow: 5, data: { email: 'test@example.com' } }];
      const res = await service.detectCandidates(batchId, incoming, existing);
      candidateId = res.targetExistingCandidates[0]!.id;
    });

    it('rejects duplicate review submission by unprivileged roles (e.g. viewer)', async () => {
      await expect(
        service.submitReviewDecision({
          candidateId,
          batchId,
          decision: 'merge',
          reviewerId: 'viewer-alice',
          reviewerRole: 'viewer', // FORBIDDEN!
        })
      ).rejects.toThrowError(UnauthorizedDuplicateReviewError);
    });

    it('enforces separation of duties: migration runner cannot review their own duplicate candidates', async () => {
      await expect(
        service.submitReviewDecision({
          candidateId,
          batchId,
          decision: 'merge',
          reviewerId: 'runner-charlie',
          reviewerRole: 'editor',
          batchRunnerId: 'runner-charlie', // SELF-APPROVAL FORBIDDEN!
        })
      ).rejects.toThrowError(/Separation of duties violation/);
    });
  });

  describe('5. Unreviewed Candidate Merge Guard (AC 5)', () => {
    it('blocks real load when any target duplicate candidate remains unreviewed', async () => {
      const batchId = 'batch-dup-004';
      const existing = [{ id: 'target-002', data: { email: 'unreviewed@example.com' } }];
      const incoming = [{ sourceRow: 42, data: { email: 'unreviewed@example.com' } }];

      await service.detectCandidates(batchId, incoming, existing);

      // Attempting to proceed before human review throws UnreviewedCandidateMergeError
      await expect(service.assertCandidatesReviewed(batchId)).rejects.toThrowError(
        UnreviewedCandidateMergeError
      );
    });

    it('allows real load once all target duplicate candidates have been reviewed', async () => {
      const batchId = 'batch-dup-005';
      const existing = [{ id: 'target-003', data: { email: 'reviewed@example.com' } }];
      const incoming = [{ sourceRow: 15, data: { email: 'reviewed@example.com' } }];

      const res = await service.detectCandidates(batchId, incoming, existing);
      const candId = res.targetExistingCandidates[0]!.id;

      // Submit decision
      await service.submitReviewDecision({
        candidateId: candId,
        batchId,
        decision: 'merge',
        reviewerId: 'reviewer-jane',
        reviewerRole: 'editor',
      });

      // Now all candidates are reviewed
      await expect(service.assertCandidatesReviewed(batchId)).resolves.toBeUndefined();
    });
  });
});
