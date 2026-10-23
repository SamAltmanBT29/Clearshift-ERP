/**
 * ERP-1 Products & Inventory — Canonical Dirty Data Pack Plan & Data Quality Rules
 *
 * Implements:
 * - Deterministic dataset evaluation and profiling for Gate G1 & Migration Kit.
 * - Raw input immutability guarantee (BR-KIT-03).
 * - Exact duplicate matching only (no fuzzy scoring, candidate duplicates routed to review).
 * - Business rule enforcement: BR-ERP1-01 (SKU uniqueness), BR-ERP1-02 (non-negative stock),
 *   FR-ERP1-04 (fixed V1 units), FR-ERP1-05 (one warehouse in V1).
 * - OWASP CSV formula injection defense (PLT-12 / KIT-16).
 * - Sensitive field identification and review masking.
 *
 * @module erp1/migration/dirty-data-plan
 */

import { createHash } from 'node:crypto';

export const RULES_VERSION = '1.0.0';
export const FIXTURE_SCHEMA_VERSION = 1;
export const PROFILE_SCHEMA_VERSION = 1;
export const FIXTURE_PATH = 'sample-data/erp-1/dirty-data-v1.csv';

export const ACCEPTED_UOMS = ['pcs', 'kg', 'g', 'litre', 'metre', 'box'] as const;
export type AcceptedUom = (typeof ACCEPTED_UOMS)[number];

export const ACCEPTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'] as const;

export const FIXTURE_COLUMNS = [
  'row_id',
  'record_type',
  'case_tags',
  'source_id',
  'code',
  'name',
  'sku',
  'category_code',
  'unit_of_measure',
  'price',
  'currency',
  'tax_rate',
  'warehouse_code',
  'quantity',
  'as_of_date',
  'is_default',
  'notification_email',
  'contact_phone',
  'supplier_bank_account',
  'employee_ssn',
  'source_system',
  'expect_outcome',
  'expect_reasons',
] as const;

export type FixtureColumn = (typeof FIXTURE_COLUMNS)[number];

export interface RawRow {
  line_number: number;
  row_id: string;
  record_type: string;
  case_tags: string;
  source_id: string;
  code: string;
  name: string;
  sku: string;
  category_code: string;
  unit_of_measure: string;
  price: string;
  currency: string;
  tax_rate: string;
  warehouse_code: string;
  quantity: string;
  as_of_date: string;
  is_default: string;
  notification_email: string;
  contact_phone: string;
  supplier_bank_account: string;
  employee_ssn: string;
  source_system: string;
  expect_outcome: string;
  expect_reasons: string;
}

export type TerminalOutcome = 'accepted' | 'rejected' | 'review' | 'skipped';

export interface EvaluatedRow {
  line_number: number;
  row_id: string;
  record_type: string;
  source_id: string;
  outcome: TerminalOutcome;
  reason_codes: string[];
  normalized_data: Record<string, unknown>;
  masked_data?: Record<string, unknown>;
  rule_ids: string[];
}

export interface DataQualityRule {
  rule_id: string;
  version: string;
  record_type: 'category' | 'warehouse' | 'product' | 'stock_level' | 'all';
  field: string;
  condition: string;
  action: 'normalize' | 'reject' | 'review';
  reason_code?: string;
  explanation: string;
  doc_reference: string;
}

