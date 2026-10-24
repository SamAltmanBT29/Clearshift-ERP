/**
 * ERP-1 Products & Inventory — Profiling Configuration & Expected-Result Assertions
 * (Issue #122 / ERP1-26 / KIT-03)
 *
 * Verifies all Acceptance Criteria:
 *  AC1  Profiler accurately computes total rows, null counts, distinct values, and invalid format rates.
 *  AC2  Exact duplicate candidate count matches manifest expectation.
 *  AC3  Profiling operation is strictly non-destructive; source data remains untouched.
 *  AC4  Automated assertions confirm profiler output matches pre-calculated manifest numbers.
 * Plus:
 *  - Financial and employee personal data protection (bank details and SSNs never profiled).
 *  - Formula-safe CSV export protecting against OWASP spreadsheet formula injection.
 *
 * @module erp1/tests/migration/profiling.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ColumnProfile, DatasetProfileReport } from '@cs/kit';
import {
  ERP1_COLUMN_RULES,
  ERP1_DUPLICATE_KEY_RULES,
  exportErp1ProfileCsv,
  profileErp1Dataset,
} from '../../src/migration/profiling-config.js';
import {
  FIXTURE_PATH,
  parseCsv,
  sha256Hex,
  type ProfileReport,
} from '../../src/migration/dirty-data-plan.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const CSV_PATH = resolve(REPO_ROOT, FIXTURE_PATH);
const MANIFEST_PATH = resolve(REPO_ROOT, 'sample-data/erp-1/expected-profile.json');

const CSV_TEXT = readFileSync(CSV_PATH, 'utf8');
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ProfileReport;
const ROWS = parseCsv(CSV_TEXT);

const col = (report: DatasetProfileReport, key: string): ColumnProfile => {
  const c = report.columns[key];
  if (!c) throw new Error(`Missing column profile: ${key}`);
  return c;
};

/** Returns row IDs of a given record type whose manifest reasons include any of the specified codes. */
const manifestRowIds = (recordType: string, reasons: readonly string[]): string[] =>
  Object.entries(MANIFEST.rows)
    .filter(([, r]) => r.reasons.some((x) => reasons.includes(x)))
    .map(([id]) => id)
    .filter((id) => {
      const row = ROWS.find((r) => r.row_id === id);
      return row ? row.record_type === recordType : false;
    });

