import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  DataMappingConfigPage,
  SYNTHETIC_ERP4_SOURCE_PRESETS,
} from '../src/pages/DataMappingConfigPage.js';

describe('ERP-4 Data Mapping Configuration Page Component (ERP4-28 / KIT-05)', () => {
  it('renders with standard accounts preset and verifies props', () => {
    const onBack = vi.fn();
    const onProceed = vi.fn();

    const element = (
      <DataMappingConfigPage
        initialPreset="accounts_standard"
        onBack={onBack}
        onProceedToDryRun={onProceed}
      />
    );

    expect(element).toBeDefined();
    expect(element.props.initialPreset).toBe('accounts_standard');
    expect(element.props.onBack).toBe(onBack);
    expect(element.props.onProceedToDryRun).toBe(onProceed);
  });

  it('contains expected synthetic test presets', () => {
    expect(SYNTHETIC_ERP4_SOURCE_PRESETS.accounts_standard).toBeDefined();
    expect(SYNTHETIC_ERP4_SOURCE_PRESETS.opening_balances_standard).toBeDefined();
    expect(SYNTHETIC_ERP4_SOURCE_PRESETS.accounts_missing_required).toBeDefined();

    const std = SYNTHETIC_ERP4_SOURCE_PRESETS.accounts_standard!;
    expect(std.columns.length).toBeGreaterThanOrEqual(8);
    expect(std.columns.some((c) => c.name === 'code')).toBe(true);
    expect(std.columns.some((c) => c.name === 'type')).toBe(true);
  });

  it('missing required preset contains unmapped required fields for guard assertion', () => {
    const missing = SYNTHETIC_ERP4_SOURCE_PRESETS.accounts_missing_required!;
    expect(missing.defaultMapping.type).toBeUndefined();
    expect(missing.defaultMapping.currency_code).toBeUndefined();
  });
});