export const RULE_CATALOGUE: DataQualityRule[] = [
  // ── Categories ─────────────────────────────────────────────────────────────
  {
    rule_id: 'CAT-001',
    version: '1.0.0',
    record_type: 'category',
    field: 'code',
    condition: 'code is empty or whitespace',
    action: 'reject',
    reason_code: 'CATEGORY_CODE_REQUIRED',
    explanation: 'Category code is required and cannot be blank.',
    doc_reference: 'FR-ERP1-03',
  },
  {
    rule_id: 'CAT-002',
    version: '1.0.0',
    record_type: 'category',
    field: 'name',
    condition: 'name is empty or whitespace',
    action: 'reject',
    reason_code: 'CATEGORY_NAME_REQUIRED',
    explanation: 'Category name is required.',
    doc_reference: 'FR-ERP1-03',
  },
  {
    rule_id: 'CAT-003',
    version: '1.0.0',
    record_type: 'category',
    field: 'code',
    condition: 'code length > 64 characters',
    action: 'reject',
    reason_code: 'CATEGORY_CODE_TOO_LONG',
    explanation: 'Category code exceeds maximum length of 64 characters.',
    doc_reference: 'FR-ERP1-03',
  },
  {
    rule_id: 'CAT-004',
    version: '1.0.0',
    record_type: 'category',
    field: 'code',
    condition: 'duplicate normalized category code detected in batch',
    action: 'review',
    reason_code: 'DUPLICATE_CATEGORY_CODE_REVIEW',
    explanation: 'Category code already encountered; held for review.',
    doc_reference: 'FR-ERP1-03',
  },

  // ── Warehouses ─────────────────────────────────────────────────────────────
  {
    rule_id: 'WH-001',
    version: '1.0.0',
    record_type: 'warehouse',
    field: 'code',
    condition: 'code is empty or whitespace',
    action: 'reject',
    reason_code: 'WAREHOUSE_CODE_REQUIRED',
    explanation: 'Warehouse code is required.',
    doc_reference: 'FR-ERP1-05',
  },
  {
    rule_id: 'WH-002',
    version: '1.0.0',
    record_type: 'warehouse',
    field: 'name',
    condition: 'name is empty or whitespace',
    action: 'reject',
    reason_code: 'WAREHOUSE_NAME_REQUIRED',
    explanation: 'Warehouse facility name is required.',
    doc_reference: 'FR-ERP1-05',
  },
  {
    rule_id: 'WH-003',
    version: '1.0.0',
    record_type: 'warehouse',
    field: 'code',
    condition: 'more than one warehouse facility attempted in V1',
    action: 'reject',
    reason_code: 'MULTIPLE_WAREHOUSES_REJECTED',
    explanation: 'ClearShift V1 strictly operates with exactly one warehouse facility (WH-01).',
    doc_reference: 'FR-ERP1-05 / BR-ERP1-03',
  },

  // ── Products ───────────────────────────────────────────────────────────────
  {
    rule_id: 'PRD-001',
    version: '1.0.0',
    record_type: 'product',
    field: 'name',
    condition: 'product name is empty or whitespace',
    action: 'reject',
    reason_code: 'PRODUCT_NAME_REQUIRED',
    explanation: 'Product name is mandatory.',
    doc_reference: 'FR-ERP1-01',
  },
  {
    rule_id: 'PRD-002',
    version: '1.0.0',
    record_type: 'product',
    field: 'sku',
    condition: 'SKU is empty or whitespace',
    action: 'reject',
    reason_code: 'SKU_REQUIRED',
    explanation: 'Product SKU natural key is required.',
    doc_reference: 'FR-ERP1-01 / BR-ERP1-01',
  },
  {
    rule_id: 'PRD-003',
    version: '1.0.0',
    record_type: 'product',
    field: 'sku',
    condition: 'duplicate normalized SKU detected in batch or existing master',
    action: 'review',
    reason_code: 'DUPLICATE_SKU_REVIEW',
    explanation: 'Normalized SKU already exists in catalog or prior batch row.',
    doc_reference: 'BR-ERP1-01',
  },
  {
    rule_id: 'PRD-004',
    version: '1.0.0',
    record_type: 'product',
    field: 'unit_of_measure',
    condition: 'unit of measure is empty or whitespace',
    action: 'reject',
    reason_code: 'UNIT_OF_MEASURE_REQUIRED',
    explanation: 'Unit of measure is required.',
    doc_reference: 'FR-ERP1-04',
  },
  {
    rule_id: 'PRD-005',
    version: '1.0.0',
    record_type: 'product',
    field: 'unit_of_measure',
    condition: 'unit of measure not in approved list (pcs, kg, g, litre, metre, box)',
    action: 'reject',
    reason_code: 'INVALID_UNIT_OF_MEASURE',
    explanation: 'Unit of measure must be one of the approved V1 units.',
    doc_reference: 'FR-ERP1-04',
  },
  {
    rule_id: 'PRD-006',
    version: '1.0.0',
    record_type: 'product',
    field: 'price',
    condition: 'price is empty or whitespace',
    action: 'reject',
    reason_code: 'PRICE_REQUIRED',
    explanation: 'Selling price is mandatory.',
    doc_reference: 'FR-ERP1-02',
  },
  {
    rule_id: 'PRD-007',
    version: '1.0.0',
    record_type: 'product',
    field: 'price',
    condition: 'price is negative (< 0)',
    action: 'reject',
    reason_code: 'NEGATIVE_PRICE',
    explanation: 'Selling price cannot be negative.',
    doc_reference: 'FR-ERP1-02 / BR-ERP1-01',
  },
  {
    rule_id: 'PRD-008',
    version: '1.0.0',
    record_type: 'product',
    field: 'price',
    condition: 'price is not a valid decimal number',
    action: 'reject',
    reason_code: 'INVALID_PRICE_FORMAT',
    explanation: 'Price must be a valid numeric decimal representation.',
    doc_reference: 'FR-ERP1-02',
  },
  {
    rule_id: 'PRD-009',
    version: '1.0.0',
    record_type: 'product',
    field: 'price',
    condition: 'price has more than 4 decimal places',
    action: 'reject',
    reason_code: 'EXCESS_DECIMAL_PLACES',
    explanation: 'Price exceeds maximum precision of 4 decimal places.',
    doc_reference: 'FR-ERP1-02 / SDS §4.7',
  },
  {
    rule_id: 'PRD-010',
    version: '1.0.0',
    record_type: 'product',
    field: 'currency',
    condition: 'currency is empty or whitespace',
    action: 'reject',
    reason_code: 'CURRENCY_REQUIRED',
    explanation: 'Currency is explicit and mandatory in ClearShift V1.',
    doc_reference: 'FR-ERP1-02',
  },
  {
    rule_id: 'PRD-011',
    version: '1.0.0',
    record_type: 'product',
    field: 'currency',
    condition: 'currency does not match 3-letter uppercase ISO 4217 pattern',
    action: 'reject',
    reason_code: 'INVALID_CURRENCY',
    explanation: 'Currency must be an uppercase 3-letter ISO 4217 code.',
    doc_reference: 'FR-ERP1-02',
  },
  {
    rule_id: 'PRD-012',
    version: '1.0.0',
    record_type: 'product',
    field: 'tax_rate',
    condition: 'tax rate is negative (< 0)',
    action: 'reject',
    reason_code: 'NEGATIVE_TAX_RATE',
    explanation: 'Tax rate percentage cannot be negative.',
    doc_reference: 'FR-ERP1-02',
  },
  {
    rule_id: 'PRD-013',
    version: '1.0.0',
    record_type: 'product',
    field: 'tax_rate',
    condition: 'tax rate exceeds 100.00%',
    action: 'reject',
    reason_code: 'TAX_RATE_OUT_OF_RANGE',
    explanation: 'Tax rate percentage cannot exceed 100.00%.',
    doc_reference: 'FR-ERP1-02',
  },
  {
    rule_id: 'PRD-014',
    version: '1.0.0',
    record_type: 'product',
    field: 'tax_rate',
    condition: 'tax rate is not a valid numeric decimal representation',
    action: 'reject',
    reason_code: 'INVALID_TAX_RATE_FORMAT',
    explanation: 'Tax rate must be a valid numeric decimal representation.',
    doc_reference: 'FR-ERP1-02',
  },
  {
    rule_id: 'PRD-015',
    version: '1.0.0',
    record_type: 'product',
    field: 'category_code',
    condition: 'category code provided but not found in registered categories',
    action: 'reject',
    reason_code: 'CATEGORY_NOT_FOUND',
    explanation: 'Referenced category code was not found in registered categories.',
    doc_reference: 'FR-ERP1-03',
  },
  {
    rule_id: 'PRD-016',
    version: '1.0.0',
    record_type: 'product',
    field: 'notification_email',
    condition: 'email provided does not match valid RFC-5322 email pattern',
    action: 'reject',
    reason_code: 'INVALID_EMAIL_FORMAT',
    explanation: 'Notification email must be a valid email format if supplied.',
    doc_reference: 'RL-02',
  },
  {
    rule_id: 'PRD-017',
    version: '1.0.0',
    record_type: 'product',
    field: 'contact_phone',
    condition: 'phone provided does not match international telephone pattern',
    action: 'reject',
    reason_code: 'INVALID_PHONE_FORMAT',
    explanation: 'Contact phone must match valid phone number format if supplied.',
    doc_reference: 'RL-02',
  },
  {
    rule_id: 'PRD-018',
    version: '1.0.0',
    record_type: 'product',
    field: 'name',
    condition: 'text begins with formula injection prefix (=, +, -, @)',
    action: 'reject',
    reason_code: 'FORMULA_INJECTION_DETECTED',
    explanation: 'CSV formula injection vector detected; rejected per PLT-12 / KIT-16.',
    doc_reference: 'PLT-12 / KIT-16',
  },

  // ── Stock Levels ───────────────────────────────────────────────────────────
  {
    rule_id: 'STK-001',
    version: '1.0.0',
    record_type: 'stock_level',
    field: 'sku',
    condition: 'SKU reference is empty or whitespace',
    action: 'reject',
    reason_code: 'PRODUCT_REQUIRED',
    explanation: 'Stock level record must reference an existing product SKU.',
    doc_reference: 'FR-ERP1-06',
  },
  {
    rule_id: 'STK-002',
    version: '1.0.0',
    record_type: 'stock_level',
    field: 'sku',
    condition: 'referenced SKU does not exist in product master',
    action: 'reject',
    reason_code: 'PRODUCT_NOT_FOUND',
    explanation: 'Referenced product SKU does not exist in catalog.',
    doc_reference: 'FR-ERP1-06',
  },
  {
    rule_id: 'STK-003',
    version: '1.0.0',
    record_type: 'stock_level',
    field: 'warehouse_code',
    condition: 'warehouse code is empty or whitespace',
    action: 'reject',
    reason_code: 'WAREHOUSE_REQUIRED',
    explanation: 'Warehouse code is required for stock balance.',
    doc_reference: 'FR-ERP1-05 / FR-ERP1-06',
  },
  {
    rule_id: 'STK-004',
    version: '1.0.0',
    record_type: 'stock_level',
    field: 'warehouse_code',
    condition: 'warehouse code does not match active warehouse WH-01',
    action: 'reject',
    reason_code: 'WAREHOUSE_NOT_FOUND',
    explanation: 'Referenced warehouse code not recognized in V1.',
    doc_reference: 'FR-ERP1-05',
  },
  {
    rule_id: 'STK-005',
    version: '1.0.0',
    record_type: 'stock_level',
    field: 'quantity',
    condition: 'stock quantity is empty or whitespace',
    action: 'reject',
    reason_code: 'QUANTITY_REQUIRED',
    explanation: 'Stock quantity is required.',
    doc_reference: 'FR-ERP1-06',
  },
  {
    rule_id: 'STK-006',
    version: '1.0.0',
    record_type: 'stock_level',
    field: 'quantity',
    condition: 'stock quantity is negative (< 0)',
    action: 'reject',
    reason_code: 'NEGATIVE_STOCK',
    explanation: 'Inventory stock quantity cannot become negative (BR-ERP1-02).',
    doc_reference: 'BR-ERP1-02 / FR-ERP1-06',
  },
  {
    rule_id: 'STK-007',
    version: '1.0.0',
    record_type: 'stock_level',
    field: 'quantity',
    condition: 'stock quantity is not a valid numeric decimal representation',
    action: 'reject',
    reason_code: 'INVALID_QUANTITY_FORMAT',
    explanation: 'Stock quantity must be a valid numeric decimal representation.',
    doc_reference: 'FR-ERP1-06',
  },
  {
    rule_id: 'STK-008',
    version: '1.0.0',
    record_type: 'stock_level',
    field: 'quantity',
    condition: 'stock quantity has more than 4 decimal places',
    action: 'reject',
    reason_code: 'EXCESS_DECIMAL_PLACES',
    explanation: 'Stock quantity exceeds maximum 4 decimal places.',
    doc_reference: 'FR-ERP1-06 / SDS §4.7',
  },
  {
    rule_id: 'STK-009',
    version: '1.0.0',
    record_type: 'stock_level',
    field: 'sku,warehouse_code',
    condition: 'duplicate stock balance for product/warehouse in batch',
    action: 'review',
    reason_code: 'DUPLICATE_STOCK_LEVEL_REVIEW',
    explanation: 'Repeated opening stock line for product/warehouse held for review.',
    doc_reference: 'FR-ERP1-06 / DR-6',
  },
  {
    rule_id: 'STK-010',
    version: '1.0.0',
    record_type: 'stock_level',
    field: 'as_of_date',
    condition: 'date provided in ambiguous format (e.g. MM/DD/YYYY or DD-MM-YYYY); explicit ISO-8601 YYYY-MM-DD required',
    action: 'reject',
    reason_code: 'AMBIGUOUS_DATE_FORMAT',
    explanation: 'Ambiguous date format detected; explicit ISO-8601 YYYY-MM-DD format required.',
    doc_reference: 'FR-ERP1-06 / SDS §4.7',
  },
  {
    rule_id: 'STK-011',
    version: '1.0.0',
    record_type: 'stock_level',
    field: 'as_of_date',
    condition: 'date is not a valid calendar date',
    action: 'reject',
    reason_code: 'INVALID_DATE',
    explanation: 'Date provided does not represent a valid calendar date.',
    doc_reference: 'FR-ERP1-06',
  },
];

