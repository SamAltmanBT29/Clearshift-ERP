/**
 * ERP-4 Finance & Accounting — V1 Data-Quality Rule Catalogue & Engine
 *
 * Pure, deterministic, dependency-free (apart from node:crypto) rules that decide,
 * row by row, whether raw migration input for chart of accounts, opening balances,
 * journal entries and journal lines is accepted, rejected, or held for explicit human review.
 *
 * Guarantees:
 *   - Raw input is never mutated: rows are frozen on read; cleaning produces new values.
 *   - Every rule has a stable rule_id, a version, an input condition, a result and a reason.
 *   - No fuzzy matching and no automatic merge: duplicates are only EXACT candidate keys
 *     (account code, opening-balance (account+currency), journal entry_number) and are held for review, never merged.
 *   - Same fixture + same RULES_VERSION => byte-identical profile (see stableStringify).
 *   - Cross-module department references go through the ReferenceResolver contract
 *     (Decision C7); this module never reads ERP-5 tables directly.
 *   - Every posted journal entry balances exactly at currency precision (BR-ERP4-01).
 *   - Closed/locked accounting periods reject postings unconditionally (BR-ERP4-02).
 *   - Debit and credit are non-negative and mutually exclusive per line.
 *   - One-time opening balance load per account/currency (FR-ERP4-04).
 *   - Trial balance groups by account and currency and never adds unlike currencies (FR-ERP4-03).
 *
 * Traceability: SDS ClearShift ERP v2.0 V1 — FR-ERP4-01..05, BR-ERP4-01..02; Project Plan v3.0 §7.9.
 *
 * @module erp4/migration/rules
 */

import { createHash } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Versions & constants
// ─────────────────────────────────────────────────────────────────────────────

export const RULES_VERSION = '1.0.0';
export const FIXTURE_SCHEMA_VERSION = 1;
export const PROFILE_SCHEMA_VERSION = 1;
export const SOURCE_SYSTEM = 'SYNTH-ERP4-DIRTY-V1';
export const FIXTURE_PATH = 'sample-data/erp-4/dirty-data-v1.csv';

/** ISO 4217 codes accepted in V1. Currency is always explicit; there is no FX conversion. */
export const ACCEPTED_CURRENCIES = ['INR', 'USD', 'EUR'] as const;
export type AcceptedCurrency = (typeof ACCEPTED_CURRENCIES)[number];

