/**
 * ERP-3 Sales Orders & Invoices — Column Profiler Configuration (ERP3-26 / KIT-03)
 *
 * Configures the shared Migration Kit column profiler (`@cs/kit`) for ERP-3 domain columns
 * (sales orders, order lines, invoices, invoice lines, payments) and exact duplicate candidate
 * keys matching the canonical Dirty Data Pack manifest (ERP3-25 / Issue #161).
 *
 * Design guarantees:
 *  - Zero duplicate platform infrastructure: profiling engine, duplicate candidate grouping,
 *    and formula-safe CSV export all come directly from `@cs/kit`.
 *  - Exact, deterministic duplicate keys only (no fuzzy scoring, no auto-merge).
 *  - Non-destructive: source CSV and input rows are never mutated.
 *  - Formula-injection defense: detects leading =, +, -, @, \t, \r characters.
 *
 * @module erp3/migration/profiling-config
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
  INVOICE_STATUSES,
  KNOWN_CUSTOMERS,
  KNOWN_PRODUCTS,
  PAYMENT_METHODS,
  SALES_ORDER_STATUSES,
  isValidCalendarDate,
  isValidUuid,
  parseScaled4DpSigned,
} from './rules.js';

const CURRENCY_SET: ReadonlySet<string> = new Set<string>(ACCEPTED_CURRENCIES);
const SO_STATUS_SET: ReadonlySet<string> = new Set<string>(SALES_ORDER_STATUSES);
const INV_STATUS_SET: ReadonlySet<string> = new Set<string>(INVOICE_STATUSES);
const PAYMENT_METHOD_SET: ReadonlySet<string> = new Set<string>(PAYMENT_METHODS);
const CUSTOMER_SET: ReadonlySet<string> = new Set<string>(KNOWN_CUSTOMERS);
const PRODUCT_SET: ReadonlySet<string> = new Set<string>(KNOWN_PRODUCTS);

const ORDER_NUMBER_REGEX = /^[A-Za-z0-9_-]+$/;
const INTEGER_REGEX = /^\d+$/;

/**
 * Detects spreadsheet formula injection prefix characters (=, +, -, @, \t, \r).
 */
export function hasFormulaPrefix(val: string): boolean {
  return /^[=+\-@\t\r]/.test(val) || /^[=+\-@]/.test(val.trim());
}

