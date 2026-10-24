/**
 * ERP-4 Finance & Accounting — Mapping & Value Translation Configuration (ERP4-28 / KIT-05)
 *
 * Implements:
 * - AC1: Source-to-target field mapping templates with strict type coercion rules.
 * - AC2: Enum translation tables mapping legacy values to domain allowlists.
 * - AC3: Unmapped required target fields raise validation error and block dry-run/load execution.
 * - AC4: Named, versioned, reproducible templates across migration runs.
 *
 * Conforms to:
 * - ClearShift Migration Kit SDS Chapter 4.5 (FR-MP-01 to FR-MP-05)
 * - ERP-4 Double-Entry Balancing Invariant (BR-ERP4-01)
 * - Decimal precision NUMERIC(20,4) arithmetic; no IEEE-754 float rounding
 * - Synthetic test fixtures only (BR-KIT-03 non-destructive source data)
 *
 * @module erp4/migration/mapping-config
 */

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

export const ERP4_ACCOUNT_TYPE_ALLOWLIST = ['asset', 'liability', 'income', 'expense'] as const;
export type Erp4AccountType = typeof ERP4_ACCOUNT_TYPE_ALLOWLIST[number];

export const ERP4_CURRENCY_CODE_ALLOWLIST = ['INR', 'USD', 'EUR'] as const;
export type Erp4CurrencyCode = typeof ERP4_CURRENCY_CODE_ALLOWLIST[number];

export const ERP4_PERIOD_STATUS_ALLOWLIST = ['open', 'soft_closed', 'locked'] as const;
export type Erp4PeriodStatus = typeof ERP4_PERIOD_STATUS_ALLOWLIST[number];

export const ERP4_JOURNAL_ENTRY_STATUS_ALLOWLIST = ['draft', 'posted', 'reversed', 'voided'] as const;
export type Erp4JournalEntryStatus = typeof ERP4_JOURNAL_ENTRY_STATUS_ALLOWLIST[number];

/**
 * Account Type Translation Table
 * Maps common variations, uppercase, abbreviations, and legacy ERP classifications.
 */
export const ACCOUNT_TYPE_TRANSLATION_MAP: Readonly<Record<string, Erp4AccountType>> = {
  // Asset
  asset: 'asset',
  assets: 'asset',
  ast: 'asset',
  'current asset': 'asset',
  'fixed asset': 'asset',
  'bank asset': 'asset',
  ca: 'asset',
  fa: 'asset',

  // Liability
  liability: 'liability',
  liabilities: 'liability',
  lia: 'liability',
  liab: 'liability',
  'current liability': 'liability',
  'long term liability': 'liability',
  cl: 'liability',

  // Income / Revenue
  income: 'income',
  revenue: 'income',
  rev: 'income',
  sales: 'income',
  inc: 'income',
  'operating income': 'income',

  // Expense
  expense: 'expense',
  expenses: 'expense',
  exp: 'expense',
  cost: 'expense',
  cogs: 'expense',
  'operating expense': 'expense',
};

/**
 * Currency Code Translation Table
 * Standardizes common currency notations, symbols, and lower-case variants to ISO 4217.
 */
export const CURRENCY_CODE_TRANSLATION_MAP: Readonly<Record<string, Erp4CurrencyCode>> = {
  inr: 'INR',
  rs: 'INR',
  'rs.': 'INR',
  '₹': 'INR',
  rupee: 'INR',
  rupees: 'INR',

  usd: 'USD',
  '$': 'USD',
  dollar: 'USD',
  dollars: 'USD',
  us$: 'USD',

  eur: 'EUR',
  '€': 'EUR',
  euro: 'EUR',
  euros: 'EUR',
};

/**
 * Period Status Translation Table
 */
export const PERIOD_STATUS_TRANSLATION_MAP: Readonly<Record<string, Erp4PeriodStatus>> = {
  open: 'open',
  active: 'open',
  opened: 'open',
  unlocked: 'open',

  soft_closed: 'soft_closed',
  softclosed: 'soft_closed',
  'soft closed': 'soft_closed',
  closing: 'soft_closed',

  locked: 'locked',
  closed: 'locked',
  hard_closed: 'locked',
  finalized: 'locked',
};

