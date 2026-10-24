// @vitest-environment jsdom
/**
 * ERP-4 Finance & Accounting — Migration Kit Wizard Integration Tests (KIT-14 / ERP4-22 / #178)
 *
 * Verifies all 4 Acceptance Criteria for Issue #178:
 * - AC1: Module registers target schema metadata with the shared Migration Kit wizard.
 * - AC2: Wizard dynamically renders correct target fields, data types, and required badges for the module.
 * - AC3: Attempting to map incompatible source types warns operator in the wizard interface.
 * - AC4: Required unmapped fields prevent proceeding to dry-run or load steps.
 *
 * Adheres to ClearShift Core Rules: synthetic fixtures only, zero duplicated UI wizards (H2).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { MigrationKitWizard, type SourceColumnInfo } from '@cs/ui';
import { erp4WebKitMetadata } from '../src/kit-metadata.js';

const mockSourceColumns: SourceColumnInfo[] = [
  { name: 'source_id', inferredType: 'string', sampleValues: ['ACC-001', 'ACC-002'] },
  { name: 'code', inferredType: 'string', sampleValues: ['1010-CASH', '2010-AP'] },
  { name: 'name', inferredType: 'string', sampleValues: ['Cash on Hand', 'Accounts Payable'] },
  { name: 'type', inferredType: 'string', sampleValues: ['asset', 'liability'] },
  { name: 'currency_code', inferredType: 'string', sampleValues: ['INR', 'USD'] },
  { name: 'parent_code', inferredType: 'string', sampleValues: ['1000-ASSET', ''] },
  { name: 'description', inferredType: 'string', sampleValues: ['Main petty cash', 'Trade creditors'] },
  { name: 'is_active', inferredType: 'boolean', sampleValues: ['true', 'false'] },
  { name: 'is_posting_account', inferredType: 'boolean', sampleValues: ['true', 'true'] },
  { name: 'created_date', inferredType: 'date', sampleValues: ['2026-04-01'] },
  { name: 'amount_raw', inferredType: 'decimal', sampleValues: ['50000.00'] },
];

describe('Shared Migration Kit Wizard Integration (ERP4-22 / #178)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AC 1: Module Target Schema Registration with Shared Wizard', () => {
    it('initializes wizard pre-bound to ERP-4 module metadata without cloning wizard infrastructure (H2)', () => {
      render(
        <MigrationKitWizard
          metadata={erp4WebKitMetadata}
          sourceColumns={mockSourceColumns}
        />
      );

      // Verifies module context is mounted and displayed
      expect(screen.getByTestId('migration-kit-wizard')).toBeDefined();
      expect(screen.getByTestId('wizard-title').textContent).toContain('Step 4: Map Source Columns to Target Fields');
      expect(screen.getByText(/Module:/).textContent).toContain('erp4');
      expect(screen.getByText(/ERP-4 Finance & Accounting/)).toBeDefined();
      expect(screen.getByText(/Target Table:/).textContent).toContain('erp4.accounts');
    });

    it('allows switching between registered ERP-4 entities: account, opening_balance, journal_entry, journal_line', () => {
      render(
        <MigrationKitWizard
          metadata={erp4WebKitMetadata}
          sourceColumns={mockSourceColumns}
        />
      );

      const entitySelect = screen.getByTestId('select-target-entity') as HTMLSelectElement;
      expect(entitySelect).toBeDefined();
      expect(within(entitySelect).getByText('Chart of Accounts')).toBeDefined();
      expect(within(entitySelect).getByText('Opening Balances')).toBeDefined();
      expect(within(entitySelect).getByText('Journal Entries')).toBeDefined();
      expect(within(entitySelect).getByText('Journal Lines')).toBeDefined();

      // Switch to Opening Balances entity
      fireEvent.change(entitySelect, { target: { value: 'opening_balance' } });
      expect(screen.getByText(/Target Table:/).textContent).toContain('erp4.opening_balances');
      expect(screen.getByTestId('field-row-balance_amount')).toBeDefined();

      // Switch to Journal Entries entity
      fireEvent.change(entitySelect, { target: { value: 'journal_entry' } });
      expect(screen.getByText(/Target Table:/).textContent).toContain('erp4.journal_entries');
      expect(screen.getByTestId('field-row-entry_number')).toBeDefined();

      // Switch to Journal Lines entity
      fireEvent.change(entitySelect, { target: { value: 'journal_line' } });
      expect(screen.getByText(/Target Table:/).textContent).toContain('erp4.journal_lines');
      expect(screen.getByTestId('field-row-debit_amount')).toBeDefined();
    });
  });

  describe('AC 2: Dynamic Rendering of Target Fields, Types & Required Badges', () => {
    it('renders all primary account target fields with human-readable labels and technical keys', () => {
      render(
        <MigrationKitWizard
          metadata={erp4WebKitMetadata}
          initialEntity="account"
          sourceColumns={mockSourceColumns}
        />
      );

      expect(screen.getByTestId('field-row-code')).toBeDefined();
      expect(screen.getByTestId('field-row-name')).toBeDefined();
      expect(screen.getByTestId('field-row-type')).toBeDefined();
      expect(screen.getByTestId('field-row-currency_code')).toBeDefined();
      expect(screen.getByTestId('field-row-parent_id')).toBeDefined();
      expect(screen.getByTestId('field-row-description')).toBeDefined();
    });

    it('renders correct data type badges including allowed enum options for account classification (ACC-003)', () => {
      render(
        <MigrationKitWizard
          metadata={erp4WebKitMetadata}
          initialEntity="account"
          sourceColumns={mockSourceColumns}
        />
      );

      expect(screen.getByTestId('badge-type-code').textContent).toContain('string');
      expect(screen.getByTestId('badge-type-type').textContent).toContain('enum');
      expect(screen.getByTestId('badge-type-currency_code').textContent).toContain('string');
      expect(screen.getByTestId('badge-type-is_active').textContent).toContain('boolean');

      const enumOptions = screen.getByTestId('enum-options-type');
      expect(enumOptions.textContent).toContain('[asset, liability, income, expense]');
    });

    it('renders distinct Required and Optional badges per target field definition', () => {
      render(
        <MigrationKitWizard
          metadata={erp4WebKitMetadata}
          initialEntity="account"
          sourceColumns={mockSourceColumns}
        />
      );

      // Required badges
      expect(screen.getByTestId('badge-required-code').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-name').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-type').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-currency_code').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-source_id').textContent).toContain('Required');

      // Optional badges
      expect(screen.getByTestId('badge-optional-parent_id').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-description').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-is_active').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-is_posting_account').textContent).toContain('Optional');
    });

    it('renders decimal and date badges for opening balances', () => {
      render(
        <MigrationKitWizard
          metadata={erp4WebKitMetadata}
          initialEntity="opening_balance"
          sourceColumns={mockSourceColumns}
        />
      );

      expect(screen.getByTestId('badge-type-balance_amount').textContent).toContain('decimal');
      expect(screen.getByTestId('badge-type-as_of_date').textContent).toContain('date');
    });
  });

  describe('AC 3: Incompatible Source Type Warnings in Wizard Interface', () => {
    it('surfaces operator warning when mapping a date source column to a decimal balance_amount field', () => {
      render(
        <MigrationKitWizard
          metadata={erp4WebKitMetadata}
          initialEntity="opening_balance"
          sourceColumns={mockSourceColumns}
        />
      );

      // Map created_date (inferredType: 'date') to balance_amount (type: 'decimal')
      const balSelect = screen.getByTestId('select-mapping-balance_amount') as HTMLSelectElement;
      fireEvent.change(balSelect, { target: { value: 'created_date' } });

      const warningBanner = screen.getByTestId('type-incompatibility-warning');
      expect(warningBanner).toBeDefined();
      expect(warningBanner.textContent).toContain('Source Data Type Incompatibility Warning');
      expect(warningBanner.textContent).toContain('cannot be safely converted to decimal');

      const inlineWarning = screen.getByTestId('inline-warning-balance_amount');
      expect(inlineWarning).toBeDefined();
      expect(inlineWarning.textContent).toContain('cannot be safely converted to decimal');
    });

    it('surfaces operator warning when mapping a boolean source column to an enum account type field', () => {
      render(
        <MigrationKitWizard
          metadata={erp4WebKitMetadata}
          initialEntity="account"
          sourceColumns={mockSourceColumns}
        />
      );

      const typeSelect = screen.getByTestId('select-mapping-type') as HTMLSelectElement;
      fireEvent.change(typeSelect, { target: { value: 'is_active' } });

      const warningBanner = screen.getByTestId('type-incompatibility-warning');
      expect(warningBanner).toBeDefined();
      expect(warningBanner.textContent).toContain('cannot be mapped to enum [asset, liability, income, expense]');
    });
  });

  describe('AC 4: Required Unmapped Fields Prevent Proceeding to Dry-Run & Load', () => {
    it('disables Proceed to Dry-Run and Load buttons when required fields are unmapped', () => {
      render(
        <MigrationKitWizard
          metadata={erp4WebKitMetadata}
          initialEntity="account"
          sourceColumns={mockSourceColumns}
          initialMapping={{}}
        />
      );

      const dryRunBtn = screen.getByTestId('btn-proceed-dry-run') as HTMLButtonElement;
      expect(dryRunBtn.disabled).toBe(true);
      expect(dryRunBtn.getAttribute('aria-disabled')).toBe('true');

      const loadBtn = screen.getByTestId('btn-proceed-load') as HTMLButtonElement;
      expect(loadBtn.disabled).toBe(true);
      expect(loadBtn.getAttribute('aria-disabled')).toBe('true');

      const alert = screen.getByTestId('unmapped-required-alert');
      expect(alert).toBeDefined();
      expect(alert.textContent).toContain('Required Fields Unmapped — Dry-Run & Load Blocked');

      const missingList = screen.getByTestId('missing-required-list');
      expect(missingList.textContent).toContain('Account Code');
      expect(missingList.textContent).toContain('Account Name');
      expect(missingList.textContent).toContain('Account Classification');
      expect(missingList.textContent).toContain('Currency Code');
      expect(missingList.textContent).toContain('Source Record ID');
    });

    it('enables Proceed to Dry-Run button once all required fields are mapped', () => {
      const fullMapping = {
        source_id: 'source_id',
        code: 'code',
        name: 'name',
        type: 'type',
        currency_code: 'currency_code',
      };

      const onProceedDryRun = vi.fn();

      render(
        <MigrationKitWizard
          metadata={erp4WebKitMetadata}
          initialEntity="account"
          sourceColumns={mockSourceColumns}
          initialMapping={fullMapping}
          onProceedDryRun={onProceedDryRun}
        />
      );

      const dryRunBtn = screen.getByTestId('btn-proceed-dry-run') as HTMLButtonElement;
      expect(dryRunBtn.disabled).toBe(false);

      fireEvent.click(dryRunBtn);
      expect(onProceedDryRun).toHaveBeenCalledTimes(1);
      expect(onProceedDryRun).toHaveBeenCalledWith(fullMapping, 'account');
    });
  });
});
