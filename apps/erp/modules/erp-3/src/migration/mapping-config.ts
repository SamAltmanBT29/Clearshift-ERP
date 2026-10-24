/**
 * ERP-3 Sales Orders & Invoices — Mapping & Value Translation Configuration (ERP3-28 / KIT-05)
 *
 * Implements:
 * - AC1: Source-to-target field mapping templates with strict type coercion rules.
 * - AC2: Enum translation tables mapping legacy values to domain allowlists.
 * - AC3: Unmapped required target fields raise validation error and block dry-run/load execution.
 * - AC4: Named, versioned, reproducible templates across migration runs.
 *
 * Conforms to:
 * - ClearShift Migration Kit SDS Chapter 4.5 (FR-MP-01 to FR-MP-05)
 * - ERP-3 Domain Invariants (BR-ERP3-01..03, FR-ERP3-01..05)
 * - Decimal precision numeric(19,4) arithmetic; no IEEE-754 float drift
 * - Synthetic test fixtures only (BR-KIT-03 non-destructive source data)
 * - OWASP formula injection neutralization (PLT-12 / KIT-16)
 *
 * @module erp3/migration/mapping-config
 */

import { createHash } from 'node:crypto';
import type {
  ModuleKitMetadata,
  TargetEntityMetadata,
  TargetFieldDefinition,
  MappingValidationResult,
} from '@cs/kit';
import { validateFieldMapping, registerModuleKitMetadata } from '@cs/kit';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Enum Allow Lists & Translation Tables (AC2)
// ─────────────────────────────────────────────────────────────────────────────

export const ERP3_ORDER_STATUS_ALLOWLIST = ['Open', 'Invoiced', 'Closed'] as const;
export type Erp3OrderStatus = (typeof ERP3_ORDER_STATUS_ALLOWLIST)[number];

export const ERP3_INVOICE_STATUS_ALLOWLIST = ['Open', 'Paid', 'Overdue'] as const;
export type Erp3InvoiceStatus = (typeof ERP3_INVOICE_STATUS_ALLOWLIST)[number];

export const ERP3_PAYMENT_METHOD_ALLOWLIST = ['cash', 'bank', 'card'] as const;
export type Erp3PaymentMethod = (typeof ERP3_PAYMENT_METHOD_ALLOWLIST)[number];

export const ERP3_CURRENCY_ALLOWLIST = ['USD', 'EUR', 'INR'] as const;
export type Erp3Currency = (typeof ERP3_CURRENCY_ALLOWLIST)[number];

/**
 * Sales Order Status Translation Table
 * Maps common variations, legacy names, and abbreviations to domain allowlist.
 */
export const ORDER_STATUS_TRANSLATION_MAP: Readonly<Record<string, Erp3OrderStatus>> = {
  open: 'Open',
  opened: 'Open',
  new: 'Open',
  active: 'Open',
  pending: 'Open',
  draft: 'Open',

  invoiced: 'Invoiced',
  billed: 'Invoiced',
  processing: 'Invoiced',

  closed: 'Closed',
  complete: 'Closed',
  completed: 'Closed',
  done: 'Closed',
  fulfilled: 'Closed',
  cancelled: 'Closed',
  canceled: 'Closed',
};

/**
 * Invoice Status Translation Table
 * Maps legacy status notations to domain allowlist.
 */
export const INVOICE_STATUS_TRANSLATION_MAP: Readonly<Record<string, Erp3InvoiceStatus>> = {
  open: 'Open',
  unpaid: 'Open',
  pending: 'Open',
  issued: 'Open',
  due: 'Open',

  paid: 'Paid',
  settled: 'Paid',
  cleared: 'Paid',

  overdue: 'Overdue',
  past_due: 'Overdue',
  'past due': 'Overdue',
  delinquent: 'Overdue',
  late: 'Overdue',
};

/**
 * Payment Method Translation Table
 * Standardizes legacy payment method names to allowlist: cash, bank, card.
 */
export const PAYMENT_METHOD_TRANSLATION_MAP: Readonly<Record<string, Erp3PaymentMethod>> = {
  cash: 'cash',
  currency: 'cash',
  physical: 'cash',

  bank: 'bank',
  wire: 'bank',
  'wire transfer': 'bank',
  ach: 'bank',
  neft: 'bank',
  rtgs: 'bank',
  imps: 'bank',
  'bank transfer': 'bank',
  transfer: 'bank',
  cheque: 'bank',
  check: 'bank',

  card: 'card',
  credit: 'card',
  debit: 'card',
  'credit card': 'card',
  'debit card': 'card',
  visa: 'card',
  mastercard: 'card',
  amex: 'card',
};

/**
 * Currency Translation Table
 * Normalizes symbols, names, and variations to ISO 4217 standard codes.
 */
export const CURRENCY_TRANSLATION_MAP: Readonly<Record<string, Erp3Currency>> = {
  usd: 'USD',
  '$': 'USD',
  dollar: 'USD',
  dollars: 'USD',
  'us$': 'USD',

  eur: 'EUR',
  '€': 'EUR',
  euro: 'EUR',
  euros: 'EUR',

  inr: 'INR',
  '₹': 'INR',
  rs: 'INR',
  'rs.': 'INR',
  rupee: 'INR',
  rupees: 'INR',
};

export class EnumTranslationError extends Error {
  constructor(
    public readonly fieldName: string,
    public readonly sourceValue: string,
    public readonly allowedValues: readonly string[],
    message: string
  ) {
    super(message);
    this.name = 'EnumTranslationError';
  }
}

/**
 * Translates a source enum string using a translation table with case-insensitivity.
 * Throws EnumTranslationError if translation fails and no fallback default is provided.
 */