export interface ProfileReport {
  profile_schema_version: number;
  rules_version: string;
  module: 'erp1';
  fixture: string;
  fixture_sha256: string;
  total_rows: number;
  reconciliation: {
    total_source_rows: number;
    accepted: number;
    rejected: number;
    review: number;
    skipped: number;
    unaccounted: number;
    is_balanced: boolean;
  };
  by_record_type: Record<
    string,
    {
      accepted: number;
      rejected: number;
      review: number;
      skipped: number;
      total: number;
    }
  >;
  by_reason_code: Record<string, number>;
  rows: Record<
    string,
    {
      outcome: TerminalOutcome;
      reasons: string[];
    }
  >;
  generated_at: string;
}

/**
 * Validates ISO-8601 calendar date and flags ambiguous formats.
 */
export function validateIsoDate(raw: string): { valid: boolean; ambiguous: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true, ambiguous: false };

  // Check for ambiguous formats: MM/DD/YYYY, DD/MM/YYYY, MM-DD-YYYY, etc.
  if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(trimmed)) {
    return { valid: false, ambiguous: true };
  }

  // Must match YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss(Z|...)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (!isoMatch) {
    return { valid: false, ambiguous: false };
  }

  const year = parseInt(isoMatch[1]!, 10);
  const month = parseInt(isoMatch[2]!, 10);
  const day = parseInt(isoMatch[3]!, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { valid: false, ambiguous: false };
  }

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return { valid: false, ambiguous: false };
  }

  return { valid: true, ambiguous: false };
}

