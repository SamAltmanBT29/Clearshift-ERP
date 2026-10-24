/**
 * ERP-3 Sales Orders & Invoices — Migration Kit Import Page (H2 / ERP3-22)
 *
 * Dedicated route page at `/erp3/import` binding the shared MigrationKitWizard
 * to ERP-3's target schema metadata.
 *
 * Provides:
 * - Pre-bound ERP-3 metadata (sales_orders, so_lines, invoices, invoice_lines)
 * - Source CSV column presets (standard valid orders, dirty pack with type incompatibilities, missing required)
 * - Navigation return to orders list
 *
 * @module erp3/web/pages/OrdersImportPage
 */

import React, { useState } from 'react';
import { MigrationKitWizard, type SourceColumnInfo } from '@cs/ui';
import { erp3WebKitMetadata } from '../kit-metadata.js';

// Pre-defined synthetic source column presets for testing & migration staging
export const SYNTHETIC_ORDER_SOURCE_PRESETS: Record<
  string,
  { label: string; columns: SourceColumnInfo[] }
> = {
  standard_csv: {
    label: 'Standard Sales Orders CSV (Valid Types)',
    columns: [
      { name: 'order_number', inferredType: 'string', sampleValues: ['SO-2026-1001', 'SO-2026-1002'] },
      { name: 'customer_golden_id', inferredType: 'uuid', sampleValues: ['55555555-0003-4000-8000-000000000001'] },
      { name: 'order_date', inferredType: 'date', sampleValues: ['2026-10-24', '2026-10-25'] },
      { name: 'currency', inferredType: 'string', sampleValues: ['USD', 'EUR'] },
      { name: 'status', inferredType: 'string', sampleValues: ['Open', 'Invoiced'] },
      { name: 'customer_email', inferredType: 'string', sampleValues: ['ops@acme.synthetic'] },
      { name: 'customer_phone', inferredType: 'string', sampleValues: ['+1-555-0199'] },
      { name: 'notes', inferredType: 'string', sampleValues: ['Priority shipment'] },
      { name: 'source_system', inferredType: 'string', sampleValues: ['LEGACY_ERP'] },
      { name: 'source_id', inferredType: 'string', sampleValues: ['LEG-ORD-101'] },
    ],
  },
  incompatible_types_csv: {
    label: 'Dirty Data Pack (Incompatible Types: date -> quantity, bool -> status)',
    columns: [
      { name: 'order_number', inferredType: 'string', sampleValues: ['SO-2026-9001'] },
      { name: 'customer_golden_id', inferredType: 'uuid', sampleValues: ['55555555-0003-4000-8000-000000000001'] },
      { name: 'order_date', inferredType: 'date', sampleValues: ['2026-10-24'] },
      { name: 'currency', inferredType: 'string', sampleValues: ['USD'] },
      { name: 'is_active', inferredType: 'boolean', sampleValues: ['true', 'false'] }, // Incompatible with enum status
    ],
  },
  incomplete_csv: {
    label: 'Incomplete CSV (Missing Order Number and Customer Golden ID)',
    columns: [
      { name: 'order_date', inferredType: 'date', sampleValues: ['2026-10-24'] },
      { name: 'currency', inferredType: 'string', sampleValues: ['USD'] },
      { name: 'notes', inferredType: 'string', sampleValues: ['Incomplete order draft'] },
    ],
  },
};

export interface OrdersImportPageProps {
  readonly onNavigateBack?: () => void;
  readonly initialPresetKey?: keyof typeof SYNTHETIC_ORDER_SOURCE_PRESETS;
  readonly onProceedDryRun?: (mapping: Record<string, string>, entityName: string) => void;
  readonly onProceedLoad?: (mapping: Record<string, string>, entityName: string) => void;
}

export const OrdersImportPage: React.FC<OrdersImportPageProps> = ({
  onNavigateBack,
  initialPresetKey = 'standard_csv',
  onProceedDryRun,
  onProceedLoad,
}) => {
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>(initialPresetKey);
  const activePreset =
    SYNTHETIC_ORDER_SOURCE_PRESETS[selectedPresetKey] ||
    SYNTHETIC_ORDER_SOURCE_PRESETS['standard_csv']!;

  return (
    <div className="cs-module-root space-y-6" data-testid="orders-import-page">
      {/* Page Header */}
      <div className="cs-detail-header" style={{ marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            {onNavigateBack && (
              <button
                type="button"
                onClick={onNavigateBack}
                data-testid="btn-import-back"
                className="cs-btn-back"
              >
                ← Back to Sales Orders
              </button>
            )}
            <span
              className="cs-mono"
              style={{
                fontSize: '12px',
                padding: '2px 8px',
                borderRadius: '4px',
                background: 'var(--color-surface)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Route: /erp3/import
            </span>
          </div>
          <h1 className="cs-page-title">Sales Orders & Invoices Migration Wizard</h1>
          <p className="cs-page-description">
            Load legacy orders, line items, and invoices into ClearShift ERP-3 through the shared
            Migration Kit.
          </p>
        </div>

        {/* Action Controls: Preset selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'var(--color-surface)',
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <label
              htmlFor="source-preset-select"
              style={{ fontSize: '12px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}
            >
              Simulate File:
            </label>
            <select
              id="source-preset-select"
              data-testid="select-source-preset"
              value={selectedPresetKey}
              onChange={(e) => setSelectedPresetKey(e.target.value)}
              className="cs-select"
              style={{ fontSize: '12px', padding: '4px 8px' }}
            >
              {Object.entries(SYNTHETIC_ORDER_SOURCE_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Embedded Shared Migration Kit Wizard Pre-Bound to ERP-3 (AC 1 & H2) */}
      <MigrationKitWizard
        key={selectedPresetKey}
        metadata={erp3WebKitMetadata}
        initialEntity="sales_orders"
        sourceColumns={activePreset.columns}
        onProceedDryRun={onProceedDryRun}
        onProceedLoad={onProceedLoad}
      />
    </div>
  );
};

export default OrdersImportPage;
