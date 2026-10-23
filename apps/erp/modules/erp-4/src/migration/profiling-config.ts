/**
 * ERP-4 Finance & Accounting — Column Profiler Configuration (ERP4-26 / KIT-03)
 *
 * Configures the shared Migration Kit column profiler for ERP-4 domain columns
 * (accounts, opening balances, journal entries, journal lines) and exact duplicate
 * candidate keys matching the canonical Dirty Data Pack manifest.
 *
 * @module erp4/migration/profiling-config
 */

import {
  profileDataset,
  exportProfileReportToCsv,
  type ProfilerConfig,
  type ColumnRule,
  type DuplicateKeyRule,
  type DatasetProfileReport,
} from '@cs/kit';

export const ACCEPTED_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'INR']);
export const ACCEPTED_ACCOUNT_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense']);

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const BOOLEAN_REGEX = /^(true|false|1|0|yes|no)$/i;
const DECIMAL_AMOUNT_REGEX = /^-?\d+(\.\d{1,2})?$/;

/**
 * Validates a real calendar date YYYY-MM-DD.
 */
function isValidCalendarDate(val: string): boolean {
  if (!ISO_DATE_REGEX.test(val)) return false;
  const parts = val.split('-');
  const y = parseInt(parts[0]!, 10);
  const m = parseInt(parts[1]!, 10);
  const d = parseInt(parts[2]!, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Validates plain decimal monetary amounts with at most 2 decimal places.
 */
function isValidMonetaryAmount(val: string): boolean {
  if (!DECIMAL_AMOUNT_REGEX.test(val)) return false;
  if (val.startsWith('-')) return false; // non-negative per domain rules
  if (val.replace(/[.-]/g, '').length > 18) return false; // NUMERIC(18,2)
  return true;
}

export const ERP4_COLUMN_RULES: readonly ColumnRule[] = [
  // ── Account Columns ────────────────────────────────────────────────────────
  {
    column: 'code',
    label: 'Account Code',
    recordType: 'account',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= 64 && /^[0-9A-Za-z._-]+$/.test(v),
  },
  {
    column: 'name',
    label: 'Account Name',
    recordType: 'account',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= 128,
  },
  {
    column: 'type',
    label: 'Account Type',
    recordType: 'account',
    required: true,
    formatValidator: (v) => ACCEPTED_ACCOUNT_TYPES.has(v.toLowerCase()),
  },
  {
    column: 'currency_code',
    label: 'Currency Code',
    recordType: 'account',
    required: true,
    formatValidator: (v) => ACCEPTED_CURRENCIES.has(v.toUpperCase()),
  },
  {
    column: 'parent_code',
    label: 'Parent Account Code',
    recordType: 'account',
    required: false,
    formatValidator: (v) => v.length <= 64 && /^[0-9A-Za-z._-]+$/.test(v),
  },
  {
    column: 'description',
    label: 'Account Description',
    recordType: 'account',
    required: false,
    formatValidator: (v) => v.length <= 255,
  },
  {
    column: 'is_active',
    label: 'Is Active Flag',
    recordType: 'account',
    required: false,
    formatValidator: (v) => BOOLEAN_REGEX.test(v),
  },
  {
    column: 'is_posting_account',
    label: 'Is Posting Account Flag',
    recordType: 'account',
    required: false,
    formatValidator: (v) => BOOLEAN_REGEX.test(v),
  },

  // ── Opening Balance Columns ────────────────────────────────────────────────
  {
    column: 'code',
    label: 'Opening Balance Account Code',
    recordType: 'opening_balance',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= 64,
  },
  {
    column: 'currency_code',
    label: 'Opening Balance Currency',
    recordType: 'opening_balance',
    required: true,
    formatValidator: (v) => ACCEPTED_CURRENCIES.has(v.toUpperCase()),
  },
  {
    column: 'balance_amount',
    label: 'Opening Balance Amount',
    recordType: 'opening_balance',
    required: true,
    formatValidator: isValidMonetaryAmount,
  },
  {
    column: 'as_of_date',
    label: 'As of Date',
    recordType: 'opening_balance',
    required: true,
    formatValidator: isValidCalendarDate,
  },
  {
    column: 'description',
    label: 'Opening Balance Narration',
    recordType: 'opening_balance',
    required: false,
    formatValidator: (v) => v.length <= 255,
  },

  // ── Journal Entry Columns ──────────────────────────────────────────────────
  {
    column: 'entry_number',
    label: 'Journal Entry Number',
    recordType: 'journal_entry',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= 64,
  },
  {
    column: 'period_label',
    label: 'Fiscal Period Label',
    recordType: 'journal_entry',
    required: true,
    formatValidator: (v) => PERIOD_REGEX.test(v),
  },
  {
    column: 'posting_date',
    label: 'Posting Date',
    recordType: 'journal_entry',
    required: true,
    formatValidator: isValidCalendarDate,
  },
  {
    column: 'description',
    label: 'Journal Description',
    recordType: 'journal_entry',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= 255,
  },
  {
    column: 'currency_code',
    label: 'Journal Currency',
    recordType: 'journal_entry',
    required: true,
    formatValidator: (v) => ACCEPTED_CURRENCIES.has(v.toUpperCase()),
  },

  // ── Journal Line Columns ───────────────────────────────────────────────────
  {
    column: 'parent_source_id',
    label: 'Parent Entry Source ID',
    recordType: 'journal_line',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= 64,
  },
  {
    column: 'code',
    label: 'Line Account Code',
    recordType: 'journal_line',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= 64,
  },
  {
    column: 'debit_amount',
    label: 'Debit Amount',
    recordType: 'journal_line',
    required: true,
    formatValidator: isValidMonetaryAmount,
  },
  {
    column: 'credit_amount',
    label: 'Credit Amount',
    recordType: 'journal_line',
    required: true,
    formatValidator: isValidMonetaryAmount,
  },
  {
    column: 'line_narration',
    label: 'Line Narration',
    recordType: 'journal_line',
    required: false,
    formatValidator: (v) => v.length <= 255,
  },
  {
    column: 'department_ref',
    label: 'Department Reference',
    recordType: 'journal_line',
    required: false,
    formatValidator: (v) => v.length <= 64,
  },
];

export const ERP4_DUPLICATE_KEY_RULES: readonly DuplicateKeyRule[] = [
  {
    name: 'account_code',
    label: 'Account Code (Exact Match)',
    recordType: 'account',
    extractKey: (r) => (r['code'] && r['code'].trim() ? r['code'].trim().toUpperCase() : null),
  },
  {
    name: 'opening_balance_key',
    label: 'Opening Balance (Account + Currency)',
    recordType: 'opening_balance',
    extractKey: (r) => {
      const code = r['code'] ? r['code'].trim().toUpperCase() : '';
      const curr = r['currency_code'] ? r['currency_code'].trim().toUpperCase() : '';
      return code && curr ? `${code}:${curr}` : null;
    },
  },
  {
    name: 'journal_entry_number',
    label: 'Journal Entry Number (Exact Match)',
    recordType: 'journal_entry',
    extractKey: (r) => (r['entry_number'] && r['entry_number'].trim() ? r['entry_number'].trim().toUpperCase() : null),
  },
];

export const ERP4_PROFILER_CONFIG: ProfilerConfig = {
  columns: ERP4_COLUMN_RULES,
  duplicateKeys: ERP4_DUPLICATE_KEY_RULES,
  maxTopValues: 5,
};

/**
 * Executes column profiling on an ERP-4 tabular dataset using the shared profiler.
 */
export function profileErp4Dataset(
  rows: readonly Record<string, string>[],
  rawCsvText?: string
): DatasetProfileReport {
  return profileDataset(rows, ERP4_PROFILER_CONFIG, rawCsvText);
}

/**
 * Generates formula-safe CSV export for ERP-4 profiling report.
 */
export function exportErp4ProfileCsv(report: DatasetProfileReport): string {
  return exportProfileReportToCsv(report);
}
