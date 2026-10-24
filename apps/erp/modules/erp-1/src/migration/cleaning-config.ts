/**
 * ERP-1 Products & Inventory — Module Cleaning Rules & Field-Level Audit Configuration (ERP1-27 / KIT-04)
 *
 * Configures the shared Migration Kit cleaning engine (`@cs/kit`, SDS §3.4 / §4.4) for the ERP-1
 * entities (categories, warehouses, products, stock levels).
 *
 * Guarantees:
 *  - Every modified value produces an audit entry (source_row, field_name, original_value, cleaned_value, rule_id).
 *  - Unrecoverable required-field anomalies reject the row with a structured reason code matching rules.ts.
 *  - Formula-injection prefixes are rejected, never silently "cleaned" (OWASP / PLT-12 / KIT-16).
 *  - Ambiguous dates are rejected for explicit human review; never guessed.
 *  - Sensitive fields (supplier_bank_account, employee_ssn) are masked before cleaning and excluded from audit logs.
 *  - Deterministic and exact: no fuzzy matching, no auto-merge in V1.
 *  - Raw input rows are never mutated.
 *
 * @module erp1/migration/cleaning-config
 */

import {
  V1_CLEANING_RULES,
  cleanControlCharacters,
  cleanCurrencyDecimal,
  cleanDataset,
  cleanEmail,
  cleanIsoDate,
  cleanPhone,
  cleanTextWhitespace,
  exportFieldAuditCsv,
  type CleanerConfig,
  type DatasetCleanResult,
  type FieldChangeAudit,
  type FieldCleanRuleConfig,
} from '@cs/kit';
import {
  ACCEPTED_CURRENCIES,
  ACCEPTED_UOMS,
  RECORD_TYPES,
  maskSensitiveFields,
  normalizeSku,
  validateIsoDate,
  type RawRow,
} from './rules.js';
import { hasFormulaPrefix } from './profiling-config.js';

export const ERP1_NOT_APPLICABLE_RULES: Readonly<Record<string, string>> = {
  'RL-NAME-01': 'Product and warehouse names are proper trade or facility names; proper-casing would corrupt brand acronyms (e.g. NEMA, SMD, LED).',
  'RL-DUP-01': 'Exact duplicate detection is owned by the ERP1-25 Dirty Data Pack evaluator and ERP1-26 profiler.',
};

type Audit = { ruleId: string; original: string; cleaned: string };
type CleanResult = ReturnType<FieldCleanRuleConfig['clean']>;

const UOM_SET: ReadonlySet<string> = new Set<string>(ACCEPTED_UOMS);
const CURRENCY_SET: ReadonlySet<string> = new Set<string>(ACCEPTED_CURRENCIES);
const DECIMAL_COMMA_REGEX = /,\d{1,2}$/;

interface Stepper {
  readonly audits: Audit[];
  value(): string;
  apply(ruleId: string, next: string): void;
}

function stepper(initial: string, enabled: ReadonlySet<string>): Stepper {
  let current = initial;
  const audits: Audit[] = [];
  return {
    audits,
    value: () => current,
    apply(ruleId, next) {
      if (!enabled.has(ruleId) || next === current) return;
      audits.push({ ruleId, original: current, cleaned: next });
      current = next;
    },
  };
}

const pass = (s: Stepper): CleanResult => ({ cleaned: s.value(), audits: s.audits });

const reject = (s: Stepper, ruleId: string, reasonCode: string, message: string): CleanResult => ({
  cleaned: s.value(),
  audits: s.audits,
  error: { ruleId, reasonCode, message },
});

const isBlank = (v: string): boolean => v.trim() === '';

function formulaReject(val: string, label: string): CleanResult | null {
  if (!hasFormulaPrefix(val)) return null;
  return {
    cleaned: val,
    audits: [],
    error: {
      ruleId: 'RL-FORMAT-01',
      reasonCode: 'FORMULA_INJECTION_DETECTED',
      message: `${label} starts with a spreadsheet formula prefix and was rejected.`,
    },
  };
}

export function parseScaledDecimal(val: string, maxDecimals: number): number | null {
  const trimmed = val.trim();
  if (trimmed === '') return null;
  const num = Number(trimmed);
  if (isNaN(num)) return null;
  const parts = trimmed.split('.');
  if (parts[1] && parts[1].length > maxDecimals) return null;
  return num;
}

// ── Field Cleaning Rule Definitions ──────────────────────────────────────────

