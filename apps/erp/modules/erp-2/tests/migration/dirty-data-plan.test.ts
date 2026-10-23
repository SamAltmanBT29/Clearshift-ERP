/**
 * ERP-2 Vendors & Purchasing — Canonical Dirty Data Pack & Migration Profiling Test Suite
 *
 * Validates all Acceptance Criteria for [ERP2-25] (#141):
 * - AC 1: Dirty Data Pack contains at least 100 realistic synthetic rows; zero real personal data.
 * - AC 2: Manifest documents expected outcome per row: valid, malformed, null required,
 *         exact duplicate, foreign key missing.
 * - AC 3: Edge cases include UTF-8 characters, whitespace padding, date format variants, boundary numbers.
 * - AC 4: Fixture counts reproduce identically across multiple runs.
 *
 * Also verifies rule catalogue integrity, raw-input immutability, decimal rounding,
 * PO status transitions, formula-injection defence, bank-detail masking and mapping-template consistency.
 *
 * @module erp2/tests/migration/dirty-data-plan.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACCEPTED_CURRENCIES,
  ERP1_REFERENCE_SKUS,
  FIXTURE_COLUMNS,
  FIXTURE_PATH,
  FIXTURE_SCHEMA_VERSION,
  LOAD_ORDER,
  PO_STATUSES,
  PROFILE_SCHEMA_VERSION,
  RULES_VERSION,
  RULE_CATALOGUE,
  buildProfile,
  classifyDate,
  computeLineTotalMinor,
  evaluateDataset,
  formatMinor,
  hasFormulaPrefix,
  isValidIsoDate,
  isValidStatusPath,
  maskBankAccount,
  maskSensitiveFields,
  normalizeCode,
  normalizeEmail,
  normalizePoNumber,
  normalizeSku,
  normalizeStatus,
  normalizeTaxNumber,
  parseCsv,
  parseCsvRecords,
  parseScaledDecimal,
  sha256Hex,
  type EvaluatedRow,
  type ProfileReport,
  type RawRow,
} from '../../src/migration/dirty-data-plan.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

const csvText = read(FIXTURE_PATH);
const expectedProfileText = read('sample-data/erp-2/expected-profile.json');
const expectedProfile = JSON.parse(expectedProfileText) as ProfileReport;
const mappingTemplate = JSON.parse(read('sample-data/erp-2/mapping-template.json')) as Record<string, any>;

/** Builds a fully populated blank row so edge-case tests only specify what they care about. */
const blankRow = (over: Partial<RawRow>): RawRow => {
  const row = Object.fromEntries(FIXTURE_COLUMNS.map((c) => [c, ''])) as RawRow;
  return { ...row, ...over };
};

