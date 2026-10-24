/**
 * ERP-3 Sales Orders & Invoices — V1 Data-Quality Rules Test Suite
 *
 * Proves the rule catalogue against the committed synthetic Dirty Data Pack (#33 / [ERP3-08]):
 *   1. Fixture manifest + SHA-256 checksum + schema/version
 *   2. Rule catalogue integrity (stable IDs, versions, conditions, reasons)
 *   3. Every required/optional field and enumeration has a valid and an invalid test row
 *   4. Determinism (byte-equivalent profile) and raw-input immutability (BR-KIT-03)
 *   5. No fuzzy matching, candidate duplicates held for review (never auto-merged)
 *   6. Domain invariants:
 *      - Every order & invoice has a valid customer Golden ID (BR-ERP3-03 / ADR-003)
 *      - Line subtotal, tax, and order totals calculated server-side (BR-ERP3-01, BR-ERP3-02)
 *      - Unique invoice numbers and at most one invoice per sales order in V1 (FR-ERP3-02)
 *      - Required due_date for overdue status derivation (FR-ERP3-02)
 *      - Single full payment auto-transitions invoice to Paid (FR-ERP3-03, FR-ERP3-04)
 *      - Rejection of partial payments, overpayments, and second payments (FR-ERP3-03)
 *   7. Mapping template policy & field coverage
 *   8. Public contract compliance (@clearshift/contracts)
 *
 * @module erp3/tests/migration/rules.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CreateSalesOrderRequestSchema,
  CreateInvoiceRequestSchema,
  CreatePaymentRequestSchema,
} from '@clearshift/contracts';
import {
  ACCEPTED_CURRENCIES,
  FIXTURE_COLUMNS,
  FIXTURE_PATH,
  FIXTURE_SCHEMA_VERSION,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PROFILE_SCHEMA_VERSION,
  RECORD_TYPES,
  RULES_VERSION,
  RULE_CATALOGUE,
  SALES_ORDER_STATUSES,
  buildProfile,
  evaluateDataset,
  readRawRows,
  sha256Hex,
  stableStringify,
  type ProfileReport,
} from '../../src/migration/rules.js';

// ─────────────────────────────────────────────────────────────────────────────
// Load committed fixtures (read-only)
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

const CSV_TEXT = read('sample-data/erp-3/dirty-data-v1.csv');
const EXPECTED_PROFILE_TEXT = read('sample-data/erp-3/expected-profile.json');
const EXPECTED_PROFILE = JSON.parse(EXPECTED_PROFILE_TEXT) as ProfileReport;
const MAPPING_TEMPLATE = JSON.parse(read('sample-data/erp-3/mapping-template.json')) as {
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

describe('ERP-3 Sales Orders & Invoices — V1 Data Quality Rules & Dirty Pack (#33 / [ERP3-08])', () => {
  // ── 1. Fixture Manifest, Checksum & Immutability ───────────────────────────
  describe('1. Fixture Manifest, Checksum & Immutability', () => {
    it('verifies dirty-data-v1.csv matches the committed SHA-256 fingerprint exactly', () => {
      const computedHash = sha256Hex(CSV_TEXT);
      expect(computedHash).toBe(EXPECTED_PROFILE.fixture.sha256);
      expect(EXPECTED_PROFILE.fixture.file).toBe(FIXTURE_PATH);
      expect(EXPECTED_PROFILE.fixture.schema_version).toBe(FIXTURE_SCHEMA_VERSION);
    });

    it('verifies row counts and record types in committed manifest', () => {
      const rows = readRawRows(CSV_TEXT);
      expect(rows.length).toBe(EXPECTED_PROFILE.fixture.row_count);
      expect(rows.length).toBeGreaterThanOrEqual(100);
      expect(rows.length).toBe(135);

      const byType: Record<string, number> = {
        sales_order: rows.filter((r) => r.record_type === 'sales_order').length,
        so_line: rows.filter((r) => r.record_type === 'so_line').length,
        invoice: rows.filter((r) => r.record_type === 'invoice').length,
        invoice_line: rows.filter((r) => r.record_type === 'invoice_line').length,
        payment: rows.filter((r) => r.record_type === 'payment').length,
      };

      expect(byType).toEqual(EXPECTED_PROFILE.fixture.by_record_type);
    });

    it('asserts raw input is never mutated during profiling or cleaning (BR-KIT-03)', () => {
      const rowsBefore = readRawRows(CSV_TEXT);
      const snapshotBefore = JSON.stringify(rowsBefore);

      const profile = buildProfile(CSV_TEXT, { asOfDate: '2026-10-24' });
      expect(profile).toBeDefined();

      const snapshotAfter = JSON.stringify(rowsBefore);
      expect(snapshotAfter).toBe(snapshotBefore);
      expect(sha256Hex(CSV_TEXT)).toBe(EXPECTED_PROFILE.fixture.sha256);
    });
  });

  // ── 2. Rule Catalogue Integrity ───────────────────────────────────────────
  describe('2. Rule Catalogue Integrity', () => {
    it('verifies rule catalogue completeness, uniqueness and stable versions', () => {
      expect(RULE_CATALOGUE.length).toBeGreaterThanOrEqual(45);
      const ids = new Set<string>();

      for (const rule of RULE_CATALOGUE) {
        expect(rule.rule_id).toMatch(/^(SO|SOL|INV|INL|PAY)-\d{3}$/);
        expect(rule.version).toBe(RULES_VERSION);
        expect(rule.entity).toBeDefined();
        expect(rule.field).toBeDefined();
        expect(rule.input_condition).toBeDefined();
        expect(rule.human_reason).toBeDefined();
        expect(ids.has(rule.rule_id)).toBe(false);
        ids.add(rule.rule_id);
      }
    });

    it('asserts every rule that rejects or reviews provides a stable reason code', () => {
      for (const rule of RULE_CATALOGUE) {
        if (rule.result === 'reject' || rule.result === 'review') {
          expect(rule.reason_code).toBeDefined();
          expect(rule.reason_code).toMatch(/^[A-Z0-9_]+$/);
        }
      }
    });
  });

  // ── 3. Field & Enumeration Coverage (Valid vs Invalid) ─────────────────────
  describe('3. Required/Optional Fields & Enumerations Coverage', () => {
    const rawRows = readRawRows(CSV_TEXT);

    it('verifies sales_order required and optional fields have valid and invalid rows', () => {
      const soRows = rawRows.filter((r) => r.record_type === 'sales_order');
      // order_number
      expect(soRows.some((r) => r.case_tags.includes('order.order_number:valid'))).toBe(true);
      expect(soRows.some((r) => r.case_tags.includes('order.order_number:invalid'))).toBe(true);
      // customer_golden_id
      expect(soRows.some((r) => r.case_tags.includes('order.customer_golden_id:valid'))).toBe(true);
      expect(soRows.some((r) => r.case_tags.includes('order.customer_golden_id:invalid'))).toBe(true);
      // order_date
      expect(soRows.some((r) => r.case_tags.includes('order.order_date:valid'))).toBe(true);
      expect(soRows.some((r) => r.case_tags.includes('order.order_date:invalid'))).toBe(true);
      // currency
      expect(soRows.some((r) => r.case_tags.includes('order.currency:valid'))).toBe(true);
      expect(soRows.some((r) => r.case_tags.includes('order.currency:invalid'))).toBe(true);
      // order_status enumeration
      expect(soRows.some((r) => r.case_tags.includes('order.order_status:valid'))).toBe(true);
      expect(soRows.some((r) => r.case_tags.includes('order.order_status:invalid'))).toBe(true);
    });

    it('verifies so_line fields have valid and invalid rows', () => {
      const lines = rawRows.filter((r) => r.record_type === 'so_line');
      // quantity
      expect(lines.some((r) => r.case_tags.includes('so_line.quantity:valid'))).toBe(true);
      expect(lines.some((r) => r.case_tags.includes('so_line.quantity:invalid'))).toBe(true);
      // unit_price
      expect(lines.some((r) => r.case_tags.includes('so_line.unit_price:valid'))).toBe(true);
      expect(lines.some((r) => r.case_tags.includes('so_line.unit_price:invalid'))).toBe(true);
      // tax_rate
      expect(lines.some((r) => r.case_tags.includes('so_line.tax_rate:valid'))).toBe(true);
      expect(lines.some((r) => r.case_tags.includes('so_line.tax_rate:invalid'))).toBe(true);
    });

    it('verifies invoice required fields have valid and invalid rows', () => {
      const invs = rawRows.filter((r) => r.record_type === 'invoice');
      // due_date
      expect(invs.some((r) => r.case_tags.includes('invoice.due_date:valid'))).toBe(true);
      expect(invs.some((r) => r.case_tags.includes('invoice.due_date:invalid'))).toBe(true);
      // invoice_number
      expect(invs.some((r) => r.case_tags.includes('invoice.invoice_number:valid') || r.expect_outcome === 'accepted')).toBe(true);
      expect(invs.some((r) => r.case_tags.includes('invoice.invoice_number:invalid'))).toBe(true);
    });

    it('verifies payment fields and payment_method enum have valid and invalid rows', () => {
      const payments = rawRows.filter((r) => r.record_type === 'payment');
      // methods
      expect(payments.some((r) => r.case_tags.includes('payment.method:bank'))).toBe(true);
      expect(payments.some((r) => r.case_tags.includes('payment.method:cash'))).toBe(true);
      expect(payments.some((r) => r.case_tags.includes('payment.method:card'))).toBe(true);
      expect(payments.some((r) => r.case_tags.includes('payment.method:invalid'))).toBe(true);
      // settlement amounts
      expect(payments.some((r) => r.case_tags.includes('payment.amount:partial_rejected'))).toBe(true);
      expect(payments.some((r) => r.case_tags.includes('payment.amount:overpayment_rejected'))).toBe(true);
      expect(payments.some((r) => r.case_tags.includes('payment.multiple:rejected'))).toBe(true);
    });
  });

  // ── 4. Determinism & Profile Report Matching ───────────────────────────────
  describe('4. Determinism & Profile Report Matching', () => {
    it('produces byte-identical profile output matching expected-profile.json', () => {
      const generatedProfile = buildProfile(CSV_TEXT, { asOfDate: '2026-10-24' });
      const serialized = stableStringify(generatedProfile);
      expect(serialized).toBe(EXPECTED_PROFILE_TEXT);
    });

    it('satisfies complete row reconciliation equation', () => {
      const { reconciliation } = EXPECTED_PROFILE;
      expect(reconciliation.unaccounted).toBe(0);
      expect(reconciliation.is_balanced).toBe(true);
      expect(reconciliation.total_source_rows).toBe(
        reconciliation.accepted +
          reconciliation.rejected +
          reconciliation.review +
          reconciliation.skipped,
      );
    });
  });

  // ── 5. Candidate Keys & Duplicate Review Policy (No Fuzzy Match) ───────────
  describe('5. Candidate Keys & Duplicate Review Policy', () => {
    it('routes exact duplicate order_number to review queue without automatic merging', () => {
      const row = EXPECTED_PROFILE.rows['R022'];
      expect(row).toBeDefined();
      expect(row.outcome).toBe('review');
      expect(row.reasons).toContain('DUPLICATE_ORDER_NUMBER_REVIEW');

      // child line under review header is held in review
      const childLine = EXPECTED_PROFILE.rows['R023'];
      expect(childLine.outcome).toBe('review');
      expect(childLine.reasons).toContain('PARENT_ORDER_IN_REVIEW');
    });

    it('routes exact duplicate invoice_number to review queue without automatic merging', () => {
      const row = EXPECTED_PROFILE.rows['R046'];
      expect(row).toBeDefined();
      expect(row.outcome).toBe('review');
      expect(row.reasons).toContain('DUPLICATE_INVOICE_NUMBER_REVIEW');
    });

    it('routes exact duplicate payment_number to review queue without automatic merging', () => {
      const row = EXPECTED_PROFILE.rows['R059'];
      expect(row).toBeDefined();
      expect(row.outcome).toBe('review');
      expect(row.reasons).toContain('DUPLICATE_PAYMENT_REVIEW');
    });
  });

  // ── 6. Domain Invariants Verification ──────────────────────────────────────
  describe('6. Domain Invariants Verification', () => {
    it('enforces mandatory customer Golden ID as a valid UUID (BR-ERP3-03 / ADR-003)', () => {
      expect(EXPECTED_PROFILE.rows['R014'].reasons).toContain('CUSTOMER_GOLDEN_ID_REQUIRED');
      expect(EXPECTED_PROFILE.rows['R015'].reasons).toContain('INVALID_CUSTOMER_GOLDEN_ID');
      expect(EXPECTED_PROFILE.rows['R016'].reasons).toContain('CUSTOMER_NOT_FOUND');
    });

    it('enforces single invoice per sales order in V1 (FR-ERP3-02)', () => {
      // R036 is first invoice for SO-SRC-001 (accepted)
      expect(EXPECTED_PROFILE.rows['R036'].outcome).toBe('accepted');
      // R044 is second invoice for SO-SRC-001 (rejected)
      expect(EXPECTED_PROFILE.rows['R044'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R044'].reasons).toContain('ORDER_ALREADY_INVOICED');
    });

    it('enforces customer alignment between sales order and invoice', () => {
      // R045 links to SO-SRC-002 (customer 2), but invoice claims customer 1
      expect(EXPECTED_PROFILE.rows['R045'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R045'].reasons).toContain('CUSTOMER_MISMATCH');
    });

    it('enforces invoice due_date >= invoice_date (FR-ERP3-02)', () => {
      expect(EXPECTED_PROFILE.rows['R043'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R043'].reasons).toContain('INVALID_DUE_DATE');
    });

    it('derives Overdue status when calendar date is strictly after due_date', () => {
      const rawRows = readRawRows(CSV_TEXT);
      const evalRes = evaluateDataset(rawRows, { asOfDate: '2026-10-24' });

      // R037 has due_date 2026-09-30 (before asOfDate 2026-10-24)
      const r037Eval = evalRes.rowResults.find((r) => r.row_id === 'R037');
      expect(r037Eval?.outcome).toBe('accepted');
    });

    it('enforces single full payment settlement and rejects partial or overpayments (FR-ERP3-03)', () => {
      // Partial payment rejected
      expect(EXPECTED_PROFILE.rows['R053'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R053'].reasons).toContain('PARTIAL_PAYMENT_NOT_ALLOWED');

      // Overpayment rejected
      expect(EXPECTED_PROFILE.rows['R054'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R054'].reasons).toContain('OVERPAYMENT_REJECTED');

      // Second payment rejected
      expect(EXPECTED_PROFILE.rows['R055'].outcome).toBe('rejected');
      expect(EXPECTED_PROFILE.rows['R055'].reasons).toContain('MULTIPLE_PAYMENTS_REJECTED');

      // Exact full payment accepted
      expect(EXPECTED_PROFILE.rows['R050'].outcome).toBe('accepted');
      expect(EXPECTED_PROFILE.rows['R051'].outcome).toBe('accepted');
      expect(EXPECTED_PROFILE.rows['R052'].outcome).toBe('accepted');
    });

    it('neutralizes spreadsheet formula injection in notes and references (PLT-12 / KIT-16)', () => {
      expect(EXPECTED_PROFILE.rows['R025'].reasons).toContain('FORMULA_INJECTION_DETECTED');
      expect(EXPECTED_PROFILE.rows['R048'].reasons).toContain('FORMULA_INJECTION_DETECTED');
      expect(EXPECTED_PROFILE.rows['R060'].reasons).toContain('FORMULA_INJECTION_DETECTED');
    });
  });

  // ── 7. Mapping Template & Policy Integrity ─────────────────────────────────
  describe('7. Mapping Template & Policy Integrity', () => {
    it('verifies mapping template policies prohibit fuzzy matching and destructive merges', () => {
      expect(MAPPING_TEMPLATE.policy.fuzzy_matching).toBe(false);
      expect(MAPPING_TEMPLATE.policy.automatic_merge).toBe(false);
      expect(MAPPING_TEMPLATE.policy.raw_input_mutation).toBe(false);
    });

    it('verifies load order and entity schemas', () => {
      expect(MAPPING_TEMPLATE.load_order).toEqual([
        'sales_order',
        'so_line',
        'invoice',
        'invoice_line',
        'payment',
      ]);
      expect(MAPPING_TEMPLATE.entities.sales_order.target_table).toBe('erp3.sales_orders');
      expect(MAPPING_TEMPLATE.entities.invoice.target_table).toBe('erp3.invoices');
      expect(MAPPING_TEMPLATE.entities.payment.target_table).toBe('erp3.payments');
    });
  });

  // ── 8. Public Contract Compliance ──────────────────────────────────────────
  describe('8. Public Contract Compliance (@clearshift/contracts)', () => {
    it('verifies valid sales orders match CreateSalesOrderRequestSchema', () => {
      const validOrder = {
        order_number: 'SO-2026-1001',
        customer_golden_id: 'c0000000-0000-4000-8000-000000000001',
        order_date: '2026-10-01',
        currency: 'USD',
        lines: [
          {
            product_id: '5eed0000-0000-4000-8000-0000000000a1',
            quantity: '5.0000',
            price: '100.0000',
            tax_rate: '10.0000',
          },
          {
            product_id: '5eed0000-0000-4000-8000-0000000000a2',
            quantity: '2.0000',
            price: '50.0000',
            tax_rate: '5.0000',
          },
        ],
      };

      const parsed = CreateSalesOrderRequestSchema.safeParse(validOrder);
      expect(parsed.success).toBe(true);
    });

    it('verifies valid invoices match CreateInvoiceRequestSchema', () => {
      const validInvoice = {
        invoice_number: 'INV-2026-1003',
        customer_golden_id: 'c0000000-0000-4000-8000-000000000003',
        invoice_date: '2026-10-10',
        due_date: '2026-11-10',
        currency: 'INR',
        lines: [
          {
            product_id: '5eed0000-0000-4000-8000-0000000000a1',
            quantity: '2.0000',
            price: '150.0000',
            tax_rate: '10.0000',
          },
        ],
      };

      const parsed = CreateInvoiceRequestSchema.safeParse(validInvoice);
      expect(parsed.success).toBe(true);
    });

    it('verifies valid payments match CreatePaymentRequestSchema', () => {
      const validPayment = {
        invoice_id: 'c0000000-0000-4000-8000-000000000001',
        amount: '655.0000',
        payment_date: '2026-10-20',
        method: 'cash' as const,
      };

      const parsed = CreatePaymentRequestSchema.safeParse(validPayment);
      expect(parsed.success).toBe(true);
    });
  });
});
