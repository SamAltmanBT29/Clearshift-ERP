/**
 * ERP-2 Vendors & Purchasing — Module Cleaning Rules & Field-Level Audit Configuration (ERP2-27 / KIT-04)
 *
 * Configures the shared Migration Kit cleaning engine (`@cs/kit`, SDS §3.4 / §4.4) for the ERP-2
 * entities (vendors, purchase orders, PO lines). No cleaning engine is re-implemented here: the
 * shared standard cleaners (whitespace, control characters, email, ISO date, currency/decimal) and
 * `cleanDataset` do the work, and the ERP2-25 helpers (normalisers, date classifier, scaled decimals,
 * masking) are reused so cleaning stays consistent with the Dirty Data Pack evaluator.
 *
 * Guarantees:
 *  - Every modified value produces an audit entry (source_row, field_name, original_value, cleaned_value, rule_id).
 *  - Unrecoverable required-field anomalies reject the row with a structured reason code
 *    (codes match the ERP2-25 reason-code catalogue where one exists).
 *  - Formula-injection prefixes are rejected, never silently "cleaned".
 *  - Ambiguous dates (03/04/2026) are never guessed; they are rejected for a human decision.
 *  - Bank details never reach the cleaning result or audit log: rows are masked before cleaning and
 *    bank_account has no cleaning rule.
 *  - Deterministic and exact: no fuzzy matching, no auto-merge. Duplicate detection stays with the
 *    ERP2-25 evaluator / ERP2-26 profiler (RL-DUP-01 is not re-implemented here).
 *  - Raw input rows are never mutated.
 *
 * @module erp2/migration/cleaning-config
 */

import {
  V1_CLEANING_RULES,
  cleanControlCharacters,
  cleanCurrencyDecimal,
  cleanDataset,
  cleanEmail,
  cleanIsoDate,
  cleanTextWhitespace,
  exportFieldAuditCsv,
  type CleanerConfig,
  type DatasetCleanResult,
  type FieldChangeAudit,
  type FieldCleanRuleConfig,
} from '@cs/kit';
import {
  ACCEPTED_CURRENCIES,
  MAX_PAYMENT_TERMS_DAYS,
  MAX_VENDOR_CODE_LENGTH,
  classifyDate,
  hasFormulaPrefix,
  maskBankAccount,
  normalizeStatus,
  normalizeTaxNumber,
  parseScaledDecimal,
} from './dirty-data-plan.js';

/**
 * V1 registry rules that have no ERP-2 target column, and why. Phone normalisation (RL-PHONE-01) is
 * N/A: the ERP-2 pack and mapping template carry no phone column.
 */
export const ERP2_NOT_APPLICABLE_RULES: Readonly<Record<string, string>> = {
  'RL-PHONE-01': 'ERP-2 vendors, purchase orders and PO lines have no phone column.',
  'RL-NAME-01': 'Vendor names are company names; proper-casing would corrupt them (e.g. "KK", "GmbH").',
  'RL-ADDR-01': 'ERP-2 entities carry no address or city columns.',
  'RL-DUP-01': 'Exact duplicate detection is owned by the ERP2-25 evaluator and the ERP2-26 profiler.',
};

type Audit = { ruleId: string; original: string; cleaned: string };
type CleanResult = ReturnType<FieldCleanRuleConfig['clean']>;

const CURRENCY_SET: ReadonlySet<string> = new Set<string>(ACCEPTED_CURRENCIES);
const TAX_NORMALIZED_REGEX = /^[A-Z0-9]{4,32}$/;
const INTEGER_REGEX = /^-?\d+$/;
/** "12,50" / "1,5": a decimal comma. The shared currency cleaner would silently read it as 1250 / 15. */
const DECIMAL_COMMA_REGEX = /,\d{1,2}$/;

interface Stepper {
  readonly audits: Audit[];
  value(): string;
  apply(ruleId: string, next: string): void;
}

/** Applies one transformation at a time; records an audit only when the rule is enabled and the value changes. */
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

/** Formula-injection values are rejected as-is (no audit): they are never "fixed". */
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

// ── Rule builders ────────────────────────────────────────────────────────────

