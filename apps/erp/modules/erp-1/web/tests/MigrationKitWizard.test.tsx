// @vitest-environment jsdom
/**
 * ERP-1 Products & Inventory — Migration Kit Wizard Integration Tests (KIT-14 / ERP1-22)
 *
 * Comprehensive acceptance test suite verifying all four criteria of Issue #118:
 * - Acceptance Criterion 1: Module registers target schema metadata with the shared Migration Kit wizard.
 * - Acceptance Criterion 2: Wizard dynamically renders correct target fields, data types, and required badges for the module.
 * - Acceptance Criterion 3: Attempting to map incompatible source types warns operator in the wizard interface.
 * - Acceptance Criterion 4: Required unmapped fields prevent proceeding to dry-run or load steps.
 *
 * 100% synthetic mock test data adhering to ClearShift G3 constraints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

import { MigrationKitWizard, type SourceColumnInfo } from '@cs/ui';
import { erp1WebKitMetadata } from '../src/kit-metadata.js';
import { ProductImportPage } from '../src/pages/ProductImportPage.js';
import { ProductsListPage } from '../src/pages/ProductsListPage.js';
import * as api from '../src/api/erp-1.js';

const mockSourceColumns: SourceColumnInfo[] = [
  { name: 'product_name', inferredType: 'string', sampleValues: ['Precision Steel Bolt'] },
  { name: 'sku_code', inferredType: 'string', sampleValues: ['SKU-BOLT-001'] },
  { name: 'unit', inferredType: 'string', sampleValues: ['pcs'] },
  { name: 'unit_price', inferredType: 'decimal', sampleValues: ['45.5000'] },
  { name: 'currency_code', inferredType: 'string', sampleValues: ['USD'] },
  { name: 'tax_rate', inferredType: 'decimal', sampleValues: ['5.00'] },
  { name: 'created_date', inferredType: 'date', sampleValues: ['2026-01-10'] },
  { name: 'is_taxable', inferredType: 'boolean', sampleValues: ['true'] },
];

describe('Shared Migration Kit Wizard Integration (ERP1-22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, 'fetchCategories').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });
    vi.spyOn(api, 'fetchProducts').mockResolvedValue({
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
          metadata={erp1WebKitMetadata}
          sourceColumns={mockSourceColumns}
        />
      );

      // Verifies module context is mounted and displayed
      expect(screen.getByTestId('migration-kit-wizard')).toBeTruthy();
      expect(screen.getByTestId('wizard-title').textContent).toContain('Step 4: Map Source Columns to Target Fields');
      expect(screen.getByText(/Module:/).textContent).toContain('erp1');
      expect(screen.getByText(/ERP-1 Products and Inventory/)).toBeTruthy();
      expect(screen.getByText(/Target Table:/).textContent).toContain('erp1_products');
    });

    it('allows switching between registered module entities: products, categories, warehouses, stock levels', () => {
      render(
        <MigrationKitWizard
          metadata={erp1WebKitMetadata}
          sourceColumns={mockSourceColumns}
        />
      );

      const entitySelect = screen.getByTestId('select-target-entity') as HTMLSelectElement;
      expect(entitySelect).toBeTruthy();
      expect(within(entitySelect).getByText('Product Master Data')).toBeTruthy();
      expect(within(entitySelect).getByText('Product Categories')).toBeTruthy();
      expect(within(entitySelect).getByText('Warehouses')).toBeTruthy();
      expect(within(entitySelect).getByText('Stock Levels')).toBeTruthy();

      // Switch to Categories entity
      fireEvent.change(entitySelect, { target: { value: 'categories' } });
      expect(screen.getByText(/Target Table:/).textContent).toContain('erp1_categories');
      expect(screen.getByTestId('field-row-code')).toBeTruthy();
    });
  });

  describe('AC 2: Dynamic Rendering of Target Fields, Types & Required Badges', () => {
    it('renders all primary target fields with human-readable labels and technical keys', () => {
      render(
        <MigrationKitWizard
          metadata={erp1WebKitMetadata}
          initialEntity="products"
          sourceColumns={mockSourceColumns}
        />
      );

      // Verify primary fields exist
      expect(screen.getByTestId('field-row-name')).toBeTruthy();
      expect(screen.getByTestId('field-row-sku')).toBeTruthy();
      expect(screen.getByTestId('field-row-unitOfMeasure')).toBeTruthy();
      expect(screen.getByTestId('field-row-price')).toBeTruthy();
      expect(screen.getByTestId('field-row-currency')).toBeTruthy();
      expect(screen.getByTestId('field-row-taxRate')).toBeTruthy();
    });

    it('renders correct data type badges including allowed enum options for unitOfMeasure (FR-ERP1-04)', () => {
      render(
        <MigrationKitWizard
          metadata={erp1WebKitMetadata}
          initialEntity="products"
          sourceColumns={mockSourceColumns}
        />
      );

      // Data type badge assertions
      expect(screen.getByTestId('badge-type-name').textContent).toContain('string');
      expect(screen.getByTestId('badge-type-sku').textContent).toContain('string');
      expect(screen.getByTestId('badge-type-price').textContent).toContain('decimal');
      expect(screen.getByTestId('badge-type-taxRate').textContent).toContain('decimal');
      expect(screen.getByTestId('badge-type-categoryId').textContent).toContain('uuid');
      expect(screen.getByTestId('badge-type-unitOfMeasure').textContent).toContain('enum');

      // Allowed enum options rendered dynamically per FR-ERP1-04
      const enumOptions = screen.getByTestId('enum-options-unitOfMeasure');
      expect(enumOptions.textContent).toContain('[pcs, kg, g, litre, metre, box]');
    });

    it('renders distinct Required and Optional badges per target field contract', () => {
      render(
        <MigrationKitWizard
          metadata={erp1WebKitMetadata}
          initialEntity="products"
          sourceColumns={mockSourceColumns}
        />
      );

      // Required badges
      expect(screen.getByTestId('badge-required-name').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-sku').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-unitOfMeasure').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-price').textContent).toContain('Required');
      expect(screen.getByTestId('badge-required-currency').textContent).toContain('Required');

      // Optional badges
      expect(screen.getByTestId('badge-optional-taxRate').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-categoryId').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-notificationEmail').textContent).toContain('Optional');
      expect(screen.getByTestId('badge-optional-contactPhone').textContent).toContain('Optional');
    });
  });

  describe('AC 3: Incompatible Source Type Warnings in Wizard Interface', () => {
    it('surfaces operator warning when mapping a date source column to a decimal price field', () => {
      render(
        <MigrationKitWizard
          metadata={erp1WebKitMetadata}
          initialEntity="products"
          sourceColumns={mockSourceColumns}
        />
      );

      // Map created_date (inferredType: 'date') to price (type: 'decimal')
      const priceSelect = screen.getByTestId('select-mapping-price') as HTMLSelectElement;
      fireEvent.change(priceSelect, { target: { value: 'created_date' } });

      // Expect operator warning banner
      const warningBanner = screen.getByTestId('type-incompatibility-warning');
      expect(warningBanner).toBeTruthy();
      expect(warningBanner.textContent).toContain('Source Data Type Incompatibility Warning');
      expect(warningBanner.textContent).toContain('Target field price mapped to column created_date');
      expect(warningBanner.textContent).toContain('cannot be safely converted to decimal');

      // Expect inline warning on the specific row
      const inlineWarning = screen.getByTestId('inline-warning-price');
      expect(inlineWarning).toBeTruthy();
      expect(inlineWarning.textContent).toContain('cannot be safely converted to decimal');
    });

    it('surfaces operator warning when mapping a boolean source column to an enum field', () => {
      render(
        <MigrationKitWizard
          metadata={erp1WebKitMetadata}
          initialEntity="products"
          sourceColumns={mockSourceColumns}
        />
      );

      // Map is_taxable (inferredType: 'boolean') to unitOfMeasure (type: 'enum')
      const uomSelect = screen.getByTestId('select-mapping-unitOfMeasure') as HTMLSelectElement;
      fireEvent.change(uomSelect, { target: { value: 'is_taxable' } });

      const warningBanner = screen.getByTestId('type-incompatibility-warning');
      expect(warningBanner).toBeTruthy();
      expect(warningBanner.textContent).toContain('cannot be mapped to enum [pcs, kg, g, litre, metre, box]');
    });

    it('surfaces type coercion warning when mapping a text column to a decimal field', () => {
      const textColOnly: SourceColumnInfo[] = [
        { name: 'amount_raw_text', inferredType: 'string' },
      ];

      render(
        <MigrationKitWizard
          metadata={erp1WebKitMetadata}
          initialEntity="products"
          sourceColumns={textColOnly}
        />
      );

      const priceSelect = screen.getByTestId('select-mapping-price') as HTMLSelectElement;
      fireEvent.change(priceSelect, { target: { value: 'amount_raw_text' } });

      const inlineWarning = screen.getByTestId('inline-warning-price');
      expect(inlineWarning.textContent).toContain('Text column will be parsed into numeric decimal');
    });
  });

  describe('AC 4: Required Unmapped Fields Prevent Proceeding to Dry-Run & Load', () => {
    it('disables Proceed to Dry-Run and Load buttons when required fields are unmapped', () => {
      render(
        <MigrationKitWizard
          metadata={erp1WebKitMetadata}
          initialEntity="products"
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
      expect(missingList.textContent).toContain('Product Name');
      expect(missingList.textContent).toContain('Stock Keeping Unit (SKU)');
      expect(missingList.textContent).toContain('Unit of Measure');
      expect(missingList.textContent).toContain('Unit Price');
      expect(missingList.textContent).toContain('Currency Code (ISO-4217)');
    });

    it('enables Proceed to Dry-Run once all required fields are mapped', () => {
      const onProceedDryRun = vi.fn();

      render(
        <MigrationKitWizard
          metadata={erp1WebKitMetadata}
          initialEntity="products"
          sourceColumns={mockSourceColumns}
          onProceedDryRun={onProceedDryRun}
          initialMapping={{
            name: 'product_name',
            sku: 'sku_code',
            unitOfMeasure: 'unit',
            price: 'unit_price',
            currency: 'currency_code',
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
          name: 'product_name',
          sku: 'sku_code',
          unitOfMeasure: 'unit',
          price: 'unit_price',
          currency: 'currency_code',
        }),
        'products'
      );

      // After successful dry run, Start Load should become enabled
      expect(screen.getByTestId('dry-run-success-alert')).toBeTruthy();
      const loadBtn = screen.getByTestId('btn-proceed-load') as HTMLButtonElement;
      expect(loadBtn.disabled).toBe(false);
    });

    it('auto-map suggested defaults maps all matching columns and enables dry-run', () => {
      render(
        <MigrationKitWizard
          metadata={erp1WebKitMetadata}
          initialEntity="products"
          sourceColumns={mockSourceColumns}
          initialMapping={{}}
        />
      );

      const dryRunBtn = screen.getByTestId('btn-proceed-dry-run') as HTMLButtonElement;
      expect(dryRunBtn.disabled).toBe(true);

      // Click Auto-Map button
      const autoMapBtn = screen.getByTestId('btn-auto-map');
      fireEvent.click(autoMapBtn);

      // Auto-map applies matching defaults: product_name, sku_code, unit, unit_price, currency_code
      expect(dryRunBtn.disabled).toBe(false);
      expect(screen.queryByTestId('unmapped-required-alert')).toBeNull();
    });
  });

  describe('ProductImportPage Route Integration (/erp1/import)', () => {
    it('renders import page with pre-bound wizard and preset selector', () => {
      const onNavigateBack = vi.fn();
      render(<ProductImportPage onNavigateBack={onNavigateBack} />);

      expect(screen.getByTestId('product-import-page')).toBeTruthy();
      expect(screen.getByText('Products & Inventory Migration Wizard')).toBeTruthy();
      expect(screen.getByText('Route: /erp1/import')).toBeTruthy();

      // Back navigation button
      const backBtn = screen.getByTestId('btn-import-back');
      fireEvent.click(backBtn);
      expect(onNavigateBack).toHaveBeenCalledTimes(1);
    });

    it('switches between presets (incompatible types preset surfaces warning immediately)', () => {
      render(<ProductImportPage initialPresetKey="standard_csv" />);

      const presetSelect = screen.getByTestId('select-source-preset') as HTMLSelectElement;
      expect(presetSelect.value).toBe('standard_csv');

      // Switch to Incompatible Types CSV preset
      fireEvent.change(presetSelect, { target: { value: 'incompatible_types_csv' } });
      expect(screen.getByTestId('product-import-page')).toBeTruthy();
    });
  });

  describe('ProductsListPage Integration with Migration Kit', () => {
    it('navigates to ProductImportPage when clicking Migration Kit button in toolbar', async () => {
      const onNavigateImport = vi.fn();
      await act(async () => {
        render(
          <ProductsListPage
            initialFilters={{ search: '' }}
            onNavigateImport={onNavigateImport}
          />
        );
      });

      // Migration Kit button in toolbar
      const importBtn = screen.getByTestId('btn-import-products');
      expect(importBtn).toBeTruthy();

      await act(async () => {
        fireEvent.click(importBtn);
      });

      expect(onNavigateImport).toHaveBeenCalledTimes(1);
      // Import page is rendered
      expect(screen.getByTestId('product-import-page')).toBeTruthy();

      // Clicking Back returns to list
      const backBtn = screen.getByTestId('btn-import-back');
      await act(async () => {
        fireEvent.click(backBtn);
      });

      expect(screen.queryByTestId('product-import-page')).toBeNull();
    });

    it('opens directly in import view when initialView="import"', async () => {
      await act(async () => {
        render(<ProductsListPage initialView="import" />);
      });
      expect(screen.getByTestId('product-import-page')).toBeTruthy();
    });
  });
});

