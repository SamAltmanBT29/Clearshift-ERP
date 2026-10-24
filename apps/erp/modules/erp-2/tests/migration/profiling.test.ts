/**
 * ERP-2 Vendors & Purchasing — Profiling Configuration & Expected-Result Assertions
 * (Issue #142 / ERP2-26 / KIT-03)
 *
 * Verifies:
 *  AC1  Profiler computes total rows, null counts, distinct values and invalid-format rates.
 *  AC2  Exact duplicate candidate count matches the ERP2-25 manifest expectation.
 *  AC3  Profiling is strictly non-destructive; source data remains untouched.
 *  AC4  Profiler output matches the pre-calculated manifest numbers.
 * Plus: bank details never appear in the report, and the CSV export is formula-safe.
 *
 * Expected values come from the committed manifest (`expected-profile.json`) and from a
 * deliberately naive re-count of the raw rows, never from the profiler itself.
 *
 * @module erp2/tests/migration/profiling.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ColumnProfile, DatasetProfileReport } from '@cs/kit';
import {
  ERP2_COLUMN_RULES,
  ERP2_DUPLICATE_KEY_RULES,
  exportErp2ProfileCsv,
  profileErp2Dataset,
} from '../../src/migration/profiling-config.js';
import {
  FIXTURE_PATH,
  parseCsv,
  sha256Hex,
  type ProfileReport,
} from '../../src/migration/dirty-data-plan.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const CSV_PATH = resolve(REPO_ROOT, FIXTURE_PATH);
const MANIFEST_PATH = resolve(REPO_ROOT, 'sample-data/erp-2/expected-profile.json');

const CSV_TEXT = readFileSync(CSV_PATH, 'utf8');
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ProfileReport;
const ROWS = parseCsv(CSV_TEXT);

const col = (report: DatasetProfileReport, key: string): ColumnProfile => {
  const c = report.columns[key];
  if (!c) throw new Error(`Missing column profile: ${key}`);
  return c;
};

/** Rows of a record type whose manifest reasons include any of the given reason codes. */
const manifestRowIds = (recordType: string, reasons: readonly string[]): string[] =>
  Object.entries(MANIFEST.rows)
    .filter(([, r]) => r.record_type === recordType && r.reasons.some((x) => reasons.includes(x)))
    .map(([id]) => id);