export function translateEnum<T extends string>(
  sourceValue: unknown,
  translationMap: Readonly<Record<string, T>>,
  fieldName: string,
  defaultValue?: T
): T {
  if (sourceValue === undefined || sourceValue === null || String(sourceValue).trim() === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new EnumTranslationError(
      fieldName,
      String(sourceValue),
      Array.from(new Set(Object.values(translationMap))),
      `Required enum field '${fieldName}' cannot be empty.`
    );
  }

  const normalized = String(sourceValue).trim().toLowerCase();
  const matched = translationMap[normalized];
  if (matched !== undefined) {
    return matched;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new EnumTranslationError(
    fieldName,
    String(sourceValue),
    Array.from(new Set(Object.values(translationMap))),
    `Value '${sourceValue}' for field '${fieldName}' is not in the allowed translation dictionary.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Type Coercion Helpers (AC1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coerces monetary amounts to a standard string decimal representation with 4 decimal places.
 * Strips currency symbols, thousands separators, and preserves algebraic signs.
 * Employs exact string math to prevent IEEE-754 floating-point errors.
 */
export function coerceDecimalAmount(val: unknown, fieldName: string, scale = 4): string {
  if (val === undefined || val === null || String(val).trim() === '') {
    throw new TypeError(`Missing numeric decimal amount for required field '${fieldName}'`);
  }

  let str = String(val).trim();
  // Strip currency prefixes/suffixes and whitespace
  str = str.replace(/[₹$€\s,]/g, '');

  // Handle accounting parentheses negative format: (100.50) -> -100.50
  if (/^\(.*\)$/.test(str)) {
    str = '-' + str.slice(1, -1).trim();
  }

  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new TypeError(
      `Field '${fieldName}' value '${val}' cannot be parsed as a valid numeric decimal.`
    );
  }

  const parts = str.split('.');
  const isNegative = parts[0]!.startsWith('-');
  const intDigits = isNegative ? parts[0]!.slice(1) : parts[0]!;
  const integerPart = (isNegative ? '-' : '') + (intDigits || '0');
  let decimalPart = parts[1] || '0'.repeat(scale);

  if (decimalPart.length > scale) {
    // Truncate/scale to designated decimal places
    decimalPart = decimalPart.slice(0, scale);
  } else {
    decimalPart = decimalPart.padEnd(scale, '0');
  }

  // Handle negative zero
  if (integerPart === '-0' && /^0+$/.test(decimalPart)) {
    return `0.${'0'.repeat(scale)}`;
  }

  return `${integerPart}.${decimalPart}`;
}

/**
 * Half-up decimal rounding on strings (exact integer arithmetic via BigInt).
 * Returns normalized decimal string or null if unparseable.
 */
export function roundDecimalHalfUp(input: string, scale: number): string | null {
  const cleaned = input.trim().replace(/[₹$€\s,]/g, '');
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (m === null) return null;
  const sign = m[1] ?? '';
  const intPart = m[2] ?? '0';
  const frac = m[3] ?? '';
  const padded = (frac + '0'.repeat(scale)).slice(0, scale);
  let digits = BigInt(intPart + padded);
  const nextDigit = frac.charAt(scale);
  if (nextDigit !== '' && nextDigit >= '5') digits += 1n;
  const s = digits.toString().padStart(scale + 1, '0');
  const whole = scale === 0 ? s : s.slice(0, s.length - scale);
  const fracOut = scale === 0 ? '' : '.' + s.slice(s.length - scale);
  const isZero = /^0*$/.test(whole + fracOut.replace('.', ''));
  return `${isZero ? '' : sign}${whole}${fracOut}`;
}

/**
 * Coerces legacy dates to ISO 8601 (YYYY-MM-DD).
 * Supports YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY, and ISO timestamps.
 */
export function coerceIsoDate(val: unknown, fieldName: string): string {
  if (val === undefined || val === null || String(val).trim() === '') {
    throw new TypeError(`Missing date for required field '${fieldName}'`);
  }

  const str = String(val).trim();

  // YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(str);
  if (ymdMatch) {
    const y = ymdMatch[1]!;
    const m = ymdMatch[2]!.padStart(2, '0');
    const d = ymdMatch[3]!.padStart(2, '0');
    const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (
      parsed.getUTCFullYear() !== Number(y) ||
      parsed.getUTCMonth() !== Number(m) - 1 ||
      parsed.getUTCDate() !== Number(d)
    ) {
      throw new TypeError(`Field '${fieldName}' value '${val}' is an impossible calendar date.`);
    }
    return `${y}-${m}-${d}`;
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(str);
  if (dmyMatch) {
    const d = dmyMatch[1]!.padStart(2, '0');
    const m = dmyMatch[2]!.padStart(2, '0');
    const y = dmyMatch[3]!;
    const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (
      parsed.getUTCFullYear() !== Number(y) ||
      parsed.getUTCMonth() !== Number(m) - 1 ||
      parsed.getUTCDate() !== Number(d)
    ) {
      throw new TypeError(`Field '${fieldName}' value '${val}' is an impossible calendar date.`);
    }
    return `${y}-${m}-${d}`;
  }

  // ISO full timestamp
  const dateObj = new Date(str);
  if (!isNaN(dateObj.getTime())) {
    return dateObj.toISOString().slice(0, 10);
  }

  throw new TypeError(
    `Field '${fieldName}' value '${val}' is not a recognized date format. Expected YYYY-MM-DD or DD-MM-YYYY.`
  );
}

/**
 * Coerces truthy/falsy representations to boolean.
 */
export function coerceBoolean(val: unknown, defaultValue = true): boolean {
  if (val === undefined || val === null || String(val).trim() === '') {
    return defaultValue;
  }
  const s = String(val).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 't'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'f'].includes(s)) return false;
  return defaultValue;
}

/**
 * Coerces integer values.
 */
export function coerceInteger(val: unknown, fieldName: string): number {
  if (val === undefined || val === null || String(val).trim() === '') {
    throw new TypeError(`Missing integer value for required field '${fieldName}'`);
  }
  const str = String(val).trim();
  if (!/^-?\d+$/.test(str)) {
    throw new TypeError(`Field '${fieldName}' value '${val}' is not a valid integer.`);
  }
  return Number(str);
}

/**
 * Coerces and validates canonical UUID strings.
 */
export function coerceUuid(val: unknown, fieldName: string): string {
  if (val === undefined || val === null || String(val).trim() === '') {
    throw new TypeError(`Missing UUID value for required field '${fieldName}'`);
  }
  const str = String(val).trim();
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str)) {
    throw new TypeError(`Field '${fieldName}' value '${val}' is not a valid RFC 4122 UUID.`);
  }
  return str.toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Module Target Entity Definitions (AC1, AC3)
// ─────────────────────────────────────────────────────────────────────────────

export type Erp3Entity = 'sales_order' | 'so_line' | 'invoice' | 'invoice_line' | 'payment';

export const erp3SalesOrderTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'order_number',
    label: 'Sales Order Number',
    type: 'string',
    required: true,
    description: 'Unique sales order document reference (e.g. SO-2026-0001)',
    rules: ['SO-002', 'SO-020'],
    example: 'SO-2026-0001',
  },
  {
    name: 'customer_golden_id',
    label: 'Customer Golden ID',
    type: 'uuid',
    required: true,
    description: 'Mandatory reference to CRM-1 customer golden ID',
    rules: ['SO-003', 'BR-ERP3-03'],
    example: 'c0000000-0000-4000-8000-000000000001',
  },
  {
    name: 'order_date',
    label: 'Order Date',
    type: 'date',
    required: true,
    description: 'Calendar date sales order was booked (YYYY-MM-DD)',
    rules: ['SO-004', 'SO-024'],
    example: '2026-10-01',
  },
  {
    name: 'status',
    label: 'Order Status',
    type: 'enum',
    required: false,
    description: 'Order lifecycle status: Open, Invoiced, Closed',
    enumOptions: ERP3_ORDER_STATUS_ALLOWLIST,
    rules: ['SO-012', 'SO-025'],
    example: 'Open',
  },
  {
    name: 'currency',
    label: 'Currency Code',
    type: 'enum',
    required: true,
    description: 'ISO 4217 currency: USD, EUR, INR',
    enumOptions: ERP3_CURRENCY_ALLOWLIST,
    rules: ['SO-005', 'SO-026'],
    example: 'USD',
  },
  {
    name: 'notes',
    label: 'Notes / Remarks',
    type: 'string',
    required: false,
    description: 'Optional commercial notes or references',
    rules: ['SO-013', 'PLT-12'],
    example: 'Standard commercial sales order',
  },
  {
    name: 'source_id',
    label: 'Source Record ID',
    type: 'string',
    required: true,
    description: 'Source system row identifier for idempotent receipt linking',
    rules: ['SO-001', 'KIT-08'],
    example: 'SO-SRC-001',
  },
];

export const erp3SoLineTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'order_id',
    label: 'Sales Order ID / Parent Reference',
    type: 'string',
    required: true,
    description: 'Foreign link to header sales order source_id or ID',
    rules: ['SOL-002', 'SOL-020'],
    example: 'SO-SRC-001',
  },
  {
    name: 'line_number',
    label: 'Line Number',
    type: 'number',
    required: true,
    description: 'Sequential order line item number (>= 1)',
    rules: ['SOL-029'],
    example: 1,
  },
  {
    name: 'product_id',
    label: 'Product ID',
    type: 'uuid',
    required: true,
    description: 'Logical product reference to ERP-1 product catalog',
    rules: ['SOL-003', 'SOL-021'],
    example: '5eed0000-0000-4000-8000-0000000000a1',
  },
  {
    name: 'quantity',
    label: 'Quantity',
    type: 'decimal',
    required: true,
    description: 'Ordered quantity at 4 decimal places (> 0)',
    rules: ['SOL-004', 'SOL-023'],
    example: '5.0000',
  },
  {
    name: 'unit_price',
    label: 'Unit Price',
    type: 'decimal',
    required: true,
    description: 'Unit selling price at 4 decimal places (>= 0)',
    rules: ['SOL-005', 'SOL-025'],
    example: '100.0000',
  },
  {
    name: 'tax_rate',
    label: 'Tax Rate (%)',
    type: 'decimal',
    required: true,
    description: 'Applicable tax percentage (0.0000 to 100.0000)',
    rules: ['SOL-006', 'SOL-027'],
    example: '10.0000',
  },
  {
    name: 'description',
    label: 'Item Description',
    type: 'string',
    required: false,
    description: 'Optional line description or catalog name',
    rules: ['SOL-030'],
    example: 'Industrial Sensor Model A',
  },
  {
    name: 'source_id',
    label: 'Source Record ID',
    type: 'string',
    required: true,
    description: 'Source line identifier for idempotency tracking',
    rules: ['SOL-001', 'KIT-08'],
    example: 'SOL-SRC-001',
  },
];

export const erp3InvoiceTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'invoice_number',
    label: 'Invoice Number',
    type: 'string',
    required: true,
    description: 'Unique commercial invoice document reference (e.g. INV-2026-1001)',
    rules: ['INV-002', 'INV-020'],
    example: 'INV-2026-1001',
  },
  {
    name: 'customer_golden_id',
    label: 'Customer Golden ID',
    type: 'uuid',
    required: true,
    description: 'Mandatory reference to CRM-1 customer golden ID',
    rules: ['INV-003', 'BR-ERP3-03'],
    example: 'c0000000-0000-4000-8000-000000000001',
  },
  {
    name: 'invoice_date',
    label: 'Invoice Date',
    type: 'date',
    required: true,
    description: 'Calendar date invoice was issued (YYYY-MM-DD)',
    rules: ['INV-004', 'INV-024'],
    example: '2026-10-05',
  },
  {
    name: 'due_date',
    label: 'Payment Due Date',
    type: 'date',
    required: true,
    description: 'Mandatory payment due date (due_date >= invoice_date)',
    rules: ['INV-005', 'INV-025', 'FR-ERP3-02'],
    example: '2026-11-05',
  },
  {
    name: 'currency',
    label: 'Currency Code',
    type: 'enum',
    required: true,
    description: 'ISO 4217 currency: USD, EUR, INR',
    enumOptions: ERP3_CURRENCY_ALLOWLIST,
    rules: ['INV-006', 'INV-026'],
    example: 'USD',
  },
  {
    name: 'status',
    label: 'Invoice Status',
    type: 'enum',
    required: false,
    description: 'Invoice lifecycle status: Open, Paid, Overdue',
    enumOptions: ERP3_INVOICE_STATUS_ALLOWLIST,
    rules: ['INV-012', 'FR-ERP3-02'],
    example: 'Open',
  },
  {
    name: 'order_id',
    label: 'Sales Order Link',
    type: 'string',
    required: false,
    description: 'Optional parent sales order link (1:1 relationship in V1)',
    rules: ['INV-027', 'FR-ERP3-02'],
    example: 'SO-SRC-001',
  },
  {
    name: 'notes',
    label: 'Notes / Remarks',
    type: 'string',
    required: false,
    description: 'Optional invoice notes or payment terms',
    rules: ['INV-050'],
    example: 'Net 30 commercial terms',
  },
  {
    name: 'source_id',
    label: 'Source Record ID',
    type: 'string',
    required: true,
    description: 'Source invoice identifier for idempotency',
    rules: ['INV-001', 'KIT-08'],
    example: 'INV-SRC-001',
  },
];

export const erp3InvoiceLineTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'invoice_id',
    label: 'Invoice ID / Parent Reference',
    type: 'string',
    required: true,
    description: 'Foreign link to parent invoice source_id or ID',
    rules: ['INL-002', 'INL-020'],
    example: 'INV-SRC-001',
  },
  {
    name: 'line_number',
    label: 'Line Number',
    type: 'number',
    required: true,
    description: 'Sequential invoice line item number (>= 1)',
    rules: ['INL-029'],
    example: 1,
  },
  {
    name: 'product_id',
    label: 'Product ID',
    type: 'uuid',
    required: true,
    description: 'Logical product reference to ERP-1 product catalog',
    rules: ['INL-003', 'INL-021'],
    example: '5eed0000-0000-4000-8000-0000000000a1',
  },
  {
    name: 'quantity',
    label: 'Quantity',
    type: 'decimal',
    required: true,
    description: 'Invoiced quantity at 4 decimal places (> 0)',
    rules: ['INL-004', 'INL-022'],
    example: '5.0000',
  },
  {
    name: 'unit_price',
    label: 'Unit Price',
    type: 'decimal',
    required: true,
    description: 'Unit selling price at 4 decimal places (>= 0)',
    rules: ['INL-005', 'INL-023'],
    example: '100.0000',
  },
  {
    name: 'tax_rate',
    label: 'Tax Rate (%)',
    type: 'decimal',
    required: true,
    description: 'Applicable tax percentage (0.0000 to 100.0000)',
    rules: ['INL-006', 'INL-024'],
    example: '10.0000',
  },
  {
    name: 'description',
    label: 'Item Description',
    type: 'string',
    required: false,
    description: 'Optional line description or catalog name',
    rules: ['INL-030'],
    example: 'Industrial Sensor Model A',
  },
  {
    name: 'source_id',
    label: 'Source Record ID',
    type: 'string',
    required: true,
    description: 'Source line identifier for idempotency tracking',
    rules: ['INL-001', 'KIT-08'],
    example: 'INL-SRC-001',
  },
];

export const erp3PaymentTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'invoice_id',
    label: 'Invoice ID / Parent Reference',
    type: 'string',
    required: true,
    description: 'Foreign link to invoice being settled (one payment per invoice in V1)',
    rules: ['PAY-002', 'PAY-020', 'FR-ERP3-03'],
    example: 'INV-SRC-001',
  },
  {
    name: 'payment_number',
    label: 'Payment Number',
    type: 'string',
    required: false,
    description: 'Optional remittance or receipt identifier (e.g. PAY-2026-1001)',
    rules: ['PAY-011', 'PAY-030'],
    example: 'PAY-2026-1001',
  },
  {
    name: 'payment_date',
    label: 'Payment Date',
    type: 'date',
    required: true,
    description: 'Settlement execution date (YYYY-MM-DD)',
    rules: ['PAY-003', 'PAY-021'],
    example: '2026-10-06',
  },
  {
    name: 'amount',
    label: 'Payment Amount',
    type: 'decimal',
    required: true,
    description: 'Settlement amount matching invoice total exactly in V1 (FR-ERP3-03)',
    rules: ['PAY-004', 'PAY-022', 'FR-ERP3-03'],
    example: '550.0000',
  },
  {
    name: 'method',
    label: 'Payment Method',
    type: 'enum',
    required: true,
    description: 'Settlement method allowlist: cash, bank, card',
    enumOptions: ERP3_PAYMENT_METHOD_ALLOWLIST,
    rules: ['PAY-005', 'PAY-010', 'PAY-024'],
    example: 'bank',
  },
  {
    name: 'currency',
    label: 'Currency Code',
    type: 'enum',
    required: false,
    description: 'ISO 4217 currency matching invoice',
    enumOptions: ERP3_CURRENCY_ALLOWLIST,
    rules: ['PAY-026'],
    example: 'USD',
  },
  {
    name: 'reference',
    label: 'Payment Reference',
    type: 'string',
    required: false,
    description: 'External bank transaction reference or auth code',
    rules: ['PAY-050'],
    example: 'WIRE-US-99120',
  },
  {
    name: 'source_id',
    label: 'Source Record ID',
    type: 'string',
    required: true,
    description: 'Source payment row identifier for idempotency',
    rules: ['PAY-001', 'KIT-08'],
    example: 'PAY-SRC-001',
  },
];

export const erp3TargetEntities: Readonly<Record<Erp3Entity, TargetEntityMetadata>> = {
  sales_order: {
    entity: 'sales_order',
    label: 'Sales Orders',
    module: 'erp3',
    schemaVersion: 1,
    targetTable: 'erp3.sales_orders',
    primaryKey: 'id',
    naturalKey: 'order_number',
    fields: erp3SalesOrderTargetFields,
    mappingDefaults: {
      order_number: 'order_number',
      customer_golden_id: 'customer_golden_id',
      order_date: 'order_date',
      status: 'order_status',
      currency: 'currency',
      notes: 'notes',
      source_id: 'source_id',
    },
    validationRules: [
      { code: 'SO-002', description: 'Order number required and unique across system' },
      { code: 'SO-003', description: 'Customer reference resolves through CRM-1 Golden ID mapping' },
      { code: 'SO-005', description: 'Currency must be in accepted ISO 4217 allowlist (USD, EUR, INR)' },
    ],
  },
  so_line: {
    entity: 'so_line',
    label: 'Sales Order Lines',
    module: 'erp3',
    schemaVersion: 1,
    targetTable: 'erp3.so_lines',
    primaryKey: 'id',
    naturalKey: 'order_id,line_number',
    fields: erp3SoLineTargetFields,
    mappingDefaults: {
      order_id: 'parent_source_id',
      line_number: 'line_number',
      product_id: 'product_id',
      quantity: 'quantity',
      unit_price: 'unit_price',
      tax_rate: 'tax_rate',
      description: 'description',
      source_id: 'source_id',
    },
    validationRules: [
      { code: 'SOL-003', description: 'Product reference resolves through ERP-1 catalog' },
      { code: 'SOL-004', description: 'Quantity must be positive numeric decimal' },
      { code: 'SOL-005', description: 'Unit price must be non-negative numeric decimal' },
      { code: 'SOL-006', description: 'Tax rate must be between 0.0000 and 100.0000' },
    ],
  },
  invoice: {
    entity: 'invoice',
    label: 'Invoices',
    module: 'erp3',
    schemaVersion: 1,
    targetTable: 'erp3.invoices',
    primaryKey: 'id',
    naturalKey: 'invoice_number',
    fields: erp3InvoiceTargetFields,
    mappingDefaults: {
      invoice_number: 'invoice_number',
      customer_golden_id: 'customer_golden_id',
      invoice_date: 'invoice_date',
      due_date: 'due_date',
      currency: 'currency',
      status: 'invoice_status',
      order_id: 'parent_source_id',
      notes: 'notes',
      source_id: 'source_id',
    },
    validationRules: [
      { code: 'INV-002', description: 'Invoice number required and unique across system' },
      { code: 'INV-005', description: 'Payment due date mandatory for overdue derivation (due_date >= invoice_date)' },
      { code: 'INV-027', description: 'At most one invoice per sales order in V1' },
    ],
  },
  invoice_line: {
    entity: 'invoice_line',
    label: 'Invoice Lines',
    module: 'erp3',
    schemaVersion: 1,
    targetTable: 'erp3.invoice_lines',
    primaryKey: 'id',
    naturalKey: 'invoice_id,line_number',
    fields: erp3InvoiceLineTargetFields,
    mappingDefaults: {
      invoice_id: 'parent_source_id',
      line_number: 'line_number',
      product_id: 'product_id',
      quantity: 'quantity',
      unit_price: 'unit_price',
      tax_rate: 'tax_rate',
      description: 'description',
      source_id: 'source_id',
    },
    validationRules: [
      { code: 'INL-003', description: 'Product reference resolves through ERP-1 catalog' },
      { code: 'INL-004', description: 'Quantity must be positive numeric decimal' },
      { code: 'INL-005', description: 'Unit price must be non-negative numeric decimal' },
    ],
  },
  payment: {
    entity: 'payment',
    label: 'Payments',
    module: 'erp3',
    schemaVersion: 1,
    targetTable: 'erp3.payments',
    primaryKey: 'id',
    naturalKey: 'payment_number',
    fields: erp3PaymentTargetFields,
    mappingDefaults: {
      invoice_id: 'parent_source_id',
      payment_number: 'payment_number',
      payment_date: 'payment_date',
      amount: 'payment_amount',
      method: 'payment_method',
      currency: 'currency',
      reference: 'payment_reference',
      source_id: 'source_id',
    },
    validationRules: [
      { code: 'PAY-004', description: 'Payment amount must settle invoice exactly in V1' },
      { code: 'PAY-005', description: 'Payment method allowlist: cash, bank, card' },
      { code: 'PAY-021', description: 'Payment date must be valid ISO calendar date' },
    ],
  },
};

export const erp3KitMetadata: ModuleKitMetadata = {
  moduleId: 'erp3',
  moduleName: 'ERP-3 Sales Orders & Invoices',
  defaultEntity: 'sales_order',
  entities: erp3TargetEntities,
  supportedSourceTypes: ['CSV', 'XLSX'],
};

// Register module metadata with central MigrationKitRegistry
registerModuleKitMetadata(erp3KitMetadata);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Required Target Column Enforcement Guard (AC3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Required target columns per entity (enforcement guard).
 * Supports standard target column names and canonical aliases.
 */
export const REQUIRED_TARGETS: Readonly<Record<Erp3Entity, readonly string[]>> = {
  sales_order: ['order_number', 'customer_golden_id', 'order_date', 'currency', 'source_id'],
  so_line: ['order_id', 'line_number', 'product_id', 'quantity', 'unit_price', 'tax_rate', 'source_id'],
  invoice: ['invoice_number', 'customer_golden_id', 'invoice_date', 'due_date', 'currency', 'source_id'],
  invoice_line: ['invoice_id', 'line_number', 'product_id', 'quantity', 'unit_price', 'tax_rate', 'source_id'],
  payment: ['invoice_id', 'payment_date', 'amount', 'method', 'source_id'],
};

/** Target field alias map supporting flexible naming across migration specs */
const TARGET_ALIASES: Readonly<Record<string, readonly string[]>> = {
  order_id: ['order_id', 'parent_source_id'],
  invoice_id: ['invoice_id', 'parent_source_id'],
  unit_price: ['unit_price', 'price'],
  amount: ['amount', 'payment_amount'],
  method: ['method', 'payment_method'],
  payment_date: ['payment_date', 'paid_at'],
  status: ['status', 'order_status', 'invoice_status'],
};

export interface MappingIssue {
  readonly code:
    | 'UNMAPPED_REQUIRED_TARGET'
    | 'DUPLICATE_TARGET'
    | 'DUPLICATE_SOURCE'
    | 'MISSING_SOURCE_COLUMN'
    | 'UNKNOWN_ENUM_TABLE'
    | 'ENUM_TARGET_NOT_ALLOWED'
    | 'INVALID_TEMPLATE_META'
    | 'INVALID_FIELD_CONFIG'
    | 'UNKNOWN_ENTITY';
  readonly target?: string;
  readonly source?: string;
  readonly message: string;
}

export interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly details: unknown;
}

export class MappingValidationError extends Error {
  readonly httpStatus = 400;
  readonly code = 'MAPPING_VALIDATION_FAILED';
  readonly issues: readonly MappingIssue[];

  constructor(issues: readonly MappingIssue[]) {
    super(`Mapping template failed validation with ${issues.length} issue(s)`);
    this.name = 'MappingValidationError';
    this.issues = issues;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      code: this.code,
      message: this.message,
      details: { issues: this.issues },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Named, Versioned Mapping Templates (AC4)
// ─────────────────────────────────────────────────────────────────────────────

export type FieldType = 'string' | 'integer' | 'decimal' | 'date' | 'boolean' | 'enum' | 'uuid';
export type DateFormat = 'iso' | 'dmy';

export interface FieldMapping {
  /** Source file column header (exact, case-sensitive) */
  readonly source: string;
  /** Target schema attribute */
  readonly target: string;
  readonly type: FieldType;
  readonly required: boolean;
  /** Key into MappingTemplate.enumTranslations (when type === 'enum') */
  readonly enumTable?: string;
  /** Decimal places for type === 'decimal' (default 4) */
  readonly decimalScale?: number;
  /** Date format for type === 'date' (default 'iso') */
  readonly dateFormat?: DateFormat;
  /** Sensitive fields (e.g. security credentials or PII) */
  readonly sensitive?: boolean;
  readonly defaultValue?: unknown;
  readonly ruleIds?: readonly string[];
}

export interface EnumTable {
  readonly allowed: readonly string[];
  readonly map: Readonly<Record<string, string>>;
}

export interface EntityMappingTemplate {
  readonly entity: Erp3Entity;
  readonly targetTable: string;
  readonly candidateKey: readonly string[];
  readonly fields: readonly FieldMapping[];
  readonly enumTranslations?: Readonly<Record<string, EnumTable>>;
}

export interface MappingTemplate {
  readonly templateId: string;
  readonly name: string;
  readonly version: string;
  readonly module: string;
  readonly description?: string;
  readonly mappingSchemaVersion: number;
  readonly entities: Readonly<Record<Erp3Entity, EntityMappingTemplate>>;
  readonly enumTranslations: Readonly<Record<string, EnumTable>>;
  readonly createdAt: string;
}

const SEMVER = /^\d+\.\d+\.\d+$/;

export function templateId(t: Pick<MappingTemplate, 'name' | 'version'>): string {
  return `${t.name}@${t.version}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Stable SHA-256 over key-sorted canonical JSON: same template => same fingerprint on every run.
 */
export function templateFingerprint(t: MappingTemplate): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(t))).digest('hex');
}

