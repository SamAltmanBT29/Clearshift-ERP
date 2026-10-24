import { describe, it, expect } from 'vitest';
import {
  erp4AccountsRejectionContext,
  erp4JournalEntriesRejectionContext,
  erp4FailureExplanations,
} from '../../src/kit/rejection-context.js';
import {
  resolveFailureExplanation,
  exportRejectedRowsCsv,
  maskRejectedRow,
  type RejectedRow,
} from '@cs/kit';

describe('ERP-4 Finance & Accounting Migration Rejection Context (ERP4-23 / #179 / KIT-16)', () => {
  // ─── Accounts Context ────────────────────────────────────────────────────────

  describe('Accounts Context — Module Definition', () => {
    it('defines valid accounts module context targeting erp4', () => {
      expect(erp4AccountsRejectionContext.moduleId).toBe('erp4');
      expect(erp4AccountsRejectionContext.entity).toBe('accounts');
      expect(erp4AccountsRejectionContext.moduleName).toContain('Finance');
    });
  });

  describe('1. Module Identifier Columns (AC1) — Chart of Accounts', () => {
    it('defines natural identifier columns: code, name, source_id, currency_code', () => {
      const idFields = erp4AccountsRejectionContext.identifierColumns.map((c) => c.field);
      expect(idFields).toContain('code');
      expect(idFields).toContain('name');
      expect(idFields).toContain('source_id');
      expect(idFields).toContain('currency_code');

      const codeCol = erp4AccountsRejectionContext.identifierColumns.find(
        (c) => c.field === 'code'
      );
      expect(codeCol?.isIdentifier).toBe(true);
    });

    it('code format normalizes to uppercase trimmed string', () => {
      const codeCol = erp4AccountsRejectionContext.identifierColumns.find(
        (c) => c.field === 'code'
      );
      expect(codeCol?.format?.('  1010-cash  ', {} as RejectedRow)).toBe('1010-CASH');
    });

    it('code format returns fallback em-dash for null/undefined', () => {
      const codeCol = erp4AccountsRejectionContext.identifierColumns.find(
        (c) => c.field === 'code'
      );
      expect(codeCol?.format?.(undefined, {} as RejectedRow)).toBe('—');
      expect(codeCol?.format?.(null, {} as RejectedRow)).toBe('—');
    });

    it('includes secondary context columns: type, parent_id, description', () => {
      const addFields = (erp4AccountsRejectionContext.additionalColumns || []).map((c) => c.field);
      expect(addFields).toContain('type');
      expect(addFields).toContain('parent_id');
      expect(addFields).toContain('description');
    });
  });

  describe('1. Module Identifier Columns (AC1) — Journal Entries', () => {
    it('defines natural identifier columns: entry_number, period_id, source_id, currency_code', () => {
      const idFields = erp4JournalEntriesRejectionContext.identifierColumns.map((c) => c.field);
      expect(idFields).toContain('entry_number');
      expect(idFields).toContain('period_id');
      expect(idFields).toContain('source_id');
      expect(idFields).toContain('currency_code');

      const entryCol = erp4JournalEntriesRejectionContext.identifierColumns.find(
        (c) => c.field === 'entry_number'
      );
      expect(entryCol?.isIdentifier).toBe(true);
    });

    it('entry_number format normalizes to uppercase trimmed string', () => {
      const entryCol = erp4JournalEntriesRejectionContext.identifierColumns.find(
        (c) => c.field === 'entry_number'
      );
      expect(entryCol?.format?.('  je-2026-001  ', {} as RejectedRow)).toBe('JE-2026-001');
    });

    it('includes secondary context columns: posting_date, description', () => {
      const addFields = (erp4JournalEntriesRejectionContext.additionalColumns || []).map(
        (c) => c.field
      );
      expect(addFields).toContain('posting_date');
      expect(addFields).toContain('description');
    });
  });

  // ─── Failure Explanations ─────────────────────────────────────────────────

  describe('2. Standardized Error Codes & Failure Explanations (AC2)', () => {
    const requiredCodes = [
      'DUPLICATE_ACCOUNT_CODE',
      'JOURNAL_UNBALANCED',
      'PERIOD_LOCKED',
      'PERIOD_CLOSED',
      'INVALID_ACCOUNT_TYPE',
      'INVALID_CURRENCY',
      'NEGATIVE_AMOUNT',
      'UNRESOLVED_ACCOUNT_REFERENCE',
      'MISSING_REQUIRED_FIELD',
      'BANK_DETAILS_EXPOSED',
    ];

    it.each(requiredCodes)('defines explanation for code %s', (code) => {
      const explanation = erp4FailureExplanations[code];
      expect(explanation).toBeDefined();
      expect(explanation?.title).toBeTruthy();
      expect(explanation?.explanation).toBeTruthy();
      expect(explanation?.resolution).toBeTruthy();
      expect(explanation?.docReference).toBeTruthy();
    });

    it('resolves failure explanation via resolveFailureExplanation helper', () => {
      const resolved = resolveFailureExplanation(
        erp4AccountsRejectionContext,
        'DUPLICATE_ACCOUNT_CODE',
        'Account code 1010-CASH already exists'
      );
      expect(resolved.code).toBe('DUPLICATE_ACCOUNT_CODE');
      expect(resolved.title).toBe('Duplicate General Ledger Account Code');
      expect(resolved.docReference).toBe('BR-ERP4-01');
      expect(resolved.resolution).toContain('chart of accounts');
    });

    it('resolves JOURNAL_UNBALANCED with double-entry balance details', () => {
      const resolved = resolveFailureExplanation(
        erp4JournalEntriesRejectionContext,
        'JOURNAL_UNBALANCED',
        'Debits != Credits'
      );
      expect(resolved.title).toBe('Double-Entry Journal Imbalance');
      expect(resolved.docReference).toBe('BR-ERP4-01');
      expect(resolved.resolution).toContain('sum(debit) == sum(credit)');
    });

    it('falls back cleanly for unrecognized error codes', () => {
      const resolved = resolveFailureExplanation(
        erp4AccountsRejectionContext,
        'UNKNOWN_RANDOM_CODE',
        'Custom raw error description'
      );
      expect(resolved.code).toBe('UNKNOWN_RANDOM_CODE');
      expect(resolved.explanation).toBe('Custom raw error description');
    });
  });

  // ─── Sensitive Field Masking ──────────────────────────────────────────────

  describe('3. Privacy & Sensitive Field Masking (AC3)', () => {
    it('defines comprehensive list of sensitive fields', () => {
      const sensitive = erp4AccountsRejectionContext.sensitiveFields;
      expect(sensitive).toContain('bank_account');
      expect(sensitive).toContain('salary');
      expect(sensitive).toContain('tax_id');
      expect(sensitive).toContain('routing_number');
      expect(sensitive).toContain('credit_card_number');
      expect(sensitive).toContain('iban');
    });

    it('masks sensitive fields in raw data using maskRejectedRow', () => {
      const rejectedRow: RejectedRow = {
        id: 'rej-test-01',
        batchId: 'BATCH_01',
        sourceRow: 10,
        entity: 'accounts',
        errorCode: 'DUPLICATE_ACCOUNT_CODE',
        failureReason: 'Duplicate code',
        field: 'code',
        createdAt: '2026-10-24T00:00:00Z',
        rawData: {
          code: '1010-CASH',
          name: 'Main Cash',
          source_id: 'SRC-01',
          currency_code: 'INR',
          bank_account: '987654321098',
          tax_id: 'PAN-FIN-9901',
          salary: 120000,
        },
      };

      const masked = maskRejectedRow(rejectedRow, erp4AccountsRejectionContext.sensitiveFields);
      expect(masked.rawData['code']).toBe('1010-CASH');
      expect(masked.rawData['name']).toBe('Main Cash');
      expect(masked.rawData['bank_account']).not.toBe('987654321098');
      expect(masked.rawData['tax_id']).not.toBe('PAN-FIN-9901');
      expect(masked.rawData['salary']).not.toBe(120000);
    });
  });

  // ─── Formula-Safe CSV Export ──────────────────────────────────────────────

  describe('4. Formula-Safe CSV Export (AC4)', () => {
    it('neutralizes spreadsheet formula injection prefixes (=, +, -, @)', () => {
      const testRows: RejectedRow[] = [
        {
          id: 'rej-f01',
          batchId: 'BATCH_01',
          sourceRow: 1,
          entity: 'accounts',
          errorCode: 'INVALID_CURRENCY',
          failureReason: 'Invalid currency',
          field: 'currency_code',
          createdAt: '2026-10-24T00:00:00Z',
          rawData: {
            code: '1010-CASH',
            name: '=SUM(1,2)',
            source_id: 'ACC-01',
            currency_code: '+USD',
            description: '@ATTACK',
          },
        },
      ];

      const csv = exportRejectedRowsCsv(testRows, erp4AccountsRejectionContext);

      // Verify formula prefixes have been safely neutralized with leading apostrophe
      expect(csv).toContain("'=SUM(1,2)");
      expect(csv).toContain("'+USD");
      expect(csv).toContain("'@ATTACK");
    });

    it('exports all expected column headers including identifiers and error info', () => {
      const testRows: RejectedRow[] = [
        {
          id: 'rej-f02',
          batchId: 'BATCH_01',
          sourceRow: 1,
          entity: 'accounts',
          errorCode: 'DUPLICATE_ACCOUNT_CODE',
          failureReason: 'Duplicate code',
          field: 'code',
          createdAt: '2026-10-24T00:00:00Z',
          rawData: {
            code: '1010-CASH',
            name: 'Cash Account',
            source_id: 'ACC-02',
            currency_code: 'INR',
          },
        },
      ];

      const csv = exportRejectedRowsCsv(testRows, erp4AccountsRejectionContext);
      const headerLine = csv.split('\n')[0]!;

      expect(headerLine).toContain('Source Row');
      expect(headerLine).toContain('Error Code');
      expect(headerLine).toContain('Reason');
      expect(headerLine).toContain('Account Code');
      expect(headerLine).toContain('Account Name');
      expect(headerLine).toContain('Source ID');
    });
  });
});
