/**
 * ERP-2 Vendors & Purchasing — V1 Data-Quality Rule Catalogue & Engine
 *
 * Pure, deterministic, dependency-free (apart from node:crypto) rules that decide,
 * row by row, whether raw migration input for vendors, purchase orders and
 * purchase-order lines is accepted, rejected, or held for explicit human review.
 *
 * Guarantees:
 *   - Raw input is never mutated: rows are frozen on read; cleaning produces new values.
 *   - Every rule has a stable rule_id, a version, an input condition, a result and a reason.
 *   - No fuzzy matching and no automatic merge: duplicates are only EXACT candidate keys
 *     (vendor tax_number, purchase-order po_number) and are held for review, never merged.
 *   - Same fixture + same RULES_VERSION => byte-identical profile (see stableStringify).
 *   - Cross-module product references go through the ERP-1 ReferenceResolver contract
 *     (BR-ERP2-01 / Decision C7); this module never reads ERP-1 tables.
 *   - Totals are recomputed from lines with BigInt arithmetic, half-up to 2 decimals.
 *     A total supplied in the source file is ignored (FR-ERP2-05).
 *   - Bank details never appear unmasked in any report (FR-ERP2-06).
 *
 * Traceability: SDS ClearShift ERP v2.0 V1 — FR-ERP2-01..06, BR-ERP2-01; Project Plan v3.0 §7.7.
 *
 * @module erp2/migration/rules
 */

import { createHash } from 'node:crypto';
import { maskBankDetails } from '../domain/rules.js';

// ─────────────────────────────────────────────────────────────────────────────
// Versions & constants
// ─────────────────────────────────────────────────────────────────────────────

export const RULES_VERSION = '1.0.0';
export const FIXTURE_SCHEMA_VERSION = 1;
export const PROFILE_SCHEMA_VERSION = 1;
export const SOURCE_SYSTEM = 'SYNTH-ERP2-DIRTY-V1';
export const FIXTURE_PATH = 'sample-data/erp-2/dirty-data-v1.csv';

/** ISO 4217 codes accepted in V1. Currency is always explicit; there is no FX conversion. */
export const ACCEPTED_CURRENCIES = ['USD', 'EUR', 'GBP'] as const;

