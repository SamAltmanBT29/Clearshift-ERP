/**
 * ClearShift Migration Kit — Shared Cleaning Rules & Field-Level Audit Domain (KIT-04 / SDS §3.4 & §4.4)
 *
 * Implements the 12 canonical V1 cleaning rules from clearshift-core, field-level change auditing,
 * and rule toggle management.
 *
 * Requirements:
 * - FR-CL-01: Apply approved V1 rules to every row; classify outcome (new, cleaned, rejected).
 * - FR-CL-02: Row with a problem in a required field is rejected with a reason code and human reason.
 * - FR-CL-03: Row with a problem in an optional field is cleaned if a rule can fix it, otherwise flagged/kept.
 * - FR-CL-04: Every field modification generates an audit entry: source_row, field_name, original_value, cleaned_value, rule_id.
 * - FR-CL-05: Rules can be selectively enabled or disabled for a batch run.
 *
 * @module kit/domain/cleaner
 */

import { formatSafeCsv } from '@cs/core';

export interface FieldChangeAudit {
  readonly id?: string | undefined;
  readonly batchId?: string | undefined;
  readonly sourceRow: number | string;
  readonly fieldName: string;
  readonly originalValue: string;
  readonly cleanedValue: string;
  readonly ruleId: string;
  readonly timestamp?: string | undefined;
}

export type CleanOutcome = 'new' | 'cleaned' | 'rejected';

export interface RowCleanResult<T = Record<string, string>> {
  readonly sourceRow: number | string;
  readonly outcome: CleanOutcome;
  readonly rawData: T;
  readonly cleanedData: T;
  readonly audits: readonly FieldChangeAudit[];
  readonly rejections: readonly {
    readonly field: string;
    readonly ruleId: string;
    readonly reasonCode: string;
    readonly message: string;
  }[];
}

