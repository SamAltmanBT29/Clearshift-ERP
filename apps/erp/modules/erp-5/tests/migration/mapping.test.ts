/**
 * ERP-5 HR & Employees — Mapping & Value Translation Automated Tests (Issue #204 / ERP5-28 / KIT-05)
 *
 * Test coverage:
 * - AC1: Source-to-target field mapping templates with strict type coercion rules.
 * - AC2: Enum translation tables mapping legacy values to domain allowlists.
 * - AC3: Unmapped required target fields raise validation error and block dry-run/load execution.
 * - AC4: Named, versioned, reproducible templates across migration runs.
 * - Invariant: Exact candidate key duplicate matching only, non-destructive source rows, NUMERIC(20,4) precision.
 *
 * @module erp5/tests/migration/mapping.test
 */

import { describe, it, expect } from 'vitest';
import {
  translateEnum,
  coerceDecimalAmount,
  coerceIsoDate,
  coerceInteger,
  coerceBoolean,
  CURRENCY_CODE_TRANSLATION_MAP,
  LEAVE_TYPE_TRANSLATION_MAP,
  LEAVE_STATUS_TRANSLATION_MAP,
  EMPLOYMENT_STATUS_TRANSLATION_MAP,
  EnumTranslationError,
  validateErp5Mapping,
  transformSourceRowToTarget,
  transformDataset,
  ERP5_CANONICAL_MAPPING_TEMPLATES,
  erp5TargetEntities,
  ERP5_MODULE_METADATA,
} from '../../src/migration/mapping-config.js';

