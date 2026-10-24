/**
 * ERP-3 Sales Orders & Invoices — Module Cleaning Rules & Field-Level Audit Configuration (ERP3-27 / KIT-04)
 *
 * Configures the shared Migration Kit cleaning engine (`@cs/kit`, SDS §3.4 / §4.4) for ERP-3
 * entities (sales orders, order lines, invoices, invoice lines, payments).
 * Zero duplicate platform infrastructure: standard cleaners (whitespace, control characters,
 * email, ISO date coercion, currency/decimal formatting) and `cleanDataset` from `@cs/kit` execute
 * all cleaning and audit logging.
 *
 * Guarantees:
 *  - Every modified value produces an audit entry: (source_row, field_name, original_value, cleaned_value, rule_id).
 *  - Unrecoverable required-field anomalies reject the row with a structured reason code
 *    (matching the ERP3-25 catalogue: ORDER_NUMBER_REQUIRED, CUSTOMER_GOLDEN_ID_REQUIRED, etc.).
 *  - Formula-injection prefixes are rejected, never silently "cleaned".
 *  - Ambiguous dates (03/04/2026) are never guessed; they are routed to review/rejection.
 *  - Deterministic and exact: zero fuzzy matching, zero automatic destructive merging.
 *  - Raw input rows are never mutated (BR-KIT-03).
 *
 * @module erp3/migration/cleaning-config
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
  INVOICE_STATUSES,
  KNOWN_CUSTOMERS,
  KNOWN_PRODUCTS,
  PAYMENT_METHODS,
  SALES_ORDER_STATUSES,
  isValidCalendarDate,
  isValidUuid,
  parseScaled4DpSigned,
} from './rules.js';

/**
 * V1 registry rules that have no direct ERP-3 target column, and why.
 */
export const ERP3_NOT_APPLICABLE_RULES: Readonly<Record<string, string>> = {
  'RL-EMAIL-01': 'ERP-3 sales orders, order lines, invoices, invoice lines, and payments carry no email column.',
  'RL-PHONE-01': 'ERP-3 sales orders, order lines, invoices, invoice lines, and payments carry no phone column.',
  'RL-NAME-01': 'Customer names are resolved via CRM-1 Golden IDs (BR-ERP3-03); ERP-3 stores no raw personal names.',
  'RL-ADDR-01': 'ERP-3 entities carry no postal address or city columns.',
  'RL-TAX-01': 'Tax registration numbers are managed in ERP-2/CRM-1; ERP-3 stores percentage tax_rate.',
  'RL-DUP-01': 'Exact duplicate detection is owned by the ERP3-25 evaluator and the ERP3-26 profiler.',
};

type Audit = { ruleId: string; original: string; cleaned: string };
type CleanResult = ReturnType<FieldCleanRuleConfig['clean']>;

const CURRENCY_SET: ReadonlySet<string> = new Set<string>(ACCEPTED_CURRENCIES);
const SO_STATUS_SET: ReadonlySet<string> = new Set<string>(SALES_ORDER_STATUSES);
const INV_STATUS_SET: ReadonlySet<string> = new Set<string>(INVOICE_STATUSES);
const PAYMENT_METHOD_SET: ReadonlySet<string> = new Set<string>(PAYMENT_METHODS);
const CUSTOMER_SET: ReadonlySet<string> = new Set<string>(KNOWN_CUSTOMERS);
const PRODUCT_SET: ReadonlySet<string> = new Set<string>(KNOWN_PRODUCTS);

const ORDER_NUMBER_REGEX = /^[A-Za-z0-9_-]+$/;
const INTEGER_REGEX = /^-?\d+$/;
const DECIMAL_COMMA_REGEX = /,\d{1,4}$/;

interface Stepper {
  readonly audits: Audit[];
  value(): string;
  apply(ruleId: string, next: string): void;
}

/**
 * Applies one transformation at a time; records an audit only when the rule is enabled and the value changes.
 */
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

/**
 * Detects spreadsheet formula injection prefix characters (=, +, -, @, \t, \r).
 */
export function hasFormulaPrefix(val: string): boolean {
  return /^[=+\-@\t\r]/.test(val) || /^[=+\-@]/.test(val.trim());
}

/**
 * Formula-injection values are rejected as-is (no audit): they are never "fixed".
 */
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

/**
 * Classifies date raw string format.
 */