/** FR-ERP2-04: Draft -> Sent -> Received -> Closed. Cancellation does not exist in V1. */
export const PO_STATUSES = ['Draft', 'Sent', 'Received', 'Closed'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const RECORD_TYPES = ['vendor', 'purchase_order', 'po_line'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

/** Exact column order of the fixture. Reading a file with any other header throws. */
export const FIXTURE_COLUMNS = [
  'row_id',
  'record_type',
  'case_tags',
  'source_id',
  'parent_source_id',
  'name',
  'tax_number',
  'email',
  'phone',
  'address_line',
  'city',
  'country',
  'bank_details',
  'currency',
  'po_number',
  'vendor_ref',
  'order_date',
  'status',
  'client_total',
  'product_id',
  'quantity',
  'price',
  'expect_outcome',
  'expect_reasons',
] as const;
export type FixtureColumn = (typeof FIXTURE_COLUMNS)[number];

// NUMERIC limits from the schema: quantity (12,2) => 10 integer digits; price/total (18,2) => 16.
const QUANTITY_MAX_INT_DIGITS = 10;
const PRICE_MAX_INT_DIGITS = 16;
const TOTAL_LIMIT_CENTS = 10n ** 18n;

// ─────────────────────────────────────────────────────────────────────────────
// Rule catalogue
// ─────────────────────────────────────────────────────────────────────────────

export type RuleEntity = RecordType;
export type RuleKind =
  | 'required'
  | 'length'
  | 'format'
  | 'normalize'
  | 'enum'
  | 'reference'
  | 'duplicate'
  | 'derive';
export type RuleResult = 'reject' | 'normalize' | 'review' | 'derive';

export interface DataQualityRule {
  readonly rule_id: string;
  readonly version: string;
  readonly entity: RuleEntity;
  readonly field: string;
  readonly kind: RuleKind;
  readonly input_condition: string;
  readonly result: RuleResult;
  /** Stable machine-readable reason. null for normalize / derive rules (they never reject). */
  readonly reason_code: string | null;
  /** Human-readable reason. */
  readonly reason: string;
}

const V = RULES_VERSION;

function rule(
  rule_id: string,
  entity: RuleEntity,
  field: string,
  kind: RuleKind,
  result: RuleResult,
  reason_code: string | null,
  input_condition: string,
  reason: string
): DataQualityRule {
  return { rule_id, version: V, entity, field, kind, input_condition, result, reason_code, reason };
}

export const RULE_CATALOGUE: readonly DataQualityRule[] = [
  // ── Vendor: required (raw cell empty after trim) ───────────────────────────
  rule('VND-001', 'vendor', 'name', 'required', 'reject', 'VENDOR_NAME_REQUIRED', 'name is empty after trimming', 'Vendor name is required.'),
  rule('VND-002', 'vendor', 'tax_number', 'required', 'reject', 'TAX_NUMBER_REQUIRED', 'tax_number is empty after trimming', 'Vendor tax number is required.'),
  rule('VND-003', 'vendor', 'email', 'required', 'reject', 'EMAIL_REQUIRED', 'email is empty after trimming', 'Vendor email is required.'),
  rule('VND-004', 'vendor', 'currency', 'required', 'reject', 'CURRENCY_REQUIRED', 'currency is empty after trimming', 'Currency must be explicit; there is no default and no FX conversion in V1.'),
  rule('VND-005', 'vendor', 'source_id', 'required', 'reject', 'SOURCE_ID_REQUIRED', 'source_id is empty after trimming', 'Source id is required for migration lineage.'),
  // ── Vendor: normalization (never rejects) ──────────────────────────────────
  rule('VND-010', 'vendor', 'name', 'normalize', 'normalize', null, 'name has leading/trailing or repeated inner whitespace', 'Trim and collapse whitespace in the vendor name.'),
  rule('VND-011', 'vendor', 'tax_number', 'normalize', 'normalize', null, 'tax_number has whitespace or lowercase letters', 'Remove whitespace and upper-case the tax number.'),
  rule('VND-012', 'vendor', 'email', 'normalize', 'normalize', null, 'email has surrounding whitespace or uppercase letters', 'Trim and lower-case the email.'),
  rule('VND-013', 'vendor', 'phone', 'normalize', 'normalize', null, 'phone contains spaces, dots, dashes or parentheses', 'Strip phone separators; an empty phone becomes null.'),
  rule('VND-014', 'vendor', 'currency', 'normalize', 'normalize', null, 'currency has whitespace or lowercase letters', 'Trim and upper-case the currency code.'),
  rule('VND-015', 'vendor', 'address_line', 'normalize', 'normalize', null, 'address_line, city or country has surrounding/repeated whitespace', 'Trim and collapse whitespace; an empty value becomes null.'),
  rule('VND-016', 'vendor', 'bank_details', 'normalize', 'normalize', null, 'bank_details contains spaces or dashes', 'Strip spaces and dashes and upper-case; an empty value becomes null.'),
  // ── Vendor: length ─────────────────────────────────────────────────────────
  rule('VND-020', 'vendor', 'name', 'length', 'reject', 'NAME_TOO_LONG', 'normalized name is longer than 255 characters', 'Vendor name must be at most 255 characters.'),
  rule('VND-021', 'vendor', 'address_line', 'length', 'reject', 'ADDRESS_TOO_LONG', 'normalized address_line is longer than 255 characters', 'Address must be at most 255 characters.'),
  rule('VND-022', 'vendor', 'city', 'length', 'reject', 'CITY_TOO_LONG', 'normalized city is longer than 100 characters', 'City must be at most 100 characters.'),
  rule('VND-023', 'vendor', 'country', 'length', 'reject', 'COUNTRY_TOO_LONG', 'normalized country is longer than 64 characters', 'Country must be at most 64 characters.'),
  // ── Vendor: format ─────────────────────────────────────────────────────────
  rule('VND-030', 'vendor', 'tax_number', 'format', 'reject', 'INVALID_TAX_NUMBER_FORMAT', 'normalized tax_number does not match ^[A-Z0-9-]{3,64}$', 'Tax number may only contain A-Z, 0-9 and "-" (3 to 64 characters).'),
  rule('VND-031', 'vendor', 'email', 'format', 'reject', 'INVALID_EMAIL_FORMAT', 'normalized email is not local@domain.tld or is longer than 255 characters', 'Email address is not valid.'),
  rule('VND-032', 'vendor', 'phone', 'format', 'reject', 'INVALID_PHONE_FORMAT', 'non-empty normalized phone does not match ^\\+?\\d{7,15}$', 'Phone must be 7 to 15 digits with an optional leading "+".'),
  rule('VND-033', 'vendor', 'bank_details', 'format', 'reject', 'INVALID_BANK_DETAILS_FORMAT', 'non-empty normalized bank_details is not 4-34 alphanumerics containing at least 4 digits', 'Bank details must be 4 to 34 alphanumeric characters with at least 4 digits.'),
  // ── Vendor: enumeration ────────────────────────────────────────────────────
  rule('VND-040', 'vendor', 'currency', 'enum', 'reject', 'INVALID_CURRENCY', 'normalized currency is not one of USD, EUR, GBP', 'Currency is not an accepted ISO 4217 code in V1.'),
  // ── Vendor: exact duplicate candidate key (review, never merge) ────────────
  rule('VND-050', 'vendor', 'tax_number', 'duplicate', 'review', 'DUPLICATE_TAX_NUMBER_REVIEW', 'a later row has the same normalized tax_number as an earlier row that passed all other vendor rules', 'Exact duplicate tax number; held for explicit review, never merged automatically.'),
  // ── Vendor: derived (report only) ──────────────────────────────────────────
  rule('VND-060', 'vendor', 'bank_details', 'derive', 'derive', null, 'bank_details present and valid', 'Reports show bank details only as XXXX-XXXX-<last 4 digits>.'),

  // ── Purchase order: required ───────────────────────────────────────────────
  rule('PUR-001', 'purchase_order', 'source_id', 'required', 'reject', 'SOURCE_ID_REQUIRED', 'source_id is empty after trimming', 'Source id is required; order lines attach to their order through it.'),
  rule('PUR-002', 'purchase_order', 'vendor_ref', 'required', 'reject', 'VENDOR_REF_REQUIRED', 'vendor_ref is empty after trimming', 'Vendor reference (vendor tax number) is required.'),
  rule('PUR-003', 'purchase_order', 'order_date', 'required', 'reject', 'ORDER_DATE_REQUIRED', 'order_date is empty after trimming', 'Order date is required.'),
  rule('PUR-004', 'purchase_order', 'status', 'required', 'reject', 'STATUS_REQUIRED', 'status is empty after trimming', 'Status is required.'),
  rule('PUR-005', 'purchase_order', 'currency', 'required', 'reject', 'CURRENCY_REQUIRED', 'currency is empty after trimming', 'Currency must be explicit; there is no default and no FX conversion in V1.'),
  rule('PUR-006', 'purchase_order', 'lines', 'required', 'reject', 'NO_LINES', 'no po_line row attaches to this order', 'A purchase order needs at least one line.'),
  // ── Purchase order: normalization ──────────────────────────────────────────
  rule('PUR-010', 'purchase_order', 'po_number', 'normalize', 'normalize', null, 'po_number has whitespace or lowercase letters', 'Trim and upper-case the PO number; an empty value becomes null (server generates it).'),
  rule('PUR-011', 'purchase_order', 'vendor_ref', 'normalize', 'normalize', null, 'vendor_ref has whitespace or lowercase letters', 'Remove whitespace and upper-case so it matches the vendor tax number.'),
  rule('PUR-012', 'purchase_order', 'order_date', 'normalize', 'normalize', null, 'order_date is YYYY/MM/DD', 'Convert YYYY/MM/DD to YYYY-MM-DD.'),
  rule('PUR-013', 'purchase_order', 'status', 'normalize', 'normalize', null, 'status differs from an accepted status only by case or whitespace', 'Trim and fix the case of the status.'),
  rule('PUR-014', 'purchase_order', 'currency', 'normalize', 'normalize', null, 'currency has whitespace or lowercase letters', 'Trim and upper-case the currency code.'),
  // ── Purchase order: length / format / enum ─────────────────────────────────
  rule('PUR-020', 'purchase_order', 'po_number', 'length', 'reject', 'PO_NUMBER_TOO_LONG', 'normalized po_number is longer than 64 characters', 'PO number must be at most 64 characters.'),
  rule('PUR-030', 'purchase_order', 'order_date', 'format', 'reject', 'INVALID_ORDER_DATE', 'normalized order_date is not a real calendar date in YYYY-MM-DD', 'Order date must be a real date in YYYY-MM-DD format.'),
  rule('PUR-031', 'purchase_order', 'order_date', 'format', 'reject', 'AMBIGUOUS_DATE_FORMAT', 'order_date looks like DD/MM/YYYY or MM/DD/YYYY', 'Day-first and month-first dates are ambiguous and are never guessed.'),
  rule('PUR-040', 'purchase_order', 'status', 'enum', 'reject', 'INVALID_STATUS', 'normalized status is not Draft, Sent, Received or Closed', 'Status must be Draft, Sent, Received or Closed; cancellation is not supported in V1.'),
  rule('PUR-041', 'purchase_order', 'currency', 'enum', 'reject', 'INVALID_CURRENCY', 'normalized currency is not one of USD, EUR, GBP', 'Currency is not an accepted ISO 4217 code in V1.'),
  // ── Purchase order: relationships ──────────────────────────────────────────
  rule('PUR-050', 'purchase_order', 'vendor_ref', 'reference', 'reject', 'VENDOR_NOT_FOUND', 'no vendor row in the batch has this normalized tax number', 'The order references a vendor that is not in the batch.'),
  rule('PUR-051', 'purchase_order', 'vendor_ref', 'reference', 'reject', 'VENDOR_REJECTED', 'the only vendor row with this tax number was rejected', 'The order references a vendor that failed data-quality rules.'),
  // ── Purchase order: duplicates, totals, atomicity ──────────────────────────
  rule('PUR-060', 'purchase_order', 'po_number', 'duplicate', 'review', 'DUPLICATE_PO_NUMBER_REVIEW', 'a later row has the same normalized non-empty po_number as an earlier row that passed all header rules', 'Exact duplicate PO number; held for explicit review, never merged automatically.'),
  rule('PUR-070', 'purchase_order', 'total', 'derive', 'derive', null, 'always', 'Order total = sum of line totals computed server-side; any total in the source file is ignored.'),
  rule('PUR-071', 'purchase_order', 'total', 'format', 'reject', 'TOTAL_OVERFLOW', 'computed total does not fit NUMERIC(18,2)', 'The computed order total exceeds NUMERIC(18,2).'),
  rule('PUR-072', 'purchase_order', 'lines', 'reference', 'reject', 'LINE_REJECTED', 'at least one attached line was rejected by its own rules', 'An order is loaded whole or not at all; one rejected line rejects the order.'),

  // ── Purchase-order line: required ──────────────────────────────────────────
  rule('LIN-002', 'po_line', 'product_id', 'required', 'reject', 'PRODUCT_ID_REQUIRED', 'product_id is empty after trimming', 'Product id is required.'),
  rule('LIN-003', 'po_line', 'quantity', 'required', 'reject', 'QUANTITY_REQUIRED', 'quantity is empty after trimming', 'Quantity is required.'),
  rule('LIN-004', 'po_line', 'price', 'required', 'reject', 'PRICE_REQUIRED', 'price is empty after trimming', 'Price is required.'),
  // ── Line: normalization ────────────────────────────────────────────────────
  rule('LIN-010', 'po_line', 'product_id', 'normalize', 'normalize', null, 'product_id has whitespace or uppercase letters', 'Trim and lower-case the product id.'),
  rule('LIN-011', 'po_line', 'quantity', 'normalize', 'normalize', null, 'quantity or price has whitespace, thousands separators or fewer than 2 decimals', 'Trim, remove thousands commas and pad to exactly 2 decimals.'),
  // ── Line: format ───────────────────────────────────────────────────────────
  rule('LIN-030', 'po_line', 'product_id', 'format', 'reject', 'INVALID_PRODUCT_ID_FORMAT', 'normalized product_id is not a UUID', 'Product id must be a UUID.'),
  rule('LIN-031', 'po_line', 'quantity', 'format', 'reject', 'INVALID_QUANTITY_FORMAT', 'normalized quantity is not a plain non-negative decimal', 'Quantity must be a plain decimal such as 10 or 10.50.'),
  rule('LIN-032', 'po_line', 'price', 'format', 'reject', 'INVALID_PRICE_FORMAT', 'normalized price is not a plain non-negative decimal', 'Price must be a plain decimal such as 15 or 15.50.'),
  rule('LIN-033', 'po_line', 'quantity', 'format', 'reject', 'NEGATIVE_AMOUNT', 'quantity or price starts with "-"', 'Amounts must be non-negative.'),
  rule('LIN-034', 'po_line', 'quantity', 'format', 'reject', 'EXCESS_DECIMAL_PLACES', 'quantity or price has more than 2 decimal places', 'Amounts have at most 2 decimals; values are never silently rounded.'),
  rule('LIN-035', 'po_line', 'quantity', 'format', 'reject', 'QUANTITY_NOT_POSITIVE', 'quantity equals zero', 'Quantity must be greater than zero.'),
  rule('LIN-036', 'po_line', 'quantity', 'format', 'reject', 'AMOUNT_OVERFLOW', 'quantity has more than 10 integer digits or price more than 16', 'Amount exceeds the NUMERIC column limit.'),
  // ── Line: relationships ────────────────────────────────────────────────────
  rule('LIN-040', 'po_line', 'product_id', 'reference', 'reject', 'UNKNOWN_PRODUCT', 'the ERP-1 ReferenceResolver reports no product with this id', 'Product does not exist in ERP-1 (BR-ERP2-01).'),
  rule('LIN-041', 'po_line', 'parent_source_id', 'reference', 'reject', 'ORPHAN_LINE', 'parent_source_id is empty or matches no purchase_order source_id', 'The line does not belong to any purchase order in the batch.'),
  rule('LIN-042', 'po_line', 'parent_source_id', 'reference', 'reject', 'PARENT_PO_REJECTED', 'the line passed its own rules but its purchase order was rejected', 'The parent order was rejected, so the line is not loaded.'),
  rule('LIN-043', 'po_line', 'parent_source_id', 'reference', 'review', 'PARENT_PO_IN_REVIEW', 'the line passed its own rules but its purchase order is held for review', 'The parent order is held for review, so the line is held with it.'),
  // ── Line: derived ──────────────────────────────────────────────────────────
  rule('LIN-050', 'po_line', 'line_total', 'derive', 'derive', null, 'always', 'Line total = round_half_up(quantity x price, 2) using decimal arithmetic.'),
];

const RULE_BY_ID: ReadonlyMap<string, DataQualityRule> = new Map(
  RULE_CATALOGUE.map((r) => [r.rule_id, r])
);

/** Fields that must have at least one valid and one invalid fixture row. */
export const COVERED_FIELDS: readonly string[] = [
  'vendor.source_id',
  'vendor.name',
  'vendor.tax_number',
  'vendor.email',
  'vendor.phone',
  'vendor.address_line',
  'vendor.city',
  'vendor.country',
  'vendor.bank_details',
  'vendor.currency',
  'purchase_order.source_id',
  'purchase_order.po_number',
  'purchase_order.vendor_ref',
  'purchase_order.order_date',
  'purchase_order.status',
  'purchase_order.currency',
  'purchase_order.lines',
  'po_line.parent_source_id',
  'po_line.product_id',
  'po_line.quantity',
  'po_line.price',
];

// ─────────────────────────────────────────────────────────────────────────────
// Raw input (never mutated)
// ─────────────────────────────────────────────────────────────────────────────

export type RawRow = Readonly<Record<FixtureColumn, string>>;

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, LF or CRLF. Cells are returned verbatim. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Parse the fixture into frozen rows. Throws if the header is not exactly FIXTURE_COLUMNS. */
export function readRawRows(csvText: string): readonly RawRow[] {
  const table = parseCsv(csvText);
  const header = table[0] ?? [];
  if (header.join(',') !== FIXTURE_COLUMNS.join(',')) {
    throw new Error(`Fixture header mismatch. Expected: ${FIXTURE_COLUMNS.join(',')}`);
  }
  const rows: RawRow[] = [];
  for (const cells of table.slice(1)) {
    if (cells.length !== FIXTURE_COLUMNS.length) {
      throw new Error(`Fixture row has ${cells.length} cells, expected ${FIXTURE_COLUMNS.length}`);
    }
    const record = {} as Record<FixtureColumn, string>;
    FIXTURE_COLUMNS.forEach((column, index) => {
      record[column] = cells[index] ?? '';
    });
    rows.push(Object.freeze(record));
  }
  return Object.freeze(rows);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────

export type Outcome = 'accepted' | 'rejected' | 'review';

export interface RuleHit {
  readonly rule_id: string;
  readonly reason_code: string;
  readonly field: string;
  readonly message: string;
}

export interface VendorClean {
  readonly name: string;
  readonly tax_number: string;
  readonly email: string;
  readonly phone: string | null;
  readonly address_line: string | null;
  readonly city: string | null;
  readonly country: string | null;
  /** Normalized value used for the import call; the API masks it server-side. Never put in reports. */
  readonly bank_details: string | null;
  /** Report-safe form, XXXX-XXXX-1234. */
  readonly bank_masked: string | null;
  readonly currency: string;
  readonly source_system: string;
  readonly source_id: string;
}

export interface PoLineClean {
  readonly product_id: string;
  readonly quantity: string;
  readonly price: string;
  readonly line_total: string;
}

export interface PurchaseOrderClean {
  readonly po_number: string | null;
  /** Normalized vendor tax number; the loader resolves it to vendor_id after vendors are imported. */
  readonly vendor_ref: string;
  readonly order_date: string;
  readonly currency: string;
  /** Status to reach AFTER create, by forward PATCH transitions only. Create always yields Draft. */
  readonly post_load_status: PoStatus;
  readonly lines: readonly PoLineClean[];
  readonly total: string;
  readonly source_system: string;
  readonly source_id: string;
}

export type CleanRecord = VendorClean | PurchaseOrderClean | PoLineClean;

export interface RowResult {
  readonly row_id: string;
  readonly record_type: RecordType;
  readonly outcome: Outcome;
  readonly reasons: readonly RuleHit[];
  /** Rule ids of normalization rules that actually changed a cell. */
  readonly normalized_by: readonly string[];
  /** Row id of the earlier row this row duplicates (review rows only). */
  readonly duplicate_of: string | null;
  readonly clean: CleanRecord | null;
}

export interface DatasetResult {
  readonly rules_version: string;
  readonly rows: readonly RowResult[];
}

/** Structurally identical to the kernel ReferenceResolver port used by the service. */
export interface ProductResolver {
  exists(entity: string, id: string): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function hitFor(ruleId: string): RuleHit {
  const found = RULE_BY_ID.get(ruleId);
  if (!found || found.reason_code === null) {
    throw new Error(`Rule ${ruleId} cannot produce a reason`);
  }
  return { rule_id: found.rule_id, reason_code: found.reason_code, field: found.field, message: found.reason };
}

/** Same as hitFor but reports the field a shared rule applies to (e.g. price vs quantity). */
function hitOn(ruleId: string, field: string): RuleHit {
  return { ...hitFor(ruleId), field };
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function nullIfEmpty(value: string): string | null {
  return value === '' ? null : value;
}

interface Tracker {
  readonly changed: Set<string>;
}

/** Records the rule as applied only when a non-blank raw cell actually changed. */
function track(tracker: Tracker, ruleId: string, raw: string, next: string): void {
  if (raw.trim() !== '' && raw !== next) tracker.changed.add(ruleId);
}

function outcomeOf(reasons: readonly RuleHit[]): Outcome {
  let review = false;
  for (const r of reasons) {
    const def = RULE_BY_ID.get(r.rule_id);
    if (def?.result === 'reject') return 'rejected';
    if (def?.result === 'review') review = true;
  }
  return review ? 'review' : 'accepted';
}

// ── amounts (decimal arithmetic via BigInt hundredths) ───────────────────────

function stripThousands(value: string): string {
  const trimmed = value.trim();
  return /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed;
}

function padTwoDecimals(value: string): string {
  if (!value.includes('.')) return `${value}.00`;
  const [whole = '', frac = ''] = value.split('.');
  return `${whole}.${frac.padEnd(2, '0')}`;
}

function integerDigits(value: string): number {
  const whole = (value.split('.')[0] ?? '').replace(/^0+(?=\d)/, '');
  return whole.length;
}

function toHundredths(value: string): bigint {
  const [whole = '0', frac = '00'] = value.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2));
}

export function formatHundredths(value: bigint): string {
  const whole = value / 100n;
  const frac = (value % 100n).toString().padStart(2, '0');
  return `${whole.toString()}.${frac}`;
}

/** round_half_up(quantity x price, 2). Inputs are strings with exactly 2 decimals. */
export function computeLineTotal(quantity: string, price: string): string {
  const product = toHundredths(quantity) * toHundredths(price); // units of 1e-4
  return formatHundredths((product + 50n) / 100n);
}

type AmountField = 'quantity' | 'price';

interface AmountOutcome {
  readonly value: string | null;
  readonly hit: RuleHit | null;
}

function evaluateAmount(raw: string, field: AmountField, tracker: Tracker): AmountOutcome {
  const requiredId = field === 'quantity' ? 'LIN-003' : 'LIN-004';
  if (raw.trim() === '') return { value: null, hit: hitFor(requiredId) };

  const stripped = stripThousands(raw);
  if (stripped.startsWith('-')) return { value: null, hit: hitOn('LIN-033', field) };
  if (/^\d+\.\d{3,}$/.test(stripped)) return { value: null, hit: hitOn('LIN-034', field) };
  if (!/^\d+(\.\d{1,2})?$/.test(stripped)) {
    return { value: null, hit: hitFor(field === 'quantity' ? 'LIN-031' : 'LIN-032') };
  }
  const padded = padTwoDecimals(stripped);
  const limit = field === 'quantity' ? QUANTITY_MAX_INT_DIGITS : PRICE_MAX_INT_DIGITS;
  if (integerDigits(padded) > limit) return { value: null, hit: hitOn('LIN-036', field) };
  if (field === 'quantity' && toHundredths(padded) === 0n) {
    return { value: null, hit: hitFor('LIN-035') };
  }
  track(tracker, 'LIN-011', raw, padded);
  return { value: padded, hit: null };
}

// ── dates ────────────────────────────────────────────────────────────────────

function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= days;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-entity evaluation (field rules only; relationships are resolved afterwards)
// ─────────────────────────────────────────────────────────────────────────────

interface Draft<TClean> {
  readonly row: RawRow;
  readonly reasons: RuleHit[];
  readonly tracker: Tracker;
  clean: TClean | null;
  duplicateOf: string | null;
}

function newDraft<TClean>(row: RawRow): Draft<TClean> {
  return { row, reasons: [], tracker: { changed: new Set<string>() }, clean: null, duplicateOf: null };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function evaluateVendor(row: RawRow): Draft<VendorClean> {
  const d = newDraft<VendorClean>(row);
  const { reasons, tracker } = d;

  const name = collapse(row.name);
  track(tracker, 'VND-010', row.name, name);
  const taxNumber = row.tax_number.replace(/\s+/g, '').toUpperCase();
  track(tracker, 'VND-011', row.tax_number, taxNumber);
  const email = row.email.trim().toLowerCase();
  track(tracker, 'VND-012', row.email, email);
  const phone = row.phone.replace(/[\s().-]/g, '');
  track(tracker, 'VND-013', row.phone, phone);
  const currency = row.currency.trim().toUpperCase();
  track(tracker, 'VND-014', row.currency, currency);
  const addressLine = collapse(row.address_line);
  const city = collapse(row.city);
  const country = collapse(row.country);
  track(tracker, 'VND-015', row.address_line, addressLine);
  track(tracker, 'VND-015', row.city, city);
  track(tracker, 'VND-015', row.country, country);
  const bank = row.bank_details.replace(/[\s-]/g, '').toUpperCase();
  track(tracker, 'VND-016', row.bank_details, bank);

  if (row.source_id.trim() === '') reasons.push(hitFor('VND-005'));
  if (name === '') reasons.push(hitFor('VND-001'));
  else if (name.length > 255) reasons.push(hitFor('VND-020'));

  if (taxNumber === '') reasons.push(hitFor('VND-002'));
  else if (!/^[A-Z0-9-]{3,64}$/.test(taxNumber)) reasons.push(hitFor('VND-030'));

  if (email === '') reasons.push(hitFor('VND-003'));
  else if (!EMAIL_RE.test(email) || email.length > 255) reasons.push(hitFor('VND-031'));

  if (phone !== '' && !/^\+?\d{7,15}$/.test(phone)) reasons.push(hitFor('VND-032'));
  if (addressLine.length > 255) reasons.push(hitFor('VND-021'));
  if (city.length > 100) reasons.push(hitFor('VND-022'));
  if (country.length > 64) reasons.push(hitFor('VND-023'));

  const bankDigits = bank.replace(/\D/g, '');
  if (bank !== '' && !(/^[A-Z0-9]{4,34}$/.test(bank) && bankDigits.length >= 4)) {
    reasons.push(hitFor('VND-033'));
  }

  if (currency === '') reasons.push(hitFor('VND-004'));
  else if (!(ACCEPTED_CURRENCIES as readonly string[]).includes(currency)) reasons.push(hitFor('VND-040'));

  if (reasons.length === 0) {
    d.clean = {
      name,
      tax_number: taxNumber,
      email,
      phone: nullIfEmpty(phone),
      address_line: nullIfEmpty(addressLine),
      city: nullIfEmpty(city),
      country: nullIfEmpty(country),
      bank_details: nullIfEmpty(bank),
      bank_masked: bank === '' ? null : maskBankDetails(bank),
      currency,
      source_system: SOURCE_SYSTEM,
      source_id: row.source_id.trim(),
    };
  }
  return d;
}

interface PoHeader {
  readonly po_number: string | null;
  readonly vendor_ref: string;
  readonly order_date: string;
  readonly currency: string;
  readonly status: PoStatus;
  readonly source_id: string;
}

function evaluatePurchaseOrder(row: RawRow): Draft<PoHeader> {
  const d = newDraft<PoHeader>(row);
  const { reasons, tracker } = d;

  const poNumber = row.po_number.replace(/\s+/g, '').toUpperCase();
  track(tracker, 'PUR-010', row.po_number, poNumber);
  const vendorRef = row.vendor_ref.replace(/\s+/g, '').toUpperCase();
  track(tracker, 'PUR-011', row.vendor_ref, vendorRef);
  const rawDate = row.order_date.trim();
  const orderDate = /^\d{4}\/\d{2}\/\d{2}$/.test(rawDate) ? rawDate.replace(/\//g, '-') : rawDate;
  track(tracker, 'PUR-012', row.order_date, orderDate);
  const statusText = row.status.trim();
  const matchedStatus = PO_STATUSES.find((s) => s.toLowerCase() === statusText.toLowerCase());
  track(tracker, 'PUR-013', row.status, matchedStatus ?? statusText);
  const currency = row.currency.trim().toUpperCase();
  track(tracker, 'PUR-014', row.currency, currency);

  if (row.source_id.trim() === '') reasons.push(hitFor('PUR-001'));
  if (vendorRef === '') reasons.push(hitFor('PUR-002'));

  if (orderDate === '') reasons.push(hitFor('PUR-003'));
  else if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(orderDate)) reasons.push(hitFor('PUR-031'));
  else if (!isRealDate(orderDate)) reasons.push(hitFor('PUR-030'));

  if (statusText === '') reasons.push(hitFor('PUR-004'));
  else if (matchedStatus === undefined) reasons.push(hitFor('PUR-040'));

  if (currency === '') reasons.push(hitFor('PUR-005'));
  else if (!(ACCEPTED_CURRENCIES as readonly string[]).includes(currency)) reasons.push(hitFor('PUR-041'));

  if (poNumber.length > 64) reasons.push(hitFor('PUR-020'));

  if (reasons.length === 0 && matchedStatus !== undefined) {
    d.clean = {
      po_number: nullIfEmpty(poNumber),
      vendor_ref: vendorRef,
      order_date: orderDate,
      currency,
      status: matchedStatus,
      source_id: row.source_id.trim(),
    };
  }
  return d;
}

interface LineDraftClean {
  readonly product_id: string;
  readonly quantity: string;
  readonly price: string;
  readonly line_total: string;
}

async function evaluateLine(
  row: RawRow,
  resolver: ProductResolver
): Promise<Draft<LineDraftClean>> {
  const d = newDraft<LineDraftClean>(row);
  const { reasons, tracker } = d;

  const productId = row.product_id.trim().toLowerCase();
  track(tracker, 'LIN-010', row.product_id, productId);

  let productOk = false;
  if (productId === '') reasons.push(hitFor('LIN-002'));
  else if (!UUID_RE.test(productId)) reasons.push(hitFor('LIN-030'));
  else if (!(await resolver.exists('product', productId))) reasons.push(hitFor('LIN-040'));
  else productOk = true;

  const quantity = evaluateAmount(row.quantity, 'quantity', tracker);
  if (quantity.hit) reasons.push(quantity.hit);
  const price = evaluateAmount(row.price, 'price', tracker);
  if (price.hit) reasons.push(price.hit);

  if (productOk && quantity.value !== null && price.value !== null) {
    d.clean = {
      product_id: productId,
      quantity: quantity.value,
      price: price.value,
      line_total: computeLineTotal(quantity.value, price.value),
    };
  }
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset evaluation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a whole batch. Deterministic: output order equals input order and nothing
 * depends on time, randomness, locale or object-key enumeration of unordered data.
 */
export async function evaluateDataset(
  rows: readonly RawRow[],
  resolver: ProductResolver
): Promise<DatasetResult> {
  const results = new Map<string, RowResult>();

  const vendorRows = rows.filter((r) => r.record_type === 'vendor');
  const poRows = rows.filter((r) => r.record_type === 'purchase_order');
  const lineRows = rows.filter((r) => r.record_type === 'po_line');

  // 1. Vendors: field rules, then exact duplicate tax numbers (first wins, later held for review).
  const vendorDrafts = vendorRows.map(evaluateVendor);
  const vendorByTax = new Map<string, Draft<VendorClean>>();
  for (const d of vendorDrafts) {
    if (d.reasons.length > 0 || d.clean === null) continue;
    const first = vendorByTax.get(d.clean.tax_number);
    if (first) {
      d.reasons.push(hitFor('VND-050'));
      d.duplicateOf = first.row.row_id;
    } else {
      vendorByTax.set(d.clean.tax_number, d);
    }
  }
  const rejectedVendorTaxes = new Set<string>();
  for (const d of vendorDrafts) {
    if (outcomeOf(d.reasons) !== 'rejected') continue;
    const tax = d.row.tax_number.replace(/\s+/g, '').toUpperCase();
    if (tax !== '') rejectedVendorTaxes.add(tax);
  }
  for (const d of vendorDrafts) {
    results.set(d.row.row_id, {
      row_id: d.row.row_id,
      record_type: 'vendor',
      outcome: outcomeOf(d.reasons),
      reasons: d.reasons,
      normalized_by: [...d.tracker.changed].sort(),
      duplicate_of: d.duplicateOf,
      clean: d.reasons.length === 0 ? d.clean : null,
    });
  }

  // 2. Lines: own rules only.
  const lineDrafts = await Promise.all(lineRows.map((r) => evaluateLine(r, resolver)));

  // 3. Purchase orders: header rules, duplicates, vendor reference.
  const poDrafts = poRows.map(evaluatePurchaseOrder);
  const poBySource = new Map<string, Draft<PoHeader>>();
  for (const d of poDrafts) {
    const key = d.row.source_id.trim();
    if (key !== '' && !poBySource.has(key)) poBySource.set(key, d);
  }
  const poByNumber = new Map<string, Draft<PoHeader>>();
  for (const d of poDrafts) {
    if (d.reasons.length > 0 || d.clean === null || d.clean.po_number === null) continue;
    const first = poByNumber.get(d.clean.po_number);
    if (first) {
      d.reasons.push(hitFor('PUR-060'));
      d.duplicateOf = first.row.row_id;
    } else {
      poByNumber.set(d.clean.po_number, d);
    }
  }
  for (const d of poDrafts) {
    if (d.clean === null) continue;
    if (!vendorByTax.has(d.clean.vendor_ref)) {
      d.reasons.push(hitFor(rejectedVendorTaxes.has(d.clean.vendor_ref) ? 'PUR-051' : 'PUR-050'));
    }
  }

  // 4. Attach lines to their first matching order and apply atomic parent/child rules.
  const linesByPo = new Map<Draft<PoHeader>, Draft<LineDraftClean>[]>();
  const orphanLines: Draft<LineDraftClean>[] = [];
  for (const line of lineDrafts) {
    const parent = poBySource.get(line.row.parent_source_id.trim());
    if (!parent) {
      orphanLines.push(line);
      continue;
    }
    const bucket = linesByPo.get(parent) ?? [];
    bucket.push(line);
    linesByPo.set(parent, bucket);
  }
  for (const line of orphanLines) line.reasons.push(hitFor('LIN-041'));

  for (const po of poDrafts) {
    const attached = linesByPo.get(po) ?? [];
    if (attached.length === 0) po.reasons.push(hitFor('PUR-006'));
    if (attached.some((l) => l.reasons.length > 0)) po.reasons.push(hitFor('PUR-072'));

    if (po.clean !== null && attached.length > 0 && attached.every((l) => l.clean !== null)) {
      const total = attached.reduce(
        (sum, l) => sum + toHundredths(l.clean?.line_total ?? '0.00'),
        0n
      );
      if (total >= TOTAL_LIMIT_CENTS) po.reasons.push(hitFor('PUR-071'));
    }
  }

  const poOutcome = new Map<Draft<PoHeader>, Outcome>();
  for (const po of poDrafts) poOutcome.set(po, outcomeOf(po.reasons));

  for (const [po, attached] of linesByPo) {
    const parentOutcome = poOutcome.get(po);
    for (const line of attached) {
      if (line.reasons.length > 0) continue;
      if (parentOutcome === 'rejected') line.reasons.push(hitFor('LIN-042'));
      else if (parentOutcome === 'review') line.reasons.push(hitFor('LIN-043'));
    }
  }

  // 5. Emit purchase-order and line results.
  for (const po of poDrafts) {
    const attached = linesByPo.get(po) ?? [];
    const outcome = poOutcome.get(po) ?? 'rejected';
    let clean: PurchaseOrderClean | null = null;
    if (outcome === 'accepted' && po.clean !== null) {
      const lines: PoLineClean[] = attached.map((l) => ({
        product_id: l.clean?.product_id ?? '',
        quantity: l.clean?.quantity ?? '',
        price: l.clean?.price ?? '',
        line_total: l.clean?.line_total ?? '',
      }));
      const total = lines.reduce((sum, l) => sum + toHundredths(l.line_total), 0n);
      clean = {
        po_number: po.clean.po_number,
        vendor_ref: po.clean.vendor_ref,
        order_date: po.clean.order_date,
        currency: po.clean.currency,
        post_load_status: po.clean.status,
        lines,
        total: formatHundredths(total),
        source_system: SOURCE_SYSTEM,
        source_id: po.clean.source_id,
      };
    }
    results.set(po.row.row_id, {
      row_id: po.row.row_id,
      record_type: 'purchase_order',
      outcome,
      reasons: po.reasons,
      normalized_by: [...po.tracker.changed].sort(),
      duplicate_of: po.duplicateOf,
      clean,
    });
  }
  for (const line of lineDrafts) {
    results.set(line.row.row_id, {
      row_id: line.row.row_id,
      record_type: 'po_line',
      outcome: outcomeOf(line.reasons),
      reasons: line.reasons,
      normalized_by: [...line.tracker.changed].sort(),
      duplicate_of: null,
      clean:
        line.reasons.length === 0 && line.clean !== null
          ? {
              product_id: line.clean.product_id,
              quantity: line.clean.quantity,
              price: line.clean.price,
              line_total: line.clean.line_total,
            }
          : null,
    });
  }

  // Preserve input order.
  const ordered: RowResult[] = [];
  for (const row of rows) {
    const found = results.get(row.row_id);
    if (found) ordered.push(found);
  }
  return { rules_version: RULES_VERSION, rows: ordered };
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile (committed in expected-profile.json)
// ─────────────────────────────────────────────────────────────────────────────

export interface OutcomeCounts {
  accepted: number;
  rejected: number;
  review: number;
}

export interface DataQualityProfile {
  profile_schema_version: number;
  rules_version: string;
  fixture: {
    file: string;
    schema_version: number;
    sha256: string;
    row_count: number;
    by_record_type: Record<string, number>;
  };
  outcomes: OutcomeCounts;
  by_record_type: Record<string, OutcomeCounts>;
  by_reason_code: Record<string, number>;
  by_rule_id: Record<string, number>;
  normalizations: Record<string, number>;
  accepted_purchase_order_totals: Record<string, string>;
  rows: Record<string, { outcome: Outcome; reasons: string[] }>;
}

function emptyCounts(): OutcomeCounts {
  return { accepted: 0, rejected: 0, review: 0 };
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function buildProfile(
  rawCsvText: string,
  rawRows: readonly RawRow[],
  result: DatasetResult
): DataQualityProfile {
  const profile: DataQualityProfile = {
    profile_schema_version: PROFILE_SCHEMA_VERSION,
    rules_version: result.rules_version,
    fixture: {
      file: FIXTURE_PATH,
      schema_version: FIXTURE_SCHEMA_VERSION,
      sha256: sha256Hex(rawCsvText),
      row_count: rawRows.length,
      by_record_type: {},
    },
    outcomes: emptyCounts(),
    by_record_type: {},
    by_reason_code: {},
    by_rule_id: {},
    normalizations: {},
    accepted_purchase_order_totals: {},
    rows: {},
  };
  for (const row of rawRows) bump(profile.fixture.by_record_type, row.record_type);

  for (const r of result.rows) {
    profile.outcomes[r.outcome] += 1;
    const perType = profile.by_record_type[r.record_type] ?? emptyCounts();
    perType[r.outcome] += 1;
    profile.by_record_type[r.record_type] = perType;
    for (const reason of r.reasons) {
      bump(profile.by_reason_code, reason.reason_code);
      bump(profile.by_rule_id, reason.rule_id);
    }
    for (const id of r.normalized_by) bump(profile.normalizations, id);
    if (r.record_type === 'purchase_order' && r.outcome === 'accepted' && r.clean) {
      const source = rawRows.find((x) => x.row_id === r.row_id)?.source_id.trim() ?? r.row_id;
      profile.accepted_purchase_order_totals[source] = (r.clean as PurchaseOrderClean).total;
    }
    profile.rows[r.row_id] = {
      outcome: r.outcome,
      reasons: r.reasons.map((x) => x.reason_code).sort(),
    };
  }
  return profile;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Canonical serialisation: sorted keys, 2-space indent, trailing newline. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}