/**
 * Computes SHA-256 hexadecimal digest for raw content.
 */
export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Parses raw CSV into RawRow array without mutating cell values (BR-KIT-03).
 */
export function parseCsv(csvText: string): RawRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return [];

  const header = lines[0]!.split(',').map((h) => h.trim());
  const rows: RawRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    // Standard CSV splitter handling quoted values
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c]!;
      if (ch === '"') {
        if (inQuotes && line[c + 1] === '"') {
          cur += '"';
          c++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);

    const getCol = (name: FixtureColumn): string => {
      const idx = header.indexOf(name);
      return idx >= 0 && idx < cells.length ? cells[idx]! : '';
    };

    rows.push({
      line_number: i + 1,
      row_id: getCol('row_id') || `R${String(i).padStart(3, '0')}`,
      record_type: getCol('record_type'),
      case_tags: getCol('case_tags'),
      source_id: getCol('source_id'),
      code: getCol('code'),
      name: getCol('name'),
      sku: getCol('sku'),
      category_code: getCol('category_code'),
      unit_of_measure: getCol('unit_of_measure'),
      price: getCol('price'),
      currency: getCol('currency'),
      tax_rate: getCol('tax_rate'),
      warehouse_code: getCol('warehouse_code'),
      quantity: getCol('quantity'),
      as_of_date: getCol('as_of_date'),
      is_default: getCol('is_default'),
      notification_email: getCol('notification_email'),
      contact_phone: getCol('contact_phone'),
      supplier_bank_account: getCol('supplier_bank_account'),
      employee_ssn: getCol('employee_ssn'),
      source_system: getCol('source_system'),
      expect_outcome: getCol('expect_outcome'),
      expect_reasons: getCol('expect_reasons'),
    });
  }

  return rows;
}