export const ERP3_COLUMN_RULES: readonly ColumnRule[] = [
  // ── 1. Sales Order Columns ──────────────────────────────────────────────────
  {
    column: 'order_number',
    label: 'Order Number',
    recordType: 'sales_order',
    required: true,
    formatValidator: (v) => !hasFormulaPrefix(v) && v.length > 0 && v.length <= 64 && ORDER_NUMBER_REGEX.test(v),
  },
  {
    column: 'customer_golden_id',
    label: 'Customer Golden ID',
    recordType: 'sales_order',
    required: true,
    formatValidator: (v) => isValidUuid(v) && CUSTOMER_SET.has(v),
  },
  {
    column: 'order_date',
    label: 'Order Date',
    recordType: 'sales_order',
    required: true,
    formatValidator: (v) => isValidCalendarDate(v),
  },
  {
    column: 'order_status',
    label: 'Order Status',
    recordType: 'sales_order',
    required: true,
    formatValidator: (v) => SO_STATUS_SET.has(v),
  },
  {
    column: 'currency',
    label: 'Order Currency',
    recordType: 'sales_order',
    required: true,
    formatValidator: (v) => CURRENCY_SET.has(v),
  },
  {
    column: 'notes',
    label: 'Order Notes',
    recordType: 'sales_order',
    required: false,
    formatValidator: (v) => !hasFormulaPrefix(v) && v.length <= 1000,
  },

  // ── 2. Sales Order Line Columns ─────────────────────────────────────────────
  {
    column: 'parent_source_id',
    label: 'Line Parent Source ID',
    recordType: 'so_line',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= 64,
  },
  {
    column: 'line_number',
    label: 'Line Number',
    recordType: 'so_line',
    required: true,
    formatValidator: (v) => INTEGER_REGEX.test(v) && Number(v) > 0,
  },
  {
    column: 'product_id',
    label: 'Product ID',
    recordType: 'so_line',
    required: true,
    formatValidator: (v) => isValidUuid(v) && PRODUCT_SET.has(v),
  },
  {
    column: 'quantity',
    label: 'Line Quantity',
    recordType: 'so_line',
    required: true,
    formatValidator: (v) => {
      const q = parseScaled4DpSigned(v);
      return q !== null && q > BigInt(0);
    },
  },
  {
    column: 'unit_price',
    label: 'Line Unit Price',
    recordType: 'so_line',
    required: true,
    formatValidator: (v) => {
      const p = parseScaled4DpSigned(v);
      return p !== null && p >= BigInt(0);
    },
  },
  {
    column: 'tax_rate',
    label: 'Line Tax Rate',
    recordType: 'so_line',
    required: true,
    formatValidator: (v) => {
      const t = parseScaled4DpSigned(v);
      return t !== null && t >= BigInt(0) && t <= BigInt(1000000); // 0.0000 to 100.0000%
    },
  },

  // ── 3. Invoice Columns ──────────────────────────────────────────────────────
  {
    column: 'invoice_number',
    label: 'Invoice Number',
    recordType: 'invoice',
    required: true,
    formatValidator: (v) => !hasFormulaPrefix(v) && v.length > 0 && v.length <= 64 && ORDER_NUMBER_REGEX.test(v),
  },
  {
    column: 'customer_golden_id',
    label: 'Invoice Customer Golden ID',
    recordType: 'invoice',
    required: true,
    formatValidator: (v) => isValidUuid(v) && CUSTOMER_SET.has(v),
  },
  {
    column: 'invoice_date',
    label: 'Invoice Date',
    recordType: 'invoice',
    required: true,
    formatValidator: (v) => isValidCalendarDate(v),
  },
  {
    column: 'due_date',
    label: 'Invoice Due Date',
    recordType: 'invoice',
    required: true,
    formatValidator: (v, row) => {
      if (!isValidCalendarDate(v)) return false;
      const invDate = (row['invoice_date'] ?? '').trim();
      return !isValidCalendarDate(invDate) || v >= invDate;
    },
  },
  {
    column: 'currency',
    label: 'Invoice Currency',
    recordType: 'invoice',
    required: true,
    formatValidator: (v) => CURRENCY_SET.has(v),
  },
  {
    column: 'invoice_status',
    label: 'Invoice Status',
    recordType: 'invoice',
    required: false,
    formatValidator: (v) => INV_STATUS_SET.has(v),
  },

  // ── 4. Invoice Line Columns ─────────────────────────────────────────────────
  {
    column: 'parent_source_id',
    label: 'Invoice Line Parent Source ID',
    recordType: 'invoice_line',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= 64,
  },
  {
    column: 'line_number',
    label: 'Invoice Line Number',
    recordType: 'invoice_line',
    required: true,
    formatValidator: (v) => INTEGER_REGEX.test(v) && Number(v) > 0,
  },
  {
    column: 'product_id',
    label: 'Invoice Line Product ID',
    recordType: 'invoice_line',
    required: true,
    formatValidator: (v) => isValidUuid(v) && PRODUCT_SET.has(v),
  },
  {
    column: 'quantity',
    label: 'Invoice Line Quantity',
    recordType: 'invoice_line',
    required: true,
    formatValidator: (v) => {
      const q = parseScaled4DpSigned(v);
      return q !== null && q > BigInt(0);
    },
  },
  {
    column: 'unit_price',
    label: 'Invoice Line Unit Price',
    recordType: 'invoice_line',
    required: true,
    formatValidator: (v) => {
      const p = parseScaled4DpSigned(v);
      return p !== null && p >= BigInt(0);
    },
  },
  {
    column: 'tax_rate',
    label: 'Invoice Line Tax Rate',
    recordType: 'invoice_line',
    required: true,
    formatValidator: (v) => {
      const t = parseScaled4DpSigned(v);
      return t !== null && t >= BigInt(0) && t <= BigInt(1000000);
    },
  },

  // ── 5. Payment Columns ──────────────────────────────────────────────────────
  {
    column: 'payment_number',
    label: 'Payment Number',
    recordType: 'payment',
    required: true,
    formatValidator: (v) => !hasFormulaPrefix(v) && v.length > 0 && v.length <= 64,
  },
  {
    column: 'parent_source_id',
    label: 'Payment Target Invoice Source ID',
    recordType: 'payment',
    required: true,
    formatValidator: (v) => v.length > 0 && v.length <= 64,
  },
  {
    column: 'payment_date',
    label: 'Payment Date',
    recordType: 'payment',
    required: true,
    formatValidator: (v) => isValidCalendarDate(v),
  },
  {
    column: 'payment_amount',
    label: 'Payment Amount',
    recordType: 'payment',
    required: true,
    formatValidator: (v) => {
      const a = parseScaled4DpSigned(v);
      return a !== null && a > BigInt(0);
    },
  },
  {
    column: 'payment_method',
    label: 'Payment Method',
    recordType: 'payment',
    required: true,
    formatValidator: (v) => PAYMENT_METHOD_SET.has(v.toLowerCase()),
  },
  {
    column: 'payment_reference',
    label: 'Payment Reference',
    recordType: 'payment',
    required: false,
    formatValidator: (v) => !hasFormulaPrefix(v) && v.length <= 128,
  },
];

