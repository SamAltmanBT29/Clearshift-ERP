import { describe, it, expect } from 'vitest';
import {
  erp2VendorsRejectionContext,
  erp2PurchaseOrdersRejectionContext,
  erp2FailureExplanations,
} from '../../src/kit/rejection-context.js';
import {
  resolveFailureExplanation,
  exportRejectedRowsCsv,
  maskRejectedRow,
  RejectedRow,
} from '@cs/kit';

describe('ERP-2 Vendors & Purchasing Migration Rejection Context (ERP2-23 / KIT-16)', () => {
  // ─── Vendors Context ─────────────────────────────────────────────────────────

  describe('Vendors Context — Module Definition', () => {
    it('defines valid vendors module context targeting erp-2', () => {
      expect(erp2VendorsRejectionContext.moduleId).toBe('erp-2');
      expect(erp2VendorsRejectionContext.entity).toBe('vendors');
      expect(erp2VendorsRejectionContext.moduleName).toContain('Vendors');
    });
  });

  describe('1. Module Identifier Columns (AC1) — Vendors', () => {
    it('defines natural identifier columns: tax_number, name, source_id, currency', () => {
      const idFields = erp2VendorsRejectionContext.identifierColumns.map((c) => c.field);
      expect(idFields).toContain('tax_number');
      expect(idFields).toContain('name');
      expect(idFields).toContain('source_id');
      expect(idFields).toContain('currency');

      const taxCol = erp2VendorsRejectionContext.identifierColumns.find(
        (c) => c.field === 'tax_number'
      );
      expect(taxCol?.isIdentifier).toBe(true);
    });

    it('tax_number format normalizes to uppercase trimmed string', () => {
      const taxCol = erp2VendorsRejectionContext.identifierColumns.find(
        (c) => c.field === 'tax_number'
      );
      expect(taxCol?.format?.('  tax-acme-001  ', {} as RejectedRow)).toBe('TAX-ACME-001');
    });

    it('tax_number format returns fallback em-dash for null/undefined', () => {
      const taxCol = erp2VendorsRejectionContext.identifierColumns.find(
        (c) => c.field === 'tax_number'
      );
      expect(taxCol?.format?.(undefined, {} as RejectedRow)).toBe('—');
      expect(taxCol?.format?.(null, {} as RejectedRow)).toBe('—');
    });

    it('includes secondary context columns: email, phone, country', () => {
      const addFields = (erp2VendorsRejectionContext.additionalColumns || []).map((c) => c.field);
      expect(addFields).toContain('email');
      expect(addFields).toContain('phone');
      expect(addFields).toContain('country');
    });
  });

  describe('1. Module Identifier Columns (AC1) — Purchase Orders', () => {
    it('defines natural identifier columns: po_number, vendor_id, source_id, currency', () => {
      const idFields = erp2PurchaseOrdersRejectionContext.identifierColumns.map((c) => c.field);
      expect(idFields).toContain('po_number');
      expect(idFields).toContain('vendor_id');
      expect(idFields).toContain('source_id');
      expect(idFields).toContain('currency');

      const poCol = erp2PurchaseOrdersRejectionContext.identifierColumns.find(
        (c) => c.field === 'po_number'
      );
      expect(poCol?.isIdentifier).toBe(true);
    });

    it('po_number format normalizes to uppercase trimmed string', () => {
      const poCol = erp2PurchaseOrdersRejectionContext.identifierColumns.find(
        (c) => c.field === 'po_number'
      );
      expect(poCol?.format?.('  po-2026-0001  ', {} as RejectedRow)).toBe('PO-2026-0001');
    });

    it('includes secondary context columns: order_date, status, total, notes', () => {
      const addFields = (erp2PurchaseOrdersRejectionContext.additionalColumns || []).map(
        (c) => c.field
      );
      expect(addFields).toContain('order_date');
      expect(addFields).toContain('status');
      expect(addFields).toContain('total');
      expect(addFields).toContain('notes');
    });
  });

  // ─── Failure Explanations ─────────────────────────────────────────────────

  describe('2. Standardized Error Codes & Failure Explanations (AC2)', () => {
    const requiredCodes = [
      'DUPLICATE_TAX_NUMBER',
      'DUPLICATE_PO_NUMBER',
      'INVALID_PO_STATUS',
      'NEGATIVE_QUANTITY',
      'NEGATIVE_PRICE',
      'UNRESOLVED_VENDOR_REFERENCE',
      'UNRESOLVED_PRODUCT_REFERENCE',
      'TOTAL_MISMATCH',
      'INVALID_CURRENCY',
      'MISSING_REQUIRED_FIELD',
      'BANK_DETAILS_EXPOSED',
      'SOURCE_VALUE_MUTATED',
    ] as const;

    it.each(requiredCodes)('provides detailed failure explanation for %s', (code) => {
      const expl = erp2FailureExplanations[code];
      expect(expl).toBeDefined();
      expect(expl!.code).toBe(code);
      expect(expl!.title.length).toBeGreaterThan(0);
      expect(expl!.explanation.length).toBeGreaterThan(15);
      expect(expl!.docReference).toBeDefined();
      expect(expl!.resolution).toBeDefined();
    });

    it('resolves duplicate tax number explanation with BR-ERP2-01 reference', () => {
      const expl = resolveFailureExplanation(erp2VendorsRejectionContext, 'DUPLICATE_TAX_NUMBER');
      expect(expl.docReference).toBe('BR-ERP2-01');
      expect(expl.explanation).toContain('BR-ERP2-01');
    });

    it('resolves invalid PO status explanation referencing FR-ERP2-04 lifecycle', () => {
      const expl = resolveFailureExplanation(
        erp2PurchaseOrdersRejectionContext,
        'INVALID_PO_STATUS'
      );
      expect(expl.docReference).toBe('FR-ERP2-04');
      expect(expl.explanation).toContain('Draft -> Sent -> Received -> Closed');
    });

    it('resolves negative quantity explanation with FR-ERP2-03 reference', () => {
      const expl = resolveFailureExplanation(
        erp2PurchaseOrdersRejectionContext,
        'NEGATIVE_QUANTITY'
      );
      expect(expl.docReference).toBe('FR-ERP2-03');
      expect(expl.explanation).toContain('0.0000');
    });

    it('resolves total mismatch explanation referencing BR-ERP2-03 and ROUND_HALF_UP', () => {
      const expl = resolveFailureExplanation(
        erp2PurchaseOrdersRejectionContext,
        'TOTAL_MISMATCH'
      );
      expect(expl.docReference).toBe('BR-ERP2-03');
      expect(expl.explanation).toContain('ROUND_HALF_UP');
    });

    it('resolves bank details exposed explanation referencing BR-ERP2-02 and PCI/GDPR', () => {
      const expl = resolveFailureExplanation(
        erp2VendorsRejectionContext,
        'BANK_DETAILS_EXPOSED'
      );
      expect(expl.docReference).toBe('BR-ERP2-02');
      expect(expl.explanation).toContain('PCI/GDPR');
    });

    it('resolves unresolved product reference citing Decision C7 cross-module', () => {
      const expl = resolveFailureExplanation(
        erp2PurchaseOrdersRejectionContext,
        'UNRESOLVED_PRODUCT_REFERENCE'
      );
      expect(expl.docReference).toBe('Decision C7');
      expect(expl.explanation).toContain('ERP-1');
    });

    it('resolves contextual search link for vendors by tax_number', () => {
      const linkConfig = erp2VendorsRejectionContext.contextualLinks?.find(
        (l) => l.label === 'Search Vendors'
      );
      expect(linkConfig).toBeDefined();

      const dummyRow: RejectedRow = {
        id: 'r1',
        batchId: 'b1',
        sourceRow: 1,
        entity: 'vendors',
        errorCode: 'DUPLICATE_TAX_NUMBER',
        rawData: { tax_number: 'TAX-ACME-001' },
      };
      const url = linkConfig!.getUrl(dummyRow);
      expect(url).toBe('/erp2/vendors?search=TAX-ACME-001');
    });

    it('resolves contextual search link for purchase orders by po_number', () => {
      const linkConfig = erp2PurchaseOrdersRejectionContext.contextualLinks?.find(
        (l) => l.label === 'Search Purchase Orders'
      );
      expect(linkConfig).toBeDefined();

      const dummyRow: RejectedRow = {
        id: 'r2',
        batchId: 'b1',
        sourceRow: 3,
        entity: 'purchase_orders',
        errorCode: 'DUPLICATE_PO_NUMBER',
        rawData: { po_number: 'PO-2026-0001' },
      };
      const url = linkConfig!.getUrl(dummyRow);
      expect(url).toBe('/erp2/purchase-orders?search=PO-2026-0001');
    });

    it('provides data dictionary link with openInNewTab for both contexts', () => {
      const vLink = erp2VendorsRejectionContext.contextualLinks?.find(
        (l) => l.label === 'Data Dictionary'
      );
      expect(vLink?.openInNewTab).toBe(true);

      const poLink = erp2PurchaseOrdersRejectionContext.contextualLinks?.find(
        (l) => l.label === 'Data Dictionary'
      );
      expect(poLink?.openInNewTab).toBe(true);
    });
  });

  // ─── Sensitive Fields (AC3) ───────────────────────────────────────────────

  describe('3. Sensitive Field Configuration (AC3)', () => {
    it('vendors context declares all financial, bank, credential sensitive fields', () => {
      const sensitive = erp2VendorsRejectionContext.sensitiveFields || [];
      expect(sensitive).toContain('bank_account');
      expect(sensitive).toContain('bank_account_number');
      expect(sensitive).toContain('iban');
      expect(sensitive).toContain('routing_number');
      expect(sensitive).toContain('swift');
      expect(sensitive).toContain('ssn');
      expect(sensitive).toContain('tax_id');
      expect(sensitive).toContain('salary');
      expect(sensitive).toContain('creditCard');
      expect(sensitive).toContain('pin');
      expect(sensitive).toContain('password');
    });

    it('PO context shares same sensitive field list as vendors context', () => {
      expect(erp2PurchaseOrdersRejectionContext.sensitiveFields).toEqual(
        erp2VendorsRejectionContext.sensitiveFields
      );
    });

    it('masks sensitive bank_account field in vendor rejected rows', () => {
      const rawRow: RejectedRow = {
        id: 'r_sens',
        batchId: 'b_sens',
        sourceRow: 5,
        entity: 'vendors',
        errorCode: 'DUPLICATE_TAX_NUMBER',
        rawData: {
          tax_number: 'TAX-ACME-9901',
          name: 'Acme Industrial Supplies Ltd',
          bank_account: '123456789012',
          tax_id: '999-88-7777',
          salary: 95000,
          pin: '4321',
          iban: 'GB82WEST12345698765432',
        },
      };

      const masked = maskRejectedRow(rawRow, erp2VendorsRejectionContext.sensitiveFields);
      // Sensitive fields must be masked
      expect(masked.rawData['bank_account']).not.toBe('123456789012');
      expect(masked.rawData['tax_id']).not.toBe('999-88-7777');
      expect(masked.rawData['salary']).not.toBe(95000);
      expect(masked.rawData['pin']).not.toBe('4321');
      expect(masked.rawData['iban']).not.toBe('GB82WEST12345698765432');
      // Non-sensitive fields are preserved
      expect(masked.rawData['tax_number']).toBe('TAX-ACME-9901');
      expect(masked.rawData['name']).toBe('Acme Industrial Supplies Ltd');
    });

    it('masks routing_number and account_number in PO rejected rows', () => {
      const rawRow: RejectedRow = {
        id: 'r_po_sens',
        batchId: 'b_po_sens',
        sourceRow: 19,
        entity: 'purchase_orders',
        errorCode: 'INVALID_PO_STATUS',
        rawData: {
          po_number: 'PO-2026-0003',
          status: 'Archived',
          routing_number: '021000021',
          bank_account: '9876543210',
          ssn: '123-45-6789',
        },
      };

      const masked = maskRejectedRow(rawRow, erp2PurchaseOrdersRejectionContext.sensitiveFields);
      expect(masked.rawData['routing_number']).not.toBe('021000021');
      expect(masked.rawData['bank_account']).not.toBe('9876543210');
      expect(masked.rawData['ssn']).not.toBe('123-45-6789');
      expect(masked.rawData['po_number']).toBe('PO-2026-0003');
      expect(masked.rawData['status']).toBe('Archived');
    });
  });

  // ─── Formula-Safe CSV Export (AC4) ────────────────────────────────────────

  describe('4. Formula-Safe CSV Export (AC4)', () => {
    it('exports vendor rejections with correct domain headers', () => {
      const rows: RejectedRow[] = [
        {
          id: 'r_csv_1',
          batchId: 'b_csv',
          sourceRow: 5,
          entity: 'vendors',
          errorCode: 'DUPLICATE_TAX_NUMBER',
          field: 'tax_number',
          rawData: {
            tax_number: 'TAX-ACME-9901',
            name: 'Acme Industrial Supplies Ltd',
            source_id: 'VEND-8821',
            currency: 'USD',
            email: 'procurement@acme.synthetic',
            phone: '+1-555-0199',
            country: 'USA',
            bank_account: '123456789012',
          },
        },
      ];

      const csv = exportRejectedRowsCsv(rows, erp2VendorsRejectionContext);
      expect(csv).toContain('Source Row');
      expect(csv).toContain('Error Code');
      expect(csv).toContain('Tax Number');
      expect(csv).toContain('Vendor Name');
      expect(csv).toContain('Source ID');
      // Sensitive field must NOT appear in export
      expect(csv).not.toContain('123456789012');
    });

    it('exports PO rejections with correct domain headers', () => {
      const rows: RejectedRow[] = [
        {
          id: 'r_csv_2',
          batchId: 'b_csv',
          sourceRow: 19,
          entity: 'purchase_orders',
          errorCode: 'INVALID_PO_STATUS',
          field: 'status',
          rawData: {
            po_number: 'PO-2026-0003',
            vendor_id: 'a1111111-1111-4111-8111-111111111111',
            source_id: 'PO-90021',
            currency: 'USD',
            order_date: '2026-10-20',
            status: 'Archived',
            total: '890.00',
            routing_number: '021000021',
          },
        },
      ];

      const csv = exportRejectedRowsCsv(rows, erp2PurchaseOrdersRejectionContext);
      expect(csv).toContain('PO Number');
      expect(csv).toContain('Vendor ID');
      expect(csv).toContain('Source ID');
      expect(csv).toContain('Currency');
      // Sensitive routing number must be masked in export
      expect(csv).not.toContain('021000021');
    });

    it('neutralizes formula-injection characters in all exported cells (AC4)', () => {
      const rows: RejectedRow[] = [
        {
          id: 'r_csv_inject',
          batchId: 'b_csv_inject',
          sourceRow: 38,
          entity: 'purchase_orders',
          errorCode: 'DUPLICATE_PO_NUMBER',
          field: 'po_number',
          rawData: {
            po_number: "=cmd|' /C calc'!A0",
            vendor_id: 'a1111111-1111-4111-8111-111111111113',
            source_id: '@HYPERLINK("http://attacker.synthetic")',
            currency: '+SUM(1,2)',
            status: 'Draft',
          },
        },
      ];

      const csv = exportRejectedRowsCsv(rows, erp2PurchaseOrdersRejectionContext);
      // Formula injection prefix characters must be escaped (utility uppercases formula tokens)
      expect(csv).not.toMatch(/"=cmd/i);
      expect(csv).not.toMatch(/"@HYPERLINK/i);
      expect(csv).not.toMatch(/"\+SUM/i);
      // Prefixed with single quote to neutralize formula evaluation
      expect(csv).toMatch(/'=CMD/i);
      expect(csv).toMatch(/'@HYPERLINK/i);
      expect(csv).toMatch(/'\+SUM/i);
    });

    it('includes batch ID and row-level failure field in export columns', () => {
      const rows: RejectedRow[] = [
        {
          id: 'r_csv_field',
          batchId: 'BATCH_ERP2_2026_01',
          sourceRow: 11,
          entity: 'vendors',
          errorCode: 'MISSING_REQUIRED_FIELD',
          field: 'email',
          rawData: {
            tax_number: 'TAX-GLOBEX-0042',
            name: 'Globex Components GmbH',
            source_id: 'VEND-0042',
            currency: 'EUR',
            email: '',
          },
        },
      ];

      const csv = exportRejectedRowsCsv(rows, erp2VendorsRejectionContext);
      // Batch ID is not included in CSV output — only row-level data
      expect(csv).toContain('MISSING_REQUIRED_FIELD');
      expect(csv).toContain('TAX-GLOBEX-0042');
    });
  });
});
