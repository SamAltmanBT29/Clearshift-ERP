/**
 * ERP-4 Finance & Accounting — Rejection Review Context (KIT-16 / ERP4-23 / #179)
 *
 * Configures module context for the shared Migration Kit rejection review and
 * export screens.
 *
 * Guarantees:
 * - Module-specific identifier columns (Account Code, Account Name, Entry Number, Source ID, Currency) alongside standard error codes (AC1).
 * - Human-readable reason text explaining validation or constraint failures (AC2).
 * - Automatic masking/exclusion of sensitive financial, bank, or employee fields (AC3).
 * - Formula-safe CSV export downloads filtered rejected rows with correct headers (AC4).
 *
 * @module erp4/kit/rejection-context
 */

import type {
  ModuleRejectionContext,
  FailureExplanation,
  RejectedRow,
} from '@cs/kit';

/**
 * Standardized failure explanations for ERP-4 domain errors.
 */
export const erp4FailureExplanations: Readonly<Record<string, FailureExplanation>> = {
  DUPLICATE_ACCOUNT_CODE: {
    code: 'DUPLICATE_ACCOUNT_CODE',
    title: 'Duplicate General Ledger Account Code',
    explanation:
      'Account code is already registered after lowercase alphanumeric normalization (BR-ERP4-01). Account codes must be globally unique within the chart of accounts.',
    docReference: 'BR-ERP4-01',
    resolution: 'Verify existing chart of accounts catalog or re-map source account code.',
  },
  JOURNAL_UNBALANCED: {
    code: 'JOURNAL_UNBALANCED',
    title: 'Double-Entry Journal Imbalance',
    explanation:
      'Total debits must equal total credits at currency precision for every posted journal entry (BR-ERP4-01). Asymmetrical journal lines are rejected.',
    docReference: 'BR-ERP4-01',
    resolution: 'Reconcile debit and credit lines so sum(debit) == sum(credit) at 4-decimal precision.',
  },
  PERIOD_LOCKED: {
    code: 'PERIOD_LOCKED',
    title: 'Locked Accounting Period Posting Blocked',
    explanation:
      'Accounting period is locked against further postings (BR-ERP4-02). Mutations to locked periods are strictly rejected to preserve ledger auditability.',
    docReference: 'BR-ERP4-02',
    resolution: 'Post to an open accounting period or request financial controller authorization to reopen.',
  },
  PERIOD_CLOSED: {
    code: 'PERIOD_CLOSED',
    title: 'Closed Accounting Period Posting Blocked',
    explanation:
      'Accounting period has been closed for fiscal cutover (BR-ERP4-02). Journal posting rejected.',
    docReference: 'BR-ERP4-02',
    resolution: 'Target an active, open accounting period.',
  },
  INVALID_ACCOUNT_TYPE: {
    code: 'INVALID_ACCOUNT_TYPE',
    title: 'Invalid Account Classification Type',
    explanation:
      'Account type must match the approved V1 allowlist: asset, liability, income, expense (ACC-003). Legacy classifications must be mapped.',
    docReference: 'ACC-003',
    resolution: 'Map legacy account types to canonical values in the value translation table.',
  },
  INVALID_CURRENCY: {
    code: 'INVALID_CURRENCY',
    title: 'Invalid ISO 4217 Currency Code',
    explanation:
      'Currency must match an approved 3-letter ISO 4217 uppercase code (INR, USD, EUR) (ACC-004).',
    docReference: 'ACC-004',
    resolution: 'Standardize currency column to uppercase ISO 4217 format.',
  },
  NEGATIVE_AMOUNT: {
    code: 'NEGATIVE_AMOUNT',
    title: 'Negative Amount Not Permitted',
    explanation:
      'Debit and credit line amounts must be strictly non-negative decimals >= 0.0000 (BR-ERP4-01 / JRL-011). Double-entry uses separate debit/credit fields rather than signed amounts.',
    docReference: 'BR-ERP4-01',
    resolution: 'Represent credits and debits in their dedicated unsigned columns.',
  },
  UNRESOLVED_ACCOUNT_REFERENCE: {
    code: 'UNRESOLVED_ACCOUNT_REFERENCE',
    title: 'Unresolved General Ledger Account Reference',
    explanation:
      'Journal line references an account code or UUID that does not exist in erp4_accounts (BR-ERP4-01). Chart of Accounts must be loaded prior to journal transactions.',
    docReference: 'BR-ERP4-01',
    resolution: 'Import or register Chart of Accounts master records before importing journal entries.',
  },
  MISSING_REQUIRED_FIELD: {
    code: 'MISSING_REQUIRED_FIELD',
    title: 'Missing Mandatory Domain Attribute',
    explanation:
      'A mandatory attribute (code, name, type, currency for accounts; entry_number, period_id, posting_date, lines for journal entries) is missing or blank (RL-REQ-01).',
    docReference: 'RL-REQ-01',
    resolution: 'Populate all mandatory target columns in source data prior to ingestion.',
  },
  BANK_DETAILS_EXPOSED: {
    code: 'BANK_DETAILS_EXPOSED',
    title: 'Sensitive Bank Details Exposure Violation',
    explanation:
      'Raw bank account numbers and payment details must be masked server-side in compliance with privacy guidelines (PCI/GDPR). Unmasked bank details are rejected.',
    docReference: 'PCI-DSS',
    resolution: 'Mask bank account details or omit sensitive columns from import files.',
  },
  SOURCE_VALUE_MUTATED: {
    code: 'SOURCE_VALUE_MUTATED',
    title: 'Source Provenance Mutation Detected',
    explanation:
      'Raw source provenance identifiers must be preserved without destructive mutation (KIT-08).',
    docReference: 'KIT-08',
    resolution: 'Retain original source_system and source_id untouched.',
  },
};

