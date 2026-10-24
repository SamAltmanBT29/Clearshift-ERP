/**
 * ERP-3 Sales Orders & Invoices — V1 Data-Quality Rule Catalogue & Profiling Engine
 *
 * Pure, deterministic, zero-external-dependency (node:crypto only) rules that evaluate,
 * row by row, whether raw migration input for sales orders, order lines, invoices,
 * invoice lines, and payments is accepted, rejected, or held for explicit human review.
 *
 * Guarantees:
 *   - Raw input is never mutated (BR-KIT-03): rows are frozen on read; cleaning produces new objects.
 *   - Every rule has a stable rule_id, version, input condition, result, and reason code.
 *   - No fuzzy matching and no automatic destructive merge: candidate duplicates
 *     (order_number, invoice_number, payment_number) receive outcome 'review', never merged automatically.
 *   - Same fixture + same RULES_VERSION => byte-identical profile (via stableStringify).
 *   - Line subtotal, tax_amount, and line_total are calculated server-side (BR-ERP3-01, BR-ERP3-02).
 *   - Every sales order and invoice requires a valid customer Golden ID (BR-ERP3-03).
 *   - Mandatory due_date for invoices; status derived as Overdue when past due and unpaid (FR-ERP3-02).
 *   - Exactly one invoice per sales order in V1 (FR-ERP3-02).
 *   - Exactly one full payment per invoice in V1; partial payments and overpayments rejected (FR-ERP3-03, FR-ERP3-04).
 *   - Full payment auto-transitions invoice to Paid (FR-ERP3-04).
 *   - OWASP CSV formula injection defense (PLT-12 / KIT-16).
 *
 * Traceability: SDS ClearShift ERP v2.0 V1 — FR-ERP3-01..05, BR-ERP3-01..03; Project Plan v3.0 §7.8.
 *
 * @module erp3/migration/rules
 */

import { createHash } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Versions & Constants
// ─────────────────────────────────────────────────────────────────────────────

export const RULES_VERSION = '1.0.0';
export const FIXTURE_SCHEMA_VERSION = 1;
export const PROFILE_SCHEMA_VERSION = 1;
export const SOURCE_SYSTEM = 'SYNTH-ERP3-DIRTY-V1';
export const FIXTURE_PATH = 'sample-data/erp-3/dirty-data-v1.csv';

export const ACCEPTED_CURRENCIES = ['USD', 'EUR', 'INR'] as const;
export type AcceptedCurrency = (typeof ACCEPTED_CURRENCIES)[number];

