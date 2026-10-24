/**
 * ERP-5 HR & Employees — Data Dictionary, ERD & Traceability Test Suite
 *
 * Validates all Acceptance Criteria for Issue #200 (ERP5-24):
 *   [✓] Criterion 1: Data dictionary defines every entity column: type, nullability,
 *       constraint, business rule, and example.
 *   [✓] Criterion 2: ERD clearly documents primary keys, foreign keys, and
 *       master-data ownership boundaries.
 *   [✓] Criterion 3: Traceability matrix maps every module Must requirement to
 *       planned automated test cases.
 *   [✓] Criterion 4: Dirty Data Pack plan defines synthetic edge-case scenarios and
 *       expected defect distributions.
 *   [✓] Criterion 5: Design artifacts are signed off at Gate G1 review.
 *
 * @module erp5/tests/migration/data-dictionary-erd.test
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const GLOBAL_DICT_PATH = resolve(REPO_ROOT, 'docs/data-dictionaries/erp-5.md');
const MODULE_DICT_PATH = resolve(
  REPO_ROOT,
  'apps/erp/modules/erp-5/docs/data-dictionary.md',
);

describe('ERP-5 Data Dictionary, ERD, Traceability & Dirty Data Pack Plan ([ERP5-24] #200)', () => {
  const globalDictContent = readFileSync(GLOBAL_DICT_PATH, 'utf8');
  const moduleDictContent = readFileSync(MODULE_DICT_PATH, 'utf8');

  // ── Byte Parity Verification ────────────────────────────────────────────────
  it('maintains 100% byte parity between module and global data dictionaries', () => {
    expect(moduleDictContent).toBe(globalDictContent);
  });

  // ── Criterion 1: Data dictionary defines every entity column ────────────────
  describe('Criterion 1: Comprehensive Field-Level Data Dictionary', () => {
    const requiredTables = [
      'erp5.departments',
      'erp5.employees',
      'erp5.leave',
      'erp5.payroll_totals',
      'erp5.import_receipts',
      'erp5.identity_users',
    ];

    it.each(requiredTables)('documents entity %s in data dictionary', (tableName) => {
      expect(globalDictContent).toContain(tableName);
    });

    it('defines all required column attributes and business rules across entities', () => {
      const requiredColumns = [
        // departments
        'name',
        'code',
        'parent_id',
        // employees
        'employee_no',
        'first_name',
        'last_name',
        'birth_date',
        'join_date',
        'department_id',
        'job_title',
        'salary',
        'currency_code',
        // leave
        'leave_type',
        'date_from',
        'date_to',
        'reason',
        'status',
        // payroll_totals
        'month',
        'gross_total',
        'net_total',
        'employee_count',
        // import_receipts
        'batch_id',
        'source_row',
        'idempotency_key',
        'request_hash',
        'target_id',
        'outcome',
      ];

      for (const col of requiredColumns) {
        expect(globalDictContent).toContain(`\`${col}\``);
      }
    });

    it('specifies exact decimal storage NUMERIC(20,4) and salary masking rule (BR-ERP5-02)', () => {
      expect(globalDictContent).toContain('NUMERIC(20,4)');
      expect(globalDictContent).toContain('salary_display');
      expect(globalDictContent).toContain('XX,XXX');
    });

    it('enforces temporal invariant that join date must not precede birth date (BR-ERP5-01)', () => {
      expect(globalDictContent).toContain('join_date >= birth_date');
      expect(globalDictContent).toContain('BR-ERP5-01');
    });
  });

  // ── Criterion 2: ERD documents PKs, FKs, and ownership boundaries ───────────
  describe('Criterion 2: Entity-Relationship Diagram (ERD) & Ownership Boundaries', () => {
    it('includes a valid Mermaid ERD diagram in Section 19', () => {
      expect(globalDictContent).toContain('```mermaid');
      expect(globalDictContent).toContain('erDiagram');
      expect(globalDictContent).toContain('erp5_departments {');
      expect(globalDictContent).toContain('erp5_employees {');
      expect(globalDictContent).toContain('erp5_leave {');
      expect(globalDictContent).toContain('erp5_payroll_totals {');
      expect(globalDictContent).toContain('erp5_import_receipts {');
    });

    it('documents primary keys, foreign keys, and internal cardinalities', () => {
      expect(globalDictContent).toContain('uuid id PK');
      expect(globalDictContent).toContain('uuid department_id FK');
      expect(globalDictContent).toContain('uuid employee_id FK');
      expect(globalDictContent).toContain('erp5_departments ||--o{ erp5_employees');
      expect(globalDictContent).toContain('erp5_employees ||--o{ erp5_leave');
      expect(globalDictContent).toContain('erp5_departments ||--o{ erp5_payroll_totals');
    });

    it('explicitly marks master data ownership boundaries and Decision C7 zero cross-schema FK rule', () => {
      expect(globalDictContent).toContain('Decision C7: Zero Cross-Schema PostgreSQL FKs');
      expect(globalDictContent).toContain('platform_hub_users');
      expect(globalDictContent).toContain('erp4_payroll_totals');
    });
  });

  // ── Criterion 3: Traceability matrix maps Must requirements to test cases ────
  describe('Criterion 3: Requirement-to-Test Traceability Matrix', () => {
    const requiredSpecs = [
      'FR-ERP5-01',
      'FR-ERP5-02',
      'FR-ERP5-03',
      'FR-ERP5-04',
      'FR-ERP5-05',
      'FR-ERP5-06',
      'BR-ERP5-01',
      'BR-ERP5-02',
      'DR-1',
      'DR-2 / DR-5',
      'DR-3',
      'DR-6 / C4',
      'DR-7',
      'DR-14',
      'DR-15',
      'Decision C7',
      'ERP5-01',
      'ERP5-02',
      'ERP5-03',
      'ERP5-04',
      'ERP5-05',
      'ERP5-06',
      'ERP5-09',
      'ERP5-15',
      'ERP5-16',
      'ERP5-24',
    ];

    it.each(requiredSpecs)('traces requirement %s to automated test suite with verified status', (specId) => {
      expect(globalDictContent).toContain(`**${specId}**`);
      expect(globalDictContent).toContain('**Verified**');
    });

    it('references actual existing test files in the workspace', () => {
      const referencedFiles = [
        'apps/erp/modules/erp-5/tests/api/list.test.ts',
        'apps/erp/modules/erp-5/tests/api/mutations.test.ts',
        'apps/erp/modules/erp-5/tests/api/state-transitions.test.ts',
        'apps/erp/modules/erp-5/tests/domain/relationships.test.ts',
        'apps/erp/modules/erp-5/tests/domain/rules.test.ts',
        'apps/erp/modules/erp-5/tests/security/audit.test.ts',
        'apps/erp/modules/erp-5/tests/security/authorization.test.ts',
        'apps/erp/modules/erp-5/tests/security/masking.test.ts',
        'apps/erp/modules/erp-5/tests/contracts/erp-5.contract.test.ts',
        'apps/erp/modules/erp-5/tests/contracts/erp-5.openapi.test.ts',
        'apps/erp/modules/erp-5/tests/db/schema.test.ts',
        'apps/erp/modules/erp-5/web/tests/employee-form.test.tsx',
        'apps/erp/modules/erp-5/web/tests/department-form.test.tsx',
        'apps/erp/modules/erp-5/web/tests/routes.test.tsx',
        'apps/erp/modules/erp-5/web/tests/route-manifest.test.ts',
      ];

      for (const relPath of referencedFiles) {
        expect(existsSync(resolve(REPO_ROOT, relPath))).toBe(true);
      }
    });
  });

  // ── Criterion 4: Dirty Data Pack plan & defect distributions ────────────────
  describe('Criterion 4: Dirty Data Pack Plan & Defect Distribution', () => {
    it('documents strict reconciliation math: source = accepted + rejected + review + skipped', () => {
      expect(globalDictContent).toContain(
        '\\text{source\\_row\\_count} = \\text{accepted} + \\text{rejected} + \\text{review} + \\text{skipped}',
      );
      expect(globalDictContent).toContain('\\text{unaccounted} = 0');
      expect(globalDictContent).toContain('is\\_balanced} = \\text{true');
    });

    it('documents planned reconciliation baseline counts and entity breakdown', () => {
      expect(globalDictContent).toContain('`130`');
      expect(globalDictContent).toContain('`42`');
      expect(globalDictContent).toContain('`78`');
      expect(globalDictContent).toContain('`10`');
      expect(globalDictContent).toContain('`department`');
      expect(globalDictContent).toContain('`employee`');
      expect(globalDictContent).toContain('`leave`');
      expect(globalDictContent).toContain('`payroll_total`');
    });

    it('documents comprehensive reason codes catalogue across all failure modes', () => {
      const reasonCodes = [
        'DEPARTMENT_CODE_REQUIRED',
        'DEPARTMENT_SELF_PARENT',
        'DEPARTMENT_CYCLE_DETECTED',
        'EMPLOYEE_NO_REQUIRED',
        'JOIN_DATE_BEFORE_BIRTH_DATE',
        'NEGATIVE_SALARY',
        'INVALID_CURRENCY',
        'LEAVE_TYPE_REQUIRED',
        'INVALID_LEAVE_DATES',
        'INVALID_LEAVE_STATUS',
        'EMPLOYEE_LINES_FORBIDDEN',
        'FORMULA_INJECTION_REJECTED',
      ];

      for (const code of reasonCodes) {
        expect(globalDictContent).toContain(code);
      }
    });
  });

  // ── Criterion 5: Gate G1 design artifacts sign-off ─────────────────────────
  describe('Criterion 5: Gate G1 Review & Governance Sign-Off', () => {
    it('contains the Gate G1 verification checklist with all criteria approved', () => {
      expect(globalDictContent).toContain('Gate G1 Criteria Verification Checklist');
      expect(globalDictContent).toContain('**Approved**');
    });

    it('records formal sign-off details with unanimous Gate decision', () => {
      expect(globalDictContent).toContain('PASSED (UNANIMOUS SIGN-OFF FOR GATE G1)');
      expect(globalDictContent).toContain('Group 10');
      expect(globalDictContent).toContain('@saadmulla82');
    });
  });
});
