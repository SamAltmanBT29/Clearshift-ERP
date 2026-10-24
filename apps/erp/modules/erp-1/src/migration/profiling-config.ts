/**
 * ERP-1 Products & Inventory — Column Profiler Configuration (ERP1-26 / KIT-03)
 *
 * Configures the shared Migration Kit column profiler (`@cs/kit`) for ERP-1 domain columns
 * (categories, warehouses, products, stock levels) and exact-duplicate candidate keys that match
 * the canonical Dirty Data Pack manifest (ERP1-25 / sample-data/erp-1/expected-profile.json).
 *
 * Design guarantees:
 *  - Zero duplicate platform infrastructure: profiling, exact duplicate grouping, and formula-safe CSV
 *    export are provided by the shared Migration Kit engine (`@cs/kit`); natural key normalizers and date
 *    validators are reused from `dirty-data-plan.ts`.
 *  - Deterministic exact duplicate matching only: no fuzzy scoring and no auto-merge sagas in V1.
 *  - Strictly non-destructive: input rows are never mutated; profiling computes metrics read-only.
 *  - Sensitive data protection: supplier bank accounts and employee SSNs are NEVER profiled (the profiler
 *    would emit them as "top values"). Safe masked copies are profiled and the CSV export never contains
 *    raw financial or personal numbers.
 *  - OWASP formula injection defense: spreadsheet formula prefixes (=, +, -, @, \t, \r) are detected
 *    as format defects and neutralised in CSV exports.
 *
 * @module erp1/migration/profiling-config
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
  ACCEPTED_UOMS,
  maskSensitiveFields,
  normalizeSku,
  validateIsoDate,
  type RawRow,
} from './dirty-data-plan.js';

export const VALID_CATEGORY_CODES: readonly string[] = [
  'GEN',
  'ELEC',
  'CHEM',
  'RAW',
  'PKG',
  'TOOLS',
  'MÉC',
  'SAFETY',
] as const;

export const ERP1_REFERENCE_SKUS: readonly string[] = [
  'FAST-BOLT-HEX-001',
  'FAST-NUT-FLG-002',
  'RAW-COP-WIRE-003',
  'ELEC-MOT-NEM-004',
  'CHEM-OIL-SYN-005',
  'RAW-ALU-ING-006',
  'CHEM-SIL-DES-007',
  'PKG-BOX-COR-008',
  'TOOL-DRL-ROT-009',
  'CHEM-LIT-GRS-010',
  'TOOL-BIT-SET-011',
  'PKG-BUB-WRP-012',
  'ELEC-SEN-SMK-013',
  'CHEM-ACE-IND-014',
  'RAW-BRS-BAR-015',
  'SEAL-GSK-FLG-016',
  'GER-FAST-SCR-017',
  'FRA-FAST-NUT-018',
  'ESP-ELEC-RES-019',
  'JPN-MECH-LIN-020',
  'TOOL-DRL-PAD-021',
  'TOOL-CUR-PAD-022',
  'HARD-CAT-PAD-023',
  'PROMO-BOLT-ZERO-024',
  'MICRO-PIN-MIN-025',
  'TURB-ROTOR-MAX-026',
  'FAST-TAX-ZERO-027',
  'LUX-TAX-MAX-028',
  'VALVE-GBP-STD-029',
  'BUSBAR-INR-STD-030',
  'RAW-STEEL-SHT-031',
  'ELEC-CAP-SMD-034',
  'CHEM-HYD-FLU-035',
  'RAW-FBR-SLV-036',
  'PKG-POUCH-BLK-037',
] as const;

const UOM_SET: ReadonlySet<string> = new Set<string>(ACCEPTED_UOMS);
const CURRENCY_SET: ReadonlySet<string> = new Set<string>(ACCEPTED_CURRENCIES);
const CATEGORY_SET: ReadonlySet<string> = new Set<string>(VALID_CATEGORY_CODES);
const SKU_SET: ReadonlySet<string> = new Set<string>(ERP1_REFERENCE_SKUS);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[0-9\s\-()]{7,20}$/;
const BOOLEAN_REGEX = /^(true|false)$/i;

/**
 * Checks for spreadsheet formula injection characters (OWASP / PLT-12 / KIT-16).
 * Inspects both the trimmed string and the raw cell for leading tab or CR characters.
 */