export function classifyDate(raw: string): 'empty' | 'iso' | 'ambiguous' | 'invalid' {
  const t = raw.trim();
  if (!t) return 'empty';
  if (isValidCalendarDate(t)) return 'iso';
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(t)) return 'ambiguous';
  return 'invalid';
}

// ── Rule Builders ────────────────────────────────────────────────────────────

interface CodeSpec {
  field: string;
  recordType: string;
  label: string;
  requiredCode: string;
  formatCode?: string;
  tooLong?: { max: number; code: string };
}

/**
 * Business keys (order_number, invoice_number, payment_number): trim, upper-case, required, formula-safe.
 */
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
      if (!ORDER_NUMBER_REGEX.test(s.value())) {
        return reject(
          s,
          'RL-FORMAT-01',
          spec.formatCode ?? 'INVALID_FORMAT',
          `${spec.label} must contain only alphanumeric characters, dashes, or underscores.`
        );
      }
      return pass(s);
    },
  };
}

/**
 * Currency cleaner: trim, upper-case, validate against ACCEPTED_CURRENCIES.
 */
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
        return reject(s, 'RL-REQ-01', 'CURRENCY_REQUIRED', `${label} is required; ClearShift V1 applies no implicit currency default.`);
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
  recordType: string;
  label: string;
  requiredCode: string | null;
  invalidCode?: string;
}

/**
 * Date cleaner: trims, coerces valid slash/hyphen/period dates to ISO YYYY-MM-DD. Rejects ambiguous dates.
 */
function dateRule(spec: DateSpec): FieldCleanRuleConfig {
  return {
    field: spec.field,
    label: spec.label,
    recordType: spec.recordType,
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
      const coerced = cleanIsoDate(t);
      if (coerced.isValid) {
        s.apply('RL-DATE-01', coerced.cleaned);
        return pass(s);
      }
      if (classifyDate(t) === 'ambiguous') {
        return reject(
          s,
          'RL-DATE-01',
          'AMBIGUOUS_DATE_FORMAT_REVIEW',
          `${spec.label} '${t}' is ambiguous (day/month order unknown) and needs a human decision.`
        );
      }
      return reject(
        s,
        'RL-DATE-01',
        spec.invalidCode ?? 'INVALID_DATE',
        `${spec.label} must be a real calendar date (YYYY-MM-DD).`
      );
    },
  };
}

interface DecimalSpec {
  field: string;
  recordType: string;
  label: string;
  requiredCode: string | null;
  invalidCode: string;
  negativeCode: string;
  zeroCode?: string;
  maxPercentage?: boolean;
  stripCurrency: boolean;
}

/**
 * Decimal and monetary cleaner: strips symbols/separators, validates 4dp scale and sign.
 */
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
          return reject(s, 'RL-CURRENCY-01', spec.invalidCode, `${spec.label} uses an ambiguous decimal comma.`);
        }
        s.apply('RL-CURRENCY-01', cleanCurrencyDecimal(trimmed).cleaned);
      } else {
        const noPct = trimmed.replace(/%/g, '').trim();
        s.apply('RL-TEXT-01', noPct);
      }

      const parsedScaled = parseScaled4DpSigned(s.value());
      if (parsedScaled === null) {
        return reject(s, 'RL-FORMAT-01', spec.invalidCode, `${spec.label} must be a valid decimal number with at most 4 decimal places.`);
      }

      if (spec.zeroCode !== undefined && parsedScaled <= BigInt(0)) {
        return reject(s, 'RL-FORMAT-01', spec.zeroCode, `${spec.label} must be strictly greater than zero.`);
      }

      if (parsedScaled < BigInt(0)) {
        return reject(s, 'RL-FORMAT-01', spec.negativeCode, `${spec.label} cannot be negative.`);
      }

      if (spec.maxPercentage && parsedScaled > BigInt(1000000)) {
        return reject(s, 'RL-FORMAT-01', 'TAX_RATE_OUT_OF_RANGE', `${spec.label} cannot exceed 100.0000%.`);
      }

      return pass(s);
    },
  };
}

/**
 * UUID cleaner: trims, lower-cases, validates UUID format and known registry.
 */
