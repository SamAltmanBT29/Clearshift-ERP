import { describe, it, expect } from 'vitest';
import { ValueConverter } from '../../src/mapping/value-converter.js';
import { CRM_CONTACTS_TARGET_FIELDS, CRM_LEADS_TARGET_FIELDS } from '@clearshift/contracts';

describe('KIT-05: Value Converter & Enum Validation', () => {
  it('converts old values to new values directly', () => {
    const converter = new ValueConverter(
      [
        {
          targetField: 'leadStatus',
          mappings: {
            WON: 'Qualified',
            LOST: 'Closed',
            NEW_LEAD: 'New',
          },
          unmappedAction: 'reject',
        },
      ],
      CRM_LEADS_TARGET_FIELDS
    );

    const res1 = converter.convert('leadStatus', 'WON');
    expect(res1.outcome).toBe('converted');
    expect(res1.value).toBe('Qualified');

    const res2 = converter.convert('leadStatus', 'LOST');
    expect(res2.outcome).toBe('converted');
    expect(res2.value).toBe('Closed');
  });

  it('matches old values case-insensitively', () => {
    const converter = new ValueConverter(
      [
        {
          targetField: 'leadStatus',
          mappings: {
            won: 'Qualified',
          },
          unmappedAction: 'reject',
        },
      ],
      CRM_LEADS_TARGET_FIELDS
    );

    const res = converter.convert('leadStatus', 'WON');
    expect(res.outcome).toBe('converted');
    expect(res.value).toBe('Qualified');
  });

  it('rejects unmapped values when action is "reject"', () => {
    const converter = new ValueConverter(
      [
        {
          targetField: 'leadStatus',
          mappings: {
            WON: 'Qualified',
          },
          unmappedAction: 'reject',
        },
      ],
      CRM_LEADS_TARGET_FIELDS
    );

    const res = converter.convert('leadStatus', 'STRANGE_STATUS');
    expect(res.outcome).toBe('rejected');
    expect(res.rejectReason).toContain("has no valid conversion mapping");
  });

  it('falls back to default when unmappedAction is "use_default"', () => {
    const converter = new ValueConverter(
      [
        {
          targetField: 'leadStatus',
          mappings: {
            WON: 'Qualified',
          },
          unmappedAction: 'use_default',
          defaultValue: 'New',
        },
      ],
      CRM_LEADS_TARGET_FIELDS
    );

    const res = converter.convert('leadStatus', 'UNKNOWN');
    expect(res.outcome).toBe('converted');
    expect(res.value).toBe('New');
  });

  it('flags warning when unmappedAction is "flag_warning" on optional fields', () => {
    const converter = new ValueConverter(
      [
        {
          targetField: 'country',
          mappings: {
            US: 'United States',
          },
          unmappedAction: 'flag_warning',
        },
      ],
      CRM_CONTACTS_TARGET_FIELDS
    );

    const res = converter.convert('country', 'Germany');
    expect(res.outcome).toBe('warning');
    expect(res.value).toBe('Germany');
    expect(res.warning).toContain("kept without conversion");
  });

  it('normalizes case for target enum values', () => {
    const converter = new ValueConverter(
      [],
      CRM_LEADS_TARGET_FIELDS // allowed: ['New', 'Working', 'Qualified', 'Closed']
    );

    const res = converter.convert('leadStatus', 'new');
    expect(res.outcome).toBe('converted');
    expect(res.value).toBe('New');
  });

  it('rejects disallowed enum values on required enum fields', () => {
    const converter = new ValueConverter(
      [],
      CRM_LEADS_TARGET_FIELDS // leadStatus is required enum
    );

    const res = converter.convert('leadStatus', 'InvalidLifecycleState');
    expect(res.outcome).toBe('rejected');
    expect(res.rejectReason).toContain("is not in allowed values: [New, Working, Qualified, Closed]");
  });
});