export const ERP3_DUPLICATE_KEY_RULES: readonly DuplicateKeyRule[] = [
  {
    name: 'order_number',
    label: 'Sales Order Number (Exact Match)',
    recordType: 'sales_order',
    extractKey: (r) => {
      const key = (r['order_number'] ?? '').trim().toUpperCase();
      return key === '' ? null : key;
    },
  },
  {
    name: 'invoice_number',
    label: 'Invoice Number (Exact Match)',
    recordType: 'invoice',
    extractKey: (r) => {
      const key = (r['invoice_number'] ?? '').trim().toUpperCase();
      return key === '' ? null : key;
    },
  },
  {
    name: 'payment_number',
    label: 'Payment Number (Exact Match)',
    recordType: 'payment',
    extractKey: (r) => {
      const key = (r['payment_number'] ?? '').trim().toUpperCase();
      return key === '' ? null : key;
    },
  },
  {
    name: 'so_line_key',
    label: 'Sales Order Line (Parent + Line No, Exact Match)',
    recordType: 'so_line',
    extractKey: (r) => {
      const parent = (r['parent_source_id'] ?? '').trim();
      const line = (r['line_number'] ?? '').trim();
      if (!parent || !line) return null;
      return `${parent}#${line}`;
    },
  },
  {
    name: 'invoice_line_key',
    label: 'Invoice Line (Parent + Line No, Exact Match)',
    recordType: 'invoice_line',
    extractKey: (r) => {
      const parent = (r['parent_source_id'] ?? '').trim();
      const line = (r['line_number'] ?? '').trim();
      if (!parent || !line) return null;
      return `${parent}#${line}`;
    },
  },
];

export const ERP3_PROFILER_CONFIG: ProfilerConfig = {
  columns: ERP3_COLUMN_RULES,
  duplicateKeys: ERP3_DUPLICATE_KEY_RULES,
  maxTopValues: 5,
};

/**
 * Profiles an ERP-3 tabular dataset with the shared @cs/kit profiler.
 * Strictly non-destructive: guarantees input rows are never mutated.
 */
export function profileErp3Dataset(
  rows: readonly Record<string, string>[],
  rawCsvText?: string
): DatasetProfileReport {
  return profileDataset(rows, ERP3_PROFILER_CONFIG, rawCsvText);
}

/**
 * Generates a formula-safe CSV Data Health Profile Report using the shared exporter.
 */
export function exportErp3ProfileCsv(report: DatasetProfileReport): string {
  return exportProfileReportToCsv(report);
}