export const ERP1_FIELD_CLEAN_RULES: readonly FieldCleanRuleConfig[] = [
  // ── Category: Code ──
  {
    field: 'code',
    label: 'Category Code',
    recordType: 'category',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Category Code');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', s.value().trim());
      s.apply('RL-TEXT-01', s.value().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'CATEGORY_CODE_REQUIRED', 'Category Code is required.');
      }
      return pass(s);
    },
  },
  // ── Category: Name ──
  {
    field: 'name',
    label: 'Category Name',
    recordType: 'category',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Category Name');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', cleanTextWhitespace(s.value()));
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'CATEGORY_NAME_REQUIRED', 'Category Name is required.');
      }
      return pass(s);
    },
  },
  // ── Category: Is Default ──
  {
    field: 'is_default',
    label: 'Is Default',
    recordType: 'category',
    required: false,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim().toLowerCase());
      if (s.value() !== '' && s.value() !== 'true' && s.value() !== 'false') {
        return reject(s, 'RL-FORMAT-01', 'INVALID_BOOLEAN', "Is Default must be 'true' or 'false'.");
      }
      return pass(s);
    },
  },

  // ── Warehouse: Code ──
  {
    field: 'code',
    label: 'Warehouse Code',
    recordType: 'warehouse',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Warehouse Code');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', s.value().trim().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'WAREHOUSE_CODE_REQUIRED', 'Warehouse Code is required.');
      }
      if (s.value() !== 'WH-01') {
        return reject(
          s,
          'RL-FORMAT-01',
          'INVALID_WAREHOUSE_FACILITY',
          "Only facility 'WH-01' is permitted in V1 (FR-ERP1-05)."
        );
      }
      return pass(s);
    },
  },
  // ── Warehouse: Name ──
  {
    field: 'name',
    label: 'Warehouse Name',
    recordType: 'warehouse',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Warehouse Name');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', cleanTextWhitespace(s.value()));
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'WAREHOUSE_NAME_REQUIRED', 'Warehouse Name is required.');
      }
      return pass(s);
    },
  },
  // ── Warehouse: Notification Email ──
  {
    field: 'notification_email',
    label: 'Notification Email',
    recordType: 'warehouse',
    required: false,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Notification Email');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', s.value().trim());
      if (s.value() === '') return pass(s);
      const emailRes = cleanEmail(s.value());
      s.apply('RL-EMAIL-01', emailRes.cleaned);
      if (!emailRes.isValid) {
        return reject(s, 'RL-EMAIL-01', 'INVALID_EMAIL', 'Notification email format is invalid.');
      }
      return pass(s);
    },
  },
  // ── Warehouse: Contact Phone ──
  {
    field: 'contact_phone',
    label: 'Contact Phone',
    recordType: 'warehouse',
    required: false,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Contact Phone');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', s.value().trim());
      if (s.value() === '') return pass(s);
      const cleaned = cleanPhone(s.value());
      s.apply('RL-PHONE-01', cleaned);
      return pass(s);
    },
  },

  // ── Product: SKU ──
  {
    field: 'sku',
    label: 'Product SKU',
    recordType: 'product',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Product SKU');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', s.value().trim());
      s.apply('RL-TEXT-01', s.value().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'SKU_REQUIRED', 'Product SKU is required.');
      }
      if (s.value().length > 64) {
        return reject(s, 'RL-FORMAT-01', 'SKU_TOO_LONG', 'Product SKU cannot exceed 64 characters.');
      }
      return pass(s);
    },
  },
  // ── Product: Name ──
  {
    field: 'name',
    label: 'Product Name',
    recordType: 'product',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Product Name');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', cleanTextWhitespace(s.value()));
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'PRODUCT_NAME_REQUIRED', 'Product Name is required.');
      }
      return pass(s);
    },
  },
  // ── Product: Category Code ──
  {
    field: 'category_code',
    label: 'Category Code',
    recordType: 'product',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Category Code');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', s.value().trim().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'CATEGORY_CODE_REQUIRED', 'Category Code is required.');
      }
      return pass(s);
    },
  },
  // ── Product: Unit of Measure ──
  {
    field: 'unit_of_measure',
    label: 'Unit of Measure',
    recordType: 'product',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', s.value().trim().toLowerCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'UOM_REQUIRED', 'Unit of Measure is required.');
      }
      if (!UOM_SET.has(s.value())) {
        return reject(
          s,
          'RL-FORMAT-01',
          'INVALID_UOM',
          `Unit of Measure must be one of: ${ACCEPTED_UOMS.join(', ')} (FR-ERP1-04).`
        );
      }
      return pass(s);
    },
  },
  // ── Product: Price ──
  {
    field: 'price',
    label: 'Unit Price',
    recordType: 'product',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      if (isBlank(val)) {
        return reject(s, 'RL-REQ-01', 'PRICE_REQUIRED', 'Unit Price is required.');
      }
      const trimmed = val.trim();
      if (DECIMAL_COMMA_REGEX.test(trimmed)) {
        return reject(s, 'RL-CURRENCY-01', 'INVALID_PRICE_FORMAT', 'Unit Price uses a decimal comma.');
      }
      s.apply('RL-CURRENCY-01', cleanCurrencyDecimal(trimmed).cleaned);
      const parsed = parseScaledDecimal(s.value(), 2);
      if (parsed === null) {
        return reject(s, 'RL-CURRENCY-01', 'INVALID_PRICE_FORMAT', 'Unit Price must be a valid decimal (up to 2 decimals).');
      }
      if (parsed < 0) {
        return reject(s, 'RL-CURRENCY-01', 'NEGATIVE_PRICE', 'Unit Price cannot be negative (BR-ERP1-01).');
      }
      return pass(s);
    },
  },
  // ── Product: Currency ──
  {
    field: 'currency',
    label: 'Currency',
    recordType: 'product',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'CURRENCY_REQUIRED', 'Currency is required.');
      }
      if (!CURRENCY_SET.has(s.value())) {
        return reject(
          s,
          'RL-FORMAT-01',
          'INVALID_CURRENCY',
          `Currency must be one of: ${ACCEPTED_CURRENCIES.join(', ')}.`
        );
      }
      return pass(s);
    },
  },
  // ── Product: Tax Rate ──
  {
    field: 'tax_rate',
    label: 'Tax Rate',
    recordType: 'product',
    required: false,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (s.value() === '') return pass(s);
      s.apply('RL-CURRENCY-01', cleanCurrencyDecimal(s.value()).cleaned);
      const parsed = parseScaledDecimal(s.value(), 4);
      if (parsed === null || parsed < 0) {
        return reject(s, 'RL-CURRENCY-01', 'INVALID_TAX_RATE', 'Tax Rate must be a non-negative decimal.');
      }
      return pass(s);
    },
  },

  // ── Stock Level: SKU ──
  {
    field: 'sku',
    label: 'Stock SKU',
    recordType: 'stock_level',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Stock SKU');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', s.value().trim().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'SKU_REQUIRED', 'Stock SKU is required.');
      }
      return pass(s);
    },
  },
  // ── Stock Level: Warehouse Code ──
  {
    field: 'warehouse_code',
    label: 'Warehouse Code',
    recordType: 'stock_level',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'WAREHOUSE_CODE_REQUIRED', 'Warehouse Code is required.');
      }
      if (s.value() !== 'WH-01') {
        return reject(
          s,
          'RL-FORMAT-01',
          'INVALID_WAREHOUSE_FACILITY',
          "Only facility 'WH-01' is permitted in V1 (FR-ERP1-05)."
        );
      }
      return pass(s);
    },
  },
  // ── Stock Level: Quantity ──
  {
    field: 'quantity',
    label: 'Stock Quantity',
    recordType: 'stock_level',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      if (isBlank(val)) {
        return reject(s, 'RL-REQ-01', 'QUANTITY_REQUIRED', 'Stock Quantity is required.');
      }
      s.apply('RL-TEXT-01', val.trim());
      s.apply('RL-CURRENCY-01', cleanCurrencyDecimal(s.value()).cleaned);
      const parsed = parseScaledDecimal(s.value(), 4);
      if (parsed === null) {
        return reject(s, 'RL-CURRENCY-01', 'INVALID_QUANTITY_FORMAT', 'Stock Quantity must be a valid number.');
      }
      if (parsed < 0) {
        return reject(s, 'RL-CURRENCY-01', 'NEGATIVE_STOCK_QUANTITY', 'Stock quantity cannot be negative (BR-ERP1-02).');
      }
      return pass(s);
    },
  },
  // ── Stock Level: As Of Date ──
  {
    field: 'as_of_date',
    label: 'As Of Date',
    recordType: 'stock_level',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      const t = val.trim();
      if (t === '') {
        return reject(s, 'RL-REQ-01', 'DATE_REQUIRED', 'As Of Date is required.');
      }
      const isoCheck = validateIsoDate(t);
      if (isoCheck.valid) {
        s.apply('RL-DATE-01', t);
        return pass(s);
      }
      if (isoCheck.ambiguous) {
        return reject(
          s,
          'RL-DATE-01',
          'AMBIGUOUS_DATE_FORMAT_REVIEW',
          `As Of Date '${t}' is ambiguous (day/month order unknown) and needs human review.`
        );
      }
      const coerced = cleanIsoDate(t);
      if (coerced.isValid) {
        s.apply('RL-DATE-01', coerced.cleaned);
        return pass(s);
      }
      return reject(s, 'RL-DATE-01', 'INVALID_DATE', 'As Of Date must be a real calendar date (YYYY-MM-DD).');
    },
  },
];

