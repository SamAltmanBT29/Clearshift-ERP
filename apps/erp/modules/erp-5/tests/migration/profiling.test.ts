/**
 * ERP-5 HR & Employees — Profiling Configuration & Expected-Result Assertions
 * (Issue #202 / ERP5-26 / KIT-03)
 *
 * Verifies:
 *  AC1  Profiler computes total rows, null counts, distinct values and invalid-format rates.
 *  AC2  Exact duplicate candidate count matches the ERP5-25 manifest expectation.
 *  AC3  Profiling is strictly non-destructive; source data remains untouched.
 *  AC4  Profiler output matches pre-calculated manifest numbers.
 *
 * @module erp5/tests/migration/profiling.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ColumnProfile, DatasetProfileReport } from '@cs/kit';
import {
  ERP5_COLUMN_RULES,
  ERP5_DUPLICATE_KEY_RULES,
  exportErp5ProfileCsv,
  profileErp5Dataset,
} from '../../src/migration/profiling-config.js';
import {
  FIXTURE_PATH,
  parseCsv,
  type ProfileReport,
} from '../../src/migration/dirty-data-plan.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const CSV_PATH = resolve(REPO_ROOT, FIXTURE_PATH);
const MANIFEST_PATH = resolve(REPO_ROOT, 'sample-data/erp-5/expected-profile.json');

const CSV_TEXT = readFileSync(CSV_PATH, 'utf8');
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ProfileReport;
const ROWS = parseCsv(CSV_TEXT);

const col = (report: DatasetProfileReport, key: string): ColumnProfile => {
  const c = report.columns[key];
  if (!c) throw new Error(`Missing column profile: ${key}`);
  return c;
};

describe('[ERP5-26] ERP-5 Profiling Configuration & Expected-Result Assertions (#202)', () => {
  const report = profileErp5Dataset(ROWS, CSV_TEXT);

  // ── AC1: Column profiling metrics ──────────────────────────────────────────
  describe('1. Column profiling metrics (AC1)', () => {
    it('total rows match the manifest', () => {
      expect(report.totalRows).toBe(130);
      expect(report.totalRows).toBe(MANIFEST.fixture.row_count);
    });

    it('per-record-type column totals match manifest by_record_type', () => {
      expect(col(report, 'department.department_code').totalRows).toBe(20);
      expect(col(report, 'employee.employee_no').totalRows).toBe(60);
      expect(col(report, 'leave.employee_no').totalRows).toBe(30);
      expect(col(report, 'payroll_total.department_code').totalRows).toBe(20);

      expect(col(report, 'department.department_code').totalRows).toBe(
        MANIFEST.by_record_type['department']?.total,
      );
      expect(col(report, 'employee.employee_no').totalRows).toBe(
        MANIFEST.by_record_type['employee']?.total,
      );
      expect(col(report, 'leave.employee_no').totalRows).toBe(
        MANIFEST.by_record_type['leave']?.total,
      );
      expect(col(report, 'payroll_total.department_code').totalRows).toBe(
        MANIFEST.by_record_type['payroll_total']?.total,
      );
    });

    it('computes distinct counts, null counts, and invalid format rates', () => {
      for (const rule of ERP5_COLUMN_RULES) {
        const key = `${rule.recordType}.${rule.column}`;
        const p = col(report, key);
        expect(p.totalRows).toBeGreaterThan(0);
        expect(p.populatedCount + p.nullCount).toBe(p.totalRows);
        expect(p.distinctCount).toBeGreaterThanOrEqual(0);
        expect(p.invalidFormatRate).toBeGreaterThanOrEqual(0);
        expect(p.invalidFormatRate).toBeLessThanOrEqual(100);
      }
    });

    it('identifies invalid format rows for join date before birth date (BR-ERP5-01)', () => {
      const joinDateProfile = col(report, 'employee.join_date');
      expect(joinDateProfile.invalidFormatCount).toBeGreaterThanOrEqual(4);
    });
  });

  // ── AC2: Duplicate candidate groups ────────────────────────────────────────
  describe('2. Exact duplicate candidate groups (AC2)', () => {
    it('detects duplicate candidate groups matching the manifest review counts', () => {
      const deptDupProfile = report.exactDuplicates['department_code'];
      expect(deptDupProfile).toBeDefined();
      expect(deptDupProfile?.candidateCount).toBe(2);

      const empDupProfile = report.exactDuplicates['employee_no'];
      expect(empDupProfile).toBeDefined();
      expect(empDupProfile?.candidateCount).toBe(4);

      const leaveDupProfile = report.exactDuplicates['leave_request'];
      expect(leaveDupProfile).toBeDefined();
      expect(leaveDupProfile?.candidateCount).toBe(2);

      const payDupProfile = report.exactDuplicates['payroll_aggregate'];
      expect(payDupProfile).toBeDefined();
      expect(payDupProfile?.candidateCount).toBe(2);
    });

    it('total duplicate candidates sum to exactly 10 matching manifest review total', () => {
      const totalCandidateCount = Object.values(report.exactDuplicates).reduce(
        (sum, p) => sum + p.candidateCount,
        0,
      );
      expect(totalCandidateCount).toBe(MANIFEST.reconciliation.review);
      expect(totalCandidateCount).toBe(10);
    });
  });

  // ── AC3: Non-destructive profiling ─────────────────────────────────────────
  describe('3. Non-destructive profiling guarantee (AC3)', () => {
    it('guarantees source data array is never mutated during profiling', () => {
      const snapshot = JSON.stringify(ROWS);
      profileErp5Dataset(ROWS, CSV_TEXT);
      expect(JSON.stringify(ROWS)).toBe(snapshot);
    });

    it('report marks isNonDestructive true and matches SHA-256', () => {
      expect(report.isNonDestructive).toBe(true);
      expect(report.sha256).toBe(MANIFEST.fixture.sha256);
    });
  });

  // ── AC4: Automated assertions against manifest ──────────────────────────────
  describe('4. Manifest comparison & export security (AC4)', () => {
    it('produces formula-safe CSV data health export', () => {
      const csv = exportErp5ProfileCsv(report);
      expect(csv).toContain('Column,Label,Total Rows,Populated,Null Count,Distinct Count,Invalid Count,Invalid Rate (%),Top 5 Values');
      // No raw formula injection unescaped
      expect(csv).not.toContain('\n=cmd');
    });

    it('salary is not profiled to protect compensation privacy (BR-ERP5-02, DR-5)', () => {
      const salaryColumn = Object.keys(report.columns).find((k) => k.endsWith('.salary'));
      expect(salaryColumn).toBeUndefined();
    });
  });
});
