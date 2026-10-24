/**
 * ERP-1 Products & Inventory — Cleaning Rules & Field-Level Audit Tests (ERP1-27 / Issue #123)
 *
 * Verifies:
 *  AC1 Standard cleaners execute (whitespace trimming, email/phone normalization, date coercion, decimal cleanup).
 *  AC2 Every modified value generates an audit entry with source_row, field_name, original_value, cleaned_value, rule_id.
 *  AC3 Unrecoverable required-field anomalies reject the row with structured reason codes.
 *  AC4 Transformed values match expected clean states.
 *  Plus: raw data is never mutated, sensitive fields never leak to audits, and exported CSV is formula-safe.
 *
 * @module erp1/tests/migration/cleaning.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { V1_CLEANING_RULES } from '@cs/kit';
import {
  ERP1_FIELD_CLEAN_RULES,
  ERP1_NOT_APPLICABLE_RULES,
  cleanErp1Dataset,
  exportErp1FieldAuditCsv,
} from '../../src/migration/cleaning-config.js';
import { FIXTURE_PATH, parseCsv } from '../../src/migration/rules.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const CSV_PATH = resolve(REPO_ROOT, FIXTURE_PATH);
const CSV_TEXT = readFileSync(CSV_PATH, 'utf8');
const ROWS = parseCsv(CSV_TEXT) as unknown as Record<string, string>[];

const DATASET = cleanErp1Dataset(ROWS);

describe('[ERP1-27] ERP-1 Cleaning Rules & Field-Level Audit (#123)', () => {
  describe('1. Standard Cleaners Execution (AC1)', () => {
    it('trims leading/trailing whitespace and upper-cases SKU (BR-ERP1-01)', () => {
      const row = {
        row_id: 'TEST-SKU-01',
        record_type: 'product',
        sku: '  fast-bolt-hex-001  ',
        name: 'Hex Bolt M8',
        category_code: 'GEN',
        unit_of_measure: 'pcs',
        price: '1.50',
        currency: 'USD',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.rows[0]?.cleanedData.sku).toBe('FAST-BOLT-HEX-001');
      expect(res.rows[0]?.outcome).toBe('cleaned');
    });

    it('lowercases and validates units of measure (FR-ERP1-04)', () => {
      const row = {
        row_id: 'TEST-UOM-01',
        record_type: 'product',
        sku: 'RAW-COP-WIRE-003',
        name: 'Copper Wire',
        category_code: 'RAW',
        unit_of_measure: '  KG  ',
        price: '25.00',
        currency: 'USD',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.rows[0]?.cleanedData.unit_of_measure).toBe('kg');
      expect(res.rows[0]?.outcome).toBe('cleaned');
    });

    it('normalizes warehouse notification email', () => {
      const row = {
        row_id: 'TEST-WH-01',
        record_type: 'warehouse',
        code: 'WH-01',
        name: 'Main Facility',
        is_default: 'true',
        notification_email: '  WAREHOUSE.OPS@EXAMPLE.COM  ',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.rows[0]?.cleanedData.notification_email).toBe('warehouse.ops@example.com');
      expect(res.rows[0]?.outcome).toBe('cleaned');
    });

    it('cleans currency symbols and comma thousand separators from price', () => {
      const row = {
        row_id: 'TEST-PRICE-01',
        record_type: 'product',
        sku: 'TOOL-DRL-ROT-009',
        name: 'Rotary Drill',
        category_code: 'TOOLS',
        unit_of_measure: 'pcs',
        price: '$ 1,250.50',
        currency: 'USD',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.rows[0]?.cleanedData.price).toBe('1250.50');
      expect(res.rows[0]?.outcome).toBe('cleaned');
    });

    it('coerces valid calendar dates into ISO 8601 (YYYY-MM-DD)', () => {
      const row = {
        row_id: 'TEST-DATE-01',
        record_type: 'stock_level',
        sku: 'FAST-BOLT-HEX-001',
        warehouse_code: 'WH-01',
        quantity: '100',
        as_of_date: '2026/04/15',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.rows[0]?.cleanedData.as_of_date).toBe('2026-04-15');
      expect(res.rows[0]?.outcome).toBe('cleaned');
    });
  });

  describe('2. Field-Level Change Audit (AC2)', () => {
    it('generates structured audit entries for every modified field', () => {
      const row = {
        row_id: 'AUDIT-ROW-1',
        record_type: 'product',
        sku: '  part-001  ',
        name: 'Widget Standard',
        category_code: 'gen',
        unit_of_measure: 'PCS',
        price: '10.00',
        currency: 'usd',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.audits.length).toBeGreaterThanOrEqual(3);

      const skuAudits = res.audits.filter((a) => a.fieldName === 'sku');
      expect(skuAudits.length).toBeGreaterThanOrEqual(1);
      expect(skuAudits[0]?.sourceRow).toBe('AUDIT-ROW-1');
      expect(skuAudits[0]?.originalValue).toBe('  part-001  ');
      expect(skuAudits[skuAudits.length - 1]?.cleanedValue).toBe('PART-001');
      expect(res.rows[0]?.cleanedData.sku).toBe('PART-001');

      const uomAudit = res.audits.find((a) => a.fieldName === 'unit_of_measure');
      expect(uomAudit).toBeDefined();
      expect(uomAudit?.originalValue).toBe('PCS');
      expect(uomAudit?.cleanedValue).toBe('pcs');
    });

    it('exports audit trail as formula-safe CSV', () => {
      const row = {
        row_id: 'CSV-AUDIT-1',
        record_type: 'product',
        sku: '  item-99  ',
        name: 'Item 99',
        category_code: 'GEN',
        unit_of_measure: 'pcs',
        price: '5.00',
        currency: 'USD',
      };
      const res = cleanErp1Dataset([row]);
      const csv = exportErp1FieldAuditCsv(res.audits);
      expect(csv).toContain('Source Row,Field Name,Original Value,Cleaned Value,Rule ID,Timestamp');
      expect(csv).toContain('CSV-AUDIT-1,sku');
      expect(csv).toContain('ITEM-99');
    });
  });

  describe('3. Structured Rejections for Unrecoverable Anomalies (AC3)', () => {
    it('rejects row when required SKU is missing', () => {
      const row = {
        row_id: 'REJ-NO-SKU',
        record_type: 'product',
        sku: '   ',
        name: 'Anonymous Part',
        category_code: 'GEN',
        unit_of_measure: 'pcs',
        price: '10.00',
        currency: 'USD',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.rows[0]?.outcome).toBe('rejected');
      expect(res.rejections.some((r) => r.reasonCode === 'SKU_REQUIRED')).toBe(true);
    });

    it('rejects spreadsheet formula injection prefix in SKU or name (OWASP / KIT-16)', () => {
      const row = {
        row_id: 'REJ-FORMULA',
        record_type: 'product',
        sku: '=SUM(A1:A10)',
        name: 'Formula Part',
        category_code: 'GEN',
        unit_of_measure: 'pcs',
        price: '10.00',
        currency: 'USD',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.rows[0]?.outcome).toBe('rejected');
      expect(res.rejections.some((r) => r.reasonCode === 'FORMULA_INJECTION_DETECTED')).toBe(true);
    });

    it('rejects negative unit price (BR-ERP1-01)', () => {
      const row = {
        row_id: 'REJ-NEG-PRICE',
        record_type: 'product',
        sku: 'PART-NEG-001',
        name: 'Negative Part',
        category_code: 'GEN',
        unit_of_measure: 'pcs',
        price: '-15.50',
        currency: 'USD',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.rows[0]?.outcome).toBe('rejected');
      expect(res.rejections.some((r) => r.reasonCode === 'NEGATIVE_PRICE')).toBe(true);
    });

    it('rejects negative stock quantity (BR-ERP1-02)', () => {
      const row = {
        row_id: 'REJ-NEG-STOCK',
        record_type: 'stock_level',
        sku: 'PART-001',
        warehouse_code: 'WH-01',
        quantity: '-50',
        as_of_date: '2026-04-15',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.rows[0]?.outcome).toBe('rejected');
      expect(res.rejections.some((r) => r.reasonCode === 'NEGATIVE_STOCK_QUANTITY')).toBe(true);
    });

    it('rejects unauthorized warehouse facility (FR-ERP1-05)', () => {
      const row = {
        row_id: 'REJ-WH-02',
        record_type: 'warehouse',
        code: 'WH-02',
        name: 'Secondary Facility',
        is_default: 'false',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.rows[0]?.outcome).toBe('rejected');
      expect(res.rejections.some((r) => r.reasonCode === 'INVALID_WAREHOUSE_FACILITY')).toBe(true);
    });

    it('rejects ambiguous date format (e.g. 03/04/2026) for human review', () => {
      const row = {
        row_id: 'REJ-AMB-DATE',
        record_type: 'stock_level',
        sku: 'PART-001',
        warehouse_code: 'WH-01',
        quantity: '10',
        as_of_date: '03/04/2026',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.rows[0]?.outcome).toBe('rejected');
      expect(res.rejections.some((r) => r.reasonCode === 'AMBIGUOUS_DATE_FORMAT_REVIEW')).toBe(true);
    });

    it('rejects unapproved unit of measure', () => {
      const row = {
        row_id: 'REJ-INVALID-UOM',
        record_type: 'product',
        sku: 'PART-002',
        name: 'Fabric',
        category_code: 'RAW',
        unit_of_measure: 'yards',
        price: '12.00',
        currency: 'USD',
      };
      const res = cleanErp1Dataset([row]);
      expect(res.rows[0]?.outcome).toBe('rejected');
      expect(res.rejections.some((r) => r.reasonCode === 'INVALID_UOM')).toBe(true);
    });
  });

  describe('4. Full Fixture Dataset Clean Execution (AC4)', () => {
    it('processes all rows in dirty-data-v1.csv without unhandled exceptions', () => {
      expect(DATASET.totalRows).toBe(ROWS.length);
      expect(DATASET.totalRows).toBeGreaterThan(0);
      expect(DATASET.newCount + DATASET.cleanedCount + DATASET.rejectedCount).toBe(DATASET.totalRows);
      expect(DATASET.auditCount).toBe(DATASET.audits.length);
    });

    it('strictly masks supplier bank account and employee ssn from audit trail', () => {
      for (const audit of DATASET.audits) {
        expect(audit.fieldName).not.toBe('supplier_bank_account');
        expect(audit.fieldName).not.toBe('employee_ssn');
        expect(audit.originalValue).not.toMatch(/^[0-9]{9,16}$/);
      }
    });

    it('never mutates raw input rows (BR-KIT-03)', () => {
      const sampleRaw = ROWS[0];
      const snapshot = JSON.stringify(sampleRaw);
      cleanErp1Dataset([sampleRaw!]);
      expect(JSON.stringify(sampleRaw)).toBe(snapshot);
    });

    it('allows selectively disabling rules via CleanerConfig options', () => {
      const row = {
        row_id: 'TOGGLE-1',
        record_type: 'product',
        sku: '  item-001  ',
        name: 'Item',
        category_code: 'GEN',
        unit_of_measure: 'pcs',
        price: '1.00',
        currency: 'USD',
      };
      // Disable RL-TEXT-01
      const res = cleanErp1Dataset([row], { enabledRuleIds: ['RL-TEXT-02'] });
      const skuAudit = res.audits.find((a) => a.fieldName === 'sku' && a.ruleId === 'RL-TEXT-01');
      expect(skuAudit).toBeUndefined();
    });
  });

  describe('5. Non-Applicable Rules Catalog', () => {
    it('documents why RL-NAME-01 and RL-DUP-01 are not applied to ERP-1 entity cleaning', () => {
      expect(ERP1_NOT_APPLICABLE_RULES['RL-NAME-01']).toBeDefined();
      expect(ERP1_NOT_APPLICABLE_RULES['RL-DUP-01']).toBeDefined();
    });
  });
});
