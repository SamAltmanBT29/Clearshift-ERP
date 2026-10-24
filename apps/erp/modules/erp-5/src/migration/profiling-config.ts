/**
 * ERP-5 HR & Employees — Column Profiler Configuration (ERP5-26 / KIT-03)
 *
 * Configures the shared Migration Kit column profiler (`@cs/kit`) for the ERP-5 domain columns
 * (departments, employees, leave records, payroll totals) and the exact-duplicate candidate keys that match the
 * canonical Dirty Data Pack manifest (ERP5-25).
 *
 * Design guarantees:
 *  - No duplicate platform infrastructure: profiling, duplicate grouping and the formula-safe CSV
 *    export all come from the shared profiler; key normalisers and helpers are reused from
 *    `dirty-data-plan.ts`.
 *  - Exact, deterministic duplicate keys only (no fuzzy scoring, no auto-merge).
 *  - Non-destructive: input rows are never mutated; a masked copy is profiled.
 *  - Salary column is masked as `XX,XXX` on serialization (BR-ERP5-02, DR-5); raw salaries are not exposed in top values.
 *
 * @module erp5/migration/profiling-config
 */

import {
  profileDataset,
  exportProfileReportToCsv,
  type ColumnRule,
  type DatasetProfileReport,
  type DuplicateKeyRule,
  type ProfilerConfig,
} from '@cs/kit';
import {
  ACCEPTED_CURRENCIES,
  LEAVE_TYPES,
  LEAVE_STATUSES,
  hasFormulaPrefix,
  normalizeCode,
  type RawRow,
} from './dirty-data-plan.js';

const CURRENCY_SET: ReadonlySet<string> = new Set<string>(ACCEPTED_CURRENCIES);
const LEAVE_TYPE_SET: ReadonlySet<string> = new Set<string>(LEAVE_TYPES);
const LEAVE_STATUS_SET: ReadonlySet<string> = new Set<string>(LEAVE_STATUSES);

const isValidCurrency = (v: string): boolean => CURRENCY_SET.has(v.trim().toUpperCase());
const isValidIsoDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
const isValidMonth = (v: string): boolean => /^\d{4}-\d{2}$/.test(v.trim());