/**
 * Standard global enum tables for ERP-3 mapping templates
 */
export const ERP3_ENUM_TRANSLATIONS: Readonly<Record<string, EnumTable>> = {
  order_status: {
    allowed: ERP3_ORDER_STATUS_ALLOWLIST,
    map: ORDER_STATUS_TRANSLATION_MAP,
  },
  invoice_status: {
    allowed: ERP3_INVOICE_STATUS_ALLOWLIST,
    map: INVOICE_STATUS_TRANSLATION_MAP,
  },
  payment_method: {
    allowed: ERP3_PAYMENT_METHOD_ALLOWLIST,
    map: PAYMENT_METHOD_TRANSLATION_MAP,
  },
  currency: {
    allowed: ERP3_CURRENCY_ALLOWLIST,
    map: CURRENCY_TRANSLATION_MAP,
  },
};

/**
 * Canonical default ERP-3 mapping template (AC4)
 */
export const ERP3_CANONICAL_MAPPING_TEMPLATE: MappingTemplate = {
  templateId: 'erp3-canonical-v1',
  name: 'ERP-3 Sales Orders & Invoices Canonical Mapping Template',
  version: '1.0.0',
  module: 'erp3',
  description: 'Production mapping template for sales orders, order lines, invoices, invoice lines, and payments.',
  mappingSchemaVersion: 1,
  createdAt: '2026-10-24T00:00:00.000Z',
  enumTranslations: ERP3_ENUM_TRANSLATIONS,
  entities: {
    sales_order: {
      entity: 'sales_order',
      targetTable: 'erp3.sales_orders',
      candidateKey: ['order_number'],
      fields: [
        { source: 'source_id', target: 'source_id', type: 'string', required: true, ruleIds: ['SO-001'] },
        { source: 'order_number', target: 'order_number', type: 'string', required: true, ruleIds: ['SO-002', 'SO-020'] },
        { source: 'customer_golden_id', target: 'customer_golden_id', type: 'uuid', required: true, ruleIds: ['SO-003', 'BR-ERP3-03'] },
        { source: 'order_date', target: 'order_date', type: 'date', required: true, ruleIds: ['SO-004', 'SO-024'] },
        { source: 'order_status', target: 'status', type: 'enum', required: false, enumTable: 'order_status', defaultValue: 'Open', ruleIds: ['SO-012', 'SO-025'] },
        { source: 'currency', target: 'currency', type: 'enum', required: true, enumTable: 'currency', ruleIds: ['SO-005', 'SO-026'] },
        { source: 'notes', target: 'notes', type: 'string', required: false, ruleIds: ['SO-013', 'PLT-12'] },
      ],
    },
    so_line: {
      entity: 'so_line',
      targetTable: 'erp3.so_lines',
      candidateKey: ['order_id', 'line_number'],
      fields: [
        { source: 'source_id', target: 'source_id', type: 'string', required: true, ruleIds: ['SOL-001'] },
        { source: 'parent_source_id', target: 'order_id', type: 'string', required: true, ruleIds: ['SOL-002', 'SOL-020'] },
        { source: 'product_id', target: 'product_id', type: 'uuid', required: true, ruleIds: ['SOL-003', 'SOL-021'] },
        { source: 'line_number', target: 'line_number', type: 'integer', required: true, ruleIds: ['SOL-029'] },
        { source: 'description', target: 'description', type: 'string', required: false, ruleIds: ['SOL-030'] },
        { source: 'quantity', target: 'quantity', type: 'decimal', decimalScale: 4, required: true, ruleIds: ['SOL-004', 'SOL-023'] },
        { source: 'unit_price', target: 'unit_price', type: 'decimal', decimalScale: 4, required: true, ruleIds: ['SOL-005', 'SOL-025'] },
        { source: 'tax_rate', target: 'tax_rate', type: 'decimal', decimalScale: 4, required: true, ruleIds: ['SOL-006', 'SOL-027'] },
      ],
    },
    invoice: {
      entity: 'invoice',
      targetTable: 'erp3.invoices',
      candidateKey: ['invoice_number'],
      fields: [
        { source: 'source_id', target: 'source_id', type: 'string', required: true, ruleIds: ['INV-001'] },
        { source: 'parent_source_id', target: 'order_id', type: 'string', required: false, ruleIds: ['INV-027', 'FR-ERP3-02'] },
        { source: 'invoice_number', target: 'invoice_number', type: 'string', required: true, ruleIds: ['INV-002', 'INV-020'] },
        { source: 'customer_golden_id', target: 'customer_golden_id', type: 'uuid', required: true, ruleIds: ['INV-003', 'BR-ERP3-03'] },
        { source: 'invoice_date', target: 'invoice_date', type: 'date', required: true, ruleIds: ['INV-004', 'INV-024'] },
        { source: 'due_date', target: 'due_date', type: 'date', required: true, ruleIds: ['INV-005', 'INV-025', 'FR-ERP3-02'] },
        { source: 'currency', target: 'currency', type: 'enum', required: true, enumTable: 'currency', ruleIds: ['INV-006', 'INV-026'] },
        { source: 'invoice_status', target: 'status', type: 'enum', required: false, enumTable: 'invoice_status', defaultValue: 'Open', ruleIds: ['INV-012'] },
        { source: 'notes', target: 'notes', type: 'string', required: false, ruleIds: ['INV-050'] },
      ],
    },
    invoice_line: {
      entity: 'invoice_line',
      targetTable: 'erp3.invoice_lines',
      candidateKey: ['invoice_id', 'line_number'],
      fields: [
        { source: 'source_id', target: 'source_id', type: 'string', required: true, ruleIds: ['INL-001'] },
        { source: 'parent_source_id', target: 'invoice_id', type: 'string', required: true, ruleIds: ['INL-002', 'INL-020'] },
        { source: 'product_id', target: 'product_id', type: 'uuid', required: true, ruleIds: ['INL-003', 'INL-021'] },
        { source: 'line_number', target: 'line_number', type: 'integer', required: true, ruleIds: ['INL-029'] },
        { source: 'description', target: 'description', type: 'string', required: false, ruleIds: ['INL-030'] },
        { source: 'quantity', target: 'quantity', type: 'decimal', decimalScale: 4, required: true, ruleIds: ['INL-004', 'INL-022'] },
        { source: 'unit_price', target: 'unit_price', type: 'decimal', decimalScale: 4, required: true, ruleIds: ['INL-005', 'INL-023'] },
        { source: 'tax_rate', target: 'tax_rate', type: 'decimal', decimalScale: 4, required: true, ruleIds: ['INL-006', 'INL-024'] },
      ],
    },
    payment: {
      entity: 'payment',
      targetTable: 'erp3.payments',
      candidateKey: ['invoice_id'],
      fields: [
        { source: 'source_id', target: 'source_id', type: 'string', required: true, ruleIds: ['PAY-001'] },
        { source: 'parent_source_id', target: 'invoice_id', type: 'string', required: true, ruleIds: ['PAY-002', 'PAY-020', 'FR-ERP3-03'] },
        { source: 'payment_number', target: 'payment_number', type: 'string', required: false, ruleIds: ['PAY-011', 'PAY-030'] },
        { source: 'payment_date', target: 'payment_date', type: 'date', required: true, ruleIds: ['PAY-003', 'PAY-021'] },
        { source: 'payment_amount', target: 'amount', type: 'decimal', decimalScale: 4, required: true, ruleIds: ['PAY-004', 'PAY-022', 'FR-ERP3-03'] },
        { source: 'payment_method', target: 'method', type: 'enum', required: true, enumTable: 'payment_method', ruleIds: ['PAY-005', 'PAY-010', 'PAY-024'] },
        { source: 'currency', target: 'currency', type: 'enum', required: false, enumTable: 'currency', ruleIds: ['PAY-026'] },
        { source: 'payment_reference', target: 'reference', type: 'string', required: false, ruleIds: ['PAY-050'] },
      ],
    },
  },
};