function uuidRule(spec: {
  field: string;
  recordType: string;
  label: string;
  requiredCode: string;
  invalidCode: string;
  notFoundCode: string;
  knownSet: ReadonlySet<string>;
}): FieldCleanRuleConfig {
  return {
    field: spec.field,
    label: spec.label,
    recordType: spec.recordType,
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim().toLowerCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', spec.requiredCode, `${spec.label} is required.`);
      }
      if (!isValidUuid(s.value())) {
        return reject(s, 'RL-FORMAT-01', spec.invalidCode, `${spec.label} must be a valid UUID.`);
      }
      if (!spec.knownSet.has(s.value())) {
        return reject(s, 'RL-FORMAT-01', spec.notFoundCode, `${spec.label} not found in master data registry.`);
      }
      return pass(s);
    },
  };
}

// ── ERP-3 Field Cleaning Rules ───────────────────────────────────────────────

export const ERP3_FIELD_CLEAN_RULES: readonly FieldCleanRuleConfig[] = [
  // ── 1. Sales Orders ─────────────────────────────────────────────────────────
  codeRule({
    field: 'order_number',
    recordType: 'sales_order',
    label: 'Order number',
    requiredCode: 'ORDER_NUMBER_REQUIRED',
    formatCode: 'INVALID_ORDER_NUMBER_FORMAT',
    tooLong: { max: 64, code: 'ORDER_NUMBER_TOO_LONG' },
  }),
  uuidRule({
    field: 'customer_golden_id',
    recordType: 'sales_order',
    label: 'Customer Golden ID',
    requiredCode: 'CUSTOMER_GOLDEN_ID_REQUIRED',
    invalidCode: 'INVALID_CUSTOMER_GOLDEN_ID',
    notFoundCode: 'CUSTOMER_NOT_FOUND',
    knownSet: CUSTOMER_SET,
  }),
  dateRule({
    field: 'order_date',
    recordType: 'sales_order',
    label: 'Order date',
    requiredCode: 'ORDER_DATE_REQUIRED',
    invalidCode: 'INVALID_DATE',
  }),
  {
    field: 'order_status',
    label: 'Order status',
    recordType: 'sales_order',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (isBlank(s.value())) return reject(s, 'RL-REQ-01', 'STATUS_REQUIRED', 'Order status is required.');
      const lower = s.value().toLowerCase();
      const canonical = SALES_ORDER_STATUSES.find((x) => x.toLowerCase() === lower);
      if (!canonical) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_STATUS', `Order status must be one of ${SALES_ORDER_STATUSES.join(', ')}.`);
      }
      s.apply('RL-TEXT-01', canonical);
      return pass(s);
    },
  },
  currencyRule('sales_order', 'Order currency'),
  {
    field: 'notes',
    label: 'Order notes',
    recordType: 'sales_order',
    required: false,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Order notes');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', cleanTextWhitespace(s.value()));
      if (s.value().length > 1000) {
        return reject(s, 'RL-FORMAT-01', 'NOTES_TOO_LONG', 'Order notes cannot exceed 1000 characters.');
      }
      return pass(s);
    },
  },

  // ── 2. Sales Order Lines ───────────────────────────────────────────────────
  {
    field: 'parent_source_id',
    label: 'Line parent source ID',
    recordType: 'so_line',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Line parent source ID');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'PARENT_SOURCE_ID_REQUIRED', 'Line parent source ID is required.');
      }
      return pass(s);
    },
  },
  {
    field: 'line_number',
    label: 'Line number',
    recordType: 'so_line',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (!INTEGER_REGEX.test(s.value()) || Number(s.value()) <= 0) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_LINE_NUMBER', 'Line number must be a positive integer.');
      }
      return pass(s);
    },
  },
  uuidRule({
    field: 'product_id',
    recordType: 'so_line',
    label: 'Product ID',
    requiredCode: 'PRODUCT_ID_REQUIRED',
    invalidCode: 'INVALID_PRODUCT_ID',
    notFoundCode: 'PRODUCT_NOT_FOUND',
    knownSet: PRODUCT_SET,
  }),
  decimalRule({
    field: 'quantity',
    recordType: 'so_line',
    label: 'Line quantity',
    requiredCode: 'QUANTITY_REQUIRED',
    invalidCode: 'INVALID_QUANTITY',
    negativeCode: 'NEGATIVE_OR_ZERO_QUANTITY',
    zeroCode: 'NEGATIVE_OR_ZERO_QUANTITY',
    stripCurrency: false,
  }),
  decimalRule({
    field: 'unit_price',
    recordType: 'so_line',
    label: 'Line unit price',
    requiredCode: 'UNIT_PRICE_REQUIRED',
    invalidCode: 'INVALID_UNIT_PRICE',
    negativeCode: 'NEGATIVE_UNIT_PRICE',
    stripCurrency: true,
  }),
  decimalRule({
    field: 'tax_rate',
    recordType: 'so_line',
    label: 'Line tax rate',
    requiredCode: 'TAX_RATE_REQUIRED',
    invalidCode: 'INVALID_TAX_RATE',
    negativeCode: 'INVALID_TAX_RATE',
    maxPercentage: true,
    stripCurrency: false,
  }),

  // ── 3. Invoices ────────────────────────────────────────────────────────────
  codeRule({
    field: 'invoice_number',
    recordType: 'invoice',
    label: 'Invoice number',
    requiredCode: 'INVOICE_NUMBER_REQUIRED',
    formatCode: 'INVALID_INVOICE_NUMBER_FORMAT',
    tooLong: { max: 64, code: 'INVOICE_NUMBER_TOO_LONG' },
  }),
  uuidRule({
    field: 'customer_golden_id',
    recordType: 'invoice',
    label: 'Invoice customer Golden ID',
    requiredCode: 'CUSTOMER_GOLDEN_ID_REQUIRED',
    invalidCode: 'INVALID_CUSTOMER_GOLDEN_ID',
    notFoundCode: 'CUSTOMER_NOT_FOUND',
    knownSet: CUSTOMER_SET,
  }),
  dateRule({
    field: 'invoice_date',
    recordType: 'invoice',
    label: 'Invoice date',
    requiredCode: 'INVOICE_DATE_REQUIRED',
    invalidCode: 'INVALID_DATE',
  }),
  dateRule({
    field: 'due_date',
    recordType: 'invoice',
    label: 'Invoice due date',
    requiredCode: 'DUE_DATE_REQUIRED',
    invalidCode: 'INVALID_DUE_DATE',
  }),
  currencyRule('invoice', 'Invoice currency'),
  {
    field: 'invoice_status',
    label: 'Invoice status',
    recordType: 'invoice',
    required: false,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (isBlank(s.value())) return pass(s);
      const lower = s.value().toLowerCase();
      const canonical = INVOICE_STATUSES.find((x) => x.toLowerCase() === lower);
      if (!canonical) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_STATUS', `Invoice status must be one of ${INVOICE_STATUSES.join(', ')}.`);
      }
      s.apply('RL-TEXT-01', canonical);
      return pass(s);
    },
  },

  // ── 4. Invoice Lines ───────────────────────────────────────────────────────
  {
    field: 'parent_source_id',
    label: 'Invoice line parent source ID',
    recordType: 'invoice_line',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Invoice line parent source ID');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'PARENT_SOURCE_ID_REQUIRED', 'Invoice line parent source ID is required.');
      }
      return pass(s);
    },
  },
  {
    field: 'line_number',
    label: 'Invoice line number',
    recordType: 'invoice_line',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (!INTEGER_REGEX.test(s.value()) || Number(s.value()) <= 0) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_LINE_NUMBER', 'Invoice line number must be a positive integer.');
      }
      return pass(s);
    },
  },
  uuidRule({
    field: 'product_id',
    recordType: 'invoice_line',
    label: 'Invoice line product ID',
    requiredCode: 'PRODUCT_ID_REQUIRED',
    invalidCode: 'INVALID_PRODUCT_ID',
    notFoundCode: 'PRODUCT_NOT_FOUND',
    knownSet: PRODUCT_SET,
  }),
  decimalRule({
    field: 'quantity',
    recordType: 'invoice_line',
    label: 'Invoice line quantity',
    requiredCode: 'QUANTITY_REQUIRED',
    invalidCode: 'INVALID_QUANTITY',
    negativeCode: 'NEGATIVE_OR_ZERO_QUANTITY',
    zeroCode: 'NEGATIVE_OR_ZERO_QUANTITY',
    stripCurrency: false,
  }),
  decimalRule({
    field: 'unit_price',
    recordType: 'invoice_line',
    label: 'Invoice line unit price',
    requiredCode: 'UNIT_PRICE_REQUIRED',
    invalidCode: 'INVALID_UNIT_PRICE',
    negativeCode: 'NEGATIVE_UNIT_PRICE',
    stripCurrency: true,
  }),
  decimalRule({
    field: 'tax_rate',
    recordType: 'invoice_line',
    label: 'Invoice line tax rate',
    requiredCode: 'TAX_RATE_REQUIRED',
    invalidCode: 'INVALID_TAX_RATE',
    negativeCode: 'INVALID_TAX_RATE',
    maxPercentage: true,
    stripCurrency: false,
  }),

  // ── 5. Payments ────────────────────────────────────────────────────────────
  codeRule({
    field: 'payment_number',
    recordType: 'payment',
    label: 'Payment number',
    requiredCode: 'PAYMENT_NUMBER_REQUIRED',
    formatCode: 'INVALID_PAYMENT_NUMBER_FORMAT',
    tooLong: { max: 64, code: 'PAYMENT_NUMBER_TOO_LONG' },
  }),
  {
    field: 'parent_source_id',
    label: 'Payment target invoice source ID',
    recordType: 'payment',
    required: true,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Payment target invoice source ID');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'PARENT_SOURCE_ID_REQUIRED', 'Payment target invoice source ID is required.');
      }
      return pass(s);
    },
  },
  dateRule({
    field: 'payment_date',
    recordType: 'payment',
    label: 'Payment date',
    requiredCode: 'PAYMENT_DATE_REQUIRED',
    invalidCode: 'INVALID_DATE',
  }),
  decimalRule({
    field: 'payment_amount',
    recordType: 'payment',
    label: 'Payment amount',
    requiredCode: 'PAYMENT_AMOUNT_REQUIRED',
    invalidCode: 'INVALID_PAYMENT_AMOUNT',
    negativeCode: 'NEGATIVE_OR_ZERO_PAYMENT_AMOUNT',
    zeroCode: 'NEGATIVE_OR_ZERO_PAYMENT_AMOUNT',
    stripCurrency: true,
  }),
  {
    field: 'payment_method',
    label: 'Payment method',
    recordType: 'payment',
    required: true,
    clean: (val, _row, enabled) => {
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-01', s.value().trim().toLowerCase());
      if (isBlank(s.value())) {
        return reject(s, 'RL-REQ-01', 'PAYMENT_METHOD_REQUIRED', 'Payment method is required.');
      }
      if (!PAYMENT_METHOD_SET.has(s.value() as any)) {
        return reject(s, 'RL-FORMAT-01', 'INVALID_PAYMENT_METHOD', `Payment method must be one of ${PAYMENT_METHODS.join(', ')}.`);
      }
      return pass(s);
    },
  },
  {
    field: 'payment_reference',
    label: 'Payment reference',
    recordType: 'payment',
    required: false,
    clean: (val, _row, enabled) => {
      const injected = formulaReject(val, 'Payment reference');
      if (injected) return injected;
      const s = stepper(val, enabled);
      s.apply('RL-TEXT-02', cleanControlCharacters(s.value()));
      s.apply('RL-TEXT-01', cleanTextWhitespace(s.value()));
      if (s.value().length > 128) {
        return reject(s, 'RL-FORMAT-01', 'PAYMENT_REFERENCE_TOO_LONG', 'Payment reference cannot exceed 128 characters.');
      }
      return pass(s);
    },
  },
];

/**
 * Canonical ERP-3 cleaner configuration: all 12 V1 cleaning rules enabled by default.
 */
export const ERP3_CLEANER_CONFIG: CleanerConfig = {
  sourceRowField: 'row_id',
  recordTypeField: 'record_type',
  fields: ERP3_FIELD_CLEAN_RULES,
  enabledRuleIds: V1_CLEANING_RULES.map((r) => r.ruleId),
};

/**
 * Cleans an ERP-3 dataset using the shared `@cs/kit` cleaning engine.
 * Input rows are never mutated (BR-KIT-03).
 */
export function cleanErp3Dataset(
  rows: readonly Record<string, string>[],
  enabledRuleIds?: readonly string[],
): DatasetCleanResult<Record<string, string>> {
  const config: CleanerConfig = {
    ...ERP3_CLEANER_CONFIG,
    enabledRuleIds: enabledRuleIds ?? ERP3_CLEANER_CONFIG.enabledRuleIds,
  };
  return cleanDataset<Record<string, string>>(rows, config);
}

/**
 * Exports field change audits to a formula-safe CSV string.
 */
export function exportErp3FieldAuditCsv(audits: readonly FieldChangeAudit[]): string {
  return exportFieldAuditCsv(audits);
}