describe('[ERP2-26] ERP-2 Profiling Configuration & Expected-Result Assertions (#142)', () => {
  const report = profileErp2Dataset(ROWS, CSV_TEXT);

  // ── AC1: column metrics ────────────────────────────────────────────────────
  describe('1. Column profiling metrics (AC1)', () => {
    it('total rows match the manifest', () => {
      expect(report.totalRows).toBe(173);
      expect(report.totalRows).toBe(MANIFEST.total_rows);
    });

    it('per-record-type column totals match manifest by_record_type', () => {
      expect(col(report, 'vendor.vendor_code').totalRows).toBe(46);
      expect(col(report, 'purchase_order.po_number').totalRows).toBe(44);
      expect(col(report, 'po_line.line_no').totalRows).toBe(83);
      for (const [type, key] of [
        ['vendor', 'vendor.vendor_code'],
        ['purchase_order', 'purchase_order.po_number'],
        ['po_line', 'po_line.line_no'],
      ] as const) {
        expect(col(report, key).totalRows).toBe(MANIFEST.by_record_type[type]?.total);
      }
    });

    it('null, populated and distinct counts match an independent re-count of the raw rows', () => {
      for (const rule of ERP2_COLUMN_RULES) {
        const key = `${rule.recordType}.${rule.column}`;
        const scoped = ROWS.filter((r) => r.record_type === rule.recordType);
        const values = scoped.map((r) => (r as Record<string, string>)[rule.column]?.trim() ?? '');
        const populated = values.filter((v) => v !== '');
        const p = col(report, key);

        expect(p.totalRows, `${key} total`).toBe(scoped.length);
        expect(p.nullCount, `${key} null`).toBe(values.length - populated.length);
        expect(p.populatedCount, `${key} populated`).toBe(populated.length);
        expect(p.distinctCount, `${key} distinct`).toBe(new Set(populated).size);
      }
    });

    it('invalid-format rate = invalid / total x 100, rounded to 2 dp, for every column', () => {
      for (const p of Object.values(report.columns)) {
        const expected = p.totalRows > 0 ? Number(((p.invalidFormatCount / p.totalRows) * 100).toFixed(2)) : 0;
        expect(p.invalidFormatRate, `${p.recordType}.${p.column}`).toBe(expected);
      }
    });

    it('known fixture facts: optional vendor columns have nulls, required vendor_code has exactly one gap', () => {
      expect(col(report, 'vendor.vendor_code').nullCount).toBe(1); // R027
      expect(col(report, 'vendor.vendor_name').nullCount).toBe(1); // R028
      expect(col(report, 'vendor.tax_number').nullCount).toBeGreaterThan(0); // R007, R014 are optional/empty
      expect(col(report, 'vendor.payment_terms_days').nullCount).toBeGreaterThan(0); // R005, R010
    });
  });

  // ── AC4: invalid counts vs manifest reason codes ───────────────────────────
  describe('2. Invalid-format counts match manifest reason codes (AC4)', () => {
    const CASES: {
      key: string;
      type: string;
      reasons: string[];
      literal: number;
    }[] = [
      { key: 'vendor.vendor_code', type: 'vendor', reasons: ['VENDOR_CODE_REQUIRED', 'VENDOR_CODE_TOO_LONG'], literal: 2 },
      { key: 'vendor.currency', type: 'vendor', reasons: ['CURRENCY_REQUIRED', 'INVALID_CURRENCY'], literal: 3 },
      { key: 'vendor.payment_terms_days', type: 'vendor', reasons: ['INVALID_PAYMENT_TERMS', 'PAYMENT_TERMS_OUT_OF_RANGE'], literal: 4 },
      { key: 'vendor.email', type: 'vendor', reasons: ['INVALID_EMAIL'], literal: 1 },
      { key: 'vendor.tax_number', type: 'vendor', reasons: ['INVALID_TAX_NUMBER'], literal: 1 },
      { key: 'purchase_order.po_number', type: 'purchase_order', reasons: ['PO_NUMBER_REQUIRED'], literal: 1 },
      { key: 'purchase_order.po_vendor_code', type: 'purchase_order', reasons: ['PO_VENDOR_REQUIRED'], literal: 1 },
      { key: 'purchase_order.po_status', type: 'purchase_order', reasons: ['PO_STATUS_REQUIRED', 'INVALID_PO_STATUS'], literal: 3 },
      { key: 'purchase_order.status_path', type: 'purchase_order', reasons: ['INVALID_STATUS_TRANSITION'], literal: 1 },
      { key: 'purchase_order.currency', type: 'purchase_order', reasons: ['CURRENCY_REQUIRED', 'INVALID_CURRENCY'], literal: 2 },
      { key: 'po_line.po_number', type: 'po_line', reasons: ['PO_NUMBER_REQUIRED'], literal: 1 },
      { key: 'po_line.line_no', type: 'po_line', reasons: ['INVALID_LINE_NUMBER'], literal: 2 },
      { key: 'po_line.quantity', type: 'po_line', reasons: ['QUANTITY_REQUIRED', 'QUANTITY_MUST_BE_POSITIVE', 'INVALID_QUANTITY'], literal: 6 },
      { key: 'po_line.unit_price', type: 'po_line', reasons: ['PRICE_REQUIRED', 'PRICE_MUST_BE_NON_NEGATIVE', 'INVALID_PRICE'], literal: 4 },
    ];

    it.each(CASES)('$key: invalid count equals manifest-derived count', ({ key, type, reasons, literal }) => {
      const fromManifest = manifestRowIds(type, reasons).length;
      expect(fromManifest, `${key} manifest-derived`).toBe(literal);
      expect(col(report, key).invalidFormatCount, `${key} profiler`).toBe(literal);
    });

    it('invalid date counts: ISO-valid dates only (ambiguous and impossible dates both count as invalid)', () => {
      const dateReasons = ['PO_DATE_REQUIRED', 'INVALID_DATE', 'AMBIGUOUS_DATE_FORMAT_REVIEW', 'EXPECTED_DATE_BEFORE_ORDER_DATE'];
      const expected = manifestRowIds('purchase_order', dateReasons).length; // 5 rows
      const profiled =
        col(report, 'purchase_order.po_date').invalidFormatCount +
        col(report, 'purchase_order.expected_date').invalidFormatCount;
      // A row can in principle trip both date columns, so the profiler may report >= row count.
      expect(profiled).toBeGreaterThanOrEqual(expected);
      expect(col(report, 'purchase_order.po_date').nullCount).toBe(1); // R076
    });
  });

  // ── AC2: exact duplicate candidates ────────────────────────────────────────
  describe('3. Exact duplicate candidates match the manifest (AC2)', () => {
    const DUP_CASES = [
      { rule: 'vendor_code', type: 'vendor', reason: 'DUPLICATE_VENDOR_CODE_REVIEW', literal: 3 },
      { rule: 'vendor_tax_number', type: 'vendor', reason: 'DUPLICATE_TAX_NUMBER_REVIEW', literal: 3 },
      { rule: 'po_number', type: 'purchase_order', reason: 'DUPLICATE_PO_NUMBER_REVIEW', literal: 2 },
      { rule: 'po_line_key', type: 'po_line', reason: 'DUPLICATE_LINE_REVIEW', literal: 2 },
    ] as const;

    it.each(DUP_CASES)('$rule: candidate count and rows equal manifest $reason', ({ rule, type, reason, literal }) => {
      expect(MANIFEST.by_reason_code[reason]).toBe(literal);

      const dup = report.exactDuplicates[rule];
      if (!dup) throw new Error(`Missing duplicate profile: ${rule}`);
      expect(dup.candidateCount).toBe(literal);

      // Every row the manifest holds for review is a non-first member of a profiler group, and vice versa.
      const reviewIds = manifestRowIds(type, [reason]).sort();
      const laterMembers = dup.groups.flatMap((g) => g.rowIds.slice(1)).sort();
      expect(laterMembers).toEqual(reviewIds);
    });

    it('defines exactly the four documented exact-key rules (no fuzzy rules)', () => {
      expect(ERP2_DUPLICATE_KEY_RULES.map((r) => r.name)).toEqual([
        'vendor_code',
        'vendor_tax_number',
        'po_number',
        'po_line_key',
      ]);
    });
  });

  // ── AC3: non-destructive ───────────────────────────────────────────────────
  describe('4. Non-destructive operation (AC3)', () => {
    it('source CSV bytes and SHA-256 are unchanged and match the manifest', () => {
      const before = sha256Hex(CSV_TEXT);
      expect(before).toBe(MANIFEST.fixture_sha256);

      const r = profileErp2Dataset(ROWS, CSV_TEXT);
      expect(r.isNonDestructive).toBe(true);
      expect(r.sha256).toBe(MANIFEST.fixture_sha256);

      const after = readFileSync(CSV_PATH, 'utf8');
      expect(sha256Hex(after)).toBe(before);
      expect(after).toBe(CSV_TEXT);
    });

    it('does not mutate parsed rows (deep-frozen rows would throw on any write)', () => {
      const frozen = parseCsv(CSV_TEXT).map((row) => Object.freeze({ ...row }));
      const snapshot = JSON.stringify(frozen);
      expect(() => profileErp2Dataset(frozen, CSV_TEXT)).not.toThrow();
      expect(JSON.stringify(frozen)).toBe(snapshot);
    });

    it('is deterministic across runs (ignoring generatedAt)', () => {
      const strip = (r: DatasetProfileReport) => JSON.stringify({ ...r, generatedAt: '' });
      expect(strip(profileErp2Dataset(ROWS, CSV_TEXT))).toBe(strip(report));
    });
  });

  // ── Security: bank details + formula injection ─────────────────────────────
  describe('5. Sensitive data & formula-safe export', () => {
    const csvExport = exportErp2ProfileCsv(report);

    it('bank_account is not profiled and no raw bank value appears in the report or export', () => {
      expect(Object.keys(report.columns).some((k) => k.endsWith('.bank_account'))).toBe(false);
      const rawBankValues = ROWS.map((r) => r.bank_account.trim()).filter((v) => v !== '');
      expect(rawBankValues.length).toBeGreaterThan(0);
      const serialised = JSON.stringify(report) + csvExport;
      for (const v of rawBankValues) {
        expect(serialised).not.toContain(v);
      }
      expect(serialised).not.toContain('CH93-0000');
    });

    it('export has metadata, column metrics and duplicate sections', () => {
      expect(csvExport).toContain('# ClearShift Data Health Profile Report');
      expect(csvExport).toContain(`Source SHA-256: ${MANIFEST.fixture_sha256}`);
      expect(csvExport).toContain('## Section 1: Column Quality Metrics');
      expect(csvExport).toContain('## Section 2: Exact Duplicate Candidate Groups');
    });

    it('neutralises formula-injection values in exported cells', () => {
      const cases: [string, string][] = [
        ['=SUM(1+1)', "'=SUM(1+1) (1)"],
        ['@cmd', "'@cmd (1)"],
        ['+44123456', "'+44123456 (1)"],
      ];
      for (const [value, escaped] of cases) {
        const rows = [{ row_id: 'X1', record_type: 'vendor', vendor_code: 'V1', vendor_name: value, currency: 'USD' }];
        const profiled = profileErp2Dataset(rows);
        expect(exportErp2ProfileCsv(profiled)).toContain(escaped);
        expect(col(profiled, 'vendor.vendor_name').invalidFormatCount).toBe(1);
      }
    });
  });
});
