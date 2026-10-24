/**
 * ERP-5 HR & Employees — Reconciliation Proof Automated Tests (Issue #206 / ERP5-30 / Gate G4)
 *
 * Verifies:
 *  - AC1: Every source row receives exactly ONE terminal outcome: loaded, rejected, merged, or skipped.
 *  - AC2: Mathematical reconciliation balances exactly: source = loaded + rejected + merged + skipped
 *         and unaccounted = 0 (via shared kit evaluateReconciliation).
 *  - AC3: Target database records and durable import receipts verify complete and uncorrupted.
 *  - AC4: Zero link integrity violations across all loaded entities.
 *  - AC5: Deterministic reproducibility across migration runs.
 *
 * @module erp5/tests/migration/reconciliation.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateReconciliation } from '@cs/kit';
import {
  FIXTURE_PATH,
  evaluateDataset,
  parseCsv,
} from '../../src/migration/dirty-data-plan.js';
import {
  buildReconciliationReport,
  checkLinkIntegrity,
  countOutcomes,
  toTerminalRows,
  verifyReceipts,
  type ImportReceiptLike,
} from '../../src/migration/reconciliation.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

const csvText = read(FIXTURE_PATH);
const expectedProfile = JSON.parse(read('sample-data/erp-5/expected-profile.json')) as {
  reconciliation: {
    source_row_count: number;
    accepted: number;
    rejected: number;
    review: number;
    skipped: number;
    unaccounted: number;
    is_balanced: boolean;
  };
  by_record_type: Record<
    string,
    { accepted: number; rejected: number; review: number; skipped: number; total: number }
  >;
};

const EXPECTED_BY_TYPE = {
  department: { source: 20, loaded: 8, rejected: 10, merged: 0, skipped: 2 },
  employee: { source: 60, loaded: 18, rejected: 38, merged: 0, skipped: 4 },
  leave: { source: 30, loaded: 10, rejected: 18, merged: 0, skipped: 2 },
  payroll_total: { source: 20, loaded: 6, rejected: 12, merged: 0, skipped: 2 },
};

const syntheticReceipts = (loadedIds: string[]): ImportReceiptLike[] =>
  loadedIds.map((id, i) => ({
    row_id: id,
    idempotency_key: `SYNTH-ERP5-DIRTY-V1:${id}`,
    target_id: `5eed0000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  }));

describe('[ERP5-30] ERP-5 Reconciliation Proof & Gate G4 (#206)', () => {
  const report = buildReconciliationReport(csvText);

  // ── AC1: Exactly One Terminal Outcome Per Row ──────────────────────────────
  it('gives every source row exactly one terminal outcome (AC1)', () => {
    expect(report.exactly_one_outcome_per_row).toBe(true);
    expect(report.rows).toHaveLength(130);
    for (const row of report.rows) {
      expect(['loaded', 'rejected', 'merged', 'skipped']).toContain(row.outcome);
    }
  });

  // ── AC2: Mathematical Reconciliation Equation ─────────────────────────────
  it('balances exactly: source = loaded + rejected + merged + skipped and unaccounted = 0 (AC2)', () => {
    expect(report.counts).toEqual({
      source: 130,
      loaded: 42,
      rejected: 78,
      merged: 0,
      skipped: 10,
    });
    const c = report.counts;
    expect(c.loaded + c.rejected + c.merged + c.skipped).toBe(c.source);
    expect(report.unaccounted).toBe(0);
    expect(report.result).toBe('OK');
  });

  it('balances per entity record type matching expected profile', () => {
    expect(report.by_record_type).toEqual(EXPECTED_BY_TYPE);
  });

  it('agrees with the committed expected profile manifest counts', () => {
    expect(report.counts.source).toBe(expectedProfile.reconciliation.source_row_count);
    expect(report.counts.loaded).toBe(expectedProfile.reconciliation.accepted);
    expect(report.counts.rejected).toBe(expectedProfile.reconciliation.rejected);
    expect(report.counts.skipped).toBe(expectedProfile.reconciliation.review);
    expect(report.unaccounted).toBe(expectedProfile.reconciliation.unaccounted);
  });

  // ── AC4: Link Integrity Over Loaded Rows ───────────────────────────────────
  it('has zero cross-entity link-integrity violations among loaded rows (AC4)', () => {
    expect(report.link_violations).toEqual([]);
  });

  it('detects broken links when parent departments are not loaded', () => {
    const raw = parseCsv(csvText);
    const terminal = toTerminalRows(evaluateDataset(raw));
    // Simulate all departments failing load
    const broken = terminal.map((t) =>
      t.record_type === 'department' ? { ...t, outcome: 'rejected' as const } : t
    );
    const violations = checkLinkIntegrity(raw, broken);
    expect(violations.length).toBeGreaterThanOrEqual(18);
    expect(violations.some((v) => v.check === 'EMP_DEPT_NOT_LOADED')).toBe(true);
    expect(violations.some((v) => v.check === 'PAYROLL_DEPT_NOT_LOADED')).toBe(true);
  });

  it('detects broken leave links when employees are not loaded', () => {
    const raw = parseCsv(csvText);
    const terminal = toTerminalRows(evaluateDataset(raw));
    // Simulate all employees failing load
    const broken = terminal.map((t) =>
      t.record_type === 'employee' ? { ...t, outcome: 'rejected' as const } : t
    );
    const violations = checkLinkIntegrity(raw, broken);
    expect(violations.some((v) => v.check === 'LEAVE_EMP_NOT_LOADED')).toBe(true);
  });

  // ── No Auto-Merge and Explicit Human Decision ──────────────────────────────
  it('never auto-merges: candidate duplicates remain skipped until an explicit human decision', () => {
    expect(report.counts.merged).toBe(0);
    const target = report.rows.find(
      (r) =>
        r.outcome === 'skipped' &&
        r.reasons.length > 0 &&
        r.reasons.every((x) => x.startsWith('DUPLICATE_'))
    );
    expect(target).toBeDefined();

    // Reviewer explicitly merges target duplicate row
    const mergedReport = buildReconciliationReport(csvText, {
      mergeDecisions: new Set([target!.row_id]),
    });
    expect(mergedReport.counts.merged).toBe(1);
    expect(mergedReport.counts.skipped).toBe(9);
    expect(mergedReport.unaccounted).toBe(0);
    expect(mergedReport.result).toBe('OK');
  });

  it('detects dropped rows and reports NOT_OK with unaccounted > 0', () => {
    const { total } = countOutcomes(report.rows);
    const verdict = evaluateReconciliation({ ...total, loaded: total.loaded - 1, pending: 0 });
    expect(verdict.unaccounted).toBe(1);
    expect(verdict.result).toBe('NOT_OK');
  });

  it('is 100% deterministic and reproducible across repeated runs', () => {
    const secondRun = buildReconciliationReport(csvText);
    expect(JSON.stringify(secondRun)).toBe(JSON.stringify(report));
  });

  // ── AC3: Durable Import Receipts ───────────────────────────────────────────
  describe('Durable Import Receipts Verification (AC3)', () => {
    const loadedIds = report.rows.filter((r) => r.outcome === 'loaded').map((r) => r.row_id);

    it('verifies complete when there is exactly one receipt per loaded row', () => {
      expect(loadedIds).toHaveLength(42);
      const v = verifyReceipts(report.rows, syntheticReceipts(loadedIds));
      expect(v).toEqual({
        complete: true,
        missing: [],
        unexpected: [],
        duplicate_keys: [],
        malformed: [],
      });
    });

    it('flags missing receipts if loaded rows lack an import receipt', () => {
      const v = verifyReceipts(report.rows, syntheticReceipts(loadedIds.slice(1)));
      expect(v.complete).toBe(false);
      expect(v.missing).toEqual([loadedIds[0]]);
    });

    it('flags unexpected receipts for rejected or skipped rows', () => {
      const rejected = report.rows.find((r) => r.outcome === 'rejected')!;
      const v = verifyReceipts(report.rows, syntheticReceipts([...loadedIds, rejected.row_id]));
      expect(v.complete).toBe(false);
      expect(v.unexpected).toEqual([rejected.row_id]);
    });

    it('flags duplicate idempotency keys and malformed receipt fields', () => {
      const receipts = syntheticReceipts(loadedIds);
      receipts[1] = { ...receipts[1]!, idempotency_key: receipts[0]!.idempotency_key };
      receipts[2] = { ...receipts[2]!, target_id: '  ' };
      const v = verifyReceipts(report.rows, receipts);
      expect(v.complete).toBe(false);
      expect(v.duplicate_keys).toHaveLength(1);
      expect(v.malformed).toEqual([receipts[2]!.row_id]);
    });
  });
});