describe('ERP-2 Canonical Dirty Data Pack & Migration Rules ([ERP2-25] #141)', () => {
  const rawRows = parseCsv(csvText);
  const evaluated = evaluateDataset(rawRows);
  const byId = (id: string): EvaluatedRow => evaluated.find((r) => r.row_id === id)!;
  const reasonsOf = (tag: string): string[] =>
    rawRows.filter((r) => r.case_tags.includes(tag)).flatMap((r) => byId(r.row_id).reason_codes);

  // ── AC 1 ───────────────────────────────────────────────────────────────────
  describe('AC 1: Synthetic Dataset Scale & Privacy (Zero Real PII)', () => {
    it('contains at least 100 realistic synthetic rows (committed 173 rows)', () => {
      expect(rawRows.length).toBeGreaterThanOrEqual(100);
      expect(rawRows.length).toBe(173);
      expect(expectedProfile.total_rows).toBe(173);
    });

    it('has the documented header and a single synthetic source system', () => {
      expect(Object.keys(rawRows[0]!)).toEqual([...FIXTURE_COLUMNS]);
      expect(new Set(rawRows.map((r) => r.source_system))).toEqual(new Set(['SYNTH-ERP2-DIRTY-V1']));
      expect(new Set(rawRows.map((r) => r.row_id)).size).toBe(rawRows.length);
    });

    it('guarantees zero real personal data (reserved domains and dummy bank numbers only)', () => {
      for (const row of rawRows) {
        if (row.email && row.email !== 'not-an-email') {
          expect(row.email).toMatch(/^[a-zA-Z0-9._%+-]+@example\.(com|org|net)$/);
        }
        if (row.bank_account && row.bank_account !== '1234567890') {
          expect(row.bank_account).toMatch(/^CH93-0000-0000-0000-\d{4}-\d$/);
        }
        if (row.tax_number && row.tax_number !== '??') {
          expect(row.tax_number.trim()).toMatch(/^tax[- ]?\d{6}$/i);
        }
      }
    });

    it('distributes rows across the 3 canonical ERP-2 entities', () => {
      const count = (t: string): number => rawRows.filter((r) => r.record_type === t).length;
      expect(count('vendor')).toBe(46);
      expect(count('purchase_order')).toBe(44);
      expect(count('po_line')).toBe(83);
    });
  });

  // ── AC 2 ───────────────────────────────────────────────────────────────────
  describe('AC 2: Manifest Outcome Documentation Per Row', () => {
    it('manifest documents the expected outcome and reasons for all 173 rows', () => {
      expect(Object.keys(expectedProfile.rows)).toHaveLength(173);
      for (const row of evaluated) {
        const entry = expectedProfile.rows[row.row_id];
        expect(entry, `Missing manifest entry for ${row.row_id}`).toBeDefined();
        expect(entry!.outcome).toBe(row.outcome);
        expect(entry!.reasons).toEqual(row.reason_codes);
        expect(entry!.record_type).toBe(row.record_type);
      }
    });

    it('evaluator agrees with the independent expect_outcome / expect_reasons columns on every row', () => {
      for (const raw of rawRows) {
        const ev = byId(raw.row_id);
        expect(ev.outcome, raw.row_id).toBe(raw.expect_outcome);
        expect(ev.reason_codes, raw.row_id).toEqual(raw.expect_reasons ? raw.expect_reasons.split('|') : []);
      }
    });

    it('documents VALID rows (accepted, no reasons)', () => {
      expect(byId('R001').outcome).toBe('accepted');
      expect(byId('R001').reason_codes).toEqual([]);
      expect(evaluated.filter((r) => r.outcome === 'accepted').every((r) => r.reason_codes.length === 0)).toBe(true);
    });

    it('documents MALFORMED rows', () => {
      for (const code of [
        'INVALID_EMAIL', 'INVALID_TAX_NUMBER', 'INVALID_PAYMENT_TERMS', 'INVALID_BANK_DETAILS',
        'INVALID_CURRENCY', 'INVALID_DATE', 'INVALID_PO_STATUS', 'INVALID_STATUS_TRANSITION',
        'INVALID_PO_TOTAL', 'INVALID_LINE_NUMBER', 'INVALID_QUANTITY', 'INVALID_PRICE',
      ]) {
        expect(expectedProfile.by_reason_code[code], code).toBeGreaterThan(0);
      }
    });

    it('documents NULL REQUIRED rows', () => {
      for (const code of [
        'VENDOR_CODE_REQUIRED', 'VENDOR_NAME_REQUIRED', 'CURRENCY_REQUIRED', 'PO_NUMBER_REQUIRED',
        'PO_VENDOR_REQUIRED', 'PO_STATUS_REQUIRED', 'PO_DATE_REQUIRED', 'PO_TOTAL_REQUIRED',
        'SKU_REQUIRED', 'QUANTITY_REQUIRED', 'PRICE_REQUIRED',
      ]) {
        expect(expectedProfile.by_reason_code[code], code).toBeGreaterThan(0);
      }
    });

    it('documents EXACT DUPLICATE rows as review (never merged, never loaded)', () => {
      for (const code of [
        'DUPLICATE_VENDOR_CODE_REVIEW', 'DUPLICATE_TAX_NUMBER_REVIEW',
        'DUPLICATE_PO_NUMBER_REVIEW', 'DUPLICATE_LINE_REVIEW',
      ]) {
        expect(expectedProfile.by_reason_code[code], code).toBeGreaterThan(0);
      }
      const exactVendorDup = rawRows.find((r) => r.case_tags === 'vendor.record:exact_duplicate')!;
      expect(byId(exactVendorDup.row_id).outcome).toBe('review');
      expect(byId(exactVendorDup.row_id).reason_codes).toEqual([
        'DUPLICATE_VENDOR_CODE_REVIEW',
        'DUPLICATE_TAX_NUMBER_REVIEW',
      ]);
    });

    it('documents FOREIGN KEY MISSING rows (vendor, PO and ERP-1 product)', () => {
      expect(reasonsOf('foreign_key_missing')).toEqual(['VENDOR_NOT_FOUND', 'PO_NOT_FOUND', 'UNKNOWN_PRODUCT']);
      expect(reasonsOf('foreign_key_rejected_vendor')).toEqual(['VENDOR_NOT_FOUND']);
    });

    it('reconciles every source row to exactly one terminal outcome', () => {
      const r = expectedProfile.reconciliation;
      expect(r).toEqual({
        total_source_rows: 173, accepted: 94, rejected: 68, review: 11, skipped: 0, unaccounted: 0, is_balanced: true,
      });
      expect(r.accepted + r.rejected + r.review + r.skipped).toBe(r.total_source_rows);
      expect(expectedProfile.by_record_type['vendor']).toEqual({ accepted: 26, rejected: 15, review: 5, skipped: 0, total: 46 });
      expect(expectedProfile.by_record_type['purchase_order']).toEqual({ accepted: 22, rejected: 18, review: 4, skipped: 0, total: 44 });
      expect(expectedProfile.by_record_type['po_line']).toEqual({ accepted: 46, rejected: 35, review: 2, skipped: 0, total: 83 });
    });

    it('every reason code in the manifest exists in the rule catalogue', () => {
      const known = new Set(RULE_CATALOGUE.map((r) => r.reason_code));
      for (const code of Object.keys(expectedProfile.by_reason_code)) expect(known.has(code), code).toBe(true);
    });
  });

  // ── AC 3 ───────────────────────────────────────────────────────────────────
  describe('AC 3: Edge Cases (UTF-8, whitespace, date variants, boundary numbers)', () => {
    it('accepts UTF-8 vendor names unchanged', () => {
      const names = rawRows.filter((r) => r.case_tags === 'vendor.name:utf8');
      expect(names).toHaveLength(3);
      expect(names.map((r) => r.vendor_name)).toEqual(expect.arrayContaining(['Müller & Söhne Präzisionswerkzeuge GmbH']));
      for (const r of names) {
        expect(byId(r.row_id).outcome).toBe('accepted');
        expect(byId(r.row_id).normalized_data['vendor_name']).toBe(r.vendor_name.trim());
      }
    });

    it('normalises whitespace padding and case on natural keys without mutating the raw row', () => {
      const padded = rawRows.find((r) => r.vendor_code === '  VEN-024  ')!;
      expect(byId(padded.row_id).outcome).toBe('accepted');
      expect(byId(padded.row_id).normalized_data['vendor_code']).toBe('VEN-024');
      expect(byId(padded.row_id).normalized_data['tax_number']).toBe('TAX100024');
      expect(byId(padded.row_id).rule_ids).toEqual(expect.arrayContaining(['NRM-001', 'NRM-003']));
      expect(padded.vendor_code).toBe('  VEN-024  ');

      const statusCase = rawRows.find((r) => r.case_tags === 'purchase_order.po_status:whitespace_case')!;
      expect(byId(statusCase.row_id).outcome).toBe('accepted');
      expect(byId(statusCase.row_id).rule_ids).toContain('NRM-002');
    });

    it('handles date format variants: ISO ok, leap day ok, impossible date rejected, ambiguous held', () => {
      expect(byId(rawRows.find((r) => r.po_date === '2028-02-29')!.row_id).outcome).toBe('accepted');
      expect(reasonsOf('po_date:impossible')).toEqual(['INVALID_DATE']);
      expect(reasonsOf('po_date:ambiguous_slash')).toEqual(['AMBIGUOUS_DATE_FORMAT_REVIEW']);
      expect(reasonsOf('po_date:ambiguous_dot')).toEqual(['AMBIGUOUS_DATE_FORMAT_REVIEW']);
      expect(reasonsOf('expected_date:boundary_equal')).toEqual([]);
      expect(reasonsOf('expected_date:before_order_date')).toEqual(['EXPECTED_DATE_BEFORE_ORDER_DATE']);
    });

    it('handles boundary numbers: payment terms 0/365 accepted, -1/366 rejected, qty 0 and price 0', () => {
      expect(reasonsOf('payment_terms_days:boundary_min')).toEqual([]);
      expect(reasonsOf('payment_terms_days:boundary_max')).toEqual([]);
      expect(reasonsOf('payment_terms_days:boundary_below_min')).toEqual(['PAYMENT_TERMS_OUT_OF_RANGE']);
      expect(reasonsOf('payment_terms_days:boundary_above_max')).toEqual(['PAYMENT_TERMS_OUT_OF_RANGE']);
      expect(reasonsOf('quantity:boundary_zero')).toEqual(['QUANTITY_MUST_BE_POSITIVE']);
      expect(rawRows.some((r) => r.unit_price === '0' && byId(r.row_id).outcome === 'accepted')).toBe(true);
      expect(rawRows.some((r) => r.quantity === '0.001' && byId(r.row_id).outcome === 'accepted')).toBe(true);
    });

    it('applies documented ROUND_HALF_UP decimal rounding with exact PO totals', () => {
      const half = rawRows.find((r) => r.quantity === '1.005' && r.unit_price === '1')!;
      expect(byId(half.row_id).normalized_data['line_total']).toBe('1.01');
      const tiny = rawRows.find((r) => r.quantity === '0.001' && r.unit_price === '0.0001')!;
      expect(byId(tiny.row_id).normalized_data['line_total']).toBe('0.00');
      const third = rawRows.find((r) => r.quantity === '3' && r.unit_price === '0.3333')!;
      expect(byId(third.row_id).normalized_data['line_total']).toBe('1.00');
    });
  });

  // ── AC 4 ───────────────────────────────────────────────────────────────────
  describe('AC 4: Deterministic Reproducibility', () => {
    it('reproduces identical counts and manifest across repeated runs', () => {
      const runs = [1, 2, 3].map(() => {
        const rows = parseCsv(csvText);
        return buildProfile(csvText, evaluateDataset(rows));
      });
      expect(runs[1]).toEqual(runs[0]);
      expect(runs[2]).toEqual(runs[0]);
      expect(runs[0]).toEqual(expectedProfile);
    });

    it('regenerates a byte-identical expected-profile.json', () => {
      const profile = buildProfile(csvText, evaluateDataset(parseCsv(csvText)));
      expect(JSON.stringify(profile, null, 2) + '\n').toBe(expectedProfileText);
    });

    it('pins the committed fixture with a SHA-256 checksum', () => {
      expect(sha256Hex(csvText)).toBe(expectedProfile.fixture_sha256);
      expect(expectedProfile.fixture).toBe(FIXTURE_PATH);
      expect(expectedProfile.rules_version).toBe(RULES_VERSION);
      expect(expectedProfile.profile_schema_version).toBe(PROFILE_SCHEMA_VERSION);
      expect(FIXTURE_SCHEMA_VERSION).toBe(1);
    });

    it('does not mutate raw input rows (raw immutability)', () => {
      const rows = parseCsv(csvText);
      const snapshot = JSON.stringify(rows);
      rows.forEach((r) => Object.freeze(r));
      evaluateDataset(rows);
      expect(JSON.stringify(rows)).toBe(snapshot);
    });

    it('keeps original file order regardless of load order', () => {
      expect(evaluated.map((r) => r.row_id)).toEqual(rawRows.map((r) => r.row_id));
      expect(evaluated.map((r) => r.line_number)).toEqual(rawRows.map((_, i) => i + 2));
    });
  });

  // ── Rule catalogue ─────────────────────────────────────────────────────────
  describe('Rule catalogue integrity', () => {
    it('has unique rule ids and unique reason codes', () => {
      const ids = RULE_CATALOGUE.map((r) => r.rule_id);
      expect(new Set(ids).size).toBe(ids.length);
      const codes = RULE_CATALOGUE.map((r) => r.reason_code).filter((c): c is string => c !== null);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('documents every rule with version, explanation and doc reference', () => {
      for (const r of RULE_CATALOGUE) {
        expect(r.version).toBe(RULES_VERSION);
        expect(r.explanation.length).toBeGreaterThan(10);
        expect(r.doc_reference.length).toBeGreaterThan(3);
        expect(r.condition.length).toBeGreaterThan(3);
        if (r.action === 'normalize') expect(r.reason_code).toBeNull();
        else expect(r.reason_code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
    });

    it('covers all three entities and uses review (not reject) for duplicates', () => {
      for (const type of LOAD_ORDER) expect(RULE_CATALOGUE.some((r) => r.record_type === type)).toBe(true);
      for (const r of RULE_CATALOGUE.filter((x) => x.reason_code?.startsWith('DUPLICATE_'))) expect(r.action).toBe('review');
    });
  });

  // ── Security ───────────────────────────────────────────────────────────────
  describe('Security: formula injection and sensitive-field masking', () => {
    it('rejects OWASP formula prefixes on vendor and line fields, including tab and padded variants', () => {
      expect(reasonsOf('formula_injection')).toEqual([
        'FORMULA_INJECTION_DETECTED', 'FORMULA_INJECTION_DETECTED', 'FORMULA_INJECTION_DETECTED', 'FORMULA_INJECTION_DETECTED',
      ]);
      for (const prefixed of ['=1+1', '+1', '-1', '@SUM(1)', '\t=1', '\r=1', '  =1']) expect(hasFormulaPrefix(prefixed)).toBe(true);
      for (const safe of ['', 'ACME', ' ACME', 'a=b']) expect(hasFormulaPrefix(safe)).toBe(false);
    });

    it('masks bank accounts in masked_data and leaves no raw account number in it', () => {
      const withBank = rawRows.filter((r) => r.bank_account.startsWith('CH93'));
      expect(withBank.length).toBeGreaterThan(5);
      for (const r of withBank) {
        const masked = String(byId(r.row_id).masked_data['bank_account']);
        expect(masked).not.toBe(r.bank_account);
        expect(masked.replace(/[^A-Za-z0-9*]/g, '')).toMatch(/^\*+\d{4}$/);
        expect(masked.endsWith(r.bank_account.slice(-4))).toBe(true);
      }
      expect(maskBankAccount('CH93-0000-0000-0000-1002-2')).toBe('****-****-****-****-*002-2');
      expect(maskSensitiveFields(blankRow({ bank_account: '' }))['bank_account']).toBe('');
    });
  });

  // ── Unit coverage for primitives ───────────────────────────────────────────
  describe('Primitives', () => {
    it('parses CSV with quotes, escaped quotes, CRLF and trailing record', () => {
      expect(parseCsvRecords('a,b\r\n"x,1","say ""hi"""\r\nlast,')).toEqual([
        ['a', 'b'], ['x,1', 'say "hi"'], ['last', ''],
      ]);
      expect(parseCsvRecords('a\n\nb')).toEqual([['a'], ['b']]);
      expect(parseCsv('only,header')).toEqual([]);
      expect(parseCsv('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }]);
    });

    it('normalises keys, emails, statuses and tax numbers', () => {
      expect(normalizeCode('  ven-1 ')).toBe('VEN-1');
      expect(normalizePoNumber(' po-1 ')).toBe('PO-1');
      expect(normalizeSku(' sku-a ')).toBe('SKU-A');
      expect(normalizeTaxNumber(' tax-10 00 ')).toBe('TAX1000');
      expect(normalizeEmail(' A@Example.COM ')).toBe('a@example.com');
      expect(normalizeStatus(' sent ')).toBe('Sent');
      expect(normalizeStatus('Cancelled')).toBeNull();
    });

    it('does fixed-point decimal maths without floating point error', () => {
      expect(parseScaledDecimal('1.5', 3)).toEqual({ negative: false, units: BigInt(1500) });
      expect(parseScaledDecimal('-2', 2)).toEqual({ negative: true, units: BigInt(200) });
      expect(parseScaledDecimal('1.2345', 3)).toBeNull();
      expect(parseScaledDecimal('abc', 3)).toBeNull();
      expect(formatMinor(BigInt(5))).toBe('0.05');
      expect(formatMinor(BigInt(12345))).toBe('123.45');
      expect(computeLineTotalMinor(BigInt(1005), BigInt(10000))).toBe(BigInt(101));
      expect(computeLineTotalMinor(BigInt(3000), BigInt(3333))).toBe(BigInt(100));
    });

    it('validates calendar dates and classifies formats', () => {
      expect(isValidIsoDate('2028-02-29')).toBe(true);
      expect(isValidIsoDate('2026-02-29')).toBe(false);
      expect(isValidIsoDate('2100-02-29')).toBe(false);
      expect(isValidIsoDate('2000-02-29')).toBe(true);
      expect(isValidIsoDate('2026-04-31')).toBe(false);
      expect(isValidIsoDate('2026-13-01')).toBe(false);
      expect(isValidIsoDate('2026-1-5')).toBe(false);
      expect(classifyDate('')).toBe('empty');
      expect(classifyDate('2026-05-01')).toBe('iso');
      expect(classifyDate('01/05/2026')).toBe('ambiguous');
      expect(classifyDate('May 1st')).toBe('invalid');
    });

    it('enforces explicit PO status transitions Draft -> Sent -> Received -> Closed', () => {
      expect(PO_STATUSES).toEqual(['Draft', 'Sent', 'Received', 'Closed']);
      expect(isValidStatusPath('Draft>Sent>Received>Closed', 'Closed')).toBe(true);
      expect(isValidStatusPath('draft > sent', 'Sent')).toBe(true);
      expect(isValidStatusPath('Draft>Received', 'Received')).toBe(false);
      expect(isValidStatusPath('Sent>Received', 'Received')).toBe(false);
      expect(isValidStatusPath('Draft>Sent', 'Received')).toBe(false);
      expect(isValidStatusPath('Draft>Bogus', 'Sent')).toBe(false);
    });
  });

  // ── Evaluator behaviours not reachable from the fixture alone ──────────────
  describe('Evaluator edge behaviours', () => {
    it('skips unsupported record types without loading them', () => {
      const [row] = evaluateDataset([blankRow({ row_id: 'X1', record_type: 'customer' })]);
      expect(row!.outcome).toBe('skipped');
      expect(row!.reason_codes).toEqual(['UNSUPPORTED_RECORD_TYPE']);
      expect(row!.rule_ids).toEqual(['GEN-005']);
    });

    it('rejects a PO whose lines are all invalid (EMPTY_ORDER_LINES) and negative PO totals', () => {
      const vendor = blankRow({ row_id: 'V', record_type: 'vendor', vendor_code: 'V1', vendor_name: 'Vendor', currency: 'USD' });
      const po = blankRow({
        row_id: 'P', record_type: 'purchase_order', po_number: 'P1', po_vendor_code: 'V1', currency: 'USD',
        po_status: 'Draft', po_date: '2026-01-01', po_total: '-1.00',
      });
      const line = blankRow({ row_id: 'L', record_type: 'po_line', po_number: 'P1', line_no: '1', product_sku: 'NOPE', quantity: '1', unit_price: '1' });
      const [, poResult, lineResult] = evaluateDataset([vendor, po, line]);
      expect(poResult!.reason_codes).toEqual(['EMPTY_ORDER_LINES', 'INVALID_PO_TOTAL']);
      expect(lineResult!.reason_codes).toEqual(['UNKNOWN_PRODUCT', 'PO_NOT_FOUND']);
    });

    it('flags an unparsable expected date and a negative or oversized supplied line total', () => {
      const vendor = blankRow({ row_id: 'V', record_type: 'vendor', vendor_code: 'V1', vendor_name: 'Vendor', currency: 'USD' });
      const goodLine = blankRow({ row_id: 'L1', record_type: 'po_line', po_number: 'P1', line_no: '1', product_sku: ERP1_REFERENCE_SKUS[0], quantity: '2', unit_price: '1.50', line_total: '3.00' });
      const badTotal = blankRow({ row_id: 'L2', record_type: 'po_line', po_number: 'P1', line_no: '2', product_sku: ERP1_REFERENCE_SKUS[0], quantity: '2', unit_price: '1.50', line_total: '-3.00' });
      const po = blankRow({
        row_id: 'P', record_type: 'purchase_order', po_number: 'P1', po_vendor_code: 'V1', currency: 'USD',
        po_status: 'Draft', po_date: '2026-01-01', expected_date: 'soon', po_total: '3.00',
      });
      const out = evaluateDataset([vendor, po, goodLine, badTotal]);
      expect(out[1]!.reason_codes).toEqual(['INVALID_DATE']);
      expect(out[3]!.reason_codes).toEqual(['LINE_TOTAL_MISMATCH', 'PO_NOT_FOUND']);
    });

    it('supports lower-case currency only as an error and keeps accepted currencies in sync', () => {
      const [row] = evaluateDataset([blankRow({ row_id: 'V', record_type: 'vendor', vendor_code: 'V1', vendor_name: 'N', currency: 'usd' })]);
      expect(row!.reason_codes).toEqual(['INVALID_CURRENCY']);
      expect([...ACCEPTED_CURRENCIES]).toEqual(['USD', 'EUR', 'GBP', 'INR']);
    });
  });

  // ── Mapping template ───────────────────────────────────────────────────────
  describe('Mapping template consistency', () => {
    it('matches module constants', () => {
      expect(mappingTemplate['module']).toBe('erp2');
      expect(mappingTemplate['rules_version']).toBe(RULES_VERSION);
      expect(mappingTemplate['fixture']).toBe(FIXTURE_PATH);
      expect(mappingTemplate['load_order']).toEqual([...LOAD_ORDER]);
      expect(mappingTemplate['reference_fixtures'].accepted_currencies).toEqual([...ACCEPTED_CURRENCIES]);
      expect(mappingTemplate['reference_fixtures'].po_statuses).toEqual([...PO_STATUSES]);
      expect(mappingTemplate['reference_fixtures'].erp1_product_skus).toEqual([...ERP1_REFERENCE_SKUS]);
    });

    it('declares no fuzzy matching, no automatic merge and no raw mutation', () => {
      expect(mappingTemplate['policy'].fuzzy_matching).toBe(false);
      expect(mappingTemplate['policy'].automatic_merge).toBe(false);
      expect(mappingTemplate['policy'].raw_input_mutation).toBe(false);
    });

    it('maps each entity to its erp2 target table', () => {
      expect(mappingTemplate['entities'].vendor.target_table).toBe('erp2_vendors');
      expect(mappingTemplate['entities'].purchase_order.target_table).toBe('erp2_purchase_orders');
      expect(mappingTemplate['entities'].po_line.target_table).toBe('erp2_po_lines');
    });
  });
});
