/**
 * ERP-2 Vendors & Purchasing — Column Profiler Configuration (ERP2-26 / KIT-03)
 *
 * Configures the shared Migration Kit column profiler (`@cs/kit`) for the ERP-2 domain columns
 * (vendors, purchase orders, PO lines) and the exact-duplicate candidate keys that match the
 * canonical Dirty Data Pack manifest (ERP2-25).
 *
 * Design guarantees:
 *  - No duplicate platform infrastructure: profiling, duplicate grouping and the formula-safe CSV
 *    export all come from the shared profiler; key normalisers and helpers are reused from
 *    `dirty-data-plan.ts`.
 *  - Exact, deterministic duplicate keys only (no fuzzy scoring, no auto-merge).
 *  - Non-destructive: input rows are never mutated; a masked copy is profiled.
 *  - Bank account values are NEVER profiled (the profiler would emit them as "top values");
 *    the column has no rule and the profiled copy carries only the masked value.
 *
 * @module erp2/migration/profiling-config
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
  ERP1_REFERENCE_SKUS,
  MAX_PAYMENT_TERMS_DAYS,
  MAX_VENDOR_CODE_LENGTH,
  classifyDate,
  hasFormulaPrefix,
  isValidStatusPath,
  maskBankAccount,
  normalizeCode,
  normalizePoNumber,
  normalizeStatus,
  normalizeTaxNumber,
  parseScaledDecimal,
} from './dirty-data-plan.js';

const CURRENCY_SET: ReadonlySet<string> = new Set<string>(ACCEPTED_CURRENCIES);
const SKU_SET: ReadonlySet<string> = new Set<string>(ERP1_REFERENCE_SKUS);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TAX_NORMALIZED_REGEX = /^[A-Z0-9]{4,32}$/;
const INTEGER_REGEX = /^\d+$/;
const DECIMAL_REGEX = /^\d+(\.\d+)?$/;

const isValidCurrency = (v: string): boolean => CURRENCY_SET.has(v);
const isValidStatus = (v: string): boolean => normalizeStatus(v) !== null;
/** Same rule as the ERP2-25 evaluator: decimal with at most 3 places, strictly greater than zero. */
const isValidQuantity = (v: string): boolean => {
  const q = parseScaledDecimal(v, 3);
  return q !== null && !q.negative && q.units > BigInt(0);
};
/** Same rule as the ERP2-25 evaluator: decimal with at most 4 places, not negative. */
const isValidUnitPrice = (v: string): boolean => {
  const p = parseScaledDecimal(v, 4);
  return p !== null && !p.negative;
};
const isNonNegativeDecimal = (v: string): boolean => DECIMAL_REGEX.test(v);