interface CodeSpec {
  field: string;
  recordType: string;
  label: string;
  requiredCode: string;
  tooLong?: { max: number; code: string };
}

/** Business keys (vendor code, PO number, SKU): trim, upper-case, required, formula-safe. */
function codeRule(spec: CodeSpec): FieldCleanRuleConfig {
  return {
    field: spec.field,
    label: spec.label,
    recordType: spec.recordType,
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, spec.label);
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      s.apply('RL-TEXT-01', s.value().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', spec.requiredCode, `${spec.label} is required.`);
      }
      if (spec.tooLong && s.value().length > spec.tooLong.max) {
        return reject(s, 'RL-FORMAT-01', spec.tooLong.code, `${spec.label} cannot exceed ${spec.tooLong.max} characters.`);
      }
      return pass(s);
    },
  };
}

function currencyRule(recordType: string, label: string): FieldCleanRuleConfig {
  return {
    field: 'currency',
    label,
    recordType,
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      s.apply('RL-TEXT-01', s.value().toUpperCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'CURRENCY_REQUIRED', `${label} is required; V1 applies no implicit currency default.`);
      }
      if (!CURRENCY_SET.has(s.value())) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_CURRENCY', `${label} must be one of ${ACCEPTED_CURRENCIES.join(', ')}.`);
      }
      return pass(s);
    },
  };
}

interface DateSpec {
  field: string;
  label: string;
  requiredCode: string | null;
}

function dateRule(spec: DateSpec): FieldCleanRuleConfig {
  return {
    field: spec.field,
    label: spec.label,
    recordType: 'purchase_order',
    required: spec.requiredCode !== null,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      const t = val.trim();
      if (t === '') {
        return spec.requiredCode !== null
          ? reject(s, 'RL-REQ-01', spec.requiredCode, `${spec.label} is required.`)
          : pass(s);
      }
      if (classifyDate(t) === 'iso') {
        s.apply('RL-DATE-01', t);
        return pass(s);
      }
      const coerced = cleanIsoDate(t); // YYYY/MM/DD and unpadded YYYY-M-D only; never guesses DD/MM vs MM/DD
      if (coerced.isValid) {
        s.apply('RL-DATE-01', coerced.cleaned);
        return pass(s);
      }
      if (classifyDate(t) === 'ambiguous') {
        return reject(
          s,
          'RL-DATE-01',
          'AMBIGUOUS_DATE_FORMAT_REVIEW',
          `${spec.label} '${t}' is ambiguous (day/month order unknown) and needs a human decision.`,
        );
      }
      return reject(s, 'RL-DATE-01', 'INVALID_DATE', `${spec.label} must be a real calendar date (YYYY-MM-DD).`);
    },
  };
}

interface DecimalSpec {
  field: string;
  recordType: string;
  label: string;
  scale: number;
  requiredCode: string | null;
  invalidCode: string;
  negativeCode: string;
  /** Set for fields where zero is not allowed (quantity). */
  zeroCode?: string;
  /** Strip currency symbols / thousands separators with the shared RL-CURRENCY-01 cleaner. */
  stripCurrency: boolean;
}

function decimalRule(spec: DecimalSpec): FieldCleanRuleConfig {
  return {
    field: spec.field,
    label: spec.label,
    recordType: spec.recordType,
    required: spec.requiredCode !== null,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      if (isBlank(val)) {
        return spec.requiredCode !== null
          ? reject(s, 'RL-REQ-01', spec.requiredCode, `${spec.label} is required.`)
          : pass(s);
      }
      const trimmed = val.trim();
      if (spec.stripCurrency) {
        if (DECIMAL_COMMA_REGEX.test(trimmed)) {
          return reject(s, 'RL-CURRENCY-01', spec.invalidCode, `${spec.label} uses a decimal comma, which is ambiguous.`);
        }
        s.apply('RL-CURRENCY-01', cleanCurrencyDecimal(trimmed).cleaned);
      } else {
        s.apply('RL-TEXT-01', trimmed);
      }
      const parsed = parseScaledDecimal(s.value(), spec.scale);
      if (parsed === null) {
        return reject(s, 'RL-FORMAT-01', spec.invalidCode, `${spec.label} must be a plain decimal with at most ${spec.scale} decimal places.`);
      }
      if (spec.zeroCode !== undefined && (parsed.negative || parsed.units === BigInt(0))) {
        return reject(s, 'RL-FORMAT-01', spec.zeroCode, `${spec.label} must be greater than zero.`);
      }
      if (parsed.negative && parsed.units !== BigInt(0)) {
        return reject(s, 'RL-FORMAT-01', spec.negativeCode, `${spec.label} cannot be negative.`);
      }
      return pass(s);
    },
  };
}

