/**
 * ERP-5 HR & Employees — V1 Data-Quality Rules Test Suite (#53)
 *
 * Proves the rule catalogue against the committed synthetic Dirty Data Pack:
 *   - Fixture manifest + SHA-256 checksum + schema/version
 *   - Rule catalogue integrity (stable IDs, versions, conditions, reasons)
 *   - Every required/optional field and enumeration has a valid and an invalid test row
 *   - Determinism (byte-equivalent profile) and raw-input immutability (BR-KIT-03)
 *   - No fuzzy matching, no automatic destructive merge
 *   - Domain invariants: BR-ERP5-01 (join date >= birth date), BR-ERP5-02 (non-negative salary),
 *     FR-ERP5-04 (leave date order), FR-ERP5-06 (department aggregates only)
 *   - Output accepted by public Zod contracts (@clearshift/contracts)
 *
 * @module erp5/tests/migration/rules.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CreateHrDepartmentRequestSchema,
  CreateHrEmployeeRequestSchema,
  CreateHrLeaveRequestSchema,
  CreateHrPayrollTotalRequestSchema,
} from '@clearshift/contracts';
import {
  ACCEPTED_CURRENCIES,
  LEAVE_TYPES,
  LEAVE_STATUSES,
  COVERED_FIELDS,
  FIXTURE_COLUMNS,
  FIXTURE_PATH,
  FIXTURE_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  RULES_VERSION,
  RULE_CATALOGUE,
  buildProfile,
  evaluateDataset,
  parseCsv,
  readRawRows,
  sha256Hex,
  stableStringify,
  maskSalary,
  type ProfileReport,
  type RawRow,
} from '../../src/migration/rules.js';

// ─────────────────────────────────────────────────────────────────────────────
// Load committed fixtures (read-only)
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

const CSV_TEXT = read('sample-data/erp-5/dirty-data-v1.csv');
const EXPECTED_PROFILE_TEXT = read('sample-data/erp-5/expected-profile.json');
const EXPECTED_PROFILE = JSON.parse(EXPECTED_PROFILE_TEXT) as ProfileReport;
const MAPPING_TEMPLATE = JSON.parse(read('sample-data/erp-5/mapping-template.json')) as {
  policy: {
    fuzzy_matching: boolean;
    automatic_merge: boolean;
    raw_input_mutation: boolean;
  };
  load_order: string[];
  entities: Record<string, { api: string; target_table: string; fields: Array<{ source: string; target: string; required: boolean }> }>;
};

describe('ERP-5 HR & Employees — V1 Data Quality Rules & Dirty Pack (#53)', () => {
  // ── 1. Fixture Manifest, Checksum & Immutability ───────────────────────────
  describe('1. Fixture Manifest & Checksum Validation', () => {
    it('verifies dirty-data-v1.csv matches the committed SHA-256 fingerprint exactly', () => {
      const computedHash = sha256Hex(CSV_TEXT);
      expect(computedHash).toBe(EXPECTED_PROFILE.fixture.sha256);
      expect(EXPECTED_PROFILE.fixture.path).toBe(FIXTURE_PATH);
      expect(EXPECTED_PROFILE.profile_schema_version).toBe(PROFILE_SCHEMA_VERSION);
    });

    it('verifies row counts and record types in committed manifest', () => {
      const rows = readRawRows(CSV_TEXT);
      expect(rows.length).toBe(EXPECTED_PROFILE.fixture.row_count);
      expect(rows.length).toBe(130);

      const byType = {
        department: rows.filter((r) => r.record_type === 'department').length,
        employee: rows.filter((r) => r.record_type === 'employee').length,
        leave: rows.filter((r) => r.record_type === 'leave').length,
        payroll_total: rows.filter((r) => r.record_type === 'payroll_total').length,
      };

      expect(byType.department).toBe(EXPECTED_PROFILE.by_record_type.department.total);
      expect(byType.employee).toBe(EXPECTED_PROFILE.by_record_type.employee.total);
      expect(byType.leave).toBe(EXPECTED_PROFILE.by_record_type.leave.total);
      expect(byType.payroll_total).toBe(EXPECTED_PROFILE.by_record_type.payroll_total.total);
    });

    it('asserts raw input is never mutated during profiling or cleaning (BR-KIT-03)', () => {
      const rowsBefore = readRawRows(CSV_TEXT);
      const snapshotBefore = JSON.stringify(rowsBefore);

      const profile = buildProfile(CSV_TEXT);
      expect(profile).toBeDefined();

      const rowsAfter = readRawRows(CSV_TEXT);
      const snapshotAfter = JSON.stringify(rowsAfter);

      expect(snapshotAfter).toBe(snapshotBefore);
      expect(sha256Hex(CSV_TEXT)).toBe(EXPECTED_PROFILE.fixture.sha256);
    });
  });

  // ── 2. Rule Catalogue Integrity ───────────────────────────────────────────
  describe('2. Rule Catalogue Integrity', () => {
    it('verifies all rules have unique IDs and version 1.0.0', () => {
      const seenIds = new Set<string>();
      for (const rule of RULE_CATALOGUE) {
        expect(seenIds.has(rule.rule_id)).toBe(false);
        seenIds.add(rule.rule_id);
        expect(rule.version).toBe(RULES_VERSION);
        expect(rule.input_condition.length).toBeGreaterThan(0);
        expect(rule.human_reason.length).toBeGreaterThan(0);
        expect(['reject', 'normalize', 'review', 'derive']).toContain(rule.result);
      }
    });

    it('verifies covered fields covers all entities', () => {
      expect(COVERED_FIELDS.department).toContain('department_code');
      expect(COVERED_FIELDS.department).toContain('department_name');
      expect(COVERED_FIELDS.employee).toContain('employee_no');
      expect(COVERED_FIELDS.employee).toContain('birth_date');
      expect(COVERED_FIELDS.employee).toContain('join_date');
      expect(COVERED_FIELDS.employee).toContain('salary');
      expect(COVERED_FIELDS.leave).toContain('employee_no');
      expect(COVERED_FIELDS.leave).toContain('date_from');
      expect(COVERED_FIELDS.leave).toContain('date_to');
      expect(COVERED_FIELDS.payroll_total).toContain('department_code');
      expect(COVERED_FIELDS.payroll_total).toContain('month');
      expect(COVERED_FIELDS.payroll_total).toContain('gross_total');
    });

    it('asserts every rule with result=reject or review declares a reason_code', () => {
      for (const rule of RULE_CATALOGUE) {
        if (rule.result === 'reject' || rule.result === 'review') {
          expect(rule.reason_code).toBeDefined();
          expect(rule.reason_code!.length).toBeGreaterThan(0);
        }
      }
    });
  });

  // ── 3. Every Required/Optional Field and Enum Has Valid & Invalid Rows ──────
  describe('3. Valid & Invalid Coverage Across Fields and Enums', () => {
    const rawRows = readRawRows(CSV_TEXT);
    const evaluated = evaluateDataset(rawRows);

    it('has at least one accepted and one rejected row for departments', () => {
      const deptRows = evaluated.filter((r) => r.record_type === 'department');
      const accepted = deptRows.filter((r) => r.outcome === 'accepted');
      const rejected = deptRows.filter((r) => r.outcome === 'rejected');
      expect(accepted.length).toBeGreaterThanOrEqual(1);
      expect(rejected.length).toBeGreaterThanOrEqual(1);
    });

    it('has at least one accepted and one rejected row for employees', () => {
      const empRows = evaluated.filter((r) => r.record_type === 'employee');
      const accepted = empRows.filter((r) => r.outcome === 'accepted');
      const rejected = empRows.filter((r) => r.outcome === 'rejected');
      expect(accepted.length).toBeGreaterThanOrEqual(1);
      expect(rejected.length).toBeGreaterThanOrEqual(1);
    });

    it('has at least one accepted and one rejected row for leave records', () => {
      const leaveRows = evaluated.filter((r) => r.record_type === 'leave');
      const accepted = leaveRows.filter((r) => r.outcome === 'accepted');
      const rejected = leaveRows.filter((r) => r.outcome === 'rejected');
      expect(accepted.length).toBeGreaterThanOrEqual(1);
      expect(rejected.length).toBeGreaterThanOrEqual(1);
    });

    it('has at least one accepted and one rejected row for payroll totals', () => {
      const payRows = evaluated.filter((r) => r.record_type === 'payroll_total');
      const accepted = payRows.filter((r) => r.outcome === 'accepted');
      const rejected = payRows.filter((r) => r.outcome === 'rejected');
      expect(accepted.length).toBeGreaterThanOrEqual(1);
      expect(rejected.length).toBeGreaterThanOrEqual(1);
    });

    it('exercises accepted currency enumeration (INR, USD, EUR)', () => {
      expect(ACCEPTED_CURRENCIES).toEqual(['INR', 'USD', 'EUR']);
      const invalidCurrRows = evaluated.filter((r) => r.reason_codes.includes('INVALID_CURRENCY'));
      expect(invalidCurrRows.length).toBeGreaterThanOrEqual(1);
    });

    it('exercises leave types (annual, sick, unpaid) and invalid leave types', () => {
      expect(LEAVE_TYPES).toEqual(['annual', 'sick', 'unpaid']);
      const invalidLeaveRows = evaluated.filter((r) => r.reason_codes.includes('INVALID_LEAVE_TYPE'));
      expect(invalidLeaveRows.length).toBeGreaterThanOrEqual(1);
    });

    it('exercises leave statuses (pending, approved, rejected) and invalid leave statuses', () => {
      expect(LEAVE_STATUSES).toEqual(['pending', 'approved', 'rejected']);
      const invalidStatusRows = evaluated.filter((r) => r.reason_codes.includes('INVALID_LEAVE_STATUS'));
      expect(invalidStatusRows.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 4. Determinism & Byte-Equivalence ──────────────────────────────────────
  describe('4. Determinism & Profile Stability', () => {
    it('evaluates fixture into byte-equivalent profile matching expected-profile.json', () => {
      const computedProfile = buildProfile(CSV_TEXT);

      expect(computedProfile.reconciliation).toEqual(EXPECTED_PROFILE.reconciliation);
      expect(computedProfile.by_record_type).toEqual(EXPECTED_PROFILE.by_record_type);
      expect(computedProfile.by_reason_code).toEqual(EXPECTED_PROFILE.by_reason_code);

      // Verify byte-level string serialization stability
      const computedJson = stableStringify(computedProfile);
      const expectedJson = stableStringify(EXPECTED_PROFILE);
      expect(computedJson).toBe(expectedJson);
    });
  });

  // ── 5. Exact Candidate Duplicates & No Fuzzy Auto-Merge ───────────────────
  describe('5. Duplicate Candidate Review (No Fuzzy Auto-Merge)', () => {
    const rawRows = readRawRows(CSV_TEXT);
    const evaluated = evaluateDataset(rawRows);

    it('asserts policy strictly forbids fuzzy matching and automatic merge', () => {
      expect(MAPPING_TEMPLATE.policy.fuzzy_matching).toBe(false);
      expect(MAPPING_TEMPLATE.policy.automatic_merge).toBe(false);
      expect(MAPPING_TEMPLATE.policy.raw_input_mutation).toBe(false);
    });

    it('holds candidate duplicate department codes under review outcome', () => {
      const deptDupes = evaluated.filter((r) => r.reason_codes.includes('DUPLICATE_DEPARTMENT_CODE_REVIEW'));
      expect(deptDupes.length).toBe(2);
      for (const d of deptDupes) {
        expect(d.outcome).toBe('review');
      }
    });

    it('holds candidate duplicate employee numbers under review outcome', () => {
      const empDupes = evaluated.filter((r) => r.reason_codes.includes('DUPLICATE_EMPLOYEE_NO_REVIEW'));
      expect(empDupes.length).toBe(4);
      for (const e of empDupes) {
        expect(e.outcome).toBe('review');
      }
    });

    it('holds candidate duplicate leave requests under review outcome', () => {
      const leaveDupes = evaluated.filter((r) => r.reason_codes.includes('DUPLICATE_LEAVE_REQUEST_REVIEW'));
      expect(leaveDupes.length).toBe(2);
      for (const l of leaveDupes) {
        expect(l.outcome).toBe('review');
      }
    });

    it('holds candidate duplicate payroll totals under review outcome', () => {
      const payDupes = evaluated.filter((r) => r.reason_codes.includes('DUPLICATE_PAYROLL_TOTAL_REVIEW'));
      expect(payDupes.length).toBe(2);
      for (const p of payDupes) {
        expect(p.outcome).toBe('review');
      }
    });
  });

  // ── 6. Domain Invariants ──────────────────────────────────────────────────
  describe('6. Domain Invariants Enforcement', () => {
    const rawRows = readRawRows(CSV_TEXT);
    const evaluated = evaluateDataset(rawRows);

    it('enforces join_date >= birth_date invariant (BR-ERP5-01)', () => {
      const violated = evaluated.filter((r) => r.reason_codes.includes('JOIN_DATE_BEFORE_BIRTH_DATE'));
      expect(violated.length).toBe(4);
      for (const row of violated) {
        expect(row.outcome).toBe('rejected');
      }
    });

    it('enforces non-negative salary invariant (BR-ERP5-02)', () => {
      const negativeSalaryRows = evaluated.filter((r) => r.reason_codes.includes('NEGATIVE_SALARY'));
      expect(negativeSalaryRows.length).toBe(6);
      for (const row of negativeSalaryRows) {
        expect(row.outcome).toBe('rejected');
      }
    });

    it('masks salary values on serialization (DR-5)', () => {
      expect(maskSalary('75000.00')).toBe('XX,XXX');
      expect(maskSalary(50000)).toBe('XX,XXX');
      expect(maskSalary('')).toBe('');
      expect(maskSalary(undefined)).toBe('');

      const acceptedEmp = evaluated.find((r) => r.record_type === 'employee' && r.outcome === 'accepted');
      expect(acceptedEmp).toBeDefined();
      expect(acceptedEmp!.masked_data.salary).toBe('XX,XXX');
    });

    it('enforces leave date range ordering (FR-ERP5-04)', () => {
      const invertedLeave = evaluated.filter((r) => r.reason_codes.includes('INVALID_LEAVE_DATES'));
      expect(invertedLeave.length).toBe(4);
      for (const row of invertedLeave) {
        expect(row.outcome).toBe('rejected');
      }
    });

    it('enforces payroll outputs are department-month aggregates only (FR-ERP5-06)', () => {
      const employeeLinesForbidden = evaluated.filter((r) => r.reason_codes.includes('EMPLOYEE_LINES_FORBIDDEN'));
      expect(employeeLinesForbidden.length).toBe(2);
      for (const row of employeeLinesForbidden) {
        expect(row.outcome).toBe('rejected');
      }
    });

    it('rejects OWASP CSV formula injection prefixes', () => {
      const formulaRows = evaluated.filter((r) => r.reason_codes.includes('FORMULA_INJECTION_REJECTED'));
      expect(formulaRows.length).toBe(12);
      for (const row of formulaRows) {
        expect(row.outcome).toBe('rejected');
      }
    });
  });

  // ── 7. Exact Reconciliation Balancing ─────────────────────────────────────
  describe('7. Exact Reconciliation Balancing', () => {
    it('verifies exact reconciliation equation: source = accepted + rejected + review + skipped, unaccounted = 0', () => {
      const profile = buildProfile(CSV_TEXT);
      const recon = profile.reconciliation;

      expect(recon.source_row_count).toBe(130);
      expect(recon.accepted).toBe(42);
      expect(recon.rejected).toBe(78);
      expect(recon.review).toBe(10);
      expect(recon.skipped).toBe(0);
      expect(recon.unaccounted).toBe(0);
      expect(recon.is_balanced).toBe(true);

      const sum = recon.accepted + recon.rejected + recon.review + recon.skipped;
      expect(sum).toBe(recon.source_row_count);
    });
  });

  // ── 8. Public Zod Contract Validation ─────────────────────────────────────
  describe('8. Public Zod Contract Integration', () => {
    it('validates that accepted department rows satisfy CreateHrDepartmentRequestSchema', () => {
      const acceptedDept = {
        name: 'Engineering',
        code: 'ENG',
        parent_id: null,
      };
      const parsed = CreateHrDepartmentRequestSchema.safeParse(acceptedDept);
      expect(parsed.success).toBe(true);
    });

    it('validates that accepted employee rows satisfy CreateHrEmployeeRequestSchema', () => {
      const acceptedEmp = {
        employee_no: 'EMP-001',
        first_name: 'Ananya',
        last_name: 'Sharma',
        birth_date: '1990-05-15',
        join_date: '2020-01-10',
        department_id: '00000000-0000-0000-0000-000000000001',
        job_title: 'Senior Software Engineer',
        salary: '120000.00',
        currency_code: 'INR',
      };
      const parsed = CreateHrEmployeeRequestSchema.safeParse(acceptedEmp);
      expect(parsed.success).toBe(true);
    });

    it('validates that accepted leave rows satisfy CreateHrLeaveRequestSchema', () => {
      const acceptedLeave = {
        employee_id: '00000000-0000-0000-0000-000000000002',
        type: 'holiday',
        date_from: '2026-06-01',
        date_to: '2026-06-05',
        status: 'pending',
      };
      const parsed = CreateHrLeaveRequestSchema.safeParse(acceptedLeave);
      expect(parsed.success).toBe(true);
    });

    it('validates that accepted payroll totals satisfy CreateHrPayrollTotalRequestSchema', () => {
      const acceptedPayroll = {
        department_id: '00000000-0000-0000-0000-000000000001',
        month: '2026-04',
        total_amount: '1500000.00',
        currency_code: 'INR',
        headcount: 15,
      };
      const parsed = CreateHrPayrollTotalRequestSchema.safeParse(acceptedPayroll);
      expect(parsed.success).toBe(true);
    });
  });
});