export const SALES_ORDER_STATUSES = ['Open', 'Invoiced', 'Closed'] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const INVOICE_STATUSES = ['Open', 'Paid', 'Overdue'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'bank', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const RECORD_TYPES = [
  'sales_order',
  'so_line',
  'invoice',
  'invoice_line',
  'payment',
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const FIXTURE_COLUMNS = [
  'row_id',
  'record_type',
  'case_tags',
  'source_id',
  'parent_source_id',
  'order_number',
  'customer_golden_id',
  'order_date',
  'order_status',
  'currency',
  'notes',
  'line_number',
  'product_id',
  'description',
  'quantity',
  'unit_price',
  'tax_rate',
  'invoice_number',
  'invoice_date',
  'due_date',
  'invoice_status',
  'payment_number',
  'payment_date',
  'payment_amount',
  'payment_method',
  'payment_reference',
  'source_system',
  'expect_outcome',
  'expect_reasons',
] as const;

export type FixtureColumn = (typeof FIXTURE_COLUMNS)[number];

export const KNOWN_CUSTOMERS = [
  'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000003',
  'c0000000-0000-4000-8000-000000000004',
  'c0000000-0000-4000-8000-000000000005',
] as const;

export const KNOWN_PRODUCTS = [
  '5eed0000-0000-4000-8000-0000000000a1',
  '5eed0000-0000-4000-8000-0000000000a2',
  '5eed0000-0000-4000-8000-0000000000a3',
  '5eed0000-0000-4000-8000-0000000000a4',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Rule Catalogue Types
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
  | 'invariant'
  | 'security'
  | 'cascade';

export type RuleResult = 'reject' | 'normalize' | 'review' | 'derive';

export interface DataQualityRule {
  readonly rule_id: string;
  readonly version: string;
  readonly entity: RuleEntity;
  readonly field: string;
  readonly kind: RuleKind;
  readonly input_condition: string;
  readonly result: RuleResult;
  readonly reason_code?: string;
  readonly human_reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule Catalogue (Single Source of Truth)
// ─────────────────────────────────────────────────────────────────────────────

export const RULE_CATALOGUE: readonly DataQualityRule[] = [
  // ── Sales Orders: Required Fields ───────────────────────────────────────────
  {
    rule_id: 'SO-001',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'source_id',
    kind: 'required',
    input_condition: 'source_id is empty after trimming',
    result: 'reject',
    reason_code: 'SOURCE_ID_REQUIRED',
    human_reason: 'Source ID is required for lineage tracking.',
  },
  {
    rule_id: 'SO-002',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'order_number',
    kind: 'required',
    input_condition: 'order_number is empty after trimming',
    result: 'reject',
    reason_code: 'ORDER_NUMBER_REQUIRED',
    human_reason: 'Order number is required.',
  },
  {
    rule_id: 'SO-003',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'customer_golden_id',
    kind: 'required',
    input_condition: 'customer_golden_id is empty after trimming',
    result: 'reject',
    reason_code: 'CUSTOMER_GOLDEN_ID_REQUIRED',
    human_reason: 'Customer Golden ID is required (BR-ERP3-03).',
  },
  {
    rule_id: 'SO-004',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'order_date',
    kind: 'required',
    input_condition: 'order_date is empty after trimming',
    result: 'reject',
    reason_code: 'ORDER_DATE_REQUIRED',
    human_reason: 'Order date is required.',
  },
  {
    rule_id: 'SO-005',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'currency',
    kind: 'required',
    input_condition: 'currency is empty after trimming',
    result: 'reject',
    reason_code: 'CURRENCY_REQUIRED',
    human_reason: 'Currency code is required.',
  },
  {
    rule_id: 'SO-006',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'lines',
    kind: 'required',
    input_condition: 'sales order has zero lines',
    result: 'reject',
    reason_code: 'NO_LINES',
    human_reason: 'Sales order must have at least one line item.',
  },

  // ── Sales Orders: Normalization ─────────────────────────────────────────────
  {
    rule_id: 'SO-010',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'order_number',
    kind: 'normalize',
    input_condition: 'order_number contains leading/trailing whitespace or lowercase letters',
    result: 'normalize',
    human_reason: 'Order number is trimmed and converted to uppercase.',
  },
  {
    rule_id: 'SO-011',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'currency',
    kind: 'normalize',
    input_condition: 'currency contains leading/trailing whitespace or lowercase letters',
    result: 'normalize',
    human_reason: 'Currency is trimmed and converted to uppercase.',
  },
  {
    rule_id: 'SO-012',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'order_status',
    kind: 'normalize',
    input_condition: 'order_status contains surrounding whitespace or non-standard casing',
    result: 'normalize',
    human_reason: 'Order status is normalized to title case.',
  },
  {
    rule_id: 'SO-013',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'notes',
    kind: 'normalize',
    input_condition: 'notes contains surrounding whitespace or multiple spaces',
    result: 'normalize',
    human_reason: 'Notes are trimmed and consecutive spaces collapsed.',
  },

  // ── Sales Orders: Format & Constraints ──────────────────────────────────────
  {
    rule_id: 'SO-020',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'order_number',
    kind: 'format',
    input_condition: 'order_number contains characters outside [A-Za-z0-9_-]',
    result: 'reject',
    reason_code: 'INVALID_ORDER_NUMBER_FORMAT',
    human_reason: 'Order number must be alphanumeric with hyphens or underscores.',
  },
  {
    rule_id: 'SO-021',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'order_number',
    kind: 'length',
    input_condition: 'order_number exceeds 64 characters',
    result: 'reject',
    reason_code: 'ORDER_NUMBER_TOO_LONG',
    human_reason: 'Order number exceeds 64 characters.',
  },
  {
    rule_id: 'SO-022',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'customer_golden_id',
    kind: 'format',
    input_condition: 'customer_golden_id is not a valid UUID format',
    result: 'reject',
    reason_code: 'INVALID_CUSTOMER_GOLDEN_ID',
    human_reason: 'Customer Golden ID must be a valid UUID string.',
  },
  {
    rule_id: 'SO-023',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'customer_golden_id',
    kind: 'reference',
    input_condition: 'customer_golden_id is not found in known customer registry',
    result: 'reject',
    reason_code: 'CUSTOMER_NOT_FOUND',
    human_reason: 'Customer Golden ID not found in Hub customer directory.',
  },
  {
    rule_id: 'SO-024',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'order_date',
    kind: 'format',
    input_condition: 'order_date is not a valid ISO 8601 YYYY-MM-DD calendar date',
    result: 'reject',
    reason_code: 'INVALID_DATE',
    human_reason: 'Order date must be a valid calendar date in YYYY-MM-DD format.',
  },
  {
    rule_id: 'SO-025',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'order_status',
    kind: 'enum',
    input_condition: 'order_status is not Open, Invoiced, or Closed',
    result: 'reject',
    reason_code: 'INVALID_STATUS',
    human_reason: 'Order status must be Open, Invoiced, or Closed.',
  },
  {
    rule_id: 'SO-026',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'currency',
    kind: 'enum',
    input_condition: 'currency is not USD, EUR, or INR',
    result: 'reject',
    reason_code: 'INVALID_CURRENCY',
    human_reason: 'Currency must be one of USD, EUR, or INR.',
  },
  {
    rule_id: 'SO-027',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'notes',
    kind: 'length',
    input_condition: 'notes exceeds 1000 characters',
    result: 'reject',
    reason_code: 'NOTES_TOO_LONG',
    human_reason: 'Order notes cannot exceed 1000 characters.',
  },

  // ── Sales Orders: Duplicates & Reviews ──────────────────────────────────────
  {
    rule_id: 'SO-030',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'order_number',
    kind: 'duplicate',
    input_condition: 'order_number has already been seen in dataset',
    result: 'review',
    reason_code: 'DUPLICATE_ORDER_NUMBER_REVIEW',
    human_reason: 'Candidate duplicate order number routed to human review.',
  },

  // ── Sales Orders: Cascade & Security ────────────────────────────────────────
  {
    rule_id: 'SO-040',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'lines',
    kind: 'cascade',
    input_condition: 'one or more child order lines failed validation',
    result: 'reject',
    reason_code: 'LINE_REJECTED',
    human_reason: 'Sales order rejected because one or more order lines failed validation.',
  },
  {
    rule_id: 'SO-050',
    version: '1.0.0',
    entity: 'sales_order',
    field: 'notes',
    kind: 'security',
    input_condition: 'notes begins with =, +, -, @, \\t, or \\r',
    result: 'reject',
    reason_code: 'FORMULA_INJECTION_DETECTED',
    human_reason: 'Potential CSV formula injection detected in order notes.',
  },

  // ── Sales Order Lines: Required Fields ──────────────────────────────────────
  {
    rule_id: 'SOL-001',
    version: '1.0.0',
    entity: 'so_line',
    field: 'source_id',
    kind: 'required',
    input_condition: 'source_id is empty after trimming',
    result: 'reject',
    reason_code: 'SOURCE_ID_REQUIRED',
    human_reason: 'Line source ID is required.',
  },
  {
    rule_id: 'SOL-002',
    version: '1.0.0',
    entity: 'so_line',
    field: 'parent_source_id',
    kind: 'required',
    input_condition: 'parent_source_id is empty after trimming',
    result: 'reject',
    reason_code: 'PARENT_SOURCE_ID_REQUIRED',
    human_reason: 'Order line must reference a parent sales order source ID.',
  },
  {
    rule_id: 'SOL-003',
    version: '1.0.0',
    entity: 'so_line',
    field: 'product_id',
    kind: 'required',
    input_condition: 'product_id is empty after trimming',
    result: 'reject',
    reason_code: 'PRODUCT_ID_REQUIRED',
    human_reason: 'Product ID is required for order line item.',
  },
  {
    rule_id: 'SOL-004',
    version: '1.0.0',
    entity: 'so_line',
    field: 'quantity',
    kind: 'required',
    input_condition: 'quantity is empty after trimming',
    result: 'reject',
    reason_code: 'QUANTITY_REQUIRED',
    human_reason: 'Quantity is required for order line item.',
  },
  {
    rule_id: 'SOL-005',
    version: '1.0.0',
    entity: 'so_line',
    field: 'unit_price',
    kind: 'required',
    input_condition: 'unit_price is empty after trimming',
    result: 'reject',
    reason_code: 'UNIT_PRICE_REQUIRED',
    human_reason: 'Unit price is required for order line item.',
  },
  {
    rule_id: 'SOL-006',
    version: '1.0.0',
    entity: 'so_line',
    field: 'tax_rate',
    kind: 'required',
    input_condition: 'tax_rate is empty after trimming',
    result: 'reject',
    reason_code: 'TAX_RATE_REQUIRED',
    human_reason: 'Tax rate percentage is required for order line item.',
  },

  // ── Sales Order Lines: Normalization & Formats ──────────────────────────────
  {
    rule_id: 'SOL-010',
    version: '1.0.0',
    entity: 'so_line',
    field: 'quantity',
    kind: 'normalize',
    input_condition: 'quantity contains whitespace or formatting commas',
    result: 'normalize',
    human_reason: 'Quantity is stripped of whitespace and commas.',
  },
  {
    rule_id: 'SOL-011',
    version: '1.0.0',
    entity: 'so_line',
    field: 'unit_price',
    kind: 'normalize',
    input_condition: 'unit_price contains whitespace or formatting commas',
    result: 'normalize',
    human_reason: 'Unit price is stripped of whitespace and commas.',
  },
  {
    rule_id: 'SOL-012',
    version: '1.0.0',
    entity: 'so_line',
    field: 'tax_rate',
    kind: 'normalize',
    input_condition: 'tax_rate contains whitespace',
    result: 'normalize',
    human_reason: 'Tax rate is stripped of whitespace.',
  },
  {
    rule_id: 'SOL-020',
    version: '1.0.0',
    entity: 'so_line',
    field: 'parent_source_id',
    kind: 'reference',
    input_condition: 'parent_source_id does not match any sales order in dataset',
    result: 'reject',
    reason_code: 'ORPHAN_LINE',
    human_reason: 'Order line parent sales order was not found.',
  },
  {
    rule_id: 'SOL-021',
    version: '1.0.0',
    entity: 'so_line',
    field: 'product_id',
    kind: 'format',
    input_condition: 'product_id is not a valid UUID format',
    result: 'reject',
    reason_code: 'INVALID_PRODUCT_ID',
    human_reason: 'Product ID must be a valid UUID string.',
  },
  {
    rule_id: 'SOL-022',
    version: '1.0.0',
    entity: 'so_line',
    field: 'product_id',
    kind: 'reference',
    input_condition: 'product_id is not found in known product catalog',
    result: 'reject',
    reason_code: 'PRODUCT_NOT_FOUND',
    human_reason: 'Product ID does not match any product in inventory.',
  },
  {
    rule_id: 'SOL-023',
    version: '1.0.0',
    entity: 'so_line',
    field: 'quantity',
    kind: 'format',
    input_condition: 'quantity is not a valid non-negative decimal string',
    result: 'reject',
    reason_code: 'INVALID_QUANTITY',
    human_reason: 'Quantity must be a valid numeric decimal.',
  },
  {
    rule_id: 'SOL-024',
    version: '1.0.0',
    entity: 'so_line',
    field: 'quantity',
    kind: 'invariant',
    input_condition: 'quantity <= 0',
    result: 'reject',
    reason_code: 'NEGATIVE_OR_ZERO_QUANTITY',
    human_reason: 'Order line quantity must be strictly greater than zero.',
  },
  {
    rule_id: 'SOL-025',
    version: '1.0.0',
    entity: 'so_line',
    field: 'unit_price',
    kind: 'format',
    input_condition: 'unit_price is not a valid non-negative decimal string',
    result: 'reject',
    reason_code: 'INVALID_UNIT_PRICE',
    human_reason: 'Unit price must be a valid numeric decimal.',
  },
  {
    rule_id: 'SOL-026',
    version: '1.0.0',
    entity: 'so_line',
    field: 'unit_price',
    kind: 'invariant',
    input_condition: 'unit_price < 0',
    result: 'reject',
    reason_code: 'NEGATIVE_UNIT_PRICE',
    human_reason: 'Unit price cannot be negative.',
  },
  {
    rule_id: 'SOL-027',
    version: '1.0.0',
    entity: 'so_line',
    field: 'tax_rate',
    kind: 'format',
    input_condition: 'tax_rate is not a valid numeric decimal',
    result: 'reject',
    reason_code: 'INVALID_TAX_RATE',
    human_reason: 'Tax rate must be a valid numeric decimal percentage.',
  },
  {
    rule_id: 'SOL-028',
    version: '1.0.0',
    entity: 'so_line',
    field: 'tax_rate',
    kind: 'invariant',
    input_condition: 'tax_rate < 0 or tax_rate > 100',
    result: 'reject',
    reason_code: 'TAX_RATE_OUT_OF_RANGE',
    human_reason: 'Tax rate must be between 0 and 100 percent.',
  },
  {
    rule_id: 'SOL-029',
    version: '1.0.0',
    entity: 'so_line',
    field: 'line_number',
    kind: 'duplicate',
    input_condition: 'line_number is duplicated within the same sales order',
    result: 'reject',
    reason_code: 'DUPLICATE_LINE_NUMBER',
    human_reason: 'Line number is duplicated within the sales order.',
  },
  {
    rule_id: 'SOL-040',
    version: '1.0.0',
    entity: 'so_line',
    field: 'parent_source_id',
    kind: 'cascade',
    input_condition: 'parent sales order was rejected',
    result: 'reject',
    reason_code: 'PARENT_ORDER_REJECTED',
    human_reason: 'Order line rejected because parent sales order was rejected.',
  },
  {
    rule_id: 'SOL-041',
    version: '1.0.0',
    entity: 'so_line',
    field: 'parent_source_id',
    kind: 'cascade',
    input_condition: 'parent sales order was held in review',
    result: 'review',
    reason_code: 'PARENT_ORDER_IN_REVIEW',
    human_reason: 'Order line held in review because parent sales order is in review.',
  },

  // ── Invoices: Required Fields ───────────────────────────────────────────────
  {
    rule_id: 'INV-001',
    version: '1.0.0',
    entity: 'invoice',
    field: 'source_id',
    kind: 'required',
    input_condition: 'source_id is empty after trimming',
    result: 'reject',
    reason_code: 'SOURCE_ID_REQUIRED',
    human_reason: 'Invoice source ID is required.',
  },
  {
    rule_id: 'INV-002',
    version: '1.0.0',
    entity: 'invoice',
    field: 'invoice_number',
    kind: 'required',
    input_condition: 'invoice_number is empty after trimming',
    result: 'reject',
    reason_code: 'INVOICE_NUMBER_REQUIRED',
    human_reason: 'Invoice number is required.',
  },
  {
    rule_id: 'INV-003',
    version: '1.0.0',
    entity: 'invoice',
    field: 'customer_golden_id',
    kind: 'required',
    input_condition: 'customer_golden_id is empty after trimming',
    result: 'reject',
    reason_code: 'CUSTOMER_GOLDEN_ID_REQUIRED',
    human_reason: 'Customer Golden ID is required for invoice.',
  },
  {
    rule_id: 'INV-004',
    version: '1.0.0',
    entity: 'invoice',
    field: 'invoice_date',
    kind: 'required',
    input_condition: 'invoice_date is empty after trimming',
    result: 'reject',
    reason_code: 'INVOICE_DATE_REQUIRED',
    human_reason: 'Invoice date is required.',
  },
  {
    rule_id: 'INV-005',
    version: '1.0.0',
    entity: 'invoice',
    field: 'due_date',
    kind: 'required',
    input_condition: 'due_date is empty after trimming',
    result: 'reject',
    reason_code: 'DUE_DATE_REQUIRED',
    human_reason: 'Due date is mandatory for overdue calculation (FR-ERP3-02).',
  },
  {
    rule_id: 'INV-006',
    version: '1.0.0',
    entity: 'invoice',
    field: 'currency',
    kind: 'required',
    input_condition: 'currency is empty after trimming',
    result: 'reject',
    reason_code: 'CURRENCY_REQUIRED',
    human_reason: 'Currency code is required for invoice.',
  },
  {
    rule_id: 'INV-007',
    version: '1.0.0',
    entity: 'invoice',
    field: 'lines',
    kind: 'required',
    input_condition: 'standalone invoice has no invoice lines',
    result: 'reject',
    reason_code: 'NO_LINES',
    human_reason: 'Standalone invoice must have at least one line item.',
  },

  // ── Invoices: Normalization & Formats ───────────────────────────────────────
  {
    rule_id: 'INV-010',
    version: '1.0.0',
    entity: 'invoice',
    field: 'invoice_number',
    kind: 'normalize',
    input_condition: 'invoice_number contains whitespace or lowercase characters',
    result: 'normalize',
    human_reason: 'Invoice number is trimmed and upper-cased.',
  },
  {
    rule_id: 'INV-011',
    version: '1.0.0',
    entity: 'invoice',
    field: 'currency',
    kind: 'normalize',
    input_condition: 'currency contains whitespace or lowercase characters',
    result: 'normalize',
    human_reason: 'Currency is trimmed and upper-cased.',
  },
  {
    rule_id: 'INV-020',
    version: '1.0.0',
    entity: 'invoice',
    field: 'invoice_number',
    kind: 'format',
    input_condition: 'invoice_number contains characters outside [A-Za-z0-9_-]',
    result: 'reject',
    reason_code: 'INVALID_INVOICE_NUMBER_FORMAT',
    human_reason: 'Invoice number must be alphanumeric with hyphens or underscores.',
  },
  {
    rule_id: 'INV-021',
    version: '1.0.0',
    entity: 'invoice',
    field: 'invoice_number',
    kind: 'length',
    input_condition: 'invoice_number exceeds 64 characters',
    result: 'reject',
    reason_code: 'INVOICE_NUMBER_TOO_LONG',
    human_reason: 'Invoice number cannot exceed 64 characters.',
  },
  {
    rule_id: 'INV-022',
    version: '1.0.0',
    entity: 'invoice',
    field: 'customer_golden_id',
    kind: 'format',
    input_condition: 'customer_golden_id is not a valid UUID format',
    result: 'reject',
    reason_code: 'INVALID_CUSTOMER_GOLDEN_ID',
    human_reason: 'Customer Golden ID must be a valid UUID string.',
  },
  {
    rule_id: 'INV-023',
    version: '1.0.0',
    entity: 'invoice',
    field: 'customer_golden_id',
    kind: 'reference',
    input_condition: 'customer_golden_id is not found in known customer registry',
    result: 'reject',
    reason_code: 'CUSTOMER_NOT_FOUND',
    human_reason: 'Customer Golden ID not found in Hub directory.',
  },
  {
    rule_id: 'INV-024',
    version: '1.0.0',
    entity: 'invoice',
    field: 'invoice_date',
    kind: 'format',
    input_condition: 'invoice_date is not a valid ISO 8601 YYYY-MM-DD date',
    result: 'reject',
    reason_code: 'INVALID_DATE',
    human_reason: 'Invoice date must be a valid calendar date in YYYY-MM-DD format.',
  },
  {
    rule_id: 'INV-025',
    version: '1.0.0',
    entity: 'invoice',
    field: 'due_date',
    kind: 'invariant',
    input_condition: 'due_date is not a valid date or is before invoice_date',
    result: 'reject',
    reason_code: 'INVALID_DUE_DATE',
    human_reason: 'Due date must be on or after invoice date.',
  },
  {
    rule_id: 'INV-026',
    version: '1.0.0',
    entity: 'invoice',
    field: 'currency',
    kind: 'enum',
    input_condition: 'currency is not USD, EUR, or INR',
    result: 'reject',
    reason_code: 'INVALID_CURRENCY',
    human_reason: 'Invoice currency must be USD, EUR, or INR.',
  },
  {
    rule_id: 'INV-027',
    version: '1.0.0',
    entity: 'invoice',
    field: 'parent_source_id',
    kind: 'reference',
    input_condition: 'parent_source_id does not match any sales order in dataset',
    result: 'reject',
    reason_code: 'ORDER_NOT_FOUND',
    human_reason: 'Referenced sales order was not found.',
  },
  {
    rule_id: 'INV-028',
    version: '1.0.0',
    entity: 'invoice',
    field: 'parent_source_id',
    kind: 'invariant',
    input_condition: 'referenced sales order is already linked to another invoice in V1',
    result: 'reject',
    reason_code: 'ORDER_ALREADY_INVOICED',
    human_reason: 'Sales order already has an invoice (at most one invoice per order in V1).',
  },
  {
    rule_id: 'INV-029',
    version: '1.0.0',
    entity: 'invoice',
    field: 'customer_golden_id',
    kind: 'invariant',
    input_condition: 'invoice customer_golden_id does not match parent order customer_golden_id',
    result: 'reject',
    reason_code: 'CUSTOMER_MISMATCH',
    human_reason: 'Invoice customer does not match the linked sales order customer.',
  },
  {
    rule_id: 'INV-030',
    version: '1.0.0',
    entity: 'invoice',
    field: 'invoice_number',
    kind: 'duplicate',
    input_condition: 'invoice_number has already been seen in dataset',
    result: 'review',
    reason_code: 'DUPLICATE_INVOICE_NUMBER_REVIEW',
    human_reason: 'Candidate duplicate invoice number routed to human review.',
  },
  {
    rule_id: 'INV-040',
    version: '1.0.0',
    entity: 'invoice',
    field: 'lines',
    kind: 'cascade',
    input_condition: 'one or more child invoice lines failed validation',
    result: 'reject',
    reason_code: 'LINE_REJECTED',
    human_reason: 'Invoice rejected because one or more invoice lines failed validation.',
  },
  {
    rule_id: 'INV-050',
    version: '1.0.0',
    entity: 'invoice',
    field: 'notes',
    kind: 'security',
    input_condition: 'notes begins with formula injection prefix',
    result: 'reject',
    reason_code: 'FORMULA_INJECTION_DETECTED',
    human_reason: 'Potential CSV formula injection detected in invoice notes.',
  },

  // ── Invoice Lines: Required & Validations ───────────────────────────────────
  {
    rule_id: 'INL-001',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'source_id',
    kind: 'required',
    input_condition: 'source_id is empty after trimming',
    result: 'reject',
    reason_code: 'SOURCE_ID_REQUIRED',
    human_reason: 'Invoice line source ID is required.',
  },
  {
    rule_id: 'INL-002',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'parent_source_id',
    kind: 'required',
    input_condition: 'parent_source_id is empty after trimming',
    result: 'reject',
    reason_code: 'PARENT_SOURCE_ID_REQUIRED',
    human_reason: 'Invoice line must reference a parent invoice.',
  },
  {
    rule_id: 'INL-003',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'product_id',
    kind: 'required',
    input_condition: 'product_id is empty after trimming',
    result: 'reject',
    reason_code: 'PRODUCT_ID_REQUIRED',
    human_reason: 'Product ID is required for invoice line.',
  },
  {
    rule_id: 'INL-004',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'quantity',
    kind: 'required',
    input_condition: 'quantity is empty after trimming',
    result: 'reject',
    reason_code: 'QUANTITY_REQUIRED',
    human_reason: 'Quantity is required for invoice line.',
  },
  {
    rule_id: 'INL-005',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'unit_price',
    kind: 'required',
    input_condition: 'unit_price is empty after trimming',
    result: 'reject',
    reason_code: 'UNIT_PRICE_REQUIRED',
    human_reason: 'Unit price is required for invoice line.',
  },
  {
    rule_id: 'INL-006',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'tax_rate',
    kind: 'required',
    input_condition: 'tax_rate is empty after trimming',
    result: 'reject',
    reason_code: 'TAX_RATE_REQUIRED',
    human_reason: 'Tax rate percentage is required for invoice line.',
  },
  {
    rule_id: 'INL-020',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'parent_source_id',
    kind: 'reference',
    input_condition: 'parent_source_id does not match any invoice in dataset',
    result: 'reject',
    reason_code: 'ORPHAN_LINE',
    human_reason: 'Invoice line parent invoice was not found.',
  },
  {
    rule_id: 'INL-021',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'product_id',
    kind: 'format',
    input_condition: 'product_id is not a valid UUID format',
    result: 'reject',
    reason_code: 'INVALID_PRODUCT_ID',
    human_reason: 'Product ID must be a valid UUID string.',
  },
  {
    rule_id: 'INL-022',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'quantity',
    kind: 'invariant',
    input_condition: 'quantity <= 0 or not decimal',
    result: 'reject',
    reason_code: 'NEGATIVE_OR_ZERO_QUANTITY',
    human_reason: 'Invoice line quantity must be strictly greater than zero.',
  },
  {
    rule_id: 'INL-023',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'unit_price',
    kind: 'invariant',
    input_condition: 'unit_price < 0 or not decimal',
    result: 'reject',
    reason_code: 'NEGATIVE_UNIT_PRICE',
    human_reason: 'Invoice line unit price cannot be negative.',
  },
  {
    rule_id: 'INL-024',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'tax_rate',
    kind: 'invariant',
    input_condition: 'tax_rate < 0 or tax_rate > 100',
    result: 'reject',
    reason_code: 'TAX_RATE_OUT_OF_RANGE',
    human_reason: 'Tax rate must be between 0 and 100 percent.',
  },
  {
    rule_id: 'INL-040',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'parent_source_id',
    kind: 'cascade',
    input_condition: 'parent invoice was rejected',
    result: 'reject',
    reason_code: 'PARENT_INVOICE_REJECTED',
    human_reason: 'Invoice line rejected because parent invoice was rejected.',
  },
  {
    rule_id: 'INL-041',
    version: '1.0.0',
    entity: 'invoice_line',
    field: 'parent_source_id',
    kind: 'cascade',
    input_condition: 'parent invoice was held in review',
    result: 'review',
    reason_code: 'PARENT_INVOICE_IN_REVIEW',
    human_reason: 'Invoice line held in review because parent invoice is in review.',
  },

  // ── Payments: Required & Constraints ────────────────────────────────────────
  {
    rule_id: 'PAY-001',
    version: '1.0.0',
    entity: 'payment',
    field: 'source_id',
    kind: 'required',
    input_condition: 'source_id is empty after trimming',
    result: 'reject',
    reason_code: 'SOURCE_ID_REQUIRED',
    human_reason: 'Payment source ID is required.',
  },
  {
    rule_id: 'PAY-002',
    version: '1.0.0',
    entity: 'payment',
    field: 'parent_source_id',
    kind: 'required',
    input_condition: 'parent_source_id is empty after trimming',
    result: 'reject',
    reason_code: 'PARENT_SOURCE_ID_REQUIRED',
    human_reason: 'Payment must reference a parent invoice.',
  },
  {
    rule_id: 'PAY-003',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_date',
    kind: 'required',
    input_condition: 'payment_date is empty after trimming',
    result: 'reject',
    reason_code: 'PAYMENT_DATE_REQUIRED',
    human_reason: 'Payment date is required.',
  },
  {
    rule_id: 'PAY-004',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_amount',
    kind: 'required',
    input_condition: 'payment_amount is empty after trimming',
    result: 'reject',
    reason_code: 'PAYMENT_AMOUNT_REQUIRED',
    human_reason: 'Payment amount is required.',
  },
  {
    rule_id: 'PAY-005',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_method',
    kind: 'required',
    input_condition: 'payment_method is empty after trimming',
    result: 'reject',
    reason_code: 'PAYMENT_METHOD_REQUIRED',
    human_reason: 'Payment method is required (cash, bank, or card).',
  },
  {
    rule_id: 'PAY-010',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_method',
    kind: 'normalize',
    input_condition: 'payment_method contains whitespace or uppercase letters',
    result: 'normalize',
    human_reason: 'Payment method is trimmed and converted to lowercase.',
  },
  {
    rule_id: 'PAY-011',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_number',
    kind: 'normalize',
    input_condition: 'payment_number contains whitespace',
    result: 'normalize',
    human_reason: 'Payment number is trimmed and upper-cased.',
  },
  {
    rule_id: 'PAY-020',
    version: '1.0.0',
    entity: 'payment',
    field: 'parent_source_id',
    kind: 'reference',
    input_condition: 'parent_source_id does not match any invoice in dataset',
    result: 'reject',
    reason_code: 'INVOICE_NOT_FOUND',
    human_reason: 'Referenced invoice for payment was not found.',
  },
  {
    rule_id: 'PAY-021',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_date',
    kind: 'format',
    input_condition: 'payment_date is not a valid ISO 8601 YYYY-MM-DD date',
    result: 'reject',
    reason_code: 'INVALID_DATE',
    human_reason: 'Payment date must be a valid calendar date in YYYY-MM-DD format.',
  },
  {
    rule_id: 'PAY-022',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_amount',
    kind: 'format',
    input_condition: 'payment_amount is not a valid decimal string',
    result: 'reject',
    reason_code: 'INVALID_PAYMENT_AMOUNT',
    human_reason: 'Payment amount must be a valid numeric decimal.',
  },
  {
    rule_id: 'PAY-023',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_amount',
    kind: 'invariant',
    input_condition: 'payment_amount <= 0',
    result: 'reject',
    reason_code: 'NEGATIVE_OR_ZERO_PAYMENT',
    human_reason: 'Payment amount must be strictly greater than zero.',
  },
  {
    rule_id: 'PAY-024',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_method',
    kind: 'enum',
    input_condition: 'payment_method is not cash, bank, or card',
    result: 'reject',
    reason_code: 'INVALID_PAYMENT_METHOD',
    human_reason: 'Payment method must be one of cash, bank, or card (FR-ERP3-03).',
  },
  {
    rule_id: 'PAY-025',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_amount',
    kind: 'invariant',
    input_condition: 'payment_amount < invoice.total',
    result: 'reject',
    reason_code: 'PARTIAL_PAYMENT_NOT_ALLOWED',
    human_reason: 'V1 accepts one full payment only; partial payments are rejected.',
  },
  {
    rule_id: 'PAY-026',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_amount',
    kind: 'invariant',
    input_condition: 'payment_amount > invoice.total',
    result: 'reject',
    reason_code: 'OVERPAYMENT_REJECTED',
    human_reason: 'Payment amount exceeds invoice total; overpayments are rejected in V1.',
  },
  {
    rule_id: 'PAY-027',
    version: '1.0.0',
    entity: 'payment',
    field: 'parent_source_id',
    kind: 'invariant',
    input_condition: 'invoice already has an accepted payment',
    result: 'reject',
    reason_code: 'MULTIPLE_PAYMENTS_REJECTED',
    human_reason: 'Invoice already has an accepted payment; multiple payments rejected in V1.',
  },
  {
    rule_id: 'PAY-030',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_number',
    kind: 'duplicate',
    input_condition: 'payment_number has already been seen in dataset',
    result: 'review',
    reason_code: 'DUPLICATE_PAYMENT_REVIEW',
    human_reason: 'Candidate duplicate payment number routed to human review.',
  },
  {
    rule_id: 'PAY-040',
    version: '1.0.0',
    entity: 'payment',
    field: 'parent_source_id',
    kind: 'cascade',
    input_condition: 'parent invoice was rejected',
    result: 'reject',
    reason_code: 'PARENT_INVOICE_REJECTED',
    human_reason: 'Payment rejected because parent invoice was rejected.',
  },
  {
    rule_id: 'PAY-050',
    version: '1.0.0',
    entity: 'payment',
    field: 'payment_reference',
    kind: 'security',
    input_condition: 'payment_reference begins with formula injection prefix',
    result: 'reject',
    reason_code: 'FORMULA_INJECTION_DETECTED',
    human_reason: 'Potential CSV formula injection detected in payment reference.',
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Raw CSV Parser & Data Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RawRow {
  readonly line_number: number;
  readonly row_id: string;
  readonly record_type: string;
  readonly case_tags: string;
  readonly source_id: string;
  readonly parent_source_id: string;
  readonly order_number: string;
  readonly customer_golden_id: string;
  readonly order_date: string;
  readonly order_status: string;
  readonly currency: string;
  readonly notes: string;
  readonly line_number_field: string;
  readonly product_id: string;
  readonly description: string;
  readonly quantity: string;
  readonly unit_price: string;
  readonly tax_rate: string;
  readonly invoice_number: string;
  readonly invoice_date: string;
  readonly due_date: string;
  readonly invoice_status: string;
  readonly payment_number: string;
  readonly payment_date: string;
  readonly payment_amount: string;
  readonly payment_method: string;
  readonly payment_reference: string;
  readonly source_system: string;
  readonly expect_outcome: string;
  readonly expect_reasons: string;
}

export type RowOutcome = 'accepted' | 'rejected' | 'review' | 'skipped';

export interface RowEvaluation {
  readonly line_number: number;
  readonly row_id: string;
  readonly record_type: RecordType;
  readonly outcome: RowOutcome;
  readonly applied_rules: readonly string[];
  readonly reasons: readonly string[];
  readonly normalizations: readonly string[];
  readonly cleaned_data?: Record<string, unknown>;
}

export interface DatasetEvaluationResult {
  readonly total_source_rows: number;
  readonly rowResults: readonly RowEvaluation[];
  readonly reconciliation: {
    readonly total_source_rows: number;
    readonly accepted: number;
    readonly rejected: number;
    readonly review: number;
    readonly skipped: number;
    readonly unaccounted: number;
    readonly is_balanced: boolean;
  };
  readonly recordTypeCounts: Record<
    RecordType,
    { accepted: number; rejected: number; review: number; skipped: number; total: number }
  >;
  readonly ruleHitsCount: Record<string, number>;
  readonly reasonCodeCount: Record<string, number>;
  readonly normalizationsCount: Record<string, number>;
  readonly totalsByCurrency: Record<
    string,
    {
      order_total: string;
      invoice_total: string;
      payment_total: string;
      order_count: number;
      invoice_count: number;
      payment_count: number;
    }
  >;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: Decimal & Date & CSV
// ─────────────────────────────────────────────────────────────────────────────

const SCALE_4DP = 10_000n;

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function isValidUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    str.trim(),
  );
}

export function isValidCalendarDate(str: string): boolean {
  const trimmed = str.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const [y, m, d] = trimmed.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function parseScaled4Dp(val: string): bigint | null {
  const trimmed = val.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,4})?$/.test(trimmed)) return null;
  const [intPart = '0', fracPart = ''] = trimmed.split('.');
  const paddedFrac = (fracPart + '0000').slice(0, 4);
  return BigInt(intPart) * SCALE_4DP + BigInt(paddedFrac);
}

export function parseScaled4DpSigned(val: string): bigint | null {
  const trimmed = val.trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,4})?$/.test(trimmed)) return null;
  const isNeg = trimmed.startsWith('-');
  const unsigned = isNeg ? trimmed.slice(1) : trimmed;
  const [intPart = '0', fracPart = ''] = unsigned.split('.');
  const paddedFrac = (fracPart + '0000').slice(0, 4);
  const scaled = BigInt(intPart) * SCALE_4DP + BigInt(paddedFrac);
  return isNeg ? -scaled : scaled;
}

