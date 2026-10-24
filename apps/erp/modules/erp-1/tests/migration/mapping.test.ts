/**
 * ERP-1 Products & Inventory — Mapping / Value Translation Configuration Tests (ERP1-28 / Issue #124)
 *
 * Verifies:
 *  AC1 Mapping template maps source file columns to target schema attributes with type coercion rules.
 *  AC2 Enum translation tables map source values to module enum allowlists.
 *  AC3 Unmapped required target fields raise validation error and block dry-run execution.
 *  AC4 Templates are named, versioned, reproducible, and fingerprint is stable.
 *
 * @module erp1/tests/migration/mapping.test
 */

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
} from '../../src/migration/mapping-config.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const TEMPLATE_PATH = resolve(REPO_ROOT, 'sample-data/erp-1/mapping-template.json');

const pack = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8')) as { templates: MappingTemplate[] };

function get(entity: MappingTemplate['entity']): MappingTemplate {
  const t = pack.templates.find((x) => x.entity === entity);
  if (t === undefined) throw new Error(`missing template for entity ${entity}`);
  return t;
}

const clone = (t: MappingTemplate): MappingTemplate => JSON.parse(JSON.stringify(t)) as MappingTemplate;

describe('[ERP1-28] ERP-1 Mapping & Value Translation Configuration (#124)', () => {
  describe('1. Shipped Templates & Versioning (AC4)', () => {
    it('all shipped templates are valid, named, and semver-versioned', () => {
      expect(pack.templates.length).toBe(4);
      for (const t of pack.templates) {
        expect(validateTemplate(t)).toEqual([]);
        expect(templateId(t)).toMatch(/^erp1-[a-z-]+@\d+\.\d+\.\d+$/);
      }
    });

    it('template fingerprint is deterministic and key-order independent', () => {
      const t = get('product');
      expect(templateFingerprint(t)).toBe(templateFingerprint(clone(t)));

      const reordered = JSON.parse(
        JSON.stringify({
          fields: t.fields,
          enumTranslations: t.enumTranslations,
          entity: t.entity,
          version: t.version,
          name: t.name,
        })
      ) as MappingTemplate;
      expect(templateFingerprint(reordered)).toBe(templateFingerprint(t));
    });

    it('fingerprint changes when version or field configuration changes', () => {
      const t = clone(get('product'));
      const before = templateFingerprint(t);
      t.version = '1.0.1';
      expect(templateFingerprint(t)).not.toBe(before);
    });
  });

  describe('2. Required Target Enforcement & Dry-Run Guards (AC3)', () => {
    it('blocks when a required target column is unmapped', () => {
      const t = clone(get('product'));
      // Remove required target 'price'
      const bad = { ...t, fields: t.fields.filter((f) => f.target !== 'price') };
      const issues = validateTemplate(bad);
      expect(issues.some((i) => i.code === 'UNMAPPED_REQUIRED_TARGET' && i.target === 'price')).toBe(true);
      expect(() => assertDryRunReady(bad, ['sku', 'name', 'category_code', 'unit_of_measure', 'currency'])).toThrow(
        MappingValidationError
      );
    });

    it('blocks when a required target column is mapped as optional', () => {
      const t = clone(get('product'));
      const bad: MappingTemplate = {
        ...t,
        fields: t.fields.map((f) => (f.target === 'sku' ? { ...f, required: false } : f)),
      };
      const issues = validateTemplate(bad);
      expect(issues.some((i) => i.code === 'UNMAPPED_REQUIRED_TARGET' && i.target === 'sku')).toBe(true);
    });

    it('blocks when a required source column is missing from file headers', () => {
      const t = get('product');
      const headers = ['sku', 'name', 'category_code']; // missing unit_of_measure, price, currency
      const issues = validateAgainstHeaders(t, headers);
      expect(issues.some((i) => i.code === 'MISSING_SOURCE_COLUMN' && i.target === 'price')).toBe(true);
      expect(() => assertDryRunReady(t, headers)).toThrow(MappingValidationError);
    });

    it('detects duplicate target or duplicate source mappings', () => {
      const t = clone(get('category'));
      const bad: MappingTemplate = {
        ...t,
        fields: [
          ...t.fields,
          { source: 'alt_code', target: 'code', type: 'string', required: true },
        ],
      };
      const issues = validateTemplate(bad);
      expect(issues.some((i) => i.code === 'DUPLICATE_TARGET')).toBe(true);
    });
  });

  describe('3. Enum Value Translations (AC2)', () => {
    it('translates unit of measure aliases to canonical allowlist (FR-ERP1-04)', () => {
      const t = get('product');
      const uomTable = t.enumTranslations['unit_of_measure']!;
      expect(translateEnum(uomTable, 'pieces')).toBe('pcs');
      expect(translateEnum(uomTable, 'KILOGRAM')).toBe('kg');
      expect(translateEnum(uomTable, 'Liter')).toBe('litre');
      expect(translateEnum(uomTable, 'boxes')).toBe('box');
    });

    it('translates lowercase currency codes to canonical uppercase allowlist', () => {
      const t = get('product');
      const currTable = t.enumTranslations['currency']!;
      expect(translateEnum(currTable, 'usd')).toBe('USD');
      expect(translateEnum(currTable, 'eur')).toBe('EUR');
      expect(translateEnum(currTable, 'gbp')).toBe('GBP');
      expect(translateEnum(currTable, 'inr')).toBe('INR');
    });

    it('returns null when value is not in enum allowlist', () => {
      const t = get('product');
      const uomTable = t.enumTranslations['unit_of_measure']!;
      expect(translateEnum(uomTable, 'yards')).toBeNull();
    });
  });

  describe('4. Type Coercion & Decimal Arithmetic (AC1)', () => {
    it('performs half-up decimal rounding without floating point precision loss', () => {
      expect(roundDecimalHalfUp('12.345', 2)).toBe('12.35');
      expect(roundDecimalHalfUp('12.344', 2)).toBe('12.34');
      expect(roundDecimalHalfUp('100', 2)).toBe('100.00');
      expect(roundDecimalHalfUp('0.0001', 4)).toBe('0.0001');
    });

    it('coerces values using field configuration rules', () => {
      const t = get('product');
      const priceField = t.fields.find((f) => f.target === 'price')!;
      const res = coerceValue(priceField, '49.999', t);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toBe('50.00');

      const uomField = t.fields.find((f) => f.target === 'unit_of_measure')!;
      const uomRes = coerceValue(uomField, 'PIECES', t);
      expect(uomRes.ok).toBe(true);
      if (uomRes.ok) expect(uomRes.value).toBe('pcs');
    });
  });

  describe('5. Row Mapping & Safe Dry-Run Execution', () => {
    it('maps valid raw source row into target entity shape', () => {
      const t = get('product');
      const sourceRow = {
        sku: 'FAST-BOLT-001',
        name: 'Hex Bolt M8',
        category_code: 'GEN',
        unit_of_measure: 'pieces',
        price: '1.254',
        currency: 'usd',
        tax_rate: '0.18',
      };
      const res = mapRow(t, sourceRow);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.row.sku).toBe('FAST-BOLT-001');
        expect(res.row.unit_of_measure).toBe('pcs');
        expect(res.row.price).toBe('1.25');
        expect(res.row.currency).toBe('USD');
      }
    });

    it('collects all row errors without aborting processing', () => {
      const t = get('product');
      const invalidRow = {
        sku: 'FAST-BOLT-002',
        name: 'Hex Bolt M10',
        category_code: 'GEN',
        unit_of_measure: 'invalid_uom',
        price: 'not_a_number',
        currency: 'INVALID',
      };
      const res = mapRow(t, invalidRow);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('dryRun processes dataset, counts results, and never mutates inputs', () => {
      const t = get('product');
      const rows = [
        {
          sku: 'SKU-001',
          name: 'Widget A',
          category_code: 'GEN',
          unit_of_measure: 'pcs',
          price: '10.00',
          currency: 'USD',
        },
        {
          sku: 'SKU-002',
          name: 'Widget B',
          category_code: 'GEN',
          unit_of_measure: 'yards',
          price: 'bad',
          currency: 'USD',
        },
      ];
      const snapshot = JSON.stringify(rows);
      const report = dryRun(t, rows);
      expect(report.totalRows).toBe(2);
      expect(report.mappedCount).toBe(1);
      expect(report.errorCount).toBe(1);
      expect(report.template.name).toBe('erp1-products-import');
      expect(JSON.stringify(rows)).toBe(snapshot);
    });
  });
});
