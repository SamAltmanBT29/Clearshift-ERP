// @vitest-environment jsdom
/**
 * ERP-2 Vendors & Purchasing — Migration Kit Wizard Integration Tests (KIT-14 / ERP2-22)
 *
 * Comprehensive acceptance test suite verifying all four criteria of Issue #138:
 * - Acceptance Criterion 1: Module registers target schema metadata with the shared Migration Kit wizard.
 * - Acceptance Criterion 2: Wizard dynamically renders correct target fields, data types, and required badges for the module.
 * - Acceptance Criterion 3: Attempting to map incompatible source types warns operator in the wizard interface.
 * - Acceptance Criterion 4: Required unmapped fields prevent proceeding to dry-run or load steps.
 *
 * 100% synthetic mock test data adhering to ClearShift G4 constraints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { MigrationKitWizard, type SourceColumnInfo } from '@cs/ui';
import { erp2WebKitMetadata } from '../src/kit-metadata.js';
import { VendorImportPage } from '../src/pages/VendorImportPage.js';
import { VendorsListPage } from '../src/pages/VendorsListPage.js';
import * as api from '../src/api/erp-2.js';

const mockSourceColumns: SourceColumnInfo[] = [
  { name: 'vendor_name', inferredType: 'string', sampleValues: ['Acme Industrial Supplies'] },
  { name: 'tax_id', inferredType: 'string', sampleValues: ['TAX-ACME-9901'] },
  { name: 'email', inferredType: 'string', sampleValues: ['procurement@acme.synthetic'] },
  { name: 'phone', inferredType: 'string', sampleValues: ['+1-555-0199'] },
  { name: 'currency', inferredType: 'string', sampleValues: ['USD'] },
  { name: 'created_date', inferredType: 'date', sampleValues: ['2026-03-15'] },
  { name: 'is_active', inferredType: 'boolean', sampleValues: ['true'] },
  { name: 'amount_raw', inferredType: 'decimal', sampleValues: ['1500.00'] },
];

describe('Shared Migration Kit Wizard Integration (ERP2-22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, 'fetchVendors').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  });

  describe('AC 1: Module Target Schema Registration with Shared Wizard', () => {
    it('initializes wizard pre-bound to module metadata without cloning wizard infrastructure (H2)', () => {
      render(
        <MigrationKitWizard
          metadata={erp2WebKitMetadata}
          sourceColumns={mockSourceColumns}
        />
      );

      // Verifies module context is mounted and displayed
      expect(screen.getByTestId('migration-kit-wizard')).toBeDefined();
      expect(screen.getByTestId('wizard-title').textContent).toContain('Step 4: Map Source Columns to Target Fields');
      expect(screen.getByText(/Module:/).textContent).toContain('erp2');
      expect(screen.getByText(/ERP-2 Vendors and Purchasing/)).toBeDefined();
      expect(screen.getByText(/Target Table:/).textContent).toContain('erp2_vendors');
    });

    it('allows switching between registered module entities: vendors, purchase_orders, po_lines', () => {
      render(
        <MigrationKitWizard
          metadata={erp2WebKitMetadata}
          sourceColumns={mockSourceColumns}
        />
      );

      const entitySelect = screen.getByTestId('select-target-entity') as HTMLSelectElement;
      expect(entitySelect).toBeDefined();
      expect(within(entitySelect).getByText('Vendor Master Records')).toBeDefined();
      expect(within(entitySelect).getByText('Purchase Orders')).toBeDefined();
      expect(within(entitySelect).getByText('Purchase Order Line Items')).toBeDefined();

      // Switch to Purchase Orders entity
      fireEvent.change(entitySelect, { target: { value: 'purchase_orders' } });
      expect(screen.getByText(/Target Table:/).textContent).toContain('erp2_purchase_orders');
      expect(screen.getByTestId('field-row-po_number')).toBeDefined();

      // Switch to Purchase Order Lines entity
      fireEvent.change(entitySelect, { target: { value: 'po_lines' } });
      expect(screen.getByText(/Target Table:/).textContent).toContain('erp2_po_lines');
      expect(screen.getByTestId('field-row-quantity')).toBeDefined();
    });
  });

  describe('AC 2: Dynamic Rendering of Target Fields, Types & Required Badges', () => {
    it('renders all primary vendor target fields with human-readable labels and technical keys', () => {
      render(
        <MigrationKitWizard
          metadata={erp2WebKitMetadata}
          initialEntity="vendors"
          sourceColumns={mockSourceColumns}
        />
      );

      // Verify primary fields exist
      expect(screen.getByTestId('field-row-name')).toBeDefined();
      expect(screen.getByTestId('field-row-tax_number')).toBeDefined();
      expect(screen.getByTestId('field-row-email')).toBeDefined();
      expect(screen.getByTestId('field-row-currency')).toBeDefined();
      expect(screen.getByTestId('field-row-bank_masked')).toBeDefined();
    });

    it('renders correct data type badges including allowed enum options for purchase order status (FR-ERP2-04)', () => {
      render(
        <MigrationKitWizard
          metadata={erp2WebKitMetadata}
          initialEntity="purchase_orders"
          sourceColumns={mockSourceColumns}
        />
      );

      // Data type badge assertions
      expect(screen.getByTestId('badge-type-po_number').textContent).toContain('string');
      expect(screen.getByTestId('badge-type-vendor_id').textContent).toContain('uuid');
      expect(screen.getByTestId('badge-type-order_date').textContent).toContain('date');
      expect(screen.getByTestId('badge-type-status').textContent).toContain('enum');
      expect(screen.getByTestId('badge-type-total').textContent).toContain('decimal');

      // Allowed enum options rendered dynamically per FR-ERP2-04
      const enumOptions = screen.getByTestId('enum-options-status');
      expect(enumOptions.textContent).toContain('[Draft, Sent, Received, Closed]');
    });

    it('renders distinct Required and Optional badges per target field contract', () => {
      render(
        <MigrationKitWizard
          metadata={erp2WebKitMetadata}
          initialEntity="vendors"
          sourceColumns={mockSourceColumns}
        />
      );

      // Required badges for Vendors
      expect(screen.getByTestId('badge-required-name').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-tax_number').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-email').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-currency').textContent).toContain('Required');

      // Optional badges for Vendors
      expect(screen.getByTestId('badge-optional-phone').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-address_line').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-bank_masked').textContent).toContain('Optional');
    });
  });

  describe('AC 3: Incompatible Source Type Warnings in Wizard Interface', () => {
    it('surfaces operator warning when mapping a date source column to a decimal total field', () => {
      render(
        <MigrationKitWizard
          metadata={erp2WebKitMetadata}
          initialEntity="purchase_orders"
          sourceColumns={mockSourceColumns}
        />
      );

      // Map created_date (inferredType: 'date') to total (type: 'decimal')
      const totalSelect = screen.getByTestId('select-mapping-total') as HTMLSelectElement;
      fireEvent.change(totalSelect, { target: { value: 'created_date' } });

      // Expect operator warning banner
      const warningBanner = screen.getByTestId('type-incompatibility-warning');
      expect(warningBanner).toBeDefined();
      expect(warningBanner.textContent).toContain('Source Data Type Incompatibility Warning');
      expect(warningBanner.textContent).toContain('Target field total mapped to column created_date');
      expect(warningBanner.textContent).toContain('cannot be safely converted to decimal');

      // Expect inline warning on the specific row
      const inlineWarning = screen.getByTestId('inline-warning-total');
      expect(inlineWarning).toBeDefined();
      expect(inlineWarning.textContent).toContain('cannot be safely converted to decimal');
    });

    it('surfaces operator warning when mapping a boolean source column to an enum status field', () => {
      render(
        <MigrationKitWizard
          metadata={erp2WebKitMetadata}
          initialEntity="purchase_orders"
          sourceColumns={mockSourceColumns}
        />
      );

      // Map is_active (inferredType: 'boolean') to status (type: 'enum')
      const statusSelect = screen.getByTestId('select-mapping-status') as HTMLSelectElement;
      fireEvent.change(statusSelect, { target: { value: 'is_active' } });

      const warningBanner = screen.getByTestId('type-incompatibility-warning');
      expect(warningBanner).toBeDefined();
      expect(warningBanner.textContent).toContain('cannot be mapped to enum [Draft, Sent, Received, Closed]');
    });

    it('surfaces type coercion warning when mapping a text column to a decimal field', () => {
      const textColOnly: SourceColumnInfo[] = [
        { name: 'amount_raw_text', inferredType: 'string' },
      ];

      render(
        <MigrationKitWizard
          metadata={erp2WebKitMetadata}
          initialEntity="purchase_orders"
          sourceColumns={textColOnly}
        />
      );

      const totalSelect = screen.getByTestId('select-mapping-total') as HTMLSelectElement;
      fireEvent.change(totalSelect, { target: { value: 'amount_raw_text' } });

      const inlineWarning = screen.getByTestId('inline-warning-total');
      expect(inlineWarning.textContent).toContain('Text column will be parsed into numeric decimal');
    });
  });

  describe('AC 4: Required Unmapped Fields Prevent Proceeding to Dry-Run & Load', () => {
    it('disables Proceed to Dry-Run and Load buttons when required fields are unmapped', () => {
      render(
        <MigrationKitWizard
          metadata={erp2WebKitMetadata}
          initialEntity="vendors"
          sourceColumns={mockSourceColumns}
          initialMapping={{}} // Completely unmapped
        />
      );

      // Verify Proceed to Dry-Run is disabled
      const dryRunBtn = screen.getByTestId('btn-proceed-dry-run') as HTMLButtonElement;
      expect(dryRunBtn.disabled).toBe(true);
      expect(dryRunBtn.getAttribute('aria-disabled')).toBe('true');

      // Verify Start Migration Load is disabled
      const loadBtn = screen.getByTestId('btn-proceed-load') as HTMLButtonElement;
      expect(loadBtn.disabled).toBe(true);
      expect(loadBtn.getAttribute('aria-disabled')).toBe('true');

      // Verify unmapped required alert is rendered listing missing fields
      const alert = screen.getByTestId('unmapped-required-alert');
      expect(alert).toBeDefined();
      expect(alert.textContent).toContain('Required Fields Unmapped — Dry-Run & Load Blocked');

      const missingList = screen.getByTestId('missing-required-list');
      expect(missingList.textContent).toContain('Vendor Name');
      expect(missingList.textContent).toContain('Tax Identification Number');
      expect(missingList.textContent).toContain('Contact Email');
      expect(missingList.textContent).toContain('Default Currency (ISO-4217)');
    });

    it('enables Proceed to Dry-Run once all required vendor fields are mapped', () => {
      const onProceedDryRun = vi.fn();
      render(
        <MigrationKitWizard
          metadata={erp2WebKitMetadata}
          initialEntity="vendors"
          sourceColumns={mockSourceColumns}
          initialMapping={{
            name: 'vendor_name',
            tax_number: 'tax_id',
            email: 'email',
            currency: 'currency',
          }}
          onProceedDryRun={onProceedDryRun}
        />
      );

      const dryRunBtn = screen.getByTestId('btn-proceed-dry-run') as HTMLButtonElement;
      expect(dryRunBtn.disabled).toBe(false);

      fireEvent.click(dryRunBtn);
      expect(onProceedDryRun).toHaveBeenCalledTimes(1);
      expect(onProceedDryRun).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'vendor_name',
          tax_number: 'tax_id',
          email: 'email',
          currency: 'currency',
        }),
        'vendors'
      );
    });
  });

  describe('VendorImportPage Host Screen & Navigation', () => {
    it('mounts VendorImportPage with header, preset selector, and shared wizard', () => {
      render(<VendorImportPage />);

      expect(screen.getByTestId('vendor-import-page')).toBeDefined();
      expect(screen.getByTestId('page-heading').textContent).toContain('ERP-2 Data Import & Field Mapping');
      expect(screen.getByTestId('preset-selector')).toBeDefined();
      expect(screen.getByTestId('migration-kit-wizard')).toBeDefined();
    });

    it('triggers onNavigateBack when back button is clicked', () => {
      const onNavigateBack = vi.fn();
      render(<VendorImportPage onNavigateBack={onNavigateBack} />);

      const backBtn = screen.getByTestId('btn-import-back');
      fireEvent.click(backBtn);
      expect(onNavigateBack).toHaveBeenCalledTimes(1);
    });

    it('allows switching synthetic source presets in VendorImportPage', () => {
      render(<VendorImportPage />);

      const presetSelect = screen.getByTestId('preset-selector') as HTMLSelectElement;
      fireEvent.change(presetSelect, { target: { value: 'incomplete_vendors_csv' } });

      expect(screen.getAllByText(/Incomplete Vendors CSV/).length).toBeGreaterThanOrEqual(1);
    });

    it('transitions to import view from VendorsListPage when clicking Import Data', async () => {
      render(<VendorsListPage />);

      const importBtn = screen.getByTestId('btn-import-data');
      expect(importBtn).toBeDefined();

      fireEvent.click(importBtn);

      expect(await screen.findByTestId('vendor-import-page')).toBeDefined();
      expect(screen.getByTestId('page-heading').textContent).toContain('ERP-2 Data Import & Field Mapping');
    });
  });
});