export const ERP3_DEFAULT_MAPPING_TEMPLATES: readonly MappingTemplate[] = [
  ERP3_CANONICAL_MAPPING_TEMPLATE,
];

// ─────────────────────────────────────────────────────────────────────────────
// 6. Validation & Execution Guards (AC3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a single entity mapping template structurally.
 */
export function validateEntityTemplate(
  entity: Erp3Entity,
  fields: readonly FieldMapping[],
  enumTranslations: Readonly<Record<string, EnumTable>> = ERP3_ENUM_TRANSLATIONS
): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const targets = new Set<string>();
  const sources = new Set<string>();

  for (const f of fields) {
    if (targets.has(f.target)) {
      issues.push({
        code: 'DUPLICATE_TARGET',
        target: f.target,
        message: `Target "${f.target}" is mapped more than once in entity "${entity}".`,
      });
    }
    targets.add(f.target);

    if (sources.has(f.source)) {
      issues.push({
        code: 'DUPLICATE_SOURCE',
        source: f.source,
        message: `Source column "${f.source}" is mapped more than once in entity "${entity}".`,
      });
    }
    sources.add(f.source);

    if (f.type === 'enum') {
      const table = f.enumTable ? enumTranslations[f.enumTable] : undefined;
      if (!table) {
        issues.push({
          code: 'UNKNOWN_ENUM_TABLE',
          target: f.target,
          message: `Enum table "${f.enumTable}" for target "${f.target}" is not defined.`,
        });
      } else {
        for (const v of Object.values(table.map)) {
          if (!table.allowed.includes(v)) {
            issues.push({
              code: 'ENUM_TARGET_NOT_ALLOWED',
              target: f.target,
              message: `Enum table "${f.enumTable}" maps to value "${v}" outside its allowlist.`,
            });
            break;
          }
        }
      }
    }

    if (
      f.type === 'decimal' &&
      f.decimalScale !== undefined &&
      (!Number.isInteger(f.decimalScale) || f.decimalScale < 0 || f.decimalScale > 8)
    ) {
      issues.push({
        code: 'INVALID_FIELD_CONFIG',
        target: f.target,
        message: `decimalScale for "${f.target}" must be an integer between 0 and 8.`,
      });
    }
  }

  // Verify all required targets are mapped
  const requiredTargets = REQUIRED_TARGETS[entity] || [];
  for (const req of requiredTargets) {
    const aliases = TARGET_ALIASES[req] || [req];
    const isMapped = fields.some(
      (f) => aliases.includes(f.target) && f.required
    );
    if (!isMapped) {
      issues.push({
        code: 'UNMAPPED_REQUIRED_TARGET',
        target: req,
        message: `Required target "${req}" for entity "${entity}" is not mapped as a required field.`,
      });
    }
  }

  return issues;
}

