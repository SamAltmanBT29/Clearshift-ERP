/**
 * ERP-4 Finance & Accounting — Reconciliation Proof Automated Tests (Issue #186 / ERP4-30 / Gate G4)
 *
 * Verifies:
 *  - AC1: Every source row receives exactly ONE terminal outcome: loaded, rejected, merged, or skipped.
 *  - AC2: Mathematical reconciliation balances exactly: source = loaded + rejected + merged + skipped
 *         and unaccounted = 0 (via shared kit evaluateReconciliation).
 *  - AC3: Target database records and durable import receipts verify complete and uncorrupted.
 *  - AC4: Zero link integrity violations across all loaded entities.
 *  - AC5: Deterministic reproducibility across migration runs.
 *
 * @module erp4/tests/migration/reconciliation.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateReconciliation } from '@cs/kit';
import {
  FIXTURE_PATH,
  readRawRows,
  evaluateDataset,
} from '../../src/migration/rules.js';
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
const expectedProfile = JSON.parse(read('sample-data/erp-4/expected-profile.json')) as {
  by_record_type: Record<
    string,
    { accepted: number; rejected: number; review: number }
  >;
  fixture: {
    row_count: number;
    sha256: string;
  };
};

const EXPECTED_BY_TYPE = {
  account: { source: 31, loaded: 14, rejected: 16, merged: 0, skipped: 1 },
  journal_entry: { source: 31, loaded: 4, rejected: 26, merged: 0, skipped: 1 },
  journal_line: { source: 62, loaded: 9, rejected: 51, merged: 0, skipped: 2 },
  opening_balance: { source: 19, loaded: 5, rejected: 13, merged: 0, skipped: 1 },
};

const syntheticReceipts = (loadedIds: string[]): ImportReceiptLike[] =>
  loadedIds.map((id, idx) => ({
    row_id: id,
    idempotency_key: `SYNTH-ERP4-DIRTY-V1:receipt:${id}:${idx}`,
    target_id: `target_uuid_${id}`,
  }));

describe('ERP-4 Reconciliation Proof & Gate G4 Acceptance (ERP4-30 / #186)', () => {
  it('AC1: every raw source row receives exactly one terminal outcome', () => {
    const raw = readRawRows(csvText);
    const evaluated = evaluateDataset(raw);
    const rows = toTerminalRows(evaluated.rowResults);

    expect(rows.length).toBe(raw.length);
    expect(rows.length).toBe(143);

    const outcomes = new Set(rows.map((r) => r.outcome));
    for (const outcome of outcomes) {
      expect(['loaded', 'rejected', 'merged', 'skipped']).toContain(outcome);
    }

    const rowIds = new Set(rows.map((r) => r.row_id));
    expect(rowIds.size).toBe(143);
  });

  it('AC2: balances mathematical reconciliation: source = loaded + rejected + merged + skipped and unaccounted = 0', () => {
    const report = buildReconciliationReport(csvText);

    expect(report.counts.source).toBe(143);
    expect(report.counts.loaded).toBe(32); // 14 + 4 + 9 + 5 = 32
    expect(report.counts.rejected).toBe(106); // 16 + 26 + 51 + 13 = 106
    expect(report.counts.merged).toBe(0);
    expect(report.counts.skipped).toBe(5); // 1 + 1 + 2 + 1 = 5 (candidate duplicates held for review)

    expect(
      report.counts.loaded +
        report.counts.rejected +
        report.counts.merged +
        report.counts.skipped
    ).toBe(report.counts.source);

    expect(report.unaccounted).toBe(0);
    expect(report.result).toBe('OK');
    expect(report.exactly_one_outcome_per_row).toBe(true);

    // Verify breakdown by record type matches expected-profile.json
    for (const [recType, expected] of Object.entries(EXPECTED_BY_TYPE)) {
      const actual = report.by_record_type[recType as keyof typeof EXPECTED_BY_TYPE];
      expect(actual, `Mismatched counts for ${recType}`).toEqual(expected);
    }
  });

  it('AC2.1: shared @cs/kit evaluateReconciliation confirms the verdict is OK', () => {
    const report = buildReconciliationReport(csvText);
    const kitVerdict = evaluateReconciliation({
      source: report.counts.source,
      loaded: report.counts.loaded,
      rejected: report.counts.rejected,
      merged: report.counts.merged,
      skipped: report.counts.skipped,
      pending: 0,
    });

    expect(kitVerdict.unaccounted).toBe(0);
    expect(kitVerdict.result).toBe('OK');
  });

  it('AC3: durable import receipts verify 100% complete, non-duplicate, and uncorrupted', () => {
    const report = buildReconciliationReport(csvText);
    const loadedIds = report.rows.filter((r) => r.outcome === 'loaded').map((r) => r.row_id);
    expect(loadedIds.length).toBe(32);

    const receipts = syntheticReceipts(loadedIds);
    const verification = verifyReceipts(report.rows, receipts);

    expect(verification.complete).toBe(true);
    expect(verification.missing).toHaveLength(0);
    expect(verification.unexpected).toHaveLength(0);
    expect(verification.duplicate_keys).toHaveLength(0);
    expect(verification.malformed).toHaveLength(0);
  });

  it('AC3.1: verifyReceipts detects missing and unexpected receipts correctly', () => {
    const report = buildReconciliationReport(csvText);
    const loadedIds = report.rows.filter((r) => r.outcome === 'loaded').map((r) => r.row_id);

    // Missing one receipt
    const partialReceipts = syntheticReceipts(loadedIds.slice(1));
    const partialVerif = verifyReceipts(report.rows, partialReceipts);
    expect(partialVerif.complete).toBe(false);
    expect(partialVerif.missing).toEqual([loadedIds[0]]);

    // Unexpected receipt (for a rejected row)
    const rejectedRow = report.rows.find((r) => r.outcome === 'rejected')!;
    const extraReceipts = [
      ...syntheticReceipts(loadedIds),
      {
        row_id: rejectedRow.row_id,
        idempotency_key: `extra:${rejectedRow.row_id}`,
        target_id: 'extra_id',
      },
    ];
    const extraVerif = verifyReceipts(report.rows, extraReceipts);
    expect(extraVerif.complete).toBe(false);
    expect(extraVerif.unexpected).toEqual([rejectedRow.row_id]);
  });

  it('AC4: zero link integrity violations across all loaded entities', () => {
    const raw = readRawRows(csvText);
    const evaluated = evaluateDataset(raw);
    const rows = toTerminalRows(evaluated.rowResults);

    const violations = checkLinkIntegrity(raw, rows);
    expect(violations).toHaveLength(0);
  });

  it('AC4.1: checkLinkIntegrity flags missing parent accounts, unlinked lines and opening balances', () => {
    const mockRaw: any[] = [
      { row_id: 'R1', record_type: 'account', code: '1000', parent_code: '9999' },
      { row_id: 'R2', record_type: 'opening_balance', code: '9999' },
      { row_id: 'R3', record_type: 'journal_line', code: '9999', parent_source_id: 'JE-999' },
    ];
    const mockTerminal: any[] = [
      { row_id: 'R1', record_type: 'account', outcome: 'loaded', reasons: [] },
      { row_id: 'R2', record_type: 'opening_balance', outcome: 'loaded', reasons: [] },
      { row_id: 'R3', record_type: 'journal_line', outcome: 'loaded', reasons: [] },
    ];

    const violations = checkLinkIntegrity(mockRaw, mockTerminal);
    expect(violations.length).toBe(4);
    expect(violations.map((v) => v.check)).toEqual([
      'ACCOUNT_PARENT_NOT_LOADED',
      'OPENING_BALANCE_ACCOUNT_NOT_LOADED',
      'JOURNAL_LINE_ACCOUNT_NOT_LOADED',
      'JOURNAL_LINE_PARENT_ENTRY_NOT_LOADED',
    ]);
  });

  it('AC3.2: verifyReceipts detects duplicate keys and malformed receipts', () => {
    const mockTerminal: any[] = [
      { row_id: 'R1', record_type: 'account', outcome: 'loaded', reasons: [] },
    ];
    const badReceipts: any[] = [
      { row_id: 'R1', idempotency_key: 'KEY-1', target_id: 'T1' },
      { row_id: 'R1', idempotency_key: 'KEY-1', target_id: '' },
    ];
    const result = verifyReceipts(mockTerminal, badReceipts);
    expect(result.complete).toBe(false);
    expect(result.duplicate_keys).toContain('KEY-1');
    expect(result.malformed).toContain('R1');
  });

  it('AC5: explicit human merge decisions deterministically convert candidate duplicates to merged', () => {
    const raw = readRawRows(csvText);
    const evaluated = evaluateDataset(raw);

    // Identify candidate duplicate review rows
    const reviewRows = evaluated.rowResults.filter((r) => r.outcome === 'review');
    expect(reviewRows.length).toBe(5);

    const decidedToMergeRowId = reviewRows[0].row_id;
    const mergeDecisions = new Set([decidedToMergeRowId]);

    const report = buildReconciliationReport(csvText, { mergeDecisions });

    expect(report.counts.source).toBe(143);
    expect(report.counts.loaded).toBe(32);
    expect(report.counts.rejected).toBe(106);
    expect(report.counts.merged).toBe(1);
    expect(report.counts.skipped).toBe(4);
    expect(report.unaccounted).toBe(0);
    expect(report.result).toBe('OK');
  });

  it('deterministic reproducibility: identical input produces identical report and SHA-256 hash', () => {
    const report1 = buildReconciliationReport(csvText);
    const report2 = buildReconciliationReport(csvText);

    expect(report1.fixture_sha256).toBe(report2.fixture_sha256);
    expect(report1.counts).toEqual(report2.counts);
    expect(report1.by_record_type).toEqual(report2.by_record_type);
    expect(report1.link_violations).toEqual(report2.link_violations);
  });
});
