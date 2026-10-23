/**
 * ERP-2 Vendors & Purchasing — Canonical Dirty Data Pack: rules, parser, evaluator, profiler.
 *
 * Deterministic, dependency-free evaluation of the committed synthetic fixture
 * (`sample-data/erp-2/dirty-data-v1.csv`) against the ERP-2 data-quality rule catalogue.
 *
 * Design guarantees:
 *  - Exact, deterministic matching only (no fuzzy scoring, no automatic merge).
 *  - Raw input rows are never mutated; normalisation produces new objects.
 *  - Money is handled with BigInt fixed-point arithmetic (no floating point).
 *    Documented rounding: line total = ROUND_HALF_UP(quantity x unit_price, 2 dp);
 *    PO total = sum of the rounded line totals.
 *  - Sensitive fields (bank account) are masked in `masked_data`.
 *  - OWASP formula-injection prefixes are rejected on free-text fields.
 *
 * Parent / child reference rule: a child row (PO -> vendor, line -> PO) is loadable only if its
 * parent row is an *accepted* row (this batch). Rejected or held-for-review parents are therefore
 * reported to the child as `*_NOT_FOUND` and the child must be re-submitted after the parent is fixed.
 *
 * @module erp2/migration/dirty-data-plan
 */

import { createHash } from 'node:crypto';

export const RULES_VERSION = '1.0.0';
export const FIXTURE_SCHEMA_VERSION = 1;
export const PROFILE_SCHEMA_VERSION = 1;
export const FIXTURE_PATH = 'sample-data/erp-2/dirty-data-v1.csv';
export const SOURCE_SYSTEM = 'SYNTH-ERP2-DIRTY-V1';