export const ERP1_CLEANER_CONFIG: CleanerConfig = {
  enabledRuleIds: V1_CLEANING_RULES.map((r) => r.ruleId),
  fields: ERP1_FIELD_CLEAN_RULES,
  sourceRowField: 'row_id',
  recordTypeField: 'record_type',
};

/**
 * Cleans an ERP-1 dataset while strictly masking sensitive bank/personal data beforehand.
 */
export function cleanErp1Dataset<T extends Record<string, string>>(
  rows: readonly T[],
  options?: { enabledRuleIds?: readonly string[] }
): DatasetCleanResult<T> {
  const safeRows = rows.map((r) => {
    const raw = r as unknown as RawRow;
    const masked = maskSensitiveFields(raw);
    return { ...r, ...masked } as T;
  });

  const cfg: CleanerConfig = {
    ...ERP1_CLEANER_CONFIG,
    enabledRuleIds: options?.enabledRuleIds ?? ERP1_CLEANER_CONFIG.enabledRuleIds,
  };

  return cleanDataset(safeRows, cfg);
}

/**
 * Exports field-level change audits to a formula-safe CSV conforming to SDS §4.4.
 */
export function exportErp1FieldAuditCsv(audits: readonly FieldChangeAudit[]): string {
  return exportFieldAuditCsv(audits);
}
