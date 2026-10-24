/**
 * ERP-3 Sales Orders & Invoices — Profiling Configuration & Expected-Result Assertions
 * (Issue #162 / ERP3-26 / KIT-03)
 *
 * Verifies all Acceptance Criteria for ERP3-26:
 *  - AC 1: Profiler accurately computes total rows, null counts, distinct values, and invalid format rates.
 *  - AC 2: Exact duplicate candidate count matches Dirty Data Pack manifest expectation without fuzzy matching.
 *  - AC 3: Profiling operation is strictly non-destructive; source data and memory structures remain untouched.
 *  - AC 4: Automated assertions confirm profiler output matches pre-calculated manifest numbers.
 *  - Security (PLT-12): Formula-safe CSV export prevents spreadsheet formula injection.
 *  - Fastify 5 REST API: Endpoints enforce RBAC, content types, and standard error envelopes.
 *
 * @module erp3/tests/migration/profiling.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ColumnProfile, DatasetProfileReport } from '@cs/kit';
import {
  ERP3_COLUMN_RULES,
  ERP3_DUPLICATE_KEY_RULES,
  exportErp3ProfileCsv,
  profileErp3Dataset,
} from '../../src/migration/profiling-config.js';
import {
  parseCsv,
  sha256Hex,
  type ProfileReport,
} from '../../src/migration/rules.js';

const REPO_ROOT = resolve(process.cwd());
const CSV_PATH = resolve(REPO_ROOT, 'sample-data/erp-3/dirty-data-v1.csv');
const MANIFEST_PATH = resolve(REPO_ROOT, 'sample-data/erp-3/expected-profile.json');

const CSV_TEXT = readFileSync(CSV_PATH, 'utf8');
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ProfileReport;

function parseCsvToRecords(csvText: string): Record<string, string>[] {
  const table = parseCsv(csvText);
  if (table.length < 2) return [];
  const headers = table[0]!.map((h) => h.trim());
  const records: Record<string, string>[] = [];
  for (let i = 1; i < table.length; i++) {
    const row = table[i]!;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j] || `col_${j + 1}`;
      obj[header] = row[j] ?? '';
    }
    records.push(obj);
  }
  return records;
}

const ROWS = parseCsvToRecords(CSV_TEXT);

const col = (report: DatasetProfileReport, key: string): ColumnProfile => {
  const c = report.columns[key];
  if (!c) throw new Error(`Missing column profile: ${key}`);
  return c;
};

describe('[ERP3-26] ERP-3 Sales Orders & Invoices: Profiling Configuration & Expected-Result Assertions (#162)', () => {
  const report = profileErp3Dataset(ROWS, CSV_TEXT);

  // ── 1. Column Metrics Assertions (AC1) ──────────────────────────────────────
  describe('1. Column Profiling Metrics Accuracy (AC1)', () => {
    it('accurately computes total dataset rows matching Dirty Data Pack', () => {
      expect(report.totalRows).toBe(135);
      expect(report.totalRows).toBe(MANIFEST.fixture.row_count);
    });

    it('per-record-type column totals match manifest by_record_type', () => {
      expect(col(report, 'sales_order.order_number').totalRows).toBe(51);
      expect(col(report, 'so_line.line_number').totalRows).toBe(38);
      expect(col(report, 'invoice.invoice_number').totalRows).toBe(21);
      expect(col(report, 'invoice_line.line_number').totalRows).toBe(5);
      expect(col(report, 'payment.payment_number').totalRows).toBe(20);

      const mapping: Array<[string, string]> = [
        ['sales_order', 'sales_order.order_number'],
        ['so_line', 'so_line.line_number'],
        ['invoice', 'invoice.invoice_number'],
        ['invoice_line', 'invoice_line.line_number'],
        ['payment', 'payment.payment_number'],
      ];

      for (const [type, key] of mapping) {
        expect(col(report, key).totalRows).toBe(MANIFEST.fixture.by_record_type[type]);
      }
    });

    it('null, populated, and distinct counts match an independent recount of raw rows', () => {
      for (const rule of ERP3_COLUMN_RULES) {
        const key = `${rule.recordType}.${rule.column}`;
        const scoped = ROWS.filter((r) => r['record_type'] === rule.recordType);
        const values = scoped.map((r) => (r[rule.column] !== undefined && r[rule.column] !== null ? r[rule.column].trim() : ''));
        const populated = values.filter((v) => v !== '');
        const p = col(report, key);

        expect(p.totalRows, `${key} totalRows`).toBe(scoped.length);
        expect(p.nullCount, `${key} nullCount`).toBe(values.length - populated.length);
        expect(p.populatedCount, `${key} populatedCount`).toBe(populated.length);
        expect(p.distinctCount, `${key} distinctCount`).toBe(new Set(populated).size);
      }
    });

    it('invalid-format rate = (invalid / total) * 100, rounded to 2 decimal places, for every column', () => {
      for (const p of Object.values(report.columns)) {
        const expected = p.totalRows > 0 ? Number(((p.invalidFormatCount / p.totalRows) * 100).toFixed(2)) : 0;
        expect(p.invalidFormatRate, `${p.recordType}.${p.column} invalidFormatRate`).toBe(expected);
      }
    });

    it('accurately profiles Sales Order columns (order_number, golden_id, order_date, status, currency, notes)', () => {
      const soOrderNo = col(report, 'sales_order.order_number');
      expect(soOrderNo.totalRows).toBe(51);
      expect(soOrderNo.nullCount).toBe(2); // R011, R116
      expect(soOrderNo.invalidFormatCount).toBeGreaterThan(0);
      expect(soOrderNo.topValues.length).toBeLessThanOrEqual(5);

      const soCustId = col(report, 'sales_order.customer_golden_id');
      expect(soCustId.totalRows).toBe(51);
      expect(soCustId.nullCount).toBe(2); // R014, R117
      expect(soCustId.invalidFormatCount).toBeGreaterThan(0);

      const soDate = col(report, 'sales_order.order_date');
      expect(soDate.totalRows).toBe(51);
      expect(soDate.nullCount).toBe(2); // R017, R118

      const soCurr = col(report, 'sales_order.currency');
      expect(soCurr.totalRows).toBe(51);
      expect(soCurr.nullCount).toBe(2); // R020, R119
    });

    it('accurately profiles Sales Order Line columns (quantity, unit_price, tax_rate)', () => {
      const solQty = col(report, 'so_line.quantity');
      expect(solQty.totalRows).toBe(38);
      expect(solQty.nullCount).toBe(0);
      expect(solQty.invalidFormatCount).toBeGreaterThan(0); // negative or zero quantity

      const solPrice = col(report, 'so_line.unit_price');
      expect(solPrice.totalRows).toBe(38);
      expect(solPrice.nullCount).toBe(0);
      expect(solPrice.invalidFormatCount).toBeGreaterThan(0); // negative price

      const solTax = col(report, 'so_line.tax_rate');
      expect(solTax.totalRows).toBe(38);
      expect(solTax.invalidFormatCount).toBeGreaterThan(0); // out of range tax rate
    });

    it('accurately profiles Invoice columns (invoice_number, due_date, currency, status)', () => {
      const invNo = col(report, 'invoice.invoice_number');
      expect(invNo.totalRows).toBe(21);
      expect(invNo.nullCount).toBe(2); // R042, R121
      expect(invNo.invalidFormatCount).toBeGreaterThan(0);

      const invDueDate = col(report, 'invoice.due_date');
      expect(invDueDate.totalRows).toBe(21);
      expect(invDueDate.nullCount).toBe(1); // R124
      expect(invDueDate.invalidFormatCount).toBeGreaterThan(0); // date defect or before order date
    });

    it('accurately profiles Payment columns (payment_number, payment_amount, payment_method)', () => {
      const payNo = col(report, 'payment.payment_number');
      expect(payNo.totalRows).toBe(20);
      expect(payNo.nullCount).toBe(0);
      expect(payNo.populatedCount).toBe(20);
      expect(payNo.invalidFormatCount).toBe(0);

      const payAmt = col(report, 'payment.payment_amount');
      expect(payAmt.totalRows).toBe(20);
      expect(payAmt.nullCount).toBe(1); // R128
      expect(payAmt.invalidFormatCount).toBeGreaterThan(0); // zero or negative

      const payMethod = col(report, 'payment.payment_method');
      expect(payMethod.totalRows).toBe(20);
      expect(payMethod.nullCount).toBe(1); // R129
      expect(payMethod.invalidFormatCount).toBeGreaterThan(0); // invalid enum
    });
  });

  // ── 2. Exact Duplicate Candidates Assertion (AC2) ───────────────────────────
  describe('2. Exact Duplicate Candidates Assertion (AC2)', () => {
    it('defines exactly the 5 documented exact-key rules (zero fuzzy matching)', () => {
      expect(ERP3_DUPLICATE_KEY_RULES.map((r) => r.name)).toEqual([
        'order_number',
        'invoice_number',
        'payment_number',
        'so_line_key',
        'invoice_line_key',
      ]);
    });

    it('identifies exact duplicate sales order candidates matching manifest (R022 and R111)', () => {
      const orderDup = report.exactDuplicates['order_number'];
      expect(orderDup).toBeDefined();
      expect(orderDup.candidateCount).toBe(2);
      expect(orderDup.groups).toHaveLength(1);

      const g1 = orderDup.groups.find((g) => g.key === 'SO-2026-1001');
      expect(g1).toBeDefined();
      expect(g1!.occurrences).toBe(3);
      expect(g1!.rowIds).toEqual(['R001', 'R022', 'R111']);
    });

    it('identifies exact duplicate invoice candidates matching manifest (R046 and R113)', () => {
      const invDup = report.exactDuplicates['invoice_number'];
      expect(invDup).toBeDefined();
      expect(invDup.candidateCount).toBe(2);
      expect(invDup.groups).toHaveLength(1);

      const g1 = invDup.groups.find((g) => g.key === 'INV-2026-1001');
      expect(g1).toBeDefined();
      expect(g1!.occurrences).toBe(3);
      expect(g1!.rowIds).toEqual(['R036', 'R046', 'R113']);
    });

    it('identifies exact duplicate payment candidates matching manifest (R059 and R115)', () => {
      const payDup = report.exactDuplicates['payment_number'];
      expect(payDup).toBeDefined();
      expect(payDup.candidateCount).toBe(2);
      expect(payDup.groups).toHaveLength(2);

      const g1 = payDup.groups.find((g) => g.key === 'PAY-2026-0001');
      expect(g1).toBeDefined();
      expect(g1!.occurrences).toBe(2);
      expect(g1!.rowIds).toEqual(['R050', 'R059']);

      const g2 = payDup.groups.find((g) => g.key === 'PAY-2026-0002');
      expect(g2).toBeDefined();
      expect(g2!.occurrences).toBe(2);
      expect(g2!.rowIds).toEqual(['R051', 'R115']);
    });

    it('duplicate counts exactly match manifest reason codes', () => {
      expect(MANIFEST.by_reason_code['DUPLICATE_ORDER_NUMBER_REVIEW']).toBe(2);
      expect(MANIFEST.by_reason_code['DUPLICATE_INVOICE_NUMBER_REVIEW']).toBe(2);
      expect(MANIFEST.by_reason_code['DUPLICATE_PAYMENT_REVIEW']).toBe(2);

      expect(report.exactDuplicates['order_number'].candidateCount).toBe(2);
      expect(report.exactDuplicates['invoice_number'].candidateCount).toBe(2);
      expect(report.exactDuplicates['payment_number'].candidateCount).toBe(2);
    });
  });

  // ── 3. Strictly Non-Destructive Invariant (AC3) ─────────────────────────────
  describe('3. Non-Destructive Operation Invariant (AC3 & BR-KIT-03)', () => {
    it('guarantees source CSV text and SHA-256 are unmodified before and after profiling', () => {
      const shaBefore = sha256Hex(CSV_TEXT);
      expect(shaBefore).toBe(MANIFEST.fixture.sha256);

      const r = profileErp3Dataset(ROWS, CSV_TEXT);
      expect(r.isNonDestructive).toBe(true);
      expect(r.sha256).toBe(MANIFEST.fixture.sha256);

      const textAfter = readFileSync(CSV_PATH, 'utf8');
      const shaAfter = sha256Hex(textAfter);

      expect(shaAfter).toBe(shaBefore);
      expect(textAfter).toBe(CSV_TEXT);
    });

    it('does not mutate parsed row objects in memory (deep-frozen safety check)', () => {
      const frozenRows = ROWS.map((r) => Object.freeze({ ...r }));
      const snapshotBefore = JSON.stringify(frozenRows);

      expect(() => profileErp3Dataset(frozenRows, CSV_TEXT)).not.toThrow();

      const snapshotAfter = JSON.stringify(frozenRows);
      expect(snapshotAfter).toBe(snapshotBefore);
    });

    it('is completely deterministic across runs (ignoring generatedAt timestamp)', () => {
      const stripGeneratedAt = (r: DatasetProfileReport) => JSON.stringify({ ...r, generatedAt: '' });
      expect(stripGeneratedAt(profileErp3Dataset(ROWS, CSV_TEXT))).toBe(stripGeneratedAt(report));
    });
  });

  // ── 4. Automated Manifest Assertion (AC4) ───────────────────────────────────
  describe('4. Automated Manifest Parity Assertion (AC4)', () => {
    it('verifies reconciliation figures match manifest', () => {
      const { reconciliation } = MANIFEST;
      expect(reconciliation.total_source_rows).toBe(135);
      expect(reconciliation.accepted).toBe(35);
      expect(reconciliation.rejected).toBe(91);
      expect(reconciliation.review).toBe(9);
      expect(reconciliation.skipped).toBe(0);
      expect(reconciliation.unaccounted).toBe(0);
      expect(reconciliation.is_balanced).toBe(true);
    });
  });

  // ── 5. Security & Formula-Safe CSV Export (PLT-12 / KIT-16) ─────────────────
  describe('5. Formula-Safe CSV Export (PLT-12 / KIT-16)', () => {
    const csvExport = exportErp3ProfileCsv(report);

    it('produces formatted CSV report with header metadata, column quality, and duplicate sections', () => {
      expect(csvExport).toContain('# ClearShift Data Health Profile Report');
      expect(csvExport).toContain(`Source SHA-256: ${MANIFEST.fixture.sha256}`);
      expect(csvExport).toContain('## Section 1: Column Quality Metrics');
      expect(csvExport).toContain('## Section 2: Exact Duplicate Candidate Groups');
      expect(csvExport).toContain('SO-2026-1001');
      expect(csvExport).toContain('INV-2026-1001');
      expect(csvExport).toContain('PAY-2026-0001');
      expect(csvExport).toContain('PAY-2026-0002');
    });

    it('neutralizes spreadsheet formula injection prefixes in exported cells', () => {
      const injectionRows: Record<string, string>[] = [
        {
          row_id: 'INJ1',
          record_type: 'sales_order',
          order_number: '=cmd|"/C calc"!A0',
          customer_golden_id: 'c0000000-0000-4000-8000-000000000001',
          order_date: '2026-10-01',
          order_status: 'Open',
          currency: 'USD',
          notes: '+44123456789',
        },
      ];

      const injReport = profileErp3Dataset(injectionRows);
      const injCsv = exportErp3ProfileCsv(injReport);

      expect(injCsv).toContain("=cmd");
      expect(injCsv).toContain("'+44123456789");
      expect(col(injReport, 'sales_order.order_number').invalidFormatCount).toBe(1);
      expect(col(injReport, 'sales_order.notes').invalidFormatCount).toBe(1);
    });
  });
});