export const ACCEPTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'] as const;
export const PO_STATUSES = ['Draft', 'Sent', 'Received', 'Closed'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const MAX_VENDOR_CODE_LENGTH = 64;
export const MAX_PAYMENT_TERMS_DAYS = 365;
export const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'] as const;

/** Frozen snapshot of the ERP-1 product catalogue that PO lines may reference (FK check). */
export const ERP1_REFERENCE_SKUS = [
  'SKU-GEN-0001',
  'SKU-GEN-0002',
  'SKU-GEN-0003',
  'SKU-ELEC-0001',
  'SKU-ELEC-0002',
  'SKU-CHEM-0001',
  'SKU-RAW-0001',
  'SKU-RAW-0002',
  'SKU-PKG-0001',
  'SKU-PKG-0002',
  'SKU-TOOLS-0001',
  'SKU-TOOLS-0002',
] as const;

export const LOAD_ORDER = ['vendor', 'purchase_order', 'po_line'] as const;
export type RecordType = (typeof LOAD_ORDER)[number];

export const FIXTURE_COLUMNS = [
  'row_id',
  'record_type',
  'case_tags',
  'source_id',
  'vendor_code',
  'vendor_name',
  'tax_number',
  'email',
  'currency',
  'payment_terms_days',
  'bank_account',
  'po_number',
  'po_vendor_code',
  'po_status',
  'status_path',
  'po_date',
  'expected_date',
  'po_total',
  'line_no',
  'product_sku',
  'quantity',
  'unit_price',
  'line_total',
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
  record_type: string;
  source_id: string;
  outcome: TerminalOutcome;
  reason_codes: string[];
  normalized_data: Record<string, unknown>;
  masked_data: Record<string, unknown>;
  rule_ids: string[];
}

export interface DataQualityRule {
  rule_id: string;
  version: string;
  record_type: RecordType | 'all';
  field: string;
  condition: string;
  action: 'normalize' | 'reject' | 'review' | 'skip';
  reason_code: string | null;
  explanation: string;
  doc_reference: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule catalogue
// ─────────────────────────────────────────────────────────────────────────────

const rule = (
  rule_id: string,
  record_type: DataQualityRule['record_type'],
  field: string,
  condition: string,
  action: DataQualityRule['action'],
  reason_code: string | null,
  explanation: string,
  doc_reference: string,
): DataQualityRule => ({
  rule_id,
  version: RULES_VERSION,
  record_type,
  field,
  condition,
  action,
  reason_code,
  explanation,
  doc_reference,
});

const VENDOR_REF = 'SDS-ERP2: vendor master ownership';
const PO_REF = 'SDS-ERP2: purchase orders';
const STATUS_REF = 'SDS-ERP2: explicit PO status transitions';
const FK_REF = 'SDS-ERP2: PO line references an ERP-1 product';
const MONEY_REF = 'SDS-ERP2: decimal totals with documented rounding';
const BANK_REF = 'SDS-ERP2: bank details masked server-side';

export const RULE_CATALOGUE: DataQualityRule[] = [
  // ── Normalisation (no reason code; recorded in rule_ids) ───────────────────
  rule('NRM-001', 'all', 'vendor_code|po_number|po_vendor_code|product_sku', 'natural key has padding or lower-case characters', 'normalize', null, 'Natural keys are trimmed and upper-cased before matching.', VENDOR_REF),
  rule('NRM-002', 'purchase_order', 'po_status', 'status has padding or non-canonical casing', 'normalize', null, 'Status is trimmed and mapped to canonical casing (Draft, Sent, Received, Closed).', STATUS_REF),
  rule('NRM-003', 'vendor', 'tax_number', 'tax number has padding, spaces, hyphens or lower-case characters', 'normalize', null, 'Tax numbers are upper-cased and stripped of spaces and hyphens before matching.', VENDOR_REF),

  // ── General ────────────────────────────────────────────────────────────────
  rule('GEN-001', 'all', 'free-text fields', 'value starts with =, +, -, @, tab or carriage return', 'reject', 'FORMULA_INJECTION_DETECTED', 'Spreadsheet formula injection prefix detected (OWASP); value is never loaded or exported.', 'PLT-12 / KIT-16'),
  rule('GEN-002', 'all', 'currency', 'currency is empty', 'reject', 'CURRENCY_REQUIRED', 'Currency is explicit on every vendor and purchase order; there is no implicit default.', MONEY_REF),
  rule('GEN-003', 'all', 'currency', 'currency is not one of USD, EUR, GBP, INR', 'reject', 'INVALID_CURRENCY', 'Currency must be an accepted upper-case ISO-4217 code.', MONEY_REF),
  rule('GEN-004', 'all', 'po_number', 'po_number is empty or whitespace', 'reject', 'PO_NUMBER_REQUIRED', 'Purchase order number is required on purchase order and line rows.', PO_REF),
  rule('GEN-005', 'all', 'record_type', 'record_type is not vendor, purchase_order or po_line', 'skip', 'UNSUPPORTED_RECORD_TYPE', 'Row is outside the ERP-2 entity set and is skipped, never loaded.', PO_REF),

  // ── Vendors ────────────────────────────────────────────────────────────────
  rule('VND-001', 'vendor', 'vendor_code', 'vendor_code is empty or whitespace', 'reject', 'VENDOR_CODE_REQUIRED', 'Vendor code is the natural key and is required.', VENDOR_REF),
  rule('VND-002', 'vendor', 'vendor_code', 'vendor_code length > 64 characters', 'reject', 'VENDOR_CODE_TOO_LONG', 'Vendor code exceeds the maximum length of 64 characters.', VENDOR_REF),
  rule('VND-003', 'vendor', 'vendor_name', 'vendor_name is empty or whitespace', 'reject', 'VENDOR_NAME_REQUIRED', 'Vendor name is required.', VENDOR_REF),
  rule('VND-004', 'vendor', 'tax_number', 'normalized tax number is not 5-20 letters/digits', 'reject', 'INVALID_TAX_NUMBER', 'Tax number is optional but must be well formed when supplied.', VENDOR_REF),
  rule('VND-005', 'vendor', 'email', 'email is not a valid address', 'reject', 'INVALID_EMAIL', 'Email is optional but must be a valid address when supplied.', VENDOR_REF),
  rule('VND-006', 'vendor', 'payment_terms_days', 'payment terms is not an integer', 'reject', 'INVALID_PAYMENT_TERMS', 'Payment terms must be a whole number of days.', VENDOR_REF),
  rule('VND-007', 'vendor', 'payment_terms_days', 'payment terms < 0 or > 365', 'reject', 'PAYMENT_TERMS_OUT_OF_RANGE', 'Payment terms must be between 0 and 365 days inclusive.', VENDOR_REF),
  rule('VND-008', 'vendor', 'bank_account', 'bank account does not match the synthetic IBAN pattern', 'reject', 'INVALID_BANK_DETAILS', 'Bank details are malformed; account numbers are masked in all review and export output.', BANK_REF),
  rule('VND-009', 'vendor', 'vendor_code', 'normalized vendor code already accepted in batch', 'review', 'DUPLICATE_VENDOR_CODE_REVIEW', 'Exact duplicate vendor code; held for human review, never merged automatically.', VENDOR_REF),
  rule('VND-010', 'vendor', 'tax_number', 'normalized tax number already accepted in batch', 'review', 'DUPLICATE_TAX_NUMBER_REVIEW', 'Exact duplicate tax number; held for human review, never merged automatically.', VENDOR_REF),

  // ── Purchase orders ────────────────────────────────────────────────────────
  rule('PO-001', 'purchase_order', 'po_vendor_code', 'po_vendor_code is empty or whitespace', 'reject', 'PO_VENDOR_REQUIRED', 'A purchase order must reference a vendor.', PO_REF),
  rule('PO-002', 'purchase_order', 'po_vendor_code', 'referenced vendor is not an accepted vendor', 'reject', 'VENDOR_NOT_FOUND', 'Foreign key missing: the vendor does not exist or was not accepted.', PO_REF),
  rule('PO-003', 'purchase_order', 'po_status', 'po_status is empty', 'reject', 'PO_STATUS_REQUIRED', 'Purchase order status is required.', STATUS_REF),
  rule('PO-004', 'purchase_order', 'po_status', 'po_status is not Draft, Sent, Received or Closed', 'reject', 'INVALID_PO_STATUS', 'Status must be one of Draft, Sent, Received, Closed.', STATUS_REF),
  rule('PO-005', 'purchase_order', 'status_path', 'path does not start at Draft, skips a step, or does not end at po_status', 'reject', 'INVALID_STATUS_TRANSITION', 'Transitions are explicit: Draft -> Sent -> Received -> Closed.', STATUS_REF),
  rule('PO-006', 'purchase_order', 'po_date', 'po_date is empty', 'reject', 'PO_DATE_REQUIRED', 'Order date is required.', PO_REF),
  rule('PO-007', 'purchase_order', 'po_date|expected_date', 'date is not a real calendar date in YYYY-MM-DD', 'reject', 'INVALID_DATE', 'Dates must be real calendar dates in ISO YYYY-MM-DD format.', PO_REF),
  rule('PO-008', 'purchase_order', 'expected_date', 'expected_date is earlier than po_date', 'reject', 'EXPECTED_DATE_BEFORE_ORDER_DATE', 'Expected delivery cannot precede the order date.', PO_REF),
  rule('PO-009', 'purchase_order', 'currency', 'PO currency differs from the vendor currency', 'reject', 'CURRENCY_MISMATCH', 'Purchase order currency must equal the vendor currency.', MONEY_REF),
  rule('PO-010', 'purchase_order', 'po_number', 'no valid, loadable line references the PO', 'reject', 'EMPTY_ORDER_LINES', 'A purchase order must have at least one valid line.', PO_REF),
  rule('PO-011', 'purchase_order', 'po_total', 'po_total is empty', 'reject', 'PO_TOTAL_REQUIRED', 'Purchase order total is required.', MONEY_REF),
  rule('PO-012', 'purchase_order', 'po_total', 'po_total is not a non-negative decimal with at most 2 places', 'reject', 'INVALID_PO_TOTAL', 'Purchase order total must be a non-negative decimal with at most 2 decimal places.', MONEY_REF),
  rule('PO-013', 'purchase_order', 'po_total', 'po_total differs from the sum of rounded valid line totals', 'reject', 'PO_TOTAL_MISMATCH', 'Total must equal the sum of ROUND_HALF_UP(quantity x unit_price, 2) over valid lines.', MONEY_REF),
  rule('PO-014', 'purchase_order', 'po_date', 'po_date is DD/MM/YYYY-style and day/month order is ambiguous', 'review', 'AMBIGUOUS_DATE_FORMAT_REVIEW', 'Non-ISO date with ambiguous day/month order; held for human review.', PO_REF),
  rule('PO-015', 'purchase_order', 'po_number', 'normalized PO number already accepted in batch', 'review', 'DUPLICATE_PO_NUMBER_REVIEW', 'Exact duplicate PO number; held for human review, never merged automatically.', PO_REF),

  // ── Purchase order lines ───────────────────────────────────────────────────
  rule('LIN-001', 'po_line', 'po_number', 'referenced purchase order is not an accepted PO', 'reject', 'PO_NOT_FOUND', 'Foreign key missing: the purchase order does not exist or was not accepted.', PO_REF),
  rule('LIN-002', 'po_line', 'line_no', 'line_no is not a positive integer', 'reject', 'INVALID_LINE_NUMBER', 'Line number must be an integer >= 1.', PO_REF),
  rule('LIN-003', 'po_line', 'product_sku', 'product_sku is empty or whitespace', 'reject', 'SKU_REQUIRED', 'Every PO line must reference a product SKU.', FK_REF),
  rule('LIN-004', 'po_line', 'product_sku', 'normalized SKU is not in the ERP-1 catalogue', 'reject', 'UNKNOWN_PRODUCT', 'Foreign key missing: the product does not exist in ERP-1.', FK_REF),
  rule('LIN-005', 'po_line', 'quantity', 'quantity is empty', 'reject', 'QUANTITY_REQUIRED', 'Quantity is required.', MONEY_REF),
  rule('LIN-006', 'po_line', 'quantity', 'quantity is not a decimal with at most 3 places', 'reject', 'INVALID_QUANTITY', 'Quantity must be a decimal with at most 3 decimal places.', MONEY_REF),
  rule('LIN-007', 'po_line', 'quantity', 'quantity <= 0', 'reject', 'QUANTITY_MUST_BE_POSITIVE', 'Quantity must be strictly greater than zero.', MONEY_REF),
  rule('LIN-008', 'po_line', 'unit_price', 'unit_price is empty', 'reject', 'PRICE_REQUIRED', 'Unit price is required.', MONEY_REF),
  rule('LIN-009', 'po_line', 'unit_price', 'unit_price is not a decimal with at most 4 places', 'reject', 'INVALID_PRICE', 'Unit price must be a decimal with at most 4 decimal places.', MONEY_REF),
  rule('LIN-010', 'po_line', 'unit_price', 'unit_price < 0', 'reject', 'PRICE_MUST_BE_NON_NEGATIVE', 'Unit price must be zero or greater.', MONEY_REF),
  rule('LIN-011', 'po_line', 'line_total', 'supplied line_total differs from ROUND_HALF_UP(quantity x unit_price, 2)', 'reject', 'LINE_TOTAL_MISMATCH', 'Supplied line total does not match the computed decimal value.', MONEY_REF),
  rule('LIN-012', 'po_line', 'po_number|line_no', 'normalized (po_number, line_no) already accepted in batch', 'review', 'DUPLICATE_LINE_REVIEW', 'Exact duplicate line key; held for human review, never merged automatically.', PO_REF),
];

const RULE_BY_REASON: ReadonlyMap<string, DataQualityRule> = new Map(
  RULE_CATALOGUE.filter((r) => r.reason_code !== null).map((r) => [r.reason_code as string, r]),
);

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** RFC-4180 compatible record splitter (quoted fields, escaped quotes, CRLF/LF). */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  const endRecord = (): void => {
    record.push(field);
    field = '';
    if (record.length > 1 || record[0] !== '') records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
    } else {
      field += ch;
    }
  }
  if (field !== '' || record.length > 0) endRecord();
  return records;
}