export const ERP5_COLUMN_RULES: readonly ColumnRule[] = [
  // ── Department columns ─────────────────────────────────────────────────────
  {
    column: 'department_code',
    label: 'Department Code',
    recordType: 'department',
    required: true,
    formatValidator: (v) => v.trim().length > 0 && v.trim().length <= 32 && !hasFormulaPrefix(v),
  },
  {
    column: 'department_name',
    label: 'Department Name',
    recordType: 'department',
    required: true,
    formatValidator: (v) => v.trim().length > 0 && v.trim().length <= 255 && !hasFormulaPrefix(v),
  },
  {
    column: 'parent_code',
    label: 'Parent Department Code',
    recordType: 'department',
    required: false,
    formatValidator: (v, r) => !hasFormulaPrefix(v) && (!v || normalizeCode(v) !== normalizeCode(r['department_code'])),
  },

  // ── Employee columns ───────────────────────────────────────────────────────
  {
    column: 'employee_no',
    label: 'Employee Number',
    recordType: 'employee',
    required: true,
    formatValidator: (v) => v.trim().length > 0 && v.trim().length <= 32 && !hasFormulaPrefix(v),
  },
  {
    column: 'first_name',
    label: 'First Name',
    recordType: 'employee',
    required: true,
    formatValidator: (v) => v.trim().length > 0 && v.trim().length <= 120 && !hasFormulaPrefix(v),
  },
  {
    column: 'last_name',
    label: 'Last Name',
    recordType: 'employee',
    required: true,
    formatValidator: (v) => v.trim().length > 0 && v.trim().length <= 120 && !hasFormulaPrefix(v),
  },
  {
    column: 'birth_date',
    label: 'Date of Birth',
    recordType: 'employee',
    required: true,
    formatValidator: isValidIsoDate,
  },
  {
    column: 'join_date',
    label: 'Employment Join Date',
    recordType: 'employee',
    required: true,
    formatValidator: (v, r) => {
      if (!isValidIsoDate(v)) return false;
      const bdate = r['birth_date'];
      if (bdate && isValidIsoDate(bdate) && v < bdate) {
        return false;
      }
      return true;
    },
  },
  {
    column: 'department_code',
    label: 'Department Reference',
    recordType: 'employee',
    required: true,
    formatValidator: (v) => v.trim().length > 0 && !hasFormulaPrefix(v),
  },
  {
    column: 'job_title',
    label: 'Job Title',
    recordType: 'employee',
    required: true,
    formatValidator: (v) => v.trim().length > 0 && v.trim().length <= 120 && !hasFormulaPrefix(v),
  },
  {
    column: 'currency_code',
    label: 'Salary Currency',
    recordType: 'employee',
    required: true,
    formatValidator: isValidCurrency,
  },

  // ── Leave columns ──────────────────────────────────────────────────────────
  {
    column: 'employee_no',
    label: 'Employee Reference',
    recordType: 'leave',
    required: true,
    formatValidator: (v) => v.trim().length > 0 && !hasFormulaPrefix(v),
  },
  {
    column: 'leave_type',
    label: 'Leave Type',
    recordType: 'leave',
    required: true,
    formatValidator: (v) => LEAVE_TYPE_SET.has(v.trim()),
  },
  {
    column: 'date_from',
    label: 'Leave Start Date',
    recordType: 'leave',
    required: true,
    formatValidator: isValidIsoDate,
  },
  {
    column: 'date_to',
    label: 'Leave End Date',
    recordType: 'leave',
    required: true,
    formatValidator: (v, r) => {
      const dfrom = r['date_from'];
      return isValidIsoDate(v) && (!dfrom || !isValidIsoDate(dfrom) || v >= dfrom);
    },
  },
  {
    column: 'leave_status',
    label: 'Leave Status',
    recordType: 'leave',
    required: true,
    formatValidator: (v) => LEAVE_STATUS_SET.has(v.trim()),
  },

  // ── Payroll total columns ──────────────────────────────────────────────────
  {
    column: 'department_code',
    label: 'Department Reference',
    recordType: 'payroll_total',
    required: true,
    formatValidator: (v) => v.trim().length > 0 && !hasFormulaPrefix(v),
  },
  {
    column: 'month',
    label: 'Fiscal Month',
    recordType: 'payroll_total',
    required: true,
    formatValidator: (v) => isValidMonth(v) && !hasFormulaPrefix(v),
  },
  {
    column: 'gross_total',
    label: 'Gross Payroll Amount',
    recordType: 'payroll_total',
    required: true,
    formatValidator: (v) => {
      const n = parseFloat(v);
      return !isNaN(n) && n >= 0 && !hasFormulaPrefix(v);
    },
  },
  {
    column: 'net_total',
    label: 'Net Payroll Amount',
    recordType: 'payroll_total',
    required: true,
    formatValidator: (v, r) => {
      const net = parseFloat(v);
      const gross = parseFloat(r['gross_total'] ?? '');
      return !isNaN(net) && net >= 0 && (isNaN(gross) || net <= gross) && !hasFormulaPrefix(v);
    },
  },
  {
    column: 'employee_count',
    label: 'Employee Headcount',
    recordType: 'payroll_total',
    required: true,
    formatValidator: (v) => {
      const n = parseInt(v, 10);
      return !isNaN(n) && n >= 0;
    },
  },
  {
    column: 'currency_code',
    label: 'Payroll Currency',
    recordType: 'payroll_total',
    required: true,
    formatValidator: isValidCurrency,
  },
];

export const ERP5_DUPLICATE_KEY_RULES: readonly DuplicateKeyRule[] = [
  {
    name: 'department_code',
    label: 'Department Code Natural Key',
    recordType: 'department',
    extractKey: (r) => {
      const code = normalizeCode(r['department_code']);
      return code.length > 0 ? code : null;
    },
  },
  {
    name: 'employee_no',
    label: 'Employee Number Natural Key',
    recordType: 'employee',
    extractKey: (r) => {
      const no = normalizeCode(r['employee_no']);
      return no.length > 0 ? no : null;
    },
  },
  {
    name: 'leave_request',
    label: 'Leave Request Candidate Key',
    recordType: 'leave',
    extractKey: (r) => {
      const no = normalizeCode(r['employee_no']);
      const dfrom = r['date_from']?.trim();
      const dto = r['date_to']?.trim();
      return no && dfrom && dto ? `${no}#${dfrom}#${dto}` : null;
    },
  },
  {
    name: 'payroll_aggregate',
    label: 'Payroll Month Department Aggregate Key',
    recordType: 'payroll_total',
    extractKey: (r) => {
      const dept = normalizeCode(r['department_code']);
      const month = r['month']?.trim();
      return dept && month ? `${dept}#${month}` : null;
    },
  },
];

export const ERP5_PROFILER_CONFIG: ProfilerConfig = {
  columns: ERP5_COLUMN_RULES,
  duplicateKeys: ERP5_DUPLICATE_KEY_RULES,
  maxTopValues: 5,
};

export function profileErp5Dataset(
  rows: readonly RawRow[],
  rawContent?: string,
): DatasetProfileReport {
  return profileDataset(rows as unknown as readonly Record<string, string>[], ERP5_PROFILER_CONFIG, rawContent);
}

export function exportErp5ProfileCsv(report: DatasetProfileReport): string {
  return exportProfileReportToCsv(report);
}