/**
 * Masks sensitive values in dataset for review views.
 */
export function maskSensitiveFields(row: RawRow): Record<string, unknown> {
  const res: Record<string, unknown> = { ...row };
  if (row.supplier_bank_account) {
    const raw = row.supplier_bank_account.trim();
    res['supplier_bank_account'] =
      raw.length > 4 ? `****-****-${raw.slice(-4)}` : '****';
  }
  if (row.employee_ssn) {
    const raw = row.employee_ssn.trim();
    res['employee_ssn'] =
      raw.length > 4 ? `***-**-${raw.slice(-4)}` : '***-**-****';
  }
  return res;
}

/**
 * Normalizes SKU natural key for exact deterministic matching.
 */
export function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Evaluates the dataset and assigns each row a terminal outcome.
 */
export function evaluateDataset(rows: RawRow[]): EvaluatedRow[] {
  const evaluated: EvaluatedRow[] = [];

  const seenCategoryCodes = new Set<string>();
  const validCategoryCodes = new Set<string>(['GEN', 'ELEC', 'CHEM', 'RAW', 'PKG', 'TOOLS']);
  const seenWarehouses = new Set<string>();
  const validWarehouses = new Set<string>(['WH-01']);
  const seenSkus = new Set<string>();
  const validSkus = new Set<string>();
  const seenStockKeys = new Set<string>();

  for (const row of rows) {
    const rejectionReasons: string[] = [];
    const reviewReasons: string[] = [];
    const ruleIds: string[] = [];

    // Check for formula injection in textual fields (PLT-12 / KIT-16)
    const textValues = [row.name, row.sku, row.code, row.category_code];
    for (const val of textValues) {
      if (/^[=+\-@\t\r]/.test(val.trim()) || /^[\t\r]/.test(val)) {
        rejectionReasons.push('FORMULA_INJECTION_DETECTED');
        ruleIds.push('PRD-018');
        break;
      }
    }

    if (row.record_type === 'category') {
      const codeTrimmed = row.code.trim();
      const nameTrimmed = row.name.trim();

      if (!codeTrimmed) {
        rejectionReasons.push('CATEGORY_CODE_REQUIRED');
        ruleIds.push('CAT-001');
      } else if (codeTrimmed.length > 64) {
        rejectionReasons.push('CATEGORY_CODE_TOO_LONG');
        ruleIds.push('CAT-003');
      } else {
        const normCode = codeTrimmed.toUpperCase();
        if (seenCategoryCodes.has(normCode)) {
          reviewReasons.push('DUPLICATE_CATEGORY_CODE_REVIEW');
          ruleIds.push('CAT-004');
        } else {
          seenCategoryCodes.add(normCode);
          validCategoryCodes.add(normCode);
        }
      }

      if (!nameTrimmed) {
        rejectionReasons.push('CATEGORY_NAME_REQUIRED');
        ruleIds.push('CAT-002');
      }
    } else if (row.record_type === 'warehouse') {
      const codeTrimmed = row.code.trim();
      const nameTrimmed = row.name.trim();

      if (!codeTrimmed) {
        rejectionReasons.push('WAREHOUSE_CODE_REQUIRED');
        ruleIds.push('WH-001');
      }
      if (!nameTrimmed) {
        rejectionReasons.push('WAREHOUSE_NAME_REQUIRED');
        ruleIds.push('WH-002');
      }

      if (codeTrimmed) {
        const normCode = codeTrimmed.toUpperCase();
        if (seenWarehouses.size >= 1 && !seenWarehouses.has(normCode)) {
          rejectionReasons.push('MULTIPLE_WAREHOUSES_REJECTED');
          ruleIds.push('WH-003');
        } else if (normCode !== 'WH-01') {
          rejectionReasons.push('MULTIPLE_WAREHOUSES_REJECTED');
          ruleIds.push('WH-003');
        } else {
          seenWarehouses.add(normCode);
          validWarehouses.add(normCode);
        }
      }
    } else if (row.record_type === 'product') {
      const nameTrimmed = row.name.trim();
      const skuTrimmed = row.sku.trim();
      const uomTrimmed = row.unit_of_measure.trim();
      const priceTrimmed = row.price.trim();
      const currencyTrimmed = row.currency.trim().toUpperCase();
      const catTrimmed = row.category_code.trim().toUpperCase();

      if (!nameTrimmed) {
        rejectionReasons.push('PRODUCT_NAME_REQUIRED');
        ruleIds.push('PRD-001');
      }

      if (!skuTrimmed) {
        rejectionReasons.push('SKU_REQUIRED');
        ruleIds.push('PRD-002');
      } else {
        const normSku = normalizeSku(row.sku);
        if (seenSkus.has(normSku)) {
          reviewReasons.push('DUPLICATE_SKU_REVIEW');
          ruleIds.push('PRD-003');
        } else {
          seenSkus.add(normSku);
          validSkus.add(normSku);
        }
      }

      if (!uomTrimmed) {
        rejectionReasons.push('UNIT_OF_MEASURE_REQUIRED');
        ruleIds.push('PRD-004');
      } else if (!ACCEPTED_UOMS.includes(uomTrimmed as AcceptedUom)) {
        rejectionReasons.push('INVALID_UNIT_OF_MEASURE');
        ruleIds.push('PRD-005');
      }

      if (!priceTrimmed) {
        rejectionReasons.push('PRICE_REQUIRED');
        ruleIds.push('PRD-006');
      } else {
        const num = Number(priceTrimmed);
        if (isNaN(num)) {
          rejectionReasons.push('INVALID_PRICE_FORMAT');
          ruleIds.push('PRD-008');
        } else if (num < 0) {
          rejectionReasons.push('NEGATIVE_PRICE');
          ruleIds.push('PRD-007');
        } else {
          const parts = priceTrimmed.split('.');
          if (parts[1] && parts[1].length > 4) {
            rejectionReasons.push('EXCESS_DECIMAL_PLACES');
            ruleIds.push('PRD-009');
          }
        }
      }

      if (!currencyTrimmed) {
        rejectionReasons.push('CURRENCY_REQUIRED');
        ruleIds.push('PRD-010');
      } else if (!/^[A-Z]{3}$/.test(currencyTrimmed)) {
        rejectionReasons.push('INVALID_CURRENCY');
        ruleIds.push('PRD-011');
      }

      if (row.tax_rate.trim()) {
        const taxNum = Number(row.tax_rate.trim());
        if (isNaN(taxNum)) {
          rejectionReasons.push('INVALID_TAX_RATE_FORMAT');
          ruleIds.push('PRD-014');
        } else if (taxNum < 0) {
          rejectionReasons.push('NEGATIVE_TAX_RATE');
          ruleIds.push('PRD-012');
        } else if (taxNum > 100) {
          rejectionReasons.push('TAX_RATE_OUT_OF_RANGE');
          ruleIds.push('PRD-013');
        }
      }

      if (catTrimmed && !validCategoryCodes.has(catTrimmed)) {
        rejectionReasons.push('CATEGORY_NOT_FOUND');
        ruleIds.push('PRD-015');
      }

      if (row.notification_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.notification_email.trim())) {
        rejectionReasons.push('INVALID_EMAIL_FORMAT');
        ruleIds.push('PRD-016');
      }

      if (row.contact_phone.trim() && !/^\+?[0-9\s\-()]{7,20}$/.test(row.contact_phone.trim())) {
        rejectionReasons.push('INVALID_PHONE_FORMAT');
        ruleIds.push('PRD-017');
      }
    } else if (row.record_type === 'stock_level') {
      const skuTrimmed = row.sku.trim();
      const whTrimmed = row.warehouse_code.trim().toUpperCase();
      const qtyTrimmed = row.quantity.trim();

      if (!skuTrimmed) {
        rejectionReasons.push('PRODUCT_REQUIRED');
        ruleIds.push('STK-001');
      } else {
        const normSku = normalizeSku(row.sku);
        if (!validSkus.has(normSku)) {
          rejectionReasons.push('PRODUCT_NOT_FOUND');
          ruleIds.push('STK-002');
        }
      }

      if (!whTrimmed) {
        rejectionReasons.push('WAREHOUSE_REQUIRED');
        ruleIds.push('STK-003');
      } else if (whTrimmed !== 'WH-01') {
        rejectionReasons.push('WAREHOUSE_NOT_FOUND');
        ruleIds.push('STK-004');
      }

      if (!qtyTrimmed) {
        rejectionReasons.push('QUANTITY_REQUIRED');
        ruleIds.push('STK-005');
      } else {
        const qtyNum = Number(qtyTrimmed);
        if (isNaN(qtyNum)) {
          rejectionReasons.push('INVALID_QUANTITY_FORMAT');
          ruleIds.push('STK-007');
        } else if (qtyNum < 0) {
          rejectionReasons.push('NEGATIVE_STOCK');
          ruleIds.push('STK-006');
        } else {
          const parts = qtyTrimmed.split('.');
          if (parts[1] && parts[1].length > 4) {
            rejectionReasons.push('EXCESS_DECIMAL_PLACES');
            ruleIds.push('STK-008');
          }
        }
      }

      if (skuTrimmed && whTrimmed) {
        const stockKey = `${normalizeSku(row.sku)}::${whTrimmed}`;
        if (seenStockKeys.has(stockKey)) {
          reviewReasons.push('DUPLICATE_STOCK_LEVEL_REVIEW');
          ruleIds.push('STK-009');
        } else {
          seenStockKeys.add(stockKey);
        }
      }

      if (row.as_of_date && row.as_of_date.trim()) {
        const dateRes = validateIsoDate(row.as_of_date);
        if (dateRes.ambiguous) {
          rejectionReasons.push('AMBIGUOUS_DATE_FORMAT');
          ruleIds.push('STK-010');
        } else if (!dateRes.valid) {
          rejectionReasons.push('INVALID_DATE');
          ruleIds.push('STK-011');
        }
      }
    }

    let outcome: TerminalOutcome = 'accepted';
    let finalReasons: string[] = [];

    if (rejectionReasons.length > 0) {
      outcome = 'rejected';
      finalReasons = rejectionReasons;
    } else if (reviewReasons.length > 0) {
      outcome = 'review';
      finalReasons = reviewReasons;
    }

    evaluated.push({
      line_number: row.line_number,
      row_id: row.row_id || `R${String(row.line_number - 1).padStart(3, '0')}`,
      record_type: row.record_type,
      source_id: row.source_id,
      outcome,
      reason_codes: finalReasons,
      normalized_data: { ...row },
      masked_data: maskSensitiveFields(row),
      rule_ids: ruleIds,
    });
  }

  return evaluated;
}

