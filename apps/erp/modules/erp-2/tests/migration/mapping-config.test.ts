import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MappingValidationError,
  assertDryRunReady,
  coerceValue,
  dryRun,
  mapRow,
  roundDecimalHalfUp,
  templateFingerprint,
  templateId,
  translateEnum,
  validateAgainstHeaders,
  validateTemplate,
  type MappingTemplate,
} from '../../src/migration/mapping-config';

const pack = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../../sample-data/erp-2/mapping-template.json'), 'utf8'),
) as { templates: MappingTemplate[] };

function get(entity: MappingTemplate['entity']): MappingTemplate {
  const t = pack.templates.find((x) => x.entity === entity);
  if (t === undefined) throw new Error(`missing template ${entity}`);
  return t;
}
const clone = (t: MappingTemplate): MappingTemplate => JSON.parse(JSON.stringify(t)) as MappingTemplate;

describe('shipped templates', () => {
  it('are valid, named and semver-versioned', () => {
    for (const t of pack.templates) {
      expect(validateTemplate(t)).toEqual([]);
      expect(templateId(t)).toMatch(/^erp2-[a-z-]+@\d+\.\d+\.\d+$/);
    }
  });
  it('fingerprint is reproducible and key-order independent', () => {
    const t = get('vendors');
    expect(templateFingerprint(t)).toBe(templateFingerprint(clone(t)));
    const reordered = JSON.parse(JSON.stringify({ fields: t.fields, enumTranslations: t.enumTranslations, entity: t.entity, version: t.version, name: t.name })) as MappingTemplate;
    expect(templateFingerprint(reordered)).toBe(templateFingerprint(t));
  });
  it('fingerprint changes when content changes', () => {
    const t = clone(get('vendors'));
    const before = templateFingerprint(t);
    t.version = '1.0.1';
    expect(templateFingerprint(t)).not.toBe(before);
  });
});

describe('required target guards', () => {
  it('blocks when a required target is unmapped', () => {
    const t = clone(get('purchase_orders'));
    const bad = { ...t, fields: t.fields.filter((f) => f.target !== 'order_date') };
    expect(validateTemplate(bad).some((i) => i.code === 'UNMAPPED_REQUIRED_TARGET' && i.target === 'order_date')).toBe(true);
    expect(() => assertDryRunReady(bad, ['PO Number'])).toThrow(MappingValidationError);
  });
  it('blocks when a required target is mapped as optional', () => {
    const t = clone(get('vendors'));
    const bad: MappingTemplate = { ...t, fields: t.fields.map((f) => (f.target === 'name' ? { ...f, required: false } : f)) };
    expect(validateTemplate(bad).map((i) => i.target)).toContain('name');
  });
  it('blocks when a required source column is missing from the file', () => {
    const t = get('vendors');
    const headers = ['Vendor Code', 'Vendor Name'];
    const issues = validateAgainstHeaders(t, headers);
    expect(issues.some((i) => i.code === 'MISSING_SOURCE_COLUMN' && i.source === 'Status')).toBe(true);
  });
  it('error converts to the standard envelope with HTTP 400', () => {
    const t = clone(get('vendors'));
    const bad = { ...t, fields: [] };
    try {
      assertDryRunReady(bad, []);
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as MappingValidationError;
      expect(err.httpStatus).toBe(400);
      const env = err.toEnvelope();
      expect(env.code).toBe('MAPPING_VALIDATION_FAILED');
      expect(env.details).toHaveProperty('issues');
    }
  });
  it('dry-run does not process rows when guard fails', () => {
    const t = get('po_lines');
    expect(() => dryRun(t, ['PO Number'], [{ 'PO Number': 'PO-1' }])).toThrow(MappingValidationError);
  });
});

describe('template structure checks', () => {
  it('flags duplicate targets and sources', () => {
    const t = clone(get('vendors'));
    const first = t.fields[0];
    if (first === undefined) throw new Error('no field');
    const bad = { ...t, fields: [...t.fields, { ...first }] };
    const codes = validateTemplate(bad).map((i) => i.code);
    expect(codes).toContain('DUPLICATE_TARGET');
    expect(codes).toContain('DUPLICATE_SOURCE');
  });
  it('flags bad meta', () => {
    const t = clone(get('vendors'));
    expect(validateTemplate({ ...t, version: 'v1' }).map((i) => i.code)).toContain('INVALID_TEMPLATE_META');
    expect(validateTemplate({ ...t, name: ' ' }).map((i) => i.code)).toContain('INVALID_TEMPLATE_META');
  });
  it('flags unknown enum table and enum values outside allowlist', () => {
    const t = clone(get('vendors'));
    const noTable = { ...t, enumTranslations: {} };
    expect(validateTemplate(noTable).map((i) => i.code)).toContain('UNKNOWN_ENUM_TABLE');
    const badMap: MappingTemplate = {
      ...t,
      enumTranslations: { vendor_status: { allowed: ['active', 'inactive'], map: { Foo: 'banned' } } },
    };
    expect(validateTemplate(badMap).map((i) => i.code)).toContain('ENUM_TARGET_NOT_ALLOWED');
  });
  it('flags invalid decimal scale', () => {
    const t = clone(get('po_lines'));
    const bad: MappingTemplate = { ...t, fields: t.fields.map((f) => (f.target === 'unit_price' ? { ...f, decimalScale: 12 } : f)) };
    expect(validateTemplate(bad).map((i) => i.code)).toContain('INVALID_FIELD_CONFIG');
  });
});

