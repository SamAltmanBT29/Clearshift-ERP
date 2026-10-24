/**
 * ERP-4 Finance & Accounting — Exact Duplicate Key Policy (Issue #168 / ERP4-12)
 *
 * Implements deterministic exact-duplicate matching for Chart of Accounts migration.
 * Conforms to:
 *   - ClearShift Core Rules: No fuzzy auto-merge. V1 is deterministic normalized exact-key matching.
 *   - SDS §4.6 (FR-DUP-01 to FR-DUP-04): Exact key normalization, candidate flagging, human-review hold.
 *   - ERP-4 account identity keys: trimmed lowercase `code` as the canonical exact-match key.
 *
 * Architecture:
 *   1. normalizeAccountKey(code)  → Produces a stable, normalized key for exact-match comparison.
 *   2. buildDuplicateCandidates() → Deterministically identifies duplicate rows in a candidate set.
 *   3. Erp4DuplicatePolicy class  → Full policy implementation: register, detect, review, audit log.
 *
 * Constraints (Non-Negotiable):
 *   - V1: No fuzzy scoring, no automatic merging, no compensating rollback saga.
 *   - Uncertain or ambiguous candidates are held for authorized human review.
 *   - Audit log records every human merge decision with actor_id, timestamp, kept_id, merged_id.
 *
 * @module erp4/migration/duplicate-policy
 */

import { randomUUID } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Normalization Utilities (AC1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes an account code into a deterministic exact-match key.
 * Rules:
 *   - Strip all leading/trailing whitespace.
 *   - Convert to lowercase.
 *   - Replace sequences of whitespace/underscores/hyphens with a single hyphen.
 *   - Remove non-alphanumeric characters (except hyphens).
 */
export function normalizeAccountKey(code: string): string {
  if (!code || typeof code !== 'string') return '';
  return code
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')       // collapse whitespace/separators
    .replace(/[^a-z0-9-]/g, '')     // strip non-alphanumeric except hyphen
    .replace(/^-+|-+$/g, '');       // strip leading/trailing hyphens
}

/**
 * Normalizes a journal entry key using period_id + posting_date + currency_code.
 * Used to detect duplicate journal header imports.
 */
export function normalizeJournalEntryKey(periodId: string, postingDate: string, currencyCode: string): string {
  const normDate = postingDate.trim().slice(0, 10); // YYYY-MM-DD
  const normCurrency = currencyCode.trim().toUpperCase().slice(0, 3);
  const normPeriod = periodId.trim().toLowerCase();
  return `${normPeriod}:${normDate}:${normCurrency}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate Candidate Types (AC2)
// ─────────────────────────────────────────────────────────────────────────────

export type DuplicateStatus = 'pending_review' | 'merged' | 'dismissed';
export type EntityKind = 'account' | 'journal_entry' | 'opening_balance';

export interface SourceRow {
  rowId: string;
  entityKind: EntityKind;
  normalizedKey: string;
  rawData: Record<string, unknown>;
}

export interface DuplicateCandidate {
  readonly candidateId: string;
  readonly normalizedKey: string;
  readonly entityKind: EntityKind;
  /** All row IDs that share this normalized key — first is the incumbent. */
  readonly rowIds: readonly string[];
  status: DuplicateStatus;
  readonly detectedAt: Date;
  resolution?: DuplicateMergeDecision | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge Decision Audit Log (AC4)
// ─────────────────────────────────────────────────────────────────────────────

export interface DuplicateMergeDecision {
  /** Opaque actor ID (e.g. user UUID). */
  readonly actorId: string;
  /** ISO-8601 timestamp of the decision. */
  readonly decidedAt: string;
  /** The row ID that is kept (winner). */
  readonly keptRowId: string;
  /** The row IDs that are merged into / discarded. */
  readonly mergedRowIds: readonly string[];
  /** Human-readable reason. */
  readonly reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Algorithm: buildDuplicateCandidates (AC2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Groups rows by their normalized key and returns groups with >1 member as duplicate candidates.
 * Deterministic: same input always produces the same output.
 */
export function buildDuplicateCandidates(rows: SourceRow[]): DuplicateCandidate[] {
  // Group by normalizedKey within each entityKind
  const groups = new Map<string, SourceRow[]>();

  for (const row of rows) {
    const groupKey = `${row.entityKind}::${row.normalizedKey}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(groupKey, [row]);
    }
  }

  const candidates: DuplicateCandidate[] = [];
  for (const [, group] of groups) {
    if (group.length >= 2) {
      const first = group[0]!;
      candidates.push({
        candidateId: randomUUID(),
        normalizedKey: first.normalizedKey,
        entityKind: first.entityKind,
        rowIds: group.map((r) => r.rowId),
        status: 'pending_review',
        detectedAt: new Date(),
      });
    }
  }

  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// Erp4DuplicatePolicy: Full Policy Class (AC1–AC4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the full duplicate key lifecycle for ERP-4 migration:
 * 1. Register source rows and build normalized exact keys.
 * 2. Detect duplicate candidates deterministically.
 * 3. Hold uncertain candidates for authorized human review.
 * 4. Record human merge decisions in an immutable audit log.
 */