/**
 * Builds deterministic profile report from evaluated rows and raw fixture text.
 */
export function buildProfile(csvText: string, evaluatedRows: EvaluatedRow[]): ProfileReport {
  const sha256 = sha256Hex(csvText);

  let accepted = 0;
  let rejected = 0;
  let review = 0;
  let skipped = 0;

  const byRecordType: Record<
    string,
    {
      accepted: number;
      rejected: number;
      review: number;
      skipped: number;
      total: number;
    }
  > = {};

  const byReasonCode: Record<string, number> = {};
  const rowManifest: Record<string, { outcome: TerminalOutcome; reasons: string[] }> = {};

  for (const row of evaluatedRows) {
    if (!byRecordType[row.record_type]) {
      byRecordType[row.record_type] = { accepted: 0, rejected: 0, review: 0, skipped: 0, total: 0 };
    }

    const typeStats = byRecordType[row.record_type]!;
    typeStats.total++;

    if (row.outcome === 'accepted') {
      accepted++;
      typeStats.accepted++;
    } else if (row.outcome === 'rejected') {
      rejected++;
      typeStats.rejected++;
    } else if (row.outcome === 'review') {
      review++;
      typeStats.review++;
    } else if (row.outcome === 'skipped') {
      skipped++;
      typeStats.skipped++;
    }

    for (const reason of row.reason_codes) {
      byReasonCode[reason] = (byReasonCode[reason] || 0) + 1;
    }

    rowManifest[row.row_id] = {
      outcome: row.outcome,
      reasons: row.reason_codes,
    };
  }

  const total = evaluatedRows.length;
  const unaccounted = total - (accepted + rejected + review + skipped);

  return {
    profile_schema_version: PROFILE_SCHEMA_VERSION,
    rules_version: RULES_VERSION,
    module: 'erp1',
    fixture: FIXTURE_PATH,
    fixture_sha256: sha256,
    total_rows: total,
    reconciliation: {
      total_source_rows: total,
      accepted,
      rejected,
      review,
      skipped,
      unaccounted,
      is_balanced: unaccounted === 0,
    },
    by_record_type: byRecordType,
    by_reason_code: byReasonCode,
    rows: rowManifest,
    generated_at: '2026-10-23T00:00:00.000Z',
  };
}