export function formatScaled4Dp(scaled: bigint): string {
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const intPart = abs / SCALE_4DP;
  const fracPart = (abs % SCALE_4DP).toString().padStart(4, '0');
  return `${neg ? '-' : ''}${intPart}.${fracPart}`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++;
        } else {
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
      } else if (char === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

export function readRawRows(csvText: string): readonly RawRow[] {
  const parsed = parseCsv(csvText);
  if (parsed.length === 0) return [];

  const header = parsed[0] ?? [];
  if (header.join(',') !== FIXTURE_COLUMNS.join(',')) {
    throw new Error(
      `CSV header mismatch.\nExpected: ${FIXTURE_COLUMNS.join(',')}\nActual:   ${header.join(',')}`,
    );
  }

  const rawRows: RawRow[] = [];
  for (let idx = 1; idx < parsed.length; idx++) {
    const cells = parsed[idx];
    if (!cells || cells.length === 0 || (cells.length === 1 && !cells[0]?.trim())) {
      continue;
    }

    const rowObj: RawRow = Object.freeze({
      line_number: idx + 1,
      row_id: cells[0]?.trim() ?? '',
      record_type: cells[1]?.trim() ?? '',
      case_tags: cells[2]?.trim() ?? '',
      source_id: cells[3]?.trim() ?? '',
      parent_source_id: cells[4]?.trim() ?? '',
      order_number: cells[5] ?? '',
      customer_golden_id: cells[6] ?? '',
      order_date: cells[7] ?? '',
      order_status: cells[8] ?? '',
      currency: cells[9] ?? '',
      notes: cells[10] ?? '',
      line_number_field: cells[11] ?? '',
      product_id: cells[12] ?? '',
      description: cells[13] ?? '',
      quantity: cells[14] ?? '',
      unit_price: cells[15] ?? '',
      tax_rate: cells[16] ?? '',
      invoice_number: cells[17] ?? '',
      invoice_date: cells[18] ?? '',
      due_date: cells[19] ?? '',
      invoice_status: cells[20] ?? '',
      payment_number: cells[21] ?? '',
      payment_date: cells[22] ?? '',
      payment_amount: cells[23] ?? '',
      payment_method: cells[24] ?? '',
      payment_reference: cells[25] ?? '',
      source_system: cells[26] ?? '',
      expect_outcome: cells[27]?.trim() ?? '',
      expect_reasons: cells[28]?.trim() ?? '',
    });

    rawRows.push(rowObj);
  }

  return Object.freeze(rawRows);
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation Engine
// ─────────────────────────────────────────────────────────────────────────────

export interface EvaluationOptions {
  readonly asOfDate?: string; // Current date for overdue evaluation (defaults to '2026-10-24')
}

export function evaluateDataset(
  rawRows: readonly RawRow[],
  options: EvaluationOptions = {},
): DatasetEvaluationResult {
  const asOfDate = options.asOfDate ?? '2026-10-24';

  const ruleHitsCount: Record<string, number> = {};
  const reasonCodeCount: Record<string, number> = {};
  const normalizationsCount: Record<string, number> = {};

  const incRule = (ruleId: string): void => {
    ruleHitsCount[ruleId] = (ruleHitsCount[ruleId] ?? 0) + 1;
  };
  const incReason = (reasonCode: string): void => {
    reasonCodeCount[reasonCode] = (reasonCodeCount[reasonCode] ?? 0) + 1;
  };
  const incNorm = (ruleId: string): void => {
    normalizationsCount[ruleId] = (normalizationsCount[ruleId] ?? 0) + 1;
  };

  const recordTypeCounts: Record<
    RecordType,
    { accepted: number; rejected: number; review: number; skipped: number; total: number }
  > = {
    sales_order: { accepted: 0, rejected: 0, review: 0, skipped: 0, total: 0 },
    so_line: { accepted: 0, rejected: 0, review: 0, skipped: 0, total: 0 },
    invoice: { accepted: 0, rejected: 0, review: 0, skipped: 0, total: 0 },
    invoice_line: { accepted: 0, rejected: 0, review: 0, skipped: 0, total: 0 },
    payment: { accepted: 0, rejected: 0, review: 0, skipped: 0, total: 0 },
  };

  const totalsByCurrency: Record<
    string,
    {
      order_total: string;
      invoice_total: string;
      payment_total: string;
      order_count: number;
      invoice_count: number;
      payment_count: number;
    }
  > = {};

  const ensureCurrencyBucket = (curr: string) => {
    if (!totalsByCurrency[curr]) {
      totalsByCurrency[curr] = {
        order_total: '0.0000',
        invoice_total: '0.0000',
        payment_total: '0.0000',
        order_count: 0,
        invoice_count: 0,
        payment_count: 0,
      };
    }
  };

  // Indexes for relationship resolution
  const soRowsBySourceId = new Map<string, RawRow>();
  const soLinesByParentId = new Map<string, RawRow[]>();
  const invRowsBySourceId = new Map<string, RawRow>();
  const invLinesByParentId = new Map<string, RawRow[]>();
  const paymentsByInvoiceId = new Map<string, RawRow[]>();

  for (const r of rawRows) {
    if (r.record_type === 'sales_order' && r.source_id) {
      soRowsBySourceId.set(r.source_id, r);
    } else if (r.record_type === 'so_line') {
      const parent = r.parent_source_id;
      if (!soLinesByParentId.has(parent)) soLinesByParentId.set(parent, []);
      soLinesByParentId.get(parent)?.push(r);
    } else if (r.record_type === 'invoice' && r.source_id) {
      invRowsBySourceId.set(r.source_id, r);
    } else if (r.record_type === 'invoice_line') {
      const parent = r.parent_source_id;
      if (!invLinesByParentId.has(parent)) invLinesByParentId.set(parent, []);
      invLinesByParentId.get(parent)?.push(r);
    } else if (r.record_type === 'payment') {
      const parent = r.parent_source_id;
      if (!paymentsByInvoiceId.has(parent)) paymentsByInvoiceId.set(parent, []);
      paymentsByInvoiceId.get(parent)?.push(r);
    }
  }

  // Exact duplicate tracking
  const seenOrderNumbers = new Set<string>();
  const seenInvoiceNumbers = new Set<string>();
  const seenPaymentNumbers = new Set<string>();
  const invoicedOrderIds = new Set<string>();

  // Intermediate state maps
  const orderEvaluations = new Map<
    string,
    { outcome: RowOutcome; reasons: string[]; applied: string[]; totalUnits: bigint; currency: string }
  >();
  const lineEvaluations = new Map<string, { outcome: RowOutcome; reasons: string[]; applied: string[] }>();
  const invoiceEvaluations = new Map<
    string,
    { outcome: RowOutcome; reasons: string[]; applied: string[]; totalUnits: bigint; currency: string; status: InvoiceStatus }
  >();
  const paymentEvaluations = new Map<string, { outcome: RowOutcome; reasons: string[]; applied: string[] }>();

  // ── PASS 1: Evaluate Sales Orders & Their Lines ─────────────────────────────
  for (const r of rawRows.filter((x) => x.record_type === 'sales_order')) {
    recordTypeCounts.sales_order.total++;
    const reasons: string[] = [];
    const applied: string[] = [];
    const norms: string[] = [];
    let isReview = false;

    // source_id
    if (!r.source_id.trim()) {
      reasons.push('SOURCE_ID_REQUIRED');
      applied.push('SO-001');
      incRule('SO-001');
      incReason('SOURCE_ID_REQUIRED');
    }

    // order_number
    const rawOrderNum = r.order_number;
    const trimmedOrderNum = rawOrderNum.trim();
    if (!trimmedOrderNum) {
      reasons.push('ORDER_NUMBER_REQUIRED');
      applied.push('SO-002');
      incRule('SO-002');
      incReason('ORDER_NUMBER_REQUIRED');
    } else {
      if (rawOrderNum !== trimmedOrderNum || rawOrderNum !== rawOrderNum.toUpperCase()) {
        applied.push('SO-010');
        norms.push('SO-010');
        incNorm('SO-010');
      }
      if (!/^[A-Za-z0-9_-]+$/.test(trimmedOrderNum)) {
        reasons.push('INVALID_ORDER_NUMBER_FORMAT');
        applied.push('SO-020');
        incRule('SO-020');
        incReason('INVALID_ORDER_NUMBER_FORMAT');
      }
      if (trimmedOrderNum.length > 64) {
        reasons.push('ORDER_NUMBER_TOO_LONG');
        applied.push('SO-021');
        incRule('SO-021');
        incReason('ORDER_NUMBER_TOO_LONG');
      }
    }
    const normOrderNum = trimmedOrderNum.toUpperCase();

    // duplicate order_number (candidate key review)
    if (reasons.length === 0 && normOrderNum) {
      if (seenOrderNumbers.has(normOrderNum)) {
        isReview = true;
        reasons.push('DUPLICATE_ORDER_NUMBER_REVIEW');
        applied.push('SO-030');
        incRule('SO-030');
        incReason('DUPLICATE_ORDER_NUMBER_REVIEW');
      } else {
        seenOrderNumbers.add(normOrderNum);
      }
    }

    // customer_golden_id
    const rawCust = r.customer_golden_id.trim();
    if (!rawCust) {
      reasons.push('CUSTOMER_GOLDEN_ID_REQUIRED');
      applied.push('SO-003');
      incRule('SO-003');
      incReason('CUSTOMER_GOLDEN_ID_REQUIRED');
    } else if (!isValidUuid(rawCust)) {
      reasons.push('INVALID_CUSTOMER_GOLDEN_ID');
      applied.push('SO-022');
      incRule('SO-022');
      incReason('INVALID_CUSTOMER_GOLDEN_ID');
    } else if (!KNOWN_CUSTOMERS.includes(rawCust as (typeof KNOWN_CUSTOMERS)[number])) {
      reasons.push('CUSTOMER_NOT_FOUND');
      applied.push('SO-023');
      incRule('SO-023');
      incReason('CUSTOMER_NOT_FOUND');
    }

    // order_date
    const rawOrderDate = r.order_date.trim();
    if (!rawOrderDate) {
      reasons.push('ORDER_DATE_REQUIRED');
      applied.push('SO-004');
      incRule('SO-004');
      incReason('ORDER_DATE_REQUIRED');
    } else if (!isValidCalendarDate(rawOrderDate)) {
      reasons.push('INVALID_DATE');
      applied.push('SO-024');
      incRule('SO-024');
      incReason('INVALID_DATE');
    }

    // currency
    const rawCurr = r.currency;
    const trimmedCurr = rawCurr.trim().toUpperCase();
    if (!trimmedCurr) {
      reasons.push('CURRENCY_REQUIRED');
      applied.push('SO-005');
      incRule('SO-005');
      incReason('CURRENCY_REQUIRED');
    } else {
      if (rawCurr !== trimmedCurr) {
        applied.push('SO-011');
        norms.push('SO-011');
        incNorm('SO-011');
      }
      if (!ACCEPTED_CURRENCIES.includes(trimmedCurr as AcceptedCurrency)) {
        reasons.push('INVALID_CURRENCY');
        applied.push('SO-026');
        incRule('SO-026');
        incReason('INVALID_CURRENCY');
      }
    }

    // order_status
    const rawStatus = r.order_status.trim();
    if (rawStatus) {
      const matchStatus = SALES_ORDER_STATUSES.find(
        (s) => s.toLowerCase() === rawStatus.toLowerCase(),
      );
      if (!matchStatus) {
        reasons.push('INVALID_STATUS');
        applied.push('SO-025');
        incRule('SO-025');
        incReason('INVALID_STATUS');
      } else if (rawStatus !== matchStatus) {
        applied.push('SO-012');
        norms.push('SO-012');
        incNorm('SO-012');
      }
    }

    // notes & formula injection
    const rawNotes = r.notes;
    if (rawNotes) {
      if (/^[=+\-@\t\r]/.test(rawNotes) || /^[=+\-@]/.test(rawNotes.trim())) {
        reasons.push('FORMULA_INJECTION_DETECTED');
        applied.push('SO-050');
        incRule('SO-050');
        incReason('FORMULA_INJECTION_DETECTED');
      }
      if (rawNotes.length > 1000) {
        reasons.push('NOTES_TOO_LONG');
        applied.push('SO-027');
        incRule('SO-027');
        incReason('NOTES_TOO_LONG');
      }
    }

    // evaluate child lines
    const childLines = soLinesByParentId.get(r.source_id) ?? [];
    if (childLines.length === 0) {
      reasons.push('NO_LINES');
      applied.push('SO-006');
      incRule('SO-006');
      incReason('NO_LINES');
    }

    let hasLineFailure = false;
    let orderTotalUnits = 0n;
    const seenLineNumbers = new Set<string>();

    for (const lineRow of childLines) {
      recordTypeCounts.so_line.total++;
      const lineReasons: string[] = [];
      const lineApplied: string[] = [];

      if (!lineRow.source_id.trim()) {
        lineReasons.push('SOURCE_ID_REQUIRED');
        lineApplied.push('SOL-001');
        incRule('SOL-001');
        incReason('SOURCE_ID_REQUIRED');
      }
      if (!lineRow.parent_source_id.trim()) {
        lineReasons.push('PARENT_SOURCE_ID_REQUIRED');
        lineApplied.push('SOL-002');
        incRule('SOL-002');
        incReason('PARENT_SOURCE_ID_REQUIRED');
      }

      // product_id
      const rawProd = lineRow.product_id.trim();
      if (!rawProd) {
        lineReasons.push('PRODUCT_ID_REQUIRED');
        lineApplied.push('SOL-003');
        incRule('SOL-003');
        incReason('PRODUCT_ID_REQUIRED');
      } else if (!isValidUuid(rawProd)) {
        lineReasons.push('INVALID_PRODUCT_ID');
        lineApplied.push('SOL-021');
        incRule('SOL-021');
        incReason('INVALID_PRODUCT_ID');
      } else if (!KNOWN_PRODUCTS.includes(rawProd as (typeof KNOWN_PRODUCTS)[number])) {
        lineReasons.push('PRODUCT_NOT_FOUND');
        lineApplied.push('SOL-022');
        incRule('SOL-022');
        incReason('PRODUCT_NOT_FOUND');
      }

      // quantity
      const rawQty = lineRow.quantity.trim();
      if (!rawQty) {
        lineReasons.push('QUANTITY_REQUIRED');
        lineApplied.push('SOL-004');
        incRule('SOL-004');
        incReason('QUANTITY_REQUIRED');
      } else {
        const qtyScaled = parseScaled4DpSigned(rawQty);
        if (qtyScaled === null) {
          lineReasons.push('INVALID_QUANTITY');
          lineApplied.push('SOL-023');
          incRule('SOL-023');
          incReason('INVALID_QUANTITY');
        } else if (qtyScaled <= 0n) {
          lineReasons.push('NEGATIVE_OR_ZERO_QUANTITY');
          lineApplied.push('SOL-024');
          incRule('SOL-024');
          incReason('NEGATIVE_OR_ZERO_QUANTITY');
        }
      }

      // unit_price
      const rawPrice = lineRow.unit_price.trim();
      if (!rawPrice) {
        lineReasons.push('UNIT_PRICE_REQUIRED');
        lineApplied.push('SOL-005');
        incRule('SOL-005');
        incReason('UNIT_PRICE_REQUIRED');
      } else {
        const priceScaled = parseScaled4DpSigned(rawPrice);
        if (priceScaled === null) {
          lineReasons.push('INVALID_UNIT_PRICE');
          lineApplied.push('SOL-025');
          incRule('SOL-025');
          incReason('INVALID_UNIT_PRICE');
        } else if (priceScaled < 0n) {
          lineReasons.push('NEGATIVE_UNIT_PRICE');
          lineApplied.push('SOL-026');
          incRule('SOL-026');
          incReason('NEGATIVE_UNIT_PRICE');
        }
      }

      // tax_rate
      const rawTax = lineRow.tax_rate.trim();
      if (!rawTax) {
        lineReasons.push('TAX_RATE_REQUIRED');
        lineApplied.push('SOL-006');
        incRule('SOL-006');
        incReason('TAX_RATE_REQUIRED');
      } else {
        const taxScaled = parseScaled4Dp(rawTax);
        if (taxScaled === null) {
          lineReasons.push('INVALID_TAX_RATE');
          lineApplied.push('SOL-027');
          incRule('SOL-027');
          incReason('INVALID_TAX_RATE');
        } else if (taxScaled < 0n || taxScaled > 100n * SCALE_4DP) {
          lineReasons.push('TAX_RATE_OUT_OF_RANGE');
          lineApplied.push('SOL-028');
          incRule('SOL-028');
          incReason('TAX_RATE_OUT_OF_RANGE');
        }
      }

      // line_number duplication
      const rawLineNum = lineRow.line_number_field.trim();
      if (rawLineNum) {
        if (seenLineNumbers.has(rawLineNum)) {
          lineReasons.push('DUPLICATE_LINE_NUMBER');
          lineApplied.push('SOL-029');
          incRule('SOL-029');
          incReason('DUPLICATE_LINE_NUMBER');
        } else {
          seenLineNumbers.add(rawLineNum);
        }
      }

      // compute line total if valid
      if (lineReasons.length === 0) {
        const q = parseScaled4Dp(rawQty)!;
        const p = parseScaled4Dp(rawPrice)!;
        const t = parseScaled4Dp(rawTax)!;
        // line subtotal = (q * p) / SCALE_4DP
        const subtotalUnits = (q * p) / SCALE_4DP;
        // tax = (subtotal * t) / (100 * SCALE_4DP)
        const taxUnits = (subtotalUnits * t) / (100n * SCALE_4DP);
        const lineTotalUnits = subtotalUnits + taxUnits;
        orderTotalUnits += lineTotalUnits;
      } else {
        hasLineFailure = true;
      }

      lineEvaluations.set(lineRow.row_id, {
        outcome: lineReasons.length === 0 ? 'accepted' : 'rejected',
        reasons: lineReasons,
        applied: lineApplied,
      });
    }

    if (hasLineFailure && !isReview && reasons.length === 0) {
      reasons.push('LINE_REJECTED');
      applied.push('SO-040');
      incRule('SO-040');
      incReason('LINE_REJECTED');
    }

    const orderOutcome: RowOutcome = isReview ? 'review' : reasons.length > 0 ? 'rejected' : 'accepted';
    orderEvaluations.set(r.row_id, {
      outcome: orderOutcome,
      reasons,
      applied,
      totalUnits: orderTotalUnits,
      currency: trimmedCurr,
    });

    if (orderOutcome === 'accepted') {
      ensureCurrencyBucket(trimmedCurr);
      const currBucket = totalsByCurrency[trimmedCurr]!;
      const prevOrderScaled = parseScaled4Dp(currBucket.order_total)!;
      currBucket.order_total = formatScaled4Dp(prevOrderScaled + orderTotalUnits);
      currBucket.order_count++;
    }

    // propagate parent status to child lines
    for (const lineRow of childLines) {
      const lineEval = lineEvaluations.get(lineRow.row_id)!;
      if (orderOutcome === 'review') {
        const lineReasons = ['PARENT_ORDER_IN_REVIEW'];
        const lineApplied = [...lineEval.applied, 'SOL-041'];
        incRule('SOL-041');
        incReason('PARENT_ORDER_IN_REVIEW');
        lineEvaluations.set(lineRow.row_id, {
          outcome: 'review',
          reasons: lineReasons,
          applied: lineApplied,
        });
      } else if (orderOutcome === 'rejected' && lineEval.outcome === 'accepted') {
        const lineReasons = ['PARENT_ORDER_REJECTED'];
        const lineApplied = [...lineEval.applied, 'SOL-040'];
        incRule('SOL-040');
        incReason('PARENT_ORDER_REJECTED');
        lineEvaluations.set(lineRow.row_id, {
          outcome: 'rejected',
          reasons: lineReasons,
          applied: lineApplied,
        });
      }
    }
  }

  // Catch orphan so_lines whose parent_source_id does not exist
  for (const r of rawRows.filter((x) => x.record_type === 'so_line')) {
    if (!lineEvaluations.has(r.row_id)) {
      recordTypeCounts.so_line.total++;
      const reasons = ['ORPHAN_LINE'];
      const applied = ['SOL-020'];
      incRule('SOL-020');
      incReason('ORPHAN_LINE');
      lineEvaluations.set(r.row_id, {
        outcome: 'rejected',
        reasons,
        applied,
      });
    }
  }

  // ── PASS 2: Evaluate Invoices & Their Lines ─────────────────────────────────
  for (const r of rawRows.filter((x) => x.record_type === 'invoice')) {
    recordTypeCounts.invoice.total++;
    const reasons: string[] = [];
    const applied: string[] = [];
    const norms: string[] = [];
    let isReview = false;

    // source_id
    if (!r.source_id.trim()) {
      reasons.push('SOURCE_ID_REQUIRED');
      applied.push('INV-001');
      incRule('INV-001');
      incReason('SOURCE_ID_REQUIRED');
    }

    // invoice_number
    const rawInvNum = r.invoice_number;
    const trimmedInvNum = rawInvNum.trim();
    if (!trimmedInvNum) {
      reasons.push('INVOICE_NUMBER_REQUIRED');
      applied.push('INV-002');
      incRule('INV-002');
      incReason('INVOICE_NUMBER_REQUIRED');
    } else {
      if (rawInvNum !== trimmedInvNum || rawInvNum !== rawInvNum.toUpperCase()) {
        applied.push('INV-010');
        norms.push('INV-010');
        incNorm('INV-010');
      }
      if (!/^[A-Za-z0-9_-]+$/.test(trimmedInvNum)) {
        reasons.push('INVALID_INVOICE_NUMBER_FORMAT');
        applied.push('INV-020');
        incRule('INV-020');
        incReason('INVALID_INVOICE_NUMBER_FORMAT');
      }
      if (trimmedInvNum.length > 64) {
        reasons.push('INVOICE_NUMBER_TOO_LONG');
        applied.push('INV-021');
        incRule('INV-021');
        incReason('INVOICE_NUMBER_TOO_LONG');
      }
    }
    const normInvNum = trimmedInvNum.toUpperCase();

    // duplicate invoice_number candidate review
    if (reasons.length === 0 && normInvNum) {
      if (seenInvoiceNumbers.has(normInvNum)) {
        isReview = true;
        reasons.push('DUPLICATE_INVOICE_NUMBER_REVIEW');
        applied.push('INV-030');
        incRule('INV-030');
        incReason('DUPLICATE_INVOICE_NUMBER_REVIEW');
      } else {
        seenInvoiceNumbers.add(normInvNum);
      }
    }

    // customer_golden_id
    const rawCust = r.customer_golden_id.trim();
    if (!rawCust) {
      reasons.push('CUSTOMER_GOLDEN_ID_REQUIRED');
      applied.push('INV-003');
      incRule('INV-003');
      incReason('CUSTOMER_GOLDEN_ID_REQUIRED');
    } else if (!isValidUuid(rawCust)) {
      reasons.push('INVALID_CUSTOMER_GOLDEN_ID');
      applied.push('INV-022');
      incRule('INV-022');
      incReason('INVALID_CUSTOMER_GOLDEN_ID');
    } else if (!KNOWN_CUSTOMERS.includes(rawCust as (typeof KNOWN_CUSTOMERS)[number])) {
      reasons.push('CUSTOMER_NOT_FOUND');
      applied.push('INV-023');
      incRule('INV-023');
      incReason('CUSTOMER_NOT_FOUND');
    }

    // invoice_date & due_date
    const rawInvDate = r.invoice_date.trim();
    if (!rawInvDate) {
      reasons.push('INVOICE_DATE_REQUIRED');
      applied.push('INV-004');
      incRule('INV-004');
      incReason('INVOICE_DATE_REQUIRED');
    } else if (!isValidCalendarDate(rawInvDate)) {
      reasons.push('INVALID_DATE');
      applied.push('INV-024');
      incRule('INV-024');
      incReason('INVALID_DATE');
    }

    const rawDueDate = r.due_date.trim();
    if (!rawDueDate) {
      reasons.push('DUE_DATE_REQUIRED');
      applied.push('INV-005');
      incRule('INV-005');
      incReason('DUE_DATE_REQUIRED');
    } else if (!isValidCalendarDate(rawDueDate) || (rawInvDate && rawDueDate < rawInvDate)) {
      reasons.push('INVALID_DUE_DATE');
      applied.push('INV-025');
      incRule('INV-025');
      incReason('INVALID_DUE_DATE');
    }

    // currency
    const rawCurr = r.currency;
    const trimmedCurr = rawCurr.trim().toUpperCase();
    if (!trimmedCurr) {
      reasons.push('CURRENCY_REQUIRED');
      applied.push('INV-006');
      incRule('INV-006');
      incReason('CURRENCY_REQUIRED');
    } else {
      if (rawCurr !== trimmedCurr) {
        applied.push('INV-011');
        norms.push('INV-011');
        incNorm('INV-011');
      }
      if (!ACCEPTED_CURRENCIES.includes(trimmedCurr as AcceptedCurrency)) {
        reasons.push('INVALID_CURRENCY');
        applied.push('INV-026');
        incRule('INV-026');
        incReason('INVALID_CURRENCY');
      }
    }

    // linked sales order validation (if parent_source_id is provided)
    const linkedOrderId = r.parent_source_id.trim();
    let linkedOrderTotalUnits: bigint | null = null;
    if (linkedOrderId) {
      const parentOrder = soRowsBySourceId.get(linkedOrderId);
      if (!parentOrder) {
        reasons.push('ORDER_NOT_FOUND');
        applied.push('INV-027');
        incRule('INV-027');
        incReason('ORDER_NOT_FOUND');
      } else {
        // V1 invariant: each sales order has at most one invoice
        if (invoicedOrderIds.has(linkedOrderId)) {
          reasons.push('ORDER_ALREADY_INVOICED');
          applied.push('INV-028');
          incRule('INV-028');
          incReason('ORDER_ALREADY_INVOICED');
        } else {
          invoicedOrderIds.add(linkedOrderId);
        }
        // customer mismatch
        if (parentOrder.customer_golden_id.trim() !== rawCust) {
          reasons.push('CUSTOMER_MISMATCH');
          applied.push('INV-029');
          incRule('INV-029');
          incReason('CUSTOMER_MISMATCH');
        }
        const parentEval = orderEvaluations.get(parentOrder.row_id);
        if (parentEval && parentEval.outcome === 'accepted') {
          linkedOrderTotalUnits = parentEval.totalUnits;
        }
      }
    }

    // notes & formula injection
    const rawNotes = r.notes;
    if (rawNotes) {
      if (/^[=+\-@\t\r]/.test(rawNotes) || /^[=+\-@]/.test(rawNotes.trim())) {
        reasons.push('FORMULA_INJECTION_DETECTED');
        applied.push('INV-050');
        incRule('INV-050');
        incReason('FORMULA_INJECTION_DETECTED');
      }
    }

    // evaluate invoice lines
    const childLines = invLinesByParentId.get(r.source_id) ?? [];
    let invoiceTotalUnits = 0n;

    if (childLines.length === 0) {
      if (!linkedOrderId) {
        reasons.push('NO_LINES');
        applied.push('INV-007');
        incRule('INV-007');
        incReason('NO_LINES');
      } else if (linkedOrderTotalUnits !== null) {
        // Inherit total from linked sales order
        invoiceTotalUnits = linkedOrderTotalUnits;
      }
    } else {
      let hasLineFailure = false;
      for (const lineRow of childLines) {
        recordTypeCounts.invoice_line.total++;
        const lineReasons: string[] = [];
        const lineApplied: string[] = [];

        if (!lineRow.source_id.trim()) {
          lineReasons.push('SOURCE_ID_REQUIRED');
          lineApplied.push('INL-001');
          incRule('INL-001');
          incReason('SOURCE_ID_REQUIRED');
        }
        if (!lineRow.parent_source_id.trim()) {
          lineReasons.push('PARENT_SOURCE_ID_REQUIRED');
          lineApplied.push('INL-002');
          incRule('INL-002');
          incReason('PARENT_SOURCE_ID_REQUIRED');
        }

        const rawProd = lineRow.product_id.trim();
        if (!rawProd) {
          lineReasons.push('PRODUCT_ID_REQUIRED');
          lineApplied.push('INL-003');
          incRule('INL-003');
          incReason('PRODUCT_ID_REQUIRED');
        } else if (!isValidUuid(rawProd)) {
          lineReasons.push('INVALID_PRODUCT_ID');
          lineApplied.push('INL-021');
          incRule('INL-021');
          incReason('INVALID_PRODUCT_ID');
        }

        const rawQty = lineRow.quantity.trim();
        const qtyScaled = parseScaled4DpSigned(rawQty);
        if (!rawQty) {
          lineReasons.push('QUANTITY_REQUIRED');
          lineApplied.push('INL-004');
          incRule('INL-004');
          incReason('QUANTITY_REQUIRED');
        } else if (qtyScaled === null) {
          lineReasons.push('INVALID_QUANTITY');
          lineApplied.push('INL-022');
          incRule('INL-022');
          incReason('INVALID_QUANTITY');
        } else if (qtyScaled <= 0n) {
          lineReasons.push('NEGATIVE_OR_ZERO_QUANTITY');
          lineApplied.push('INL-022');
          incRule('INL-022');
          incReason('NEGATIVE_OR_ZERO_QUANTITY');
        }

        const rawPrice = lineRow.unit_price.trim();
        const priceScaled = parseScaled4DpSigned(rawPrice);
        if (!rawPrice) {
          lineReasons.push('UNIT_PRICE_REQUIRED');
          lineApplied.push('INL-005');
          incRule('INL-005');
          incReason('UNIT_PRICE_REQUIRED');
        } else if (priceScaled === null) {
          lineReasons.push('INVALID_UNIT_PRICE');
          lineApplied.push('INL-023');
          incRule('INL-023');
          incReason('INVALID_UNIT_PRICE');
        } else if (priceScaled < 0n) {
          lineReasons.push('NEGATIVE_UNIT_PRICE');
          lineApplied.push('INL-023');
          incRule('INL-023');
          incReason('NEGATIVE_UNIT_PRICE');
        }

        const rawTax = lineRow.tax_rate.trim();
        const taxScaled = parseScaled4Dp(rawTax);
        if (!rawTax) {
          lineReasons.push('TAX_RATE_REQUIRED');
          lineApplied.push('INL-006');
          incRule('INL-006');
          incReason('TAX_RATE_REQUIRED');
        } else if (taxScaled === null || taxScaled < 0n || taxScaled > 100n * SCALE_4DP) {
          lineReasons.push('TAX_RATE_OUT_OF_RANGE');
          lineApplied.push('INL-024');
          incRule('INL-024');
          incReason('TAX_RATE_OUT_OF_RANGE');
        }

        if (lineReasons.length === 0) {
          const q = qtyScaled!;
          const p = priceScaled!;
          const t = taxScaled!;
          const subtotalUnits = (q * p) / SCALE_4DP;
          const taxUnits = (subtotalUnits * t) / (100n * SCALE_4DP);
          invoiceTotalUnits += subtotalUnits + taxUnits;
        } else {
          hasLineFailure = true;
        }

        lineEvaluations.set(lineRow.row_id, {
          outcome: lineReasons.length === 0 ? 'accepted' : 'rejected',
          reasons: lineReasons,
          applied: lineApplied,
        });
      }

      if (hasLineFailure && !isReview && reasons.length === 0) {
        reasons.push('LINE_REJECTED');
        applied.push('INV-040');
        incRule('INV-040');
        incReason('LINE_REJECTED');
      }
    }

    // Derived invoice status
    let derivedStatus: InvoiceStatus = 'Open';
    if (rawDueDate && rawDueDate < asOfDate) {
      derivedStatus = 'Overdue';
    }

    const invOutcome: RowOutcome = isReview ? 'review' : reasons.length > 0 ? 'rejected' : 'accepted';
    invoiceEvaluations.set(r.row_id, {
      outcome: invOutcome,
      reasons,
      applied,
      totalUnits: invoiceTotalUnits,
      currency: trimmedCurr,
      status: derivedStatus,
    });

    if (invOutcome === 'accepted') {
      ensureCurrencyBucket(trimmedCurr);
      const currBucket = totalsByCurrency[trimmedCurr]!;
      const prevInvScaled = parseScaled4Dp(currBucket.invoice_total)!;
      currBucket.invoice_total = formatScaled4Dp(prevInvScaled + invoiceTotalUnits);
      currBucket.invoice_count++;
    }

    // propagate status to child lines
    for (const lineRow of childLines) {
      const lineEval = lineEvaluations.get(lineRow.row_id)!;
      if (invOutcome === 'review') {
        const lineReasons = ['PARENT_INVOICE_IN_REVIEW'];
        const lineApplied = [...lineEval.applied, 'INL-041'];
        incRule('INL-041');
        incReason('PARENT_INVOICE_IN_REVIEW');
        lineEvaluations.set(lineRow.row_id, {
          outcome: 'review',
          reasons: lineReasons,
          applied: lineApplied,
        });
      } else if (invOutcome === 'rejected' && lineEval.outcome === 'accepted') {
        const lineReasons = ['PARENT_INVOICE_REJECTED'];
        const lineApplied = [...lineEval.applied, 'INL-040'];
        incRule('INL-040');
        incReason('PARENT_INVOICE_REJECTED');
        lineEvaluations.set(lineRow.row_id, {
          outcome: 'rejected',
          reasons: lineReasons,
          applied: lineApplied,
        });
      }
    }
  }

  // Catch orphan invoice lines
  for (const r of rawRows.filter((x) => x.record_type === 'invoice_line')) {
    if (!lineEvaluations.has(r.row_id)) {
      recordTypeCounts.invoice_line.total++;
      const reasons = ['ORPHAN_LINE'];
      const applied = ['INL-020'];
      incRule('INL-020');
      incReason('ORPHAN_LINE');
      lineEvaluations.set(r.row_id, {
        outcome: 'rejected',
        reasons,
        applied,
      });
    }
  }

  // ── PASS 3: Evaluate Payments ───────────────────────────────────────────────
  const acceptedPaymentCountByInvoiceId = new Map<string, number>();

  for (const r of rawRows.filter((x) => x.record_type === 'payment')) {
    recordTypeCounts.payment.total++;
    const reasons: string[] = [];
    const applied: string[] = [];
    const norms: string[] = [];
    let isReview = false;

    // source_id
    if (!r.source_id.trim()) {
      reasons.push('SOURCE_ID_REQUIRED');
      applied.push('PAY-001');
      incRule('PAY-001');
      incReason('SOURCE_ID_REQUIRED');
    }

    // parent_source_id (invoice)
    const parentInvSourceId = r.parent_source_id.trim();
    if (!parentInvSourceId) {
      reasons.push('PARENT_SOURCE_ID_REQUIRED');
      applied.push('PAY-002');
      incRule('PAY-002');
      incReason('PARENT_SOURCE_ID_REQUIRED');
    }

    // payment_date
    const rawPayDate = r.payment_date.trim();
    if (!rawPayDate) {
      reasons.push('PAYMENT_DATE_REQUIRED');
      applied.push('PAY-003');
      incRule('PAY-003');
      incReason('PAYMENT_DATE_REQUIRED');
    } else if (!isValidCalendarDate(rawPayDate)) {
      reasons.push('INVALID_DATE');
      applied.push('PAY-021');
      incRule('PAY-021');
      incReason('INVALID_DATE');
    }

    // payment_amount
    const rawAmt = r.payment_amount.trim();
    let amtScaled: bigint | null = null;
    if (!rawAmt) {
      reasons.push('PAYMENT_AMOUNT_REQUIRED');
      applied.push('PAY-004');
      incRule('PAY-004');
      incReason('PAYMENT_AMOUNT_REQUIRED');
    } else {
      amtScaled = parseScaled4DpSigned(rawAmt);
      if (amtScaled === null) {
        reasons.push('INVALID_PAYMENT_AMOUNT');
        applied.push('PAY-022');
        incRule('PAY-022');
        incReason('INVALID_PAYMENT_AMOUNT');
      } else if (amtScaled <= 0n) {
        reasons.push('NEGATIVE_OR_ZERO_PAYMENT');
        applied.push('PAY-023');
        incRule('PAY-023');
        incReason('NEGATIVE_OR_ZERO_PAYMENT');
      }
    }

    // payment_method
    const rawMethod = r.payment_method;
    const trimmedMethod = rawMethod.trim().toLowerCase();
    if (!trimmedMethod) {
      reasons.push('PAYMENT_METHOD_REQUIRED');
      applied.push('PAY-005');
      incRule('PAY-005');
      incReason('PAYMENT_METHOD_REQUIRED');
    } else {
      if (rawMethod !== trimmedMethod) {
        applied.push('PAY-010');
        norms.push('PAY-010');
        incNorm('PAY-010');
      }
      if (!PAYMENT_METHODS.includes(trimmedMethod as PaymentMethod)) {
        reasons.push('INVALID_PAYMENT_METHOD');
        applied.push('PAY-024');
        incRule('PAY-024');
        incReason('INVALID_PAYMENT_METHOD');
      }
    }

    // payment_number duplicate check
    const rawPayNum = r.payment_number.trim();
    if (rawPayNum) {
      const normPayNum = rawPayNum.toUpperCase();
      if (seenPaymentNumbers.has(normPayNum)) {
        isReview = true;
        reasons.push('DUPLICATE_PAYMENT_REVIEW');
        applied.push('PAY-030');
        incRule('PAY-030');
        incReason('DUPLICATE_PAYMENT_REVIEW');
      } else {
        seenPaymentNumbers.add(normPayNum);
      }
    }

    // formula injection in reference
    if (
      r.payment_reference &&
      (/^[=+\-@\t\r]/.test(r.payment_reference) || /^[=+\-@]/.test(r.payment_reference.trim()))
    ) {
      reasons.push('FORMULA_INJECTION_DETECTED');
      applied.push('PAY-050');
      incRule('PAY-050');
      incReason('FORMULA_INJECTION_DETECTED');
    }

    // invoice relationship & payment invariants
    if (parentInvSourceId) {
      const parentInvRow = invRowsBySourceId.get(parentInvSourceId);
      if (!parentInvRow) {
        reasons.push('INVOICE_NOT_FOUND');
        applied.push('PAY-020');
        incRule('PAY-020');
        incReason('INVOICE_NOT_FOUND');
      } else {
        const parentEval = invoiceEvaluations.get(parentInvRow.row_id);
        if (parentEval && parentEval.outcome === 'rejected') {
          reasons.push('PARENT_INVOICE_REJECTED');
          applied.push('PAY-040');
          incRule('PAY-040');
          incReason('PARENT_INVOICE_REJECTED');
        } else if (parentEval && amtScaled !== null && parentEval.outcome === 'accepted' && reasons.length === 0 && !isReview) {
          const invTotal = parentEval.totalUnits;
          // BR-ERP3-03 / FR-ERP3-03: full payment only
          if (amtScaled < invTotal) {
            reasons.push('PARTIAL_PAYMENT_NOT_ALLOWED');
            applied.push('PAY-025');
            incRule('PAY-025');
            incReason('PARTIAL_PAYMENT_NOT_ALLOWED');
          } else if (amtScaled > invTotal) {
            reasons.push('OVERPAYMENT_REJECTED');
            applied.push('PAY-026');
            incRule('PAY-026');
            incReason('OVERPAYMENT_REJECTED');
          } else {
            // exact match: check if already paid
            const seenPayments = acceptedPaymentCountByInvoiceId.get(parentInvSourceId) ?? 0;
            if (seenPayments > 0) {
              reasons.push('MULTIPLE_PAYMENTS_REJECTED');
              applied.push('PAY-027');
              incRule('PAY-027');
              incReason('MULTIPLE_PAYMENTS_REJECTED');
            } else {
              acceptedPaymentCountByInvoiceId.set(parentInvSourceId, seenPayments + 1);
              // auto-transition invoice to Paid
              parentEval.status = 'Paid';
            }
          }
        }
      }
    }

    const payOutcome: RowOutcome = isReview ? 'review' : reasons.length > 0 ? 'rejected' : 'accepted';
    paymentEvaluations.set(r.row_id, {
      outcome: payOutcome,
      reasons,
      applied,
    });

    if (payOutcome === 'accepted' && amtScaled !== null) {
      const parentInv = invRowsBySourceId.get(parentInvSourceId);
      const curr = parentInv ? parentInv.currency.trim().toUpperCase() : 'USD';
      ensureCurrencyBucket(curr);
      const currBucket = totalsByCurrency[curr]!;
      const prevPayScaled = parseScaled4Dp(currBucket.payment_total)!;
      currBucket.payment_total = formatScaled4Dp(prevPayScaled + amtScaled);
      currBucket.payment_count++;
    }
  }

  // ── PASS 4: Assemble Final Results ─────────────────────────────────────────
  const rowResults: RowEvaluation[] = [];
  let totalAccepted = 0;
  let totalRejected = 0;
  let totalReview = 0;
  const totalSkipped = 0;

  for (const r of rawRows) {
    const recType = r.record_type as RecordType;
    let evalObj: { outcome: RowOutcome; reasons: string[]; applied: string[] } | undefined;

    if (recType === 'sales_order') evalObj = orderEvaluations.get(r.row_id);
    else if (recType === 'so_line') evalObj = lineEvaluations.get(r.row_id);
    else if (recType === 'invoice') evalObj = invoiceEvaluations.get(r.row_id);
    else if (recType === 'invoice_line') evalObj = lineEvaluations.get(r.row_id);
    else if (recType === 'payment') evalObj = paymentEvaluations.get(r.row_id);

    const outcome: RowOutcome = evalObj ? evalObj.outcome : 'rejected';
    const reasons: readonly string[] = evalObj ? evalObj.reasons : ['UNKNOWN_RECORD_TYPE'];
    const applied: readonly string[] = evalObj ? evalObj.applied : [];

    if (outcome === 'accepted') {
      totalAccepted++;
      recordTypeCounts[recType].accepted++;
    } else if (outcome === 'review') {
      totalReview++;
      recordTypeCounts[recType].review++;
    } else {
      totalRejected++;
      recordTypeCounts[recType].rejected++;
    }

    rowResults.push({
      line_number: r.line_number,
      row_id: r.row_id,
      record_type: recType,
      outcome,
      applied_rules: applied,
      reasons,
      normalizations: [],
    });
  }

  const reconciliation = {
    total_source_rows: rawRows.length,
    accepted: totalAccepted,
    rejected: totalRejected,
    review: totalReview,
    skipped: totalSkipped,
    unaccounted: rawRows.length - (totalAccepted + totalRejected + totalReview + totalSkipped),
    is_balanced: rawRows.length === totalAccepted + totalRejected + totalReview + totalSkipped,
  };

  return {
    total_source_rows: rawRows.length,
    rowResults,
    reconciliation,
    recordTypeCounts,
    ruleHitsCount,
    reasonCodeCount,
    normalizationsCount,
    totalsByCurrency,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Report Builder & Deterministic Serialization
// ─────────────────────────────────────────────────────────────────────────────

export interface ProfileReport {
  profile_schema_version: number;
  rules_version: string;
  module: string;
  fixture: {
    file: string;
    schema_version: number;
    sha256: string;
    row_count: number;
    by_record_type: Record<RecordType, number>;
  };
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
    RecordType,
    { accepted: number; rejected: number; review: number; skipped: number; total: number }
  >;
  by_rule_id: Record<string, number>;
  by_reason_code: Record<string, number>;
  normalizations: Record<string, number>;
  totals_by_currency: Record<
    string,
    {
      order_total: string;
      invoice_total: string;
      payment_total: string;
      order_count: number;
      invoice_count: number;
      payment_count: number;
    }
  >;
  rows: Record<
    string,
    {
      outcome: RowOutcome;
      reasons: readonly string[];
    }
  >;
}

export function buildProfile(rawCsvText: string, options: EvaluationOptions = {}): ProfileReport {
  const rawRows = readRawRows(rawCsvText);
  const result = evaluateDataset(rawRows, options);

  const fixtureRowCount = rawRows.length;
  const fixtureByRecordType: Record<RecordType, number> = {
    sales_order: 0,
    so_line: 0,
    invoice: 0,
    invoice_line: 0,
    payment: 0,
  };
  for (const r of rawRows) {
    const t = r.record_type as RecordType;
    if (fixtureByRecordType[t] !== undefined) {
      fixtureByRecordType[t]++;
    }
  }

  const rowMap: Record<string, { outcome: RowOutcome; reasons: readonly string[] }> = {};
  for (const r of result.rowResults) {
    rowMap[r.row_id] = {
      outcome: r.outcome,
      reasons: r.reasons,
    };
  }

  return {
    profile_schema_version: PROFILE_SCHEMA_VERSION,
    rules_version: RULES_VERSION,
    module: 'erp3',
    fixture: {
      file: FIXTURE_PATH,
      schema_version: FIXTURE_SCHEMA_VERSION,
      sha256: sha256Hex(rawCsvText),
      row_count: fixtureRowCount,
      by_record_type: fixtureByRecordType,
    },
    reconciliation: result.reconciliation,
    by_record_type: result.recordTypeCounts,
    by_rule_id: result.ruleHitsCount,
    by_reason_code: result.reasonCodeCount,
    normalizations: result.normalizationsCount,
    totals_by_currency: result.totalsByCurrency,
    rows: rowMap,
  };
}

function sortDeep(val: unknown): unknown {
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(sortDeep);
  const out: Record<string, unknown> = {};
  const keys = Object.keys(val as Record<string, unknown>).sort();
  for (const k of keys) {
    out[k] = sortDeep((val as Record<string, unknown>)[k]);
  }
  return out;
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}
