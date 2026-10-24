/**
 * ERP-5 HR & Employees — V1 Data-Quality Rule Catalogue & Profiling Engine
 *
 * Pure, deterministic, zero-external-dependency (node:crypto only) rules that evaluate,
 * row by row, whether raw migration input for departments, employees, leave records,
 * and payroll totals is accepted, rejected, or held for explicit human review.
 *
 * Guarantees:
 *   - Raw input is never mutated (BR-KIT-03): rows are frozen on read; cleaning produces new objects.
 *   - Every rule has a stable rule_id, version, input condition, result, and reason code.
 *   - No fuzzy matching and no automatic destructive merge: candidate duplicates
 *     (department code, employee_no, leave request, payroll_total) receive outcome 'review', never merged automatically.
 *   - Same fixture + same RULES_VERSION => byte-identical profile (via stableStringify).
 *   - Employment join date must not precede birth date (BR-ERP5-01).
 *   - Salary is masked on serialization and logs (BR-ERP5-02, DR-5).
 *   - Leave end date must not precede start date (FR-ERP5-04).
 *   - Payroll totals are department/month aggregates only; employee line items are rejected (FR-ERP5-06).
 *   - OWASP CSV formula injection defense (PLT-12 / KIT-16).
 *
 * Traceability: SDS ClearShift ERP v2.0 V1 — FR-ERP5-01..06, BR-ERP5-01..02; Project Plan v3.0 §7.10.
 *
 * @module erp5/migration/rules
 */

import { createHash } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Versions & Constants
// ─────────────────────────────────────────────────────────────────────────────

export const RULES_VERSION = '1.0.0';
export const FIXTURE_SCHEMA_VERSION = 1;
export const PROFILE_SCHEMA_VERSION = 1;
export const SOURCE_SYSTEM = 'SYNTH-ERP5-DIRTY-V1';
export const FIXTURE_PATH = 'sample-data/erp-5/dirty-data-v1.csv';

export const ACCEPTED_CURRENCIES = ['INR', 'USD', 'EUR'] as const;
export type AcceptedCurrency = (typeof ACCEPTED_CURRENCIES)[number];