/**
 * Translates a source enum string using a translation table with case-insensitivity.
 * Throws structured error if translation fails and no fallback default is provided.
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
      Object.values(translationMap),
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. Type Coercion Helpers (AC1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coerces monetary amounts to a standard string decimal representation with up to 4 decimal places.
 * Strips currency symbols, thousands separators, and preserves algebraic signs.
 */
export function coerceDecimalAmount(val: unknown, fieldName: string): string {
  if (val === undefined || val === null || String(val).trim() === '') {
    throw new TypeError(`Missing numeric decimal amount for required field '${fieldName}'`);
  }

  let str = String(val).trim();
  // Strip currency prefixes/suffixes and commas
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
  const integerPart = parts[0] || '0';
  let decimalPart = parts[1] || '0000';
  if (decimalPart.length > 4) {
    // Truncate to 4 decimal places per V1 precision
    decimalPart = decimalPart.slice(0, 4);
  } else {
    decimalPart = decimalPart.padEnd(4, '0');
  }

  // Handle negative zero
  if (integerPart === '-0' && decimalPart === '0000') {
    return '0.0000';
  }

  return `${integerPart}.${decimalPart}`;
}

/**
 * Coerces legacy dates to ISO 8601 (YYYY-MM-DD).
 * Supports YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY.
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
    return `${y}-${m}-${d}`;
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(str);
  if (dmyMatch) {
    const d = dmyMatch[1]!.padStart(2, '0');
    const m = dmyMatch[2]!.padStart(2, '0');
    const y = dmyMatch[3]!;
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

// ─────────────────────────────────────────────────────────────────────────────
// 3. Module Target Entity Definitions (AC1, AC3)
// ─────────────────────────────────────────────────────────────────────────────

export const erp4AccountsTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'code',
    label: 'Account Code',
    type: 'string',
    required: true,
    description: 'Unique alphanumeric GL account code (e.g. 1010-CASH)',
    rules: ['ACC-001', 'RL-REQ-01', 'RL-FORMAT-01'],
    example: '1010-CASH',
  },
  {
    name: 'name',
    label: 'Account Name',
    type: 'string',
    required: true,
    description: 'Human-readable ledger account title',
    rules: ['ACC-002', 'RL-REQ-01', 'RL-NAME-01'],
    example: 'Cash on Hand',
  },
  {
    name: 'type',
    label: 'Account Classification',
    type: 'enum',
    required: true,
    description: 'Account classification allowlist: asset, liability, income, expense',
    enumOptions: ERP4_ACCOUNT_TYPE_ALLOWLIST,
    rules: ['ACC-003', 'RL-REQ-01'],
    example: 'asset',
  },
  {
    name: 'currency_code',
    label: 'Currency Code',
    type: 'string',
    required: true,
    description: 'Three-letter ISO 4217 currency code (INR, USD, EUR)',
    rules: ['ACC-004', 'RL-REQ-01'],
    example: 'INR',
  },
  {
    name: 'parent_id',
    label: 'Parent Account ID',
    type: 'uuid',
    required: false,
    description: 'Optional parent account identifier for hierarchical chart of accounts',
    rules: ['ACC-040'],
    example: '00000000-0000-0000-0000-000000000001',
  },
  {
    name: 'description',
    label: 'Description / Narration',
    type: 'string',
    required: false,
    description: 'Optional account description',
    rules: ['ACC-023'],
    example: 'Operating petty cash reserve',
  },
  {
    name: 'is_active',
    label: 'Is Active',
    type: 'boolean',
    required: false,
    description: 'Whether account is active for posting',
    rules: ['ACC-032'],
    example: true,
  },
  {
    name: 'is_posting_account',
    label: 'Is Posting Account',
    type: 'boolean',
    required: false,
    description: 'Whether direct journal entries may be posted (leaf account)',
    rules: ['ACC-033'],
    example: true,
  },
  {
    name: 'source_id',
    label: 'Source Record ID',
    type: 'string',
    required: true,
    description: 'Original legacy system identifier for idempotent receipt linking',
    rules: ['ACC-005', 'KIT-08'],
    example: 'ACC-001',
  },
];

export const erp4OpeningBalancesTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'account_id',
    label: 'Account Code / ID',
    type: 'string',
    required: true,
    description: 'Target account code or UUID reference',
    rules: ['OPB-002', 'RL-REQ-01'],
    example: '1010-CASH',
  },
  {
    name: 'currency_code',
    label: 'Currency Code',
    type: 'string',
    required: true,
    description: 'ISO 4217 currency matching account',
    rules: ['OPB-003', 'RL-REQ-01'],
    example: 'INR',
  },
  {
    name: 'balance_amount',
    label: 'Balance Amount',
    type: 'decimal',
    required: true,
    description: 'Signed opening balance amount at 4 decimal places',
    rules: ['OPB-004', 'RL-REQ-01', 'RL-CURRENCY-01'],
    example: '150000.0000',
  },
  {
    name: 'as_of_date',
    label: 'As of Date',
    type: 'date',
    required: true,
    description: 'Effective opening balance cutover date (YYYY-MM-DD)',
    rules: ['OPB-005', 'RL-REQ-01', 'RL-DATE-01'],
    example: '2026-04-01',
  },
  {
    name: 'source_reference',
    label: 'Source Reference',
    type: 'string',
    required: false,
    description: 'Legacy migration audit reference',
    example: 'AUDIT-OB-2026',
  },
  {
    name: 'source_id',
    label: 'Source Record ID',
    type: 'string',
    required: true,
    description: 'Source row identifier for idempotency tracking',
    rules: ['OPB-001', 'KIT-08'],
    example: 'OPB-001',
  },
];

export const erp4JournalEntriesTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'entry_number',
    label: 'Journal Entry Number',
    type: 'string',
    required: true,
    description: 'Sequential or alphanumeric journal entry reference',
    rules: ['JRN-002', 'RL-REQ-01'],
    example: 'JE-2026-001',
  },
  {
    name: 'period_id',
    label: 'Fiscal Period Label',
    type: 'string',
    required: true,
    description: 'Fiscal period in YYYY-MM format (e.g. 2026-04)',
    rules: ['JRN-003', 'RL-REQ-01'],
    example: '2026-04',
  },
  {
    name: 'posting_date',
    label: 'Posting Date',
    type: 'date',
    required: true,
    description: 'Accounting posting date (YYYY-MM-DD)',
    rules: ['JRN-004', 'RL-REQ-01', 'RL-DATE-01'],
    example: '2026-04-15',
  },
  {
    name: 'currency_code',
    label: 'Currency Code',
    type: 'string',
    required: true,
    description: 'Explicit journal entry currency',
    rules: ['JRN-005', 'RL-REQ-01'],
    example: 'INR',
  },
  {
    name: 'description',
    label: 'Description',
    type: 'string',
    required: true,
    description: 'General ledger header explanation',
    rules: ['JRN-006', 'RL-REQ-01'],
    example: 'Office rent and utility payment',
  },
  {
    name: 'lines',
    label: 'Journal Lines',
    type: 'string',
    required: true,
    description: 'Double-entry balanced debits and credits',
    rules: ['JRN-040', 'BR-ERP4-01'],
    example: '[{"account_id":"1010-CASH","debit":"100","credit":"0"}]',
  },
  {
    name: 'source_id',
    label: 'Source Record ID',
    type: 'string',
    required: true,
    description: 'Source entry identifier for idempotency',
    rules: ['JRN-001', 'KIT-08'],
    example: 'JRN-001',
  },
];

export const erp4JournalLinesTargetFields: readonly TargetFieldDefinition[] = [
  {
    name: 'journal_entry_id',
    label: 'Parent Entry Reference',
    type: 'string',
    required: true,
    description: 'Foreign link to header journal entry',
    rules: ['JRL-001', 'RL-REQ-01'],
    example: 'JRN-001',
  },
  {
    name: 'account_id',
    label: 'Account Code',
    type: 'string',
    required: true,
    description: 'Account code receiving debit or credit movement',
    rules: ['JRL-003', 'RL-REQ-01'],
    example: '1010-CASH',
  },
  {
    name: 'debit_amount',
    label: 'Debit Amount',
    type: 'decimal',
    required: true,
    description: 'Decimal debit amount (>= 0.0000)',
    rules: ['JRL-011', 'BR-ERP4-01'],
    example: '50000.0000',
  },
  {
    name: 'credit_amount',
    label: 'Credit Amount',
    type: 'decimal',
    required: true,
    description: 'Decimal credit amount (>= 0.0000)',
    rules: ['JRL-012', 'BR-ERP4-01'],
    example: '0.0000',
  },
  {
    name: 'line_narration',
    label: 'Line Narration',
    type: 'string',
    required: false,
    description: 'Optional line-level memo',
    rules: ['JRL-013'],
    example: 'April rent invoice #INV-492',
  },
  {
    name: 'department_ref',
    label: 'Department Reference',
    type: 'string',
    required: false,
    description: 'Cost center or ERP-5 department code (DEP-FIN, DEP-SALES)',
    rules: ['JRL-014'],
    example: 'DEP-FIN',
  },
];

// Target entity metadata registry definitions
export const erp4TargetEntities: Readonly<Record<string, TargetEntityMetadata>> = {
  account: {
    entity: 'account',
    label: 'Chart of Accounts',
    module: 'erp4',
    schemaVersion: 1,
    targetTable: 'erp4.accounts',
    primaryKey: 'id',
    naturalKey: 'code',
    fields: erp4AccountsTargetFields,
    mappingDefaults: {
      code: 'code',
      name: 'name',
      type: 'type',
      currency_code: 'currency_code',
      parent_id: 'parent_code',
      description: 'description',
      is_active: 'is_active',
      is_posting_account: 'is_posting_account',
      source_id: 'source_id',
    },
    validationRules: [
      { code: 'ACC-001', description: 'Account code required and unique' },
      { code: 'ACC-003', description: 'Type must match allowlist: asset, liability, income, expense' },
      { code: 'ACC-004', description: 'Currency code must match ISO 4217 allowlist: INR, USD, EUR' },
    ],
  },
  opening_balance: {
    entity: 'opening_balance',
    label: 'Opening Balances',
    module: 'erp4',
    schemaVersion: 1,
    targetTable: 'erp4.opening_balances',
    primaryKey: 'id',
    naturalKey: 'code',
    fields: erp4OpeningBalancesTargetFields,
    mappingDefaults: {
      account_id: 'code',
      currency_code: 'currency_code',
      balance_amount: 'balance_amount',
      as_of_date: 'as_of_date',
      source_reference: 'description',
      source_id: 'source_id',
    },
    validationRules: [
      { code: 'OPB-004', description: 'Balance amount must parse to valid signed decimal' },
      { code: 'OPB-005', description: 'As of date must parse to ISO 8601 YYYY-MM-DD' },
    ],
  },
  journal_entry: {
    entity: 'journal_entry',
    label: 'Journal Entries',
    module: 'erp4',
    schemaVersion: 1,
    targetTable: 'erp4.journal_entries',
    primaryKey: 'id',
    naturalKey: 'entry_number',
    fields: erp4JournalEntriesTargetFields,
    mappingDefaults: {
      entry_number: 'entry_number',
      period_id: 'period_label',
      posting_date: 'posting_date',
      currency_code: 'currency_code',
      description: 'description',
      lines: 'lines',
      source_id: 'source_id',
    },
    validationRules: [
      { code: 'BR-ERP4-01', description: 'Total debits must equal total credits at currency precision' },
      { code: 'BR-ERP4-02', description: 'Locked and soft closed periods reject posting' },
    ],
  },
  journal_line: {
    entity: 'journal_line',
    label: 'Journal Lines',
    module: 'erp4',
    schemaVersion: 1,
    targetTable: 'erp4.journal_lines',
    primaryKey: 'id',
    fields: erp4JournalLinesTargetFields,
    mappingDefaults: {
      journal_entry_id: 'parent_source_id',
      account_id: 'code',
      debit_amount: 'debit_amount',
      credit_amount: 'credit_amount',
      line_narration: 'line_narration',
      department_ref: 'department_ref',
    },
    validationRules: [
      { code: 'JRL-011', description: 'Debit amount non-negative decimal' },
      { code: 'JRL-012', description: 'Credit amount non-negative decimal' },
    ],
  },
};

export const erp4WebKitMetadata: ModuleKitMetadata = {
  moduleId: 'erp4',
  moduleName: 'ERP-4 Finance & Accounting',
  defaultEntity: 'account',
  entities: erp4TargetEntities,
  supportedSourceTypes: ['CSV', 'XLSX'],
};

// Auto-register with central MigrationKitRegistry
registerModuleKitMetadata(erp4WebKitMetadata);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Named, Versioned Mapping Templates (AC4)
// ─────────────────────────────────────────────────────────────────────────────

export interface MappingFieldRule {
  readonly source: string;
  readonly target: string;
  readonly required: boolean;
  readonly defaultValue?: unknown;
  readonly ruleIds?: readonly string[];
}

export interface EntityMappingTemplate {
  readonly recordType: string;
  readonly adapterEntity: string;
  readonly targetTable: string;
  readonly candidateKey: readonly string[];
  readonly fields: readonly MappingFieldRule[];
}

export interface NamedMappingTemplate {
  readonly templateId: string;
  readonly name: string;
  readonly version: string;
  readonly module: string;
  readonly description: string;
  readonly mappingSchemaVersion: number;
  readonly entities: Readonly<Record<string, EntityMappingTemplate>>;
  readonly createdAt: string;
}

export const ERP4_CANONICAL_MAPPING_TEMPLATE: NamedMappingTemplate = {
  templateId: 'erp4-canonical-v1',
  name: 'ERP-4 Finance Canonical Mapping Template',
  version: '1.0.0',
  module: 'erp4',
  description: 'Standard mapping template for accounts, opening balances, journal entries, and lines.',
  mappingSchemaVersion: 1,
  createdAt: '2026-10-24T00:00:00.000Z',
  entities: {
    account: {
      recordType: 'account',
      adapterEntity: 'account',
      targetTable: 'erp4.accounts',
      candidateKey: ['code'],
      fields: [
        { source: 'source_id', target: 'source_id', required: true, ruleIds: ['ACC-005'] },
        { source: 'code', target: 'code', required: true, ruleIds: ['ACC-001', 'ACC-010', 'ACC-020'] },
        { source: 'name', target: 'name', required: true, ruleIds: ['ACC-002', 'ACC-011'] },
        { source: 'type', target: 'type', required: true, ruleIds: ['ACC-003', 'ACC-012', 'ACC-030'] },
        { source: 'currency_code', target: 'currency_code', required: true, ruleIds: ['ACC-004', 'ACC-013'] },
        { source: 'parent_code', target: 'parent_id', required: false, ruleIds: ['ACC-014', 'ACC-040'] },
        { source: 'description', target: 'description', required: false, ruleIds: ['ACC-023'] },
        { source: 'is_active', target: 'is_active', required: false, defaultValue: true, ruleIds: ['ACC-032'] },
        { source: 'is_posting_account', target: 'is_posting_account', required: false, defaultValue: true, ruleIds: ['ACC-033'] },
      ],
    },
    opening_balance: {
      recordType: 'opening_balance',
      adapterEntity: 'opening_balance',
      targetTable: 'erp4.opening_balances',
      candidateKey: ['code', 'currency_code'],
      fields: [
        { source: 'source_id', target: 'source_id', required: true, ruleIds: ['OPB-001'] },
        { source: 'code', target: 'account_id', required: true, ruleIds: ['OPB-002', 'OPB-010', 'OPB-020'] },
        { source: 'currency_code', target: 'currency_code', required: true, ruleIds: ['OPB-003', 'OPB-011', 'OPB-021'] },
        { source: 'balance_amount', target: 'balance_amount', required: true, ruleIds: ['OPB-004', 'OPB-012', 'OPB-022'] },
        { source: 'as_of_date', target: 'as_of_date', required: true, ruleIds: ['OPB-005', 'OPB-013', 'OPB-025'] },
        { source: 'description', target: 'source_reference', required: false },
      ],
    },
    journal_entry: {
      recordType: 'journal_entry',
      adapterEntity: 'journal_entry',
      targetTable: 'erp4.journal_entries',
      candidateKey: ['entry_number'],
      fields: [
        { source: 'source_id', target: 'source_id', required: true, ruleIds: ['JRN-001'] },
        { source: 'entry_number', target: 'entry_number', required: true, ruleIds: ['JRN-002', 'JRN-010', 'JRN-020'] },
        { source: 'period_label', target: 'period_id', required: true, ruleIds: ['JRN-003', 'JRN-011', 'JRN-021'] },
        { source: 'posting_date', target: 'posting_date', required: true, ruleIds: ['JRN-004', 'JRN-012', 'JRN-024'] },
        { source: 'currency_code', target: 'currency_code', required: true, ruleIds: ['JRN-005', 'JRN-013', 'JRN-025'] },
        { source: 'description', target: 'description', required: true, ruleIds: ['JRN-006', 'JRN-014'] },
        { source: 'lines', target: 'lines', required: true, ruleIds: ['JRN-040', 'BR-ERP4-01'] },
      ],
    },
    journal_line: {
      recordType: 'journal_line',
      adapterEntity: 'journal_line',
      targetTable: 'erp4.journal_lines',
      candidateKey: ['parent_source_id', 'code'],
      fields: [
        { source: 'parent_source_id', target: 'journal_entry_id', required: true, ruleIds: ['JRL-001'] },
        { source: 'code', target: 'account_id', required: true, ruleIds: ['JRL-003', 'JRL-004'] },
        { source: 'debit_amount', target: 'debit_amount', required: true, defaultValue: '0.0000', ruleIds: ['JRL-011'] },
        { source: 'credit_amount', target: 'credit_amount', required: true, defaultValue: '0.0000', ruleIds: ['JRL-012'] },
        { source: 'line_narration', target: 'line_narration', required: false, ruleIds: ['JRL-013'] },
        { source: 'department_ref', target: 'department_ref', required: false, ruleIds: ['JRL-014'] },
      ],
    },
  },
};

export const ERP4_DEFAULT_MAPPING_TEMPLATES: readonly NamedMappingTemplate[] = [
  ERP4_CANONICAL_MAPPING_TEMPLATE,
];

// ─────────────────────────────────────────────────────────────────────────────
// 5. Mapping Transformation & Target Enforcement Engine (AC1, AC2, AC3)
// ─────────────────────────────────────────────────────────────────────────────

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
 * Validates mapping configuration for an entity and verifies all required target fields are mapped.
 */