/**
 * Validates an entire mapping template structure independently of any source file.
 */
export function validateTemplate(t: MappingTemplate): MappingIssue[] {
  const issues: MappingIssue[] = [];

  if (!t.name || t.name.trim() === '' || !SEMVER.test(t.version)) {
    issues.push({
      code: 'INVALID_TEMPLATE_META',
      message: 'Template must have a non-empty name and a semantic version (x.y.z).',
    });
  }

  for (const [entityName, entityTemplate] of Object.entries(t.entities)) {
    const entityIssues = validateEntityTemplate(
      entityName as Erp3Entity,
      entityTemplate.fields,
      t.enumTranslations
    );
    issues.push(...entityIssues);
  }

  return issues;
}

/**
 * Template validity check against specific incoming source file headers.
 */
export function validateAgainstHeaders(
  t: MappingTemplate,
  entity: Erp3Entity,
  headers: readonly string[]
): MappingIssue[] {
  const entityTemplate = t.entities[entity];
  if (!entityTemplate) {
    return [
      {
        code: 'UNKNOWN_ENTITY',
        message: `Entity "${entity}" is not defined in template "${t.name}".`,
      },
    ];
  }

  const issues = validateEntityTemplate(entity, entityTemplate.fields, t.enumTranslations);
  const present = new Set(headers.map((h) => h.trim()));

  for (const f of entityTemplate.fields) {
    if (f.required && !present.has(f.source)) {
      issues.push({
        code: 'MISSING_SOURCE_COLUMN',
        target: f.target,
        source: f.source,
        message: `Source column "${f.source}" for required target "${f.target}" is missing from the file.`,
      });
    }
  }

  return issues;
}