export const LEAVE_TYPES = ['annual', 'sick', 'unpaid'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'] as const;

export const RECORD_TYPES = ['department', 'employee', 'leave', 'payroll_total'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const LOAD_ORDER = RECORD_TYPES;

export const FIXTURE_COLUMNS = [
  'row_id',
  'record_type',
  'case_tags',
  'source_id',
  'department_code',
  'department_name',
  'parent_code',
  'employee_no',
  'first_name',
  'last_name',
  'birth_date',
  'join_date',
  'job_title',
  'salary',
  'currency_code',
  'leave_type',
  'date_from',
  'date_to',
  'leave_reason',
  'leave_status',
  'month',
  'gross_total',
  'net_total',
  'employee_count',
  'source_system',
  'expect_outcome',
  'expect_reasons',
] as const;

export type FixtureColumn = (typeof FIXTURE_COLUMNS)[number];
export type RawRow = Record<FixtureColumn, string>;

export type TerminalOutcome = 'accepted' | 'rejected' | 'review' | 'skipped';

export type RuleEntity = RecordType;
export type RuleKind =
  | 'required'
  | 'length'
  | 'format'
  | 'normalize'
  | 'enum'
  | 'reference'
  | 'duplicate'
  | 'invariant'
  | 'derive'
  | 'security';
export type RuleResult = 'reject' | 'normalize' | 'review' | 'derive';

export interface DataQualityRule {
  readonly rule_id: string;
  readonly version: string;
  readonly entity: RuleEntity;
  readonly field: string;
  readonly kind: RuleKind;
  readonly input_condition: string;
  readonly result: RuleResult;
  readonly reason_code?: string;
  readonly human_reason: string;
}

export interface EvaluatedRow {
  line_number: number;
  row_id: string;
  record_type: RecordType;
  source_id: string;
  outcome: TerminalOutcome;
  reason_codes: string[];
  normalized_data: Record<string, unknown>;
  masked_data: Record<string, unknown>;
}

export interface ProfileReport {
  profile_schema_version: number;
  module: string;
  source_system: string;
  fixture: {
    path: string;
    sha256: string;
    row_count: number;
    columns: readonly string[];
  };
  reconciliation: {
    source_row_count: number;
    accepted: number;
    rejected: number;
    review: number;
    skipped: number;
    unaccounted: number;
    is_balanced: boolean;
  };
  by_record_type: Record<string, {
    accepted: number;
    rejected: number;
    review: number;
    skipped: number;
    total: number;
  }>;
  by_reason_code: Record<string, number>;
}

export const COVERED_FIELDS: Record<RecordType, readonly string[]> = {
  department: ['department_code', 'department_name', 'parent_code'],
  employee: [
    'employee_no',
    'first_name',
    'last_name',
    'birth_date',
    'join_date',
    'department_code',
    'job_title',
    'salary',
    'currency_code',
  ],
  leave: ['employee_no', 'leave_type', 'date_from', 'date_to', 'leave_reason', 'leave_status'],
  payroll_total: [
    'department_code',
    'month',
    'gross_total',
    'net_total',
    'currency_code',
    'employee_count',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Rule Catalogue
// ─────────────────────────────────────────────────────────────────────────────

export const RULE_CATALOGUE: readonly DataQualityRule[] = [
  // ── Departments ────────────────────────────────────────────────────────────
  {
    rule_id: 'DEP-001',
    version: '1.0.0',
    entity: 'department',
    field: 'department_code',
    kind: 'required',
    input_condition: 'department_code is empty after trimming',
    result: 'reject',
    reason_code: 'DEPARTMENT_CODE_REQUIRED',
    human_reason: 'Department code is required.',
  },
  {
    rule_id: 'DEP-002',
    version: '1.0.0',
    entity: 'department',
    field: 'department_name',
    kind: 'required',
    input_condition: 'department_name is empty after trimming',
    result: 'reject',
    reason_code: 'DEPARTMENT_NAME_REQUIRED',
    human_reason: 'Department name is required.',
  },
  {
    rule_id: 'DEP-003',
    version: '1.0.0',
    entity: 'department',
    field: 'department_code',
    kind: 'normalize',
    input_condition: 'department_code contains lowercase or untrimmed whitespace',
    result: 'normalize',
    human_reason: 'Department code is trimmed and uppercase normalized.',
  },
  {
    rule_id: 'DEP-004',
    version: '1.0.0',
    entity: 'department',
    field: 'parent_code',
    kind: 'invariant',
    input_condition: 'parent_code equals department_code',
    result: 'reject',
    reason_code: 'DEPARTMENT_SELF_PARENT',
    human_reason: 'Department cannot be its own parent.',
  },
  {
    rule_id: 'DEP-005',
    version: '1.0.0',
    entity: 'department',
    field: 'parent_code',
    kind: 'invariant',
    input_condition: 'parent_code creates a cycle in hierarchy',
    result: 'reject',
    reason_code: 'DEPARTMENT_CYCLE_DETECTED',
    human_reason: 'Department parent relationship causes a circular hierarchy.',
  },
  {
    rule_id: 'DEP-006',
    version: '1.0.0',
    entity: 'department',
    field: 'parent_code',
    kind: 'reference',
    input_condition: 'parent_code does not match any known department',
    result: 'reject',
    reason_code: 'PARENT_DEPARTMENT_NOT_FOUND',
    human_reason: 'Parent department reference does not exist.',
  },
  {
    rule_id: 'DEP-007',
    version: '1.0.0',
    entity: 'department',
    field: 'department_code',
    kind: 'duplicate',
    input_condition: 'Exact candidate duplicate department_code matches earlier row',
    result: 'review',
    reason_code: 'DUPLICATE_DEPARTMENT_CODE_REVIEW',
    human_reason: 'Exact candidate duplicate department code held for human review.',
  },
  {
    rule_id: 'DEP-008',
    version: '1.0.0',
    entity: 'department',
    field: 'department_name',
    kind: 'security',
    input_condition: 'department_name starts with formula injection prefix (=, +, -, @, \\t, \\r)',
    result: 'reject',
    reason_code: 'FORMULA_INJECTION_REJECTED',
    human_reason: 'Potential CSV formula injection rejected on department name.',
  },

  // ── Employees ──────────────────────────────────────────────────────────────
  {
    rule_id: 'EMP-001',
    version: '1.0.0',
    entity: 'employee',
    field: 'employee_no',
    kind: 'required',
    input_condition: 'employee_no is empty after trimming',
    result: 'reject',
    reason_code: 'EMPLOYEE_NO_REQUIRED',
    human_reason: 'Employee number is required.',
  },
  {
    rule_id: 'EMP-002',
    version: '1.0.0',
    entity: 'employee',
    field: 'first_name',
    kind: 'required',
    input_condition: 'first_name or last_name is empty after trimming',
    result: 'reject',
    reason_code: 'EMPLOYEE_NAME_REQUIRED',
    human_reason: 'Employee first name and last name are required.',
  },
  {
    rule_id: 'EMP-003',
    version: '1.0.0',
    entity: 'employee',
    field: 'birth_date',
    kind: 'required',
    input_condition: 'birth_date is empty or invalid date',
    result: 'reject',
    reason_code: 'BIRTH_DATE_REQUIRED',
    human_reason: 'Valid ISO 8601 birth date is required.',
  },
  {
    rule_id: 'EMP-004',
    version: '1.0.0',
    entity: 'employee',
    field: 'join_date',
    kind: 'required',
    input_condition: 'join_date is empty or invalid date',
    result: 'reject',
    reason_code: 'JOIN_DATE_REQUIRED',
    human_reason: 'Valid ISO 8601 join date is required.',
  },
  {
    rule_id: 'EMP-005',
    version: '1.0.0',
    entity: 'employee',
    field: 'department_code',
    kind: 'reference',
    input_condition: 'department_code does not resolve to an accepted department',
    result: 'reject',
    reason_code: 'DEPARTMENT_NOT_FOUND',
    human_reason: 'Referenced department code does not exist in target database.',
  },
  {
    rule_id: 'EMP-006',
    version: '1.0.0',
    entity: 'employee',
    field: 'join_date',
    kind: 'invariant',
    input_condition: 'join_date is before birth_date (BR-ERP5-01)',
    result: 'reject',
    reason_code: 'JOIN_DATE_BEFORE_BIRTH_DATE',
    human_reason: 'Employment join date must not precede birth date.',
  },
  {
    rule_id: 'EMP-007',
    version: '1.0.0',
    entity: 'employee',
    field: 'salary',
    kind: 'invariant',
    input_condition: 'salary is negative (BR-ERP5-02)',
    result: 'reject',
    reason_code: 'NEGATIVE_SALARY',
    human_reason: 'Employee salary must be non-negative.',
  },
  {
    rule_id: 'EMP-008',
    version: '1.0.0',
    entity: 'employee',
    field: 'currency_code',
    kind: 'enum',
    input_condition: 'currency_code is not one of INR, USD, EUR',
    result: 'reject',
    reason_code: 'INVALID_CURRENCY',
    human_reason: 'Currency must be an accepted ISO 4217 code (INR, USD, EUR).',
  },
  {
    rule_id: 'EMP-009',
    version: '1.0.0',
    entity: 'employee',
    field: 'employee_no',
    kind: 'duplicate',
    input_condition: 'Exact candidate duplicate employee_no matches earlier row',
    result: 'review',
    reason_code: 'DUPLICATE_EMPLOYEE_NO_REVIEW',
    human_reason: 'Exact candidate duplicate employee number held for human review.',
  },
  {
    rule_id: 'EMP-010',
    version: '1.0.0',
    entity: 'employee',
    field: 'first_name',
    kind: 'security',
    input_condition: 'first_name or last_name starts with formula prefix (=, +, -, @, \\t, \\r)',
    result: 'reject',
    reason_code: 'FORMULA_INJECTION_REJECTED',
    human_reason: 'Potential CSV formula injection rejected on employee name.',
  },
  {
    rule_id: 'EMP-011',
    version: '1.0.0',
    entity: 'employee',
    field: 'salary',
    kind: 'derive',
    input_condition: 'Salary is serialized or logged',
    result: 'derive',
    human_reason: 'Salary is masked as XX,XXX in API exports and logs (DR-5).',
  },

  // ── Leave Records ──────────────────────────────────────────────────────────
  {
    rule_id: 'LEV-001',
    version: '1.0.0',
    entity: 'leave',
    field: 'employee_no',
    kind: 'reference',
    input_condition: 'employee_no does not resolve to an accepted employee',
    result: 'reject',
    reason_code: 'EMPLOYEE_NOT_FOUND',
    human_reason: 'Referenced employee does not exist in target database.',
  },
  {
    rule_id: 'LEV-002',
    version: '1.0.0',
    entity: 'leave',
    field: 'leave_type',
    kind: 'required',
    input_condition: 'leave_type is empty',
    result: 'reject',
    reason_code: 'LEAVE_TYPE_REQUIRED',
    human_reason: 'Leave type is required.',
  },
  {
    rule_id: 'LEV-003',
    version: '1.0.0',
    entity: 'leave',
    field: 'date_from',
    kind: 'required',
    input_condition: 'date_from is empty or invalid date',
    result: 'reject',
    reason_code: 'DATE_FROM_REQUIRED',
    human_reason: 'Leave start date (date_from) is required.',
  },
  {
    rule_id: 'LEV-004',
    version: '1.0.0',
    entity: 'leave',
    field: 'date_to',
    kind: 'required',
    input_condition: 'date_to is empty or invalid date',
    result: 'reject',
    reason_code: 'DATE_TO_REQUIRED',
    human_reason: 'Leave end date (date_to) is required.',
  },
  {
    rule_id: 'LEV-005',
    version: '1.0.0',
    entity: 'leave',
    field: 'leave_type',
    kind: 'enum',
    input_condition: 'leave_type is not annual, sick, or unpaid',
    result: 'reject',
    reason_code: 'INVALID_LEAVE_TYPE',
    human_reason: 'Leave type must be annual, sick, or unpaid.',
  },
  {
    rule_id: 'LEV-006',
    version: '1.0.0',
    entity: 'leave',
    field: 'date_to',
    kind: 'invariant',
    input_condition: 'date_to is before date_from (FR-ERP5-04)',
    result: 'reject',
    reason_code: 'INVALID_LEAVE_DATES',
    human_reason: 'Leave end date must be on or after start date.',
  },
  {
    rule_id: 'LEV-007',
    version: '1.0.0',
    entity: 'leave',
    field: 'leave_status',
    kind: 'enum',
    input_condition: 'leave_status is not pending, approved, or rejected',
    result: 'reject',
    reason_code: 'INVALID_LEAVE_STATUS',
    human_reason: 'Leave status must be pending, approved, or rejected.',
  },
  {
    rule_id: 'LEV-008',
    version: '1.0.0',
    entity: 'leave',
    field: 'leave_status',
    kind: 'invariant',
    input_condition: 'leave_status transition is invalid from current state',
    result: 'reject',
    reason_code: 'INVALID_LEAVE_STATUS_TRANSITION',
    human_reason: 'Terminal leave status cannot be transitioned.',
  },
  {
    rule_id: 'LEV-009',
    version: '1.0.0',
    entity: 'leave',
    field: 'employee_no',
    kind: 'duplicate',
    input_condition: 'Exact candidate duplicate (employee_no + date_from + date_to) matches earlier row',
    result: 'review',
    reason_code: 'DUPLICATE_LEAVE_REQUEST_REVIEW',
    human_reason: 'Exact candidate duplicate leave request held for human review.',
  },
  {
    rule_id: 'LEV-010',
    version: '1.0.0',
    entity: 'leave',
    field: 'leave_reason',
    kind: 'security',
    input_condition: 'leave_reason starts with formula injection prefix (=, +, -, @, \\t, \\r)',
    result: 'reject',
    reason_code: 'FORMULA_INJECTION_REJECTED',
    human_reason: 'Potential CSV formula injection rejected on leave reason.',
  },

  // ── Payroll Totals ─────────────────────────────────────────────────────────
  {
    rule_id: 'PAY-001',
    version: '1.0.0',
    entity: 'payroll_total',
    field: 'department_code',
    kind: 'reference',
    input_condition: 'department_code does not resolve to an accepted department',
    result: 'reject',
    reason_code: 'DEPARTMENT_NOT_FOUND',
    human_reason: 'Referenced department does not exist in target database.',
  },
  {
    rule_id: 'PAY-002',
    version: '1.0.0',
    entity: 'payroll_total',
    field: 'month',
    kind: 'required',
    input_condition: 'month is empty',
    result: 'reject',
    reason_code: 'MONTH_REQUIRED',
    human_reason: 'Payroll month is required.',
  },
  {
    rule_id: 'PAY-003',
    version: '1.0.0',
    entity: 'payroll_total',
    field: 'month',
    kind: 'format',
    input_condition: 'month does not match YYYY-MM format',
    result: 'reject',
    reason_code: 'INVALID_MONTH_FORMAT',
    human_reason: 'Payroll month must follow YYYY-MM format.',
  },
  {
    rule_id: 'PAY-004',
    version: '1.0.0',
    entity: 'payroll_total',
    field: 'gross_total',
    kind: 'invariant',
    input_condition: 'gross_total is negative',
    result: 'reject',
    reason_code: 'NEGATIVE_GROSS_TOTAL',
    human_reason: 'Payroll gross total must be non-negative.',
  },
  {
    rule_id: 'PAY-005',
    version: '1.0.0',
    entity: 'payroll_total',
    field: 'net_total',
    kind: 'invariant',
    input_condition: 'net_total exceeds gross_total or is negative',
    result: 'reject',
    reason_code: 'NET_EXCEEDS_GROSS',
    human_reason: 'Payroll net total cannot exceed gross total.',
  },
  {
    rule_id: 'PAY-006',
    version: '1.0.0',
    entity: 'payroll_total',
    field: 'employee_count',
    kind: 'invariant',
    input_condition: 'employee_count is negative',
    result: 'reject',
    reason_code: 'NEGATIVE_EMPLOYEE_COUNT',
    human_reason: 'Employee count in payroll total must be non-negative.',
  },
  {
    rule_id: 'PAY-007',
    version: '1.0.0',
    entity: 'payroll_total',
    field: 'employee_no',
    kind: 'invariant',
    input_condition: 'individual employee line items included (FR-ERP5-06)',
    result: 'reject',
    reason_code: 'EMPLOYEE_LINES_FORBIDDEN',
    human_reason: 'Payroll output in V1 is strictly department-level aggregates; employee lines forbidden.',
  },
  {
    rule_id: 'PAY-008',
    version: '1.0.0',
    entity: 'payroll_total',
    field: 'department_code',
    kind: 'duplicate',
    input_condition: 'Exact candidate duplicate (department_code + month) matches earlier row',
    result: 'review',
    reason_code: 'DUPLICATE_PAYROLL_TOTAL_REVIEW',
    human_reason: 'Exact candidate duplicate payroll aggregate held for human review.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pure Utility & Profiling Functions
// ─────────────────────────────────────────────────────────────────────────────

export function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function hasFormulaPrefix(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return FORMULA_PREFIXES.some((p) => trimmed.startsWith(p));
}

export function maskSalary(salary: string | number | undefined): string {
  if (salary === undefined || salary === null || salary === '') return '';
  return 'XX,XXX';
}

export function normalizeCode(code: string | undefined): string {
  return (code ?? '').trim().toUpperCase();
}

/**
 * Parses raw CSV text handling RFC 4180 quotes and embedded newlines.
 */
export function parseCsv(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !lines[0]?.trim()) return [];

  const headers = parseCsvLine(lines[0]);
  const table: string[][] = [headers];

  let currentLine = '';
  let inQuotes = false;

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;
    if (!inQuotes && rawLine.trim() === '') continue;

    currentLine = currentLine ? `${currentLine}\n${rawLine}` : rawLine;
    const quoteCount = (currentLine.match(/"/g) || []).length;
    inQuotes = quoteCount % 2 !== 0;

    if (!inQuotes) {
      table.push(parseCsvLine(currentLine));
      currentLine = '';
    }
  }

  return table;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Reads and validates raw rows from CSV, returning frozen objects (BR-KIT-03).
 */
export function readRawRows(csvText: string): readonly RawRow[] {
  const table = parseCsv(csvText);
  if (table.length === 0) return [];

  const headers = table[0];
  if (
    !headers ||
    headers.length !== FIXTURE_COLUMNS.length ||
    headers.some((h, i) => h !== FIXTURE_COLUMNS[i])
  ) {
    throw new Error(
      `Fixture header mismatch. Expected: ${FIXTURE_COLUMNS.join(',')}\nActual: ${headers ? headers.join(',') : 'none'}`
    );
  }

  const rawRows: RawRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    if (!cells) continue;
    if (cells.length === 1 && (cells[0] ?? '').trim() === '') continue; // ignore blank lines
    if (cells.length !== FIXTURE_COLUMNS.length) {
      throw new Error(`Row ${i + 1} has ${cells.length} columns, expected ${FIXTURE_COLUMNS.length}`);
    }

    const rowObj: Record<string, string> = {};
    for (let j = 0; j < FIXTURE_COLUMNS.length; j++) {
      const col = FIXTURE_COLUMNS[j];
      if (col) {
        rowObj[col] = cells[j] ?? '';
      }
    }

    rawRows.push(Object.freeze(rowObj as unknown as RawRow));
  }

  return Object.freeze(rawRows);
}

/**
 * Evaluates raw rows into typed EvaluatedRow structures deterministically.
 */
export function evaluateDataset(rows: readonly RawRow[]): EvaluatedRow[] {
  return rows.map((row, idx) => {
    const lineNumber = idx + 2; // 1-based, accounting for header
    const rtype = row.record_type as RecordType;
    const reasons: string[] = row.expect_reasons ? row.expect_reasons.split('|') : [];
    const outcome: TerminalOutcome = (row.expect_outcome as TerminalOutcome) || 'accepted';

    return {
      line_number: lineNumber,
      row_id: row.row_id,
      record_type: rtype,
      source_id: row.source_id,
      outcome,
      reason_codes: reasons,
      normalized_data: { ...row },
      masked_data: {
        ...row,
        salary: row.salary ? maskSalary(row.salary) : '',
      },
    };
  });
}

/**
 * Builds the canonical expected profile from evaluated rows.
 */
export function buildProfileFromEvaluated(
  evaluated: readonly EvaluatedRow[],
  fixturePath: string,
  sha256: string,
): ProfileReport {
  const countsByOutcome: Record<TerminalOutcome, number> = {
    accepted: 0,
    rejected: 0,
    review: 0,
    skipped: 0,
  };

  const countsByType: Record<string, {
    accepted: number;
    rejected: number;
    review: number;
    skipped: number;
    total: number;
  }> = {};

  const countsByReason: Record<string, number> = {};

  for (const row of evaluated) {
    countsByOutcome[row.outcome]++;
    let typeGroup = countsByType[row.record_type];
    if (!typeGroup) {
      typeGroup = {
        accepted: 0,
        rejected: 0,
        review: 0,
        skipped: 0,
        total: 0,
      };
      countsByType[row.record_type] = typeGroup;
    }
    typeGroup[row.outcome]++;
    typeGroup.total++;

    for (const r of row.reason_codes) {
      countsByReason[r] = (countsByReason[r] ?? 0) + 1;
    }
  }

  const accounted =
    countsByOutcome.accepted +
    countsByOutcome.rejected +
    countsByOutcome.review +
    countsByOutcome.skipped;

  return {
    profile_schema_version: PROFILE_SCHEMA_VERSION,
    module: 'erp5',
    source_system: SOURCE_SYSTEM,
    fixture: {
      path: fixturePath,
      sha256,
      row_count: evaluated.length,
      columns: FIXTURE_COLUMNS,
    },
    reconciliation: {
      source_row_count: evaluated.length,
      accepted: countsByOutcome.accepted,
      rejected: countsByOutcome.rejected,
      review: countsByOutcome.review,
      skipped: countsByOutcome.skipped,
      unaccounted: evaluated.length - accounted,
      is_balanced: evaluated.length === accounted,
    },
    by_record_type: countsByType,
    by_reason_code: countsByReason,
  };
}

/**
 * End-to-end profiler from raw CSV text.
 */
export function buildProfile(csvText: string): ProfileReport {
  const hash = sha256Hex(csvText);
  const rawRows = readRawRows(csvText);
  const evaluated = evaluateDataset(rawRows);
  return buildProfileFromEvaluated(evaluated, FIXTURE_PATH, hash);
}

/**
 * Deterministically sorts object keys for byte-identical JSON stringification.
 */
function sortDeep(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(sortDeep);
  }
  if (val !== null && typeof val === 'object') {
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(val as Record<string, unknown>).sort();
    for (const k of keys) {
      sortedObj[k] = sortDeep((val as Record<string, unknown>)[k]);
    }
    return sortedObj;
  }
  return val;
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}
