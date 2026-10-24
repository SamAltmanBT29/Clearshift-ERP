/**
 * ERP-2 Vendors & Purchasing — Cleaning Rules & Field-Level Audit Tests
 * (Issue #143 / ERP2-27 / KIT-04)
 *
 * Verifies:
 *  AC1  Standard cleaners execute (whitespace trimming, email lowercasing, date coercion; phone is N/A).
 *  AC2  Every modified value generates an audit entry with source_row, field_name, original_value,
 *       cleaned_value and rule_id.
 *  AC3  Unrecoverable required-field anomalies reject the row with a structured reason code.
 *  AC4  Transformed values match expected clean states.
 * Plus: raw data is never mutated, bank details never reach the log, and the audit CSV is formula-safe.
 *
 * Expected clean states for named fixture rows are written out literally; rejection expectations are
 * read from the ERP2-25 manifest (`expected-profile.json`).
 *
 * @module erp2/tests/migration/cleaning.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { V1_CLEANING_RULES, type FieldChangeAudit } from '@cs/kit';
import {
  ERP2_FIELD_CLEAN_RULES,
  ERP2_NOT_APPLICABLE_RULES,
  cleanErp2Dataset,
  exportErp2FieldAuditCsv,
} from '../../src/migration/cleaning-config.js';
import { FIXTURE_PATH, parseCsv, sha256Hex, type ProfileReport } from '../../src/migration/dirty-data-plan.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const CSV_PATH = resolve(REPO_ROOT, FIXTURE_PATH);
const MANIFEST_PATH = resolve(REPO_ROOT, 'sample-data/erp-2/expected-profile.json');

const CSV_TEXT = readFileSync(CSV_PATH, 'utf8');
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ProfileReport;
const ROWS = parseCsv(CSV_TEXT);
const V1_RULE_IDS = new Set(V1_CLEANING_RULES.map((r) => r.ruleId));

const DATASET = cleanErp2Dataset(ROWS);

const rowResult = (id: string) => {
  const r = DATASET.rows.find((x) => x.sourceRow === id);
  if (!r) throw new Error(`No clean result for ${id}`);
  return r;
};
const rawRow = (id: string) => {
  const r = ROWS.find((x) => x.row_id === id);
  if (!r) throw new Error(`No fixture row ${id}`);
  return r as Record<string, string>;
};
const auditsFor = (id: string, field?: string) =>
  DATASET.audits.filter((a) => a.sourceRow === id && (field === undefined || a.fieldName === field));

// Fully valid synthetic rows (all data synthetic, RFC-2606 domains) used as a base for targeted cases.
const synthVendor = (o: Record<string, string> = {}): Record<string, string> => ({
  row_id: 'S-V', record_type: 'vendor', vendor_code: 'VEN-900', vendor_name: 'Synthetic Supplies Ltd',
  tax_number: '', email: '', currency: 'USD', payment_terms_days: '30', bank_account: '', ...o,
});
const synthPo = (o: Record<string, string> = {}): Record<string, string> => ({
  row_id: 'S-P', record_type: 'purchase_order', po_number: 'PO-900', po_vendor_code: 'VEN-900',
  po_status: 'Draft', status_path: 'Draft', po_date: '2026-01-01', expected_date: '', currency: 'USD',
  po_total: '10.00', ...o,
});
const synthLine = (o: Record<string, string> = {}): Record<string, string> => ({
  row_id: 'S-L', record_type: 'po_line', po_number: 'PO-900', line_no: '1', product_sku: 'SKU-GEN-0001',
  quantity: '1', unit_price: '1.00', line_total: '', ...o,
});
const cleanOne = (row: Record<string, string>) => {
  const res = cleanErp2Dataset([row]);
  const r = res.rows[0];
  if (!r) throw new Error('no result');
  return { row: r, audits: res.audits };
};

describe('[ERP2-27] ERP-2 Cleaning Rules & Field-Level Audit (#143)', () => {
  // ── AC1 + AC4 ──────────────────────────────────────────────────────────────
  describe('1. Standard cleaners and expected clean states (AC1 & AC4)', () => {
    it('R024: trims vendor code, name and tax number padding', () => {
      const r = rowResult('R024');
      expect(r.outcome).toBe('cleaned');
      expect(r.cleanedData['vendor_code']).toBe('VEN-024');
      expect(r.cleanedData['vendor_name']).toBe('Padded Name Trading Co');
      expect(r.cleanedData['tax_number']).toBe('TAX-100024');
      expect(auditsFor('R024').map((a) => a.fieldName).sort()).toEqual(['tax_number', 'vendor_code', 'vendor_name']);
    });

    it('R043: lower-case padded vendor code becomes the canonical key (trim, then upper-case)', () => {
      expect(rowResult('R043').cleanedData['vendor_code']).toBe('VEN-002');
      const codeAudits = auditsFor('R043', 'vendor_code');
      expect(codeAudits).toHaveLength(2);
      expect(codeAudits.every((a) => a.ruleId === 'RL-TEXT-01')).toBe(true);
      expect(codeAudits[0]?.cleanedValue).toBe('ven-002');
      expect(codeAudits[1]?.cleanedValue).toBe('VEN-002');
    });

    it('purchase orders: keys and status are canonicalised', () => {
      expect(rowResult('R056').cleanedData['po_number']).toBe('PO-2026-0010');
      expect(rowResult('R057').cleanedData['po_vendor_code']).toBe('VEN-011');
      expect(rowResult('R052').cleanedData['po_status']).toBe('Received');
      expect(rowResult('R058').cleanedData['po_status']).toBe('Draft');
      expect(rowResult('R064').cleanedData['po_status']).toBe('Received');
      expect(rowResult('R090').cleanedData['po_number']).toBe('PO-2026-0005');
    });

    it('PO lines: SKU, quantity, price and PO number are canonicalised', () => {
      const r = rowResult('R103');
      expect(r.outcome).toBe('cleaned');
      expect(r.cleanedData['product_sku']).toBe('SKU-PKG-0001');
      expect(r.cleanedData['quantity']).toBe('4');
      expect(r.cleanedData['unit_price']).toBe('2.50');
      expect(rowResult('R108').cleanedData['po_number']).toBe('PO-2026-0008');
      expect(rowResult('R172').cleanedData['po_number']).toBe('PO-2026-0003');
    });

    it('UTF-8 vendor names pass through untouched', () => {
      for (const id of ['R021', 'R022', 'R023']) {
        expect(rowResult(id).cleanedData['vendor_name']).toBe(rawRow(id)['vendor_name']);
        expect(auditsFor(id, 'vendor_name')).toHaveLength(0);
        expect(rowResult(id).outcome).not.toBe('rejected');
      }
    });

    it('lower-cases and trims email, upper-cases currency (synthetic row)', () => {
      const { row } = cleanOne(synthVendor({ email: '  Accounts@Example.COM ', currency: ' usd ' }));
      expect(row.outcome).toBe('cleaned');
      expect(row.cleanedData['email']).toBe('accounts@example.com');
      expect(row.cleanedData['currency']).toBe('USD');
    });

    it('coerces YYYY/M/D dates to ISO 8601 and trims padded ISO dates (synthetic row)', () => {
      const { row, audits } = cleanOne(synthPo({ po_date: '2026/7/1', expected_date: ' 2026-07-15 ' }));
      expect(row.outcome).toBe('cleaned');
      expect(row.cleanedData['po_date']).toBe('2026-07-01');
      expect(row.cleanedData['expected_date']).toBe('2026-07-15');
      expect(audits.every((a) => a.ruleId === 'RL-DATE-01')).toBe(true);
    });

    it('strips currency symbols and thousands separators from money fields (synthetic rows)', () => {
      const po = cleanOne(synthPo({ po_total: '$1,234.50' }));
      expect(po.row.cleanedData['po_total']).toBe('1234.50');
      expect(po.audits[0]?.ruleId).toBe('RL-CURRENCY-01');
      const line = cleanOne(synthLine({ unit_price: '€ 2.5' }));
      expect(line.row.cleanedData['unit_price']).toBe('2.5');
    });

    it('does not silently misread a decimal comma ("12,50") as 1250', () => {
      const { row } = cleanOne(synthPo({ po_total: '12,50' }));
      expect(row.outcome).toBe('rejected');
      expect(row.cleanedData['po_total']).toBe('12,50');
      expect(row.rejections[0]?.reasonCode).toBe('INVALID_PO_TOTAL');
    });

    it('control characters are removed and inner whitespace is collapsed in vendor names', () => {
      const { row } = cleanOne(synthVendor({ vendor_name: 'Acme\u200B   Tools\u0000 Ltd' }));
      expect(row.cleanedData['vendor_name']).toBe('Acme Tools Ltd');
    });

    it('phone normalisation is not applicable: no ERP-2 field rule targets a phone column', () => {
      expect(ERP2_NOT_APPLICABLE_RULES['RL-PHONE-01']).toBeDefined();
      expect(ERP2_FIELD_CLEAN_RULES.some((r) => /phone/i.test(r.field))).toBe(false);
      for (const id of Object.keys(ERP2_NOT_APPLICABLE_RULES)) expect(V1_RULE_IDS.has(id)).toBe(true);
    });

    it('rule toggles: disabling RL-TEXT-01 and RL-TAX-01 leaves padded values and logs no audit', () => {
      const res = cleanErp2Dataset([rawRow('R024')], ['RL-REQ-01', 'RL-FORMAT-01']);
      const r = res.rows[0]!;
      expect(r.cleanedData['vendor_code']).toBe(rawRow('R024')['vendor_code']);
      expect(res.audits).toHaveLength(0);
      expect(r.outcome).toBe('new');
    });
  });

  // ── AC2 ────────────────────────────────────────────────────────────────────
  describe('2. Field-level change audit trail (AC2)', () => {
    it('R024 audit carries source_row, field_name, original_value, cleaned_value and rule_id', () => {
      const a = auditsFor('R024', 'vendor_code')[0];
      expect(a).toBeDefined();
      expect(a?.sourceRow).toBe('R024');
      expect(a?.fieldName).toBe('vendor_code');
      expect(a?.originalValue).toBe(rawRow('R024')['vendor_code']);
      expect(a?.cleanedValue).toBe('VEN-024');
      expect(a?.ruleId).toBe('RL-TEXT-01');
    });

    it('every audit in the full Dirty Data Pack is complete and meaningful', () => {
      expect(DATASET.auditCount).toBeGreaterThan(0);
      expect(DATASET.audits).toHaveLength(DATASET.auditCount);
      for (const a of DATASET.audits) {
        expect(String(a.sourceRow)).toMatch(/^R\d{3}$/);
        expect(a.fieldName).not.toBe('');
        expect(a.ruleId).not.toBe('');
        expect(V1_RULE_IDS.has(a.ruleId), `${a.sourceRow}.${a.fieldName} rule ${a.ruleId}`).toBe(true);
        expect(a.originalValue).not.toBe(a.cleanedValue);
      }
    });

    it('row outcomes are consistent with audits and rejections', () => {
      expect(DATASET.totalRows).toBe(173);
      expect(DATASET.totalRows).toBe(MANIFEST.total_rows);
      expect(DATASET.newCount + DATASET.cleanedCount + DATASET.rejectedCount).toBe(173);
      for (const r of DATASET.rows) {
        if (r.outcome === 'new') expect(r.audits).toHaveLength(0);
        if (r.outcome === 'cleaned') {
          expect(r.audits.length).toBeGreaterThan(0);
          expect(r.rejections).toHaveLength(0);
        }
        if (r.outcome === 'rejected') expect(r.rejections.length).toBeGreaterThan(0);
      }
    });

    it('is deterministic across runs (ignoring timestamps)', () => {
      const strip = (audits: readonly FieldChangeAudit[]) =>
        audits.map(({ sourceRow, fieldName, originalValue, cleanedValue, ruleId }) => ({
          sourceRow, fieldName, originalValue, cleanedValue, ruleId,
        }));
      const again = cleanErp2Dataset(ROWS);
      expect(strip(again.audits)).toEqual(strip(DATASET.audits));
      expect(again.rows.map((r) => r.outcome)).toEqual(DATASET.rows.map((r) => r.outcome));
    });
  });

  // ── AC3 ────────────────────────────────────────────────────────────────────
  describe('3. Unrecoverable anomalies are rejected with a reason code (AC3)', () => {
    // Rejection reasons the cleaner must reproduce for every manifest row that carries them.
    // Excluded on purpose: reasons about cross-row/FK state (VENDOR_NOT_FOUND, PO_NOT_FOUND, ...),
    // totals (PO_TOTAL_MISMATCH ...), duplicates, and values the shared cleaner can legitimately repair
    // (INVALID_CURRENCY, INVALID_PRICE, INVALID_PO_TOTAL).
    const MUST_REJECT = [
      'VENDOR_CODE_REQUIRED',
      'VENDOR_NAME_REQUIRED',
      'VENDOR_CODE_TOO_LONG',
      'CURRENCY_REQUIRED',
      'INVALID_EMAIL',
      'INVALID_TAX_NUMBER',
      'INVALID_PAYMENT_TERMS',
      'PAYMENT_TERMS_OUT_OF_RANGE',
      'FORMULA_INJECTION_DETECTED',
      'PO_NUMBER_REQUIRED',
      'PO_VENDOR_REQUIRED',
      'PO_STATUS_REQUIRED',
      'INVALID_PO_STATUS',
      'PO_DATE_REQUIRED',
      'INVALID_DATE',
      'AMBIGUOUS_DATE_FORMAT_REVIEW',
      'PO_TOTAL_REQUIRED',
      'INVALID_LINE_NUMBER',
      'SKU_REQUIRED',
      'QUANTITY_REQUIRED',
      'QUANTITY_MUST_BE_POSITIVE',
      'INVALID_QUANTITY',
      'PRICE_REQUIRED',
      'PRICE_MUST_BE_NON_NEGATIVE',
    ];

    it.each(MUST_REJECT)('rejects every manifest row carrying %s with that reason code', (reason) => {
      const ids = Object.entries(MANIFEST.rows)
        .filter(([, r]) => r.reasons.includes(reason))
        .map(([id]) => id);
      expect(ids.length, `manifest rows for ${reason}`).toBeGreaterThan(0);
      for (const id of ids) {
        const r = rowResult(id);
        expect(r.outcome, `${id} ${reason}`).toBe('rejected');
        expect(r.rejections.map((x) => x.reasonCode), `${id}`).toContain(reason);
      }
    });

    it('multi-defect row R173 reports both defects', () => {
      const codes = rowResult('R173').rejections.map((r) => r.reasonCode);
      expect(codes).toContain('QUANTITY_MUST_BE_POSITIVE');
      expect(codes).toContain('PRICE_MUST_BE_NON_NEGATIVE');
    });

    it('rejections are structured: source row, field, registry rule id, reason code and message', () => {
      expect(DATASET.rejections.length).toBeGreaterThan(0);
      for (const rej of DATASET.rejections) {
        expect(String(rej.sourceRow)).toMatch(/^R\d{3}$/);
        expect(rej.field).not.toBe('');
        expect(V1_RULE_IDS.has(rej.ruleId), `${rej.sourceRow} ${rej.ruleId}`).toBe(true);
        expect(rej.reasonCode).toMatch(/^[A-Z_]+$/);
        expect(rej.message).not.toBe('');
      }
    });

    it('never rejects a row the ERP2-25 manifest accepts', () => {
      for (const r of DATASET.rows) {
        if (r.outcome !== 'rejected') continue;
        const id = String(r.sourceRow);
        expect(MANIFEST.rows[id]?.outcome, `${id}: ${r.rejections.map((x) => x.reasonCode).join(',')}`).not.toBe('accepted');
      }
    });

    it('formula-injection values are rejected untouched, never "cleaned"', () => {
      const { row, audits } = cleanOne(synthVendor({ vendor_name: '=HYPERLINK("http://example.com")' }));
      expect(row.outcome).toBe('rejected');
      expect(row.cleanedData['vendor_name']).toBe('=HYPERLINK("http://example.com")');
      expect(audits).toHaveLength(0);
    });

    it('ambiguous dates are never guessed', () => {
      for (const id of ['R087', 'R088']) {
        const r = rowResult(id);
        expect(r.outcome).toBe('rejected');
        expect(r.cleanedData['po_date']).toBe(rawRow(id)['po_date']);
      }
    });
  });

  // ── Non-destructive + security ─────────────────────────────────────────────
  describe('4. Non-destructive operation and sensitive data', () => {
    it('source CSV and parsed rows are untouched', () => {
      expect(sha256Hex(CSV_TEXT)).toBe(MANIFEST.fixture_sha256);
      const frozen = parseCsv(CSV_TEXT).map((row) => Object.freeze({ ...row }));
      const snapshot = JSON.stringify(frozen);
      expect(() => cleanErp2Dataset(frozen)).not.toThrow();
      expect(JSON.stringify(frozen)).toBe(snapshot);
      const after = readFileSync(CSV_PATH, 'utf8');
      expect(after).toBe(CSV_TEXT);
      expect(sha256Hex(after)).toBe(MANIFEST.fixture_sha256);
    });

    it('rawData keeps the original value of every audited field', () => {
      const r = rowResult('R043');
      expect(r.rawData['vendor_code']).toBe(rawRow('R043')['vendor_code']);
      expect(r.cleanedData['vendor_code']).not.toBe(r.rawData['vendor_code']);
    });

    it('bank details never appear in the result, the audit log or the audit CSV', () => {
      const rawBank = ROWS.map((r) => r.bank_account.trim()).filter((v) => v !== '');
      expect(rawBank.length).toBeGreaterThan(0);
      expect(DATASET.audits.some((a) => a.fieldName === 'bank_account')).toBe(false);
      const csv = exportErp2FieldAuditCsv(DATASET.audits);
      const serialised = JSON.stringify(DATASET) + csv;
      for (const v of rawBank) expect(serialised).not.toContain(v);
      expect(serialised).not.toContain('CH93-0000');
    });
  });

  // ── Audit export ───────────────────────────────────────────────────────────
  describe('5. Formula-safe audit export', () => {
    it('exports the audit log with its columns and row ids', () => {
      const csv = exportErp2FieldAuditCsv(DATASET.audits);
      for (const header of ['Source Row', 'Field Name', 'Original Value', 'Cleaned Value', 'Rule ID']) {
        expect(csv).toContain(header);
      }
      expect(csv).toContain('R024');
      expect(csv).toContain('RL-TEXT-01');
    });

    it('neutralises formula prefixes in exported cells', () => {
      const csv = exportErp2FieldAuditCsv([
        { sourceRow: 'X1', fieldName: 'vendor_name', originalValue: '=SUM(1+1)', cleanedValue: '@cmd', ruleId: 'RL-TEXT-01' },
      ]);
      const dataLines = csv.split('\n').slice(1);
      expect(dataLines.length).toBeGreaterThan(0);
      expect(dataLines.some((line) => /(^|,)"?[=@+]/.test(line))).toBe(false);
    });
  });
});
