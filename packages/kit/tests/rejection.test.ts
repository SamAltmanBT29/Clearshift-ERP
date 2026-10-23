import { describe, it, expect } from 'vitest';
import {
  isSensitiveField,
  maskSensitiveValue,
  maskRejectedRow,
  resolveFailureExplanation,
  exportRejectedRowsCsv,
  RejectedRow,
  ModuleRejectionContext,
} from '../src/domain/rejection.js';

describe('Migration Kit — Rejection Domain & Utilities (ERP1-23 / KIT-16)', () => {
  const sampleContext: ModuleRejectionContext = {
    moduleId: 'erp-1',
    moduleName: 'ERP-1 Products and Inventory',
    entity: 'products',
    identifierColumns: [
      { field: 'sku', label: 'SKU', isIdentifier: true },
      { field: 'name', label: 'Product Name', isIdentifier: true },
      { field: 'sourceId', label: 'Source ID', isIdentifier: true },
    ],
    additionalColumns: [
      { field: 'unitOfMeasure', label: 'Unit' },
      { field: 'price', label: 'Unit Price' },
    ],
    sensitiveFields: ['tax_id', 'bank_account_number'],
    failureExplanations: {
      DUPLICATE_SKU: {
        code: 'DUPLICATE_SKU',
        title: 'Duplicate SKU',
        explanation: 'SKU already exists after normalization (BR-ERP1-01).',
        docReference: 'BR-ERP1-01',
        resolution: 'Deduplicate SKU in source catalog.',
      },
      INVALID_UNIT_OF_MEASURE: {
        code: 'INVALID_UNIT_OF_MEASURE',
        title: 'Invalid Unit of Measure',
        explanation: 'Unit of measure must be one of: pcs, kg, g, litre, metre, box (FR-ERP1-04).',
        docReference: 'FR-ERP1-04',
        resolution: 'Normalize unit to approved V1 unit of measure.',
      },
      NEGATIVE_PRICE: {
        code: 'NEGATIVE_PRICE',
        title: 'Negative Unit Price',
        explanation: 'Product unit price cannot be negative (FR-ERP1-02).',
        docReference: 'FR-ERP1-02',
        resolution: 'Ensure unit price is non-negative.',
      },
    },
  };

  const sampleRows: RejectedRow[] = [
    {
      id: 'rej_1',
      batchId: 'batch_test_01',
      sourceRow: 14,
      entity: 'products',
      errorCode: 'DUPLICATE_SKU',
      failureReason: 'SKU PROD-999 is already assigned',
      field: 'sku',
      rawData: {
        sku: 'PROD-999',
        name: 'Industrial Bolt',
        sourceId: 'SRC-101',
        unitOfMeasure: 'pcs',
        price: '19.99',
        bank_account_number: '123456789012',
        tax_id: '987-65-4321',
      },
    },
    {
      id: 'rej_2',
      batchId: 'batch_test_01',
      sourceRow: 28,
      entity: 'products',
      errorCode: 'INVALID_UNIT_OF_MEASURE',
      failureReason: 'Unit ounces is not supported in V1',
      field: 'unitOfMeasure',
      rawData: {
        sku: 'PROD-100',
        name: 'Special Grease',
        sourceId: 'SRC-102',
        unitOfMeasure: 'ounces',
        price: '45.00',
        salary: 85000,
      },
    },
    {
      id: 'rej_3',
      batchId: 'batch_test_01',
      sourceRow: 35,
      entity: 'products',
      errorCode: 'UNKNOWN_ERROR',
      failureReason: 'Generic validation failure',
      field: 'custom_field',
      rawData: {
        sku: '=cmd|’ /C calc’!A0', // Potential formula injection
        name: '+SUM(1,2)',
        sourceId: 'SRC-103',
        unitOfMeasure: 'box',
        price: '10.00',
      },
    },
  ];

  describe('1. Standardized Error Codes & Human-Readable Explanations (AC2)', () => {
    it('resolves configured error code with title, reason, docReference, and resolution', () => {
      const explanation = resolveFailureExplanation(sampleContext, 'DUPLICATE_SKU');
      expect(explanation.code).toBe('DUPLICATE_SKU');
      expect(explanation.title).toBe('Duplicate SKU');
      expect(explanation.explanation).toContain('BR-ERP1-01');
      expect(explanation.docReference).toBe('BR-ERP1-01');
      expect(explanation.resolution).toBe('Deduplicate SKU in source catalog.');
    });

    it('falls back gracefully for unknown error code', () => {
      const explanation = resolveFailureExplanation(
        sampleContext,
        'UNKNOWN_CUSTOM_CODE',
        'Custom validation failed'
      );
      expect(explanation.code).toBe('UNKNOWN_CUSTOM_CODE');
      expect(explanation.title).toBe('UNKNOWN CUSTOM CODE');
      expect(explanation.explanation).toBe('Custom validation failed');
      expect(explanation.resolution).toBeDefined();
    });
  });

  describe('2. Sensitive Financial, Bank, and Employee Field Masking (AC3)', () => {
    it('detects sensitive field names accurately', () => {
      expect(isSensitiveField('bank_account_number')).toBe(true);
      expect(isSensitiveField('routingNumber')).toBe(true);
      expect(isSensitiveField('iban')).toBe(true);
      expect(isSensitiveField('ssn')).toBe(true);
      expect(isSensitiveField('taxId')).toBe(true);
      expect(isSensitiveField('salary')).toBe(true);
      expect(isSensitiveField('password_hash')).toBe(true);
      expect(isSensitiveField('pin')).toBe(true);

      // Non-sensitive fields
      expect(isSensitiveField('sku')).toBe(false);
      expect(isSensitiveField('name')).toBe(false);
      expect(isSensitiveField('price')).toBe(false);
      expect(isSensitiveField('unitOfMeasure')).toBe(false);
    });

    it('masks sensitive values properly based on field type', () => {
      expect(maskSensitiveValue('bank_account_number', '123456789012')).toBe('****-****-9012');
      expect(maskSensitiveValue('iban', 'GB29NWBK60161331926819')).toBe('****-****-6819');
      expect(maskSensitiveValue('ssn', '123-45-6789')).toBe('***-**-6789');
      expect(maskSensitiveValue('taxId', '98-7654321')).toBe('***-**-4321');
      expect(maskSensitiveValue('password', 'secret123')).toBe('[REDACTED]');
      expect(maskSensitiveValue('salary', 120000)).toBe('[CONFIDENTIAL SALARY]');
    });

    it('automatically masks sensitive fields in rejected row payload', () => {
      const masked = maskRejectedRow(sampleRows[0]!, sampleContext.sensitiveFields);

      // Sensitive fields masked
      expect(masked.rawData.bank_account_number).toBe('****-****-9012');
      expect(masked.rawData.tax_id).toBe('***-**-4321');

      // Identifier and non-sensitive fields preserved
      expect(masked.rawData.sku).toBe('PROD-999');
      expect(masked.rawData.name).toBe('Industrial Bolt');
      expect(masked.rawData.price).toBe('19.99');

      // Original row was not mutated
      expect(sampleRows[0]!.rawData.bank_account_number).toBe('123456789012');
    });

    it('masks employee salary fields automatically', () => {
      const masked = maskRejectedRow(sampleRows[1]!);
      expect(masked.rawData.salary).toBe('[CONFIDENTIAL SALARY]');
      expect(masked.rawData.name).toBe('Special Grease');
    });
  });

  describe('3. Formula-Safe CSV Export (AC4)', () => {
    it('generates CSV with correct headers and module identifier columns', () => {
      const csv = exportRejectedRowsCsv(sampleRows, sampleContext);
      const lines = csv.split('\r\n');

      const headers = lines[0]!;
      expect(headers).toContain('Source Row');
      expect(headers).toContain('Error Code');
      expect(headers).toContain('Reason');
      expect(headers).toContain('Doc Reference');
      expect(headers).toContain('Resolution');
      expect(headers).toContain('SKU');
      expect(headers).toContain('Product Name');
      expect(headers).toContain('Source ID');
      expect(headers).toContain('Unit');
      expect(headers).toContain('Unit Price');
      expect(headers).toContain('Failed Field');
    });

    it('neutralizes formula injection characters (=, +, -, @) in CSV export', () => {
      const csv = exportRejectedRowsCsv(sampleRows, sampleContext);

      // Line 3 has '=cmd...' and '+SUM...'
      expect(csv).not.toContain('"=cmd');
      expect(csv).toContain("'=cmd"); // neutralized with single quote prefix
      expect(csv).not.toContain('"+SUM');
      expect(csv).toContain("'+SUM");
    });

    it('preserves masking of sensitive data in CSV export', () => {
      const csv = exportRejectedRowsCsv(sampleRows, sampleContext);

      // Sensitive values should not appear unmasked
      expect(csv).not.toContain('123456789012');
      expect(csv).not.toContain('987-65-4321');
    });

    it('returns empty string when no rows to export', () => {
      const csv = exportRejectedRowsCsv([], sampleContext);
      expect(csv).toBe('');
    });
  });
});
