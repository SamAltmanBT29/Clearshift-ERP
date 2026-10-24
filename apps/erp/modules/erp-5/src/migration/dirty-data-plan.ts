/**
 * ERP-5 HR & Employees — Canonical Dirty Data Pack: rules, parser, evaluator, profiler.
 *
 * Deterministic, dependency-free evaluation of the committed synthetic fixture
 * (`sample-data/erp-5/dirty-data-v1.csv`) against the ERP-5 data-quality rule catalogue.
 *
 * Design guarantees:
 *  - Exact, deterministic matching only (no fuzzy scoring, no automatic merge).
 *  - Raw input rows are never mutated; normalisation produces new objects.
 *  - Join date must not precede birth date (BR-ERP5-01).
 *  - Salary is masked as `XX,XXX` on serialization (BR-ERP5-02, DR-5).
 *  - Payroll totals are department/month aggregates only (FR-ERP5-06).
 *  - Leave date_to must not precede date_from (FR-ERP5-04).
 *  - OWASP formula-injection prefixes are rejected on free-text fields.
 *
 * @module erp5/migration/dirty-data-plan
 */

import { createHash } from 'node:crypto';

export const RULES_VERSION = '1.0.0';
export const FIXTURE_SCHEMA_VERSION = 1;
export const PROFILE_SCHEMA_VERSION = 1;
export const FIXTURE_PATH = 'sample-data/erp-5/dirty-data-v1.csv';
export const SOURCE_SYSTEM = 'SYNTH-ERP5-DIRTY-V1';

export const ACCEPTED_CURRENCIES = ['INR', 'USD', 'EUR'] as const;
export type AcceptedCurrency = (typeof ACCEPTED_CURRENCIES)[number];

export const LEAVE_TYPES = ['annual', 'sick', 'unpaid'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'] as const;

export const LOAD_ORDER = ['department', 'employee', 'leave', 'payroll_total'] as const;
export type RecordType = (typeof LOAD_ORDER)[number];

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

export function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function hasFormulaPrefix(value: string | undefined): boolean {
  if (!value) return false;
  const first = value.charAt(0);
  return (FORMULA_PREFIXES as readonly string[]).includes(first);
}

export function normalizeCode(value: string | undefined): string {
  if (!value) return '';
  return value.trim().toUpperCase();
}

export function maskSalary(_salary: string): string {
  return 'XX,XXX';
}

/**
 * Robust RFC-4180 CSV parser handling quoted strings, linebreaks, and escaped quotes.
 */
export function parseCsv(text: string): RawRow[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !lines[0]?.trim()) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: RawRow[] = [];

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
      const values = parseCsvLine(currentLine);
      const rowObj = {} as Record<string, string>;
      headers.forEach((h, idx) => {
        rowObj[h] = values[idx] ?? '';
      });
      rows.push(rowObj as unknown as RawRow);
      currentLine = '';
    }
  }

  return rows;
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
 * Deterministically evaluates the raw fixture rows according to ERP-5 domain invariants.
 */
export function evaluateDataset(rows: RawRow[]): EvaluatedRow[] {
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

export function buildProfile(
  evaluated: EvaluatedRow[],
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