describe('enum translation', () => {
  const status = get('purchase_orders').enumTranslations['po_status'];
  it('maps source strings to allowlist, case/space-insensitive', () => {
    if (status === undefined) throw new Error('no table');
    expect(translateEnum(status, '  ISSUED ')).toBe('sent');
    expect(translateEnum(status, 'complete')).toBe('closed');
    expect(translateEnum(status, 'Cancelled')).toBeNull();
  });
  it('rejects unknown values at row level', () => {
    const t = get('purchase_orders');
    const row = { 'PO Number': 'PO-1', 'Vendor Code': 'V-1', 'PO Status': 'Weird', 'Order Date': '01/02/2026' };
    const m = mapRow(t, row, 1);
    expect(m.values['status']).toBeNull();
    expect(m.errors.map((e) => e.target)).toContain('status');
  });
});

describe('type coercion', () => {
  it('rounds decimals half-up without floating point', () => {
    expect(roundDecimalHalfUp('1.005', 2)).toBe('1.01');
    expect(roundDecimalHalfUp('1.004', 2)).toBe('1.00');
    expect(roundDecimalHalfUp('1,234.5', 2)).toBe('1234.50');
    expect(roundDecimalHalfUp('-2.345', 2)).toBe('-2.35');
    expect(roundDecimalHalfUp('0.999', 2)).toBe('1.00');
    expect(roundDecimalHalfUp('12.5', 0)).toBe('13');
    expect(roundDecimalHalfUp('-0.001', 2)).toBe('0.00');
    expect(roundDecimalHalfUp('abc', 2)).toBeNull();
  });
  it('coerces each type and reports failures', () => {
    const t = get('po_lines');
    const f = (target: string) => {
      const x = t.fields.find((y) => y.target === target);
      if (x === undefined) throw new Error('no field');
      return x;
    };
    expect(coerceValue(f('line_no'), ' 7 ', t)).toEqual({ ok: true, value: 7 });
    expect(coerceValue(f('line_no'), '7.5', t).ok).toBe(false);
    expect(coerceValue(f('quantity'), '2.0005', t)).toEqual({ ok: true, value: '2.001' });
    expect(coerceValue(f('unit_price'), 'x', t).ok).toBe(false);
    expect(coerceValue(f('product_sku'), ' SKU-1 ', t)).toEqual({ ok: true, value: 'SKU-1' });
  });
  it('coerces dates (dmy and iso) and rejects impossible dates', () => {
    const t = get('purchase_orders');
    const dmy = t.fields.find((x) => x.target === 'order_date');
    if (dmy === undefined) throw new Error('no field');
    expect(coerceValue(dmy, '15/03/2026', t)).toEqual({ ok: true, value: '2026-03-15' });
    expect(coerceValue(dmy, '31/02/2026', t).ok).toBe(false);
    expect(coerceValue(dmy, '2026-03-15', t).ok).toBe(false);
    expect(coerceValue({ ...dmy, dateFormat: 'iso' }, '2026-03-15', t)).toEqual({ ok: true, value: '2026-03-15' });
    expect(coerceValue({ ...dmy, dateFormat: undefined as never }, '15/03/2026', t).ok).toBe(false);
  });
  it('coerces booleans', () => {
    const t = get('vendors');
    const base = { source: 'x', target: 'x', type: 'boolean' as const, required: false };
    expect(coerceValue(base, 'Yes', t)).toEqual({ ok: true, value: true });
    expect(coerceValue(base, '0', t)).toEqual({ ok: true, value: false });
    expect(coerceValue(base, 'maybe', t).ok).toBe(false);
  });
  it('fails enum coercion when the table is missing', () => {
    const t = get('vendors');
    expect(coerceValue({ source: 's', target: 't', type: 'enum', required: false }, 'a', t).ok).toBe(false);
  });
});

describe('dry run', () => {
  const headers = ['Vendor Code', 'Vendor Name', 'Contact Email', 'Status', 'Payment Terms Days', 'Bank IBAN'];
  const rows = [
    { 'Vendor Code': 'V-001', 'Vendor Name': 'Example Supplies Ltd', 'Contact Email': 'ap@example.com', Status: 'Active', 'Payment Terms Days': '30', 'Bank IBAN': 'CH93-0000-0000-0000-0000-0' },
    { 'Vendor Code': 'V-002', 'Vendor Name': '', Status: 'Bogus', 'Payment Terms Days': 'abc', 'Bank IBAN': 'CH93-0000-1111-2222-3333-4' },
  ];
  it('maps valid rows and reports invalid ones', () => {
    const r = dryRun(get('vendors'), headers, rows);
    expect(r.validRows).toBe(1);
    expect(r.invalidRows).toBe(1);
    expect(r.templateId).toBe('erp2-vendors-import@1.0.0');
    expect(r.rows[0]?.values['status']).toBe('active');
    expect(r.rows[0]?.values['payment_terms_days']).toBe(30);
  });
  it('never leaks sensitive values into row errors', () => {
    const t = clone(get('vendors'));
    const bad = { ...t, fields: t.fields.map((f) => (f.target === 'bank_iban' ? { ...f, type: 'integer' as const } : f)) };
    const r = dryRun(bad, headers, rows);
    const dump = JSON.stringify(r.rows.flatMap((x) => x.errors));
    expect(dump).not.toContain('CH93');
  });
  it('is reproducible across runs', () => {
    const a = dryRun(get('vendors'), headers, rows);
    const b = dryRun(get('vendors'), headers, rows);
    expect(a).toEqual(b);
  });
  it('treats missing optional cells as null', () => {
    const r = dryRun(get('vendors'), headers, rows);
    expect(r.rows[1]?.values['contact_email']).toBeNull();
  });
});