export const ERP2_COLUMN_RULES: readonly ColumnRule[] = [
  // ── Vendor columns ─────────────────────────────────────────────────────────
  {
    column: 'vendor_code',
    label: 'Vendor Code',
    recordType: 'vendor',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= MAX_VENDOR_CODE_LENGTH,
  },
  {
    column: 'vendor_name',
    label: 'Vendor Name',
    recordType: 'vendor',
    required: true,
    formatValidator: (v) => v.length <= 255 && !hasFormulaPrefix(v),
  },
  {
    column: 'tax_number',
    label: 'Tax Number',
    recordType: 'vendor',
    required: false,
    formatValidator: (v) => TAX_NORMALIZED_REGEX.test(normalizeTaxNumber(v)),
  },
  {
    column: 'email',
    label: 'Vendor Email',
    recordType: 'vendor',
    required: false,
    formatValidator: (v) => v.length <= 254 && EMAIL_REGEX.test(v),
  },
  {
    column: 'currency',
    label: 'Vendor Currency',
    recordType: 'vendor',
    required: true,
    formatValidator: isValidCurrency,
  },
  {
    column: 'payment_terms_days',
    label: 'Payment Terms (days)',
    recordType: 'vendor',
    required: false,
    formatValidator: (v) => INTEGER_REGEX.test(v) && Number(v) <= MAX_PAYMENT_TERMS_DAYS,
  },
  // NOTE: bank_account is intentionally NOT profiled (sensitive; see module header).

  // ── Purchase order columns ─────────────────────────────────────────────────
  {
    column: 'po_number',
    label: 'PO Number',
    recordType: 'purchase_order',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= 64 && !hasFormulaPrefix(v),
  },
  {
    column: 'po_vendor_code',
    label: 'PO Vendor Code',
    recordType: 'purchase_order',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= MAX_VENDOR_CODE_LENGTH,
  },
  {
    column: 'po_status',
    label: 'PO Status',
    recordType: 'purchase_order',
    required: true,
    formatValidator: isValidStatus,
  },
  {
    // Validates only the transition path; an unrecognised po_status is reported on the po_status column.
    column: 'status_path',
    label: 'PO Status Path',
    recordType: 'purchase_order',
    required: false,
    formatValidator: (v, row) => {
      const finalStatus = normalizeStatus(row['po_status'] ?? '');
      return finalStatus === null ? true : isValidStatusPath(v, finalStatus);
    },
  },
  {
    column: 'po_date',
    label: 'PO Order Date',
    recordType: 'purchase_order',
    required: true,
    formatValidator: (v) => classifyDate(v) === 'iso',
  },
  {
    column: 'expected_date',
    label: 'PO Expected Date',
    recordType: 'purchase_order',
    required: false,
    formatValidator: (v, row) => {
      if (classifyDate(v) !== 'iso') return false;
      const order = (row['po_date'] ?? '').trim();
      // ISO dates compare correctly as strings.
      return classifyDate(order) !== 'iso' || v >= order;
    },
  },
  {
    column: 'currency',
    label: 'PO Currency',
    recordType: 'purchase_order',
    required: true,
    formatValidator: isValidCurrency,
  },
  {
    column: 'po_total',
    label: 'PO Total',
    recordType: 'purchase_order',
    required: true,
    formatValidator: isNonNegativeDecimal,
  },

  // ── PO line columns ────────────────────────────────────────────────────────
  {
    column: 'po_number',
    label: 'Line PO Number',
    recordType: 'po_line',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= 64,
  },
  {
    column: 'line_no',
    label: 'Line Number',
    recordType: 'po_line',
    required: true,
    formatValidator: (v) => INTEGER_REGEX.test(v) && Number(v) > 0,
  },
  {
    column: 'product_sku',
    label: 'ERP-1 Product SKU',
    recordType: 'po_line',
    required: true,
    formatValidator: (v) => !hasFormulaPrefix(v) && SKU_SET.has(normalizeCode(v)),
  },
  {
    column: 'quantity',
    label: 'Quantity',
    recordType: 'po_line',
    required: true,
    formatValidator: isValidQuantity,
  },
  {
    column: 'unit_price',
    label: 'Unit Price',
    recordType: 'po_line',
    required: true,
    formatValidator: isValidUnitPrice,
  },
  {
    column: 'line_total',
    label: 'Line Total',
    recordType: 'po_line',
    required: false,
    formatValidator: isNonNegativeDecimal,
  },
];

/** Exact normalised keys only; mirrors the duplicate rules in the ERP2-25 rule catalogue. */
export const ERP2_DUPLICATE_KEY_RULES: readonly DuplicateKeyRule[] = [
  {
    name: 'vendor_code',
    label: 'Vendor Code (Exact Match)',
    recordType: 'vendor',
    extractKey: (r) => {
      const key = normalizeCode(r['vendor_code'] ?? '');
      return key === '' ? null : key;
    },
  },
  {
    name: 'vendor_tax_number',
    label: 'Vendor Tax Number (Exact Match)',
    recordType: 'vendor',
    extractKey: (r) => {
      const key = normalizeTaxNumber(r['tax_number'] ?? '');
      return key === '' ? null : key;
    },
  },
  {
    name: 'po_number',
    label: 'PO Number (Exact Match)',
    recordType: 'purchase_order',
    extractKey: (r) => {
      const key = normalizePoNumber(r['po_number'] ?? '');
      return key === '' ? null : key;
    },
  },
  {
    name: 'po_line_key',
    label: 'PO Line (PO Number + Line No, Exact Match)',
    recordType: 'po_line',
    extractKey: (r) => {
      const po = normalizePoNumber(r['po_number'] ?? '');
      const rawLine = (r['line_no'] ?? '').trim();
      if (po === '' || rawLine === '') return null;
      const line = INTEGER_REGEX.test(rawLine) ? String(Number(rawLine)) : rawLine;
      return `${po}#${line}`;
    },
  },
];

export const ERP2_PROFILER_CONFIG: ProfilerConfig = {
  columns: ERP2_COLUMN_RULES,
  duplicateKeys: ERP2_DUPLICATE_KEY_RULES,
  maxTopValues: 5,
};

/**
 * Profiles an ERP-2 tabular dataset with the shared profiler.
 * Input rows are not mutated: a copy with a masked bank_account is what gets profiled.
 */
export function profileErp2Dataset(
  rows: readonly Record<string, string>[],
  rawCsvText?: string,
): DatasetProfileReport {
  const safeRows = rows.map((row) => {
    const bank = row['bank_account'];
    return { ...row, bank_account: bank ? maskBankAccount(bank) : '' };
  });
  return profileDataset(safeRows, ERP2_PROFILER_CONFIG, rawCsvText);
}

/** Formula-safe CSV Data Health Report for the ERP-2 profile (shared exporter). */
export function exportErp2ProfileCsv(report: DatasetProfileReport): string {
  return exportProfileReportToCsv(report);
}