/**
 * Dry-run guard: throws MappingValidationError (HTTP 400) and blocks execution if unmapped required fields exist.
 */
export function assertDryRunReady(
  t: MappingTemplate,
  entity: Erp3Entity,
  headers: readonly string[]
): void {
  const issues = validateAgainstHeaders(t, entity, headers);
  if (issues.length > 0) {
    throw new MappingValidationError(issues);
  }
}

/**
 * Validates mapping configuration against `@cs/kit` metadata.
 */
export function validateErp3Mapping(
  entityName: string,
  mapping: Record<string, string>,
  sourceTypes?: Record<string, string>
): MappingValidationResult {
  const entityMeta = erp3TargetEntities[entityName as Erp3Entity];
  if (!entityMeta) {
    return {
      valid: false,
      missingRequiredFields: [`Unknown entity: ${entityName}`],
      warnings: [],
      errors: [{ targetField: 'entity', sourceColumn: '', error: `Unknown entity: ${entityName}` }],
    };
  }
  return validateFieldMapping(entityMeta, mapping, sourceTypes);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Transformation Engine (AC1, AC2)
// ─────────────────────────────────────────────────────────────────────────────

export type CoerceResult =
  | { readonly ok: true; readonly value: string | number | boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Coerces a single value according to field definition.
 */
export function coerceValue(
  f: FieldMapping,
  raw: unknown,
  enumTranslations: Readonly<Record<string, EnumTable>> = ERP3_ENUM_TRANSLATIONS
): CoerceResult {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    if (f.defaultValue !== undefined) {
      return { ok: true, value: f.defaultValue as string | number | boolean };
    }
    return { ok: false, reason: 'value is empty' };
  }

  const v = String(raw).trim();

  switch (f.type) {
    case 'string':
      return { ok: true, value: v };

    case 'integer':
      return /^-?\d+$/.test(v)
        ? { ok: true, value: Number(v) }
        : { ok: false, reason: 'not a valid integer' };

    case 'decimal': {
      const r = roundDecimalHalfUp(v, f.decimalScale ?? 4);
      return r === null ? { ok: false, reason: 'not a valid numeric decimal' } : { ok: true, value: r };
    }

    case 'date': {
      try {
        const d = coerceIsoDate(v, f.target);
        return { ok: true, value: d };
      } catch (err: any) {
        return { ok: false, reason: err.message };
      }
    }

    case 'boolean': {
      const b = coerceBoolean(v, true);
      return { ok: true, value: b };
    }

    case 'uuid': {
      try {
        const u = coerceUuid(v, f.target);
        return { ok: true, value: u };
      } catch (err: any) {
        return { ok: false, reason: err.message };
      }
    }

    case 'enum': {
      const table = f.enumTable ? enumTranslations[f.enumTable] : undefined;
      if (!table) {
        return { ok: false, reason: `Enum table '${f.enumTable}' is not defined` };
      }
      try {
        const out = translateEnum(v, table.map, f.target, f.defaultValue as string | undefined);
        return { ok: true, value: out };
      } catch (err: any) {
        return { ok: false, reason: err.message };
      }
    }

    default:
      return { ok: true, value: v };
  }
}

export interface RowError {
  readonly rowIndex: number;
  readonly target: string;
  readonly source: string;
  readonly reason: string;
}

export interface MappedRow {
  readonly rowIndex: number;
  readonly values: Record<string, string | number | boolean | null>;
  readonly errors: readonly RowError[];
}

export interface DryRunResult {
  readonly templateId: string;
  readonly fingerprint: string;
  readonly rows: readonly MappedRow[];
  readonly validRows: number;
  readonly invalidRows: number;
}

/**
 * Maps a single row using the given template and entity rules.
 * Never echoes sensitive values in error logs.
 */
export function mapRow(
  template: MappingTemplate,
  entity: Erp3Entity,
  row: Readonly<Record<string, unknown>>,
  rowIndex: number
): MappedRow {
  const entityTemplate = template.entities[entity];
  if (!entityTemplate) {
    return {
      rowIndex,
      values: {},
      errors: [
        {
          rowIndex,
          target: 'entity',
          source: 'record_type',
          reason: `Unknown entity: ${entity}`,
        },
      ],
    };
  }

  const values: Record<string, string | number | boolean | null> = {};
  const errors: RowError[] = [];

  for (const f of entityTemplate.fields) {
    const raw = row[f.source];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      if (f.defaultValue !== undefined) {
        values[f.target] = f.defaultValue as string | number | boolean;
      } else {
        values[f.target] = null;
        if (f.required) {
          errors.push({
            rowIndex,
            target: f.target,
            source: f.source,
            reason: 'required value is empty',
          });
        }
      }
      continue;
    }

    const res = coerceValue(f, raw, template.enumTranslations);
    if (res.ok) {
      values[f.target] = res.value;
    } else {
      values[f.target] = null;
      errors.push({
        rowIndex,
        target: f.target,
        source: f.source,
        reason: res.reason,
      });
    }
  }

  return { rowIndex, values, errors };
}

