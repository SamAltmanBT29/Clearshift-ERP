// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RejectionReviewScreen } from '@cs/ui';
import {
  erp4AccountsRejectionContext,
  erp4JournalEntriesRejectionContext,
  SYNTHETIC_ERP4_REJECTIONS,
} from '../src/rejection-context.js';
import { FinanceRejectionReviewPage } from '../src/pages/FinanceRejectionReviewPage.js';

describe('ERP-4 Finance & Accounting Migration Rejection Review & Export Screen (ERP4-23 / #179)', () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  // ─── 1. Initial Rendering ─────────────────────────────────────────────────

  describe('1. Initial Rendering & Layout', () => {
    it('renders header with module title, batch badge, and total count', () => {
      render(
        <RejectionReviewScreen
          context={erp4AccountsRejectionContext}
          rejectedRows={SYNTHETIC_ERP4_REJECTIONS}
          batchId="BATCH_ERP4_TEST_01"
        />
      );

      expect(
        screen.getByText(/ERP-4 Finance and Accounting: Migration Rejection Review/i)
      ).toBeTruthy();
      expect(screen.getByText(/Batch: BATCH_ERP4_TEST_01/i)).toBeTruthy();
      expect(screen.getByText(/Reviewing 5 rejected records in batch BATCH_ERP4_TEST_01/i)).toBeTruthy();
      expect(screen.getByTestId('privacy-masking-notice')).toBeTruthy();
    });

    it('renders search bar, error code filter dropdown, and export button', () => {
      render(
        <RejectionReviewScreen
          context={erp4AccountsRejectionContext}
          rejectedRows={SYNTHETIC_ERP4_REJECTIONS}
        />
      );

      expect(screen.getByTestId('input-rejections-search')).toBeTruthy();
      expect(screen.getByTestId('select-error-code-filter')).toBeTruthy();
      expect(screen.getByTestId('btn-export-rejections')).toBeTruthy();
    });
  });

  // ─── 2. AC1: Module Identifier Columns ───────────────────────────────────

  describe('2. Acceptance Criterion 1: Module Identifier Columns', () => {
    it('renders ERP-4 module-specific table headers: Account Code, Account Name, Source ID, Currency', () => {
      render(
        <RejectionReviewScreen
          context={erp4AccountsRejectionContext}
          rejectedRows={SYNTHETIC_ERP4_REJECTIONS}
        />
      );

      expect(screen.getByRole('columnheader', { name: /Account Code/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Account Name/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Source ID/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Currency/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Error Code/i })).toBeTruthy();
    });

    it('renders journal entries headers: Entry Number, Period ID, Source ID, Currency', () => {
      const jeRows = SYNTHETIC_ERP4_REJECTIONS.filter((r) => r.entity === 'journal_entries');
      render(
        <RejectionReviewScreen
          context={erp4JournalEntriesRejectionContext}
          rejectedRows={jeRows}
        />
      );

      expect(screen.getByRole('columnheader', { name: /Entry Number/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Period ID/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Source ID/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Currency/i })).toBeTruthy();
    });
  });

  // ─── 3. AC2: Clear Reason Text & Failure Explanations ────────────────────

  describe('3. Acceptance Criterion 2: Human-Readable Failure Explanations', () => {
    it('displays clear human-readable error badges for DUPLICATE_ACCOUNT_CODE and JOURNAL_UNBALANCED', () => {
      render(
        <RejectionReviewScreen
          context={erp4AccountsRejectionContext}
          rejectedRows={SYNTHETIC_ERP4_REJECTIONS}
        />
      );

      expect(screen.getAllByText('DUPLICATE_ACCOUNT_CODE').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('JOURNAL_UNBALANCED').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('PERIOD_LOCKED').length).toBeGreaterThanOrEqual(1);
    });

    it('displays domain failure reason explanation and doc reference in table', () => {
      render(
        <RejectionReviewScreen
          context={erp4AccountsRejectionContext}
          rejectedRows={SYNTHETIC_ERP4_REJECTIONS}
        />
      );

      expect(screen.getByText('Duplicate General Ledger Account Code')).toBeTruthy();
      expect(screen.getAllByText(/Ref: BR-ERP4-01/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── 4. AC3: Automatic Masking of Sensitive Fields ───────────────────────

  describe('4. Acceptance Criterion 3: Sensitive Field Masking', () => {
    it('automatically masks bank_account, tax_id, and salary in inspected raw payload', () => {
      render(
        <RejectionReviewScreen
          context={erp4AccountsRejectionContext}
          rejectedRows={SYNTHETIC_ERP4_REJECTIONS}
        />
      );

      // Click inspect for row 1 which has sensitive bank details
      const inspectBtn = screen.getByTestId('btn-inspect-row-rej_acc_01');
      fireEvent.click(inspectBtn);

      // Verify modal opens with Source Raw Fields (Sensitive Fields Masked)
      expect(screen.getByText(/Source Raw Fields \(Sensitive Fields Masked\)/i)).toBeTruthy();

      // Verify masked indicators are present
      const maskedIndicators = screen.getAllByTestId('inspect-masked-indicator');
      expect(maskedIndicators.length).toBeGreaterThanOrEqual(3);

      // Verify sensitive field containers
      const bankField = screen.getByTestId('inspect-field-bank_account');
      expect(bankField.textContent).toContain('🔒 MASKED');
      const taxField = screen.getByTestId('inspect-field-tax_id');
      expect(taxField.textContent).toContain('🔒 MASKED');
      const salaryField = screen.getByTestId('inspect-field-salary');
      expect(salaryField.textContent).toContain('🔒 MASKED');
    });
  });

  // ─── 5. AC4: Formula-Safe CSV Export ─────────────────────────────────────

  describe('5. Acceptance Criterion 4: Formula-Safe CSV Export', () => {
    it('initiates CSV export on button click with blob creation', () => {
      render(
        <RejectionReviewScreen
          context={erp4AccountsRejectionContext}
          rejectedRows={SYNTHETIC_ERP4_REJECTIONS}
        />
      );

      const exportBtn = screen.getByTestId('btn-export-rejections');
      fireEvent.click(exportBtn);

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 6. FinanceRejectionReviewPage Component ─────────────────────────────

  describe('6. FinanceRejectionReviewPage Wrapper Component', () => {
    it('renders with default accounts entity and allows switching to journal entries', () => {
      render(<FinanceRejectionReviewPage />);

      expect(screen.getByTestId('finance-rejection-review-page')).toBeTruthy();
      const entitySelect = screen.getByTestId('select-rejection-entity') as HTMLSelectElement;
      expect(entitySelect.value).toBe('accounts');

      // Switch to journal entries
      fireEvent.change(entitySelect, { target: { value: 'journal_entries' } });
      expect(screen.getByRole('columnheader', { name: /Entry Number/i })).toBeTruthy();
    });
  });
});