export function validateErp4Mapping(
  entityName: string,
  mapping: Record<string, string>,
  sourceTypes?: Record<string, string>
): MappingValidationResult {
  const entityMeta = erp4TargetEntities[entityName];
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

/**
 * Transforms a single row of source data into target schema according to mapping and enum translation rules.
 * Enforces AC1 (coercions), AC2 (enum translations), and AC3 (required guards).
 */
export function transformSourceRowToTarget(
  entityName: string,
  mapping: Record<string, string>,
  sourceRow: Record<string, unknown>
): TransformRowOutcome {
  const entityMeta = erp4TargetEntities[entityName];
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

    // Required check
    if (field.required) {
      if (!sourceCol || rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
        errors.push(`Missing required target field '${field.name}' (${field.label})`);
        continue;
      }
    }

    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
      if (field.example !== undefined && !field.required) {
        // default optional omitted
        continue;
      }
      continue;
    }

    try {
      switch (field.type) {
        case 'enum': {
          if (field.name === 'type') {
            transformed[field.name] = translateEnum(rawVal, ACCOUNT_TYPE_TRANSLATION_MAP, field.name);
          } else if (field.name === 'status') {
            transformed[field.name] = translateEnum(rawVal, PERIOD_STATUS_TRANSLATION_MAP, field.name);
          } else {
            transformed[field.name] = String(rawVal).trim();
          }
          break;
        }

        case 'decimal': {
          transformed[field.name] = coerceDecimalAmount(rawVal, field.name);
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

        case 'string': {
          if (field.name === 'currency_code') {
            transformed[field.name] = translateEnum(rawVal, CURRENCY_CODE_TRANSLATION_MAP, field.name);
          } else if (field.name === 'code') {
            transformed[field.name] = String(rawVal).trim().toUpperCase();
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
 * Transforms a dataset of source rows using the provided mapping configuration.
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