export function hasFormulaPrefix(value: string, rawRow?: Record<string, string>, column?: string): boolean {
  if (/^[=+\-@\t\r]/.test(value.trim())) return true;
  if (/^[\t\r]/.test(value)) return true;
  if (rawRow && column && rawRow[column] !== undefined) {
    const raw = String(rawRow[column]);
    if (/^[=+\-@\t\r]/.test(raw.trim()) || /^[\t\r]/.test(raw)) return true;
  }
  return false;
}

/**
 * Validates decimal monetary amounts or quantities with non-negative check and max scale.
 */
function isValidScaledDecimal(val: string, maxDecimals: number): boolean {
  if (!val || !val.trim()) return false;
  const trimmed = val.trim();
  const num = Number(trimmed);
  if (isNaN(num) || num < 0) return false;
  const parts = trimmed.split('.');
  if (parts[1] && parts[1].length > maxDecimals) return false;
  return true;
}

export const ERP1_COLUMN_RULES: readonly ColumnRule[] = [
  // ── Category columns (erp1_categories) ─────────────────────────────────────
  {
    column: 'code',
    label: 'Category Code',
    recordType: 'category',
    required: true,
    formatValidator: (v, row) => v.length > 0 && v.length <= 64 && !hasFormulaPrefix(v, row, 'code'),
  },
  {
    column: 'name',
    label: 'Category Name',
    recordType: 'category',
    required: true,
    formatValidator: (v, row) => v.length > 0 && v.length <= 255 && !hasFormulaPrefix(v, row, 'name'),
  },

  // ── Warehouse columns (erp1_warehouses) ────────────────────────────────────
  {
    // FR-ERP1-05: Exactly one warehouse in V1 (WH-01).
    column: 'code',
    label: 'Warehouse Code',
    recordType: 'warehouse',
    required: true,
    formatValidator: (v, row) => v.trim().toUpperCase() === 'WH-01' && !hasFormulaPrefix(v, row, 'code'),
  },
  {
    column: 'name',
    label: 'Warehouse Name',
    recordType: 'warehouse',
    required: true,
    formatValidator: (v, row) => v.length > 0 && v.length <= 255 && !hasFormulaPrefix(v, row, 'name'),
  },
  {
    column: 'is_default',
    label: 'Is Default Operating Warehouse',
    recordType: 'warehouse',
    required: true,
    formatValidator: (v) => BOOLEAN_REGEX.test(v),
  },

  // ── Product master columns (erp1_products) ─────────────────────────────────
  {
    column: 'name',
    label: 'Product Name',
    recordType: 'product',
    required: true,
    formatValidator: (v, row) => v.length > 0 && v.length <= 255 && !hasFormulaPrefix(v, row, 'name'),
  },
  {
    column: 'sku',
    label: 'Stock Keeping Unit (SKU)',
    recordType: 'product',
    required: true,
    formatValidator: (v, row) => v.length > 0 && v.length <= 128 && !hasFormulaPrefix(v, row, 'sku'),
  },
  {
    column: 'category_code',
    label: 'Category Reference Code',
    recordType: 'product',
    required: false,
    formatValidator: (v, row) =>
      CATEGORY_SET.has(v.trim().toUpperCase()) && !hasFormulaPrefix(v, row, 'category_code'),
  },
  {
    // FR-ERP1-04: Units from the fixed V1 unit list.
    column: 'unit_of_measure',
    label: 'Unit of Measure',
    recordType: 'product',
    required: true,
    formatValidator: (v) => UOM_SET.has(v),
  },
  {
    // FR-ERP1-02: Non-negative price, NUMERIC(19,4).
    column: 'price',
    label: 'Product Unit Price',
    recordType: 'product',
    required: true,
    formatValidator: (v) => isValidScaledDecimal(v, 4),
  },
  {
    column: 'currency',
    label: 'Currency Code (ISO-4217)',
    recordType: 'product',
    required: true,
    formatValidator: (v) => CURRENCY_SET.has(v.toUpperCase()),
  },
  {
    // Tax rate percentage: >= 0 and <= 100, NUMERIC(5,2).
    column: 'tax_rate',
    label: 'Tax Rate (%)',
    recordType: 'product',
    required: false,
    formatValidator: (v) => {
      const num = Number(v);
      return !isNaN(num) && num >= 0 && num <= 100;
    },
  },
  {
    column: 'notification_email',
    label: 'Notification Email',
    recordType: 'product',
    required: false,
    formatValidator: (v) => v.length <= 254 && EMAIL_REGEX.test(v),
  },
  {
    column: 'contact_phone',
    label: 'Contact Phone',
    recordType: 'product',
    required: false,
    formatValidator: (v) => PHONE_REGEX.test(v),
  },

  // ── Stock level columns (erp1_stock_levels) ────────────────────────────────
  {
    column: 'sku',
    label: 'Stock Product SKU',
    recordType: 'stock_level',
    required: true,
    formatValidator: (v, row) =>
      !hasFormulaPrefix(v, row, 'sku') && SKU_SET.has(normalizeSku(v)),
  },
  {
    // Single operating warehouse in V1.
    column: 'warehouse_code',
    label: 'Stock Warehouse Code',
    recordType: 'stock_level',
    required: true,
    formatValidator: (v) => v.trim().toUpperCase() === 'WH-01',
  },
  {
    // BR-ERP1-01 / BR-ERP1-02: Stock quantity may not become negative.
    column: 'quantity',
    label: 'Stock Quantity',
    recordType: 'stock_level',
    required: true,
    formatValidator: (v) => isValidScaledDecimal(v, 4),
  },
  {
    column: 'as_of_date',
    label: 'Stock As of Date',
    recordType: 'stock_level',
    required: false,
    formatValidator: (v) => {
      const res = validateIsoDate(v);
      return res.valid && !res.ambiguous;
    },
  },
];

