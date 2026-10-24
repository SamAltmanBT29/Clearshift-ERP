import { describe, it, expect } from 'vitest';
import {
  erp3OrdersRejectionContext,
  erp3InvoicesRejectionContext,
  erp3FailureExplanations,
} from '../../src/kit/rejection-context.js';
import {
  resolveFailureExplanation,
  exportRejectedRowsCsv,
  maskRejectedRow,
  type RejectedRow,
} from '@cs/kit';

describe('ERP-3 Sales Orders Migration Rejection Context (ERP3-23 / KIT-16)', () => {
  it('defines valid module context targeting sales_orders entity', () => {
    expect(erp3OrdersRejectionContext.moduleId).toBe('erp3');
    expect(erp3OrdersRejectionContext.entity).toBe('sales_orders');
    expect(erp3OrdersRejectionContext.moduleName).toContain('Sales Orders');
  });

  describe('1. Module Identifier Columns (AC1)', () => {
    it('defines primary natural identifiers: order_number, customer_golden_id, source_id, and currency', () => {
      const idFields = erp3OrdersRejectionContext.identifierColumns.map((c) => c.field);
      expect(idFields).toContain('order_number');
      expect(idFields).toContain('customer_golden_id');
      expect(idFields).toContain('source_id');
      expect(idFields).toContain('currency');

      const orderCol = erp3OrdersRejectionContext.identifierColumns.find((c) => c.field === 'order_number');
      expect(orderCol?.isIdentifier).toBe(true);
      expect(orderCol?.format?.('  so-2026-0001  ', {} as RejectedRow)).toBe('SO-2026-0001');
    });

    it('includes secondary context columns: order_date, status, total, notes', () => {
      const addFields = (erp3OrdersRejectionContext.additionalColumns || []).map((c) => c.field);
      expect(addFields).toContain('order_date');
      expect(addFields).toContain('status');
      expect(addFields).toContain('total');
      expect(addFields).toContain('notes');
    });

    it('defines valid invoice rejection context', () => {
      expect(erp3InvoicesRejectionContext.moduleId).toBe('erp3');
      expect(erp3InvoicesRejectionContext.entity).toBe('invoices');
      const invoiceIdFields = erp3InvoicesRejectionContext.identifierColumns.map((c) => c.field);
      expect(invoiceIdFields).toContain('invoice_number');
      expect(invoiceIdFields).toContain('order_id');
    });
  });

  describe('2. Standardized Error Codes & Failure Explanations (AC2)', () => {
    const requiredCodes = [
      'DUPLICATE_ORDER_NUMBER',
      'MISSING_CUSTOMER_GOLDEN_ID',
      'INVALID_ORDER_STATUS',
      'NEGATIVE_QUANTITY',
      'NEGATIVE_UNIT_PRICE',
      'INVALID_CURRENCY',
      'INVALID_INVOICE_DUE_DATE',
      'MULTIPLE_INVOICES_PER_ORDER',
      'UNRESOLVED_PRODUCT_REFERENCE',
      'SOURCE_VALUE_MUTATED',
      'TOTAL_MISMATCH',
      'MISSING_REQUIRED_FIELD',
    ];

    it.each(requiredCodes)('provides detailed failure explanation for %s', (code) => {
      const expl = erp3FailureExplanations[code];
      expect(expl).toBeDefined();
      expect(expl!.code).toBe(code);
      expect(expl!.title.length).toBeGreaterThan(0);
      expect(expl!.explanation.length).toBeGreaterThan(15);
      expect(expl!.docReference).toBeDefined();
      expect(expl!.resolution).toBeDefined();
    });

    it('resolves duplicate order number explanation with BR-ERP3-01 reference', () => {
      const expl = resolveFailureExplanation(erp3OrdersRejectionContext, 'DUPLICATE_ORDER_NUMBER');
      expect(expl.docReference).toBe('BR-ERP3-01');
      expect(expl.explanation).toContain('BR-ERP3-01');
      expect(expl.resolution).toContain('re-map source order number');
    });

    it('resolves missing customer golden ID explanation with BR-ERP3-03 reference', () => {
      const expl = resolveFailureExplanation(erp3OrdersRejectionContext, 'MISSING_CUSTOMER_GOLDEN_ID');
      expect(expl.docReference).toBe('BR-ERP3-03');
      expect(expl.explanation).toContain('CRM-1');
      expect(expl.resolution).toContain('CRM-1 Hub');
    });

    it('resolves invalid order status explanation with FR-ERP3-05 reference', () => {
      const expl = resolveFailureExplanation(erp3OrdersRejectionContext, 'INVALID_ORDER_STATUS');
      expect(expl.docReference).toBe('FR-ERP3-05');
      expect(expl.explanation).toContain('Open -> Invoiced -> Closed');
    });

    it('resolves contextual links for searching orders by order number', () => {
      const linkConfig = erp3OrdersRejectionContext.contextualLinks?.find(
        (l) => l.label === 'Search Orders'
      );
      expect(linkConfig).toBeDefined();

      const dummyRow: RejectedRow = {
        id: 'r1',
        batchId: 'b1',
        sourceRow: 1,
        entity: 'sales_orders',
        errorCode: 'DUPLICATE_ORDER_NUMBER',
        rawData: { order_number: 'SO-1001' },
      };
      const url = linkConfig!.getUrl(dummyRow);
      expect(url).toBe('/erp3/sales-orders?search=SO-1001');
    });
  });

  describe('3. Sensitive Field Configuration (AC3)', () => {
    it('declares all mandatory financial, bank, tax, and credential sensitive fields', () => {
      const sensitive = erp3OrdersRejectionContext.sensitiveFields || [];
      expect(sensitive).toContain('bank_account_number');
      expect(sensitive).toContain('iban');
      expect(sensitive).toContain('routing_number');
      expect(sensitive).toContain('ssn');
      expect(sensitive).toContain('tax_id');
      expect(sensitive).toContain('salary');
      expect(sensitive).toContain('creditCard');
      expect(sensitive).toContain('pin');
    });

    it('masks sensitive fields in ERP-3 sales order rows properly', () => {
      const rawRow: RejectedRow = {
        id: 'r_sens',
        batchId: 'b_sens',
        sourceRow: 10,
        entity: 'sales_orders',
        errorCode: 'DUPLICATE_ORDER_NUMBER',
        rawData: {
          order_number: 'SO-2026-0001',
          customer_golden_id: '55555555-0003-4000-8000-000000000001',
          bank_account_number: '987654321012',
          tax_id: '999-00-1111',
          salary: 115000,
          pin: '1234',
        },
      };

      const masked = maskRejectedRow(rawRow, erp3OrdersRejectionContext.sensitiveFields);
      expect(masked.rawData['bank_account_number']).toBe('****-****-1012');
      expect(masked.rawData['tax_id']).toBe('***-**-1111');
      expect(masked.rawData['salary']).toBe('[CONFIDENTIAL SALARY]');
      expect(masked.rawData['pin']).toBe('[REDACTED]');
      expect(masked.rawData['order_number']).toBe('SO-2026-0001');
    });
  });

  describe('4. Formula-Safe CSV Export (AC4)', () => {
    it('exports ERP-3 rejections with correct headers and sanitized cells', () => {
      const rows: RejectedRow[] = [
        {
          id: 'r_csv_1',
          batchId: 'b_csv',
          sourceRow: 2,
          entity: 'sales_orders',
          errorCode: 'DUPLICATE_ORDER_NUMBER',
          field: 'order_number',
          rawData: {
            order_number: '=SUM(1,2)', // Formula injection test
            customer_golden_id: '@HYPERLINK("http://attacker.synthetic")',
            source_id: 'SRC-01',
            currency: 'USD',
            order_date: '2026-10-24',
            status: 'Open',
            total: '100.00',
            bank_account_number: '123456789012',
          },
        },
      ];

      const csv = exportRejectedRowsCsv(rows, erp3OrdersRejectionContext);
      expect(csv).toContain('Source Row');
      expect(csv).toContain('Error Code');
      expect(csv).toContain('Order Number');
      expect(csv).toContain('Customer Golden ID');
      expect(csv).toContain('Source ID');
      expect(csv).toContain('Currency Code');

      // Formula injection characters neutralized
      expect(csv).not.toContain('"=SUM');
      expect(csv).toContain("'=SUM");
      expect(csv).not.toContain('"@HYPERLINK');
      expect(csv).toContain("'@HYPERLINK");

      // Sensitive fields masked
      expect(csv).not.toContain('123456789012');
    });
  });
});
