/**
 * ERP-3 Sales Orders & Invoices — Mapping & Value Translation Automated Tests
 * (Issue #164 / ERP3-28 / KIT-05)
 *
 * Test coverage:
 * - AC1: Source-to-target field mapping templates with strict type coercion rules.
 * - AC2: Enum translation tables mapping legacy values to domain allowlists.
 * - AC3: Unmapped required target fields raise validation error and block dry-run/load execution.
 * - AC4: Named, versioned, reproducible templates across migration runs.
 * - Invariant: High-precision decimal numeric(19,4) string arithmetic & synthetic test data only.
 *
 * @module erp3/tests/migration/mapping
 */

import { describe, it, expect } from 'vitest';
import {
  translateEnum,
  coerceDecimalAmount,
  roundDecimalHalfUp,
  coerceIsoDate,
  coerceBoolean,
  coerceInteger,
  coerceUuid,
  ORDER_STATUS_TRANSLATION_MAP,
  INVOICE_STATUS_TRANSLATION_MAP,
  PAYMENT_METHOD_TRANSLATION_MAP,
  CURRENCY_TRANSLATION_MAP,
  EnumTranslationError,
  validateTemplate,
  validateEntityTemplate,
  validateAgainstHeaders,
  assertDryRunReady,
  validateErp3Mapping,
  MappingValidationError,
  mapRow,
  dryRun,
  transformSourceRowToTarget,
  transformDataset,
  ERP3_DEFAULT_MAPPING_TEMPLATES,
  ERP3_CANONICAL_MAPPING_TEMPLATE,
  templateId,
  templateFingerprint,
  erp3TargetEntities,
  REQUIRED_TARGETS,
  type MappingTemplate,
} from '../../src/migration/mapping-config.js';