/**
 * Exact deterministic duplicate key rules.
 * Strictly reflects the duplicate policies in ERP1-12 and the ERP1-25 manifest.
 */
export const ERP1_DUPLICATE_KEY_RULES: readonly DuplicateKeyRule[] = [
  {
    name: 'category_code',
    label: 'Category Code (Exact Match)',
    recordType: 'category',
    extractKey: (r) => {
      const code = (r['code'] ?? '').trim().toUpperCase();
      return code === '' ? null : code;
    },
  },
  {
    name: 'product_sku',
    label: 'Product SKU (Normalized Exact Match)',
    recordType: 'product',
    extractKey: (r) => {
      const sku = normalizeSku(r['sku'] ?? '');
      return sku === '' ? null : sku;
    },
  },
  {
    name: 'stock_level_key',
    label: 'Stock Level (SKU + Warehouse Code, Exact Match)',
    recordType: 'stock_level',
    extractKey: (r) => {
      const sku = normalizeSku(r['sku'] ?? '');
      const wh = (r['warehouse_code'] ?? '').trim().toUpperCase();
      const qty = (r['quantity'] ?? '').trim();
      const date = (r['as_of_date'] ?? '').trim();

      // Malformed/rejected stock lines are triaged to rejected outcomes, not duplicate review.
      if (!sku || hasFormulaPrefix(sku) || wh !== 'WH-01' || !isValidScaledDecimal(qty, 4)) {
        return null;
      }
      if (date && (!validateIsoDate(date).valid || validateIsoDate(date).ambiguous)) {
        return null;
      }
      return `${sku}::${wh}`;
    },
  },
];

export const ERP1_PROFILER_CONFIG: ProfilerConfig = {
  columns: ERP1_COLUMN_RULES,
  duplicateKeys: ERP1_DUPLICATE_KEY_RULES,
  maxTopValues: 5,
};

/**
 * Profiles an ERP-1 tabular dataset using the shared `@cs/kit` profiler.
 *
 * Guarantees:
 *  - Non-destructive: raw input rows are untouched; a masked copy is profiled.
 *  - Sensitive data protection: supplier bank account and employee SSN values
 *    are masked and excluded from top values / quality metrics.
 */
export function profileErp1Dataset(
  rows: readonly Record<string, string>[],
  rawCsvText?: string,
): DatasetProfileReport {
  const safeRows = rows.map((r) => {
    const raw = r as unknown as RawRow;
    const masked = maskSensitiveFields(raw);
    return masked as Record<string, string>;
  });
  return profileDataset(safeRows, ERP1_PROFILER_CONFIG, rawCsvText);
}

/**
 * Serializes an ERP-1 DatasetProfileReport into a formula-safe CSV Data Health Report (KIT-03).
 */
export function exportErp1ProfileCsv(report: DatasetProfileReport): string {
  return exportProfileReportToCsv(report);
}