describe('[ERP1-26] ERP-1 Profiling Configuration & Expected-Result Assertions (#122)', () => {
  const report = profileErp1Dataset(ROWS, CSV_TEXT);

  // ── AC1: Column Quality Metrics ───────────────────────────────────────────
  describe('1. Column Profiling Metrics (AC1)', () => {
    it('total rows matches the manifest total_rows (131 rows)', () => {
      expect(report.totalRows).toBe(131);
      expect(report.totalRows).toBe(MANIFEST.total_rows);
    });

    it('per-record-type column totals match manifest by_record_type', () => {
      expect(col(report, 'category.code').totalRows).toBe(15);
      expect(col(report, 'warehouse.code').totalRows).toBe(6);
      expect(col(report, 'product.sku').totalRows).toBe(65);
      expect(col(report, 'stock_level.quantity').totalRows).toBe(45);

      expect(col(report, 'category.code').totalRows).toBe(MANIFEST.by_record_type['category']?.total);
      expect(col(report, 'warehouse.code').totalRows).toBe(MANIFEST.by_record_type['warehouse']?.total);
      expect(col(report, 'product.sku').totalRows).toBe(MANIFEST.by_record_type['product']?.total);
      expect(col(report, 'stock_level.quantity').totalRows).toBe(MANIFEST.by_record_type['stock_level']?.total);
    });

    it('null, populated, and distinct counts match an independent re-count of raw rows', () => {
      for (const rule of ERP1_COLUMN_RULES) {
        const key = `${rule.recordType}.${rule.column}`;
        const scoped = ROWS.filter((r) => r.record_type === rule.recordType);
        const values = scoped.map((r) => (r as Record<string, string>)[rule.column]?.trim() ?? '');
        const populated = values.filter((v) => v !== '');
        const p = col(report, key);

        expect(p.totalRows, `${key} totalRows`).toBe(scoped.length);
        expect(p.nullCount, `${key} nullCount`).toBe(values.length - populated.length);
        expect(p.populatedCount, `${key} populatedCount`).toBe(populated.length);
        expect(p.distinctCount, `${key} distinctCount`).toBe(new Set(populated).size);
      }
    });

    it('invalid format rate is strictly computed as (invalidFormatCount / totalRows) * 100 rounded to 2 dp', () => {
      for (const p of Object.values(report.columns)) {
        const expectedRate =
          p.totalRows > 0 ? Number(((p.invalidFormatCount / p.totalRows) * 100).toFixed(2)) : 0;
        expect(p.invalidFormatRate, `${p.recordType}.${p.column} rate`).toBe(expectedRate);
      }
    });

    it('computes top values capped at maxTopValues (5) sorted descending by frequency', () => {
      for (const p of Object.values(report.columns)) {
        expect(p.topValues.length).toBeLessThanOrEqual(5);
        for (let i = 1; i < p.topValues.length; i++) {
          const prev = p.topValues[i - 1]!;
          const curr = p.topValues[i]!;
          expect(prev.count).toBeGreaterThanOrEqual(curr.count);
        }
      }
    });
  });

  // ── AC4: Automated Assertions vs Manifest Pre-Calculated Numbers ───────────
  describe('2. Column Invalid Counts Match Manifest Numbers (AC4)', () => {
    const COLUMN_CASES: {
      key: string;
      expectedRowIds: string[];
      expectedCount: number;
    }[] = [
      {
        key: 'category.code',
        expectedRowIds: ['R009', 'R011', 'R014'],
        expectedCount: 3,
      },
      {
        key: 'category.name',
        expectedRowIds: ['R010', 'R015'],
        expectedCount: 2,
      },
      {
        key: 'warehouse.code',
        expectedRowIds: ['R017', 'R018', 'R019', 'R020', 'R021'],
        expectedCount: 5,
      },
      {
        key: 'warehouse.name',
        expectedRowIds: ['R019'],
        expectedCount: 1,
      },
      {
        key: 'warehouse.is_default',
        expectedRowIds: [],
        expectedCount: 0,
      },
      {
        key: 'product.name',
        expectedRowIds: ['R060', 'R082', 'R083', 'R084', 'R085', 'R086'],
        expectedCount: 6,
      },
      {
        key: 'product.sku',
        expectedRowIds: ['R061'],
        expectedCount: 1,
      },
      {
        key: 'product.category_code',
        expectedRowIds: ['R079'],
        expectedCount: 1,
      },
      {
        key: 'product.unit_of_measure',
        expectedRowIds: ['R062', 'R063', 'R064', 'R065'],
        expectedCount: 4,
      },
      {
        key: 'product.price',
        expectedRowIds: ['R066', 'R067', 'R068', 'R069', 'R070'],
        expectedCount: 5,
      },
      {
        key: 'product.currency',
        expectedRowIds: ['R071', 'R072', 'R073'],
        expectedCount: 3,
      },
      {
        key: 'product.tax_rate',
        expectedRowIds: ['R074', 'R075', 'R076', 'R077', 'R078'],
        expectedCount: 5,
      },
      {
        key: 'product.notification_email',
        expectedRowIds: ['R080'],
        expectedCount: 1,
      },
      {
        key: 'product.contact_phone',
        expectedRowIds: ['R081'],
        expectedCount: 1,
      },
      {
        key: 'stock_level.sku',
        expectedRowIds: ['R116', 'R117', 'R124', 'R129', 'R131'],
        expectedCount: 5,
      },
      {
        key: 'stock_level.warehouse_code',
        expectedRowIds: ['R118', 'R119', 'R120', 'R130', 'R131'],
        expectedCount: 5,
      },
      {
        key: 'stock_level.quantity',
        expectedRowIds: ['R114', 'R115', 'R121', 'R122', 'R123', 'R124', 'R130', 'R131'],
        expectedCount: 8,
      },
      {
        key: 'stock_level.as_of_date',
        expectedRowIds: ['R125', 'R126', 'R127', 'R128'],
        expectedCount: 4,
      },
    ];

    it.each(COLUMN_CASES)(
      '$key: invalid format count equals expected ($expectedCount)',
      ({ key, expectedRowIds, expectedCount }) => {
        expect(expectedRowIds.length).toBe(expectedCount);
        expect(col(report, key).invalidFormatCount, `${key} profiler invalidFormatCount`).toBe(
          expectedCount
        );
      }
    );

    it('manifest reason codes directly corroborate the profiled defect counts', () => {
      expect(MANIFEST.by_reason_code['CATEGORY_CODE_REQUIRED']).toBe(1);
      expect(MANIFEST.by_reason_code['CATEGORY_NAME_REQUIRED']).toBe(1);
      expect(MANIFEST.by_reason_code['CATEGORY_CODE_TOO_LONG']).toBe(1);
      expect(MANIFEST.by_reason_code['FORMULA_INJECTION_DETECTED']).toBe(9);
      expect(MANIFEST.by_reason_code['MULTIPLE_WAREHOUSES_REJECTED']).toBe(4);
      expect(MANIFEST.by_reason_code['WAREHOUSE_CODE_REQUIRED']).toBe(1);
      expect(MANIFEST.by_reason_code['WAREHOUSE_NAME_REQUIRED']).toBe(1);
      expect(MANIFEST.by_reason_code['PRODUCT_NAME_REQUIRED']).toBe(1);
      expect(MANIFEST.by_reason_code['SKU_REQUIRED']).toBe(1);
      expect(MANIFEST.by_reason_code['UNIT_OF_MEASURE_REQUIRED']).toBe(1);
      expect(MANIFEST.by_reason_code['INVALID_UNIT_OF_MEASURE']).toBe(3);
      expect(MANIFEST.by_reason_code['PRICE_REQUIRED']).toBe(1);
      expect(MANIFEST.by_reason_code['NEGATIVE_PRICE']).toBe(2);
      expect(MANIFEST.by_reason_code['INVALID_PRICE_FORMAT']).toBe(1);
      expect(MANIFEST.by_reason_code['EXCESS_DECIMAL_PLACES']).toBe(2);
      expect(MANIFEST.by_reason_code['CURRENCY_REQUIRED']).toBe(1);
      expect(MANIFEST.by_reason_code['INVALID_CURRENCY']).toBe(2);
      expect(MANIFEST.by_reason_code['NEGATIVE_TAX_RATE']).toBe(2);
      expect(MANIFEST.by_reason_code['TAX_RATE_OUT_OF_RANGE']).toBe(2);
      expect(MANIFEST.by_reason_code['INVALID_TAX_RATE_FORMAT']).toBe(1);
      expect(MANIFEST.by_reason_code['CATEGORY_NOT_FOUND']).toBe(1);
      expect(MANIFEST.by_reason_code['INVALID_EMAIL_FORMAT']).toBe(1);
      expect(MANIFEST.by_reason_code['INVALID_PHONE_FORMAT']).toBe(1);
      expect(MANIFEST.by_reason_code['PRODUCT_REQUIRED']).toBe(2);
      expect(MANIFEST.by_reason_code['PRODUCT_NOT_FOUND']).toBe(3);
      expect(MANIFEST.by_reason_code['WAREHOUSE_REQUIRED']).toBe(3);
      expect(MANIFEST.by_reason_code['WAREHOUSE_NOT_FOUND']).toBe(2);
      expect(MANIFEST.by_reason_code['QUANTITY_REQUIRED']).toBe(3);
      expect(MANIFEST.by_reason_code['NEGATIVE_STOCK']).toBe(3);
      expect(MANIFEST.by_reason_code['INVALID_QUANTITY_FORMAT']).toBe(1);
      expect(MANIFEST.by_reason_code['AMBIGUOUS_DATE_FORMAT']).toBe(2);
      expect(MANIFEST.by_reason_code['INVALID_DATE']).toBe(2);
    });
  });

  // ── AC2: Exact Duplicate Candidate Analysis ───────────────────────────────
  describe('3. Exact Duplicate Candidate Groups (AC2)', () => {
    const DUP_RULES = [
      {
        rule: 'category_code',
        recordType: 'category',
        reason: 'DUPLICATE_CATEGORY_CODE_REVIEW',
        expectedCount: 2,
        expectedGroups: [{ key: 'GEN', occurrences: 3, rowIds: ['R001', 'R012', 'R013'] }],
      },
      {
        rule: 'product_sku',
        recordType: 'product',
        reason: 'DUPLICATE_SKU_REVIEW',
        expectedCount: 3,
        expectedGroups: [
          { key: 'FAST-BOLT-HEX-001', occurrences: 3, rowIds: ['R022', 'R057', 'R058'] },
          { key: 'FAST-NUT-FLG-002', occurrences: 2, rowIds: ['R023', 'R059'] },
        ],
      },
      {
        rule: 'stock_level_key',
        recordType: 'stock_level',
        reason: 'DUPLICATE_STOCK_LEVEL_REVIEW',
        expectedCount: 2,
        expectedGroups: [
          { key: 'FAST-BOLT-HEX-001::WH-01', occurrences: 3, rowIds: ['R087', 'R112', 'R113'] },
        ],
      },
    ] as const;

    it.each(DUP_RULES)(
      '$rule: duplicate candidate count matches manifest expectation ($expectedCount)',
      ({ rule, reason, expectedCount, expectedGroups }) => {
        expect(MANIFEST.by_reason_code[reason]).toBe(expectedCount);

        const dupProfile = report.exactDuplicates[rule];
        if (!dupProfile) throw new Error(`Missing duplicate key profile: ${rule}`);

        expect(dupProfile.candidateCount).toBe(expectedCount);
        expect(dupProfile.groups.length).toBe(expectedGroups.length);

        for (let i = 0; i < expectedGroups.length; i++) {
          const expected = expectedGroups[i]!;
          const actual = dupProfile.groups[i]!;
          expect(actual.key).toBe(expected.key);
          expect(actual.occurrences).toBe(expected.occurrences);
          expect([...actual.rowIds]).toEqual([...expected.rowIds]);
        }

        // Duplicate review candidates (non-first group members) match manifest review row IDs
        const manifestReviewRows = manifestRowIds(dupProfile.recordType!, [reason]).sort();
        const nonFirstMembers = dupProfile.groups.flatMap((g) => g.rowIds.slice(1)).sort();
        expect(nonFirstMembers).toEqual(manifestReviewRows);
      }
    );

    it('total exact duplicate candidates sum to 7 (matching manifest reconciliation review count)', () => {
      const totalCandidates = Object.values(report.exactDuplicates).reduce(
        (sum, d) => sum + d.candidateCount,
        0
      );
      expect(totalCandidates).toBe(7);
      expect(totalCandidates).toBe(MANIFEST.reconciliation.review);
    });

    it('enforces deterministic exact matching only (zero fuzzy scoring rules)', () => {
      expect(ERP1_DUPLICATE_KEY_RULES.map((r) => r.name)).toEqual([
        'category_code',
        'product_sku',
        'stock_level_key',
      ]);
    });
  });

  // ── AC3: Strictly Non-Destructive Operation ───────────────────────────────
  describe('4. Non-Destructive Guarantee & Immutability (AC3)', () => {
    it('source CSV text bytes and SHA-256 remain untouched and match manifest', () => {
      const beforeHash = sha256Hex(CSV_TEXT);
      expect(beforeHash).toBe(MANIFEST.fixture_sha256);

      const r = profileErp1Dataset(ROWS, CSV_TEXT);
      expect(r.isNonDestructive).toBe(true);
      expect(r.sha256).toBe(MANIFEST.fixture_sha256);

      const afterText = readFileSync(CSV_PATH, 'utf8');
      expect(sha256Hex(afterText)).toBe(beforeHash);
      expect(afterText).toBe(CSV_TEXT);
    });

    it('does not mutate parsed input rows (deep-frozen rows survive unharmed)', () => {
      const frozenRows = parseCsv(CSV_TEXT).map((row) => Object.freeze({ ...row }));
      const snapshot = JSON.stringify(frozenRows);
      expect(() => profileErp1Dataset(frozenRows, CSV_TEXT)).not.toThrow();
      expect(JSON.stringify(frozenRows)).toBe(snapshot);
    });

    it('is completely deterministic across repeated profiling executions', () => {
      const report1 = profileErp1Dataset(ROWS, CSV_TEXT);
      const report2 = profileErp1Dataset(ROWS, CSV_TEXT);

      const normalize = (r: DatasetProfileReport) => JSON.stringify({ ...r, generatedAt: '' });
      expect(normalize(report1)).toBe(normalize(report2));
    });
  });

  // ── Sensitive Financial & Employee PII Protection ─────────────────────────
  describe('5. Sensitive Data Protection (Zero PII Leakage)', () => {
    const csvExport = exportErp1ProfileCsv(report);

    it('supplier_bank_account and employee_ssn are not profiled (no column rules)', () => {
      expect(report.columns['product.supplier_bank_account']).toBeUndefined();
      expect(report.columns['product.employee_ssn']).toBeUndefined();
      expect(Object.keys(report.columns).some((k) => k.includes('bank_account'))).toBe(false);
      expect(Object.keys(report.columns).some((k) => k.includes('ssn'))).toBe(false);
    });

    it('raw bank account numbers (CH93-0000...) never appear in profile report or CSV export', () => {
      const rawBankAccounts = ROWS.map((r) => r.supplier_bank_account?.trim()).filter(Boolean);
      expect(rawBankAccounts.length).toBeGreaterThan(0);

      const serializedReport = JSON.stringify(report);
      for (const bank of rawBankAccounts) {
        expect(serializedReport).not.toContain(bank);
        expect(csvExport).not.toContain(bank);
      }
      expect(serializedReport).not.toContain('CH93-0000');
      expect(csvExport).not.toContain('CH93-0000');
    });

    it('raw employee SSN numbers (999-00-...) never appear in profile report or CSV export', () => {
      const rawSsns = ROWS.map((r) => r.employee_ssn?.trim()).filter(Boolean);
      expect(rawSsns.length).toBeGreaterThan(0);

      const serializedReport = JSON.stringify(report);
      for (const ssn of rawSsns) {
        expect(serializedReport).not.toContain(ssn);
        expect(csvExport).not.toContain(ssn);
      }
      expect(serializedReport).not.toContain('999-00-');
      expect(csvExport).not.toContain('999-00-');
    });
  });

  // ── OWASP Formula Injection Defense & CSV Export ──────────────────────────
  describe('6. Formula-Safe CSV Data Health Export (KIT-03 / PLT-12)', () => {
    const csvExport = exportErp1ProfileCsv(report);

    it('includes required metadata header, column metrics, and duplicate sections', () => {
      expect(csvExport).toContain('# ClearShift Data Health Profile Report');
      expect(csvExport).toContain(`Source SHA-256: ${MANIFEST.fixture_sha256}`);
      expect(csvExport).toContain('## Section 1: Column Quality Metrics');
      expect(csvExport).toContain('## Section 2: Exact Duplicate Candidate Groups');
    });

    it('neutralises formula-injection values in exported CSV cells', () => {
      const dangerousInputs: [string, string][] = [
        ['=cmd|\' /C calc\'!A0', '\'=cmd|\' /C calc\'!A0'],
        ['+FormulaInjection', '\'+FormulaInjection'],
        ['-999Formula', '\'-999Formula'],
        ['@SUM(1,2)', '\'@SUM(1,2)'],
      ];

      for (const [dangerous, sanitized] of dangerousInputs) {
        const testRows = [
          {
            row_id: 'TEST-1',
            record_type: 'product',
            name: dangerous,
            sku: 'SKU-INJ-001',
            unit_of_measure: 'pcs',
            price: '10.0000',
            currency: 'USD',
          },
        ];
        const profiled = profileErp1Dataset(testRows);
        const exported = exportErp1ProfileCsv(profiled);
        expect(exported).toContain(sanitized);
        expect(col(profiled, 'product.name').invalidFormatCount).toBe(1);
      }
    });
  });
});
