/**
 * ERP-2 reconciliation proof tests (ERP2-30 / Gate G4).
 * Expected numbers are the committed expected-profile.json figures, written down independently
 * of the reconciliation module.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateReconciliation } from '@cs/kit';
import { FIXTURE_PATH, evaluateDataset, parseCsv } from '../../src/migration/dirty-data-plan.js';
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
const expectedProfile = JSON.parse(read('sample-data/erp-2/expected-profile.json')) as {
  rows: Record<string, { record_type: string; outcome: string; reasons: string[] }>;
};

const EXPECTED_BY_TYPE = {
  vendor: { source: 46, loaded: 26, rejected: 15, merged: 0, skipped: 5 },
  purchase_order: { source: 44, loaded: 22, rejected: 18, merged: 0, skipped: 4 },
  po_line: { source: 83, loaded: 46, rejected: 35, merged: 0, skipped: 2 },
};

const syntheticReceipts = (loadedIds: string[]): ImportReceiptLike[] =>
  loadedIds.map((id, i) => ({
    row_id: id,
    idempotency_key: `SYNTH-ERP2-DIRTY-V1:${id}`,
    target_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  }));

describe('ERP-2 reconciliation proof ([ERP2-30])', () => {
  const report = buildReconciliationReport(csvText);

  it('gives every source row exactly one terminal outcome', () => {
    expect(report.exactly_one_outcome_per_row).toBe(true);
    expect(report.rows).toHaveLength(173);
    for (const row of report.rows) {
      expect(['loaded', 'rejected', 'merged', 'skipped']).toContain(row.outcome);
    }
  });

  it('balances exactly: source = loaded + rejected + merged + skipped, unaccounted = 0', () => {
    expect(report.counts).toEqual({ source: 173, loaded: 94, rejected: 68, merged: 0, skipped: 11 });
    const c = report.counts;
    expect(c.loaded + c.rejected + c.merged + c.skipped).toBe(c.source);
    expect(report.unaccounted).toBe(0);
    expect(report.result).toBe('OK');
  });

  it('balances per record type', () => {
    expect(report.by_record_type).toEqual(EXPECTED_BY_TYPE);
  });

  it('agrees row-by-row with the committed expected profile', () => {
    const map: Record<string, string> = { accepted: 'loaded', rejected: 'rejected', review: 'skipped', skipped: 'skipped' };
    for (const row of report.rows) {
      const expected = expectedProfile.rows[row.row_id];
      expect(expected, row.row_id).toBeDefined();
      expect(row.outcome, row.row_id).toBe(map[expected!.outcome]);
    }
  });

  it('has zero link-integrity violations among loaded rows', () => {
    expect(report.link_violations).toEqual([]);
  });

  it('detects broken links when parents are not loaded', () => {
    const raw = parseCsv(csvText);
    const terminal = toTerminalRows(evaluateDataset(raw));
    const broken = terminal.map((t) =>
      t.record_type === 'vendor' ? { ...t, outcome: 'rejected' as const } : t,
    );
    const violations = checkLinkIntegrity(raw, broken);
    expect(violations.length).toBeGreaterThanOrEqual(22);
    expect(violations.every((v) => v.check === 'PO_VENDOR_NOT_LOADED')).toBe(true);
  });

  it('never auto-merges; an explicit decision on an exact-duplicate review row merges it and still balances', () => {
    expect(report.counts.merged).toBe(0);
    const target = report.rows.find(
      (r) => r.outcome === 'skipped' && r.reasons.length > 0 && r.reasons.every((x) => x.startsWith('DUPLICATE_')),
    );
    expect(target).toBeDefined();
    const merged = buildReconciliationReport(csvText, { mergeDecisions: new Set([target!.row_id]) });
    expect(merged.counts.merged).toBe(1);
    expect(merged.counts.skipped).toBe(10);
    expect(merged.unaccounted).toBe(0);
    expect(merged.result).toBe('OK');
  });

  it('ignores merge decisions for non-duplicate review rows', () => {
    const ambiguous = report.rows.find((r) => r.reasons.includes('AMBIGUOUS_DATE_FORMAT_REVIEW'));
    expect(ambiguous).toBeDefined();
    const r = buildReconciliationReport(csvText, { mergeDecisions: new Set([ambiguous!.row_id]) });
    expect(r.counts.merged).toBe(0);
  });

  it('reports NOT_OK when a row is unaccounted for', () => {
    const { total } = countOutcomes(report.rows);
    const verdict = evaluateReconciliation({ ...total, loaded: total.loaded - 1, pending: 0 });
    expect(verdict.unaccounted).toBe(1);
    expect(verdict.result).toBe('NOT_OK');
  });

  it('is deterministic across runs', () => {
    expect(JSON.stringify(buildReconciliationReport(csvText))).toBe(JSON.stringify(report));
  });

  describe('durable import receipts', () => {
    const loadedIds = report.rows.filter((r) => r.outcome === 'loaded').map((r) => r.row_id);

    it('verifies complete when there is exactly one receipt per loaded row', () => {
      const v = verifyReceipts(report.rows, syntheticReceipts(loadedIds));
      expect(v).toEqual({ complete: true, missing: [], unexpected: [], duplicate_keys: [], malformed: [] });
    });

    it('flags a missing receipt', () => {
      const v = verifyReceipts(report.rows, syntheticReceipts(loadedIds.slice(1)));
      expect(v.complete).toBe(false);
      expect(v.missing).toEqual([loadedIds[0]]);
    });

    it('flags a receipt for a non-loaded row', () => {
      const rejected = report.rows.find((r) => r.outcome === 'rejected')!;
      const v = verifyReceipts(report.rows, syntheticReceipts([...loadedIds, rejected.row_id]));
      expect(v.complete).toBe(false);
      expect(v.unexpected).toEqual([rejected.row_id]);
    });

    it('flags duplicate idempotency keys and malformed receipts', () => {
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