// ── ERP-2 field rules ────────────────────────────────────────────────────────

export const ERP2_FIELD_CLEAN_RULES: readonly FieldCleanRuleConfig[] = [
  // ── Vendors ────────────────────────────────────────────────────────────────
  codeRule({
    field: 'vendor_code',
    recordType: 'vendor',
    label: 'Vendor code',
    requiredCode: 'VENDOR_CODE_REQUIRED',
    tooLong: { max: MAX_VENDOR_CODE_LENGTH, code: 'VENDOR_CODE_TOO_LONG' },
  }),
  {
    field: 'vendor_name',
    label: 'Vendor name',
    recordType: 'vendor',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Vendor name');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', cleanTextWhitespace(s.value()));
      if (isBlank(s.value())) return reject(s, 'RL-REQ-01', 'VENDOR_NAME_REQUIRED', 'Vendor name is required.');
      return pass(s);
    },
  },
  {
    // Trim + upper-case only: separators are kept for storage and stripped only for duplicate matching.
    field: 'tax_number',
    label: 'Tax number',
    recordType: 'vendor',
    required: false,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TAX-01', s.value().trim().toUpperCase());
      if (!isBlank(s.value()) && !TAX_NORMALIZED_REGEX.test(normalizeTaxNumber(s.value()))) {
        return reject(s, 'RL-TAX-01', 'INVALID_TAX_NUMBER', 'Tax number must be 4-32 letters/digits (separators ignored).');
      }
      return pass(s);
    },
  },
  {
    field: 'email',
    label: 'Vendor email',
    recordType: 'vendor',
    required: false,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      if (isBlank(val)) return pass(s);
      const res = cleanEmail(val);
      s.apply('RL-EMAIL-01', res.cleaned);
      if (!res.isValid) return reject(s, 'RL-EMAIL-01', 'INVALID_EMAIL', 'Email is not a valid address.');
      return pass(s);
    },
  },
  currencyRule('vendor', 'Vendor currency'),
  {
    field: 'payment_terms_days',
    label: 'Payment terms (days)',
    recordType: 'vendor',
    required: false,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (isBlank(s.value())) return pass(s);
      if (!INTEGER_REGEX.test(s.value())) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_PAYMENT_TERMS', 'Payment terms must be a whole number of days.');
      }
      const days = Number(s.value());
      if (days < 0 || days > MAX_PAYMENT_TERMS_DAYS) {
        return reject(s, 'RL-FORMAT-01', 'PAYMENT_TERMS_OUT_OF_RANGE', `Payment terms must be between 0 and ${MAX_PAYMENT_TERMS_DAYS} days.`);
      }
      return pass(s);
    },
  },
  // bank_account is intentionally NOT cleaned (sensitive; rows are masked before cleaning).

  // ── Purchase orders ────────────────────────────────────────────────────────
  codeRule({
    field: 'po_number',
    recordType: 'purchase_order',
    label: 'PO number',
    requiredCode: 'PO_NUMBER_REQUIRED',
  }),
  codeRule({
    field: 'po_vendor_code',
    recordType: 'purchase_order',
    label: 'PO vendor code',
    requiredCode: 'PO_VENDOR_REQUIRED',
  }),
  {
    field: 'po_status',
    label: 'PO status',
    recordType: 'purchase_order',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      if (isBlank(val)) return reject(s, 'RL-REQ-01', 'PO_STATUS_REQUIRED', 'PO status is required.');
      const canonical = normalizeStatus(val);
      if (canonical === null) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_PO_STATUS', 'PO status must be Draft, Sent, Received or Closed.');
      }
      s.apply('RL-TEXT-01', canonical);
      return pass(s);
    },
  },
  {
    // Whitespace only; the transition rules themselves are enforced by the ERP2-25 evaluator.
    field: 'status_path',
    label: 'PO status path',
    recordType: 'purchase_order',
    required: false,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().split('>').map((part) => part.trim()).join('>'));
      return pass(s);
    },
  },
  dateRule({ field: 'po_date', label: 'PO order date', requiredCode: 'PO_DATE_REQUIRED' }),
  dateRule({ field: 'expected_date', label: 'PO expected date', requiredCode: null }),
  currencyRule('purchase_order', 'PO currency'),
  decimalRule({
    field: 'po_total',
    recordType: 'purchase_order',
    label: 'PO total',
    scale: 2,
    requiredCode: 'PO_TOTAL_REQUIRED',
    invalidCode: 'INVALID_PO_TOTAL',
    negativeCode: 'INVALID_PO_TOTAL',
    stripCurrency: true,
  }),

  // ── PO lines ───────────────────────────────────────────────────────────────
  codeRule({
    field: 'po_number',
    recordType: 'po_line',
    label: 'Line PO number',
    requiredCode: 'PO_NUMBER_REQUIRED',
  }),
  {
    field: 'line_no',
    label: 'Line number',
    recordType: 'po_line',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (!/^\d+$/.test(s.value()) || Number(s.value()) < 1) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_LINE_NUMBER', 'Line number must be a positive whole number.');
      }
      return pass(s);
    },
  },
  codeRule({
    field: 'product_sku',
    recordType: 'po_line',
    label: 'Product SKU',
    requiredCode: 'SKU_REQUIRED',
  }),
  decimalRule({
    field: 'quantity',
    recordType: 'po_line',
    label: 'Quantity',
    scale: 3,
    requiredCode: 'QUANTITY_REQUIRED',
    invalidCode: 'INVALID_QUANTITY',
    negativeCode: 'QUANTITY_MUST_BE_POSITIVE',
    zeroCode: 'QUANTITY_MUST_BE_POSITIVE',
    stripCurrency: false,
  }),
  decimalRule({
    field: 'unit_price',
    recordType: 'po_line',
    label: 'Unit price',
    scale: 4,
    requiredCode: 'PRICE_REQUIRED',
    invalidCode: 'INVALID_PRICE',
    negativeCode: 'PRICE_MUST_BE_NON_NEGATIVE',
    stripCurrency: true,
  }),
  decimalRule({
    field: 'line_total',
    recordType: 'po_line',
    label: 'Line total',
    scale: 2,
    requiredCode: null,
    invalidCode: 'INVALID_LINE_TOTAL',
    negativeCode: 'INVALID_LINE_TOTAL',
    stripCurrency: true,
  }),
];

