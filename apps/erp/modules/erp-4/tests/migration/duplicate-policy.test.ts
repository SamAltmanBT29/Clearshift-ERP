/**
 * ERP-4 Exact Duplicate Key Policy Test Suite
 *
 * Dedicated test suite for Issue #168 [ERP4-12]:
 *   AC1. Module registers normalized exact keys (trimmed lowercase account code).
 *   AC2. Identical normalized keys are flagged deterministically as duplicate candidates.
 *   AC3. Uncertain or ambiguous candidates are held for authorized human review; no automatic fuzzy merging in V1.
 *   AC4. Audit log records human merge decisions with actor ID, timestamp, kept ID, and merged ID.
 *
 * @module erp4/tests/migration/duplicate-policy.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeAccountKey,
  normalizeJournalEntryKey,
  buildDuplicateCandidates,
  Erp4DuplicatePolicy,
  type SourceRow,
} from '../../src/migration/duplicate-policy.js';

describe('ERP4-12: Exact Duplicate Key Policy (#168)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // AC1: Normalized Exact Keys
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC1: Module registers normalized exact keys', () => {
    it('normalizeAccountKey trims leading and trailing whitespace', () => {
      expect(normalizeAccountKey('  1010-CASH  ')).toBe('1010-cash');
      expect(normalizeAccountKey('\t2000-AP\n')).toBe('2000-ap');
    });

    it('normalizeAccountKey lowercases the entire code', () => {
      expect(normalizeAccountKey('1010-BANK')).toBe('1010-bank');
      expect(normalizeAccountKey('ASSETS-CURRENT')).toBe('assets-current');
    });

    it('normalizeAccountKey collapses whitespace, underscores, and hyphens into a single hyphen', () => {
      expect(normalizeAccountKey('1010_BANK')).toBe('1010-bank');
      expect(normalizeAccountKey('1010  BANK')).toBe('1010-bank');
      expect(normalizeAccountKey('1010--BANK')).toBe('1010-bank');
      expect(normalizeAccountKey('1010 - BANK')).toBe('1010-bank');
    });

    it('normalizeAccountKey strips non-alphanumeric characters except hyphens', () => {
      expect(normalizeAccountKey('1010$BANK#2')).toBe('1010bank2');
    });

    it('normalizeAccountKey returns empty string for blank/null input', () => {
      expect(normalizeAccountKey('')).toBe('');
      expect(normalizeAccountKey('   ')).toBe('');
      expect(normalizeAccountKey(null as unknown as string)).toBe('');
    });

    it('identical codes with different casing/whitespace produce the same normalized key', () => {
      const variants = ['1010-CASH', '1010-cash', '  1010-CASH  ', '1010_CASH', '1010 CASH'];
      const normalized = variants.map(normalizeAccountKey);
      const unique = new Set(normalized);
      expect(unique.size).toBe(1);
    });

    it('Erp4DuplicatePolicy.registerRow returns the normalized key for accounts', () => {
      const policy = new Erp4DuplicatePolicy();
      const key = policy.registerRow('row-001', 'account', { code: '  1010-CASH  ' });
      expect(key).toBe('1010-cash');
    });

    it('Erp4DuplicatePolicy.registerRow builds normalized key for journal entries', () => {
      const policy = new Erp4DuplicatePolicy();
      const key = policy.registerRow('row-je-001', 'journal_entry', {
        period_id: 'AAA-001',
        posting_date: '2026-04-10T00:00:00Z', // should trim to YYYY-MM-DD
        currency_code: 'inr',                  // should uppercase
      });
      expect(key).toBe('aaa-001:2026-04-10:INR');
    });

    it('Erp4DuplicatePolicy.registerRow builds normalized key for opening_balance', () => {
      const policy = new Erp4DuplicatePolicy();
      const key = policy.registerRow('row-ob-001', 'opening_balance', {
        account_id: 'ACCT-UUID-001',
        currency_code: 'usd',
      });
      expect(key).toBe('acct-uuid-001:USD');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC2: Deterministic Duplicate Detection
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC2: Identical normalized keys are flagged deterministically as duplicate candidates', () => {
    it('buildDuplicateCandidates groups rows sharing the same normalized key', () => {
      const rows: SourceRow[] = [
        { rowId: 'r1', entityKind: 'account', normalizedKey: '1010-cash', rawData: {} },
        { rowId: 'r2', entityKind: 'account', normalizedKey: '1010-cash', rawData: {} },
        { rowId: 'r3', entityKind: 'account', normalizedKey: '2000-ap', rawData: {} },
      ];
      const candidates = buildDuplicateCandidates(rows);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.normalizedKey).toBe('1010-cash');
      expect(candidates[0]!.rowIds).toContain('r1');
      expect(candidates[0]!.rowIds).toContain('r2');
    });

    it('buildDuplicateCandidates returns no candidates when all keys are unique', () => {
      const rows: SourceRow[] = [
        { rowId: 'r1', entityKind: 'account', normalizedKey: '1010-cash', rawData: {} },
        { rowId: 'r2', entityKind: 'account', normalizedKey: '2000-ap', rawData: {} },
        { rowId: 'r3', entityKind: 'account', normalizedKey: '3000-equity', rawData: {} },
      ];
      expect(buildDuplicateCandidates(rows)).toHaveLength(0);
    });

    it('buildDuplicateCandidates is deterministic — same input, same output', () => {
      const rows: SourceRow[] = [
        { rowId: 'r1', entityKind: 'account', normalizedKey: 'dup-key', rawData: {} },
        { rowId: 'r2', entityKind: 'account', normalizedKey: 'dup-key', rawData: {} },
      ];
      const run1 = buildDuplicateCandidates(rows);
      const run2 = buildDuplicateCandidates(rows);
      expect(run1[0]!.normalizedKey).toBe(run2[0]!.normalizedKey);
      expect(run1[0]!.rowIds).toEqual(run2[0]!.rowIds);
    });

    it('does not group rows across different entityKind even if key text matches', () => {
      const rows: SourceRow[] = [
        { rowId: 'r1', entityKind: 'account', normalizedKey: 'shared-key', rawData: {} },
        { rowId: 'r2', entityKind: 'journal_entry', normalizedKey: 'shared-key', rawData: {} },
      ];
      // Different entity kinds should not cross-contaminate
      expect(buildDuplicateCandidates(rows)).toHaveLength(0);
    });

    it('policy.detectDuplicates returns candidates for all registered rows with collisions', () => {
      const policy = new Erp4DuplicatePolicy();
      policy.registerRow('row-A', 'account', { code: '1010-CASH' });
      policy.registerRow('row-B', 'account', { code: '1010-cash' }); // same normalized key
      policy.registerRow('row-C', 'account', { code: '2000-AP' });

      const candidates = policy.detectDuplicates();
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.rowIds).toContain('row-A');
      expect(candidates[0]!.rowIds).toContain('row-B');
      expect(candidates[0]!.status).toBe('pending_review');
    });

    it('policy correctly detects multiple duplicate groups in a single pass', () => {
      const policy = new Erp4DuplicatePolicy();
      // Group 1: 1010-cash
      policy.registerRow('r1', 'account', { code: '1010-CASH' });
      policy.registerRow('r2', 'account', { code: '1010-cash' });
      // Group 2: 2000-ap
      policy.registerRow('r3', 'account', { code: '2000-AP' });
      policy.registerRow('r4', 'account', { code: '  2000-AP  ' });
      // Unique row
      policy.registerRow('r5', 'account', { code: '3000-EQUITY' });

      const candidates = policy.detectDuplicates();
      expect(candidates).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC3: Human-review hold — no automatic fuzzy merging in V1
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC3: Uncertain candidates are held for human review; no automatic merging', () => {
    let policy: Erp4DuplicatePolicy;
    let candidateId: string;

    beforeEach(() => {
      policy = new Erp4DuplicatePolicy();
      policy.registerRow('row-A', 'account', { code: '1010-CASH' });
      policy.registerRow('row-B', 'account', { code: '1010-cash' });
      const candidates = policy.detectDuplicates();
      candidateId = candidates[0]!.candidateId;
    });

    it('all detected candidates start in pending_review status', () => {
      const pending = policy.getPendingCandidates();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.status).toBe('pending_review');
    });

    it('isHeldForReview returns true for rows belonging to a pending candidate', () => {
      expect(policy.isHeldForReview('row-A')).toBe(true);
      expect(policy.isHeldForReview('row-B')).toBe(true);
    });

    it('isHeldForReview returns false for rows not part of any pending candidate', () => {
      expect(policy.isHeldForReview('row-NOT-REGISTERED')).toBe(false);
    });

    it('policy does NOT automatically merge candidates — human action required', () => {
      // After detection, all candidates remain pending_review — no auto-resolution
      const pending = policy.getPendingCandidates();
      expect(pending.every((c) => c.status === 'pending_review')).toBe(true);
    });

    it('dismissCandidate marks candidate dismissed; dismissed rows no longer pending', () => {
      policy.dismissCandidate(candidateId, 'actor-uuid-001', 'Reviewed: different business units, keep both');
      expect(policy.getPendingCandidates()).toHaveLength(0);
      expect(policy.getAllCandidates()[0]!.status).toBe('dismissed');
      expect(policy.isHeldForReview('row-A')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC4: Audit log records human merge decisions
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC4: Audit log records human merge decisions with actor ID, timestamp, kept ID, and merged ID', () => {
    let policy: Erp4DuplicatePolicy;
    let candidateId: string;

    beforeEach(() => {
      policy = new Erp4DuplicatePolicy();
      policy.registerRow('row-A', 'account', { code: '1010-CASH' });
      policy.registerRow('row-B', 'account', { code: '1010-cash' });
      const candidates = policy.detectDuplicates();
      candidateId = candidates[0]!.candidateId;
    });

    it('recordMergeDecision records actor_id, timestamp, kept_id, and merged_id in audit log', () => {
      const actorId = 'user-uuid-123';
      const decision = policy.recordMergeDecision(
        candidateId,
        actorId,
        'row-A',        // kept
        ['row-B'],      // merged
        'row-A is the canonical source-of-truth record'
      );

      expect(decision.actorId).toBe(actorId);
      expect(decision.keptRowId).toBe('row-A');
      expect(decision.mergedRowIds).toContain('row-B');
      expect(typeof decision.decidedAt).toBe('string');
      // Timestamp must be parseable ISO-8601
      expect(new Date(decision.decidedAt).getTime()).toBeGreaterThan(0);
    });

    it('audit log is immutable and grows with each decision', () => {
      const policy2 = new Erp4DuplicatePolicy();
      policy2.registerRow('r1', 'account', { code: 'ACCT-A' });
      policy2.registerRow('r2', 'account', { code: 'ACCT-A' });
      policy2.registerRow('r3', 'account', { code: 'ACCT-B' });
      policy2.registerRow('r4', 'account', { code: 'ACCT-B' });
      const candidates = policy2.detectDuplicates();

      policy2.recordMergeDecision(candidates[0]!.candidateId, 'actor-1', 'r1', ['r2'], 'Keep first occurrence');
      policy2.recordMergeDecision(candidates[1]!.candidateId, 'actor-2', 'r3', ['r4'], 'Keep authoritative record');

      const log = policy2.getAuditLog();
      expect(log).toHaveLength(2);
      expect(log[0]!.actorId).toBe('actor-1');
      expect(log[1]!.actorId).toBe('actor-2');
    });

    it('recordMergeDecision transitions candidate status to merged', () => {
      policy.recordMergeDecision(candidateId, 'actor-uuid', 'row-A', ['row-B'], 'Merge duplicate');
      const candidate = policy.getAllCandidates().find((c) => c.candidateId === candidateId)!;
      expect(candidate.status).toBe('merged');
      expect(candidate.resolution).toBeDefined();
    });

    it('recordMergeDecision throws on unknown candidateId', () => {
      expect(() =>
        policy.recordMergeDecision('nonexistent-id', 'actor', 'row-A', [], 'reason')
      ).toThrow("Duplicate candidate 'nonexistent-id' not found.");
    });

    it('recordMergeDecision throws if kept_id is not a member of the candidate group', () => {
      expect(() =>
        policy.recordMergeDecision(candidateId, 'actor', 'row-NOT-IN-GROUP', ['row-B'], 'reason')
      ).toThrow();
    });

    it('recordMergeDecision throws if candidate is not in pending_review state', () => {
      policy.recordMergeDecision(candidateId, 'actor-1', 'row-A', ['row-B'], 'First merge');
      expect(() =>
        policy.recordMergeDecision(candidateId, 'actor-2', 'row-A', ['row-B'], 'Second merge attempt')
      ).toThrow();
    });
  });
});
