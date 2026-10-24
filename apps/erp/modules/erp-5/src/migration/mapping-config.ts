/**
 * ERP-5 HR & Employees — Mapping & Value Translation Configuration (ERP5-28 / KIT-05)
 *
 * Implements:
 * - AC1: Source-to-target field mapping templates with strict type coercion rules.
 * - AC2: Enum translation tables mapping legacy values to domain allowlists.
 * - AC3: Unmapped required target fields raise validation error and block dry-run/load execution.
 * - AC4: Named, versioned, reproducible templates across migration runs.
 *
 * Conforms to:
 * - ClearShift Migration Kit SDS Chapter 4.5 (FR-MP-01 to FR-MP-05)
 * - Exact candidate key duplicate matching only (no fuzzy matching, no auto-merge)
 * - Decimal precision NUMERIC(20,4) arithmetic; no IEEE-754 float rounding
 * - Synthetic test fixtures only (BR-KIT-03 non-destructive source data)
 * - Privacy: Salary numeric(20,4) masked as salary_display = 'XX,XXX' on serialization (BR-ERP5-02, DR-5)
 *
 * @module erp5/migration/mapping-config
 */

import type {
  ModuleKitMetadata,
  TargetEntityMetadata,
  TargetFieldDefinition,
  MappingValidationResult,
} from '@cs/kit';
import { validateFieldMapping, registerModuleKitMetadata } from '@cs/kit';
import { coerceDateToIso } from './cleaning-config.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Enum Allow Lists & Translation Tables (AC2)
// ─────────────────────────────────────────────────────────────────────────────

export const ERP5_CURRENCY_CODE_ALLOWLIST = ['INR', 'USD', 'EUR'] as const;
export type Erp5CurrencyCode = (typeof ERP5_CURRENCY_CODE_ALLOWLIST)[number];

export const ERP5_LEAVE_TYPE_ALLOWLIST = [
  'annual',
  'sick',
  'unpaid',
  'maternity',
  'paternity',
  'bereavement',
] as const;
export type Erp5LeaveType = (typeof ERP5_LEAVE_TYPE_ALLOWLIST)[number];

export const ERP5_LEAVE_STATUS_ALLOWLIST = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type Erp5LeaveStatus = (typeof ERP5_LEAVE_STATUS_ALLOWLIST)[number];

export const ERP5_EMPLOYMENT_STATUS_ALLOWLIST = [
  'active',
  'inactive',
  'probation',
  'terminated',
  'on_leave',
] as const;
export type Erp5EmploymentStatus = (typeof ERP5_EMPLOYMENT_STATUS_ALLOWLIST)[number];

/**
 * Currency Code Translation Table
 */
export const CURRENCY_CODE_TRANSLATION_MAP: Readonly<Record<string, Erp5CurrencyCode>> = {
  inr: 'INR',
  rs: 'INR',
  'rs.': 'INR',
  '₹': 'INR',
  rupee: 'INR',
  rupees: 'INR',

  usd: 'USD',
  '$': 'USD',
  dollar: 'USD',
  dollars: 'USD',
  us$: 'USD',

  eur: 'EUR',
  '€': 'EUR',
  euro: 'EUR',
  euros: 'EUR',
};

/**
 * Leave Type Translation Table
 */
export const LEAVE_TYPE_TRANSLATION_MAP: Readonly<Record<string, Erp5LeaveType>> = {
  annual: 'annual',
  vacation: 'annual',
  holiday: 'annual',
  'paid leave': 'annual',
  pto: 'annual',
  al: 'annual',

  sick: 'sick',
  medical: 'sick',
  illness: 'sick',
  'sick leave': 'sick',
  sl: 'sick',

  unpaid: 'unpaid',
  'loss of pay': 'unpaid',
  lop: 'unpaid',
  'leave without pay': 'unpaid',
  lwop: 'unpaid',

  maternity: 'maternity',
  'mat leave': 'maternity',
  'maternity leave': 'maternity',

  paternity: 'paternity',
  'pat leave': 'paternity',
  'paternity leave': 'paternity',

  bereavement: 'bereavement',
  compassionate: 'bereavement',
  'bereavement leave': 'bereavement',
};

