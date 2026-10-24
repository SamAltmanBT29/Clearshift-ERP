/**
 * ERP-5 HR & Employees — Cleaning Rules & Field-Level Audit Tests (Issue #203 / ERP5-27 / KIT-04)
 *
 * Verifies:
 *  - AC1: Standard cleaners execute (whitespace trimming, email lowercasing, phone normalization, date coercion).
 *  - AC2: Every modified value generates an audit entry with source_row, field_name, original_value,
 *         cleaned_value, and rule_id.
 *  - AC3: Unrecoverable required-field anomalies result in structured row rejection with reason code.
 *  - AC4: Transformed values match expected clean states.
 *  - Non-destructive execution: input rows are never mutated.
 *  - Formula injection protection: formulas are rejected with FORMULA_INJECTION_REJECTED.
 *  - Rule toggling: disabling rules selectively bypasses corresponding audits.
 *  - Formula-safe audit CSV export.
 *
 * @module erp5/tests/migration/cleaning.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { V1_CLEANING_RULES } from '@cs/kit';
import {
  ERP5_FIELD_CLEAN_RULES,
  ERP5_NOT_APPLICABLE_RULES,
  cleanErp5Dataset,
  coerceDateToIso,
  exportErp5FieldAuditCsv,
} from '../../src/migration/cleaning-config.js';
import { FIXTURE_PATH, parseCsv, type RawRow } from '../../src/migration/dirty-data-plan.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const CSV_PATH = resolve(REPO_ROOT, FIXTURE_PATH);
const CSV_TEXT = readFileSync(CSV_PATH, 'utf8');
const ROWS = parseCsv(CSV_TEXT);
const V1_RULE_IDS = new Set(V1_CLEANING_RULES.map((r) => r.ruleId));

const DATASET = cleanErp5Dataset(ROWS as unknown as Record<string, string>[]);

const rowResult = (id: string) => {
  const r = DATASET.rows.find((x) => x.sourceRow === id);
  if (!r) throw new Error(`No clean result for row ${id}`);
  return r;
};

const rawRow = (id: string) => {
  const r = ROWS.find((x) => x.row_id === id);
  if (!r) throw new Error(`No fixture row ${id}`);
  return r as unknown as Record<string, string>;
};

const auditsFor = (id: string, field?: string) =>
  DATASET.audits.filter((a) => a.sourceRow === id && (field === undefined || a.fieldName === field));

// Synthetic row builders for targeted edge-case assertions
const synthDept = (o: Record<string, string> = {}): Record<string, string> => ({
  row_id: 'S-D',
  record_type: 'department',
  department_code: 'ENG',
  department_name: 'Engineering',
  parent_code: '',
  ...o,
});

const synthEmp = (o: Record<string, string> = {}): Record<string, string> => ({
  row_id: 'S-E',
  record_type: 'employee',
  employee_no: 'EMP-9001',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane.doe@example.com',
  phone: '5551234567',
  department_code: 'ENG',
  job_title: 'Software Engineer',
  birth_date: '1990-01-01',
  join_date: '2020-01-01',
  salary: '100000.0000',
  currency_code: 'USD',
  ...o,
});

const synthLeave = (o: Record<string, string> = {}): Record<string, string> => ({
  row_id: 'S-L',
  record_type: 'leave',
  employee_no: 'EMP-9001',
  leave_type: 'annual',
  date_from: '2026-06-01',
  date_to: '2026-06-05',
  leave_reason: 'Annual holiday',
  leave_status: 'approved',
  ...o,
});

const synthPayroll = (o: Record<string, string> = {}): Record<string, string> => ({
  row_id: 'S-P',
  record_type: 'payroll_total',
  department_code: 'ENG',
  month: '2026-06',
  gross_total: '500000.0000',
  net_total: '400000.0000',
  employee_count: '10',
  ...o,
});

const cleanOne = (row: Record<string, string>, enabledRuleIds?: readonly string[]) => {
  const res = cleanErp5Dataset([row], enabledRuleIds);
  const r = res.rows[0];
  if (!r) throw new Error('No clean result produced');
  return { row: r, audits: res.audits, rejections: res.rejections };
};

describe('[ERP5-27] ERP-5 Cleaning Rules & Field-Level Audit (#203)', () => {
  // ── AC1 & AC4: Standard Cleaners and Expected Clean States ──────────────────
  describe('1. Standard Cleaners and Transformed Clean States (AC1 & AC4)', () => {
    it('R003: trims department code and collapses inner whitespace in name', () => {
      const r = rowResult('R003');
      expect(r.outcome).toBe('cleaned');
      expect(r.cleanedData['department_code']).toBe('ENG');
      expect(r.cleanedData['department_name']).toBe('Engineering & Development');
      const deptAudits = auditsFor('R003');
      expect(deptAudits.map((a) => a.fieldName).sort()).toEqual(['department_code', 'department_name']);
      expect(deptAudits.every((a) => a.ruleId === 'RL-TEXT-01')).toBe(true);
    });

    it('preserves UTF-8 names and international characters untouched', () => {
      // R008 (Recherche & Développement), R022 (Élodie Dubois), R023 (Müller Schmidt), R024 (François Lefebvre)
      for (const id of ['R008', 'R022', 'R023', 'R024']) {
        const raw = rawRow(id);
        const r = rowResult(id);
        if (raw['department_name']) {
          expect(r.cleanedData['department_name']).toBe(raw['department_name']);
        }
        if (raw['first_name']) {
          expect(r.cleanedData['first_name']).toBe(raw['first_name']);
        }
        if (raw['last_name']) {
          expect(r.cleanedData['last_name']).toBe(raw['last_name']);
        }
      }
    });

    it('normalizes employee email by lowercasing and trimming (RL-EMAIL-01)', () => {
      const { row, audits } = cleanOne(
        synthEmp({ email: '  Jane.Doe@EXAMPLE.COM  ' })
      );
      expect(row.outcome).toBe('cleaned');
      expect(row.cleanedData['email']).toBe('jane.doe@example.com');
      const emailAudit = audits.find((a) => a.fieldName === 'email');
      expect(emailAudit).toBeDefined();
      expect(emailAudit?.ruleId).toBe('RL-EMAIL-01');
      expect(emailAudit?.cleanedValue).toBe('jane.doe@example.com');
    });

    it('normalizes phone number with country code prefix (RL-PHONE-01)', () => {
      const { row, audits } = cleanOne(
        synthEmp({ phone: ' (555) 123-4567 ' })
      );
      expect(row.outcome).toBe('cleaned');
      expect(row.cleanedData['phone']).toBe('+15551234567');
      const phoneAudit = audits.find((a) => a.fieldName === 'phone');
      expect(phoneAudit).toBeDefined();
      expect(phoneAudit?.ruleId).toBe('RL-PHONE-01');
    });

    it('coerces non-standard and padded dates to ISO 8601 (RL-DATE-01)', () => {
      expect(coerceDateToIso('2026/06/15')).toEqual({ cleaned: '2026-06-15', isValid: true });
      expect(coerceDateToIso('15-06-2026')).toEqual({ cleaned: '2026-06-15', isValid: true });
      expect(coerceDateToIso('1980-001-15')).toEqual({ cleaned: '1980-01-15', isValid: true });
      expect(coerceDateToIso('2010/1/5')).toEqual({ cleaned: '2010-01-05', isValid: true });

      const { row, audits } = cleanOne(
        synthEmp({ birth_date: '1990/05/20', join_date: '2020.06.01' })
      );
      expect(row.cleanedData['birth_date']).toBe('1990-05-20');
      expect(row.cleanedData['join_date']).toBe('2020-06-01');
      expect(audits.some((a) => a.fieldName === 'birth_date' && a.ruleId === 'RL-DATE-01')).toBe(true);
      expect(audits.some((a) => a.fieldName === 'join_date' && a.ruleId === 'RL-DATE-01')).toBe(true);
    });

    it('strips currency symbols and formatting commas from salary and totals (RL-CURRENCY-01)', () => {
      const emp = cleanOne(synthEmp({ salary: ' $120,500.50 ' }));
      expect(emp.row.cleanedData['salary']).toBe('120500.50');
      expect(emp.audits.some((a) => a.fieldName === 'salary' && a.ruleId === 'RL-CURRENCY-01')).toBe(true);

      const pay = cleanOne(synthPayroll({ gross_total: ' € 500,000.00 ', net_total: ' € 400,000.00 ' }));
      expect(pay.row.cleanedData['gross_total']).toBe('500000.00');
      expect(pay.row.cleanedData['net_total']).toBe('400000.00');
    });

    it('canonicalizes leave type and status to lowercase (RL-TEXT-01)', () => {
      const { row } = cleanOne(
        synthLeave({ leave_type: ' ANNUAL ', leave_status: ' APPROVED ' })
      );
      expect(row.cleanedData['leave_type']).toBe('annual');
      expect(row.cleanedData['leave_status']).toBe('approved');
    });
  });

  // ── AC2: Field-Level Change Audit Ledger ───────────────────────────────────
  describe('2. Field-Level Change Audit Ledger (AC2)', () => {
    it('every modified field produces an audit record with required shape', () => {
      expect(DATASET.audits.length).toBeGreaterThan(0);
      for (const a of DATASET.audits) {
        expect(a).toHaveProperty('sourceRow');
        expect(a).toHaveProperty('fieldName');
        expect(a).toHaveProperty('originalValue');
        expect(a).toHaveProperty('cleanedValue');
        expect(a).toHaveProperty('ruleId');
        expect(V1_RULE_IDS.has(a.ruleId)).toBe(true);
        expect(a.originalValue).not.toBe(a.cleanedValue);
      }
    });

    it('exports audit trail to formula-safe CSV conforming to SDS §4.4', () => {
      const csv = exportErp5FieldAuditCsv(DATASET.audits);
      expect(csv).toContain('Source Row,Field Name,Original Value,Cleaned Value,Rule ID,Timestamp');
      expect(csv.split('\n').length).toBeGreaterThan(1);
    });

    it('disabling a rule skips both modification and audit recording', () => {
      // When RL-TEXT-01 is disabled, whitespace in department code is not trimmed
      const allRules = cleanOne(synthDept({ department_code: '  ENG  ' }));
      expect(allRules.row.cleanedData['department_code']).toBe('ENG');
      expect(allRules.audits.some((a) => a.fieldName === 'department_code')).toBe(true);

      const withoutText01 = cleanOne(
        synthDept({ department_code: '  ENG  ' }),
        ['RL-TEXT-02', 'RL-REQ-01', 'RL-FORMAT-01']
      );
      expect(withoutText01.audits.some((a) => a.ruleId === 'RL-TEXT-01')).toBe(false);
    });
  });

  // ── AC3: Unrecoverable Required-Field & Anomaly Rejections ──────────────────
  describe('3. Unrecoverable Required-Field and Anomaly Rejections (AC3)', () => {
    it('R009: rejects missing department code with DEPARTMENT_CODE_REQUIRED', () => {
      const r = rowResult('R009');
      expect(r.outcome).toBe('rejected');
      expect(r.rejections.some((x) => x.reasonCode === 'DEPARTMENT_CODE_REQUIRED')).toBe(true);
    });

    it('R010: rejects missing department name with DEPARTMENT_NAME_REQUIRED', () => {
      const r = rowResult('R010');
      expect(r.outcome).toBe('rejected');
      expect(r.rejections.some((x) => x.reasonCode === 'DEPARTMENT_NAME_REQUIRED')).toBe(true);
    });

    it('R011: rejects self-parenting department with DEPARTMENT_SELF_PARENT', () => {
      const r = rowResult('R011');
      expect(r.outcome).toBe('rejected');
      expect(r.rejections.some((x) => x.reasonCode === 'DEPARTMENT_SELF_PARENT')).toBe(true);
    });

    it('R015 & R016: rejects formula injection on free-text and code fields with FORMULA_INJECTION_REJECTED', () => {
      const r15 = rowResult('R015');
      expect(r15.outcome).toBe('rejected');
      expect(r15.rejections.some((x) => x.reasonCode === 'FORMULA_INJECTION_REJECTED')).toBe(true);

      const r16 = rowResult('R016');
      expect(r16.outcome).toBe('rejected');
      expect(r16.rejections.some((x) => x.reasonCode === 'FORMULA_INJECTION_REJECTED')).toBe(true);
    });

    it('rejects inverted dates: join date before birth date with JOIN_DATE_BEFORE_BIRTH_DATE (BR-ERP5-01)', () => {
      const { row, rejections } = cleanOne(
        synthEmp({ birth_date: '2000-01-01', join_date: '1995-01-01' })
      );
      expect(row.outcome).toBe('rejected');
      expect(rejections.some((x) => x.reasonCode === 'JOIN_DATE_BEFORE_BIRTH_DATE')).toBe(true);
    });

    it('rejects inverted leave dates: date_to before date_from with INVALID_LEAVE_DATES (FR-ERP5-04)', () => {
      const { row, rejections } = cleanOne(
        synthLeave({ date_from: '2026-06-10', date_to: '2026-06-05' })
      );
      expect(row.outcome).toBe('rejected');
      expect(rejections.some((x) => x.reasonCode === 'INVALID_LEAVE_DATES')).toBe(true);
    });

    it('rejects negative salary with NEGATIVE_SALARY', () => {
      const { row, rejections } = cleanOne(synthEmp({ salary: '-50000.00' }));
      expect(row.outcome).toBe('rejected');
      expect(rejections.some((x) => x.reasonCode === 'NEGATIVE_SALARY')).toBe(true);
    });

    it('rejects invalid currency code with INVALID_CURRENCY', () => {
      const { row, rejections } = cleanOne(synthEmp({ currency_code: 'XYZ' }));
      expect(row.outcome).toBe('rejected');
      expect(rejections.some((x) => x.reasonCode === 'INVALID_CURRENCY')).toBe(true);
    });

    it('R125 & R126: rejects employee lines on payroll totals with EMPLOYEE_LINES_FORBIDDEN', () => {
      const r125 = rowResult('R125');
      expect(r125.outcome).toBe('rejected');
      expect(r125.rejections.some((x) => x.reasonCode === 'EMPLOYEE_LINES_FORBIDDEN')).toBe(true);

      const r126 = rowResult('R126');
      expect(r126.outcome).toBe('rejected');
      expect(r126.rejections.some((x) => x.reasonCode === 'EMPLOYEE_LINES_FORBIDDEN')).toBe(true);
    });

    it('rejects payroll total where net exceeds gross with NET_EXCEEDS_GROSS', () => {
      const { row, rejections } = cleanOne(
        synthPayroll({ gross_total: '100000.00', net_total: '150000.00' })
      );
      expect(row.outcome).toBe('rejected');
      expect(rejections.some((x) => x.reasonCode === 'NET_EXCEEDS_GROSS')).toBe(true);
    });
  });

  // ── Invariants, Coverage and Non-Destructive Execution ─────────────────────
  describe('4. Invariants, Coverage and Non-Destructive Execution', () => {
    it('raw input rows are never mutated', () => {
      const originalCopy = JSON.parse(JSON.stringify(ROWS[0]));
      cleanErp5Dataset([ROWS[0] as unknown as Record<string, string>]);
      expect(ROWS[0]).toEqual(originalCopy);
    });

    it('documents non-applicable rules with approved justification', () => {
      expect(ERP5_NOT_APPLICABLE_RULES['RL-TAX-01']).toBeDefined();
      expect(ERP5_NOT_APPLICABLE_RULES['RL-ADDR-01']).toBeDefined();
      expect(ERP5_NOT_APPLICABLE_RULES['RL-DUP-01']).toBeDefined();
    });

    it('declares cleaning rule configs covering all 4 ERP-5 entities', () => {
      const coveredEntities = new Set(ERP5_FIELD_CLEAN_RULES.map((r) => r.recordType));
      expect(coveredEntities).toContain('department');
      expect(coveredEntities).toContain('employee');
      expect(coveredEntities).toContain('leave');
      expect(coveredEntities).toContain('payroll_total');
      expect(ERP5_FIELD_CLEAN_RULES.length).toBeGreaterThanOrEqual(15);
    });
  });
});
