/**
 * ClearShift Migration Kit — Rejection, Review & Export Domain (KIT-16 / ERP1-23)
 *
 * Defines canonical domain types and utilities for reviewing and exporting
 * rejected migration rows with module-specific context.
 *
 * Enforces:
 * - Module-specific identifier columns alongside standardized error codes (AC1).
 * - Human-readable reason text explaining validation or constraint failures (AC2).
 * - Automatic masking/exclusion of sensitive financial, bank, and employee fields (AC3).
 * - Formula-safe CSV export neutralizing formula injection triggers (=, +, -, @, \t, \r) (AC4).
 *
 * @module kit/domain/rejection
 */

import { formatSafeCsv, sanitizeCsvCell } from '@cs/core';

/**
 * Canonical rejected row structure produced during migration dry-run or load phases.
 */
export interface RejectedRow<TRaw = Record<string, unknown>> {
  readonly id: string;
  readonly batchId: string;
  readonly sourceRow: number;
  readonly entity: string;
  readonly schemaVersion?: number | undefined;
  readonly errorCode: string;
  readonly failureReason?: string | undefined;
  readonly field?: string | undefined;
  readonly rawData: TRaw;
  readonly createdAt?: string | undefined;
}

/**
 * Configuration for a display column in the rejection review screen.
 */
export interface RejectionColumnConfig {
  readonly field: string;
  readonly label: string;
  readonly isIdentifier?: boolean | undefined;
  readonly isSensitive?: boolean | undefined;
  readonly format?: ((value: unknown, row: RejectedRow) => string) | undefined;
}

/**
 * Human-readable explanation and remediation guidance for a standardized error code.
 */
export interface FailureExplanation {
  readonly code: string;
  readonly title: string;
  readonly explanation: string;
  readonly docReference?: string | undefined;
  readonly resolution?: string | undefined;
}

/**
 * Contextual action link for navigating to existing conflicting or related records.
 */
export interface ContextualLinkConfig {
  readonly label: string;
  readonly getUrl: (row: RejectedRow) => string;
  readonly openInNewTab?: boolean | undefined;
}

/**
 * Module-specific rejection review context configuration.
 */
export interface ModuleRejectionContext {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly entity: string;
  readonly identifierColumns: readonly RejectionColumnConfig[];
  readonly additionalColumns?: readonly RejectionColumnConfig[] | undefined;
  readonly sensitiveFields?: readonly string[] | undefined;
  readonly failureExplanations: Readonly<Record<string, FailureExplanation>>;
  readonly contextualLinks?: readonly ContextualLinkConfig[] | undefined;
}

/**
 * Default list of sensitive field patterns (financial, bank, employee, credentials)
 * that must be masked or excluded from rejection review interfaces.
 */
export const DEFAULT_SENSITIVE_PATTERNS: readonly string[] = [
  'bankaccount',
  'bank_account',
  'accountnumber',
  'account_number',
  'routingnumber',
  'routing_number',
  'iban',
  'swift',
  'bic',
  'ssn',
  'socialsecurity',
  'social_security',
  'taxid',
  'tax_id',
  'nationalid',
  'national_id',
  'salary',
  'basepay',
  'base_pay',
  'hourlyrate',
  'hourly_rate',
  'compensation',
  'creditcard',
  'credit_card',
  'cardnumber',
  'cvv',
  'pan',
  'pin',
  'password',
  'password_hash',
  'secret',
  'token',
];

/**
 * Determines whether a field name matches known sensitive field patterns.
 */
export function isSensitiveField(
  fieldName: string,
  customSensitiveFields?: readonly string[]
): boolean {
  const normalized = fieldName.toLowerCase().replace(/[-_]/g, '');

  if (customSensitiveFields) {
    for (const field of customSensitiveFields) {
      const normCustom = field.toLowerCase().replace(/[-_]/g, '');
      if (normalized === normCustom || normalized.includes(normCustom)) {
        return true;
      }
    }
  }

  return DEFAULT_SENSITIVE_PATTERNS.some((pattern) => {
    const normPattern = pattern.replace(/[-_]/g, '');
    return normalized === normPattern || normalized.includes(normPattern);
  });
}

/**
 * Masks a sensitive value depending on its type and structure.
 * e.g., bank accounts / card numbers keep last 4 digits: "****-****-1234"
 * tax IDs / SSNs: "***-**-1234"
 * credentials / passwords: "[REDACTED]"
 * salaries: 0 or "[MASKED]"
 */