export function parseCsv(csvText: string): RawRow[] {
  const records = parseCsvRecords(csvText);
  if (records.length <= 1) return [];
  const header = records[0]!.map((h) => h.trim());
  return records.slice(1).map((rec) => {
    const row: Record<string, string> = {};
    header.forEach((h, idx) => {
      row[h] = rec[idx] ?? '';
    });
    return row as RawRow;
  });
}

export const normalizeCode = (raw: string): string => raw.trim().toUpperCase();
export const normalizePoNumber = normalizeCode;
export const normalizeSku = normalizeCode;
export const normalizeTaxNumber = (raw: string): string => raw.trim().toUpperCase().replace(/[\s-]/g, '');
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

export function normalizeStatus(raw: string): PoStatus | null {
  const key = raw.trim().toLowerCase();
  return PO_STATUSES.find((s) => s.toLowerCase() === key) ?? null;
}

export function hasFormulaPrefix(raw: string): boolean {
  if (raw.length === 0) return false;
  if ((FORMULA_PREFIXES as readonly string[]).includes(raw[0]!)) return true;
  const trimmed = raw.trimStart();
  return trimmed.length > 0 && (FORMULA_PREFIXES as readonly string[]).includes(trimmed[0]!);
}

/** Keeps the last 4 letters/digits visible and masks every other letter/digit. */
export function maskBankAccount(raw: string): string {
  let keep = 4;
  return [...raw.trim()]
    .reverse()
    .map((c) => {
      if (!/[A-Za-z0-9]/.test(c)) return c;
      if (keep > 0) {
        keep--;
        return c;
      }
      return '*';
    })
    .reverse()
    .join('');
}