export interface DatasetCleanResult<T = Record<string, string>> {
  readonly totalRows: number;
  readonly newCount: number;
  readonly cleanedCount: number;
  readonly rejectedCount: number;
  readonly auditCount: number;
  readonly rows: readonly RowCleanResult<T>[];
  readonly audits: readonly FieldChangeAudit[];
  readonly rejections: readonly {
    readonly sourceRow: number | string;
    readonly field: string;
    readonly ruleId: string;
    readonly reasonCode: string;
    readonly message: string;
  }[];
  readonly enabledRuleIds: readonly string[];
  readonly generatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical 12 V1 Cleaning Rule Definitions (SDS §3.4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CleaningRuleDefinition {
  readonly ruleId: string;
  readonly name: string;
  readonly description: string;
  readonly defaultEnabled: boolean;
}

export const V1_CLEANING_RULES: readonly CleaningRuleDefinition[] = [
  {
    ruleId: 'RL-TEXT-01',
    name: 'Whitespace Trimming & Space Collapsing',
    description: 'Trim leading/trailing whitespace and collapse multiple inner spaces into one.',
    defaultEnabled: true,
  },
  {
    ruleId: 'RL-TEXT-02',
    name: 'Control Characters Removal',
    description: 'Remove unprintable ASCII control characters and unusual invisible unicode symbols.',
    defaultEnabled: true,
  },
  {
    ruleId: 'RL-NAME-01',
    name: 'Proper Case Name Normalization',
    description: 'Title-case names while preserving standard particles and apostrophes (e.g. O\'Brien, McDonald).',
    defaultEnabled: true,
  },
  {
    ruleId: 'RL-EMAIL-01',
    name: 'Email Normalization & Validation',
    description: 'Trim, lowercase, and verify valid email structure (exactly one @, domain dot).',
    defaultEnabled: true,
  },
  {
    ruleId: 'RL-PHONE-01',
    name: 'Phone Sanitization & Country Code Coercion',
    description: 'Strip punctuation; prefix default country code if 10 digits without prefix.',
    defaultEnabled: true,
  },
  {
    ruleId: 'RL-DATE-01',
    name: 'Date Coercion to ISO 8601',
    description: 'Coerce valid dates (slash, hyphen, period) to canonical ISO YYYY-MM-DD.',
    defaultEnabled: true,
  },
  {
    ruleId: 'RL-CURRENCY-01',
    name: 'Currency & Decimal Formatting',
    description: 'Remove currency symbols ($/€/₹) and thousands separators, normalize decimal point.',
    defaultEnabled: true,
  },
  {
    ruleId: 'RL-ADDR-01',
    name: 'Address & City Dictionary Standardization',
    description: 'Standardize common city/region names (e.g. Bombay -> Mumbai).',
    defaultEnabled: true,
  },
  {
    ruleId: 'RL-REQ-01',
    name: 'Required Field Presence Verification',
    description: 'Reject rows where mandatory fields are blank or missing.',
    defaultEnabled: true,
  },
  {
    ruleId: 'RL-FORMAT-01',
    name: 'Domain Format Validation',
    description: 'Validate regex patterns for codes, identifiers, and formatted fields.',
    defaultEnabled: true,
  },
  {
    ruleId: 'RL-DUP-01',
    name: 'Exact Normalized Key Duplicate Flagging',
    description: 'Identify exact duplicates on declared natural keys post-normalization.',
    defaultEnabled: true,
  },
  {
    ruleId: 'RL-TAX-01',
    name: 'Tax Number Formatting',
    description: 'Normalize tax IDs, strip separators, verify pattern per country.',
    defaultEnabled: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Standard Cleaner Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RL-TEXT-01: Trim start/end whitespace and collapse inner multiple spaces to one.
 */
export function cleanTextWhitespace(val: string): string {
  return val.trim().replace(/\s+/g, ' ');
}

/**
 * RL-TEXT-02: Remove control characters (\x00-\x1F, \x7F) and zero-width spaces (\u200B-\u200D, \uFEFF).
 */
export function cleanControlCharacters(val: string): string {
  // eslint-disable-next-line no-control-regex
  return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\uFEFF]/g, '');
}

/**
 * RL-NAME-01: Proper-case names with exception handling for prefixes (O', Mc).
 */
export function cleanProperName(val: string): string {
  const trimmed = cleanTextWhitespace(val);
  if (!trimmed) return '';
  return trimmed
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower.startsWith("o'") && word.length > 2) {
        return "O'" + word.charAt(2).toUpperCase() + word.slice(3).toLowerCase();
      }
      if (lower.startsWith('mc') && word.length > 2) {
        return 'Mc' + word.charAt(2).toUpperCase() + word.slice(3).toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * RL-EMAIL-01: Trim and lowercase email.
 */
export function cleanEmail(val: string): { cleaned: string; isValid: boolean } {
  const trimmed = val.trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return {
    cleaned: trimmed,
    isValid: emailRegex.test(trimmed),
  };
}

/**
 * RL-PHONE-01: Normalize phone to digits + optional leading '+'.
 * If 10 digits and defaultCountryCode provided (e.g. '+91' or '+1'), prepends it.
 */
export function cleanPhone(val: string, defaultCountryCode?: string): string {
  const trimmed = val.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  if (hasPlus) {
    return `+${digits}`;
  }
  if (digits.length === 10 && defaultCountryCode) {
    const prefix = defaultCountryCode.startsWith('+') ? defaultCountryCode : `+${defaultCountryCode}`;
    return `${prefix}${digits}`;
  }
  return digits;
}

/**
 * RL-DATE-01: Coerce valid calendar date formats to ISO 8601 (YYYY-MM-DD).
 * Supports YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY.
 */
export function cleanIsoDate(val: string, declaredFormat: 'YYYY-MM-DD' | 'DD-MM-YYYY' = 'YYYY-MM-DD'): {
  cleaned: string;
  isValid: boolean;
} {
  const trimmed = val.trim();
  if (!trimmed) return { cleaned: '', isValid: false };

  // Normalize delimiters to '-'
  const normalized = trimmed.replace(/[\/.]/g, '-');

  // Case 1: YYYY-MM-DD
  const ymdMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (ymdMatch) {
    const y = parseInt(ymdMatch[1]!, 10);
    const m = parseInt(ymdMatch[2]!, 10);
    const d = parseInt(ymdMatch[3]!, 10);
    if (isValidDateParts(y, m, d)) {
      const padM = String(m).padStart(2, '0');
      const padD = String(d).padStart(2, '0');
      return { cleaned: `${y}-${padM}-${padD}`, isValid: true };
    }
    return { cleaned: trimmed, isValid: false };
  }

  // Case 2: DD-MM-YYYY
  const dmyMatch = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(normalized);
  if (dmyMatch && declaredFormat === 'DD-MM-YYYY') {
    const d = parseInt(dmyMatch[1]!, 10);
    const m = parseInt(dmyMatch[2]!, 10);
    const y = parseInt(dmyMatch[3]!, 10);
    if (isValidDateParts(y, m, d)) {
      const padM = String(m).padStart(2, '0');
      const padD = String(d).padStart(2, '0');
      return { cleaned: `${y}-${padM}-${padD}`, isValid: true };
    }
    return { cleaned: trimmed, isValid: false };
  }

  return { cleaned: trimmed, isValid: false };
}

function isValidDateParts(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDays = daysInMonth[m - 1];
  return maxDays !== undefined && d <= maxDays;
}

/**
 * RL-CURRENCY-01: Remove currency symbols ($, €, ₹, £), spaces, and thousand commas.
 * Preserves leading negative sign and exact decimal fraction.
 */
export function cleanCurrencyDecimal(val: string): { cleaned: string; isValid: boolean } {
  const trimmed = val.trim();
  if (!trimmed) return { cleaned: '', isValid: false };

  // Remove currency symbols and thousand separator commas
  const stripped = trimmed.replace(/[$€₹£\s,]/g, '');
  const isValid = /^-?\d+(\.\d{1,4})?$/.test(stripped);
  return {
    cleaned: stripped,
    isValid,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Field Cleaner Engine & Rule Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldCleanRuleConfig {
  readonly field: string;
  readonly label?: string | undefined;
  readonly required?: boolean | undefined;
  readonly recordType?: string | undefined;
  readonly clean: (
    value: string,
    row: Record<string, string>,
    enabledRules: ReadonlySet<string>
  ) => {
    cleaned: string;
    audits: { ruleId: string; original: string; cleaned: string }[];
    error?: { ruleId: string; reasonCode: string; message: string } | undefined;
  };
}

export interface CleanerConfig {
  readonly fields: readonly FieldCleanRuleConfig[];
  readonly enabledRuleIds?: readonly string[] | undefined;
  readonly sourceRowField?: string | undefined; // default 'row_id' or 1-based index
  readonly recordTypeField?: string | undefined; // default 'record_type'
}

/**
 * Cleans an entire dataset row by row, tracking field modifications in an audit ledger
 * and recording structured rejections when required constraints or unrecoverable formats fail.
 */
export function cleanDataset<T extends Record<string, string>>(
  rows: readonly T[],
  config: CleanerConfig
): DatasetCleanResult<T> {
  const enabledSet = new Set(
    config.enabledRuleIds && config.enabledRuleIds.length > 0
      ? config.enabledRuleIds
      : V1_CLEANING_RULES.map((r) => r.ruleId)
  );

  const cleanedRows: RowCleanResult<T>[] = [];
  const allAudits: FieldChangeAudit[] = [];
  const allRejections: {
    sourceRow: number | string;
    field: string;
    ruleId: string;
    reasonCode: string;
    message: string;
  }[] = [];

  let newCount = 0;
  let cleanedCount = 0;
  let rejectedCount = 0;

  for (let idx = 0; idx < rows.length; idx++) {
    const rawRow = rows[idx]!;
    const sourceRow = config.sourceRowField && rawRow[config.sourceRowField]
      ? rawRow[config.sourceRowField]!
      : idx + 1;

    const rowRecType = config.recordTypeField ? rawRow[config.recordTypeField] : undefined;
    const workingRow = { ...rawRow };
    const rowAudits: FieldChangeAudit[] = [];
    const rowRejections: {
      field: string;
      ruleId: string;
      reasonCode: string;
      message: string;
    }[] = [];

    // Apply configured field cleaning rules
    for (const rule of config.fields) {
      if (rule.recordType && rowRecType && rule.recordType !== rowRecType) {
        continue;
      }

      const rawVal = workingRow[rule.field] ?? '';
      const result = rule.clean(rawVal, workingRow, enabledSet);

      if (result.cleaned !== rawVal) {
        workingRow[rule.field as keyof T] = result.cleaned as T[keyof T];
      }

      for (const aud of result.audits) {
        const auditEntry: FieldChangeAudit = {
          sourceRow,
          fieldName: rule.field,
          originalValue: aud.original,
          cleanedValue: aud.cleaned,
          ruleId: aud.ruleId,
          timestamp: new Date().toISOString(),
        };
        rowAudits.push(auditEntry);
        allAudits.push(auditEntry);
      }

      if (result.error) {
        const rej = {
          sourceRow,
          field: rule.field,
          ruleId: result.error.ruleId,
          reasonCode: result.error.reasonCode,
          message: result.error.message,
        };
        rowRejections.push(rej);
        allRejections.push(rej);
      }
    }

    let outcome: CleanOutcome;
    if (rowRejections.length > 0) {
      outcome = 'rejected';
      rejectedCount++;
    } else if (rowAudits.length > 0) {
      outcome = 'cleaned';
      cleanedCount++;
    } else {
      outcome = 'new';
      newCount++;
    }

    cleanedRows.push({
      sourceRow,
      outcome,
      rawData: rawRow,
      cleanedData: workingRow as T,
      audits: Object.freeze(rowAudits),
      rejections: Object.freeze(rowRejections),
    });
  }

  return {
    totalRows: rows.length,
    newCount,
    cleanedCount,
    rejectedCount,
    auditCount: allAudits.length,
    rows: Object.freeze(cleanedRows),
    audits: Object.freeze(allAudits),
    rejections: Object.freeze(allRejections),
    enabledRuleIds: Object.freeze(Array.from(enabledSet)),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Exports field-level change audits to formula-safe CSV conforming to SDS §4.4 (kit_clean_log).
 */
export function exportFieldAuditCsv(audits: readonly FieldChangeAudit[]): string {
  const records = audits.map((a) => ({
    'Source Row': String(a.sourceRow),
    'Field Name': a.fieldName,
    'Original Value': a.originalValue,
    'Cleaned Value': a.cleanedValue,
    'Rule ID': a.ruleId,
    'Timestamp': a.timestamp ?? '',
  }));

  const columns = [
    'Source Row',
    'Field Name',
    'Original Value',
    'Cleaned Value',
    'Rule ID',
    'Timestamp',
  ];

  return formatSafeCsv(records, columns);
}