/**
 * Leave Status Translation Table
 */
export const LEAVE_STATUS_TRANSLATION_MAP: Readonly<Record<string, Erp5LeaveStatus>> = {
  pending: 'pending',
  draft: 'pending',
  submitted: 'pending',
  awaiting: 'pending',
  open: 'pending',

  approved: 'approved',
  accepted: 'approved',
  granted: 'approved',
  confirmed: 'approved',

  rejected: 'rejected',
  declined: 'rejected',
  refused: 'rejected',
  denied: 'rejected',

  cancelled: 'cancelled',
  canceled: 'cancelled',
  revoked: 'cancelled',
  withdrawn: 'cancelled',
};

/**
 * Employment Status Translation Table
 */
export const EMPLOYMENT_STATUS_TRANSLATION_MAP: Readonly<Record<string, Erp5EmploymentStatus>> = {
  active: 'active',
  current: 'active',
  employed: 'active',
  working: 'active',

  inactive: 'inactive',
  suspended: 'inactive',
  dormant: 'inactive',

  probation: 'probation',
  trainee: 'probation',
  probationary: 'probation',

  terminated: 'terminated',
  resigned: 'terminated',
  'ex-employee': 'terminated',
  separated: 'terminated',
  left: 'terminated',

  on_leave: 'on_leave',
  'on leave': 'on_leave',
  leave: 'on_leave',
  sabbatical: 'on_leave',
};

export class EnumTranslationError extends Error {
  constructor(
    public readonly fieldName: string,
    public readonly sourceValue: string,
    public readonly allowedValues: readonly string[],
    message: string
  ) {
    super(message);
    this.name = 'EnumTranslationError';
  }
}

/**
 * Translates a source enum string using a translation table with case-insensitivity.
 * Throws structured error if translation fails and no fallback default is provided.
 */
