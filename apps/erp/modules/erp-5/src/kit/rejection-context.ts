/**
 * ERP-5 HR and Employees — Rejection Review Context (KIT-16 / ERP5-23)
 *
 * Configures module context for the shared Migration Kit rejection review and
 * export screens.
 *
 * Guarantees:
 * - Module-specific identifier columns (employee number, department code, leave
 *   period, payroll month) alongside standard error codes (AC1).
 * - Human-readable reason text explaining validation or constraint failures (AC2).
 * - Automatic masking/exclusion of sensitive financial, bank, or employee fields
 *   (salary, bank details, government IDs) (AC3).
 * - Formula-safe CSV export downloads filtered rejected rows with correct
 *   headers (AC4).
 *
 * @module erp5/kit/rejection-context
 */

import type {
  ModuleRejectionContext,
  FailureExplanation,
  RejectedRow,
} from '@cs/kit';

/**
 * Standardized failure explanations for ERP-5 domain errors.
 */
export const erp5FailureExplanations: Readonly<Record<string, FailureExplanation>> = {
  DUPLICATE_EMPLOYEE_NO: {
    code: 'DUPLICATE_EMPLOYEE_NO',
    title: 'Duplicate Employee Number',
    explanation:
      'Employee number is already registered (BR-ERP5-01). Employee numbers must be globally unique across all active records.',
    docReference: 'BR-ERP5-01',
    resolution: 'Verify existing employee catalog in ERP-5 or re-map the source employee number.',
  },
  INVALID_DEPARTMENT_REFERENCE: {
    code: 'INVALID_DEPARTMENT_REFERENCE',
    title: 'Department Not Found',
    explanation:
      'Referenced department does not exist in erp5_departments (BR-ERP5-02).',
    docReference: 'BR-ERP5-02',
    resolution: 'Import or create the department prior to importing employees.',
  },
  INVALID_LEAVE_DATE_RANGE: {
    code: 'INVALID_LEAVE_DATE_RANGE',
    title: 'Invalid Leave Period',
    explanation:
      'Leave end date cannot precede start date (FR-ERP5-04).',
    docReference: 'FR-ERP5-04',
    resolution: 'Correct the date_from/date_to values so that date_to >= date_from.',
  },
  INVALID_LEAVE_EMPLOYEE: {
    code: 'INVALID_LEAVE_EMPLOYEE',
    title: 'Employee Not Found',
    explanation:
      'Referenced employee does not exist in erp5_employees (FR-ERP5-04).',
    docReference: 'FR-ERP5-04',
    resolution: 'Import or create the employee prior to importing leave records.',
  },
  JOIN_DATE_BEFORE_BIRTH_DATE: {
    code: 'JOIN_DATE_BEFORE_BIRTH_DATE',
    title: 'Invalid Join Date',
    explanation:
      'Join date can never precede birth date (BR-ERP5-01).',
    docReference: 'BR-ERP5-01',
    resolution: 'Correct the birth_date or join_date so that join_date >= birth_date.',
  },
  NEGATIVE_SALARY: {
    code: 'NEGATIVE_SALARY',
    title: 'Negative Salary',
    explanation:
      'Salary must be non-negative (BR-ERP5-02).',
    docReference: 'BR-ERP5-02',
    resolution: 'Ensure salary is >= 0.',
  },
  DUPLICATE_DEPARTMENT_CODE: {
    code: 'DUPLICATE_DEPARTMENT_CODE',
    title: 'Duplicate Department Code',
    explanation:
      'Department code is already registered (FR-ERP5-01). Department codes must be globally unique.',
    docReference: 'FR-ERP5-01',
    resolution: 'Verify existing departments in ERP-5 or re-map the source department code.',
  },
  INVALID_PARENT_DEPARTMENT: {
    code: 'INVALID_PARENT_DEPARTMENT',
    title: 'Parent Department Not Found',
    explanation:
      'Referenced parent department does not exist in erp5_departments (FR-ERP5-01).',
    docReference: 'FR-ERP5-01',
    resolution: 'Import or create the parent department prior to importing the child.',
  },
  MISSING_REQUIRED_FIELD: {
    code: 'MISSING_REQUIRED_FIELD',
    title: 'Missing Mandatory Field',
    explanation:
      'A required HR field (such as employee number, name, department, or leave dates) is missing or blank.',
    docReference: 'FR-ERP5-02',
    resolution: 'Populate all mandatory columns in source data before importing.',
  },
  SOURCE_VALUE_MUTATED: {
    code: 'SOURCE_VALUE_MUTATED',
    title: 'Raw Source Value Alteration',
    explanation:
      'Raw source values must be preserved without destructive mutation (KIT-08).',
    docReference: 'KIT-08',
    resolution: 'Retain original sourceSystem and sourceId untouched.',
  },
};

/**
 * ERP-5 HR Module Rejection Context configuration.
 */
export const erp5RejectionContext: ModuleRejectionContext = {
  moduleId: 'erp5',
  moduleName: 'ERP-5 HR and Employees',
  entity: 'employees',

  identifierColumns: [
    {
      field: 'employee_no',
      label: 'Employee Number',
      isIdentifier: true,
      format: (val) => (val !== undefined && val !== null ? String(val).trim() : '—'),
    },
    {
      field: 'first_name',
      label: 'First Name',
      isIdentifier: true,
    },
    {
      field: 'last_name',
      label: 'Last Name',
      isIdentifier: true,
    },
    {
      field: 'department_id',
      label: 'Department ID',
    },
    {
      field: 'source_id',
      label: 'Source ID',
      isIdentifier: true,
    },
  ],

  additionalColumns: [
    {
      field: 'job_title',
      label: 'Job Title',
    },
    {
      field: 'birth_date',
      label: 'Birth Date',
    },
    {
      field: 'join_date',
      label: 'Join Date',
    },
  ],

  sensitiveFields: [
    'salary',
    'base_pay',
    'basepay',
    'compensation',
    'hourly_rate',
    'hourlyrate',
    'bank_account',
    'bank_account_number',
    'bankaccount',
    'iban',
    'swift',
    'bic',
    'ssn',
    'social_security',
    'socialsecurity',
    'tax_id',
    'taxid',
    'national_id',
    'nationalid',
    'government_id',
    'password',
    'password_hash',
    'secret',
    'token',
    'credit_card',
    'creditcard',
  ],

  failureExplanations: erp5FailureExplanations,

  contextualLinks: [
    {
      label: 'Search Employees',
      getUrl: (row: RejectedRow) => {
        const no = row.rawData['employee_no'];
        return `/erp5/employees?search=${encodeURIComponent(typeof no === 'string' ? no : '')}`;
      },
    },
    {
      label: 'Data Dictionary',
      getUrl: () => 'docs/data-dictionaries/erp-5.md',
      openInNewTab: true,
    },
  ],
};
