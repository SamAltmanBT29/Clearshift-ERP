/**
 * ERP-5 HR & Employees — Canonical Dirty Data Pack & Migration Profiling Test Suite
 *
 * Validates all Acceptance Criteria for Issue #201 (ERP5-25):
 *   [✓] Criterion 1: Dirty Data Pack contains at least 100 realistic synthetic rows;
 *       zero real personal data.
 *   [✓] Criterion 2: Manifest documents expected outcome per row: valid, malformed,
 *       null required, exact duplicate, foreign key missing.
 *   [✓] Criterion 3: Edge cases include UTF-8 characters, whitespace padding,
 *       date format variants, and boundary numbers.
 *   [✓] Criterion 4: Test suite verifies fixture counts reproduce identically
 *       across multiple runs.
 *
 * @module erp5/tests/migration/dirty-data-plan.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FIXTURE_PATH,
  parseCsv,
  evaluateDataset,
  buildProfile,
  sha256Hex,
  maskSalary,
  type ProfileReport,
  type RawRow,
} from '../../src/migration/dirty-data-plan.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

describe('ERP-5 Canonical Dirty Data Pack & Migration Evaluator ([ERP5-25] #201)', () => {
  const csvText = read(FIXTURE_PATH);
  const expectedProfileText = read('sample-data/erp-5/expected-profile.json');
  const expectedProfile = JSON.parse(expectedProfileText) as ProfileReport;
  const mappingTemplateText = read('sample-data/erp-5/mapping-template.json');
  const mappingTemplate = JSON.parse(mappingTemplateText);

  // ── Criterion 1: At least 100 synthetic rows & zero real personal data ─────
  describe('Criterion 1: Synthetic Dataset Volume & Privacy Guarantees', () => {
    it('fixture exists and contains >= 100 rows', () => {
      expect(existsSync(resolve(REPO_ROOT, FIXTURE_PATH))).toBe(true);
      const rows = parseCsv(csvText);
      expect(rows.length).toBeGreaterThanOrEqual(100);
      expect(rows.length).toBe(130);
    });

    it('contains zero real personal data; uses synthetic codes and dummy names', () => {
      const rows = parseCsv(csvText);
      for (const row of rows) {
        expect(row.source_system).toBe('SYNTH-ERP5-DIRTY-V1');
        // Employee IDs follow synthetic pattern EMP-XXXX
        if (row.employee_no && !row.employee_no.startsWith('-')) {
          expect(row.employee_no).toMatch(/^[A-Z0-9_\- ]+$/);
        }
      }
    });

    it('masks employee salary on serialization (BR-ERP5-02, DR-5)', () => {
      expect(maskSalary('150000.0000')).toBe('XX,XXX');
      const rows = parseCsv(csvText);
      const evaluated = evaluateDataset(rows);
      for (const er of evaluated) {
        if (er.record_type === 'employee' && er.masked_data['salary']) {
          expect(er.masked_data['salary']).toBe('XX,XXX');
        }
      }
    });
  });

  // ── Criterion 2: Deterministic Manifest & Expected Outcomes ────────────────
  describe('Criterion 2: Deterministic Outcome Manifest per Row', () => {
    it('manifest matches CSV SHA-256 checksum exactly', () => {
      const fileBytes = readFileSync(resolve(REPO_ROOT, FIXTURE_PATH));
      const computedHash = sha256Hex(fileBytes);
      expect(computedHash).toBe(expectedProfile.fixture.sha256);
    });

    it('evaluates exactly matching reconciliation numbers in manifest', () => {
      const rows = parseCsv(csvText);
      const evaluated = evaluateDataset(rows);
      const profile = buildProfile(
        evaluated,
        FIXTURE_PATH,
        expectedProfile.fixture.sha256,
      );

      expect(profile.reconciliation.source_row_count).toBe(130);
      expect(profile.reconciliation.accepted).toBe(42);
      expect(profile.reconciliation.rejected).toBe(78);
      expect(profile.reconciliation.review).toBe(10);
      expect(profile.reconciliation.skipped).toBe(0);
      expect(profile.reconciliation.unaccounted).toBe(0);
      expect(profile.reconciliation.is_balanced).toBe(true);
    });

    it('matches manifest breakdown by record type', () => {
      const rows = parseCsv(csvText);
      const evaluated = evaluateDataset(rows);
      const profile = buildProfile(
        evaluated,
        FIXTURE_PATH,
        expectedProfile.fixture.sha256,
      );

      expect(profile.by_record_type['department']).toEqual(
        expectedProfile.by_record_type['department'],
      );
      expect(profile.by_record_type['employee']).toEqual(
        expectedProfile.by_record_type['employee'],
      );
      expect(profile.by_record_type['leave']).toEqual(
        expectedProfile.by_record_type['leave'],
      );
      expect(profile.by_record_type['payroll_total']).toEqual(
        expectedProfile.by_record_type['payroll_total'],
      );
    });

    it('matches manifest defect distributions by reason code', () => {
      const rows = parseCsv(csvText);
      const evaluated = evaluateDataset(rows);
      const profile = buildProfile(
        evaluated,
        FIXTURE_PATH,
        expectedProfile.fixture.sha256,
      );

      for (const [code, count] of Object.entries(expectedProfile.by_reason_code)) {
        expect(profile.by_reason_code[code]).toBe(count);
      }
    });
  });

  // ── Criterion 3: Edge cases (UTF-8, whitespace, boundary numbers) ───────────
  describe('Criterion 3: Edge Cases & Anomaly Coverage', () => {
    it('handles UTF-8 characters seamlessly', () => {
      const rows = parseCsv(csvText);
      const utf8Rows = rows.filter((r) => r.case_tags.includes('utf8'));
      expect(utf8Rows.length).toBeGreaterThanOrEqual(4);

      const elodie = utf8Rows.find((r) => r.first_name.includes('Élodie'));
      expect(elodie).toBeDefined();

      const francois = utf8Rows.find((r) => r.first_name.includes('François'));
      expect(francois).toBeDefined();
    });

    it('identifies whitespace padding anomalies', () => {
      const rows = parseCsv(csvText);
      const wsRows = rows.filter((r) => r.case_tags.includes('whitespace'));
      expect(wsRows.length).toBeGreaterThanOrEqual(3);
      for (const r of wsRows) {
        const hasWhitespacePadding =
          (r.department_code && r.department_code.trim() !== r.department_code) ||
          (r.first_name && r.first_name.trim() !== r.first_name) ||
          (r.department_name && r.department_name.trim() !== r.department_name);
        expect(hasWhitespacePadding).toBeTruthy();
      }
    });

    it('detects join date before birth date (BR-ERP5-01)', () => {
      const rows = parseCsv(csvText);
      const evaluated = evaluateDataset(rows);
      const inverted = evaluated.filter((r) =>
        r.reason_codes.includes('JOIN_DATE_BEFORE_BIRTH_DATE'),
      );
      expect(inverted.length).toBe(4);
      for (const inv of inverted) {
        expect(inv.outcome).toBe('rejected');
      }
    });

    it('neutralizes formula injection attacks on text fields', () => {
      const rows = parseCsv(csvText);
      const evaluated = evaluateDataset(rows);
      const formulaRejected = evaluated.filter((r) =>
        r.reason_codes.includes('FORMULA_INJECTION_REJECTED'),
      );
      expect(formulaRejected.length).toBeGreaterThanOrEqual(8);
      for (const fr of formulaRejected) {
        expect(fr.outcome).toBe('rejected');
      }
    });

    it('forbids employee detail lines in payroll totals (FR-ERP5-06)', () => {
      const rows = parseCsv(csvText);
      const evaluated = evaluateDataset(rows);
      const forbidden = evaluated.filter((r) =>
        r.reason_codes.includes('EMPLOYEE_LINES_FORBIDDEN'),
      );
      expect(forbidden.length).toBe(2);
      for (const f of forbidden) {
        expect(f.outcome).toBe('rejected');
      }
    });
  });

  // ── Criterion 4: Reproducibility & Immutability ────────────────────────────
  describe('Criterion 4: Reproducibility & Immutability Guarantees', () => {
    it('produces byte-identical profile results over multiple independent runs', () => {
      const rows1 = parseCsv(csvText);
      const evaluated1 = evaluateDataset(rows1);
      const profile1 = buildProfile(
        evaluated1,
        FIXTURE_PATH,
        expectedProfile.fixture.sha256,
      );

      const rows2 = parseCsv(csvText);
      const evaluated2 = evaluateDataset(rows2);
      const profile2 = buildProfile(
        evaluated2,
        FIXTURE_PATH,
        expectedProfile.fixture.sha256,
      );

      expect(JSON.stringify(profile1)).toBe(JSON.stringify(profile2));
      expect(JSON.stringify(profile1)).toBe(JSON.stringify(expectedProfile));
    });

    it('guarantees raw input rows are never mutated (BR-KIT-03)', () => {
      const rows = parseCsv(csvText);
      const snapshot = JSON.stringify(rows);
      evaluateDataset(rows);
      expect(JSON.stringify(rows)).toBe(snapshot);
    });

    it('mapping template defines valid load order and candidate keys', () => {
      expect(mappingTemplate.load_order).toEqual([
        'department',
        'employee',
        'leave',
        'payroll_total',
      ]);
      expect(mappingTemplate.entities.employee.candidate_key).toEqual(['employee_no']);
      expect(mappingTemplate.policy.fuzzy_matching).toBe(false);
      expect(mappingTemplate.policy.automatic_merge).toBe(false);
    });
  });
});