/** Default ERP-2 cleaner configuration: all V1 registry rules enabled. */
export const ERP2_CLEANER_CONFIG: CleanerConfig = {
  sourceRowField: 'row_id',
  recordTypeField: 'record_type',
  fields: ERP2_FIELD_CLEAN_RULES,
  enabledRuleIds: V1_CLEANING_RULES.map((r) => r.ruleId),
};

/**
 * Cleans an ERP-2 dataset with the shared engine. Input rows are not mutated; a copy whose
 * bank_account is masked is what gets cleaned, so no raw bank detail can reach the result or audit log.
 */
export function cleanErp2Dataset(
  rows: readonly Record<string, string>[],
  enabledRuleIds?: readonly string[],
): DatasetCleanResult<Record<string, string>> {
  const safeRows = rows.map((row) => {
    const bank = row['bank_account'];
    return { ...row, bank_account: bank ? maskBankAccount(bank) : '' };
  });
  const config: CleanerConfig = {
    ...ERP2_CLEANER_CONFIG,
    enabledRuleIds: enabledRuleIds ?? ERP2_CLEANER_CONFIG.enabledRuleIds,
  };
  return cleanDataset<Record<string, string>>(safeRows, config);
}

/** Formula-safe CSV of the field-level audit log (shared exporter). */
export function exportErp2FieldAuditCsv(audits: readonly FieldChangeAudit[]): string {
  return exportFieldAuditCsv(audits);
}