export function maskSensitiveValue(fieldName: string, value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);
  const normalized = fieldName.toLowerCase().replace(/[-_]/g, '');

  // Credentials / secrets / passwords: fully redacted
  if (
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('pin') ||
    normalized.includes('cvv')
  ) {
    return '[REDACTED]';
  }

  // Salary / compensation
  if (
    normalized.includes('salary') ||
    normalized.includes('compensation') ||
    normalized.includes('pay') ||
    normalized.includes('wage')
  ) {
    return '[CONFIDENTIAL SALARY]';
  }

  // Government IDs / SSN / Tax IDs
  if (
    normalized.includes('ssn') ||
    normalized.includes('socialsecurity') ||
    normalized.includes('taxid') ||
    normalized.includes('nationalid')
  ) {
    if (str.length <= 4) return '***-**-****';
    const unmasked = str.slice(-4);
    return `***-**-${unmasked}`;
  }

  // Bank accounts / IBAN / Credit Cards
  if (
    normalized.includes('bank') ||
    normalized.includes('account') ||
    normalized.includes('iban') ||
    normalized.includes('card') ||
    normalized.includes('routing')
  ) {
    if (str.length <= 4) return '****-****-****';
    const unmasked = str.slice(-4);
    return `****-****-${unmasked}`;
  }

  // Generic fallback masking
  if (str.length <= 4) {
    return '••••••••';
  }
  return `••••••••${str.slice(-4)}`;
}

/**
 * Sanitizes a rejected row by masking all sensitive financial, bank, or employee fields
 * in its rawData payload.
 */
export function maskRejectedRow<T extends Record<string, unknown> = Record<string, unknown>>(
  row: RejectedRow<T>,
  customSensitiveFields?: readonly string[]
): RejectedRow<Record<string, unknown>> {
  const maskedRaw: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(row.rawData || {})) {
    if (isSensitiveField(key, customSensitiveFields)) {
      maskedRaw[key] = maskSensitiveValue(key, val);
    } else if (val && typeof val === 'object' && !(val instanceof Date)) {
      // Recursively mask nested objects
      maskedRaw[key] = maskObjectFields(val as Record<string, unknown>, customSensitiveFields);
    } else {
      maskedRaw[key] = val;
    }
  }

  return {
    ...row,
    rawData: maskedRaw,
  };
}

function maskObjectFields(
  obj: Record<string, unknown>,
  customSensitiveFields?: readonly string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isSensitiveField(k, customSensitiveFields)) {
      result[k] = maskSensitiveValue(k, v);
    } else if (v && typeof v === 'object' && !(v instanceof Date)) {
      result[k] = maskObjectFields(v as Record<string, unknown>, customSensitiveFields);
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Resolves human-readable explanation and remediation guidance for a given error code.
 */
export function resolveFailureExplanation(
  context: ModuleRejectionContext,
  errorCode: string,
  fallbackReason?: string
): FailureExplanation {
  const configured = context.failureExplanations[errorCode];
  if (configured) {
    return configured;
  }

  return {
    code: errorCode,
    title: errorCode.replace(/_/g, ' '),
    explanation: fallbackReason || `Validation or constraint failure: ${errorCode}`,
    resolution: 'Review row data against target schema and business rules before re-submitting.',
  };
}

/**
 * Options for exporting rejected rows to CSV.
 */
export interface CsvExportOptions {
  readonly customSensitiveFields?: readonly string[] | undefined;
  readonly includeAllRawFields?: boolean | undefined;
}

/**
 * Generates a formula-safe CSV string of rejected rows with correct headers.
 * Neutralizes values beginning with =, +, -, @, \t, or \r per PLT-12 / KIT-16.
 * Automatically masks sensitive financial, bank, or employee fields.
 */
export function exportRejectedRowsCsv(
  rows: readonly RejectedRow[],
  context: ModuleRejectionContext,
  options?: CsvExportOptions
): string {
  if (rows.length === 0) {
    return '';
  }

  const sensitiveFields = [
    ...(context.sensitiveFields || []),
    ...(options?.customSensitiveFields || []),
  ];

  // Base columns
  const baseHeaders = ['Source Row', 'Error Code', 'Error Title', 'Reason', 'Doc Reference', 'Resolution'];

  // Module identifier columns
  const identifierHeaders = context.identifierColumns.map((col) => col.label);

  // Additional configured columns
  const additionalHeaders = (context.additionalColumns || []).map((col) => col.label);

  const allHeaders = [...baseHeaders, ...identifierHeaders, ...additionalHeaders, 'Failed Field'];

  const records: Record<string, unknown>[] = rows.map((rawRow) => {
    // Mask sensitive fields first
    const row = maskRejectedRow(rawRow, sensitiveFields);
    const explanation = resolveFailureExplanation(context, row.errorCode, row.failureReason);

    const record: Record<string, unknown> = {
      'Source Row': row.sourceRow,
      'Error Code': row.errorCode,
      'Error Title': explanation.title,
      'Reason': explanation.explanation,
      'Doc Reference': explanation.docReference || 'N/A',
      'Resolution': explanation.resolution || 'N/A',
    };

    // Populate identifier columns
    for (const col of context.identifierColumns) {
      const val = row.rawData[col.field];
      record[col.label] = col.format ? col.format(val, row) : (val ?? '');
    }

    // Populate additional columns
    if (context.additionalColumns) {
      for (const col of context.additionalColumns) {
        const val = row.rawData[col.field];
        record[col.label] = col.format ? col.format(val, row) : (val ?? '');
      }
    }

    record['Failed Field'] = row.field || 'N/A';

    return record;
  });

  return formatSafeCsv(records, allHeaders);
}
