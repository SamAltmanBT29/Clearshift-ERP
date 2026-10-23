import { describe, it, expect } from 'vitest';
import {
  erp1ProductsRejectionContext,
  erp1FailureExplanations,
} from '../../src/kit/rejection-context.js';
import {
  resolveFailureExplanation,
  exportRejectedRowsCsv,
  maskRejectedRow,
  RejectedRow,
} from '@cs/kit';

describe('ERP-1 Products Migration Rejection Context (ERP1-23 / KIT-16)', () => {
  it('defines valid module context targeting products entity', () => {
    expect(erp1ProductsRejectionContext.moduleId).toBe('erp-1');
    expect(erp1ProductsRejectionContext.entity).toBe('products');
    expect(erp1ProductsRejectionContext.moduleName).toContain('Products');
  });

  describe('1. Module Identifier Columns (AC1)', () => {
    it('defines primary natural identifiers: SKU, Name, Source ID, and Category Code', () => {
      const idFields = erp1ProductsRejectionContext.identifierColumns.map((c) => c.field);
      expect(idFields).toContain('sku');
      expect(idFields).toContain('name');
      expect(idFields).toContain('sourceId');
      expect(idFields).toContain('categoryCode');

      const skuCol = erp1ProductsRejectionContext.identifierColumns.find((c) => c.field === 'sku');
      expect(skuCol?.isIdentifier).toBe(true);
      expect(skuCol?.format?.('  abc-123  ', {} as RejectedRow)).toBe('ABC-123');
    });

    it('includes secondary context columns: unitOfMeasure, price, taxRate', () => {
      const addFields = (erp1ProductsRejectionContext.additionalColumns || []).map((c) => c.field);
      expect(addFields).toContain('unitOfMeasure');
      expect(addFields).toContain('price');
      expect(addFields).toContain('taxRate');
    });
  });

  describe('2. Standardized Error Codes & Failure Explanations (AC2)', () => {
    const requiredCodes = [
      'DUPLICATE_SKU',
      'INVALID_UNIT_OF_MEASURE',
      'NEGATIVE_PRICE',
      'INVALID_TAX_RATE',
      'NEGATIVE_STOCK',
      'INVALID_CATEGORY',
      'MISSING_REQUIRED_FIELD',
      'MULTIPLE_WAREHOUSES_REJECTED',
      'SOURCE_VALUE_MUTATED',
    ];

    it.each(requiredCodes)('provides detailed failure explanation for %s', (code) => {
      const expl = erp1FailureExplanations[code];
      expect(expl).toBeDefined();
      expect(expl!.code).toBe(code);
      expect(expl!.title.length).toBeGreaterThan(0);
      expect(expl!.explanation.length).toBeGreaterThan(15);
      expect(expl!.docReference).toBeDefined();
      expect(expl!.resolution).toBeDefined();
    });

    it('resolves duplicate SKU explanation with BR-ERP1-01 reference', () => {
      const expl = resolveFailureExplanation(erp1ProductsRejectionContext, 'DUPLICATE_SKU');
      expect(expl.docReference).toBe('BR-ERP1-01');
      expect(expl.explanation).toContain('BR-ERP1-01');
      expect(expl.resolution).toContain('re-map source SKU');
    });

    it('resolves invalid unit of measure explanation with FR-ERP1-04 reference', () => {
      const expl = resolveFailureExplanation(erp1ProductsRejectionContext, 'INVALID_UNIT_OF_MEASURE');
      expect(expl.docReference).toBe('FR-ERP1-04');
      expect(expl.explanation).toContain('pcs, kg, g, litre, metre, box');
    });

    it('resolves negative price explanation with FR-ERP1-02 reference', () => {
      const expl = resolveFailureExplanation(erp1ProductsRejectionContext, 'NEGATIVE_PRICE');
      expect(expl.docReference).toBe('FR-ERP1-02');
      expect(expl.explanation).toContain('cannot be negative');
    });

    it('resolves contextual links for searching products by SKU', () => {
      const linkConfig = erp1ProductsRejectionContext.contextualLinks?.find(
        (l) => l.label === 'Search Products'
      );
      expect(linkConfig).toBeDefined();

      const dummyRow: RejectedRow = {
        id: 'r1',
        batchId: 'b1',
        sourceRow: 1,
        entity: 'products',
        errorCode: 'DUPLICATE_SKU',
        rawData: { sku: 'BEARING-608' },
      };
      const url = linkConfig!.getUrl(dummyRow);
      expect(url).toBe('/erp1/products?search=BEARING-608');
    });
  });

  describe('3. Sensitive Field Configuration (AC3)', () => {
    it('declares all mandatory financial, bank, tax, and credential sensitive fields', () => {
      const sensitive = erp1ProductsRejectionContext.sensitiveFields || [];
      expect(sensitive).toContain('bank_account_number');
      expect(sensitive).toContain('iban');
      expect(sensitive).toContain('routing_number');
      expect(sensitive).toContain('ssn');
      expect(sensitive).toContain('tax_id');
      expect(sensitive).toContain('salary');
      expect(sensitive).toContain('creditCard');
      expect(sensitive).toContain('pin');
    });

    it('masks sensitive fields in ERP-1 product rows properly', () => {
      const rawRow: RejectedRow = {
        id: 'r_sens',
        batchId: 'b_sens',
        sourceRow: 10,
        entity: 'products',
        errorCode: 'DUPLICATE_SKU',
        rawData: {
          sku: 'SKU-001',
          name: 'Precision Shaft',
          bank_account_number: '987654321012',
          tax_id: '999-00-1111',
          salary: 115000,
          pin: '1234',
        },
      };

      const masked = maskRejectedRow(rawRow, erp1ProductsRejectionContext.sensitiveFields);
      expect(masked.rawData['bank_account_number']).toBe('****-****-1012');
      expect(masked.rawData['tax_id']).toBe('***-**-1111');
      expect(masked.rawData['salary']).toBe('[CONFIDENTIAL SALARY]');
      expect(masked.rawData['pin']).toBe('[REDACTED]');
      expect(masked.rawData['sku']).toBe('SKU-001');
    });
  });

  describe('4. Formula-Safe CSV Export (AC4)', () => {
    it('exports ERP-1 rejections with correct headers and sanitized cells', () => {
      const rows: RejectedRow[] = [
        {
          id: 'r_csv_1',
          batchId: 'b_csv',
          sourceRow: 2,
          entity: 'products',
          errorCode: 'DUPLICATE_SKU',
          field: 'sku',
          rawData: {
            sku: '=SUM(1,2)', // Formula injection test
            name: '@HYPERLINK("http://attacker.com")',
            sourceId: 'SRC-01',
            categoryCode: 'CAT-A',
            unitOfMeasure: 'pcs',
            price: '10.00',
            taxRate: '0.1800',
            bank_account_number: '123456789012',
          },
        },
      ];

      const csv = exportRejectedRowsCsv(rows, erp1ProductsRejectionContext);
      expect(csv).toContain('Source Row');
      expect(csv).toContain('Error Code');
      expect(csv).toContain('SKU');
      expect(csv).toContain('Product Name');
      expect(csv).toContain('Source ID');
      expect(csv).toContain('Category Code');

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