/**
 * Common sensitive fields across finance entities that must be masked.
 */
export const ERP4_SENSITIVE_FIELDS: readonly string[] = [
  'bank_account',
  'bankAccount',
  'bank_account_number',
  'bankAccountNumber',
  'bank_masked',
  'routing_number',
  'routingNumber',
  'iban',
  'swift',
  'bic',
  'ssn',
  'social_security_number',
  'tax_id',
  'taxId',
  'salary',
  'compensation',
  'creditCard',
  'credit_card_number',
  'cvv',
  'pan',
  'pin',
  'password',
];

/**
 * ERP-4 Chart of Accounts Module Rejection Context configuration.
 */
export const erp4AccountsRejectionContext: ModuleRejectionContext = {
  moduleId: 'erp4',
  moduleName: 'ERP-4 Finance and Accounting',
  entity: 'accounts',

  identifierColumns: [
    {
      field: 'code',
      label: 'Account Code',
      isIdentifier: true,
      format: (val) => (val !== undefined && val !== null ? String(val).toUpperCase().trim() : '—'),
    },
    {
      field: 'name',
      label: 'Account Name',
      isIdentifier: true,
    },
    {
      field: 'source_id',
      label: 'Source ID',
      isIdentifier: true,
    },
    {
      field: 'currency_code',
      label: 'Currency',
    },
  ],

  additionalColumns: [
    {
      field: 'type',
      label: 'Classification',
    },
    {
      field: 'parent_id',
      label: 'Parent Account ID',
    },
    {
      field: 'description',
      label: 'Description',
    },
  ],

  sensitiveFields: ERP4_SENSITIVE_FIELDS,

  failureExplanations: erp4FailureExplanations,

  contextualLinks: [
    {
      label: 'Search Accounts',
      getUrl: (row: RejectedRow) => {
        const code = row.rawData['code'];
        return `/erp4/accounts?search=${encodeURIComponent(typeof code === 'string' ? code : '')}`;
      },
    },
    {
      label: 'Data Dictionary',
      getUrl: () => 'docs/data-dictionaries/erp-4.md',
      openInNewTab: true,
    },
  ],
};

/**
 * ERP-4 Journal Entries Module Rejection Context configuration.
 */
export const erp4JournalEntriesRejectionContext: ModuleRejectionContext = {
  moduleId: 'erp4',
  moduleName: 'ERP-4 Finance and Accounting',
  entity: 'journal_entries',

  identifierColumns: [
    {
      field: 'entry_number',
      label: 'Entry Number',
      isIdentifier: true,
      format: (val) => (val !== undefined && val !== null ? String(val).toUpperCase().trim() : '—'),
    },
    {
      field: 'period_id',
      label: 'Period ID',
      isIdentifier: true,
    },
    {
      field: 'source_id',
      label: 'Source ID',
      isIdentifier: true,
    },
    {
      field: 'currency_code',
      label: 'Currency',
    },
  ],

  additionalColumns: [
    {
      field: 'posting_date',
      label: 'Posting Date',
    },
    {
      field: 'description',
      label: 'Description',
    },
  ],

  sensitiveFields: ERP4_SENSITIVE_FIELDS,

  failureExplanations: erp4FailureExplanations,

  contextualLinks: [
    {
      label: 'Search Journal Entries',
      getUrl: (row: RejectedRow) => {
        const entryNum = row.rawData['entry_number'];
        return `/erp4/journal-entries?search=${encodeURIComponent(typeof entryNum === 'string' ? entryNum : '')}`;
      },
    },
    {
      label: 'Data Dictionary',
      getUrl: () => 'docs/data-dictionaries/erp-4.md',
      openInNewTab: true,
    },
  ],
};
