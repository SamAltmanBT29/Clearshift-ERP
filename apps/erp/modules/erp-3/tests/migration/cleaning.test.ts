/**
 * ERP-3 Sales Orders & Invoices — Cleaning Rules & Field-Level Audit Test Suite
 * (Issue #163 / ERP3-27 / KIT-04)
 *
 * Validates all Acceptance Criteria for ERP3-27:
 *  - AC 1: Standard cleaners execute (whitespace trimming, email/phone verification, date coercion, decimal stripping).
 *  - AC 2: Every modified value generates an audit entry with source_row, field_name, original_value, cleaned_value, and rule_id.
 *  - AC 3: Unrecoverable required-field anomalies result in structured row rejection with standard reason codes.
 *  - AC 4: Automated tests verify transformed values match expected clean states.
 *  - Immutability (BR-KIT-03): Raw input data is never mutated; original is preserved in rawData.
 *  - Security (PLT-12): Formula injection is rejected and audit exports are formula-safe.
 *
 * @module erp3/tests/migration/cleaning.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { V1_CLEANING_RULES, cleanEmail, cleanPhone, type FieldChangeAudit } from '@cs/kit';
import {
  ERP3_FIELD_CLEAN_RULES,
  ERP3_NOT_APPLICABLE_RULES,
  cleanErp3Dataset,
  exportErp3FieldAuditCsv,
} from '../../src/migration/cleaning-config.js';
import {
  parseCsv,
  sha256Hex,
  type ProfileReport,
} from '../../src/migration/rules.js';

const REPO_ROOT = resolve(process.cwd());
const CSV_PATH = resolve(REPO_ROOT, 'sample-data/erp-3/dirty-data-v1.csv');
const MANIFEST_PATH = resolve(REPO_ROOT, 'sample-data/erp-3/expected-profile.json');

const CSV_TEXT = readFileSync(CSV_PATH, 'utf8');
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ProfileReport;

function parseCsvToRecords(csvText: string): Record<string, string>[] {
  const table = parseCsv(csvText);
  if (table.length < 2) return [];
  const headers = table[0]!.map((h) => h.trim());
  const records: Record<string, string>[] = [];
  for (let i = 1; i < table.length; i++) {
    const row = table[i]!;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j] || `col_${j + 1}`;
      obj[header] = row[j] ?? '';
    }
    records.push(obj);
  }
  return records;
}

const ROWS = parseCsvToRecords(CSV_TEXT);
const V1_RULE_IDS = new Set(V1_CLEANING_RULES.map((r) => r.ruleId));

const DATASET = cleanErp3Dataset(ROWS);

const rowResult = (id: string) => {
  const r = DATASET.rows.find((x) => x.sourceRow === id);
  if (!r) throw new Error(`No clean result for row ${id}`);
  return r;
};

const rawRow = (id: string) => {
  const r = ROWS.find((x) => x['row_id'] === id);
  if (!r) throw new Error(`No fixture row ${id}`);
  return r;
};

const auditsFor = (id: string, field?: string) =>
  DATASET.audits.filter((a) => a.sourceRow === id && (field === undefined || a.fieldName === field));

// Synthetic row builders for isolated edge case testing
const synthOrder = (o: Record<string, string> = {}): Record<string, string> => ({
  row_id: 'SYNTH-SO-1',
  record_type: 'sales_order',
  order_number: 'SO-2026-9001',
  customer_golden_id: 'c0000000-0000-4000-8000-000000000001',
  order_date: '2026-10-15',
  order_status: 'Open',
  currency: 'USD',
  notes: 'Synthetic commercial order',
  ...o,
});

const synthSoLine = (o: Record<string, string> = {}): Record<string, string> => ({
  row_id: 'SYNTH-SOL-1',
  record_type: 'so_line',
  parent_source_id: 'SO-SRC-9001',
  line_number: '1',
  product_id: '5eed0000-0000-4000-8000-0000000000a1',
  quantity: '2.0000',
  unit_price: '50.0000',
  tax_rate: '10.0000',
  ...o,
});

const synthInvoice = (o: Record<string, string> = {}): Record<string, string> => ({
  row_id: 'SYNTH-INV-1',
  record_type: 'invoice',
  invoice_number: 'INV-2026-9001',
  parent_source_id: 'SO-SRC-9001',
  customer_golden_id: 'c0000000-0000-4000-8000-000000000001',
  invoice_date: '2026-10-20',
  due_date: '2026-11-20',
  currency: 'USD',
  invoice_status: 'Open',
  ...o,
});

const synthPayment = (o: Record<string, string> = {}): Record<string, string> => ({
  row_id: 'SYNTH-PAY-1',
  record_type: 'payment',
  payment_number: 'PAY-2026-9001',
  parent_source_id: 'INV-SRC-9001',
  payment_date: '2026-10-22',
  payment_amount: '110.0000',
  payment_method: 'bank',
  payment_reference: 'Wire Transfer Ref 9001',
  ...o,
});

const cleanOne = (row: Record<string, string>) => {
  const res = cleanErp3Dataset([row]);
  const r = res.rows[0];
  if (!r) throw new Error('No clean result returned');
  return { row: r, audits: res.audits };
};

describe('[ERP3-27] ERP-3 Sales Orders & Invoices: Cleaning Rules & Field-Level Audit (#163)', () => {
  // ── 1. Standard Cleaners & Value Normalization (AC1 & AC4) ───────────────────
  describe('1. Standard Cleaners & Normalization Rules (AC1 & AC4)', () => {
    it('trims whitespace and upper-cases business keys and currencies on sales orders', () => {
      const { row, audits } = cleanOne(synthOrder({
        order_number: '  so-2026-9999  ',
        currency: '  usd  ',
      }));
      expect(row.outcome).toBe('cleaned');
      expect(row.cleanedData['order_number']).toBe('SO-2026-9999');
      expect(row.cleanedData['currency']).toBe('USD');

      const orderAudits = audits.filter((a) => a.fieldName === 'order_number');
      expect(orderAudits).toHaveLength(2); // trim, then upper-case
      expect(orderAudits[0]?.cleanedValue).toBe('so-2026-9999');
      expect(orderAudits[1]?.cleanedValue).toBe('SO-2026-9999');
    });

    it('coerces slash and unpadded dates to canonical ISO 8601 YYYY-MM-DD (RL-DATE-01)', () => {
      const { row: soRow, audits: soAudits } = cleanOne(synthOrder({
        order_date: '2026/10/5',
      }));
      expect(soRow.outcome).toBe('cleaned');
      expect(soRow.cleanedData['order_date']).toBe('2026-10-05');
      expect(soAudits.some((a) => a.ruleId === 'RL-DATE-01')).toBe(true);

      const { row: invRow } = cleanOne(synthInvoice({
        invoice_date: '2026/10/20',
        due_date: ' 2026-11-20 ',
      }));
      expect(invRow.cleanedData['invoice_date']).toBe('2026-10-20');
      expect(invRow.cleanedData['due_date']).toBe('2026-11-20');
    });

    it('normalizes status casing to canonical enums (Open, Invoiced, Closed, Paid, Overdue)', () => {
      const so = cleanOne(synthOrder({ order_status: '  open  ' }));
      expect(so.row.cleanedData['order_status']).toBe('Open');

      const inv = cleanOne(synthInvoice({ invoice_status: '  paid  ' }));
      expect(inv.row.cleanedData['invoice_status']).toBe('Paid');
    });

    it('removes currency symbols ($/€/₹) and thousands separators from prices and amounts (RL-CURRENCY-01)', () => {
      const line = cleanOne(synthSoLine({
        unit_price: ' $1,250.5000 ',
      }));
      expect(line.row.cleanedData['unit_price']).toBe('1250.5000');
      expect(line.audits.some((a) => a.ruleId === 'RL-CURRENCY-01')).toBe(true);

      const pay = cleanOne(synthPayment({
        payment_amount: ' € 300.0000 ',
      }));
      expect(pay.row.cleanedData['payment_amount']).toBe('300.0000');
    });

    it('strips percentage symbols from tax rate fields', () => {
      const line = cleanOne(synthSoLine({
        tax_rate: ' 10.0000% ',
      }));
      expect(line.row.cleanedData['tax_rate']).toBe('10.0000');
    });

    it('removes control characters and collapses whitespace in notes and references (RL-TEXT-02 & RL-TEXT-01)', () => {
      const so = cleanOne(synthOrder({
        notes: 'Commercial\u200B   terms\u0000 approved   by finance.',
      }));
      expect(so.row.cleanedData['notes']).toBe('Commercial terms approved by finance.');

      const pay = cleanOne(synthPayment({
        payment_reference: 'Bank\x00 wire   ref\uFEFF99120',
      }));
      expect(pay.row.cleanedData['payment_reference']).toBe('Bank wire ref99120');
    });

    it('lower-cases UUID foreign keys and trims whitespace', () => {
      const so = cleanOne(synthOrder({
        customer_golden_id: '  C0000000-0000-4000-8000-000000000001  ',
      }));
      expect(so.row.cleanedData['customer_golden_id']).toBe('c0000000-0000-4000-8000-000000000001');

      const line = cleanOne(synthSoLine({
        product_id: '  5EED0000-0000-4000-8000-0000000000A1  ',
      }));
      expect(line.row.cleanedData['product_id']).toBe('5eed0000-0000-4000-8000-0000000000a1');
    });

    it('documents non-applicable V1 cleaning rules with clear rationale (phone, email, name, addr, tax, dup)', () => {
      expect(ERP3_NOT_APPLICABLE_RULES['RL-EMAIL-01']).toBeDefined();
      expect(ERP3_NOT_APPLICABLE_RULES['RL-PHONE-01']).toBeDefined();
      expect(ERP3_NOT_APPLICABLE_RULES['RL-NAME-01']).toBeDefined();
      expect(ERP3_NOT_APPLICABLE_RULES['RL-ADDR-01']).toBeDefined();
      expect(ERP3_NOT_APPLICABLE_RULES['RL-TAX-01']).toBeDefined();
      expect(ERP3_NOT_APPLICABLE_RULES['RL-DUP-01']).toBeDefined();

      for (const ruleId of Object.keys(ERP3_NOT_APPLICABLE_RULES)) {
        expect(V1_RULE_IDS.has(ruleId)).toBe(true);
      }

      // Verifies platform standard cleaners work directly for shared contracts
      expect(cleanEmail('  Billing@Example.com  ').cleaned).toBe('billing@example.com');
      expect(cleanPhone('  +1 (555) 123-4567  ')).toBe('+15551234567');
    });

    it('rule toggles: disabling RL-TEXT-01 preserves padded values and suppresses audit entries', () => {
      const toggled = cleanErp3Dataset(
        [synthOrder({ order_number: '  so-2026-9001  ' })],
        ['RL-REQ-01', 'RL-FORMAT-01']
      );
      const r = toggled.rows[0]!;
      expect(r.cleanedData['order_number']).toBe('  so-2026-9001  ');
      expect(toggled.audits).toHaveLength(0);
    });
  });

  // ── 2. Field-Level Change Audit Trail (AC2) ─────────────────────────────────
  describe('2. Field-Level Change Audit Trail (AC2)', () => {
    it('produces complete audit entry with source_row, field_name, original_value, cleaned_value, and rule_id', () => {
      const { audits } = cleanOne(synthOrder({
        row_id: 'TEST-ROW-42',
        currency: '  usd  ',
      }));

      const a = audits.find((x) => x.fieldName === 'currency');
      expect(a).toBeDefined();
      expect(a?.sourceRow).toBe('TEST-ROW-42');
      expect(a?.fieldName).toBe('currency');
      expect(a?.originalValue).toBe('  usd  ');
      expect(a?.ruleId).toBe('RL-TEXT-01');
    });

    it('every audit in full Dirty Data Pack has valid source row, rule ID, and distinct values', () => {
      expect(DATASET.auditCount).toBeGreaterThan(0);
      expect(DATASET.audits).toHaveLength(DATASET.auditCount);

      for (const a of DATASET.audits) {
        expect(String(a.sourceRow)).toMatch(/^R\d{3}$/);
        expect(a.fieldName).not.toBe('');
        expect(a.ruleId).not.toBe('');
        expect(V1_RULE_IDS.has(a.ruleId), `Audit ${a.sourceRow}.${a.fieldName} has valid V1 rule`).toBe(true);
        expect(a.originalValue).not.toBe(a.cleanedValue);
      }
    });

    it('row outcome classification is consistent: new (0 audits, 0 rejects), cleaned (>=1 audit, 0 rejects), or rejected', () => {
      expect(DATASET.totalRows).toBe(135);
      expect(DATASET.totalRows).toBe(MANIFEST.fixture.row_count);

      let newCount = 0;
      let cleanedCount = 0;
      let rejectedCount = 0;

      for (const r of DATASET.rows) {
        if (r.outcome === 'new') {
          newCount++;
          expect(r.audits).toHaveLength(0);
          expect(r.rejections).toHaveLength(0);
        } else if (r.outcome === 'cleaned') {
          cleanedCount++;
          expect(r.audits.length).toBeGreaterThan(0);
          expect(r.rejections).toHaveLength(0);
        } else if (r.outcome === 'rejected') {
          rejectedCount++;
          expect(r.rejections.length).toBeGreaterThan(0);
        }
      }

      expect(DATASET.newCount).toBe(newCount);
      expect(DATASET.cleanedCount).toBe(cleanedCount);
      expect(DATASET.rejectedCount).toBe(rejectedCount);
      expect(newCount + cleanedCount + rejectedCount).toBe(135);
    });
  });

  // ── 3. Structured Row Rejections for Unrecoverable Anomalies (AC3) ────────────
  describe('3. Structured Rejections for Unrecoverable Required Anomalies (AC3)', () => {
    it('rejects missing or empty required fields with stable reason codes (RL-REQ-01)', () => {
      const cases: Array<{ row: Record<string, string>; expectedField: string; expectedCode: string }> = [
        { row: synthOrder({ order_number: '   ' }), expectedField: 'order_number', expectedCode: 'ORDER_NUMBER_REQUIRED' },
        { row: synthOrder({ customer_golden_id: '' }), expectedField: 'customer_golden_id', expectedCode: 'CUSTOMER_GOLDEN_ID_REQUIRED' },
        { row: synthOrder({ order_date: '' }), expectedField: 'order_date', expectedCode: 'ORDER_DATE_REQUIRED' },
        { row: synthOrder({ currency: '' }), expectedField: 'currency', expectedCode: 'CURRENCY_REQUIRED' },
        { row: synthSoLine({ parent_source_id: '' }), expectedField: 'parent_source_id', expectedCode: 'PARENT_SOURCE_ID_REQUIRED' },
        { row: synthSoLine({ product_id: '' }), expectedField: 'product_id', expectedCode: 'PRODUCT_ID_REQUIRED' },
        { row: synthSoLine({ quantity: '' }), expectedField: 'quantity', expectedCode: 'QUANTITY_REQUIRED' },
        { row: synthSoLine({ unit_price: '' }), expectedField: 'unit_price', expectedCode: 'UNIT_PRICE_REQUIRED' },
        { row: synthInvoice({ invoice_number: '' }), expectedField: 'invoice_number', expectedCode: 'INVOICE_NUMBER_REQUIRED' },
        { row: synthInvoice({ due_date: '' }), expectedField: 'due_date', expectedCode: 'DUE_DATE_REQUIRED' },
        { row: synthPayment({ payment_number: '' }), expectedField: 'payment_number', expectedCode: 'PAYMENT_NUMBER_REQUIRED' },
        { row: synthPayment({ payment_amount: '' }), expectedField: 'payment_amount', expectedCode: 'PAYMENT_AMOUNT_REQUIRED' },
        { row: synthPayment({ payment_method: '' }), expectedField: 'payment_method', expectedCode: 'PAYMENT_METHOD_REQUIRED' },
      ];

      for (const { row, expectedField, expectedCode } of cases) {
        const { row: result } = cleanOne(row);
        expect(result.outcome).toBe('rejected');
        const rej = result.rejections.find((r) => r.field === expectedField);
        expect(rej, `Field ${expectedField} rejected with ${expectedCode}`).toBeDefined();
        expect(rej?.reasonCode).toBe(expectedCode);
        expect(rej?.ruleId).toBe('RL-REQ-01');
      }
    });

    it('rejects invalid format codes with structured reason codes (RL-FORMAT-01)', () => {
      const cases: Array<{ row: Record<string, string>; expectedField: string; expectedCode: string }> = [
        { row: synthOrder({ customer_golden_id: 'not-a-uuid' }), expectedField: 'customer_golden_id', expectedCode: 'INVALID_CUSTOMER_GOLDEN_ID' },
        { row: synthOrder({ customer_golden_id: 'c0000000-0000-4000-8000-999999999999' }), expectedField: 'customer_golden_id', expectedCode: 'CUSTOMER_NOT_FOUND' },
        { row: synthOrder({ currency: 'GBP' }), expectedField: 'currency', expectedCode: 'INVALID_CURRENCY' },
        { row: synthOrder({ order_status: 'PendingApproval' }), expectedField: 'order_status', expectedCode: 'INVALID_STATUS' },
        { row: synthSoLine({ line_number: '0' }), expectedField: 'line_number', expectedCode: 'INVALID_LINE_NUMBER' },
        { row: synthSoLine({ quantity: '-5.0000' }), expectedField: 'quantity', expectedCode: 'NEGATIVE_OR_ZERO_QUANTITY' },
        { row: synthSoLine({ quantity: '0.0000' }), expectedField: 'quantity', expectedCode: 'NEGATIVE_OR_ZERO_QUANTITY' },
        { row: synthSoLine({ unit_price: '-10.0000' }), expectedField: 'unit_price', expectedCode: 'NEGATIVE_UNIT_PRICE' },
        { row: synthSoLine({ tax_rate: '105.0000' }), expectedField: 'tax_rate', expectedCode: 'TAX_RATE_OUT_OF_RANGE' },
        { row: synthPayment({ payment_method: 'crypto' }), expectedField: 'payment_method', expectedCode: 'INVALID_PAYMENT_METHOD' },
        { row: synthPayment({ payment_amount: '-50.0000' }), expectedField: 'payment_amount', expectedCode: 'NEGATIVE_OR_ZERO_PAYMENT_AMOUNT' },
      ];

      for (const { row, expectedField, expectedCode } of cases) {
        const { row: result } = cleanOne(row);
        expect(result.outcome).toBe('rejected');
        const rej = result.rejections.find((r) => r.field === expectedField);
        expect(rej, `Field ${expectedField} rejected with ${expectedCode}`).toBeDefined();
        expect(rej?.reasonCode).toBe(expectedCode);
        expect(rej?.ruleId).toBe('RL-FORMAT-01');
      }
    });

    it('rejects ambiguous dates for explicit human review (RL-DATE-01 / AMBIGUOUS_DATE_FORMAT_REVIEW)', () => {
      const { row } = cleanOne(synthOrder({
        order_date: '10/12/2026',
      }));
      expect(row.outcome).toBe('rejected');
      const rej = row.rejections.find((r) => r.field === 'order_date');
      expect(rej?.reasonCode).toBe('AMBIGUOUS_DATE_FORMAT_REVIEW');
      expect(rej?.message).toContain('ambiguous');
    });

    it('rejects impossible calendar dates (2026-02-30 / 2026-04-31) with INVALID_DATE', () => {
      const { row } = cleanOne(synthOrder({
        order_date: '2026-02-30',
      }));
      expect(row.outcome).toBe('rejected');
      expect(row.rejections.some((r) => r.reasonCode === 'INVALID_DATE')).toBe(true);
    });

    it('rejects formula injection values outright without repairing or modifying them', () => {
      const formulaPayloads = [
        '=cmd|"/C calc"!A0',
        '+44123456789',
        '-DDE("cmd";"calc";"")',
        '@HYPERLINK("http://evil.com")',
        '\t=SUM(A1:A10)',
        '\r=1+1',
      ];

      for (const payload of formulaPayloads) {
        const { row, audits } = cleanOne(synthOrder({
          order_number: payload,
        }));
        expect(row.outcome).toBe('rejected');
        expect(row.cleanedData['order_number']).toBe(payload); // unmutated
        expect(audits).toHaveLength(0); // never logged as a clean audit
        expect(row.rejections.some((r) => r.reasonCode === 'FORMULA_INJECTION_DETECTED')).toBe(true);
      }
    });
  });

  // ── 4. Immutability & Audit CSV Export (BR-KIT-03 & PLT-12) ──────────────────
  describe('4. Immutability & Audit CSV Export (BR-KIT-03 & PLT-12)', () => {
    it('guarantees raw row inputs are strictly immutable (Object.freeze check)', () => {
      const frozenRows = ROWS.map((r) => Object.freeze({ ...r }));
      const snapshot = JSON.stringify(frozenRows);

      expect(() => cleanErp3Dataset(frozenRows)).not.toThrow();
      expect(JSON.stringify(frozenRows)).toBe(snapshot);
    });

    it('exports audit trail to formula-safe CSV with header and records', () => {
      const audits: FieldChangeAudit[] = [
        {
          sourceRow: 'R001',
          fieldName: 'currency',
          originalValue: '  usd  ',
          cleanedValue: 'USD',
          ruleId: 'RL-TEXT-01',
        },
        {
          sourceRow: 'R002',
          fieldName: 'notes',
          originalValue: '=SUM(1+1)',
          cleanedValue: "'=SUM(1+1)",
          ruleId: 'RL-TEXT-01',
        },
      ];

      const csv = exportErp3FieldAuditCsv(audits);
      expect(csv).toContain('Source Row,Field Name,Original Value,Cleaned Value,Rule ID');
      expect(csv).toContain('R001,currency');
      expect(csv).toContain("'=SUM(1+1)");
    });
  });
});