export class Erp4DuplicatePolicy {
  private readonly registeredRows: SourceRow[] = [];
  private readonly candidates: Map<string, DuplicateCandidate> = new Map();
  private readonly auditLog: DuplicateMergeDecision[] = [];

  /**
   * Registers a source row with its normalized exact-match key.
   * AC1: Module registers normalized exact keys.
   */
  registerRow(rowId: string, entityKind: EntityKind, rawData: Record<string, unknown>): string {
    let normalizedKey: string;

    if (entityKind === 'account') {
      const code = String(rawData['code'] ?? rawData['account_code'] ?? '');
      normalizedKey = normalizeAccountKey(code);
    } else if (entityKind === 'journal_entry') {
      const periodId = String(rawData['period_id'] ?? '');
      const postingDate = String(rawData['posting_date'] ?? '');
      const currencyCode = String(rawData['currency_code'] ?? 'INR');
      normalizedKey = normalizeJournalEntryKey(periodId, postingDate, currencyCode);
    } else {
      // opening_balance: account_id + currency_code
      const accountId = String(rawData['account_id'] ?? '').toLowerCase();
      const currency = String(rawData['currency_code'] ?? 'INR').toUpperCase();
      normalizedKey = `${accountId}:${currency}`;
    }

    this.registeredRows.push({ rowId, entityKind, normalizedKey, rawData });
    return normalizedKey;
  }

  /**
   * Runs the duplicate detection pass over all registered rows.
   * AC2: Identical normalized keys are flagged deterministically as duplicate candidates.
   */
  detectDuplicates(): DuplicateCandidate[] {
    const found = buildDuplicateCandidates(this.registeredRows);
    for (const c of found) {
      this.candidates.set(c.candidateId, c);
    }
    return found;
  }

  /**
   * Returns all pending candidates awaiting human review.
   * AC3: Uncertain or ambiguous candidates are held for authorized human review.
   */
  getPendingCandidates(): DuplicateCandidate[] {
    return Array.from(this.candidates.values()).filter((c) => c.status === 'pending_review');
  }

  /**
   * Returns all candidates regardless of status.
   */
  getAllCandidates(): DuplicateCandidate[] {
    return Array.from(this.candidates.values());
  }

  /**
   * Records a human merge decision and transitions the candidate to 'merged'.
   * AC4: Audit log records human merge decisions with actor_id, timestamp, kept_id, merged_id.
   * No automatic fuzzy merging: a human actor must explicitly call this method.
   */
  recordMergeDecision(
    candidateId: string,
    actorId: string,
    keptRowId: string,
    mergedRowIds: string[],
    reason: string
  ): DuplicateMergeDecision {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) {
      throw new Error(`Duplicate candidate '${candidateId}' not found.`);
    }
    if (candidate.status !== 'pending_review') {
      throw new Error(`Candidate '${candidateId}' is not in pending_review state (status: ${candidate.status}).`);
    }
    if (!candidate.rowIds.includes(keptRowId)) {
      throw new Error(`keptRowId '${keptRowId}' is not a member of candidate '${candidateId}'.`);
    }

    const decision: DuplicateMergeDecision = {
      actorId,
      decidedAt: new Date().toISOString(),
      keptRowId,
      mergedRowIds,
      reason,
    };

    candidate.status = 'merged';
    candidate.resolution = decision;
    this.auditLog.push(decision);

    return decision;
  }

  /**
   * Dismisses a candidate (operator decides rows are NOT duplicates despite matching key).
   */
  dismissCandidate(candidateId: string, actorId: string, reason: string): void {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) throw new Error(`Candidate '${candidateId}' not found.`);
    if (candidate.status !== 'pending_review') {
      throw new Error(`Candidate '${candidateId}' is not pending_review (status: ${candidate.status}).`);
    }

    const dismissDecision: DuplicateMergeDecision = {
      actorId,
      decidedAt: new Date().toISOString(),
      keptRowId: candidate.rowIds[0]!,
      mergedRowIds: [],
      reason: `DISMISSED: ${reason}`,
    };

    candidate.status = 'dismissed';
    candidate.resolution = dismissDecision;
    this.auditLog.push(dismissDecision);
  }

  /**
   * Returns the immutable merge audit log.
   */
  getAuditLog(): readonly DuplicateMergeDecision[] {
    return [...this.auditLog];
  }

  /**
   * Checks if a specific row ID is part of any unresolved (pending_review) duplicate group.
   */
  isHeldForReview(rowId: string): boolean {
    for (const c of this.candidates.values()) {
      if (c.status === 'pending_review' && c.rowIds.includes(rowId)) {
        return true;
      }
    }
    return false;
  }
}
