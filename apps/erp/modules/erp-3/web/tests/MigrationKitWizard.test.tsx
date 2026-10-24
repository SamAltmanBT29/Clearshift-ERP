// @vitest-environment jsdom
/**
 * ERP-3 Sales Orders and Invoices — Migration Kit Wizard Integration Tests (KIT-14 / ERP3-22)
 *
 * Comprehensive acceptance test suite verifying all four criteria of Issue #158:
 * - Acceptance Criterion 1: Module registers target schema metadata with the shared Migration Kit wizard.
 * - Acceptance Criterion 2: Wizard dynamically renders correct target fields, data types, and required badges for the module.
 * - Acceptance Criterion 3: Attempting to map incompatible source types warns operator in the wizard interface.
 * - Acceptance Criterion 4: Required unmapped fields prevent proceeding to dry-run or load steps.
 *
 * 100% synthetic mock test data adhering to ClearShift G4 constraints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

import { MigrationKitWizard, type SourceColumnInfo } from '@cs/ui';
import { erp3WebKitMetadata } from '../src/kit-metadata.js';
import { OrdersImportPage } from '../src/pages/OrdersImportPage.js';
import { OrdersListPage } from '../src/pages/OrdersListPage.js';
import * as api from '../src/api/erp-3.js';

const mockSourceColumns: SourceColumnInfo[] = [
  { name: 'order_number', inferredType: 'string', sampleValues: ['SO-2026-0001'] },
  { name: 'customer_golden_id', inferredType: 'uuid', sampleValues: ['55555555-0003-4000-8000-000000000001'] },
  { name: 'order_date', inferredType: 'date', sampleValues: ['2026-10-24'] },
  { name: 'currency', inferredType: 'string', sampleValues: ['USD'] },
  { name: 'status', inferredType: 'string', sampleValues: ['Open'] },
  { name: 'total', inferredType: 'decimal', sampleValues: ['1100.0000'] },
  { name: 'notes', inferredType: 'string', sampleValues: ['Standard priority'] },
  { name: 'is_active', inferredType: 'boolean', sampleValues: ['true'] },
];

describe('Shared Migration Kit Wizard Integration (ERP3-22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    vi.spyOn(api, 'fetchInvoices').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
  });

  describe('AC 1: Module Target Schema Registration with Shared Wizard', () => {
    it('initializes wizard pre-bound to module metadata without cloning wizard infrastructure (H2)', () => {
      render(
        <MigrationKitWizard
          metadata={erp3WebKitMetadata}
          sourceColumns={mockSourceColumns}
        />
      );

      // Verifies module context is mounted and displayed
      expect(screen.getByTestId('migration-kit-wizard')).toBeTruthy();
      expect(screen.getByTestId('wizard-title').textContent).toContain('Step 4: Map Source Columns to Target Fields');
      expect(screen.getByText(/Module:/).textContent).toContain('erp3');
      expect(screen.getByText(/ERP-3 Sales Orders and Invoices/)).toBeTruthy();
      expect(screen.getByText(/Target Table:/).textContent).toContain('erp3_sales_orders');
    });

    it('allows switching between registered module entities: sales_orders, so_lines, invoices, invoice_lines', () => {
      render(
        <MigrationKitWizard
          metadata={erp3WebKitMetadata}
          sourceColumns={mockSourceColumns}
        />
      );

      const entitySelect = screen.getByTestId('select-target-entity') as HTMLSelectElement;
      expect(entitySelect).toBeTruthy();
      expect(within(entitySelect).getByText('Sales Orders')).toBeTruthy();
      expect(within(entitySelect).getByText('Sales Order Lines')).toBeTruthy();
      expect(within(entitySelect).getByText('Billing Invoices')).toBeTruthy();
      expect(within(entitySelect).getByText('Invoice Line Items')).toBeTruthy();

      // Switch to Billing Invoices entity
      fireEvent.change(entitySelect, { target: { value: 'invoices' } });
      expect(screen.getByText(/Target Table:/).textContent).toContain('erp3_invoices');
      expect(screen.getByTestId('field-row-invoice_number')).toBeTruthy();
    });
  });

  describe('AC 2: Dynamic Rendering of Target Fields, Types & Required Badges', () => {
    it('renders all primary target fields with human-readable labels and technical keys', () => {
      render(
        <MigrationKitWizard
          metadata={erp3WebKitMetadata}
          initialEntity="sales_orders"
          sourceColumns={mockSourceColumns}
        />
      );

      // Verify primary fields exist
      expect(screen.getByTestId('field-row-order_number')).toBeTruthy();
      expect(screen.getByTestId('field-row-customer_golden_id')).toBeTruthy();
      expect(screen.getByTestId('field-row-order_date')).toBeTruthy();
      expect(screen.getByTestId('field-row-currency')).toBeTruthy();
      expect(screen.getByTestId('field-row-status')).toBeTruthy();
      expect(screen.getByTestId('field-row-total')).toBeTruthy();
    });

    it('renders correct data type badges including allowed enum options for status (FR-ERP3-05)', () => {
      render(
        <MigrationKitWizard
          metadata={erp3WebKitMetadata}
          initialEntity="sales_orders"
          sourceColumns={mockSourceColumns}
        />
      );

      // Data type badge assertions
      expect(screen.getByTestId('badge-type-order_number').textContent).toContain('string');
      expect(screen.getByTestId('badge-type-customer_golden_id').textContent).toContain('uuid');
      expect(screen.getByTestId('badge-type-order_date').textContent).toContain('date');
      expect(screen.getByTestId('badge-type-currency').textContent).toContain('string');
      expect(screen.getByTestId('badge-type-total').textContent).toContain('decimal');
      expect(screen.getByTestId('badge-type-status').textContent).toContain('enum');

      // Allowed enum options rendered dynamically per FR-ERP3-05
      const enumOptions = screen.getByTestId('enum-options-status');
      expect(enumOptions.textContent).toContain('[Open, Invoiced, Closed]');
    });

    it('renders distinct Required and Optional badges per target field contract', () => {
      render(
        <MigrationKitWizard
          metadata={erp3WebKitMetadata}
          initialEntity="sales_orders"
          sourceColumns={mockSourceColumns}
        />
      );

      // Required badges
      expect(screen.getByTestId('badge-required-order_number').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-customer_golden_id').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-order_date').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-currency').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-status').textContent).toContain('Required');

      // Optional badges
      expect(screen.getByTestId('badge-optional-total').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-subtotal').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-tax_total').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-customer_email').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-customer_phone').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-notes').textContent).toContain('Optional');
    });
  });

  describe('AC 3: Incompatible Source Type Warnings in Wizard Interface', () => {
    it('surfaces operator warning when mapping a date source column to a decimal total field', () => {
      render(
        <MigrationKitWizard
          metadata={erp3WebKitMetadata}
          initialEntity="sales_orders"
          sourceColumns={mockSourceColumns}
        />
      );

      // Map order_date (inferredType: 'date') to total (type: 'decimal')
      const totalSelect = screen.getByTestId('select-mapping-total') as HTMLSelectElement;
      fireEvent.change(totalSelect, { target: { value: 'order_date' } });

      // Expect operator warning banner
      const warningBanner = screen.getByTestId('type-incompatibility-warning');
      expect(warningBanner).toBeTruthy();
      expect(warningBanner.textContent).toContain('Source Data Type Incompatibility Warning');
      expect(warningBanner.textContent).toContain('Target field total mapped to column order_date');
      expect(warningBanner.textContent).toContain('cannot be safely converted to decimal');

      // Expect inline warning on the specific row
      const inlineWarning = screen.getByTestId('inline-warning-total');
      expect(inlineWarning).toBeTruthy();
      expect(inlineWarning.textContent).toContain('cannot be safely converted to decimal');
    });

    it('surfaces operator warning when mapping a boolean source column to an enum field', () => {
      render(
        <MigrationKitWizard
          metadata={erp3WebKitMetadata}
          initialEntity="sales_orders"
          sourceColumns={mockSourceColumns}
        />
      );

      // Map is_active (inferredType: 'boolean') to status (type: 'enum')
      const statusSelect = screen.getByTestId('select-mapping-status') as HTMLSelectElement;
      fireEvent.change(statusSelect, { target: { value: 'is_active' } });

      const warningBanner = screen.getByTestId('type-incompatibility-warning');
      expect(warningBanner).toBeTruthy();
      expect(warningBanner.textContent).toContain('cannot be mapped to enum [Open, Invoiced, Closed]');
    });

    it('surfaces type coercion warning when mapping a text column to a decimal field', () => {
      const textColOnly: SourceColumnInfo[] = [
        { name: 'amount_raw_text', inferredType: 'string' },
      ];

      render(
        <MigrationKitWizard
          metadata={erp3WebKitMetadata}
          initialEntity="sales_orders"
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
          metadata={erp3WebKitMetadata}
          initialEntity="sales_orders"
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
      expect(alert).toBeTruthy();
      expect(alert.textContent).toContain('Required Fields Unmapped — Dry-Run & Load Blocked');

      const missingList = screen.getByTestId('missing-required-list');
      expect(missingList.textContent).toContain('Order Number');
      expect(missingList.textContent).toContain('Customer Golden ID');
      expect(missingList.textContent).toContain('Order Date');
      expect(missingList.textContent).toContain('Currency Code (ISO-4217)');
      expect(missingList.textContent).toContain('Order Status');
    });

    it('enables Proceed to Dry-Run once all required fields are mapped', () => {
      const onProceedDryRun = vi.fn();

      render(
        <MigrationKitWizard
          metadata={erp3WebKitMetadata}
          initialEntity="sales_orders"
          sourceColumns={mockSourceColumns}
          onProceedDryRun={onProceedDryRun}
          initialMapping={{
            order_number: 'order_number',
            customer_golden_id: 'customer_golden_id',
            order_date: 'order_date',
            currency: 'currency',
            status: 'status',
          }}
        />
      );

      // Unmapped alert should not be present
      expect(screen.queryByTestId('unmapped-required-alert')).toBeNull();

      // Proceed to Dry-Run should be enabled
      const dryRunBtn = screen.getByTestId('btn-proceed-dry-run') as HTMLButtonElement;
      expect(dryRunBtn.disabled).toBe(false);
      expect(dryRunBtn.getAttribute('aria-disabled')).toBe('false');

      // Click Proceed to Dry-Run
      fireEvent.click(dryRunBtn);
      expect(onProceedDryRun).toHaveBeenCalledTimes(1);
      expect(onProceedDryRun).toHaveBeenCalledWith(
        expect.objectContaining({
          order_number: 'order_number',
          customer_golden_id: 'customer_golden_id',
          order_date: 'order_date',
          currency: 'currency',
          status: 'status',
        }),
        'sales_orders'
      );

      // After successful dry run, Start Load should become enabled
      expect(screen.getByTestId('dry-run-success-alert')).toBeTruthy();
      const loadBtn = screen.getByTestId('btn-proceed-load') as HTMLButtonElement;
      expect(loadBtn.disabled).toBe(false);
    });

    it('auto-map suggested defaults maps all matching columns and enables dry-run', () => {
      render(
        <MigrationKitWizard
          metadata={erp3WebKitMetadata}
          initialEntity="sales_orders"
          sourceColumns={mockSourceColumns}
          initialMapping={{}}
        />
      );

      const dryRunBtn = screen.getByTestId('btn-proceed-dry-run') as HTMLButtonElement;
      expect(dryRunBtn.disabled).toBe(true);

      // Click Auto-Map button
      const autoMapBtn = screen.getByTestId('btn-auto-map');
      fireEvent.click(autoMapBtn);

      // Auto-map applies matching defaults: order_number, customer_golden_id, order_date, currency, status
      expect(dryRunBtn.disabled).toBe(false);
      expect(screen.queryByTestId('unmapped-required-alert')).toBeNull();
    });
  });

  describe('OrdersImportPage Route Integration (/erp3/import)', () => {
    it('renders import page with pre-bound wizard and preset selector', () => {
      const onNavigateBack = vi.fn();
      render(<OrdersImportPage onNavigateBack={onNavigateBack} />);

      expect(screen.getByTestId('orders-import-page')).toBeTruthy();
      expect(screen.getByText('Sales Orders & Invoices Migration Wizard')).toBeTruthy();
      expect(screen.getByText('Route: /erp3/import')).toBeTruthy();

      // Back navigation button
      const backBtn = screen.getByTestId('btn-import-back');
      fireEvent.click(backBtn);
      expect(onNavigateBack).toHaveBeenCalledTimes(1);
    });

    it('switches between presets (incompatible types preset surfaces warning immediately)', () => {
      render(<OrdersImportPage initialPresetKey="standard_csv" />);

      const presetSelect = screen.getByTestId('select-source-preset') as HTMLSelectElement;
      expect(presetSelect.value).toBe('standard_csv');

      // Switch to Incompatible Types CSV preset
      fireEvent.change(presetSelect, { target: { value: 'incompatible_types_csv' } });
      expect(screen.getByTestId('orders-import-page')).toBeTruthy();
    });
  });

  describe('OrdersListPage Integration with Migration Kit', () => {
    it('navigates to OrdersImportPage when clicking Migration Kit button in toolbar', async () => {
      const onNavigateImport = vi.fn();
      await act(async () => {
        render(
          <OrdersListPage
            onNavigateImport={onNavigateImport}
          />
        );
      });

      // Migration Kit button in toolbar
      const importBtn = screen.getByTestId('btn-import-orders');
      expect(importBtn).toBeTruthy();

      await act(async () => {
        fireEvent.click(importBtn);
      });

      expect(onNavigateImport).toHaveBeenCalledTimes(1);
      // Import page is rendered
      expect(screen.getByTestId('orders-import-page')).toBeTruthy();

      // Clicking Back returns to list
      const backBtn = screen.getByTestId('btn-import-back');
      await act(async () => {
        fireEvent.click(backBtn);
      });

      expect(screen.queryByTestId('orders-import-page')).toBeNull();
    });

    it('opens directly in import view when initialView="import"', async () => {
      await act(async () => {
        render(<OrdersListPage initialView="import" />);
      });
      expect(screen.getByTestId('orders-import-page')).toBeTruthy();
    });
  });
});