describe('[ERP5-28] ERP-5 Mapping & Value Translation Configuration (#204)', () => {
  // ── 1. Type Coercion Engine (AC1) ──────────────────────────────────────────
  describe('1. Type Coercion Engine (AC1)', () => {
    it('coerces valid formatted currency and salary strings to standard 4-decimal strings', () => {
      expect(coerceDecimalAmount('85000', 'salary')).toBe('85000.0000');
      expect(coerceDecimalAmount('  $ 120,500.50 ', 'salary')).toBe('120500.5000');
      expect(coerceDecimalAmount('₹25,00,000.7500', 'salary')).toBe('2500000.7500');
      expect(coerceDecimalAmount('€ 45,000.25', 'salary')).toBe('45000.2500');
      expect(coerceDecimalAmount('(500.25)', 'net_total')).toBe('-500.2500');
      expect(coerceDecimalAmount('0', 'gross_total')).toBe('0.0000');
    });

    it('rejects unparseable decimal amounts with structured TypeError', () => {
      expect(() => coerceDecimalAmount('invalid-number', 'salary')).toThrowError(
        /cannot be parsed as a valid numeric decimal/
      );
      expect(() => coerceDecimalAmount('', 'salary')).toThrowError(
        /Missing numeric decimal amount/
      );
    });

    it('coerces varied calendar date formats to ISO 8601 (YYYY-MM-DD)', () => {
      expect(coerceIsoDate('2026-06-15', 'join_date')).toBe('2026-06-15');
      expect(coerceIsoDate('2026/06/15', 'join_date')).toBe('2026-06-15');
      expect(coerceIsoDate('15-06-2026', 'birth_date')).toBe('2026-06-15');
      expect(coerceIsoDate('1980-001-15', 'birth_date')).toBe('1980-01-15');
      expect(coerceIsoDate('2010/1/5', 'join_date')).toBe('2010-01-05');
    });

    it('rejects unparseable date formats with structured TypeError', () => {
      expect(() => coerceIsoDate('not-a-date', 'join_date')).toThrowError(
        /not a recognized date format/
      );
      expect(() => coerceIsoDate('', 'join_date')).toThrowError(/Missing date/);
    });

    it('coerces integers reliably', () => {
      expect(coerceInteger('10', 'employee_count')).toBe(10);
      expect(coerceInteger('  1,500  ', 'employee_count')).toBe(1500);
      expect(() => coerceInteger('invalid', 'employee_count')).toThrowError(
        /cannot be parsed as an integer/
      );
    });

    it('coerces boolean values reliably', () => {
      expect(coerceBoolean('true')).toBe(true);
      expect(coerceBoolean('1')).toBe(true);
      expect(coerceBoolean('yes')).toBe(true);
      expect(coerceBoolean('false')).toBe(false);
      expect(coerceBoolean('0')).toBe(false);
      expect(coerceBoolean('no')).toBe(false);
      expect(coerceBoolean('', true)).toBe(true);
    });
  });

  // ── 2. Enum Translation Tables (AC2) ───────────────────────────────────────
  describe('2. Enum Translation Tables (AC2)', () => {
    it('translates legacy currency strings and symbols to ISO 4217 standard codes', () => {
      expect(translateEnum('inr', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('INR');
      expect(translateEnum('₹', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('INR');
      expect(translateEnum('rs.', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('INR');
      expect(translateEnum('usd', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('USD');
      expect(translateEnum('$', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('USD');
      expect(translateEnum('€', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('EUR');
      expect(translateEnum('euro', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code')).toBe('EUR');
    });

    it('translates legacy leave types to domain allowlist', () => {
      expect(translateEnum('Annual', LEAVE_TYPE_TRANSLATION_MAP, 'leave_type')).toBe('annual');
      expect(translateEnum('PTO', LEAVE_TYPE_TRANSLATION_MAP, 'leave_type')).toBe('annual');
      expect(translateEnum('Vacation', LEAVE_TYPE_TRANSLATION_MAP, 'leave_type')).toBe('annual');
      expect(translateEnum('Sick Leave', LEAVE_TYPE_TRANSLATION_MAP, 'leave_type')).toBe('sick');
      expect(translateEnum('Medical', LEAVE_TYPE_TRANSLATION_MAP, 'leave_type')).toBe('sick');
      expect(translateEnum('Loss of Pay', LEAVE_TYPE_TRANSLATION_MAP, 'leave_type')).toBe('unpaid');
      expect(translateEnum('LWOP', LEAVE_TYPE_TRANSLATION_MAP, 'leave_type')).toBe('unpaid');
      expect(translateEnum('Maternity', LEAVE_TYPE_TRANSLATION_MAP, 'leave_type')).toBe('maternity');
      expect(translateEnum('Paternity', LEAVE_TYPE_TRANSLATION_MAP, 'leave_type')).toBe('paternity');
      expect(translateEnum('Bereavement', LEAVE_TYPE_TRANSLATION_MAP, 'leave_type')).toBe('bereavement');
    });

    it('translates legacy leave statuses to domain allowlist', () => {
      expect(translateEnum('Submitted', LEAVE_STATUS_TRANSLATION_MAP, 'status')).toBe('pending');
      expect(translateEnum('Draft', LEAVE_STATUS_TRANSLATION_MAP, 'status')).toBe('pending');
      expect(translateEnum('Approved', LEAVE_STATUS_TRANSLATION_MAP, 'status')).toBe('approved');
      expect(translateEnum('Granted', LEAVE_STATUS_TRANSLATION_MAP, 'status')).toBe('approved');
      expect(translateEnum('Rejected', LEAVE_STATUS_TRANSLATION_MAP, 'status')).toBe('rejected');
      expect(translateEnum('Declined', LEAVE_STATUS_TRANSLATION_MAP, 'status')).toBe('rejected');
      expect(translateEnum('Cancelled', LEAVE_STATUS_TRANSLATION_MAP, 'status')).toBe('cancelled');
    });

    it('translates employment statuses to domain allowlist', () => {
      expect(translateEnum('Employed', EMPLOYMENT_STATUS_TRANSLATION_MAP, 'employment_status')).toBe('active');
      expect(translateEnum('Current', EMPLOYMENT_STATUS_TRANSLATION_MAP, 'employment_status')).toBe('active');
      expect(translateEnum('Probationary', EMPLOYMENT_STATUS_TRANSLATION_MAP, 'employment_status')).toBe('probation');
      expect(translateEnum('Resigned', EMPLOYMENT_STATUS_TRANSLATION_MAP, 'employment_status')).toBe('terminated');
      expect(translateEnum('Sabbatical', EMPLOYMENT_STATUS_TRANSLATION_MAP, 'employment_status')).toBe('on_leave');
    });

    it('raises EnumTranslationError when encountering unmapped enum values', () => {
      expect(() =>
        translateEnum('UNKNOWN_LEAVE', LEAVE_TYPE_TRANSLATION_MAP, 'leave_type')
      ).toThrowError(EnumTranslationError);

      try {
        translateEnum('BITCOIN', CURRENCY_CODE_TRANSLATION_MAP, 'currency_code');
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(EnumTranslationError);
        const err = e as EnumTranslationError;
        expect(err.fieldName).toBe('currency_code');
        expect(err.sourceValue).toBe('BITCOIN');
        expect(err.allowedValues).toContain('INR');
      }
    });
  });

  // ── 3. Required Target Column Enforcement Guards (AC3) ──────────────────────
  describe('3. Required Target Column Enforcement Guards (AC3)', () => {
    it('validates a complete mapping for department successfully', () => {
      const mapping = {
        code: 'department_code',
        name: 'department_name',
        parent_id: 'parent_code',
        source_id: 'source_id',
      };
      const result = validateErp5Mapping('department', mapping);
      expect(result.valid).toBe(true);
      expect(result.missingRequiredFields).toHaveLength(0);
    });

    it('flags unmapped required target fields and blocks execution', () => {
      // Omit required 'code' and 'name'
      const incompleteMapping = {
        parent_id: 'parent_code',
        source_id: 'source_id',
      };
      const result = validateErp5Mapping('department', incompleteMapping);
      expect(result.valid).toBe(false);
      expect(result.missingRequiredFields).toContain('code');
      expect(result.missingRequiredFields).toContain('name');
    });

    it('blocks dataset transformation when required target fields are missing', () => {
      const incompleteMapping = {
        first_name: 'first_name',
        last_name: 'last_name',
      };
      expect(() =>
        transformDataset('employee', [{ first_name: 'John', last_name: 'Doe' }], incompleteMapping)
      ).toThrowError(/missing required target fields/);
    });

    it('throws error when transforming row if mapped required field in source is blank', () => {
      const validMapping = {
        code: 'department_code',
        name: 'department_name',
      };
      expect(() =>
        transformSourceRowToTarget('department', { department_code: '', department_name: 'Eng' }, validMapping)
      ).toThrowError(/required target field 'code' mapped to 'department_code' is blank/);
    });
  });

  // ── 4. Named, Versioned Reproducible Templates (AC4) ───────────────────────
  describe('4. Named, Versioned Reproducible Templates (AC4)', () => {
    it('defines canonical templates for all 4 ERP-5 entities with schema and rules versioning', () => {
      expect(ERP5_CANONICAL_MAPPING_TEMPLATES).toHaveLength(4);
      for (const t of ERP5_CANONICAL_MAPPING_TEMPLATES) {
        expect(t.schemaVersion).toBe(1);
        expect(t.rulesVersion).toBe('1.0.0');
        expect(t.templateId).toMatch(/^ERP5-MAP-/);
        expect(t.templateName).toBeTruthy();
        expect(Object.keys(t.mapping).length).toBeGreaterThan(0);
      }
    });

    it('successfully transforms department row using canonical template', () => {
      const template = ERP5_CANONICAL_MAPPING_TEMPLATES.find((t) => t.entityName === 'department')!;
      const sourceRow = {
        department_code: '  eng  ',
        department_name: ' Engineering Division ',
        parent_code: 'EXEC',
        source_id: 'DEP-SRC-001',
      };
      const transformed = transformSourceRowToTarget('department', sourceRow, template.mapping);
      expect(transformed['code']).toBe('ENG');
      expect(transformed['name']).toBe('Engineering Division');
      expect(transformed['parent_id']).toBe('EXEC');
      expect(transformed['source_id']).toBe('DEP-SRC-001');
    });

    it('successfully transforms employee row with coercion using canonical template', () => {
      const template = ERP5_CANONICAL_MAPPING_TEMPLATES.find((t) => t.entityName === 'employee')!;
      const sourceRow = {
        employee_no: ' emp-1001 ',
        first_name: 'Aarav',
        last_name: 'Sharma',
        department_code: 'ENG',
        job_title: 'Staff Engineer',
        birth_date: '1985/05/15',
        join_date: '2015-06-01',
        salary: ' ₹85,000.00 ',
        currency_code: '₹',
        source_id: 'EMP-SRC-1001',
        email: 'aarav@example.com',
        phone: '5551234567',
      };
      const transformed = transformSourceRowToTarget('employee', sourceRow, template.mapping);
      expect(transformed['employee_no']).toBe('EMP-1001');
      expect(transformed['first_name']).toBe('Aarav');
      expect(transformed['last_name']).toBe('Sharma');
      expect(transformed['department_id']).toBe('ENG');
      expect(transformed['job_title']).toBe('Staff Engineer');
      expect(transformed['birth_date']).toBe('1985-05-15');
      expect(transformed['join_date']).toBe('2015-06-01');
      expect(transformed['salary']).toBe('85000.0000');
      expect(transformed['currency_code']).toBe('INR');
      expect(transformed['source_id']).toBe('EMP-SRC-1001');
    });

    it('successfully transforms leave request row with enum translation', () => {
      const template = ERP5_CANONICAL_MAPPING_TEMPLATES.find((t) => t.entityName === 'leave')!;
      const sourceRow = {
        employee_no: 'EMP-1001',
        leave_type: 'Paid Leave',
        date_from: '2026/07/01',
        date_to: '2026/07/05',
        leave_status: 'Granted',
        leave_reason: 'Summer vacation',
        source_id: 'LEV-SRC-001',
      };
      const transformed = transformSourceRowToTarget('leave', sourceRow, template.mapping);
      expect(transformed['employee_id']).toBe('EMP-1001');
      expect(transformed['leave_type']).toBe('annual');
      expect(transformed['date_from']).toBe('2026-07-01');
      expect(transformed['date_to']).toBe('2026-07-05');
      expect(transformed['status']).toBe('approved');
      expect(transformed['reason']).toBe('Summer vacation');
      expect(transformed['source_id']).toBe('LEV-SRC-001');
    });

    it('successfully transforms payroll total row with decimal scaling and count coercion', () => {
      const template = ERP5_CANONICAL_MAPPING_TEMPLATES.find((t) => t.entityName === 'payroll_total')!;
      const sourceRow = {
        department_code: 'ENG',
        month: '2026-06',
        gross_total: ' € 500,000.00 ',
        net_total: ' € 400,000.00 ',
        employee_count: '10',
        currency_code: 'EUR',
        source_id: 'PAY-SRC-001',
      };
      const transformed = transformSourceRowToTarget('payroll_total', sourceRow, template.mapping);
      expect(transformed['department_id']).toBe('ENG');
      expect(transformed['month']).toBe('2026-06');
      expect(transformed['gross_total']).toBe('500000.0000');
      expect(transformed['net_total']).toBe('400000.0000');
      expect(transformed['employee_count']).toBe(10);
      expect(transformed['currency_code']).toBe('EUR');
      expect(transformed['source_id']).toBe('PAY-SRC-001');
    });

    it('registers ERP-5 module metadata with shared Migration Kit registry', () => {
      expect(ERP5_MODULE_METADATA.moduleId).toBe('erp-5');
      expect(Object.keys(ERP5_MODULE_METADATA.entities)).toHaveLength(4);
      expect(Object.keys(erp5TargetEntities).sort()).toEqual([
        'department',
        'employee',
        'leave',
        'payroll_total',
      ]);
    });
  });

  // ── 5. Invariant: Non-Destructive Raw Data Execution ───────────────────────
  describe('5. Invariants and Non-Destructive Execution', () => {
    it('raw source row input is never mutated during mapping or transformation', () => {
      const originalRow = {
        department_code: '  eng  ',
        department_name: 'Engineering',
      };
      const frozenRow = Object.freeze({ ...originalRow });
      const template = ERP5_CANONICAL_MAPPING_TEMPLATES.find((t) => t.entityName === 'department')!;
      const transformed = transformSourceRowToTarget('department', frozenRow, template.mapping);
      expect(transformed['code']).toBe('ENG');
      expect(frozenRow.department_code).toBe('  eng  ');
    });
  });
});