describe('[ERP3-28] ERP-3 Sales Orders & Invoices: Mapping/Value Translation Configuration (#164)', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Type Coercion Engine (AC1)
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Type Coercion Engine (AC1)', () => {
    it('coerces valid formatted currency strings to standard 4-decimal strings', () => {
      expect(coerceDecimalAmount('550', 'amount')).toBe('550.0000');
      expect(coerceDecimalAmount('  $ 150,000.50 ', 'unit_price')).toBe('150000.5000');
      expect(coerceDecimalAmount('₹25,00,000.7500', 'line_total')).toBe('2500000.7500');
      expect(coerceDecimalAmount('€1,234.5678', 'price')).toBe('1234.5678');
      expect(coerceDecimalAmount('-₹20,000.00', 'amount')).toBe('-20000.0000');
      expect(coerceDecimalAmount('(500.25)', 'amount')).toBe('-500.2500');
      expect(coerceDecimalAmount('0', 'tax_rate')).toBe('0.0000');
    });

    it('rejects unparseable decimal amounts with structured TypeError', () => {
      expect(() => coerceDecimalAmount('invalid-number', 'amount')).toThrowError(
        /cannot be parsed as a valid numeric decimal/
      );
      expect(() => coerceDecimalAmount('', 'amount')).toThrowError(
        /Missing numeric decimal amount/
      );
    });

    it('roundDecimalHalfUp performs exact half-up string rounding without float drift', () => {
      expect(roundDecimalHalfUp('100.55555', 4)).toBe('100.5556');
      expect(roundDecimalHalfUp('100.55554', 4)).toBe('100.5555');
      expect(roundDecimalHalfUp(' $ 1,234.5678 ', 4)).toBe('1234.5678');
      expect(roundDecimalHalfUp('-50.12345', 4)).toBe('-50.1235');
      expect(roundDecimalHalfUp('0.00000', 4)).toBe('0.0000');
      expect(roundDecimalHalfUp('not-a-number', 4)).toBeNull();
    });

    it('coerces various legacy date formats to ISO 8601 (YYYY-MM-DD)', () => {
      expect(coerceIsoDate('2026-10-01', 'order_date')).toBe('2026-10-01');
      expect(coerceIsoDate('2026/10/01', 'order_date')).toBe('2026-10-01');
      expect(coerceIsoDate('01-10-2026', 'order_date')).toBe('2026-10-01');
      expect(coerceIsoDate('15/10/2026', 'due_date')).toBe('2026-10-15');
      expect(coerceIsoDate('2026-10-15T12:00:00.000Z', 'due_date')).toBe('2026-10-15');
    });

    it('rejects invalid or impossible calendar dates', () => {
      expect(() => coerceIsoDate('not-a-date', 'order_date')).toThrowError(
        /not a recognized date format/
      );
      expect(() => coerceIsoDate('', 'order_date')).toThrowError(/Missing date/);
      expect(() => coerceIsoDate('2026-02-31', 'order_date')).toThrowError(
        /impossible calendar date/
      );
      expect(() => coerceIsoDate('31/02/2026', 'order_date')).toThrowError(
        /impossible calendar date/
      );
    });

    it('coerces boolean values reliably', () => {
      expect(coerceBoolean('true')).toBe(true);
      expect(coerceBoolean('1')).toBe(true);
      expect(coerceBoolean('yes')).toBe(true);
      expect(coerceBoolean('y')).toBe(true);
      expect(coerceBoolean('false')).toBe(false);
      expect(coerceBoolean('0')).toBe(false);
      expect(coerceBoolean('no')).toBe(false);
      expect(coerceBoolean('n')).toBe(false);
      expect(coerceBoolean('', true)).toBe(true);
      expect(coerceBoolean(null, false)).toBe(false);
    });

    it('coerces integers reliably and rejects non-integers', () => {
      expect(coerceInteger('1', 'line_number')).toBe(1);
      expect(coerceInteger('  42 ', 'line_number')).toBe(42);
      expect(coerceInteger('-5', 'line_number')).toBe(-5);
      expect(() => coerceInteger('1.5', 'line_number')).toThrowError(/not a valid integer/);
      expect(() => coerceInteger('abc', 'line_number')).toThrowError(/not a valid integer/);
    });

    it('coerces canonical RFC 4122 UUIDs and rejects invalid UUID strings', () => {
      const validUuid = 'c0000000-0000-4000-8000-000000000001';
      expect(coerceUuid(validUuid, 'customer_golden_id')).toBe(validUuid);
      expect(coerceUuid(validUuid.toUpperCase(), 'customer_golden_id')).toBe(validUuid);
      expect(() => coerceUuid('not-a-uuid', 'customer_golden_id')).toThrowError(
        /not a valid RFC 4122 UUID/
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Enum Translation Tables (AC2)
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Enum Translation Tables (AC2)', () => {
    it('translates legacy order status values to domain allowlist (Open, Invoiced, Closed)', () => {
      expect(translateEnum('open', ORDER_STATUS_TRANSLATION_MAP, 'order_status')).toBe('Open');
      expect(translateEnum('NEW', ORDER_STATUS_TRANSLATION_MAP, 'order_status')).toBe('Open');
      expect(translateEnum('Draft', ORDER_STATUS_TRANSLATION_MAP, 'order_status')).toBe('Open');
      expect(translateEnum('pending', ORDER_STATUS_TRANSLATION_MAP, 'order_status')).toBe('Open');

      expect(translateEnum('invoiced', ORDER_STATUS_TRANSLATION_MAP, 'order_status')).toBe('Invoiced');
      expect(translateEnum('BILLED', ORDER_STATUS_TRANSLATION_MAP, 'order_status')).toBe('Invoiced');

      expect(translateEnum('closed', ORDER_STATUS_TRANSLATION_MAP, 'order_status')).toBe('Closed');
      expect(translateEnum('Completed', ORDER_STATUS_TRANSLATION_MAP, 'order_status')).toBe('Closed');
      expect(translateEnum('Done', ORDER_STATUS_TRANSLATION_MAP, 'order_status')).toBe('Closed');
      expect(translateEnum('CANCELLED', ORDER_STATUS_TRANSLATION_MAP, 'order_status')).toBe('Closed');
    });

    it('translates legacy invoice status values to domain allowlist (Open, Paid, Overdue)', () => {
      expect(translateEnum('open', INVOICE_STATUS_TRANSLATION_MAP, 'invoice_status')).toBe('Open');
      expect(translateEnum('UNPAID', INVOICE_STATUS_TRANSLATION_MAP, 'invoice_status')).toBe('Open');
      expect(translateEnum('pending', INVOICE_STATUS_TRANSLATION_MAP, 'invoice_status')).toBe('Open');

      expect(translateEnum('paid', INVOICE_STATUS_TRANSLATION_MAP, 'invoice_status')).toBe('Paid');
      expect(translateEnum('SETTLED', INVOICE_STATUS_TRANSLATION_MAP, 'invoice_status')).toBe('Paid');
      expect(translateEnum('cleared', INVOICE_STATUS_TRANSLATION_MAP, 'invoice_status')).toBe('Paid');

      expect(translateEnum('overdue', INVOICE_STATUS_TRANSLATION_MAP, 'invoice_status')).toBe('Overdue');
      expect(translateEnum('past due', INVOICE_STATUS_TRANSLATION_MAP, 'invoice_status')).toBe('Overdue');
      expect(translateEnum('DELINQUENT', INVOICE_STATUS_TRANSLATION_MAP, 'invoice_status')).toBe('Overdue');
    });

    it('translates legacy payment methods to domain allowlist (cash, bank, card)', () => {
      expect(translateEnum('cash', PAYMENT_METHOD_TRANSLATION_MAP, 'payment_method')).toBe('cash');
      expect(translateEnum('Currency', PAYMENT_METHOD_TRANSLATION_MAP, 'payment_method')).toBe('cash');

      expect(translateEnum('bank', PAYMENT_METHOD_TRANSLATION_MAP, 'payment_method')).toBe('bank');
      expect(translateEnum('wire transfer', PAYMENT_METHOD_TRANSLATION_MAP, 'payment_method')).toBe('bank');
      expect(translateEnum('ACH', PAYMENT_METHOD_TRANSLATION_MAP, 'payment_method')).toBe('bank');
      expect(translateEnum('neft', PAYMENT_METHOD_TRANSLATION_MAP, 'payment_method')).toBe('bank');
      expect(translateEnum('RTGS', PAYMENT_METHOD_TRANSLATION_MAP, 'payment_method')).toBe('bank');

      expect(translateEnum('card', PAYMENT_METHOD_TRANSLATION_MAP, 'payment_method')).toBe('card');
      expect(translateEnum('credit card', PAYMENT_METHOD_TRANSLATION_MAP, 'payment_method')).toBe('card');
      expect(translateEnum('DEBIT CARD', PAYMENT_METHOD_TRANSLATION_MAP, 'payment_method')).toBe('card');
      expect(translateEnum('Visa', PAYMENT_METHOD_TRANSLATION_MAP, 'payment_method')).toBe('card');
    });

    it('translates currency strings and symbols to ISO 4217 standard codes (USD, EUR, INR)', () => {
      expect(translateEnum('usd', CURRENCY_TRANSLATION_MAP, 'currency')).toBe('USD');
      expect(translateEnum('$', CURRENCY_TRANSLATION_MAP, 'currency')).toBe('USD');
      expect(translateEnum('dollar', CURRENCY_TRANSLATION_MAP, 'currency')).toBe('USD');

      expect(translateEnum('eur', CURRENCY_TRANSLATION_MAP, 'currency')).toBe('EUR');
      expect(translateEnum('€', CURRENCY_TRANSLATION_MAP, 'currency')).toBe('EUR');
      expect(translateEnum('euro', CURRENCY_TRANSLATION_MAP, 'currency')).toBe('EUR');

      expect(translateEnum('inr', CURRENCY_TRANSLATION_MAP, 'currency')).toBe('INR');
      expect(translateEnum('₹', CURRENCY_TRANSLATION_MAP, 'currency')).toBe('INR');
      expect(translateEnum('rs.', CURRENCY_TRANSLATION_MAP, 'currency')).toBe('INR');
      expect(translateEnum('rupee', CURRENCY_TRANSLATION_MAP, 'currency')).toBe('INR');
    });

    it('raises EnumTranslationError when encountering unmapped enum values', () => {
      expect(() =>
        translateEnum('UNKNOWN_STATUS', ORDER_STATUS_TRANSLATION_MAP, 'order_status')
      ).toThrowError(EnumTranslationError);

      try {
        translateEnum('CRYPTO', CURRENCY_TRANSLATION_MAP, 'currency');
      } catch (e: any) {
        expect(e).toBeInstanceOf(EnumTranslationError);
        expect(e.fieldName).toBe('currency');
        expect(e.sourceValue).toBe('CRYPTO');
        expect(e.allowedValues).toContain('USD');
      }
    });

    it('applies defaultValue when source value is empty and default is provided', () => {
      expect(translateEnum('', ORDER_STATUS_TRANSLATION_MAP, 'order_status', 'Open')).toBe('Open');
      expect(translateEnum(null, ORDER_STATUS_TRANSLATION_MAP, 'order_status', 'Open')).toBe('Open');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Required Target Column Enforcement Guards (AC3)
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Required Target Column Enforcement Guards (AC3)', () => {
    it('validates a complete sales_order mapping successfully', () => {
      const mapping = {
        order_number: 'legacy_order_no',
        customer_golden_id: 'legacy_cust_id',
        order_date: 'legacy_date',
        currency: 'legacy_curr',
        source_id: 'legacy_src_id',
      };
      const result = validateErp3Mapping('sales_order', mapping);
      expect(result.valid).toBe(true);
      expect(result.missingRequiredFields).toHaveLength(0);
    });

    it('flags unmapped required target fields and blocks execution', () => {
      // Omit customer_golden_id and currency
      const incompleteMapping = {
        order_number: 'legacy_order_no',
        order_date: 'legacy_date',
        source_id: 'legacy_src_id',
      };
      const result = validateErp3Mapping('sales_order', incompleteMapping);
      expect(result.valid).toBe(false);
      expect(result.missingRequiredFields).toContain('Customer Golden ID');
      expect(result.missingRequiredFields).toContain('Currency Code');
    });

    it('validates required target columns defined in REQUIRED_TARGETS', () => {
      expect(REQUIRED_TARGETS.sales_order).toContain('order_number');
      expect(REQUIRED_TARGETS.sales_order).toContain('customer_golden_id');
      expect(REQUIRED_TARGETS.sales_order).toContain('order_date');
      expect(REQUIRED_TARGETS.sales_order).toContain('currency');
      expect(REQUIRED_TARGETS.sales_order).toContain('source_id');

      expect(REQUIRED_TARGETS.so_line).toContain('order_id');
      expect(REQUIRED_TARGETS.so_line).toContain('product_id');
      expect(REQUIRED_TARGETS.so_line).toContain('quantity');
      expect(REQUIRED_TARGETS.so_line).toContain('unit_price');

      expect(REQUIRED_TARGETS.invoice).toContain('invoice_number');
      expect(REQUIRED_TARGETS.invoice).toContain('due_date');

      expect(REQUIRED_TARGETS.payment).toContain('invoice_id');
      expect(REQUIRED_TARGETS.payment).toContain('amount');
      expect(REQUIRED_TARGETS.payment).toContain('method');
    });

    it('validateEntityTemplate identifies unmapped required targets', () => {
      const issues = validateEntityTemplate('sales_order', [
        { source: 'col1', target: 'order_number', type: 'string', required: true },
        // Missing customer_golden_id, order_date, currency, source_id
      ]);

      expect(issues.length).toBeGreaterThan(0);
      const unmapped = issues.filter((i) => i.code === 'UNMAPPED_REQUIRED_TARGET');
      expect(unmapped.some((i) => i.target === 'customer_golden_id')).toBe(true);
      expect(unmapped.some((i) => i.target === 'order_date')).toBe(true);
      expect(unmapped.some((i) => i.target === 'currency')).toBe(true);
    });

    it('assertDryRunReady throws MappingValidationError when required header is missing', () => {
      const canonical = ERP3_CANONICAL_MAPPING_TEMPLATE;
      // Missing required header 'order_number'
      const headers = ['source_id', 'customer_golden_id', 'order_date', 'currency'];

      expect(() => {
        assertDryRunReady(canonical, 'sales_order', headers);
      }).toThrowError(MappingValidationError);

      try {
        assertDryRunReady(canonical, 'sales_order', headers);
      } catch (err: any) {
        expect(err).toBeInstanceOf(MappingValidationError);
        expect(err.httpStatus).toBe(400);
        expect(err.code).toBe('MAPPING_VALIDATION_FAILED');
        const envelope = err.toEnvelope();
        expect(envelope.code).toBe('MAPPING_VALIDATION_FAILED');
        expect(envelope.details.issues.length).toBeGreaterThan(0);
      }
    });

    it('reports unknown entity cleanly via validateErp3Mapping', () => {
      const result = validateErp3Mapping('non_existent_entity', {});
      expect(result.valid).toBe(false);
      expect(result.missingRequiredFields[0]).toContain('Unknown entity');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Named, Versioned Mapping Templates (AC4)
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Named, Versioned Mapping Templates (AC4)', () => {
    it('provides reproducible canonical template erp3-canonical-v1', () => {
      expect(ERP3_DEFAULT_MAPPING_TEMPLATES.length).toBeGreaterThan(0);
      const canonical = ERP3_CANONICAL_MAPPING_TEMPLATE;

      expect(canonical.templateId).toBe('erp3-canonical-v1');
      expect(canonical.version).toBe('1.0.0');
      expect(canonical.module).toBe('erp3');
      expect(canonical.mappingSchemaVersion).toBe(1);

      // Verify all 5 domain entities are present
      expect(canonical.entities.sales_order).toBeDefined();
      expect(canonical.entities.so_line).toBeDefined();
      expect(canonical.entities.invoice).toBeDefined();
      expect(canonical.entities.invoice_line).toBeDefined();
      expect(canonical.entities.payment).toBeDefined();
    });

    it('matches target table schemas defined in SDS §4.7 and db/schema.ts', () => {
      expect(ERP3_CANONICAL_MAPPING_TEMPLATE.entities.sales_order.targetTable).toBe('erp3.sales_orders');
      expect(ERP3_CANONICAL_MAPPING_TEMPLATE.entities.so_line.targetTable).toBe('erp3.so_lines');
      expect(ERP3_CANONICAL_MAPPING_TEMPLATE.entities.invoice.targetTable).toBe('erp3.invoices');
      expect(ERP3_CANONICAL_MAPPING_TEMPLATE.entities.invoice_line.targetTable).toBe('erp3.invoice_lines');
      expect(ERP3_CANONICAL_MAPPING_TEMPLATE.entities.payment.targetTable).toBe('erp3.payments');
    });

    it('computes stable, reproducible templateFingerprint across runs', () => {
      const t = ERP3_CANONICAL_MAPPING_TEMPLATE;
      const id = templateId(t);
      const fp1 = templateFingerprint(t);
      const fp2 = templateFingerprint(t);

      expect(id).toBe(`${t.name}@${t.version}`);
      expect(fp1).toHaveLength(64);
      expect(fp1).toBe(fp2);
    });

    it('validates canonical template structure without errors', () => {
      const issues = validateTemplate(ERP3_CANONICAL_MAPPING_TEMPLATE);
      expect(issues).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Row & Dataset Transformation Engine
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Row & Dataset Transformation Engine', () => {
    it('projects and coerces legacy sales_order row to clean target schema', () => {
      const mapping = {
        source_id: 'src_id',
        order_number: 'src_so_num',
        customer_golden_id: 'src_cust_id',
        order_date: 'src_date',
        status: 'src_status',
        currency: 'src_curr',
        notes: 'src_notes',
      };
      const sourceRow = {
        src_id: 'SO-SRC-001',
        src_so_num: 'SO-2026-1001',
        src_cust_id: 'c0000000-0000-4000-8000-000000000001',
        src_date: '2026/10/01',
        src_status: 'open',
        src_curr: '$',
        src_notes: 'Commercial delivery',
      };

      const outcome = transformSourceRowToTarget('sales_order', mapping, sourceRow);
      expect(outcome.success).toBe(true);
      expect(outcome.data.source_id).toBe('SO-SRC-001');
      expect(outcome.data.order_number).toBe('SO-2026-1001');
      expect(outcome.data.customer_golden_id).toBe('c0000000-0000-4000-8000-000000000001');
      expect(outcome.data.order_date).toBe('2026-10-01');
      expect(outcome.data.status).toBe('Open');
      expect(outcome.data.currency).toBe('USD');
      expect(outcome.data.notes).toBe('Commercial delivery');
    });

    it('projects and coerces payment row with currency formatting and bank method', () => {
      const mapping = {
        source_id: 'src_id',
        invoice_id: 'src_inv_ref',
        payment_number: 'src_pay_num',
        payment_date: 'src_date',
        amount: 'src_amount',
        method: 'src_method',
        currency: 'src_curr',
      };
      const sourceRow = {
        src_id: 'PAY-SRC-001',
        src_inv_ref: 'INV-SRC-001',
        src_pay_num: 'PAY-2026-1001',
        src_date: '06-10-2026',
        src_amount: ' $ 550.00 ',
        src_method: 'Wire Transfer',
        src_curr: 'USD',
      };

      const outcome = transformSourceRowToTarget('payment', mapping, sourceRow);
      expect(outcome.success).toBe(true);
      expect(outcome.data.source_id).toBe('PAY-SRC-001');
      expect(outcome.data.invoice_id).toBe('INV-SRC-001');
      expect(outcome.data.payment_date).toBe('2026-10-06');
      expect(outcome.data.amount).toBe('550.0000');
      expect(outcome.data.method).toBe('bank');
      expect(outcome.data.currency).toBe('USD');
    });

    it('accurately accumulates errors on invalid row data', () => {
      const mapping = {
        source_id: 'src_id',
        order_number: 'src_so_num',
        customer_golden_id: 'src_cust_id',
        order_date: 'src_date',
        currency: 'src_curr',
      };
      const invalidRow = {
        src_id: 'SO-BAD',
        src_so_num: '', // Empty required
        src_cust_id: 'not-a-uuid',
        src_date: '2026-99-99',
        src_curr: 'BITCOIN',
      };

      const outcome = transformSourceRowToTarget('sales_order', mapping, invalidRow);
      expect(outcome.success).toBe(false);
      expect(outcome.errors.length).toBeGreaterThan(0);
      expect(outcome.errors.some((e) => e.includes('Missing required target field'))).toBe(true);
    });

    it('transforms entire dataset and reports counts accurately', () => {
      const mapping = {
        source_id: 'id',
        order_number: 'num',
        customer_golden_id: 'cust',
        order_date: 'dt',
        currency: 'curr',
      };
      const rows = [
        {
          id: '1',
          num: 'SO-001',
          cust: 'c0000000-0000-4000-8000-000000000001',
          dt: '2026-10-01',
          curr: 'USD',
        },
        {
          id: '2',
          num: 'SO-002',
          cust: 'c0000000-0000-4000-8000-000000000002',
          dt: '2026-10-02',
          curr: 'EUR',
        },
        {
          id: '3',
          num: '',
          cust: 'invalid',
          dt: 'bad-date',
          curr: 'XYZ',
        },
      ];

      const result = transformDataset('sales_order', mapping, rows);
      expect(result.totalRows).toBe(3);
      expect(result.successCount).toBe(2);
      expect(result.failedCount).toBe(1);
    });

    it('performs dryRun using canonical template and dirty data rows', () => {
      const canonical = ERP3_CANONICAL_MAPPING_TEMPLATE;
      const headers = [
        'source_id',
        'order_number',
        'customer_golden_id',
        'order_date',
        'order_status',
        'currency',
        'notes',
      ];
      const rows = [
        {
          source_id: 'SO-SRC-001',
          order_number: 'SO-2026-1001',
          customer_golden_id: 'c0000000-0000-4000-8000-000000000001',
          order_date: '2026-10-01',
          order_status: 'Open',
          currency: 'USD',
          notes: 'Test order',
        },
        {
          source_id: 'SO-SRC-002',
          order_number: 'SO-2026-1002',
          customer_golden_id: 'c0000000-0000-4000-8000-000000000002',
          order_date: '2026-10-02',
          order_status: 'Invoiced',
          currency: 'EUR',
          notes: 'European shipment',
        },
      ];

      const result = dryRun(canonical, 'sales_order', headers, rows);
      expect(result.validRows).toBe(2);
      expect(result.invalidRows).toBe(0);
      expect(result.rows[0]?.values.status).toBe('Open');
      expect(result.rows[1]?.values.status).toBe('Invoiced');
    });
  });
});