export function maskSensitiveFields(row: RawRow): Record<string, unknown> {
  const masked: Record<string, unknown> = { ...row };
  if (row.bank_account.trim()) masked['bank_account'] = maskBankAccount(row.bank_account);
  return masked;
}

// ── Decimal arithmetic (BigInt fixed point) ──────────────────────────────────

export interface ScaledDecimal {
  negative: boolean;
  units: bigint;
}

/** Parses a plain decimal with at most `scale` fractional digits into integer units of 10^-scale. */
export function parseScaledDecimal(raw: string, scale: number): ScaledDecimal | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw.trim());
  if (!m) return null;
  const frac = m[3] ?? '';
  if (frac.length > scale) return null;
  return { negative: m[1] === '-', units: BigInt(m[2]! + frac.padEnd(scale, '0')) };
}

const HALF_UNIT = BigInt(50000);
const ROUND_DIVISOR = BigInt(100000);

/** quantity (3 dp units) x unit price (4 dp units) -> cents, ROUND_HALF_UP. */
export function computeLineTotalMinor(quantityUnits: bigint, priceUnits: bigint): bigint {
  return (quantityUnits * priceUnits + HALF_UNIT) / ROUND_DIVISOR;
}

export function formatMinor(minor: bigint): string {
  const s = minor.toString().padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

// ── Dates ────────────────────────────────────────────────────────────────────

export type DateClass = 'empty' | 'iso' | 'ambiguous' | 'invalid';

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidIsoDate(raw: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function classifyDate(raw: string): DateClass {
  const t = raw.trim();
  if (!t) return 'empty';
  if (isValidIsoDate(t)) return 'iso';
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(t)) return 'ambiguous';
  return 'invalid';
}

// ── Status path ──────────────────────────────────────────────────────────────

export function isValidStatusPath(path: string, finalStatus: PoStatus): boolean {
  const steps = path.split('>').map(normalizeStatus);
  if (steps.some((s) => s === null)) return false;
  const statuses = steps as PoStatus[];
  if (statuses[0] !== 'Draft') return false;
  for (let i = 1; i < statuses.length; i++) {
    if (PO_STATUSES.indexOf(statuses[i]!) !== PO_STATUSES.indexOf(statuses[i - 1]!) + 1) return false;
  }
  return statuses[statuses.length - 1] === finalStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BANK_RE = /^CH93-0000-0000-0000-\d{4}-\d$/;
const REFERENCE_SKU_SET: ReadonlySet<string> = new Set(ERP1_REFERENCE_SKUS);

interface LineCheck {
  reasons: string[];
  poNumber: string;
  lineNo: number | null;
  totalMinor: bigint | null;
}

interface PoAggregate {
  count: number;
  totalMinor: bigint;
}

interface Context {
  vendors: Map<string, string>; // normalized vendor code -> currency
  taxNumbers: Set<string>;
  purchaseOrders: Set<string>;
  lineKeys: Set<string>;
  poAggregates: Map<string, PoAggregate>;
  lineChecks: Map<RawRow, LineCheck>;
}

/** Line checks that do not depend on any parent row. */
function checkLineIntrinsic(row: RawRow): LineCheck {
  const reasons: string[] = [];
  let lineNo: number | null = null;

  const lineNoRaw = row.line_no.trim();
  if (!/^\d+$/.test(lineNoRaw) || Number(lineNoRaw) < 1) reasons.push('INVALID_LINE_NUMBER');
  else lineNo = Number(lineNoRaw);

  const sku = normalizeSku(row.product_sku);
  if (!sku) reasons.push('SKU_REQUIRED');
  else if (hasFormulaPrefix(row.product_sku)) reasons.push('FORMULA_INJECTION_DETECTED');
  else if (!REFERENCE_SKU_SET.has(sku)) reasons.push('UNKNOWN_PRODUCT');

  let quantityUnits: bigint | null = null;
  const qtyRaw = row.quantity.trim();
  if (!qtyRaw) {
    reasons.push('QUANTITY_REQUIRED');
  } else {
    const q = parseScaledDecimal(qtyRaw, 3);
    if (!q) reasons.push('INVALID_QUANTITY');
    else if (q.negative || q.units === BigInt(0)) reasons.push('QUANTITY_MUST_BE_POSITIVE');
    else quantityUnits = q.units;
  }

  let priceUnits: bigint | null = null;
  const priceRaw = row.unit_price.trim();
  if (!priceRaw) {
    reasons.push('PRICE_REQUIRED');
  } else {
    const p = parseScaledDecimal(priceRaw, 4);
    if (!p) reasons.push('INVALID_PRICE');
    else if (p.negative) reasons.push('PRICE_MUST_BE_NON_NEGATIVE');
    else priceUnits = p.units;
  }

  let totalMinor: bigint | null = null;
  if (quantityUnits !== null && priceUnits !== null) {
    totalMinor = computeLineTotalMinor(quantityUnits, priceUnits);
    const suppliedRaw = row.line_total.trim();
    if (suppliedRaw) {
      const supplied = parseScaledDecimal(suppliedRaw, 2);
      if (!supplied || supplied.negative || supplied.units !== totalMinor) reasons.push('LINE_TOTAL_MISMATCH');
    }
  }

  return { reasons, poNumber: normalizePoNumber(row.po_number), lineNo, totalMinor };
}

/** Sum of rounded totals over intrinsically valid lines; first occurrence of a (po, line_no) key wins. */
function aggregateLines(rows: RawRow[], checks: Map<RawRow, LineCheck>): Map<string, PoAggregate> {
  const seen = new Set<string>();
  const out = new Map<string, PoAggregate>();
  for (const row of rows) {
    const check = checks.get(row);
    if (!check || check.reasons.length > 0 || !check.poNumber) continue;
    const key = `${check.poNumber}#${check.lineNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const agg = out.get(check.poNumber) ?? { count: 0, totalMinor: BigInt(0) };
    agg.count += 1;
    agg.totalMinor += check.totalMinor ?? BigInt(0);
    out.set(check.poNumber, agg);
  }
  return out;
}

interface Verdict {
  reasons: string[];
  normalized: Record<string, unknown>;
}

function evaluateVendor(row: RawRow, ctx: Context): Verdict {
  const reasons: string[] = [];
  let injected = false;
  const inject = (value: string): boolean => {
    const hit = hasFormulaPrefix(value);
    if (hit && !injected) {
      injected = true;
      reasons.push('FORMULA_INJECTION_DETECTED');
    }
    return hit;
  };

  const code = normalizeCode(row.vendor_code);
  if (!code) reasons.push('VENDOR_CODE_REQUIRED');
  else if (!inject(row.vendor_code) && code.length > MAX_VENDOR_CODE_LENGTH) reasons.push('VENDOR_CODE_TOO_LONG');

  const name = row.vendor_name.trim();
  if (!name) reasons.push('VENDOR_NAME_REQUIRED');
  else inject(row.vendor_name);

  const tax = normalizeTaxNumber(row.tax_number);
  if (tax && !inject(row.tax_number) && !/^[A-Z0-9]{5,20}$/.test(tax)) reasons.push('INVALID_TAX_NUMBER');

  const email = normalizeEmail(row.email);
  if (email && !inject(row.email) && !EMAIL_RE.test(email)) reasons.push('INVALID_EMAIL');

  const currency = row.currency.trim();
  if (!currency) reasons.push('CURRENCY_REQUIRED');
  else if (!(ACCEPTED_CURRENCIES as readonly string[]).includes(currency)) reasons.push('INVALID_CURRENCY');

  const terms = row.payment_terms_days.trim();
  if (terms) {
    if (!/^-?\d+$/.test(terms)) reasons.push('INVALID_PAYMENT_TERMS');
    else if (Number(terms) < 0 || Number(terms) > MAX_PAYMENT_TERMS_DAYS) reasons.push('PAYMENT_TERMS_OUT_OF_RANGE');
  }

  const bank = row.bank_account.trim();
  if (bank && !BANK_RE.test(bank)) reasons.push('INVALID_BANK_DETAILS');

  if (reasons.length === 0) {
    if (ctx.vendors.has(code)) reasons.push('DUPLICATE_VENDOR_CODE_REVIEW');
    if (tax && ctx.taxNumbers.has(tax)) reasons.push('DUPLICATE_TAX_NUMBER_REVIEW');
  }

  return {
    reasons,
    normalized: {
      vendor_code: code,
      vendor_name: name,
      tax_number: tax || null,
      email: email || null,
      currency,
      payment_terms_days: terms ? Number(terms) : null,
    },
  };
}

function evaluatePurchaseOrder(row: RawRow, ctx: Context): Verdict {
  const reasons: string[] = [];
  const poNumber = normalizePoNumber(row.po_number);
  if (!poNumber) reasons.push('PO_NUMBER_REQUIRED');

  const vendorCode = normalizeCode(row.po_vendor_code);
  let vendorCurrency: string | undefined;
  if (!vendorCode) {
    reasons.push('PO_VENDOR_REQUIRED');
  } else {
    vendorCurrency = ctx.vendors.get(vendorCode);
    if (vendorCurrency === undefined) reasons.push('VENDOR_NOT_FOUND');
  }

  const status = normalizeStatus(row.po_status);
  if (!row.po_status.trim()) reasons.push('PO_STATUS_REQUIRED');
  else if (status === null) reasons.push('INVALID_PO_STATUS');
  else if (row.status_path.trim() && !isValidStatusPath(row.status_path, status)) reasons.push('INVALID_STATUS_TRANSITION');

  const orderClass = classifyDate(row.po_date);
  if (orderClass === 'empty') reasons.push('PO_DATE_REQUIRED');
  else if (orderClass === 'invalid') reasons.push('INVALID_DATE');

  const expectedRaw = row.expected_date.trim();
  if (expectedRaw) {
    if (!isValidIsoDate(expectedRaw)) reasons.push('INVALID_DATE');
    else if (orderClass === 'iso' && expectedRaw < row.po_date.trim()) reasons.push('EXPECTED_DATE_BEFORE_ORDER_DATE');
  }

  const currency = row.currency.trim();
  if (!currency) reasons.push('CURRENCY_REQUIRED');
  else if (!(ACCEPTED_CURRENCIES as readonly string[]).includes(currency)) reasons.push('INVALID_CURRENCY');
  else if (vendorCurrency !== undefined && vendorCurrency !== currency) reasons.push('CURRENCY_MISMATCH');

  if (poNumber) {
    const agg = ctx.poAggregates.get(poNumber);
    if (!agg) reasons.push('EMPTY_ORDER_LINES');
    const totalRaw = row.po_total.trim();
    if (!totalRaw) {
      reasons.push('PO_TOTAL_REQUIRED');
    } else {
      const total = parseScaledDecimal(totalRaw, 2);
      if (!total || total.negative) reasons.push('INVALID_PO_TOTAL');
      else if (agg && total.units !== agg.totalMinor) reasons.push('PO_TOTAL_MISMATCH');
    }
  }

  if (reasons.length === 0) {
    if (orderClass === 'ambiguous') reasons.push('AMBIGUOUS_DATE_FORMAT_REVIEW');
    if (ctx.purchaseOrders.has(poNumber)) reasons.push('DUPLICATE_PO_NUMBER_REVIEW');
  }

  return {
    reasons,
    normalized: {
      po_number: poNumber,
      vendor_code: vendorCode,
      status,
      currency,
      po_date: orderClass === 'iso' ? row.po_date.trim() : null,
      expected_date: expectedRaw || null,
      po_total: row.po_total.trim() || null,
    },
  };
}

function evaluatePoLine(row: RawRow, ctx: Context): Verdict {
  const reasons: string[] = [];
  const check = ctx.lineChecks.get(row) ?? checkLineIntrinsic(row);
  if (!check.poNumber) reasons.push('PO_NUMBER_REQUIRED');
  reasons.push(...check.reasons);
  if (check.poNumber && !ctx.purchaseOrders.has(check.poNumber)) reasons.push('PO_NOT_FOUND');
  if (reasons.length === 0 && ctx.lineKeys.has(`${check.poNumber}#${check.lineNo}`)) reasons.push('DUPLICATE_LINE_REVIEW');

  return {
    reasons,
    normalized: {
      po_number: check.poNumber,
      line_no: check.lineNo,
      product_sku: normalizeSku(row.product_sku),
      quantity: row.quantity.trim() || null,
      unit_price: row.unit_price.trim() || null,
      line_total: check.totalMinor === null ? null : formatMinor(check.totalMinor),
    },
  };
}

function normalizationRuleIds(row: RawRow): string[] {
  const ids: string[] = [];
  const keys: FixtureColumn[] = ['vendor_code', 'po_number', 'po_vendor_code', 'product_sku'];
  if (keys.some((k) => row[k] !== '' && row[k] !== normalizeCode(row[k]))) ids.push('NRM-001');
  if (row.po_status !== '' && normalizeStatus(row.po_status) !== null && row.po_status !== normalizeStatus(row.po_status)) {
    ids.push('NRM-002');
  }
  if (row.tax_number !== '' && row.tax_number !== normalizeTaxNumber(row.tax_number)) ids.push('NRM-003');
  return ids;
}

function toOutcome(reasons: string[]): TerminalOutcome {
  const actions = reasons.map((r) => RULE_BY_REASON.get(r)?.action);
  if (actions.includes('reject')) return 'rejected';
  if (actions.includes('review')) return 'review';
  return 'accepted';
}

/**
 * Evaluates every row. Rows are processed in load order (vendors, purchase orders, lines) so that
 * parent lookups only ever see accepted parents; the result keeps the original file order.
 * Input rows are never mutated.
 */
export function evaluateDataset(rows: RawRow[]): EvaluatedRow[] {
  const lineChecks = new Map<RawRow, LineCheck>();
  for (const row of rows) {
    if (row.record_type.trim() === 'po_line') lineChecks.set(row, checkLineIntrinsic(row));
  }

  const ctx: Context = {
    vendors: new Map(),
    taxNumbers: new Set(),
    purchaseOrders: new Set(),
    lineKeys: new Set(),
    poAggregates: aggregateLines(rows, lineChecks),
    lineChecks,
  };

  const results: EvaluatedRow[] = new Array<EvaluatedRow>(rows.length);

  const build = (row: RawRow, idx: number, outcome: TerminalOutcome, verdict: Verdict): EvaluatedRow => ({
    line_number: idx + 2,
    row_id: row.row_id,
    record_type: row.record_type,
    source_id: row.source_id,
    outcome,
    reason_codes: verdict.reasons,
    normalized_data: verdict.normalized,
    masked_data: maskSensitiveFields(row),
    rule_ids: [
      ...normalizationRuleIds(row),
      ...verdict.reasons.map((r) => RULE_BY_REASON.get(r)?.rule_id ?? 'UNKNOWN'),
    ],
  });

  for (const type of LOAD_ORDER) {
    rows.forEach((row, idx) => {
      if (row.record_type.trim() !== type) return;
      const verdict =
        type === 'vendor'
          ? evaluateVendor(row, ctx)
          : type === 'purchase_order'
            ? evaluatePurchaseOrder(row, ctx)
            : evaluatePoLine(row, ctx);
      const outcome = toOutcome(verdict.reasons);
      results[idx] = build(row, idx, outcome, verdict);

      if (outcome !== 'accepted') return;
      if (type === 'vendor') {
        ctx.vendors.set(normalizeCode(row.vendor_code), row.currency.trim());
        const tax = normalizeTaxNumber(row.tax_number);
        if (tax) ctx.taxNumbers.add(tax);
      } else if (type === 'purchase_order') {
        ctx.purchaseOrders.add(normalizePoNumber(row.po_number));
      } else {
        const check = ctx.lineChecks.get(row)!;
        ctx.lineKeys.add(`${check.poNumber}#${check.lineNo}`);
      }
    });
  }

  rows.forEach((row, idx) => {
    if (results[idx] !== undefined) return;
    results[idx] = build(row, idx, 'skipped', { reasons: ['UNSUPPORTED_RECORD_TYPE'], normalized: {} });
  });

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export interface OutcomeCounts {
  accepted: number;
  rejected: number;
  review: number;
  skipped: number;
  total: number;
}

export interface ProfileReport {
  profile_schema_version: number;
  rules_version: string;
  module: 'erp2';
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
  by_record_type: Record<string, OutcomeCounts>;
  by_reason_code: Record<string, number>;
  rows: Record<string, { record_type: string; outcome: TerminalOutcome; reasons: string[] }>;
}

const emptyCounts = (): OutcomeCounts => ({ accepted: 0, rejected: 0, review: 0, skipped: 0, total: 0 });

export function buildProfile(csvText: string, evaluatedRows: EvaluatedRow[]): ProfileReport {
  const totals = emptyCounts();
  const byType: Record<string, OutcomeCounts> = {};
  for (const type of LOAD_ORDER) byType[type] = emptyCounts();
  const byReason: Record<string, number> = {};
  const manifest: ProfileReport['rows'] = {};

  for (const row of evaluatedRows) {
    totals[row.outcome] += 1;
    totals.total += 1;
    const bucket = (byType[row.record_type] ??= emptyCounts());
    bucket[row.outcome] += 1;
    bucket.total += 1;
    for (const reason of row.reason_codes) byReason[reason] = (byReason[reason] ?? 0) + 1;
    manifest[row.row_id] = { record_type: row.record_type, outcome: row.outcome, reasons: row.reason_codes };
  }

  const accounted = totals.accepted + totals.rejected + totals.review + totals.skipped;
  return {
    profile_schema_version: PROFILE_SCHEMA_VERSION,
    rules_version: RULES_VERSION,
    module: 'erp2',
    fixture: FIXTURE_PATH,
    fixture_sha256: sha256Hex(csvText),
    total_rows: evaluatedRows.length,
    reconciliation: {
      total_source_rows: evaluatedRows.length,
      accepted: totals.accepted,
      rejected: totals.rejected,
      review: totals.review,
      skipped: totals.skipped,
      unaccounted: evaluatedRows.length - accounted,
      is_balanced: accounted === evaluatedRows.length,
    },
    by_record_type: byType,
    by_reason_code: byReason,
    rows: manifest,
  };
}