/**
 * Dry-run execution: enforces guards first (blocks if required target fields are missing),
 * then transforms all rows and accumulates detailed valid/invalid counts.
 */
export function dryRun(
  template: MappingTemplate,
  entity: Erp3Entity,
  headers: readonly string[],
  rows: readonly Readonly<Record<string, unknown>>[]
): DryRunResult {
  assertDryRunReady(template, entity, headers);
  const mapped = rows.map((r, i) => mapRow(template, entity, r, i + 1));
  const invalidRows = mapped.filter((m) => m.errors.length > 0).length;

  return {
    templateId: templateId(template),
    fingerprint: templateFingerprint(template),
    rows: mapped,
    validRows: mapped.length - invalidRows,
    invalidRows,
  };
}

export interface TransformRowOutcome {
  readonly success: boolean;
  readonly targetEntity: string;
  readonly data: Record<string, unknown>;
  readonly errors: readonly string[];
}

export interface TransformDatasetResult {
  readonly totalRows: number;
  readonly successCount: number;
  readonly failedCount: number;
  readonly rows: readonly TransformRowOutcome[];
}

/**
 * Transforms a source row to target data using key-value field mapping.
 */
export function transformSourceRowToTarget(
  entityName: string,
  mapping: Record<string, string>,
  sourceRow: Record<string, unknown>
): TransformRowOutcome {
  const entityMeta = erp3TargetEntities[entityName as Erp3Entity];
  if (!entityMeta) {
    return {
      success: false,
      targetEntity: entityName,
      data: {},
      errors: [`Unknown entity '${entityName}'`],
    };
  }

  const errors: string[] = [];
  const transformed: Record<string, unknown> = {};

  for (const field of entityMeta.fields) {
    const sourceCol = mapping[field.name];
    const rawVal = sourceCol ? sourceRow[sourceCol] : undefined;

    if (field.required) {
      if (!sourceCol || rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
        errors.push(`Missing required target field '${field.name}' (${field.label})`);
        continue;
      }
    }

    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
      continue;
    }

    try {
      switch (field.type) {
        case 'enum': {
          if (field.name === 'status') {
            if (entityName === 'sales_order') {
              transformed[field.name] = translateEnum(rawVal, ORDER_STATUS_TRANSLATION_MAP, field.name);
            } else if (entityName === 'invoice') {
              transformed[field.name] = translateEnum(rawVal, INVOICE_STATUS_TRANSLATION_MAP, field.name);
            } else {
              transformed[field.name] = String(rawVal).trim();
            }
          } else if (field.name === 'method') {
            transformed[field.name] = translateEnum(rawVal, PAYMENT_METHOD_TRANSLATION_MAP, field.name);
          } else if (field.name === 'currency') {
            transformed[field.name] = translateEnum(rawVal, CURRENCY_TRANSLATION_MAP, field.name);
          } else {
            transformed[field.name] = String(rawVal).trim();
          }
          break;
        }

        case 'decimal': {
          transformed[field.name] = coerceDecimalAmount(rawVal, field.name, 4);
          break;
        }

        case 'date': {
          transformed[field.name] = coerceIsoDate(rawVal, field.name);
          break;
        }

        case 'boolean': {
          transformed[field.name] = coerceBoolean(rawVal);
          break;
        }

        case 'number': {
          transformed[field.name] = coerceInteger(rawVal, field.name);
          break;
        }

        case 'uuid': {
          transformed[field.name] = coerceUuid(rawVal, field.name);
          break;
        }

        case 'string': {
          if (field.name === 'currency') {
            transformed[field.name] = translateEnum(rawVal, CURRENCY_TRANSLATION_MAP, field.name);
          } else {
            transformed[field.name] = String(rawVal).trim();
          }
          break;
        }

        default: {
          transformed[field.name] = rawVal;
          break;
        }
      }
    } catch (err: any) {
      errors.push(`Field '${field.name}': ${err.message}`);
    }
  }

  return {
    success: errors.length === 0,
    targetEntity: entityName,
    data: transformed,
    errors,
  };
}

/**
 * Transforms an entire dataset of source rows using key-value field mapping.
 */
export function transformDataset(
  entityName: string,
  mapping: Record<string, string>,
  rows: readonly Record<string, unknown>[]
): TransformDatasetResult {
  const transformedRows = rows.map((row) => transformSourceRowToTarget(entityName, mapping, row));
  const successCount = transformedRows.filter((r) => r.success).length;

  return {
    totalRows: rows.length,
    successCount,
    failedCount: rows.length - successCount,
    rows: transformedRows,
  };
}