/** FR-ERP4-01: account classification taxonomy */
export const ACCOUNT_TYPES = ['asset', 'liability', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** BR-ERP4-01: Journal entry lifecycle states */
export const JOURNAL_STATUSES = ['draft', 'posted', 'reversed', 'voided'] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

/** BR-ERP4-02: Period lifecycle states */
export const PERIOD_STATUSES = ['open', 'soft_closed', 'locked'] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const RECORD_TYPES = ['account', 'opening_balance', 'journal_entry', 'journal_line'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

/** Exact column order of the fixture. Reading a file with any other header throws. */
export const FIXTURE_COLUMNS = [
  'row_id',
  'record_type',
  'case_tags',
  'source_id',
  'parent_source_id',
  'code',
  'name',
  'type',
  'currency_code',
  'parent_code',
  'description',
  'is_active',
  'is_posting_account',
  'balance_amount',
  'as_of_date',
  'entry_number',
  'period_label',
  'posting_date',
  'debit_amount',
  'credit_amount',
  'line_narration',
  'department_ref',
  'expect_outcome',
  'expect_reasons',
] as const;
export type FixtureColumn = (typeof FIXTURE_COLUMNS)[number];

// Numeric limits from PostgreSQL schema: numeric(20,4)
const MAX_INTEGER_DIGITS = 16;
const MAX_FRACTION_DIGITS = 4;

// ─────────────────────────────────────────────────────────────────────────────
// Rule catalogue types
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
  readonly reason_code?: string;
  readonly human_reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Complete Rule Catalogue
// ─────────────────────────────────────────────────────────────────────────────

export const RULE_CATALOGUE: readonly DataQualityRule[] = [
  // ── Chart of Accounts: Required Fields ──────────────────────────────────────
  {
    rule_id: 'ACC-001',
    version: '1.0.0',
    entity: 'account',
    field: 'code',
    kind: 'required',
    input_condition: 'code is empty after trimming',
    result: 'reject',
    reason_code: 'ACCOUNT_CODE_REQUIRED',
    human_reason: 'Account code is required.',
  },
  {
    rule_id: 'ACC-002',
    version: '1.0.0',
    entity: 'account',
    field: 'name',
    kind: 'required',
    input_condition: 'name is empty after trimming',
    result: 'reject',
    reason_code: 'ACCOUNT_NAME_REQUIRED',
    human_reason: 'Account name is required.',
  },
  {
    rule_id: 'ACC-003',
    version: '1.0.0',
    entity: 'account',
    field: 'type',
    kind: 'required',
    input_condition: 'type is empty after trimming',
    result: 'reject',
    reason_code: 'ACCOUNT_TYPE_REQUIRED',
    human_reason: 'Account type is required.',
  },
  {
    rule_id: 'ACC-004',
    version: '1.0.0',
    entity: 'account',
    field: 'currency_code',
    kind: 'required',
    input_condition: 'currency_code is empty after trimming',
    result: 'reject',
    reason_code: 'CURRENCY_REQUIRED',
    human_reason: 'Currency code is required; V1 performs no FX conversion.',
  },
  {
    rule_id: 'ACC-005',
    version: '1.0.0',
    entity: 'account',
    field: 'source_id',
    kind: 'required',
    input_condition: 'source_id is empty after trimming',
    result: 'reject',
    reason_code: 'SOURCE_ID_REQUIRED',
    human_reason: 'Source ID is required for account migration lineage.',
  },

  // ── Chart of Accounts: Normalization ────────────────────────────────────────
  {
    rule_id: 'ACC-010',
    version: '1.0.0',
    entity: 'account',
    field: 'code',
    kind: 'normalize',
    input_condition: 'code contains lowercase characters or leading/trailing whitespace',
    result: 'normalize',
    human_reason: 'Account code is trimmed and upper-cased.',
  },
  {
    rule_id: 'ACC-011',
    version: '1.0.0',
    entity: 'account',
    field: 'name',
    kind: 'normalize',
    input_condition: 'name contains leading/trailing whitespace or multiple spaces',
    result: 'normalize',
    human_reason: 'Account name is trimmed and inner whitespace collapsed.',
  },
  {
    rule_id: 'ACC-012',
    version: '1.0.0',
    entity: 'account',
    field: 'type',
    kind: 'normalize',
    input_condition: 'type contains uppercase characters or surrounding whitespace',
    result: 'normalize',
    human_reason: 'Account type is trimmed and lower-cased.',
  },
  {
    rule_id: 'ACC-013',
    version: '1.0.0',
    entity: 'account',
    field: 'currency_code',
    kind: 'normalize',
    input_condition: 'currency_code contains lowercase characters or surrounding whitespace',
    result: 'normalize',
    human_reason: 'Currency code is trimmed and upper-cased.',
  },
  {
    rule_id: 'ACC-014',
    version: '1.0.0',
    entity: 'account',
    field: 'parent_code',
    kind: 'normalize',
    input_condition: 'parent_code contains lowercase characters or surrounding whitespace',
    result: 'normalize',
    human_reason: 'Parent account code is trimmed and upper-cased.',
  },

  // ── Chart of Accounts: Formats & Lengths ────────────────────────────────────
  {
    rule_id: 'ACC-020',
    version: '1.0.0',
    entity: 'account',
    field: 'code',
    kind: 'format',
    input_condition: 'code contains characters outside [A-Za-z0-9_-]',
    result: 'reject',
    reason_code: 'INVALID_ACCOUNT_CODE_FORMAT',
    human_reason: 'Account code must be alphanumeric with hyphens or underscores.',
  },
  {
    rule_id: 'ACC-021',
    version: '1.0.0',
    entity: 'account',
    field: 'code',
    kind: 'length',
    input_condition: 'code length exceeds 32 characters',
    result: 'reject',
    reason_code: 'ACCOUNT_CODE_TOO_LONG',
    human_reason: 'Account code cannot exceed 32 characters.',
  },
  {
    rule_id: 'ACC-022',
    version: '1.0.0',
    entity: 'account',
    field: 'name',
    kind: 'length',
    input_condition: 'name length exceeds 255 characters',
    result: 'reject',
    reason_code: 'ACCOUNT_NAME_TOO_LONG',
    human_reason: 'Account name cannot exceed 255 characters.',
  },
  {
    rule_id: 'ACC-023',
    version: '1.0.0',
    entity: 'account',
    field: 'description',
    kind: 'length',
    input_condition: 'description length exceeds 2000 characters',
    result: 'reject',
    reason_code: 'DESCRIPTION_TOO_LONG',
    human_reason: 'Account description cannot exceed 2000 characters.',
  },

  // ── Chart of Accounts: Enumerations ─────────────────────────────────────────
  {
    rule_id: 'ACC-030',
    version: '1.0.0',
    entity: 'account',
    field: 'type',
    kind: 'enum',
    input_condition: 'type is not one of asset, liability, income, expense',
    result: 'reject',
    reason_code: 'INVALID_ACCOUNT_TYPE',
    human_reason: 'Account type must be one of asset, liability, income, expense.',
  },
  {
    rule_id: 'ACC-031',
    version: '1.0.0',
    entity: 'account',
    field: 'currency_code',
    kind: 'enum',
    input_condition: 'currency_code is not one of INR, USD, EUR',
    result: 'reject',
    reason_code: 'INVALID_CURRENCY',
    human_reason: 'Currency code must be an accepted ISO 4217 currency (INR, USD, EUR).',
  },
  {
    rule_id: 'ACC-032',
    version: '1.0.0',
    entity: 'account',
    field: 'is_active',
    kind: 'format',
    input_condition: 'is_active is not a valid boolean representation',
    result: 'reject',
    reason_code: 'INVALID_BOOLEAN',
    human_reason: 'is_active must be true or false.',
  },
  {
    rule_id: 'ACC-033',
    version: '1.0.0',
    entity: 'account',
    field: 'is_posting_account',
    kind: 'format',
    input_condition: 'is_posting_account is not a valid boolean representation',
    result: 'reject',
    reason_code: 'INVALID_BOOLEAN',
    human_reason: 'is_posting_account must be true or false.',
  },

  // ── Chart of Accounts: Hierarchy & Cycles ───────────────────────────────────
  {
    rule_id: 'ACC-040',
    version: '1.0.0',
    entity: 'account',
    field: 'parent_code',
    kind: 'reference',
    input_condition: 'parent_code references an account not present in the chart of accounts',
    result: 'reject',
    reason_code: 'PARENT_ACCOUNT_NOT_FOUND',
    human_reason: 'Referenced parent account does not exist.',
  },
  {
    rule_id: 'ACC-041',
    version: '1.0.0',
    entity: 'account',
    field: 'parent_code',
    kind: 'invariant',
    input_condition: 'parent_code references self or forms an ancestor cycle',
    result: 'reject',
    reason_code: 'CYCLE_DETECTED',
    human_reason: 'Parent account reference forms a self-reference or circular hierarchy.',
  },
  {
    rule_id: 'ACC-042',
    version: '1.0.0',
    entity: 'account',
    field: 'parent_code',
    kind: 'invariant',
    input_condition: 'parent account currency differs from child account currency',
    result: 'reject',
    reason_code: 'CURRENCY_MISMATCH',
    human_reason: 'Parent and child accounts must have the same currency code.',
  },

  // ── Chart of Accounts: Duplicate Candidate Keys ─────────────────────────────
  {
    rule_id: 'ACC-050',
    version: '1.0.0',
    entity: 'account',
    field: 'code',
    kind: 'duplicate',
    input_condition: 'code matches an earlier account code after normalization',
    result: 'review',
    reason_code: 'DUPLICATE_ACCOUNT_CODE_REVIEW',
    human_reason: 'Exact duplicate account code candidate; held for explicit human review.',
  },

  // ── Opening Balances: Required Fields ───────────────────────────────────────
  {
    rule_id: 'OPB-001',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'source_id',
    kind: 'required',
    input_condition: 'source_id is empty after trimming',
    result: 'reject',
    reason_code: 'SOURCE_ID_REQUIRED',
    human_reason: 'Source ID is required for opening balance lineage.',
  },
  {
    rule_id: 'OPB-002',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'code',
    kind: 'required',
    input_condition: 'code is empty after trimming',
    result: 'reject',
    reason_code: 'ACCOUNT_CODE_REQUIRED',
    human_reason: 'Account code is required for opening balance.',
  },
  {
    rule_id: 'OPB-003',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'currency_code',
    kind: 'required',
    input_condition: 'currency_code is empty after trimming',
    result: 'reject',
    reason_code: 'CURRENCY_REQUIRED',
    human_reason: 'Currency code is required for opening balance.',
  },
  {
    rule_id: 'OPB-004',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'balance_amount',
    kind: 'required',
    input_condition: 'balance_amount is empty after trimming',
    result: 'reject',
    reason_code: 'BALANCE_AMOUNT_REQUIRED',
    human_reason: 'Balance amount is required for opening balance.',
  },
  {
    rule_id: 'OPB-005',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'as_of_date',
    kind: 'required',
    input_condition: 'as_of_date is empty after trimming',
    result: 'reject',
    reason_code: 'AS_OF_DATE_REQUIRED',
    human_reason: 'as_of_date is required for opening balance.',
  },

  // ── Opening Balances: Normalization & Formats ───────────────────────────────
  {
    rule_id: 'OPB-010',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'code',
    kind: 'normalize',
    input_condition: 'code contains lowercase characters or surrounding whitespace',
    result: 'normalize',
    human_reason: 'Opening balance account code is trimmed and upper-cased.',
  },
  {
    rule_id: 'OPB-011',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'currency_code',
    kind: 'normalize',
    input_condition: 'currency_code contains lowercase characters or surrounding whitespace',
    result: 'normalize',
    human_reason: 'Opening balance currency is trimmed and upper-cased.',
  },
  {
    rule_id: 'OPB-012',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'balance_amount',
    kind: 'normalize',
    input_condition: 'balance_amount contains commas or padding spaces',
    result: 'normalize',
    human_reason: 'Balance amount is trimmed and commas removed.',
  },
  {
    rule_id: 'OPB-013',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'as_of_date',
    kind: 'normalize',
    input_condition: 'as_of_date uses YYYY/MM/DD slash notation',
    result: 'normalize',
    human_reason: 'as_of_date is normalized to ISO YYYY-MM-DD.',
  },
  {
    rule_id: 'OPB-020',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'code',
    kind: 'reference',
    input_condition: 'code does not match an accepted account in the chart of accounts',
    result: 'reject',
    reason_code: 'ACCOUNT_NOT_FOUND',
    human_reason: 'Opening balance references an account that does not exist in chart of accounts.',
  },
  {
    rule_id: 'OPB-021',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'currency_code',
    kind: 'invariant',
    input_condition: 'currency_code does not match the referenced account currency',
    result: 'reject',
    reason_code: 'CURRENCY_MISMATCH',
    human_reason: 'Opening balance currency does not match account currency.',
  },
  {
    rule_id: 'OPB-022',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'balance_amount',
    kind: 'format',
    input_condition: 'balance_amount is not a valid signed decimal string',
    result: 'reject',
    reason_code: 'INVALID_BALANCE_AMOUNT',
    human_reason: 'Balance amount must be a valid signed numeric decimal.',
  },
  {
    rule_id: 'OPB-023',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'balance_amount',
    kind: 'format',
    input_condition: 'balance_amount exceeds 4 decimal places',
    result: 'reject',
    reason_code: 'EXCESS_DECIMAL_PLACES',
    human_reason: 'Balance amount cannot exceed 4 decimal places.',
  },
  {
    rule_id: 'OPB-024',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'balance_amount',
    kind: 'length',
    input_condition: 'balance_amount integer digits exceed 16 digits',
    result: 'reject',
    reason_code: 'AMOUNT_OVERFLOW',
    human_reason: 'Balance amount exceeds PostgreSQL numeric(20,4) maximum range.',
  },
  {
    rule_id: 'OPB-025',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'as_of_date',
    kind: 'format',
    input_condition: 'as_of_date is not a valid calendar date',
    result: 'reject',
    reason_code: 'INVALID_DATE',
    human_reason: 'as_of_date must be a valid calendar date.',
  },
  {
    rule_id: 'OPB-026',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'as_of_date',
    kind: 'format',
    input_condition: 'as_of_date uses ambiguous DD/MM or MM/DD format',
    result: 'reject',
    reason_code: 'AMBIGUOUS_DATE_FORMAT',
    human_reason: 'Ambiguous date format; explicit YYYY-MM-DD required.',
  },
  {
    rule_id: 'OPB-027',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'currency_code',
    kind: 'enum',
    input_condition: 'currency_code is not an accepted currency',
    result: 'reject',
    reason_code: 'INVALID_CURRENCY',
    human_reason: 'Opening balance currency must be an accepted ISO 4217 currency.',
  },
  {
    rule_id: 'OPB-030',
    version: '1.0.0',
    entity: 'opening_balance',
    field: 'code',
    kind: 'duplicate',
    input_condition: 'opening balance for (account_code, currency_code) was already seen in batch',
    result: 'review',
    reason_code: 'DUPLICATE_OPENING_BALANCE_REVIEW',
    human_reason: 'Opening balance loaded once per account/currency (FR-ERP4-04); duplicate held for review.',
  },

  // ── Journal Entries: Required Fields ────────────────────────────────────────
  {
    rule_id: 'JRN-001',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'source_id',
    kind: 'required',
    input_condition: 'source_id is empty after trimming',
    result: 'reject',
    reason_code: 'SOURCE_ID_REQUIRED',
    human_reason: 'Source ID is required for journal entry lineage.',
  },
  {
    rule_id: 'JRN-002',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'entry_number',
    kind: 'required',
    input_condition: 'entry_number is empty after trimming',
    result: 'reject',
    reason_code: 'ENTRY_NUMBER_REQUIRED',
    human_reason: 'Entry number is required for journal entry.',
  },
  {
    rule_id: 'JRN-003',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'period_label',
    kind: 'required',
    input_condition: 'period_label is empty after trimming',
    result: 'reject',
    reason_code: 'PERIOD_LABEL_REQUIRED',
    human_reason: 'Period label is required (YYYY-MM).',
  },
  {
    rule_id: 'JRN-004',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'posting_date',
    kind: 'required',
    input_condition: 'posting_date is empty after trimming',
    result: 'reject',
    reason_code: 'POSTING_DATE_REQUIRED',
    human_reason: 'Posting date is required for journal entry.',
  },
  {
    rule_id: 'JRN-005',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'currency_code',
    kind: 'required',
    input_condition: 'currency_code is empty after trimming',
    result: 'reject',
    reason_code: 'CURRENCY_REQUIRED',
    human_reason: 'Journal entry currency is required.',
  },
  {
    rule_id: 'JRN-006',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'description',
    kind: 'required',
    input_condition: 'description is empty after trimming',
    result: 'reject',
    reason_code: 'DESCRIPTION_REQUIRED',
    human_reason: 'Journal entry description is required.',
  },

  // ── Journal Entries: Normalization & Formats ────────────────────────────────
  {
    rule_id: 'JRN-010',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'entry_number',
    kind: 'normalize',
    input_condition: 'entry_number contains lowercase or surrounding whitespace',
    result: 'normalize',
    human_reason: 'Entry number is trimmed and upper-cased.',
  },
  {
    rule_id: 'JRN-011',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'period_label',
    kind: 'normalize',
    input_condition: 'period_label contains surrounding whitespace',
    result: 'normalize',
    human_reason: 'Period label is trimmed.',
  },
  {
    rule_id: 'JRN-012',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'posting_date',
    kind: 'normalize',
    input_condition: 'posting_date uses YYYY/MM/DD slash notation',
    result: 'normalize',
    human_reason: 'Posting date is normalized to ISO YYYY-MM-DD.',
  },
  {
    rule_id: 'JRN-013',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'currency_code',
    kind: 'normalize',
    input_condition: 'currency_code contains lowercase or whitespace',
    result: 'normalize',
    human_reason: 'Currency code is trimmed and upper-cased.',
  },
  {
    rule_id: 'JRN-014',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'description',
    kind: 'normalize',
    input_condition: 'description contains multiple consecutive inner spaces',
    result: 'normalize',
    human_reason: 'Description is trimmed and inner spaces collapsed.',
  },
  {
    rule_id: 'JRN-020',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'entry_number',
    kind: 'length',
    input_condition: 'entry_number length exceeds 64 characters',
    result: 'reject',
    reason_code: 'ENTRY_NUMBER_TOO_LONG',
    human_reason: 'Entry number cannot exceed 64 characters.',
  },
  {
    rule_id: 'JRN-021',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'period_label',
    kind: 'format',
    input_condition: 'period_label does not match YYYY-MM format',
    result: 'reject',
    reason_code: 'INVALID_PERIOD_FORMAT',
    human_reason: 'Period label must be in YYYY-MM format.',
  },
  {
    rule_id: 'JRN-022',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'period_label',
    kind: 'reference',
    input_condition: 'period_label is not found in the fiscal calendar',
    result: 'reject',
    reason_code: 'PERIOD_NOT_FOUND',
    human_reason: 'Referenced accounting period does not exist in fiscal calendar.',
  },
  {
    rule_id: 'JRN-023',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'period_label',
    kind: 'invariant',
    input_condition: 'accounting period is locked (BR-ERP4-02)',
    result: 'reject',
    reason_code: 'PERIOD_LOCKED',
    human_reason: 'Accounting period is locked; closed period rejects posting (BR-ERP4-02).',
  },
  {
    rule_id: 'JRN-024',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'posting_date',
    kind: 'format',
    input_condition: 'posting_date is not a valid calendar date',
    result: 'reject',
    reason_code: 'INVALID_POSTING_DATE',
    human_reason: 'Posting date must be a valid calendar date.',
  },
  {
    rule_id: 'JRN-025',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'currency_code',
    kind: 'enum',
    input_condition: 'currency_code is not one of INR, USD, EUR',
    result: 'reject',
    reason_code: 'INVALID_CURRENCY',
    human_reason: 'Journal entry currency must be an accepted ISO 4217 currency.',
  },
  {
    rule_id: 'JRN-030',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'entry_number',
    kind: 'duplicate',
    input_condition: 'entry_number matches an earlier journal entry in batch',
    result: 'review',
    reason_code: 'DUPLICATE_ENTRY_NUMBER_REVIEW',
    human_reason: 'Exact duplicate entry_number candidate; held for human review.',
  },

  // ── Journal Entries: Balancing & Lines Cascades ─────────────────────────────
  {
    rule_id: 'JRN-040',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'lines',
    kind: 'invariant',
    input_condition: 'journal entry has no lines in fixture',
    result: 'reject',
    reason_code: 'NO_LINES',
    human_reason: 'Journal entry has no child lines.',
  },
  {
    rule_id: 'JRN-041',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'lines',
    kind: 'invariant',
    input_condition: 'journal entry has fewer than 2 lines',
    result: 'reject',
    reason_code: 'MINIMUM_LINES_REQUIRED',
    human_reason: 'Double-entry journal must have at least 2 lines (debit and credit).',
  },
  {
    rule_id: 'JRN-042',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'lines',
    kind: 'invariant',
    input_condition: 'total debits != total credits at currency precision (BR-ERP4-01)',
    result: 'reject',
    reason_code: 'UNBALANCED_JOURNAL_ENTRY',
    human_reason: 'Journal entry is unbalanced: total debits must equal total credits.',
  },
  {
    rule_id: 'JRN-043',
    version: '1.0.0',
    entity: 'journal_entry',
    field: 'lines',
    kind: 'invariant',
    input_condition: 'one or more lines failed validation',
    result: 'reject',
    reason_code: 'LINE_REJECTED',
    human_reason: 'Journal entry rejected because one or more child lines failed validation.',
  },

  // ── Journal Lines: Required & References ────────────────────────────────────
  {
    rule_id: 'JRL-001',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'parent_source_id',
    kind: 'required',
    input_condition: 'parent_source_id is empty after trimming',
    result: 'reject',
    reason_code: 'PARENT_SOURCE_ID_REQUIRED',
    human_reason: 'parent_source_id is required to link line to journal entry.',
  },
  {
    rule_id: 'JRL-002',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'parent_source_id',
    kind: 'reference',
    input_condition: 'parent_source_id does not match any journal entry in batch',
    result: 'reject',
    reason_code: 'ORPHAN_LINE',
    human_reason: 'Orphan journal line references a non-existent parent journal entry.',
  },
  {
    rule_id: 'JRL-003',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'code',
    kind: 'required',
    input_condition: 'code is empty after trimming',
    result: 'reject',
    reason_code: 'ACCOUNT_CODE_REQUIRED',
    human_reason: 'Account code is required on journal line.',
  },
  {
    rule_id: 'JRL-004',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'code',
    kind: 'reference',
    input_condition: 'referenced account does not exist in chart of accounts',
    result: 'reject',
    reason_code: 'ACCOUNT_NOT_FOUND',
    human_reason: 'Journal line references an account not found in chart of accounts.',
  },
  {
    rule_id: 'JRL-005',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'code',
    kind: 'invariant',
    input_condition: 'referenced account is inactive (is_active = false)',
    result: 'reject',
    reason_code: 'ACCOUNT_INACTIVE',
    human_reason: 'Cannot post journal entries to an inactive account.',
  },
  {
    rule_id: 'JRL-006',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'code',
    kind: 'invariant',
    input_condition: 'referenced account is a header account (is_posting_account = false)',
    result: 'reject',
    reason_code: 'CANNOT_POST_TO_HEADER_ACCOUNT',
    human_reason: 'Cannot post journal entries to a non-posting header account.',
  },

  // ── Journal Lines: Amounts & Mutual Exclusivity ─────────────────────────────
  {
    rule_id: 'JRL-010',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'code',
    kind: 'normalize',
    input_condition: 'code contains lowercase or whitespace',
    result: 'normalize',
    human_reason: 'Account code on journal line is trimmed and upper-cased.',
  },
  {
    rule_id: 'JRL-011',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'debit_amount',
    kind: 'normalize',
    input_condition: 'debit_amount contains commas or padding spaces',
    result: 'normalize',
    human_reason: 'Debit amount is trimmed and commas removed.',
  },
  {
    rule_id: 'JRL-012',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'credit_amount',
    kind: 'normalize',
    input_condition: 'credit_amount contains commas or padding spaces',
    result: 'normalize',
    human_reason: 'Credit amount is trimmed and commas removed.',
  },
  {
    rule_id: 'JRL-013',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'line_narration',
    kind: 'normalize',
    input_condition: 'line_narration contains surrounding whitespace',
    result: 'normalize',
    human_reason: 'Line narration is trimmed.',
  },
  {
    rule_id: 'JRL-014',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'department_ref',
    kind: 'normalize',
    input_condition: 'department_ref contains lowercase or whitespace',
    result: 'normalize',
    human_reason: 'Department reference is trimmed and upper-cased.',
  },
  {
    rule_id: 'JRL-020',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'debit_amount',
    kind: 'invariant',
    input_condition: 'debit_amount is negative',
    result: 'reject',
    reason_code: 'NEGATIVE_AMOUNT',
    human_reason: 'Debit amount cannot be negative.',
  },
  {
    rule_id: 'JRL-021',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'credit_amount',
    kind: 'invariant',
    input_condition: 'credit_amount is negative',
    result: 'reject',
    reason_code: 'NEGATIVE_AMOUNT',
    human_reason: 'Credit amount cannot be negative.',
  },
  {
    rule_id: 'JRL-022',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'debit_amount',
    kind: 'invariant',
    input_condition: 'both debit_amount > 0 and credit_amount > 0 on same line',
    result: 'reject',
    reason_code: 'LINE_DEBIT_AND_CREDIT',
    human_reason: 'A journal line cannot have both debit and credit positive (mutually exclusive).',
  },
  {
    rule_id: 'JRL-023',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'debit_amount',
    kind: 'invariant',
    input_condition: 'both debit_amount == 0 and credit_amount == 0',
    result: 'reject',
    reason_code: 'LINE_ZERO_AMOUNTS',
    human_reason: 'A journal line must have at least one non-zero side.',
  },
  {
    rule_id: 'JRL-024',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'debit_amount',
    kind: 'format',
    input_condition: 'amount exceeds 4 decimal places',
    result: 'reject',
    reason_code: 'EXCESS_DECIMAL_PLACES',
    human_reason: 'Journal line amount cannot exceed 4 decimal places.',
  },
  {
    rule_id: 'JRL-025',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'debit_amount',
    kind: 'length',
    input_condition: 'amount exceeds PostgreSQL numeric(20,4) maximum range',
    result: 'reject',
    reason_code: 'AMOUNT_OVERFLOW',
    human_reason: 'Journal line amount exceeds numeric(20,4) precision.',
  },
  {
    rule_id: 'JRL-026',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'line_narration',
    kind: 'length',
    input_condition: 'line_narration exceeds 255 characters',
    result: 'reject',
    reason_code: 'LINE_NARRATION_TOO_LONG',
    human_reason: 'Line narration cannot exceed 255 characters.',
  },
  {
    rule_id: 'JRL-027',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'department_ref',
    kind: 'reference',
    input_condition: 'department_ref is unknown in department resolver',
    result: 'reject',
    reason_code: 'DEPARTMENT_NOT_FOUND',
    human_reason: 'Referenced department does not exist in ERP-5.',
  },
  {
    rule_id: 'JRL-030',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'parent_source_id',
    kind: 'invariant',
    input_condition: 'parent journal entry is held for review',
    result: 'review',
    reason_code: 'PARENT_ENTRY_IN_REVIEW',
    human_reason: 'Parent journal entry is held for review; line cannot be loaded.',
  },
  {
    rule_id: 'JRL-031',
    version: '1.0.0',
    entity: 'journal_line',
    field: 'parent_source_id',
    kind: 'invariant',
    input_condition: 'parent journal entry was rejected',
    result: 'reject',
    reason_code: 'PARENT_ENTRY_REJECTED',
    human_reason: 'Parent journal entry was rejected; line cannot be loaded.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Covered fields manifest
// ─────────────────────────────────────────────────────────────────────────────

export const COVERED_FIELDS: Record<
  RecordType,
  Record<string, { required: boolean; valid_tags: string[]; invalid_tags: string[] }>
> = {
  account: {
    source_id: {
      required: true,
      valid_tags: ['account.source_id:valid'],
      invalid_tags: ['account.source_id:invalid'],
    },
    code: {
      required: true,
      valid_tags: ['account.code:valid'],
      invalid_tags: ['account.code:invalid'],
    },
    name: {
      required: true,
      valid_tags: ['account.name:valid'],
      invalid_tags: ['account.name:invalid'],
    },
    type: {
      required: true,
      valid_tags: ['account.type:valid'],
      invalid_tags: ['account.type:invalid'],
    },
    currency_code: {
      required: true,
      valid_tags: ['account.currency_code:valid'],
      invalid_tags: ['account.currency_code:invalid'],
    },
    parent_code: {
      required: false,
      valid_tags: ['account.parent_code:valid'],
      invalid_tags: ['account.parent_code:invalid'],
    },
    description: {
      required: false,
      valid_tags: ['account.description:valid'],
      invalid_tags: ['account.description:invalid'],
    },
    is_active: {
      required: false,
      valid_tags: ['account.is_active:valid'],
      invalid_tags: ['account.is_active:invalid'],
    },
    is_posting_account: {
      required: false,
      valid_tags: ['account.is_posting_account:valid'],
      invalid_tags: ['account.is_posting_account:invalid'],
    },
  },
  opening_balance: {
    source_id: {
      required: true,
      valid_tags: ['opening_balance.source_id:valid'],
      invalid_tags: ['opening_balance.source_id:invalid'],
    },
    code: {
      required: true,
      valid_tags: ['opening_balance.code:valid'],
      invalid_tags: ['opening_balance.code:invalid'],
    },
    currency_code: {
      required: true,
      valid_tags: ['opening_balance.currency_code:valid'],
      invalid_tags: ['opening_balance.currency_code:invalid'],
    },
    balance_amount: {
      required: true,
      valid_tags: ['opening_balance.balance_amount:valid'],
      invalid_tags: ['opening_balance.balance_amount:invalid'],
    },
    as_of_date: {
      required: true,
      valid_tags: ['opening_balance.as_of_date:valid'],
      invalid_tags: ['opening_balance.as_of_date:invalid'],
    },
  },
  journal_entry: {
    source_id: {
      required: true,
      valid_tags: ['journal_entry.source_id:valid'],
      invalid_tags: ['journal_entry.source_id:invalid'],
    },
    entry_number: {
      required: true,
      valid_tags: ['journal_entry.entry_number:valid'],
      invalid_tags: ['journal_entry.entry_number:invalid'],
    },
    period_label: {
      required: true,
      valid_tags: ['journal_entry.period_label:valid'],
      invalid_tags: ['journal_entry.period_label:invalid'],
    },
    posting_date: {
      required: true,
      valid_tags: ['journal_entry.posting_date:valid'],
      invalid_tags: ['journal_entry.posting_date:invalid'],
    },
    currency_code: {
      required: true,
      valid_tags: ['journal_entry.currency_code:valid'],
      invalid_tags: ['journal_entry.currency_code:invalid'],
    },
    description: {
      required: true,
      valid_tags: ['journal_entry.description:valid'],
      invalid_tags: ['journal_entry.description:invalid'],
    },
    lines: {
      required: true,
      valid_tags: ['journal_entry.lines:valid'],
      invalid_tags: ['journal_entry.lines:invalid'],
    },
  },
  journal_line: {
    parent_source_id: {
      required: true,
      valid_tags: ['journal_line.parent_source_id:valid'],
      invalid_tags: ['journal_line.parent_source_id:invalid'],
    },
    code: {
      required: true,
      valid_tags: ['journal_line.code:valid'],
      invalid_tags: ['journal_line.code:invalid'],
    },
    debit_amount: {
      required: true,
      valid_tags: ['journal_line.debit_amount:valid'],
      invalid_tags: ['journal_line.debit_amount:invalid'],
    },
    credit_amount: {
      required: true,
      valid_tags: ['journal_line.credit_amount:valid'],
      invalid_tags: ['journal_line.credit_amount:invalid'],
    },
    mutual_exclusivity: {
      required: true,
      valid_tags: ['journal_line.mutual_exclusivity:valid'],
      invalid_tags: ['journal_line.mutual_exclusivity:invalid'],
    },
    line_narration: {
      required: false,
      valid_tags: ['journal_line.line_narration:valid'],
      invalid_tags: ['journal_line.line_narration:invalid'],
    },
    department_ref: {
      required: false,
      valid_tags: ['journal_line.department_ref:valid'],
      invalid_tags: ['journal_line.department_ref:invalid'],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Engine Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RawRow {
  readonly row_id: string;
  readonly record_type: RecordType;
  readonly case_tags: string;
  readonly source_id: string;
  readonly parent_source_id: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly currency_code: string;
  readonly parent_code: string;
  readonly description: string;
  readonly is_active: string;
  readonly is_posting_account: string;
  readonly balance_amount: string;
  readonly as_of_date: string;
  readonly entry_number: string;
  readonly period_label: string;
  readonly posting_date: string;
  readonly debit_amount: string;
  readonly credit_amount: string;
  readonly line_narration: string;
  readonly department_ref: string;
  readonly expect_outcome: string;
  readonly expect_reasons: string;
}

export type RowOutcome = 'accepted' | 'rejected' | 'review';

export interface RowEvaluation {
  readonly row_id: string;
  readonly record_type: RecordType;
  readonly outcome: RowOutcome;
  readonly reasons: readonly string[];
  readonly applied_rule_ids: readonly string[];
  readonly clean_data?: unknown;
}

export interface CleanAccount {
  readonly source_id: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency_code: AcceptedCurrency;
  readonly parent_code: string | null;
  readonly description: string | null;
  readonly is_active: boolean;
  readonly is_posting_account: boolean;
}

export interface CleanOpeningBalance {
  readonly source_id: string;
  readonly code: string;
  readonly currency_code: AcceptedCurrency;
  readonly balance_amount: string;
  readonly as_of_date: string;
  readonly description: string | null;
}

export interface CleanJournalLine {
  readonly row_id: string;
  readonly code: string;
  readonly debit_amount: string;
  readonly credit_amount: string;
  readonly line_narration: string | null;
  readonly department_ref: string | null;
}

export interface CleanJournalEntry {
  readonly source_id: string;
  readonly entry_number: string;
  readonly period_label: string;
  readonly posting_date: string;
  readonly currency_code: AcceptedCurrency;
  readonly description: string;
  readonly lines: readonly CleanJournalLine[];
}

export interface DerivedTrialBalanceRow {
  readonly account_code: string;
  readonly account_name: string;
  readonly account_type: AccountType;
  readonly currency_code: AcceptedCurrency;
  readonly opening_balance: string;
  readonly total_debit: string;
  readonly total_credit: string;
  readonly net_movement: string;
  readonly closing_balance: string;
}

export interface DerivedTrialBalance {
  readonly by_currency: Record<
    string,
    {
      readonly total_debit: string;
      readonly total_credit: string;
      readonly difference: string;
      readonly is_balanced: boolean;
      readonly rows: readonly DerivedTrialBalanceRow[];
    }
  >;
}

export interface FiscalCalendarResolver {
  isKnownPeriod(period: string): boolean;
  isPeriodLocked(period: string): boolean;
}

export interface DepartmentResolver {
  exists(departmentRef: string): boolean;
}

export interface EvaluationOptions {
  calendarResolver?: FiscalCalendarResolver;
  departmentResolver?: DepartmentResolver;
}

// Default standard fiscal calendar fixtures
export const DEFAULT_FISCAL_CALENDAR: FiscalCalendarResolver = {
  isKnownPeriod(period: string): boolean {
    return ['2026-04', '2026-05', '2026-06', '2026-01'].includes(period);
  },
  isPeriodLocked(period: string): boolean {
    // 2026-01 is a closed fiscal month per BR-ERP4-02
    return period === '2026-01';
  },
};

// Default standard department fixtures (ERP-5 cross-module references)
export const DEFAULT_DEPARTMENT_RESOLVER: DepartmentResolver = {
  exists(ref: string): boolean {
    return ['DEP-FIN', 'DEP-SALES', 'DEP-ENG'].includes(ref);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CSV Parser & Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let cell = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (insideQuotes) {
      if (ch === '"') {
        if (next === '"') {
          cell += '"';
          i++; // skip escaped quote
        } else {
          insideQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        insideQuotes = true;
      } else if (ch === ',') {
        current.push(cell);
        cell = '';
      } else if (ch === '\r') {
        // ignore CR
      } else if (ch === '\n') {
        current.push(cell);
        rows.push(current);
        current = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
  }

  if (cell.length > 0 || current.length > 0) {
    current.push(cell);
    rows.push(current);
  }

  return rows;
}

export function readRawRows(csvText: string): readonly RawRow[] {
  const table = parseCsv(csvText);
  if (table.length === 0) return [];

  const headers = table[0];
  if (
    !headers ||
    headers.length !== FIXTURE_COLUMNS.length ||
    headers.some((h, i) => h !== FIXTURE_COLUMNS[i])
  ) {
    throw new Error(
      `Fixture header mismatch. Expected: ${FIXTURE_COLUMNS.join(',')}\nActual: ${headers ? headers.join(',') : 'none'}`
    );
  }

  const rawRows: RawRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    if (!cells) continue;
    if (cells.length === 1 && (cells[0] ?? '').trim() === '') continue; // ignore blank lines
    if (cells.length !== FIXTURE_COLUMNS.length) {
      throw new Error(`Row ${i + 1} has ${cells.length} columns, expected ${FIXTURE_COLUMNS.length}`);
    }

    const rowObj: Record<string, string> = {};
    for (let j = 0; j < FIXTURE_COLUMNS.length; j++) {
      const col = FIXTURE_COLUMNS[j];
      if (col) {
        rowObj[col] = cells[j] ?? '';
      }
    }

    rawRows.push(Object.freeze(rowObj as unknown as RawRow));
  }

  return Object.freeze(rawRows);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

// Fixed-point decimal arithmetic in 10^-4 units (0.0001)
export function toTenThousandths(valStr: string): bigint {
  const cleaned = valStr.trim().replace(/,/g, '');
  if (!cleaned) return 0n;

  const isNeg = cleaned.startsWith('-');
  const unsigned = isNeg ? cleaned.slice(1) : cleaned;
  const parts = unsigned.split('.');
  const whole = parts[0] || '0';
  const frac = (parts[1] || '').padEnd(4, '0').slice(0, 4);

  const units = BigInt(whole) * 10000n + BigInt(frac);
  return isNeg ? -units : units;
}

export function formatTenThousandths(units: bigint): string {
  const isNeg = units < 0n;
  const absUnits = isNeg ? -units : units;
  const whole = absUnits / 10000n;
  const frac = (absUnits % 10000n).toString().padStart(4, '0');
  const str = `${whole}.${frac}`;
  return isNeg ? `-${str}` : str;
}

export function formatHundredths(units: bigint): string {
  // Round half-up to 2 decimal places
  const isNeg = units < 0n;
  const absUnits = isNeg ? -units : units;
  const hundredths = (absUnits + 50n) / 100n;
  const whole = hundredths / 100n;
  const frac = (hundredths % 100n).toString().padStart(2, '0');
  const str = `${whole}.${frac}`;
  return isNeg ? `-${str}` : str;
}

function isValidCalendarDate(yyyyMmDd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return false;
  const parts = yyyyMmDd.split('-').map((s) => parseInt(s, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;

  const isLeap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonth[m - 1];
  if (maxDay === undefined) return false;
  return d <= maxDay;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation Engine
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetResult {
  readonly rowResults: readonly RowEvaluation[];
  readonly cleanAccounts: readonly CleanAccount[];
  readonly cleanOpeningBalances: readonly CleanOpeningBalance[];
  readonly cleanJournalEntries: readonly CleanJournalEntry[];
  readonly trialBalance: DerivedTrialBalance;
  readonly normalizationsCount: Record<string, number>;
  readonly ruleHitsCount: Record<string, number>;
  readonly reasonCodeCount: Record<string, number>;
  readonly recordTypeCounts: Record<RecordType, { accepted: number; rejected: number; review: number }>;
}

export function evaluateDataset(
  rawRows: readonly RawRow[],
  options: EvaluationOptions = {}
): DatasetResult {
  const calendar = options.calendarResolver ?? DEFAULT_FISCAL_CALENDAR;
  const departments = options.departmentResolver ?? DEFAULT_DEPARTMENT_RESOLVER;

  const normalizationsCount: Record<string, number> = {};
  const ruleHitsCount: Record<string, number> = {};
  const reasonCodeCount: Record<string, number> = {};

  const incNorm = (ruleId: string) => {
    normalizationsCount[ruleId] = (normalizationsCount[ruleId] ?? 0) + 1;
  };
  const incRule = (ruleId: string) => {
    ruleHitsCount[ruleId] = (ruleHitsCount[ruleId] ?? 0) + 1;
  };
  const incReason = (code: string) => {
    reasonCodeCount[code] = (reasonCodeCount[code] ?? 0) + 1;
  };

  const recordTypeCounts: Record<RecordType, { accepted: number; rejected: number; review: number }> = {
    account: { accepted: 0, rejected: 0, review: 0 },
    opening_balance: { accepted: 0, rejected: 0, review: 0 },
    journal_entry: { accepted: 0, rejected: 0, review: 0 },
    journal_line: { accepted: 0, rejected: 0, review: 0 },
  };

  const results: RowEvaluation[] = [];

  // Group raw rows by record type
  const accountRows = rawRows.filter((r) => r.record_type === 'account');
  const opbRows = rawRows.filter((r) => r.record_type === 'opening_balance');
  const jeRows = rawRows.filter((r) => r.record_type === 'journal_entry');
  const jlRows = rawRows.filter((r) => r.record_type === 'journal_line');

  // ── PHASE 1: Chart of Accounts ──────────────────────────────────────────────
  const seenAccountCodes = new Set<string>();
  const cleanAccountMap = new Map<string, CleanAccount>(); // normalized code -> CleanAccount
  const rejectedAccountCodes = new Set<string>();
  const reviewAccountCodes = new Set<string>();

  for (const row of accountRows) {
    const reasons: string[] = [];
    const appliedRules: string[] = [];
    let isReview = false;

    // source_id
    const rawSourceId = row.source_id.trim();
    if (!rawSourceId) {
      reasons.push('SOURCE_ID_REQUIRED');
      appliedRules.push('ACC-005');
      incRule('ACC-005');
      incReason('SOURCE_ID_REQUIRED');
    }

    // code
    const rawCode = row.code;
    const trimmedCode = rawCode.trim();
    if (!trimmedCode) {
      reasons.push('ACCOUNT_CODE_REQUIRED');
      appliedRules.push('ACC-001');
      incRule('ACC-001');
      incReason('ACCOUNT_CODE_REQUIRED');
    } else {
      if (rawCode !== trimmedCode || rawCode !== rawCode.toUpperCase()) {
        appliedRules.push('ACC-010');
        incNorm('ACC-010');
      }
      if (!/^[A-Za-z0-9_-]+$/.test(trimmedCode)) {
        reasons.push('INVALID_ACCOUNT_CODE_FORMAT');
        appliedRules.push('ACC-020');
        incRule('ACC-020');
        incReason('INVALID_ACCOUNT_CODE_FORMAT');
      }
      if (trimmedCode.length > 32) {
        reasons.push('ACCOUNT_CODE_TOO_LONG');
        appliedRules.push('ACC-021');
        incRule('ACC-021');
        incReason('ACCOUNT_CODE_TOO_LONG');
      }
    }

    const normCode = trimmedCode.toUpperCase();

    // name
    const rawName = row.name;
    const trimmedName = rawName.trim();
    if (!trimmedName) {
      reasons.push('ACCOUNT_NAME_REQUIRED');
      appliedRules.push('ACC-002');
      incRule('ACC-002');
      incReason('ACCOUNT_NAME_REQUIRED');
    } else {
      const collapsedName = trimmedName.replace(/\s+/g, ' ');
      if (rawName !== collapsedName) {
        appliedRules.push('ACC-011');
        incNorm('ACC-011');
      }
      if (collapsedName.length > 255) {
        reasons.push('ACCOUNT_NAME_TOO_LONG');
        appliedRules.push('ACC-022');
        incRule('ACC-022');
        incReason('ACCOUNT_NAME_TOO_LONG');
      }
    }

    // type
    const rawType = row.type;
    const trimmedType = rawType.trim().toLowerCase();
    if (!trimmedType) {
      reasons.push('ACCOUNT_TYPE_REQUIRED');
      appliedRules.push('ACC-003');
      incRule('ACC-003');
      incReason('ACCOUNT_TYPE_REQUIRED');
    } else {
      if (rawType !== trimmedType) {
        appliedRules.push('ACC-012');
        incNorm('ACC-012');
      }
      if (!ACCOUNT_TYPES.includes(trimmedType as AccountType)) {
        reasons.push('INVALID_ACCOUNT_TYPE');
        appliedRules.push('ACC-030');
        incRule('ACC-030');
        incReason('INVALID_ACCOUNT_TYPE');
      }
    }

    // currency_code
    const rawCurr = row.currency_code;
    const trimmedCurr = rawCurr.trim().toUpperCase();
    if (!trimmedCurr) {
      reasons.push('CURRENCY_REQUIRED');
      appliedRules.push('ACC-004');
      incRule('ACC-004');
      incReason('CURRENCY_REQUIRED');
    } else {
      if (rawCurr !== trimmedCurr) {
        appliedRules.push('ACC-013');
        incNorm('ACC-013');
      }
      if (!ACCEPTED_CURRENCIES.includes(trimmedCurr as AcceptedCurrency)) {
        reasons.push('INVALID_CURRENCY');
        appliedRules.push('ACC-031');
        incRule('ACC-031');
        incReason('INVALID_CURRENCY');
      }
    }

    // parent_code
    const rawParent = row.parent_code;
    const trimmedParent = rawParent.trim().toUpperCase();
    if (rawParent && rawParent !== trimmedParent) {
      appliedRules.push('ACC-014');
      incNorm('ACC-014');
    }

    // description
    const rawDesc = row.description.trim();
    if (rawDesc.length > 2000) {
      reasons.push('DESCRIPTION_TOO_LONG');
      appliedRules.push('ACC-023');
      incRule('ACC-023');
      incReason('DESCRIPTION_TOO_LONG');
    }

    // booleans
    let isActive = true;
    if (row.is_active.trim()) {
      const v = row.is_active.trim().toLowerCase();
      if (['true', '1'].includes(v)) isActive = true;
      else if (['false', '0'].includes(v)) isActive = false;
      else {
        reasons.push('INVALID_BOOLEAN');
        appliedRules.push('ACC-032');
        incRule('ACC-032');
        incReason('INVALID_BOOLEAN');
      }
    }

    let isPostingAccount = true;
    if (row.is_posting_account.trim()) {
      const v = row.is_posting_account.trim().toLowerCase();
      if (['true', '1'].includes(v)) isPostingAccount = true;
      else if (['false', '0'].includes(v)) isPostingAccount = false;
      else {
        reasons.push('INVALID_BOOLEAN');
        appliedRules.push('ACC-033');
        incRule('ACC-033');
        incReason('INVALID_BOOLEAN');
      }
    }

    // Check duplicate code candidate ONLY if all validations passed
    if (reasons.length === 0 && normCode) {
      if (seenAccountCodes.has(normCode)) {
        isReview = true;
        reasons.push('DUPLICATE_ACCOUNT_CODE_REVIEW');
        appliedRules.push('ACC-050');
        incRule('ACC-050');
        incReason('DUPLICATE_ACCOUNT_CODE_REVIEW');
      } else {
        seenAccountCodes.add(normCode);
      }
    }

    // Hierarchy validation (parent resolution, cycles, currency)
    if (trimmedParent && !isReview && reasons.length === 0) {
      if (trimmedParent === normCode) {
        reasons.push('CYCLE_DETECTED');
        appliedRules.push('ACC-041');
        incRule('ACC-041');
        incReason('CYCLE_DETECTED');
      } else if (!cleanAccountMap.has(trimmedParent)) {
        reasons.push('PARENT_ACCOUNT_NOT_FOUND');
        appliedRules.push('ACC-040');
        incRule('ACC-040');
        incReason('PARENT_ACCOUNT_NOT_FOUND');
      } else {
        const parentAcc = cleanAccountMap.get(trimmedParent)!;
        if (parentAcc.currency_code !== trimmedCurr) {
          reasons.push('CURRENCY_MISMATCH');
          appliedRules.push('ACC-042');
          incRule('ACC-042');
          incReason('CURRENCY_MISMATCH');
        }
      }
    }

    let outcome: RowOutcome;
    let cleanAcc: CleanAccount | undefined;

    if (isReview) {
      outcome = 'review';
      recordTypeCounts.account.review++;
      reviewAccountCodes.add(normCode);
    } else if (reasons.length > 0) {
      outcome = 'rejected';
      recordTypeCounts.account.rejected++;
      rejectedAccountCodes.add(normCode);
    } else {
      outcome = 'accepted';
      recordTypeCounts.account.accepted++;
      cleanAcc = {
        source_id: rawSourceId,
        code: normCode,
        name: rawName.trim().replace(/\s+/g, ' '),
        type: trimmedType as AccountType,
        currency_code: trimmedCurr as AcceptedCurrency,
        parent_code: trimmedParent || null,
        description: rawDesc || null,
        is_active: isActive,
        is_posting_account: isPostingAccount,
      };
      cleanAccountMap.set(normCode, cleanAcc);
    }

    results.push({
      row_id: row.row_id,
      record_type: 'account',
      outcome,
      reasons: Object.freeze(reasons),
      applied_rule_ids: Object.freeze(appliedRules),
      clean_data: cleanAcc,
    });
  }

  // ── PHASE 2: Opening Balances ───────────────────────────────────────────────
  const seenOpbKeys = new Set<string>(); // "code:currency"
  const cleanOpeningBalances: CleanOpeningBalance[] = [];

  for (const row of opbRows) {
    const reasons: string[] = [];
    const appliedRules: string[] = [];
    let isReview = false;

    // source_id
    const rawSourceId = row.source_id.trim();
    if (!rawSourceId) {
      reasons.push('SOURCE_ID_REQUIRED');
      appliedRules.push('OPB-001');
      incRule('OPB-001');
      incReason('SOURCE_ID_REQUIRED');
    }

    // code
    const rawCode = row.code;
    const trimmedCode = rawCode.trim();
    if (!trimmedCode) {
      reasons.push('ACCOUNT_CODE_REQUIRED');
      appliedRules.push('OPB-002');
      incRule('OPB-002');
      incReason('ACCOUNT_CODE_REQUIRED');
    } else {
      if (rawCode !== trimmedCode || rawCode !== rawCode.toUpperCase()) {
        appliedRules.push('OPB-010');
        incNorm('OPB-010');
      }
    }
    const normCode = trimmedCode.toUpperCase();

    // currency_code
    const rawCurr = row.currency_code;
    const trimmedCurr = rawCurr.trim().toUpperCase();
    if (!trimmedCurr) {
      reasons.push('CURRENCY_REQUIRED');
      appliedRules.push('OPB-003');
      incRule('OPB-003');
      incReason('CURRENCY_REQUIRED');
    } else {
      if (rawCurr !== trimmedCurr) {
        appliedRules.push('OPB-011');
        incNorm('OPB-011');
      }
      if (!ACCEPTED_CURRENCIES.includes(trimmedCurr as AcceptedCurrency)) {
        reasons.push('INVALID_CURRENCY');
        appliedRules.push('OPB-027');
        incRule('OPB-027');
        incReason('INVALID_CURRENCY');
      }
    }

    // balance_amount
    const rawAmt = row.balance_amount;
    const trimmedAmt = rawAmt.trim().replace(/,/g, '');
    if (!rawAmt.trim()) {
      reasons.push('BALANCE_AMOUNT_REQUIRED');
      appliedRules.push('OPB-004');
      incRule('OPB-004');
      incReason('BALANCE_AMOUNT_REQUIRED');
    } else {
      if (rawAmt !== trimmedAmt) {
        appliedRules.push('OPB-012');
        incNorm('OPB-012');
      }
      if (!/^-?\d+(\.\d+)?$/.test(trimmedAmt)) {
        reasons.push('INVALID_BALANCE_AMOUNT');
        appliedRules.push('OPB-022');
        incRule('OPB-022');
        incReason('INVALID_BALANCE_AMOUNT');
      } else {
        const parts = trimmedAmt.replace('-', '').split('.');
        const intPart = parts[0] ?? '';
        if (intPart.length > MAX_INTEGER_DIGITS) {
          reasons.push('AMOUNT_OVERFLOW');
          appliedRules.push('OPB-024');
          incRule('OPB-024');
          incReason('AMOUNT_OVERFLOW');
        }
        if (parts[1] && parts[1].length > MAX_FRACTION_DIGITS) {
          reasons.push('EXCESS_DECIMAL_PLACES');
          appliedRules.push('OPB-023');
          incRule('OPB-023');
          incReason('EXCESS_DECIMAL_PLACES');
        }
      }
    }

    // as_of_date
    const rawDate = row.as_of_date.trim();
    if (!rawDate) {
      reasons.push('AS_OF_DATE_REQUIRED');
      appliedRules.push('OPB-005');
      incRule('OPB-005');
      incReason('AS_OF_DATE_REQUIRED');
    } else {
      let isoDate = rawDate;
      if (rawDate.includes('/')) {
        if (/^\d{4}\/\d{2}\/\d{2}$/.test(rawDate)) {
          isoDate = rawDate.replace(/\//g, '-');
          appliedRules.push('OPB-013');
          incNorm('OPB-013');
        } else {
          reasons.push('AMBIGUOUS_DATE_FORMAT');
          appliedRules.push('OPB-026');
          incRule('OPB-026');
          incReason('AMBIGUOUS_DATE_FORMAT');
        }
      }

      if (!reasons.includes('AMBIGUOUS_DATE_FORMAT') && !isValidCalendarDate(isoDate)) {
        reasons.push('INVALID_DATE');
        appliedRules.push('OPB-025');
        incRule('OPB-025');
        incReason('INVALID_DATE');
      }
    }

    // Account link & currency match
    if (normCode && !reasons.includes('ACCOUNT_CODE_REQUIRED')) {
      if (rejectedAccountCodes.has(normCode)) {
        reasons.push('ACCOUNT_NOT_FOUND');
        appliedRules.push('OPB-020');
        incRule('OPB-020');
        incReason('ACCOUNT_NOT_FOUND');
      } else if (!cleanAccountMap.has(normCode)) {
        reasons.push('ACCOUNT_NOT_FOUND');
        appliedRules.push('OPB-020');
        incRule('OPB-020');
        incReason('ACCOUNT_NOT_FOUND');
      } else {
        const acc = cleanAccountMap.get(normCode)!;
        if (trimmedCurr && acc.currency_code !== trimmedCurr) {
          reasons.push('CURRENCY_MISMATCH');
          appliedRules.push('OPB-021');
          incRule('OPB-021');
          incReason('CURRENCY_MISMATCH');
        }
      }
    }

    // Duplicate candidate key (account_code, currency_code)
    const opbKey = `${normCode}:${trimmedCurr}`;
    if (reasons.length === 0 && normCode && trimmedCurr) {
      if (seenOpbKeys.has(opbKey)) {
        isReview = true;
        reasons.push('DUPLICATE_OPENING_BALANCE_REVIEW');
        appliedRules.push('OPB-030');
        incRule('OPB-030');
        incReason('DUPLICATE_OPENING_BALANCE_REVIEW');
      } else {
        seenOpbKeys.add(opbKey);
      }
    }

    let outcome: RowOutcome;
    let cleanOpb: CleanOpeningBalance | undefined;

    if (isReview) {
      outcome = 'review';
      recordTypeCounts.opening_balance.review++;
    } else if (reasons.length > 0) {
      outcome = 'rejected';
      recordTypeCounts.opening_balance.rejected++;
    } else {
      outcome = 'accepted';
      recordTypeCounts.opening_balance.accepted++;
      const normAmt = formatTenThousandths(toTenThousandths(trimmedAmt));
      cleanOpb = {
        source_id: rawSourceId,
        code: normCode,
        currency_code: trimmedCurr as AcceptedCurrency,
        balance_amount: normAmt,
        as_of_date: row.as_of_date.trim().replace(/\//g, '-'),
        description: row.description.trim() || null,
      };
      cleanOpeningBalances.push(cleanOpb);
    }

    results.push({
      row_id: row.row_id,
      record_type: 'opening_balance',
      outcome,
      reasons: Object.freeze(reasons),
      applied_rule_ids: Object.freeze(appliedRules),
      clean_data: cleanOpb,
    });
  }

  // ── PHASE 3: Journal Entries & Lines ───────────────────────────────────────
  const seenEntryNumbers = new Set<string>();
  const jeRowMap = new Map<string, RawRow>(); // source_id -> RawRow
  for (const je of jeRows) {
    if (je.source_id.trim()) {
      jeRowMap.set(je.source_id.trim(), je);
    }
  }

  // Group child lines by parent_source_id (only if parent exists in jeRowMap)
  const linesByParent = new Map<string, RawRow[]>();
  for (const jl of jlRows) {
    const parentId = jl.parent_source_id.trim();
    if (parentId && jeRowMap.has(parentId)) {
      if (!linesByParent.has(parentId)) {
        linesByParent.set(parentId, []);
      }
      linesByParent.get(parentId)!.push(jl);
    }
  }

  const cleanJournalEntries: CleanJournalEntry[] = [];

  for (const row of jeRows) {
    const reasons: string[] = [];
    const appliedRules: string[] = [];
    let isReview = false;

    // source_id
    const rawSourceId = row.source_id.trim();
    if (!rawSourceId) {
      reasons.push('SOURCE_ID_REQUIRED');
      appliedRules.push('JRN-001');
      incRule('JRN-001');
      incReason('SOURCE_ID_REQUIRED');
    }

    // entry_number
    const rawEntryNum = row.entry_number;
    const trimmedEntryNum = rawEntryNum.trim();
    if (!trimmedEntryNum) {
      reasons.push('ENTRY_NUMBER_REQUIRED');
      appliedRules.push('JRN-002');
      incRule('JRN-002');
      incReason('ENTRY_NUMBER_REQUIRED');
    } else {
      if (rawEntryNum !== trimmedEntryNum || rawEntryNum !== rawEntryNum.toUpperCase()) {
        appliedRules.push('JRN-010');
        incNorm('JRN-010');
      }
      if (trimmedEntryNum.length > 64) {
        reasons.push('ENTRY_NUMBER_TOO_LONG');
        appliedRules.push('JRN-020');
        incRule('JRN-020');
        incReason('ENTRY_NUMBER_TOO_LONG');
      }
    }
    const normEntryNum = trimmedEntryNum.toUpperCase();

    // duplicate entry number candidate key
    if (reasons.length === 0 && normEntryNum) {
      if (seenEntryNumbers.has(normEntryNum)) {
        isReview = true;
        reasons.push('DUPLICATE_ENTRY_NUMBER_REVIEW');
        appliedRules.push('JRN-030');
        incRule('JRN-030');
        incReason('DUPLICATE_ENTRY_NUMBER_REVIEW');
      } else {
        seenEntryNumbers.add(normEntryNum);
      }
    }

    // period_label
    const rawPeriod = row.period_label;
    const trimmedPeriod = rawPeriod.trim();
    if (!trimmedPeriod) {
      reasons.push('PERIOD_LABEL_REQUIRED');
      appliedRules.push('JRN-003');
      incRule('JRN-003');
      incReason('PERIOD_LABEL_REQUIRED');
    } else {
      if (rawPeriod !== trimmedPeriod) {
        appliedRules.push('JRN-011');
        incNorm('JRN-011');
      }
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmedPeriod)) {
        reasons.push('INVALID_PERIOD_FORMAT');
        appliedRules.push('JRN-021');
        incRule('JRN-021');
        incReason('INVALID_PERIOD_FORMAT');
      } else if (!calendar.isKnownPeriod(trimmedPeriod)) {
        reasons.push('PERIOD_NOT_FOUND');
        appliedRules.push('JRN-022');
        incRule('JRN-022');
        incReason('PERIOD_NOT_FOUND');
      } else if (calendar.isPeriodLocked(trimmedPeriod)) {
        reasons.push('PERIOD_LOCKED');
        appliedRules.push('JRN-023');
        incRule('JRN-023');
        incReason('PERIOD_LOCKED');
      }
    }

    // posting_date
    const rawDate = row.posting_date.trim();
    if (!rawDate) {
      reasons.push('POSTING_DATE_REQUIRED');
      appliedRules.push('JRN-004');
      incRule('JRN-004');
      incReason('POSTING_DATE_REQUIRED');
    } else {
      let isoDate = rawDate;
      if (rawDate.includes('/')) {
        isoDate = rawDate.replace(/\//g, '-');
        appliedRules.push('JRN-012');
        incNorm('JRN-012');
      }
      if (!isValidCalendarDate(isoDate)) {
        reasons.push('INVALID_POSTING_DATE');
        appliedRules.push('JRN-024');
        incRule('JRN-024');
        incReason('INVALID_POSTING_DATE');
      }
    }

    // currency_code
    const rawCurr = row.currency_code;
    const trimmedCurr = rawCurr.trim().toUpperCase();
    if (!trimmedCurr) {
      reasons.push('CURRENCY_REQUIRED');
      appliedRules.push('JRN-005');
      incRule('JRN-005');
      incReason('CURRENCY_REQUIRED');
    } else {
      if (rawCurr !== trimmedCurr) {
        appliedRules.push('JRN-013');
        incNorm('JRN-013');
      }
      if (!ACCEPTED_CURRENCIES.includes(trimmedCurr as AcceptedCurrency)) {
        reasons.push('INVALID_CURRENCY');
        appliedRules.push('JRN-025');
        incRule('JRN-025');
        incReason('INVALID_CURRENCY');
      }
    }

    // description
    const rawDesc = row.description;
    const trimmedDesc = rawDesc.trim();
    if (!trimmedDesc) {
      reasons.push('DESCRIPTION_REQUIRED');
      appliedRules.push('JRN-006');
      incRule('JRN-006');
      incReason('DESCRIPTION_REQUIRED');
    } else {
      const collapsedDesc = trimmedDesc.replace(/\s+/g, ' ');
      if (rawDesc !== collapsedDesc) {
        appliedRules.push('JRN-014');
        incNorm('JRN-014');
      }
    }

    // Evaluate child lines
    const childLines = linesByParent.get(rawSourceId) ?? [];
    if (childLines.length === 0) {
      reasons.push('NO_LINES');
      appliedRules.push('JRN-040');
      incRule('JRN-040');
      incReason('NO_LINES');
    } else if (childLines.length < 2) {
      reasons.push('MINIMUM_LINES_REQUIRED');
      appliedRules.push('JRN-041');
      incRule('JRN-041');
      incReason('MINIMUM_LINES_REQUIRED');
    }

    let hasLineFailure = false;
    let totalDebitUnits = 0n;
    let totalCreditUnits = 0n;
    const cleanLines: CleanJournalLine[] = [];

    // Pre-evaluate lines for this parent
    const lineEvaluations: RowEvaluation[] = [];

    for (const lineRow of childLines) {
      const lineReasons: string[] = [];
      const lineRules: string[] = [];

      // Account ref
      const rawLineCode = lineRow.code;
      const trimmedLineCode = rawLineCode.trim();
      if (!trimmedLineCode) {
        lineReasons.push('ACCOUNT_CODE_REQUIRED');
        lineRules.push('JRL-003');
        incRule('JRL-003');
        incReason('ACCOUNT_CODE_REQUIRED');
      } else {
        if (rawLineCode !== trimmedLineCode || rawLineCode !== rawLineCode.toUpperCase()) {
          lineRules.push('JRL-010');
          incNorm('JRL-010');
        }
      }
      const normLineCode = trimmedLineCode.toUpperCase();

      if (normLineCode && !lineReasons.includes('ACCOUNT_CODE_REQUIRED')) {
        if (!cleanAccountMap.has(normLineCode)) {
          lineReasons.push('ACCOUNT_NOT_FOUND');
          lineRules.push('JRL-004');
          incRule('JRL-004');
          incReason('ACCOUNT_NOT_FOUND');
        } else {
          const acc = cleanAccountMap.get(normLineCode)!;
          if (!acc.is_active) {
            lineReasons.push('ACCOUNT_INACTIVE');
            lineRules.push('JRL-005');
            incRule('JRL-005');
            incReason('ACCOUNT_INACTIVE');
          }
          if (!acc.is_posting_account) {
            lineReasons.push('CANNOT_POST_TO_HEADER_ACCOUNT');
            lineRules.push('JRL-006');
            incRule('JRL-006');
            incReason('CANNOT_POST_TO_HEADER_ACCOUNT');
          }
        }
      }

      // Amounts
      const rawDebit = lineRow.debit_amount;
      const trimmedDebit = rawDebit.trim().replace(/,/g, '');
      if (rawDebit && rawDebit !== trimmedDebit) {
        lineRules.push('JRL-011');
        incNorm('JRL-011');
      }

      const rawCredit = lineRow.credit_amount;
      const trimmedCredit = rawCredit.trim().replace(/,/g, '');
      if (rawCredit && rawCredit !== trimmedCredit) {
        lineRules.push('JRL-012');
        incNorm('JRL-012');
      }

      const dUnits = toTenThousandths(trimmedDebit || '0.00');
      const cUnits = toTenThousandths(trimmedCredit || '0.00');

      if (dUnits < 0n) {
        lineReasons.push('NEGATIVE_AMOUNT');
        lineRules.push('JRL-020');
        incRule('JRL-020');
        incReason('NEGATIVE_AMOUNT');
      }
      if (cUnits < 0n) {
        lineReasons.push('NEGATIVE_AMOUNT');
        lineRules.push('JRL-021');
        incRule('JRL-021');
        incReason('NEGATIVE_AMOUNT');
      }

      // Overflow / Excess decimals check
      if (trimmedDebit) {
        const parts = trimmedDebit.replace('-', '').split('.');
        const intPart = parts[0] ?? '';
        if (intPart.length > MAX_INTEGER_DIGITS) {
          lineReasons.push('AMOUNT_OVERFLOW');
          lineRules.push('JRL-025');
          incRule('JRL-025');
          incReason('AMOUNT_OVERFLOW');
        }
        if (parts[1] && parts[1].length > MAX_FRACTION_DIGITS) {
          lineReasons.push('EXCESS_DECIMAL_PLACES');
          lineRules.push('JRL-024');
          incRule('JRL-024');
          incReason('EXCESS_DECIMAL_PLACES');
        }
      }
      if (trimmedCredit) {
        const parts = trimmedCredit.replace('-', '').split('.');
        const intPart = parts[0] ?? '';
        if (intPart.length > MAX_INTEGER_DIGITS) {
          lineReasons.push('AMOUNT_OVERFLOW');
          lineRules.push('JRL-025');
          incRule('JRL-025');
          incReason('AMOUNT_OVERFLOW');
        }
        if (parts[1] && parts[1].length > MAX_FRACTION_DIGITS) {
          lineReasons.push('EXCESS_DECIMAL_PLACES');
          lineRules.push('JRL-024');
          incRule('JRL-024');
          incReason('EXCESS_DECIMAL_PLACES');
        }
      }

      // Mutual exclusivity
      if (dUnits > 0n && cUnits > 0n) {
        lineReasons.push('LINE_DEBIT_AND_CREDIT');
        lineRules.push('JRL-022');
        incRule('JRL-022');
        incReason('LINE_DEBIT_AND_CREDIT');
      } else if (dUnits === 0n && cUnits === 0n) {
        lineReasons.push('LINE_ZERO_AMOUNTS');
        lineRules.push('JRL-023');
        incRule('JRL-023');
        incReason('LINE_ZERO_AMOUNTS');
      }

      // Narration length
      const rawNarration = lineRow.line_narration.trim();
      if (rawNarration.length > 255) {
        lineReasons.push('LINE_NARRATION_TOO_LONG');
        lineRules.push('JRL-026');
        incRule('JRL-026');
        incReason('LINE_NARRATION_TOO_LONG');
      } else if (lineRow.line_narration && lineRow.line_narration !== rawNarration) {
        lineRules.push('JRL-013');
        incNorm('JRL-013');
      }

      // Department reference
      const rawDep = lineRow.department_ref.trim().toUpperCase();
      if (lineRow.department_ref && lineRow.department_ref !== rawDep) {
        lineRules.push('JRL-014');
        incNorm('JRL-014');
      }
      if (rawDep && !departments.exists(rawDep)) {
        lineReasons.push('DEPARTMENT_NOT_FOUND');
        lineRules.push('JRL-027');
        incRule('JRL-027');
        incReason('DEPARTMENT_NOT_FOUND');
      }

      if (lineReasons.length > 0) {
        hasLineFailure = true;
      } else {
        totalDebitUnits += dUnits;
        totalCreditUnits += cUnits;
      }

      lineEvaluations.push({
        row_id: lineRow.row_id,
        record_type: 'journal_line',
        outcome: 'accepted', // adjusted below
        reasons: lineReasons,
        applied_rule_ids: lineRules,
      });
    }

    if (hasLineFailure) {
      reasons.push('LINE_REJECTED');
      appliedRules.push('JRN-043');
      incRule('JRN-043');
      incReason('LINE_REJECTED');
    } else if (childLines.length >= 2) {
      // Check balancing invariant (BR-ERP4-01)
      if (totalDebitUnits !== totalCreditUnits) {
        reasons.push('UNBALANCED_JOURNAL_ENTRY');
        appliedRules.push('JRN-042');
        incRule('JRN-042');
        incReason('UNBALANCED_JOURNAL_ENTRY');
      }
    }

    let entryOutcome: RowOutcome;
    let cleanEntry: CleanJournalEntry | undefined;

    if (isReview) {
      entryOutcome = 'review';
      recordTypeCounts.journal_entry.review++;
    } else if (reasons.length > 0) {
      entryOutcome = 'rejected';
      recordTypeCounts.journal_entry.rejected++;
    } else {
      entryOutcome = 'accepted';
      recordTypeCounts.journal_entry.accepted++;
    }

    // Now finalize child line evaluations
    for (let idx = 0; idx < childLines.length; idx++) {
      const lineRow = childLines[idx];
      const lineEval = lineEvaluations[idx];
      if (!lineRow || !lineEval) continue;
      let lineOutcome: RowOutcome = 'accepted';
      const finalReasons = [...lineEval.reasons];
      const finalRules = [...lineEval.applied_rule_ids];

      if (entryOutcome === 'review') {
        lineOutcome = 'review';
        recordTypeCounts.journal_line.review++;
        finalReasons.push('PARENT_ENTRY_IN_REVIEW');
        finalRules.push('JRL-030');
        incRule('JRL-030');
        incReason('PARENT_ENTRY_IN_REVIEW');
      } else if (entryOutcome === 'rejected') {
        lineOutcome = 'rejected';
        recordTypeCounts.journal_line.rejected++;
        if (finalReasons.length === 0) {
          finalReasons.push('PARENT_ENTRY_REJECTED');
          finalRules.push('JRL-031');
          incRule('JRL-031');
          incReason('PARENT_ENTRY_REJECTED');
        }
      } else {
        lineOutcome = 'accepted';
        recordTypeCounts.journal_line.accepted++;
        cleanLines.push({
          row_id: lineRow.row_id,
          code: lineRow.code.trim().toUpperCase(),
          debit_amount: formatTenThousandths(toTenThousandths(lineRow.debit_amount)),
          credit_amount: formatTenThousandths(toTenThousandths(lineRow.credit_amount)),
          line_narration: lineRow.line_narration.trim() || null,
          department_ref: lineRow.department_ref.trim().toUpperCase() || null,
        });
      }

      results.push({
        row_id: lineRow.row_id,
        record_type: 'journal_line',
        outcome: lineOutcome,
        reasons: Object.freeze(finalReasons),
        applied_rule_ids: Object.freeze(finalRules),
      });
    }

    if (entryOutcome === 'accepted') {
      cleanEntry = {
        source_id: rawSourceId,
        entry_number: normEntryNum,
        period_label: trimmedPeriod,
        posting_date: row.posting_date.trim().replace(/\//g, '-'),
        currency_code: trimmedCurr as AcceptedCurrency,
        description: row.description.trim().replace(/\s+/g, ' '),
        lines: cleanLines,
      };
      cleanJournalEntries.push(cleanEntry);
    }

    results.push({
      row_id: row.row_id,
      record_type: 'journal_entry',
      outcome: entryOutcome,
      reasons: Object.freeze(reasons),
      applied_rule_ids: Object.freeze(appliedRules),
      clean_data: cleanEntry,
    });
  }

  // ── PHASE 4: Orphan Journal Lines ──────────────────────────────────────────
  for (const orphanLine of jlRows) {
    const parentId = orphanLine.parent_source_id.trim();
    if (!parentId) {
      results.push({
        row_id: orphanLine.row_id,
        record_type: 'journal_line',
        outcome: 'rejected',
        reasons: Object.freeze(['PARENT_SOURCE_ID_REQUIRED']),
        applied_rule_ids: Object.freeze(['JRL-001']),
      });
      recordTypeCounts.journal_line.rejected++;
      incRule('JRL-001');
      incReason('PARENT_SOURCE_ID_REQUIRED');
    } else if (!jeRowMap.has(parentId)) {
      results.push({
        row_id: orphanLine.row_id,
        record_type: 'journal_line',
        outcome: 'rejected',
        reasons: Object.freeze(['ORPHAN_LINE']),
        applied_rule_ids: Object.freeze(['JRL-002']),
      });
      recordTypeCounts.journal_line.rejected++;
      incRule('JRL-002');
      incReason('ORPHAN_LINE');
    }
  }

  // Sort results back into exact input row order
  const rowOrderMap = new Map<string, number>();
  rawRows.forEach((r, idx) => rowOrderMap.set(r.row_id, idx));
  results.sort((a, b) => (rowOrderMap.get(a.row_id) ?? 0) - (rowOrderMap.get(b.row_id) ?? 0));

  // ── PHASE 5: Compute Trial Balance from Accepted Records ─────────────────────
  const trialBalance = computeTrialBalance(cleanJournalEntries, cleanOpeningBalances, cleanAccountMap);

  return {
    rowResults: Object.freeze(results),
    cleanAccounts: Object.freeze(Array.from(cleanAccountMap.values())),
    cleanOpeningBalances: Object.freeze(cleanOpeningBalances),
    cleanJournalEntries: Object.freeze(cleanJournalEntries),
    trialBalance,
    normalizationsCount,
    ruleHitsCount,
    reasonCodeCount,
    recordTypeCounts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived Trial Balance Calculation
// ─────────────────────────────────────────────────────────────────────────────

export function computeTrialBalance(
  cleanEntries: readonly CleanJournalEntry[],
  cleanBalances: readonly CleanOpeningBalance[],
  accountMap: Map<string, CleanAccount>
): DerivedTrialBalance {
  // Group by currency
  const currencies = new Set<string>();
  cleanEntries.forEach((e) => currencies.add(e.currency_code));
  cleanBalances.forEach((b) => currencies.add(b.currency_code));

  const by_currency: Record<
    string,
    {
      total_debit: string;
      total_credit: string;
      difference: string;
      is_balanced: boolean;
      rows: DerivedTrialBalanceRow[];
    }
  > = {};

  for (const curr of Array.from(currencies).sort()) {
    const accTotals = new Map<
      string,
      { opening: bigint; debit: bigint; credit: bigint }
    >();

    // Opening balances
    for (const b of cleanBalances) {
      if (b.currency_code === curr) {
        if (!accTotals.has(b.code)) {
          accTotals.set(b.code, { opening: 0n, debit: 0n, credit: 0n });
        }
        const cur = accTotals.get(b.code)!;
        cur.opening += toTenThousandths(b.balance_amount);
      }
    }

    // Journal movements
    for (const e of cleanEntries) {
      if (e.currency_code === curr) {
        for (const l of e.lines) {
          if (!accTotals.has(l.code)) {
            accTotals.set(l.code, { opening: 0n, debit: 0n, credit: 0n });
          }
          const cur = accTotals.get(l.code)!;
          cur.debit += toTenThousandths(l.debit_amount);
          cur.credit += toTenThousandths(l.credit_amount);
        }
      }
    }

    let currencyTotalDebitUnits = 0n;
    let currencyTotalCreditUnits = 0n;
    const rows: DerivedTrialBalanceRow[] = [];

    const sortedAccountCodes = Array.from(accTotals.keys()).sort();
    for (const code of sortedAccountCodes) {
      const data = accTotals.get(code)!;
      const acc = accountMap.get(code);
      const accName = acc ? acc.name : code;
      const accType = acc ? acc.type : 'asset';

      currencyTotalDebitUnits += data.debit;
      currencyTotalCreditUnits += data.credit;

      const netMovementUnits = data.debit - data.credit;
      const closingUnits = data.opening + netMovementUnits;

      rows.push({
        account_code: code,
        account_name: accName,
        account_type: accType,
        currency_code: curr as AcceptedCurrency,
        opening_balance: formatHundredths(data.opening),
        total_debit: formatHundredths(data.debit),
        total_credit: formatHundredths(data.credit),
        net_movement: formatHundredths(netMovementUnits),
        closing_balance: formatHundredths(closingUnits),
      });
    }

    const diffUnits = currencyTotalDebitUnits - currencyTotalCreditUnits;
    const isBalanced = diffUnits === 0n;

    by_currency[curr] = {
      total_debit: formatHundredths(currencyTotalDebitUnits),
      total_credit: formatHundredths(currencyTotalCreditUnits),
      difference: formatHundredths(diffUnits),
      is_balanced: isBalanced,
      rows,
    };
  }

  return { by_currency };
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Report Builder & Deterministic Serialization
// ─────────────────────────────────────────────────────────────────────────────

export interface ProfileReport {
  rules_version: string;
  fixture: {
    file: string;
    schema_version: number;
    sha256: string;
    row_count: number;
    by_record_type: Record<RecordType, number>;
  };
  by_record_type: Record<RecordType, { accepted: number; rejected: number; review: number }>;
  by_rule_id: Record<string, number>;
  by_reason_code: Record<string, number>;
  normalizations: Record<string, number>;
  trial_balance_summary: Record<
    string,
    {
      total_debit: string;
      total_credit: string;
      difference: string;
      is_balanced: boolean;
      account_count: number;
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
    account: 0,
    opening_balance: 0,
    journal_entry: 0,
    journal_line: 0,
  };
  for (const r of rawRows) {
    fixtureByRecordType[r.record_type]++;
  }

  const rowMap: Record<string, { outcome: RowOutcome; reasons: readonly string[] }> = {};
  for (const r of result.rowResults) {
    rowMap[r.row_id] = {
      outcome: r.outcome,
      reasons: r.reasons,
    };
  }

  const tbSummary: Record<
    string,
    {
      total_debit: string;
      total_credit: string;
      difference: string;
      is_balanced: boolean;
      account_count: number;
    }
  > = {};

  for (const [curr, data] of Object.entries(result.trialBalance.by_currency)) {
    tbSummary[curr] = {
      total_debit: data.total_debit,
      total_credit: data.total_credit,
      difference: data.difference,
      is_balanced: data.is_balanced,
      account_count: data.rows.length,
    };
  }

  return {
    rules_version: RULES_VERSION,
    fixture: {
      file: FIXTURE_PATH,
      schema_version: FIXTURE_SCHEMA_VERSION,
      sha256: sha256Hex(rawCsvText),
      row_count: fixtureRowCount,
      by_record_type: fixtureByRecordType,
    },
    by_record_type: result.recordTypeCounts,
    by_rule_id: result.ruleHitsCount,
    by_reason_code: result.reasonCodeCount,
    normalizations: result.normalizationsCount,
    trial_balance_summary: tbSummary,
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
