/**
 * ERP-4 Finance & Accounting — Kit Metadata Verification Tests (ERP4-22 / #178)
 *
 * Verifies:
 * - Module registers target schema metadata for Chart of Accounts, Opening Balances, Journal Entries, and Journal Lines.
 * - Entities declare correct field types, required constraints, and enum allowlists.
 * - Value translation dictionaries for account types, currencies, and period statuses conform to V1 rules.
 */

import { describe, it, expect } from 'vitest';
import {
  erp4WebKitMetadata,
  erp4TargetEntities,
  erp4AccountsTargetFields,
  erp4OpeningBalancesTargetFields,
  erp4JournalEntriesTargetFields,
  erp4JournalLinesTargetFields,
  ACCOUNT_TYPE_TRANSLATION_MAP,
  CURRENCY_CODE_TRANSLATION_MAP,
  PERIOD_STATUS_TRANSLATION_MAP,
  ERP4_DEFAULT_MAPPING_TEMPLATES,
  ERP4_CANONICAL_MAPPING_TEMPLATE,
} from '../src/kit-metadata.js';

describe('ERP-4 Kit Metadata Registration (ERP4-22 / #178)', () => {
  it('registers correct top-level module metadata', () => {
    expect(erp4WebKitMetadata.moduleId).toBe('erp4');
    expect(erp4WebKitMetadata.moduleName).toContain('ERP-4 Finance & Accounting');
    expect(erp4WebKitMetadata.defaultEntity).toBe('account');
    expect(erp4WebKitMetadata.supportedSourceTypes).toContain('CSV');
    expect(erp4WebKitMetadata.supportedSourceTypes).toContain('XLSX');
  });

  it('registers all 4 core ERP-4 target entities', () => {
    expect(Object.keys(erp4WebKitMetadata.entities)).toEqual([
      'account',
      'opening_balance',
      'journal_entry',
      'journal_line',
    ]);
  });

  describe('Account entity metadata', () => {
    const accountEntity = erp4TargetEntities.account;

    it('defines correct target table and natural key', () => {
      expect(accountEntity.targetTable).toBe('erp4.accounts');
      expect(accountEntity.naturalKey).toBe('code');
    });

    it('enforces required fields: code, name, type, currency_code, source_id', () => {
      const requiredFields = erp4AccountsTargetFields
        .filter((f) => f.required)
        .map((f) => f.name);
      expect(requiredFields).toContain('code');
      expect(requiredFields).toContain('name');
      expect(requiredFields).toContain('type');
      expect(requiredFields).toContain('currency_code');
      expect(requiredFields).toContain('source_id');
    });

    it('defines account type enum with asset, liability, income, expense', () => {
      const typeField = erp4AccountsTargetFields.find((f) => f.name === 'type');
      expect(typeField?.type).toBe('enum');
      expect(typeField?.enumOptions).toEqual(['asset', 'liability', 'income', 'expense']);
    });
  });

  describe('Opening Balances entity metadata', () => {
    const obEntity = erp4TargetEntities.opening_balance;

    it('defines correct target table and required fields', () => {
      expect(obEntity.targetTable).toBe('erp4.opening_balances');
      const requiredFields = erp4OpeningBalancesTargetFields
        .filter((f) => f.required)
        .map((f) => f.name);
      expect(requiredFields).toContain('account_id');
      expect(requiredFields).toContain('currency_code');
      expect(requiredFields).toContain('balance_amount');
      expect(requiredFields).toContain('as_of_date');
      expect(requiredFields).toContain('source_id');
    });

    it('balance_amount is decimal and as_of_date is date', () => {
      const balField = erp4OpeningBalancesTargetFields.find((f) => f.name === 'balance_amount');
      const dateField = erp4OpeningBalancesTargetFields.find((f) => f.name === 'as_of_date');
      expect(balField?.type).toBe('decimal');
      expect(dateField?.type).toBe('date');
    });
  });

  describe('Journal Entry entity metadata', () => {
    const jeEntity = erp4TargetEntities.journal_entry;

    it('defines required fields: entry_number, period_id, posting_date, currency_code, description, lines, source_id', () => {
      expect(jeEntity.targetTable).toBe('erp4.journal_entries');
      const requiredFields = erp4JournalEntriesTargetFields
        .filter((f) => f.required)
        .map((f) => f.name);
      expect(requiredFields).toContain('entry_number');
      expect(requiredFields).toContain('period_id');
      expect(requiredFields).toContain('posting_date');
      expect(requiredFields).toContain('currency_code');
      expect(requiredFields).toContain('description');
      expect(requiredFields).toContain('lines');
      expect(requiredFields).toContain('source_id');
    });
  });

  describe('Translation dictionaries', () => {
    it('normalizes legacy account types to canonical enum values', () => {
      expect(ACCOUNT_TYPE_TRANSLATION_MAP['asset']).toBe('asset');
      expect(ACCOUNT_TYPE_TRANSLATION_MAP['fixed asset']).toBe('asset');
      expect(ACCOUNT_TYPE_TRANSLATION_MAP['bank asset']).toBe('asset');
      expect(ACCOUNT_TYPE_TRANSLATION_MAP['liabilities']).toBe('liability');
      expect(ACCOUNT_TYPE_TRANSLATION_MAP['revenue']).toBe('income');
      expect(ACCOUNT_TYPE_TRANSLATION_MAP['operating expense']).toBe('expense');
    });

    it('normalizes currency representations to ISO 4217 uppercase', () => {
      expect(CURRENCY_CODE_TRANSLATION_MAP['₹']).toBe('INR');
      expect(CURRENCY_CODE_TRANSLATION_MAP['$']).toBe('USD');
      expect(CURRENCY_CODE_TRANSLATION_MAP['€']).toBe('EUR');
      expect(CURRENCY_CODE_TRANSLATION_MAP['inr']).toBe('INR');
    });

    it('maps period statuses correctly', () => {
      expect(PERIOD_STATUS_TRANSLATION_MAP['open']).toBe('open');
      expect(PERIOD_STATUS_TRANSLATION_MAP['closed']).toBe('locked');
      expect(PERIOD_STATUS_TRANSLATION_MAP['soft_closed']).toBe('soft_closed');
    });
  });

  describe('Canonical mapping template', () => {
    it('defines canonical template v1.0.0 for ERP-4', () => {
      expect(ERP4_CANONICAL_MAPPING_TEMPLATE.templateId).toBe('erp4-canonical-v1');
      expect(ERP4_CANONICAL_MAPPING_TEMPLATE.module).toBe('erp4');
      expect(Object.keys(ERP4_CANONICAL_MAPPING_TEMPLATE.entities)).toEqual([
        'account',
        'opening_balance',
        'journal_entry',
        'journal_line',
      ]);
    });
  });
});
