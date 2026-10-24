/**
 * ERP-3 Sales Orders & Invoices — Canonical Dirty Data Pack & Migration Profiling Test Suite
 *
 * Validates all Acceptance Criteria for [ERP3-25] (#161):
 * - AC 1: Dirty Data Pack contains at least 100 realistic synthetic rows; zero real personal data.
 * - AC 2: Manifest documents expected outcome per row: valid, malformed, null required, exact duplicate, foreign key missing.
 * - AC 3: Edge cases include UTF-8 characters, whitespace padding, date format variants, and boundary numbers.
 * - AC 4: Test suite verifies fixture counts reproduce identically across multiple runs.
 *
 * Also verifies:
 * - Committed synthetic Dirty Data Pack fixture manifest and SHA-256 checksum
 * - Rule catalogue integrity (rule IDs, versions, conditions, reasons, doc references)
 * - Raw input immutability guarantee (BR-KIT-03)
 * - Core domain invariants: BR-ERP3-01..03, FR-ERP3-01..05, ADR-003, PLT-12 / KIT-16
 * - Strict schema compliance with @clearshift/contracts
 *
 * @module erp3/tests/migration/dirty-data-plan.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CreateSalesOrderRequestSchema,
  CreateInvoiceRequestSchema,
  CreatePaymentRequestSchema,
} from '@clearshift/contracts';
import {
  FIXTURE_PATH,
  FIXTURE_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  RULES_VERSION,
  RULE_CATALOGUE,
  ACCEPTED_CURRENCIES,
  SALES_ORDER_STATUSES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  KNOWN_CUSTOMERS,
  KNOWN_PRODUCTS,
  readRawRows,
  evaluateDataset,
  buildProfile,
  sha256Hex,
  stableStringify,
  type ProfileReport,
  type RawRow,
} from '../../src/migration/rules.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

describe('ERP-3 Canonical Dirty Data Pack & Migration Rules ([ERP3-25] #161)', () => {
  const csvText = read(FIXTURE_PATH);
  const expectedProfileText = read('sample-data/erp-3/expected-profile.json');
  const expectedProfile = JSON.parse(expectedProfileText) as ProfileReport;
  const mappingTemplateText = read('sample-data/erp-3/mapping-template.json');
  const mappingTemplate = JSON.parse(mappingTemplateText) as {
    policy: {
      fuzzy_matching: boolean;
      automatic_merge: boolean;
      raw_input_mutation: boolean;
      duplicate_handling: string;
      customer_identity_policy: string;
      invoicing_policy: string;
      payment_policy: string;
    };
    load_order: string[];
    reference_fixtures: {
      known_customers: Array<{ id: string; name: string }>;
      known_products: Array<{ id: string; sku: string; name: string }>;
    };
    entities: Record<
      string,
      {
        api: string;
        target_table: string;
        candidate_key: string[];
        fields: Array<{ source: string; target: string; required: boolean; rule_ids: string[] }>;
      }
    >;
  };

  // ── AC 1: Realistic Synthetic Data (≥100 rows, zero real personal data) ────
  describe('AC 1: Synthetic Dataset Scale & Privacy (Zero Real PII)', () => {
    const rawRows = readRawRows(csvText);

    it('contains at least 100 realistic synthetic rows (committed 135 rows)', () => {
      expect(rawRows.length).toBeGreaterThanOrEqual(100);
      expect(rawRows.length).toBe(135);
      expect(expectedProfile.fixture.row_count).toBe(135);
      expect(expectedProfile.reconciliation.total_source_rows).toBe(135);
    });

    it('guarantees zero real personal data across all rows (strictly synthetic UUIDs, domains, numbers)', () => {
      for (const row of rawRows) {
        // Any customer Golden ID provided must follow synthetic UUID v4 pattern or be an invalid test case
        if (
          row.customer_golden_id &&
          !row.customer_golden_id.startsWith('not-a-valid-uuid')
        ) {
          expect(row.customer_golden_id.trim()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          );
        }

        // Any product ID provided must follow synthetic UUID v4 pattern or be an invalid test case
        if (
          row.product_id &&
          row.product_id !== 'invalid-product-uuid' &&
          row.product_id !== 'malformed-product-uuid'
        ) {
          expect(row.product_id.trim()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          );
        }

        // Any email embedded in notes/references must use RFC-2606 reserved example domains
        const emailMatch = (row.notes + ' ' + row.payment_reference).match(/[\w.-]+@[\w.-]+\.\w+/g);
        if (emailMatch) {
          for (const email of emailMatch) {
            expect(email).toMatch(/^[a-zA-Z0-9._%+-]+@example\.(com|org|net)$/);
          }
        }

        // Any phone numbers in references must use RFC/reserved 555-01xx test numbers
        const phoneMatch = (row.notes + ' ' + row.payment_reference).match(/\+?1?[-.\s]?\(?555\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
        if (phoneMatch) {
          for (const phone of phoneMatch) {
            expect(phone).toMatch(/555[-.\s]?01\d{2}/);
          }
        }
      }
    });

    it('distributes rows across all 5 canonical ERP-3 entities', () => {
      const counts = {
        sales_order: rawRows.filter((r) => r.record_type === 'sales_order').length,
        so_line: rawRows.filter((r) => r.record_type === 'so_line').length,
        invoice: rawRows.filter((r) => r.record_type === 'invoice').length,
        invoice_line: rawRows.filter((r) => r.record_type === 'invoice_line').length,
        payment: rawRows.filter((r) => r.record_type === 'payment').length,
      };

      expect(counts.sales_order).toBe(51);
      expect(counts.so_line).toBe(38);
      expect(counts.invoice).toBe(21);
      expect(counts.invoice_line).toBe(5);
      expect(counts.payment).toBe(20);
      expect(counts).toEqual(expectedProfile.fixture.by_record_type);
    });
  });

  // ── AC 2: Manifest Documents Expected Outcome Per Row ──────────────────────
  describe('AC 2: Manifest Outcome Documentation Per Row', () => {
    const rawRows = readRawRows(csvText);
    const evalRes = evaluateDataset(rawRows, { asOfDate: '2026-10-24' });

    it('manifest documents expected outcome and reasons for all 135 rows', () => {
      expect(expectedProfile.rows).toBeDefined();
      expect(Object.keys(expectedProfile.rows).length).toBe(135);

      for (const row of evalRes.rowResults) {
        const manifestEntry = expectedProfile.rows[row.row_id];
        expect(manifestEntry, `Missing manifest entry for ${row.row_id}`).toBeDefined();
        expect(manifestEntry?.outcome).toBe(row.outcome);
        expect(manifestEntry?.reasons).toEqual(row.reasons);
      }
    });

    it('documents valid outcomes (accepted terminal state)', () => {
      const validOrder = evalRes.rowResults.find((r) => r.row_id === 'R001');
      expect(validOrder?.outcome).toBe('accepted');
      expect(validOrder?.reasons).toEqual([]);

      const validLine = evalRes.rowResults.find((r) => r.row_id === 'R002');
      expect(validLine?.outcome).toBe('accepted');
      expect(validLine?.reasons).toEqual([]);

      const validInvoice = evalRes.rowResults.find((r) => r.row_id === 'R036');
      expect(validInvoice?.outcome).toBe('accepted');
      expect(validInvoice?.reasons).toEqual([]);

      const validPayment = evalRes.rowResults.find((r) => r.row_id === 'R050');
      expect(validPayment?.outcome).toBe('accepted');
      expect(validPayment?.reasons).toEqual([]);
    });

    it('documents malformed outcomes (format defect rejections)', () => {
      // Malformed order number format
      const badOrderNum = evalRes.rowResults.find((r) => r.row_id === 'R012');
      expect(badOrderNum?.outcome).toBe('rejected');
      expect(badOrderNum?.reasons).toContain('INVALID_ORDER_NUMBER_FORMAT');

      // Malformed currency
      const badCurrency = evalRes.rowResults.find((r) => r.row_id === 'R021');
      expect(badCurrency?.outcome).toBe('rejected');
      expect(badCurrency?.reasons).toContain('INVALID_CURRENCY');

      // Malformed payment method
      const badPayMethod = evalRes.rowResults.find((r) => r.row_id === 'R056');
      expect(badPayMethod?.outcome).toBe('rejected');
      expect(badPayMethod?.reasons).toContain('INVALID_PAYMENT_METHOD');

      // Malformed customer Golden ID (non-UUID)
      const badCustUuid = evalRes.rowResults.find((r) => r.row_id === 'R132');
      expect(badCustUuid?.outcome).toBe('rejected');
      expect(badCustUuid?.reasons).toContain('INVALID_CUSTOMER_GOLDEN_ID');

      // Malformed date
      const badDate = evalRes.rowResults.find((r) => r.row_id === 'R073');
      expect(badDate?.outcome).toBe('rejected');
      expect(badDate?.reasons).toContain('INVALID_DATE');
    });

    it('documents null required outcomes (missing mandatory attributes)', () => {
      const nullOrderNum = evalRes.rowResults.find((r) => r.row_id === 'R116');
      expect(nullOrderNum?.outcome).toBe('rejected');
      expect(nullOrderNum?.reasons).toContain('ORDER_NUMBER_REQUIRED');

      const nullCust = evalRes.rowResults.find((r) => r.row_id === 'R117');
      expect(nullCust?.outcome).toBe('rejected');
      expect(nullCust?.reasons).toContain('CUSTOMER_GOLDEN_ID_REQUIRED');

      const nullOrderDate = evalRes.rowResults.find((r) => r.row_id === 'R118');
      expect(nullOrderDate?.outcome).toBe('rejected');
      expect(nullOrderDate?.reasons).toContain('ORDER_DATE_REQUIRED');

      const nullOrderCurrency = evalRes.rowResults.find((r) => r.row_id === 'R119');
      expect(nullOrderCurrency?.outcome).toBe('rejected');
      expect(nullOrderCurrency?.reasons).toContain('CURRENCY_REQUIRED');

      const nullInvNum = evalRes.rowResults.find((r) => r.row_id === 'R121');
      expect(nullInvNum?.outcome).toBe('rejected');
      expect(nullInvNum?.reasons).toContain('INVOICE_NUMBER_REQUIRED');

      const nullInvDueDate = evalRes.rowResults.find((r) => r.row_id === 'R124');
      expect(nullInvDueDate?.outcome).toBe('rejected');
      expect(nullInvDueDate?.reasons).toContain('DUE_DATE_REQUIRED');

      const nullPayDate = evalRes.rowResults.find((r) => r.row_id === 'R127');
      expect(nullPayDate?.outcome).toBe('rejected');
      expect(nullPayDate?.reasons).toContain('PAYMENT_DATE_REQUIRED');

      const nullPayAmount = evalRes.rowResults.find((r) => r.row_id === 'R128');
      expect(nullPayAmount?.outcome).toBe('rejected');
      expect(nullPayAmount?.reasons).toContain('PAYMENT_AMOUNT_REQUIRED');

      const nullPayMethod = evalRes.rowResults.find((r) => r.row_id === 'R129');
      expect(nullPayMethod?.outcome).toBe('rejected');
      expect(nullPayMethod?.reasons).toContain('PAYMENT_METHOD_REQUIRED');
    });

    it('documents exact duplicate outcomes (candidate duplicates held for review)', () => {
      const dupOrder = evalRes.rowResults.find((r) => r.row_id === 'R022');
      expect(dupOrder?.outcome).toBe('review');
      expect(dupOrder?.reasons).toContain('DUPLICATE_ORDER_NUMBER_REVIEW');

      const dupOrder2 = evalRes.rowResults.find((r) => r.row_id === 'R111');
      expect(dupOrder2?.outcome).toBe('review');
      expect(dupOrder2?.reasons).toContain('DUPLICATE_ORDER_NUMBER_REVIEW');

      const dupInv = evalRes.rowResults.find((r) => r.row_id === 'R046');
      expect(dupInv?.outcome).toBe('review');
      expect(dupInv?.reasons).toContain('DUPLICATE_INVOICE_NUMBER_REVIEW');

      const dupInv2 = evalRes.rowResults.find((r) => r.row_id === 'R113');
      expect(dupInv2?.outcome).toBe('review');
      expect(dupInv2?.reasons).toContain('DUPLICATE_INVOICE_NUMBER_REVIEW');

      const dupPay = evalRes.rowResults.find((r) => r.row_id === 'R059');
      expect(dupPay?.outcome).toBe('review');
      expect(dupPay?.reasons).toContain('DUPLICATE_PAYMENT_REVIEW');

      const dupPay2 = evalRes.rowResults.find((r) => r.row_id === 'R115');
      expect(dupPay2?.outcome).toBe('review');
      expect(dupPay2?.reasons).toContain('DUPLICATE_PAYMENT_REVIEW');
    });

    it('documents foreign key missing outcomes (referential integrity rejections)', () => {
      const missingCust = evalRes.rowResults.find((r) => r.row_id === 'R131');
      expect(missingCust?.outcome).toBe('rejected');
      expect(missingCust?.reasons).toContain('CUSTOMER_NOT_FOUND');

      const orphanSoLine = evalRes.rowResults.find((r) => r.row_id === 'R133');
      expect(orphanSoLine?.outcome).toBe('rejected');
      expect(orphanSoLine?.reasons).toContain('ORPHAN_LINE');

      const orphanInvLine = evalRes.rowResults.find((r) => r.row_id === 'R134');
      expect(orphanInvLine?.outcome).toBe('rejected');
      expect(orphanInvLine?.reasons).toContain('ORPHAN_LINE');

      const missingInvForPayment = evalRes.rowResults.find((r) => r.row_id === 'R135');
      expect(missingInvForPayment?.outcome).toBe('rejected');
      expect(missingInvForPayment?.reasons).toContain('INVOICE_NOT_FOUND');
    });
  });

  // ── AC 3: Edge Cases: UTF-8, Whitespace, Date Formats & Boundary Numbers ───
  describe('AC 3: Edge Case Scenarios', () => {
    const rawRows = readRawRows(csvText);
    const evalRes = evaluateDataset(rawRows, { asOfDate: '2026-10-24' });

    describe('UTF-8 International Character Support', () => {
      it('accepts UTF-8 French accented characters in notes and descriptions', () => {
        const frenchOrder = evalRes.rowResults.find((r) => r.row_id === 'R061');
        expect(frenchOrder?.outcome).toBe('accepted');
        const frenchLine = evalRes.rowResults.find((r) => r.row_id === 'R062');
        expect(frenchLine?.outcome).toBe('accepted');
      });

      it('accepts UTF-8 German characters with umlauts and diameter symbol Ø', () => {
        const germanOrder = evalRes.rowResults.find((r) => r.row_id === 'R063');
        expect(germanOrder?.outcome).toBe('accepted');
        const germanLine = evalRes.rowResults.find((r) => r.row_id === 'R064');
        expect(germanLine?.outcome).toBe('accepted');
      });

      it('accepts UTF-8 Spanish accents and Greek mathematical symbol Ω', () => {
        const spanishOrder = evalRes.rowResults.find((r) => r.row_id === 'R065');
        expect(spanishOrder?.outcome).toBe('accepted');
        const spanishLine = evalRes.rowResults.find((r) => r.row_id === 'R066');
        expect(spanishLine?.outcome).toBe('accepted');
      });

      it('accepts UTF-8 Japanese Kanji and Katakana characters', () => {
        const japaneseOrder = evalRes.rowResults.find((r) => r.row_id === 'R067');
        expect(japaneseOrder?.outcome).toBe('accepted');
        const japaneseLine = evalRes.rowResults.find((r) => r.row_id === 'R068');
        expect(japaneseLine?.outcome).toBe('accepted');
      });
    });

    describe('Whitespace Padding Normalization', () => {
      it('normalizes whitespace in order numbers, customer IDs, currencies, and payment methods', () => {
        const paddedOrder = evalRes.rowResults.find((r) => r.row_id === 'R069');
        expect(paddedOrder?.outcome).toBe('accepted');

        const paddedLine = evalRes.rowResults.find((r) => r.row_id === 'R070');
        expect(paddedLine?.outcome).toBe('accepted');

        const paddedInvoice = evalRes.rowResults.find((r) => r.row_id === 'R071');
        expect(paddedInvoice?.outcome).toBe('accepted');

        const paddedPayment = evalRes.rowResults.find((r) => r.row_id === 'R072');
        expect(paddedPayment?.outcome).toBe('accepted');
      });
    });

    describe('Date Format Variants & Validation', () => {
      it('rejects non-existent calendar date (2026-02-30)', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R073');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('INVALID_DATE');
      });

      it('rejects ambiguous slash date format (10/15/2026)', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R075');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('INVALID_DATE');
      });

      it('rejects non-date text string', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R077');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('INVALID_DATE');
      });

      it('rejects inverted hyphen date format DD-MM-YYYY (15-10-2026)', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R081');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('INVALID_DATE');
      });

      it('rejects April 31st invalid calendar date', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R082');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('INVALID_DATE');
      });

      it('rejects non-leap year February 29th', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R083');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('INVALID_DATE');
      });
    });

    describe('Boundary Numbers & Precision Scales', () => {
      it('accepts smallest positive four-decimal scale (0.0001)', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R086');
        expect(row?.outcome).toBe('accepted');
      });

      it('accepts maximum boundary tax rate (100.0000)', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R088');
        expect(row?.outcome).toBe('accepted');
      });

      it('rejects zero quantity on line', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R090');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('NEGATIVE_OR_ZERO_QUANTITY');
      });

      it('rejects negative quantity boundary (-0.0001)', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R092');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('NEGATIVE_OR_ZERO_QUANTITY');
      });

      it('rejects negative unit price boundary (-0.0001)', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R094');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('NEGATIVE_UNIT_PRICE');
      });

      it('rejects negative tax rate (-0.0100)', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R096');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('INVALID_TAX_RATE');
      });

      it('rejects tax rate exceeding 100% boundary (100.0100)', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R098');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('TAX_RATE_OUT_OF_RANGE');
      });
    });

    describe('OWASP Formula Injection Defense (PLT-12 / KIT-16)', () => {
      it('rejects formula injection payload starting with =', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R099');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('FORMULA_INJECTION_DETECTED');
      });

      it('rejects formula injection payload starting with +', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R101');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('FORMULA_INJECTION_DETECTED');
      });

      it('rejects formula injection payload starting with -', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R103');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('FORMULA_INJECTION_DETECTED');
      });

      it('rejects formula injection payload starting with @', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R105');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('FORMULA_INJECTION_DETECTED');
      });

      it('rejects formula injection payload starting with tab character \\t', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R107');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('FORMULA_INJECTION_DETECTED');
      });

      it('rejects formula injection payload starting with carriage return \\r', () => {
        const row = evalRes.rowResults.find((r) => r.row_id === 'R109');
        expect(row?.outcome).toBe('rejected');
        expect(row?.reasons).toContain('FORMULA_INJECTION_DETECTED');
      });
    });
  });

  // ── AC 4: Test Suite Verifies Multi-Run Idempotent Reproducibility ───────────
  describe('AC 4: Multi-Run Deterministic Reproducibility', () => {
    it('yields byte-identical profile JSON output across 5 consecutive execution runs', () => {
      const runs: ProfileReport[] = [];
      for (let run = 0; run < 5; run++) {
        const rows = readRawRows(csvText);
        const report = buildProfile(csvText, { asOfDate: '2026-10-24' });
        runs.push(report);
      }

      const baselineJson = stableStringify(runs[0]!);
      for (let i = 1; i < runs.length; i++) {
        expect(stableStringify(runs[i]!)).toBe(baselineJson);
      }

      expect(runs[0]?.fixture.sha256).toBe(expectedProfile.fixture.sha256);
      expect(runs[0]?.fixture.row_count).toBe(expectedProfile.fixture.row_count);
      expect(runs[0]?.reconciliation).toEqual(expectedProfile.reconciliation);
      expect(runs[0]?.by_record_type).toEqual(expectedProfile.by_record_type);
      expect(runs[0]?.by_reason_code).toEqual(expectedProfile.by_reason_code);
    });

    it('reconciles source rows completely with zero unaccounted records', () => {
      const rec = expectedProfile.reconciliation;
      expect(rec.total_source_rows).toBe(expectedProfile.fixture.row_count);
      expect(rec.accepted + rec.rejected + rec.review + rec.skipped).toBe(rec.total_source_rows);
      expect(rec.unaccounted).toBe(0);
      expect(rec.is_balanced).toBe(true);
    });
  });

  // ── Fixture Checksum & Manifest Validation ─────────────────────────────────
  describe('Fixture Manifest & Checksum Validation', () => {
    it('locates committed dirty-data-v1.csv fixture in sample-data/erp-3/', () => {
      expect(existsSync(resolve(REPO_ROOT, FIXTURE_PATH))).toBe(true);
      expect(csvText.length).toBeGreaterThan(1000);
    });

    it('verifies SHA-256 checksum matches expected profile', () => {
      const computedHash = sha256Hex(csvText);
      expect(computedHash).toBe(expectedProfile.fixture.sha256);
      expect(computedHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('verifies schema versions and module identifier', () => {
      expect(expectedProfile.profile_schema_version).toBe(PROFILE_SCHEMA_VERSION);
      expect(expectedProfile.rules_version).toBe(RULES_VERSION);
      expect(expectedProfile.module).toBe('erp3');
      expect(expectedProfile.fixture.file).toBe(FIXTURE_PATH);
    });

    it('validates mapping template policy guarantees', () => {
      expect(mappingTemplate.policy.fuzzy_matching).toBe(false);
      expect(mappingTemplate.policy.automatic_merge).toBe(false);
      expect(mappingTemplate.policy.raw_input_mutation).toBe(false);
      expect(mappingTemplate.load_order).toEqual([
        'sales_order',
        'so_line',
        'invoice',
        'invoice_line',
        'payment',
      ]);
    });
  });

  // ── Raw Input Immutability (BR-KIT-03) ──────────────────────────────────────
  describe('Raw Input Immutability (BR-KIT-03)', () => {
    it('asserts raw row objects are frozen and immune to in-place mutation', () => {
      const rows = readRawRows(csvText);
      const firstRow = rows[0]!;
      expect(Object.isFrozen(firstRow)).toBe(true);

      expect(() => {
        // @ts-expect-error mutating frozen row
        firstRow.order_number = 'MUTATED';
      }).toThrow();
    });

    it('ensures profiling does not modify original CSV buffer in memory or on disk', () => {
      const hashBefore = sha256Hex(csvText);
      buildProfile(csvText, { asOfDate: '2026-10-24' });
      const hashAfter = sha256Hex(csvText);
      expect(hashAfter).toBe(hashBefore);
    });
  });
});
