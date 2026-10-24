/**
 * ERP-2 Vendors & Purchasing — Migration Kit Import Page (H2 / ERP2-22)
 *
 * Dedicated route page at `/erp2/import` binding the shared MigrationKitWizard
 * to ERP-2's target schema metadata.
 *
 * Provides:
 * - Pre-bound ERP-2 metadata (vendors, purchase_orders, po_lines)
 * - Source CSV column presets (standard valid vendor data, dirty pack with type incompatibilities, missing required)
 * - Navigation return to vendors / purchasing lists
 *
 * @module erp2/web/pages/VendorImportPage
 */

import React, { useState } from 'react';
import { MigrationKitWizard, type SourceColumnInfo } from '@cs/ui';
import { erp2WebKitMetadata } from '../kit-metadata.js';

// Pre-defined synthetic source column presets for testing & migration staging
export const ERP2_SYNTHETIC_SOURCE_PRESETS: Record<
  string,
  { label: string; defaultEntity: string; columns: SourceColumnInfo[] }
> = {
  standard_vendors_csv: {
    label: 'Standard Vendors CSV (Valid Types)',
    defaultEntity: 'vendors',
    columns: [
      { name: 'vendor_name', inferredType: 'string', sampleValues: ['Acme Industrial Parts', 'Apex Dynamics LLC'] },
      { name: 'tax_id', inferredType: 'string', sampleValues: ['TAX-ACM-1001', 'TAX-APX-2002'] },
      { name: 'email', inferredType: 'string', sampleValues: ['supplies@acme.synthetic', 'orders@apex.synthetic'] },
      { name: 'phone', inferredType: 'string', sampleValues: ['+1-555-0101', '+1-555-0102'] },
      { name: 'address', inferredType: 'string', sampleValues: ['100 Industrial Parkway', '200 Supply Loop'] },
      { name: 'city', inferredType: 'string', sampleValues: ['Detroit', 'Chicago'] },
      { name: 'country', inferredType: 'string', sampleValues: ['USA', 'USA'] },
      { name: 'currency', inferredType: 'string', sampleValues: ['USD', 'EUR'] },
      { name: 'bank_account', inferredType: 'string', sampleValues: ['XXXX-XXXX-1234', 'XXXX-XXXX-5678'] },
      { name: 'source_system', inferredType: 'string', sampleValues: ['SAP_ECC', 'NAV_2018'] },
      { name: 'source_id', inferredType: 'string', sampleValues: ['V-101', 'V-102'] },
    ],
  },
  standard_purchase_orders_csv: {
    label: 'Standard Purchase Orders CSV (Valid Types)',
    defaultEntity: 'purchase_orders',
    columns: [
      { name: 'po_number', inferredType: 'string', sampleValues: ['PO-2026-0001', 'PO-2026-0002'] },
      { name: 'vendor_id', inferredType: 'uuid', sampleValues: ['a1111111-1111-4111-8111-111111111111'] },
      { name: 'order_date', inferredType: 'date', sampleValues: ['2026-03-15', '2026-03-16'] },
      { name: 'status', inferredType: 'string', sampleValues: ['Draft', 'Sent'] },
      { name: 'currency', inferredType: 'string', sampleValues: ['USD', 'USD'] },
      { name: 'total', inferredType: 'decimal', sampleValues: ['1250.50', '3400.00'] },
      { name: 'notes', inferredType: 'string', sampleValues: ['Expedited shipping', 'Standard delivery'] },
      { name: 'source_system', inferredType: 'string', sampleValues: ['NAV_2018'] },
      { name: 'source_id', inferredType: 'string', sampleValues: ['PO-991'] },
    ],
  },
  incompatible_types_csv: {
    label: 'Dirty Data Pack (Incompatible Types: date -> total, boolean -> status)',
    defaultEntity: 'purchase_orders',
    columns: [
      { name: 'po_number', inferredType: 'string', sampleValues: ['PO-DIRTY-001'] },
      { name: 'vendor_id', inferredType: 'uuid', sampleValues: ['a1111111-1111-4111-8111-111111111111'] },
      { name: 'order_date', inferredType: 'date', sampleValues: ['2026-03-15'] },
      { name: 'is_approved', inferredType: 'boolean', sampleValues: ['true', 'false'] }, // Incompatible with enum status
      { name: 'created_date', inferredType: 'date', sampleValues: ['2026-03-15'] }, // Incompatible with decimal total
      { name: 'currency', inferredType: 'string', sampleValues: ['USD'] },
    ],
  },
  incomplete_vendors_csv: {
    label: 'Incomplete Vendors CSV (Missing tax_number & email)',
    defaultEntity: 'vendors',
    columns: [
      { name: 'vendor_name', inferredType: 'string', sampleValues: ['Incomplete Supplies Inc'] },
      { name: 'phone', inferredType: 'string', sampleValues: ['+1-555-9999'] },
      { name: 'city', inferredType: 'string', sampleValues: ['Boston'] },
    ],
  },
};

