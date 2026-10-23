/**
 * ERP-1 Products & Inventory — Migration Kit Import Page (H2 / ERP1-22)
 *
 * Dedicated route page at `/erp1/import` binding the shared MigrationKitWizard
 * to ERP-1's target schema metadata.
 *
 * Provides:
 * - Pre-bound ERP-1 metadata (products, categories, warehouses, stock levels)
 * - Source CSV column presets (standard valid catalog, dirty pack with type incompatibilities, missing required)
 * - Navigation return to products list
 *
 * @module erp1/web/pages/ProductImportPage
 */

import React, { useState } from 'react';
import { MigrationKitWizard, type SourceColumnInfo } from '@cs/ui';
import { erp1WebKitMetadata } from '../kit-metadata.js';

// Pre-defined synthetic source column presets for testing & migration staging
export const SYNTHETIC_SOURCE_PRESETS: Record<string, { label: string; columns: SourceColumnInfo[] }> = {
  standard_csv: {
    label: 'Standard Catalog CSV (Valid Types)',
    columns: [
      { name: 'product_name', inferredType: 'string', sampleValues: ['Deep Groove Bearing', 'Linear Guide Rail'] },
      { name: 'sku_code', inferredType: 'string', sampleValues: ['BRG-6204', 'LGR-15-500'] },
      { name: 'unit', inferredType: 'string', sampleValues: ['pcs', 'box'] },
      { name: 'unit_price', inferredType: 'decimal', sampleValues: ['24.5000', '110.0000'] },
      { name: 'currency_code', inferredType: 'string', sampleValues: ['USD', 'EUR'] },
      { name: 'tax_rate', inferredType: 'decimal', sampleValues: ['18.00', '5.00'] },
      { name: 'email', inferredType: 'string', sampleValues: ['supply@clearshift.synthetic'] },
      { name: 'phone', inferredType: 'string', sampleValues: ['+1-555-0144'] },
      { name: 'legacy_id', inferredType: 'string', sampleValues: ['LEG-001', 'LEG-002'] },
      { name: 'source_system', inferredType: 'string', sampleValues: ['SAP_R3', 'NAV_2018'] },
    ],
  },
  incompatible_types_csv: {
    label: 'Dirty Data Pack (Incompatible Types: date -> price, bool -> unit)',
    columns: [
      { name: 'product_name', inferredType: 'string', sampleValues: ['Rotary Shaft'] },
      { name: 'sku_code', inferredType: 'string', sampleValues: ['SFT-20-300'] },
      { name: 'is_taxable', inferredType: 'boolean', sampleValues: ['true', 'false'] }, // Incompatible with unitOfMeasure (enum)
      { name: 'created_date', inferredType: 'date', sampleValues: ['2026-03-15'] }, // Incompatible with price (decimal)
      { name: 'currency_code', inferredType: 'string', sampleValues: ['USD'] },
    ],
  },
  incomplete_csv: {
    label: 'Incomplete CSV (Missing SKU and Price)',
    columns: [
      { name: 'product_name', inferredType: 'string', sampleValues: ['Mystery Product'] },
      { name: 'unit', inferredType: 'string', sampleValues: ['pcs'] },
      { name: 'currency_code', inferredType: 'string', sampleValues: ['USD'] },
    ],
  },
};

import { ProductRejectionReviewPage } from './ProductRejectionReviewPage.js';

export interface ProductImportPageProps {
  readonly onNavigateBack?: () => void;
  readonly initialPresetKey?: keyof typeof SYNTHETIC_SOURCE_PRESETS;
  readonly onProceedDryRun?: (mapping: Record<string, string>, entityName: string) => void;
  readonly onProceedLoad?: (mapping: Record<string, string>, entityName: string) => void;
  readonly onNavigateToRejections?: () => void;
  readonly initialView?: 'wizard' | 'rejections';
}

export const ProductImportPage: React.FC<ProductImportPageProps> = ({
  onNavigateBack,
  initialPresetKey = 'standard_csv',
  onProceedDryRun,
  onProceedLoad,
  onNavigateToRejections,
  initialView = 'wizard',
}) => {
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>(initialPresetKey);
  const [isRejectionsView, setIsRejectionsView] = useState<boolean>(initialView === 'rejections');
  const activePreset = SYNTHETIC_SOURCE_PRESETS[selectedPresetKey] || SYNTHETIC_SOURCE_PRESETS['standard_csv']!;

  if (isRejectionsView) {
    return (
      <ProductRejectionReviewPage
        onNavigateBack={() => setIsRejectionsView(false)}
        onNavigateToImport={() => setIsRejectionsView(false)}
      />
    );
  }

  return (
    <div className="cs-product-import-page space-y-6" data-testid="product-import-page">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--cs-border)]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {onNavigateBack && (
              <button
                type="button"
                onClick={onNavigateBack}
                data-testid="btn-import-back"
                className="text-xs px-2.5 py-1 rounded border border-[var(--cs-border)] bg-[var(--cs-surface)] hover:bg-[var(--cs-bg)] text-[var(--cs-text)] transition flex items-center gap-1"
              >
                ← Back to Products
              </button>
            )}
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--cs-surface)] text-[var(--cs-accent)] border border-[var(--cs-border)]">
              Route: /erp1/import
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--cs-text)]">
            Products & Inventory Migration Wizard
          </h1>
          <p className="text-sm text-[var(--cs-text-muted)] mt-1">
            Load legacy catalog, categories, warehouses, and opening stock into ClearShift ERP-1 through the shared Migration Kit.
          </p>
        </div>

        {/* Action Controls: Preset selector + Rejections button */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="btn-view-rejections"
            onClick={() => {
              setIsRejectionsView(true);
              onNavigateToRejections?.();
            }}
            className="text-xs font-semibold px-3 py-1.5 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition flex items-center gap-1.5"
            title="Review rejected rows from migration dry runs and loads"
          >
            <span>⚠️</span>
            <span>Review Rejections (5)</span>
          </button>

          <div className="flex items-center gap-2 bg-[var(--cs-surface)] p-2 rounded-md border border-[var(--cs-border)]">
            <label htmlFor="source-preset-select" className="text-xs font-medium text-[var(--cs-text-muted)] whitespace-nowrap">
              Simulate File:
            </label>
            <select
              id="source-preset-select"
              data-testid="select-source-preset"
              value={selectedPresetKey}
              onChange={(e) => setSelectedPresetKey(e.target.value)}
              className="text-xs border border-[var(--cs-border)] bg-[var(--cs-bg)] text-[var(--cs-text)] rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--cs-accent)]"
            >
            {Object.entries(SYNTHETIC_SOURCE_PRESETS).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>

      {/* Embedded Shared Migration Kit Wizard Pre-Bound to ERP-1 (AC 1 & H2) */}
      <MigrationKitWizard
        key={selectedPresetKey}
        metadata={erp1WebKitMetadata}
        initialEntity="products"
        sourceColumns={activePreset.columns}
        onProceedDryRun={onProceedDryRun}
        onProceedLoad={onProceedLoad}
      />
    </div>
  );
};