export function translateEnum<T extends string>(
  sourceValue: unknown,
  translationMap: Readonly<Record<string, T>>,
  fieldName: string,
  defaultValue?: T
): T {
  if (sourceValue === undefined || sourceValue === null || String(sourceValue).trim() === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new EnumTranslationError(
      fieldName,
      String(sourceValue),
      Array.from(new Set(Object.values(translationMap))),
      `Required enum field '${fieldName}' cannot be empty.`
    );
  }

  const normalized = String(sourceValue).trim().toLowerCase();
  const matched = translationMap[normalized];
  if (matched !== undefined) {
    return matched;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new EnumTranslationError(
    fieldName,
    String(sourceValue),
    Array.from(new Set(Object.values(translationMap))),
    `Value '${sourceValue}' for field '${fieldName}' is not in the allowed translation dictionary.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Type Coercion Helpers (AC1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coerces monetary amounts to a standard string decimal representation with 4 decimal places.
 * Strips currency symbols, thousands separators, and handles accounting parentheses.
 */
export function coerceDecimalAmount(val: unknown, fieldName: string): string {
  if (val === undefined || val === null || String(val).trim() === '') {
    throw new TypeError(`Missing numeric decimal amount for required field '${fieldName}'`);
  }

  let str = String(val).trim();
  str = str.replace(/[₹$€£\s,]/g, '');

  if (/^\(.*\)$/.test(str)) {
    str = '-' + str.slice(1, -1).trim();
  }

  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new TypeError(
      `Field '${fieldName}' value '${val}' cannot be parsed as a valid numeric decimal.`
    );
  }

  const parts = str.split('.');
  const integerPart = parts[0] || '0';
  let decimalPart = parts[1] || '0000';
  if (decimalPart.length > 4) {
    decimalPart = decimalPart.slice(0, 4);
  } else {
    decimalPart = decimalPart.padEnd(4, '0');
  }

  if (integerPart === '-0' && decimalPart === '0000') {
    return '0.0000';
  }

  return `${integerPart}.${decimalPart}`;
}

/**
 * Coerces legacy dates to ISO 8601 (YYYY-MM-DD).
 */
export function coerceIsoDate(val: unknown, fieldName: string): string {
  if (val === undefined || val === null || String(val).trim() === '') {
    throw new TypeError(`Missing date for required field '${fieldName}'`);
  }

  const coerced = coerceDateToIso(String(val));
  if (coerced.isValid) {
    return coerced.cleaned;
  }

  throw new TypeError(
    `Field '${fieldName}' value '${val}' is not a recognized date format. Expected YYYY-MM-DD, YYYY/MM/DD, or DD-MM-YYYY.`
  );
}

/**
 * Coerces integer strings to numbers.
 */
export function coerceInteger(val: unknown, fieldName: string): number {
  if (val === undefined || val === null || String(val).trim() === '') {
    throw new TypeError(`Missing integer value for field '${fieldName}'`);
  }
  const str = String(val).trim().replace(/,/g, '');
  const parsed = parseInt(str, 10);
  if (isNaN(parsed) || !/^-?\d+$/.test(str)) {
    throw new TypeError(`Field '${fieldName}' value '${val}' cannot be parsed as an integer.`);
  }
  return parsed;
}

/**
 * Coerces truthy/falsy representations to boolean.
 */
export function coerceBoolean(val: unknown, defaultValue = true): boolean {
  if (val === undefined || val === null || String(val).trim() === '') {
    return defaultValue;
  }
  const s = String(val).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 't'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'f'].includes(s)) return false;
  return defaultValue;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Module Target Entity Definitions (AC1, AC3)
// ─────────────────────────────────────────────────────────────────────────────

export const erp5DepartmentsTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'code',
    label: 'Department Code',
    type: 'string',
    required: true,
    description: 'Unique alphanumeric department code (e.g. ENG)',
    rules: ['DEP-001', 'RL-REQ-01', 'RL-FORMAT-01'],
    example: 'ENG',
  },
  {
    name: 'name',
    label: 'Department Name',
    type: 'string',
    required: true,
    description: 'Human-readable department name',
    rules: ['DEP-002', 'RL-REQ-01', 'RL-TEXT-01'],
    example: 'Engineering & Development',
  },
  {
    name: 'parent_id',
    label: 'Parent Department Reference',
    type: 'string',
    required: false,
    description: 'UUID reference to parent department',
    rules: ['DEP-003', 'RL-FORMAT-01'],
    example: 'uuid-dep-001',
  },
  {
    name: 'source_id',
    label: 'Source System Identifier',
    type: 'string',
    required: false,
    description: 'Source system record ID for lineage',
    rules: ['PROV-001'],
    example: 'DEP-SRC-001',
  },
];

export const erp5EmployeesTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'employee_no',
    label: 'Employee Number',
    type: 'string',
    required: true,
    description: 'Unique declared employee number under DR-1 (e.g. EMP-1001)',
    rules: ['EMP-001', 'RL-REQ-01', 'RL-FORMAT-01'],
    example: 'EMP-1001',
  },
  {
    name: 'first_name',
    label: 'First Name',
    type: 'string',
    required: true,
    description: 'Employee legal first name',
    rules: ['EMP-002', 'RL-REQ-01', 'RL-NAME-01'],
    example: 'Aarav',
  },
  {
    name: 'last_name',
    label: 'Last Name',
    type: 'string',
    required: true,
    description: 'Employee legal last name',
    rules: ['EMP-003', 'RL-REQ-01', 'RL-NAME-01'],
    example: 'Sharma',
  },
  {
    name: 'department_id',
    label: 'Department Reference',
    type: 'string',
    required: true,
    description: 'Foreign key reference to erp5_departments',
    rules: ['EMP-004', 'RL-REQ-01'],
    example: 'uuid-dep-001',
  },
  {
    name: 'job_title',
    label: 'Job Title',
    type: 'string',
    required: true,
    description: 'Job designation or role description',
    rules: ['EMP-005', 'RL-REQ-01'],
    example: 'Software Engineer',
  },
  {
    name: 'birth_date',
    label: 'Date of Birth',
    type: 'date',
    required: true,
    description: 'Employee date of birth in ISO 8601 (YYYY-MM-DD)',
    rules: ['EMP-006', 'RL-REQ-01', 'RL-DATE-01'],
    example: '1985-05-15',
  },
  {
    name: 'join_date',
    label: 'Join Date',
    type: 'date',
    required: true,
    description: 'Employment start date (must not precede birth_date, BR-ERP5-01)',
    rules: ['EMP-007', 'RL-REQ-01', 'RL-DATE-01', 'BR-ERP5-01'],
    example: '2015-06-01',
  },
  {
    name: 'salary',
    label: 'Salary Amount',
    type: 'decimal',
    required: true,
    description: 'Base salary stored as NUMERIC(20,4); masked on serialization as XX,XXX',
    rules: ['EMP-008', 'RL-REQ-01', 'RL-CURRENCY-01', 'BR-ERP5-02'],
    example: '85000.0000',
  },
  {
    name: 'currency_code',
    label: 'Currency Code',
    type: 'enum',
    required: true,
    enumOptions: ['INR', 'USD', 'EUR'],
    description: 'ISO 4217 currency code',
    rules: ['EMP-009', 'RL-REQ-01', 'RL-FORMAT-01'],
    example: 'INR',
  },
  {
    name: 'source_id',
    label: 'Source System Identifier',
    type: 'string',
    required: false,
    description: 'Source system record ID for lineage',
    rules: ['PROV-001'],
    example: 'EMP-SRC-1001',
  },
  {
    name: 'email',
    label: 'Email Address',
    type: 'string',
    required: false,
    description: 'Employee work email',
    rules: ['RL-EMAIL-01'],
    example: 'aarav.sharma@example.com',
  },
  {
    name: 'phone',
    label: 'Phone Number',
    type: 'string',
    required: false,
    description: 'Sanitized contact phone number',
    rules: ['RL-PHONE-01'],
    example: '+15551234567',
  },
  {
    name: 'employment_status',
    label: 'Employment Status',
    type: 'enum',
    required: false,
    enumOptions: ['active', 'inactive', 'probation', 'terminated', 'on_leave'],
    description: 'Current employee status',
    rules: ['RL-FORMAT-01'],
    example: 'active',
  },
];

export const erp5LeaveTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'employee_id',
    label: 'Employee Reference',
    type: 'string',
    required: true,
    description: 'Foreign key reference to erp5_employees',
    rules: ['LEV-001', 'RL-REQ-01'],
    example: 'uuid-emp-001',
  },
  {
    name: 'leave_type',
    label: 'Leave Type',
    type: 'enum',
    required: true,
    enumOptions: ['annual', 'sick', 'unpaid', 'maternity', 'paternity', 'bereavement'],
    description: 'Standard leave category',
    rules: ['LEV-002', 'RL-REQ-01', 'RL-FORMAT-01'],
    example: 'annual',
  },
  {
    name: 'date_from',
    label: 'Leave Start Date',
    type: 'date',
    required: true,
    description: 'First day of leave in ISO 8601 (YYYY-MM-DD)',
    rules: ['LEV-003', 'RL-REQ-01', 'RL-DATE-01'],
    example: '2026-07-01',
  },
  {
    name: 'date_to',
    label: 'Leave End Date',
    type: 'date',
    required: true,
    description: 'Last day of leave (must not precede date_from, FR-ERP5-04)',
    rules: ['LEV-004', 'RL-REQ-01', 'RL-DATE-01', 'FR-ERP5-04'],
    example: '2026-07-05',
  },
  {
    name: 'status',
    label: 'Leave Request Status',
    type: 'enum',
    required: true,
    enumOptions: ['pending', 'approved', 'rejected', 'cancelled'],
    description: 'Current state in leave approval matrix',
    rules: ['LEV-005', 'RL-REQ-01', 'RL-FORMAT-01'],
    example: 'approved',
  },
  {
    name: 'reason',
    label: 'Leave Reason',
    type: 'string',
    required: false,
    description: 'Free-text justification for leave request',
    rules: ['RL-TEXT-01', 'RL-TEXT-02'],
    example: 'Family vacation',
  },
  {
    name: 'source_id',
    label: 'Source System Identifier',
    type: 'string',
    required: false,
    description: 'Source system record ID for lineage',
    rules: ['PROV-001'],
    example: 'LEV-SRC-001',
  },
];

export const erp5PayrollTotalsTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'department_id',
    label: 'Department Reference',
    type: 'string',
    required: true,
    description: 'Foreign key reference to erp5_departments (aggregates only, FR-ERP5-06)',
    rules: ['PAY-001', 'RL-REQ-01'],
    example: 'uuid-dep-001',
  },
  {
    name: 'month',
    label: 'Payroll Period Month',
    type: 'string',
    required: true,
    description: 'Monthly aggregation period in format YYYY-MM',
    rules: ['PAY-002', 'RL-REQ-01', 'RL-FORMAT-01'],
    example: '2026-06',
  },
  {
    name: 'gross_total',
    label: 'Gross Payroll Total',
    type: 'decimal',
    required: true,
    description: 'Total gross salary for department/month stored as NUMERIC(20,4)',
    rules: ['PAY-003', 'RL-REQ-01', 'RL-CURRENCY-01'],
    example: '500000.0000',
  },
  {
    name: 'net_total',
    label: 'Net Payroll Total',
    type: 'decimal',
    required: true,
    description: 'Total net salary for department/month (cannot exceed gross_total)',
    rules: ['PAY-004', 'RL-REQ-01', 'RL-CURRENCY-01'],
    example: '400000.0000',
  },
  {
    name: 'employee_count',
    label: 'Employee Count',
    type: 'number',
    required: true,
    description: 'Number of active employees in the monthly aggregate',
    rules: ['PAY-005', 'RL-REQ-01'],
    example: 10,
  },
  {
    name: 'currency_code',
    label: 'Currency Code',
    type: 'enum',
    required: true,
    enumOptions: ['INR', 'USD', 'EUR'],
    description: 'ISO 4217 currency code',
    rules: ['PAY-006', 'RL-REQ-01', 'RL-FORMAT-01'],
    example: 'INR',
  },
  {
    name: 'source_id',
    label: 'Source System Identifier',
    type: 'string',
    required: false,
    description: 'Source system record ID for lineage',
    rules: ['PROV-001'],
    example: 'PAY-SRC-001',
  },
];

export const erp5TargetEntities: Readonly<Record<string, TargetEntityMetadata>> = {
  department: {
    entity: 'department',
    label: 'Departments',
    module: 'erp5',
    schemaVersion: 1,
    targetTable: 'erp5.departments',
    primaryKey: 'id',
    naturalKey: 'code',
    fields: erp5DepartmentsTargetFields,
    mappingDefaults: {
      code: 'department_code',
      name: 'department_name',
      parent_id: 'parent_code',
      source_id: 'source_id',
    },
  },
  employee: {
    entity: 'employee',
    label: 'Employees',
    module: 'erp5',
    schemaVersion: 1,
    targetTable: 'erp5.employees',
    primaryKey: 'id',
    naturalKey: 'employee_no',
    fields: erp5EmployeesTargetFields,
    mappingDefaults: {
      employee_no: 'employee_no',
      first_name: 'first_name',
      last_name: 'last_name',
      department_id: 'department_code',
      job_title: 'job_title',
      birth_date: 'birth_date',
      join_date: 'join_date',
      salary: 'salary',
      currency_code: 'currency_code',
      source_id: 'source_id',
      email: 'email',
      phone: 'phone',
    },
  },
  leave: {
    entity: 'leave',
    label: 'Leave Requests',
    module: 'erp5',
    schemaVersion: 1,
    targetTable: 'erp5.leave',
    primaryKey: 'id',
    naturalKey: 'employee_id,date_from',
    fields: erp5LeaveTargetFields,
    mappingDefaults: {
      employee_id: 'employee_no',
      leave_type: 'leave_type',
      date_from: 'date_from',
      date_to: 'date_to',
      status: 'leave_status',
      reason: 'leave_reason',
      source_id: 'source_id',
    },
  },
  payroll_total: {
    entity: 'payroll_total',
    label: 'Payroll Department Totals',
    module: 'erp5',
    schemaVersion: 1,
    targetTable: 'erp5.payroll_totals',
    primaryKey: 'id',
    naturalKey: 'department_id,month',
    fields: erp5PayrollTotalsTargetFields,
    mappingDefaults: {
      department_id: 'department_code',
      month: 'month',
      gross_total: 'gross_total',
      net_total: 'net_total',
      employee_count: 'employee_count',
      currency_code: 'currency_code',
      source_id: 'source_id',
    },
  },
};

export const ERP5_MODULE_METADATA: ModuleKitMetadata = {
  moduleId: 'erp-5',
  moduleName: 'HR and Employees',
  defaultEntity: 'department',
  entities: erp5TargetEntities,
};

// Register ERP-5 with shared Migration Kit registry
registerModuleKitMetadata(ERP5_MODULE_METADATA);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Mapping Validation & Transformation Engine (AC1, AC3, AC4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates mapping configuration for a target ERP-5 entity.
 * Fails if required target fields are unmapped.
 */
export function validateErp5Mapping(
  entityName: string,
  mapping: Record<string, string>,
  sourceColumnTypes?: Record<string, string>
): MappingValidationResult & { missingRequiredFields: string[] } {
  const entity = erp5TargetEntities[entityName];
  if (!entity) {
    throw new Error(`Unknown ERP-5 target entity: '${entityName}'`);
  }

  const result = validateFieldMapping(entity, mapping, sourceColumnTypes);

  // Extract names of missing required target fields
  const missingRequiredFields: string[] = [];
  for (const field of entity.fields) {
    if (field.required) {
      const sourceCol = mapping[field.name];
      if (!sourceCol || sourceCol.trim() === '') {
        missingRequiredFields.push(field.name);
      }
    }
  }

  return {
    ...result,
    valid: missingRequiredFields.length === 0 && result.errors.length === 0,
    missingRequiredFields,
  };
}

/**
 * Transforms a raw source row into target entity shape according to mapping and type coercion rules.
 */
export function transformSourceRowToTarget(
  entityName: string,
  sourceRow: Record<string, string>,
  mapping: Record<string, string>
): Record<string, unknown> {
  const entity = erp5TargetEntities[entityName];
  if (!entity) {
    throw new Error(`Unknown ERP-5 target entity: '${entityName}'`);
  }

  const output: Record<string, unknown> = {};

  for (const field of entity.fields) {
    const sourceCol = mapping[field.name];
    if (!sourceCol || sourceCol.trim() === '') {
      if (field.required) {
        throw new Error(
          `Cannot transform row: required target field '${field.name}' is unmapped.`
        );
      }
      continue;
    }

    const rawVal = sourceRow[sourceCol];
    if (rawVal === undefined || rawVal === null || rawVal.trim() === '') {
      if (field.required) {
        throw new Error(
          `Cannot transform row: required target field '${field.name}' mapped to '${sourceCol}' is blank.`
        );
      }
      output[field.name] = null;
      continue;
    }

    const trimmed = rawVal.trim();

    // Type coercion based on target field type definition
    switch (field.type) {
      case 'decimal':
        output[field.name] = coerceDecimalAmount(trimmed, field.name);
        break;

      case 'date':
        output[field.name] = coerceIsoDate(trimmed, field.name);
        break;

      case 'number':
        output[field.name] = coerceInteger(trimmed, field.name);
        break;

      case 'boolean':
        output[field.name] = coerceBoolean(trimmed);
        break;

      case 'enum':
        if (field.name === 'currency_code') {
          output[field.name] = translateEnum(
            trimmed,
            CURRENCY_CODE_TRANSLATION_MAP,
            field.name
          );
        } else if (field.name === 'leave_type') {
          output[field.name] = translateEnum(
            trimmed,
            LEAVE_TYPE_TRANSLATION_MAP,
            field.name
          );
        } else if (field.name === 'status' || field.name === 'leave_status') {
          output[field.name] = translateEnum(
            trimmed,
            LEAVE_STATUS_TRANSLATION_MAP,
            field.name
          );
        } else if (field.name === 'employment_status') {
          output[field.name] = translateEnum(
            trimmed,
            EMPLOYMENT_STATUS_TRANSLATION_MAP,
            field.name
          );
        } else {
          output[field.name] = trimmed.toLowerCase();
        }
        break;

      case 'string':
      default:
        if (field.name === 'code' || field.name === 'employee_no') {
          output[field.name] = trimmed.toUpperCase();
        } else {
          output[field.name] = trimmed;
        }
        break;
    }
  }

  return output;
}

/**
 * Transforms an array of source rows into clean target records.
 */
export function transformDataset(
  entityName: string,
  rows: readonly Record<string, string>[],
  mapping: Record<string, string>
): readonly Record<string, unknown>[] {
  const validation = validateErp5Mapping(entityName, mapping);
  if (!validation.valid) {
    throw new Error(
      `Cannot transform dataset for '${entityName}': missing required target fields: [${validation.missingRequiredFields.join(
        ', '
      )}]`
    );
  }

  return rows.map((r) => transformSourceRowToTarget(entityName, r, mapping));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Named, Versioned Canonical Mapping Templates (AC4)
// ─────────────────────────────────────────────────────────────────────────────

export interface Erp5MappingTemplate {
  readonly templateId: string;
  readonly templateName: string;
  readonly schemaVersion: number;
  readonly rulesVersion: string;
  readonly entityName: string;
  readonly mapping: Readonly<Record<string, string>>;
}

export const ERP5_CANONICAL_MAPPING_TEMPLATES: readonly Erp5MappingTemplate[] = [
  {
    templateId: 'ERP5-MAP-DEPT-V1',
    templateName: 'Canonical Department Mapping v1',
    schemaVersion: 1,
    rulesVersion: '1.0.0',
    entityName: 'department',
    mapping: {
      code: 'department_code',
      name: 'department_name',
      parent_id: 'parent_code',
      source_id: 'source_id',
    },
  },
  {
    templateId: 'ERP5-MAP-EMP-V1',
    templateName: 'Canonical Employee Mapping v1',
    schemaVersion: 1,
    rulesVersion: '1.0.0',
    entityName: 'employee',
    mapping: {
      employee_no: 'employee_no',
      first_name: 'first_name',
      last_name: 'last_name',
      department_id: 'department_code',
      job_title: 'job_title',
      birth_date: 'birth_date',
      join_date: 'join_date',
      salary: 'salary',
      currency_code: 'currency_code',
      source_id: 'source_id',
      email: 'email',
      phone: 'phone',
    },
  },
  {
    templateId: 'ERP5-MAP-LEAVE-V1',
    templateName: 'Canonical Leave Mapping v1',
    schemaVersion: 1,
    rulesVersion: '1.0.0',
    entityName: 'leave',
    mapping: {
      employee_id: 'employee_no',
      leave_type: 'leave_type',
      date_from: 'date_from',
      date_to: 'date_to',
      status: 'leave_status',
      reason: 'leave_reason',
      source_id: 'source_id',
    },
  },
  {
    templateId: 'ERP5-MAP-PAYROLL-V1',
    templateName: 'Canonical Payroll Totals Mapping v1',
    schemaVersion: 1,
    rulesVersion: '1.0.0',
    entityName: 'payroll_total',
    mapping: {
      department_id: 'department_code',
      month: 'month',
      gross_total: 'gross_total',
      net_total: 'net_total',
      employee_count: 'employee_count',
      currency_code: 'currency_code',
      source_id: 'source_id',
    },
  },
];