export interface VendorImportPageProps {
  readonly onNavigateBack?: () => void;
  readonly initialPresetKey?: keyof typeof ERP2_SYNTHETIC_SOURCE_PRESETS;
  readonly onProceedDryRun?: (mapping: Record<string, string>, entityName: string) => void;
  readonly onProceedLoad?: (mapping: Record<string, string>, entityName: string) => void;
  readonly initialEntity?: string;
}

export const VendorImportPage: React.FC<VendorImportPageProps> = ({
  onNavigateBack,
  initialPresetKey = 'standard_vendors_csv',
  onProceedDryRun,
  onProceedLoad,
  initialEntity,
}) => {
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>(initialPresetKey);
  const activePreset =
    ERP2_SYNTHETIC_SOURCE_PRESETS[selectedPresetKey] ||
    ERP2_SYNTHETIC_SOURCE_PRESETS['standard_vendors_csv']!;

  const resolvedEntity = initialEntity || activePreset.defaultEntity;

  return (
    <div className="cs-vendor-import-page space-y-6 p-6" data-testid="vendor-import-page">
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
                ← Back
              </button>
            )}
            <h1 className="text-xl font-bold tracking-tight text-[var(--cs-text)]" data-testid="page-heading">
              ERP-2 Data Import &amp; Field Mapping
            </h1>
          </div>
          <p className="text-sm text-[var(--cs-text-muted)]">
            Configure column mappings for ERP-2 Vendors, Purchase Orders, and Lines using the shared Migration Kit wizard.
          </p>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="select-import-preset" className="text-xs font-semibold text-[var(--cs-text-muted)] whitespace-nowrap">
            Synthetic Source Preset:
          </label>
          <select
            id="select-import-preset"
            data-testid="preset-selector"
            value={selectedPresetKey}
            onChange={(e) => setSelectedPresetKey(e.target.value)}
            className="text-xs px-3 py-1.5 rounded border border-[var(--cs-border)] bg-[var(--cs-surface)] text-[var(--cs-text)] font-medium focus:outline-none focus:ring-1 focus:ring-[var(--cs-primary)]"
          >
            {Object.entries(ERP2_SYNTHETIC_SOURCE_PRESETS).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Preset Information Banner */}
      <div className="bg-[var(--cs-surface-subtle,#f8fafc)] border border-[var(--cs-border)] rounded-md p-3 text-xs text-[var(--cs-text-muted)] flex items-center justify-between">
        <div>
          <span className="font-semibold text-[var(--cs-text)]">Active Source Dataset:</span>{' '}
          {activePreset.label} ({activePreset.columns.length} columns detected: {activePreset.columns.map((c) => c.name).join(', ')})
        </div>
        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          Module: erp2
        </span>
      </div>

      {/* Shared Migration Kit Wizard Instance */}
      <MigrationKitWizard
        key={`${selectedPresetKey}-${resolvedEntity}`}
        metadata={erp2WebKitMetadata}
        initialEntity={resolvedEntity}
        sourceColumns={activePreset.columns}
        onProceedDryRun={onProceedDryRun}
        onProceedLoad={onProceedLoad}
      />
    </div>
  );
};
