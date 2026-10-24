/**
 * ERP-3 Sales Orders and Invoices — Migration Kit Field Registry Tests (KIT-14 / ERP3-22)
 *
 * Verifies:
 * - Registration of ERP-3 target schema metadata with the shared MigrationKitRegistry.
 * - Entity definitions and schema compliance for Sales Orders, SO Lines, Invoices, and Invoice Lines.
 * - Non-negotiable domain rules:
 *   - Order number uniqueness / natural key (BR-ERP3-01, FR-ERP3-01)
 *   - Fixed V1 order status list (Open, Invoiced, Closed) (FR-ERP3-05)
 *   - Customer Golden ID requirement (BR-ERP3-03, ADR-003)
 *   - Computed line totals and order totals (BR-ERP3-01)
 *   - Exact duplicate matching and raw source preservation (KIT-08)
 * - Validation of metadata payloads against @clearshift/contracts Zod schemas.
 */

import { describe, it, expect } from 'vitest';
import { ModuleMigrationMetadataSchema } from '@clearshift/contracts';
import { migrationKitRegistry } from '@cs/kit';
import {
  erp3KitMetadata,
  erp3SalesOrdersMetadata,
  erp3SoLinesMetadata,
  erp3InvoicesMetadata,
  erp3InvoiceLinesMetadata,
} from '../../src/kit/field-registry.js';

describe('ERP-3 Field Registry for Migration Kit (ERP3-22)', () => {
  it('registers ERP-3 metadata into central MigrationKitRegistry on import (AC 1)', () => {
    const registered = migrationKitRegistry.get('erp3');
    expect(registered).toBeDefined();
    expect(registered?.moduleId).toBe('erp3');
    expect(registered?.moduleName).toBe('ERP-3 Sales Orders and Invoices');
    expect(registered?.defaultEntity).toBe('sales_orders');
  });

  it('validates against ModuleMigrationMetadataSchema from @clearshift/contracts', () => {
    const parseResult = ModuleMigrationMetadataSchema.safeParse(erp3KitMetadata);
    expect(parseResult.success).toBe(true);
  });

  describe('Sales Orders Target Schema (erp3_sales_orders)', () => {
    it('defines primary table attributes and keys', () => {
      expect(erp3SalesOrdersMetadata.entity).toBe('sales_orders');
      expect(erp3SalesOrdersMetadata.targetTable).toBe('erp3_sales_orders');
      expect(erp3SalesOrdersMetadata.primaryKey).toBe('id');
      expect(erp3SalesOrdersMetadata.naturalKey).toBe('order_number');
      expect(erp3SalesOrdersMetadata.schemaVersion).toBe(1);
    });

    it('enforces required primary fields: order_number, customer_golden_id, order_date, currency, status', () => {
      const requiredFieldNames = erp3SalesOrdersMetadata.fields
        .filter((f) => f.required)
        .map((f) => f.name);

      expect(requiredFieldNames).toContain('order_number');
      expect(requiredFieldNames).toContain('customer_golden_id');
      expect(requiredFieldNames).toContain('order_date');
      expect(requiredFieldNames).toContain('currency');
      expect(requiredFieldNames).toContain('status');
    });

    it('defines optional fields: total, subtotal, tax_total, customer_email, customer_phone, notes, source_system, source_id', () => {
      const optionalFieldNames = erp3SalesOrdersMetadata.fields
        .filter((f) => !f.required)
        .map((f) => f.name);

      expect(optionalFieldNames).toContain('total');
      expect(optionalFieldNames).toContain('subtotal');
      expect(optionalFieldNames).toContain('tax_total');
      expect(optionalFieldNames).toContain('customer_email');
      expect(optionalFieldNames).toContain('customer_phone');
      expect(optionalFieldNames).toContain('notes');
      expect(optionalFieldNames).toContain('source_system');
      expect(optionalFieldNames).toContain('source_id');
    });

    it('enforces fixed list of V1 order status enum options (FR-ERP3-05)', () => {
      const statusField = erp3SalesOrdersMetadata.fields.find((f) => f.name === 'status');
      expect(statusField).toBeDefined();
      expect(statusField?.type).toBe('enum');
      expect(statusField?.enumOptions).toEqual(['Open', 'Invoiced', 'Closed']);
      expect(statusField?.rules).toContain('FR-ERP3-05');
    });

    it('specifies decimal types for financial totals (BR-ERP3-01, BR-ERP3-02)', () => {
      const totalField = erp3SalesOrdersMetadata.fields.find((f) => f.name === 'total');
      const subtotalField = erp3SalesOrdersMetadata.fields.find((f) => f.name === 'subtotal');
      const taxField = erp3SalesOrdersMetadata.fields.find((f) => f.name === 'tax_total');

      expect(totalField?.type).toBe('decimal');
      expect(subtotalField?.type).toBe('decimal');
      expect(taxField?.type).toBe('decimal');
      expect(totalField?.rules).toContain('BR-ERP3-01');
      expect(taxField?.rules).toContain('BR-ERP3-02');
    });

    it('provides standard legacy mapping defaults', () => {
      expect(erp3SalesOrdersMetadata.mappingDefaults).toEqual(
        expect.objectContaining({
          order_number: 'order_number',
          customer_golden_id: 'customer_golden_id',
          order_date: 'order_date',
          currency: 'currency',
          status: 'status',
          total: 'total',
          subtotal: 'subtotal',
          tax_total: 'tax_total',
        })
      );
    });

    it('documents governing business validation rules', () => {
      const ruleCodes = erp3SalesOrdersMetadata.validationRules?.map((r) => r.code);
      expect(ruleCodes).toContain('BR-ERP3-01');
      expect(ruleCodes).toContain('BR-ERP3-03');
      expect(ruleCodes).toContain('FR-ERP3-05');
      expect(ruleCodes).toContain('KIT-08');
    });
  });

  describe('Sales Order Lines Target Schema (erp3_so_lines)', () => {
    it('defines required line attributes: order_id, line_number, product_id, quantity, unit_price', () => {
      expect(erp3SoLinesMetadata.entity).toBe('so_lines');
      expect(erp3SoLinesMetadata.targetTable).toBe('erp3_so_lines');
      expect(erp3SoLinesMetadata.primaryKey).toBe('id');

      const requiredFieldNames = erp3SoLinesMetadata.fields
        .filter((f) => f.required)
        .map((f) => f.name);

      expect(requiredFieldNames).toContain('order_id');
      expect(requiredFieldNames).toContain('line_number');
      expect(requiredFieldNames).toContain('product_id');
      expect(requiredFieldNames).toContain('quantity');
      expect(requiredFieldNames).toContain('unit_price');
    });

    it('specifies decimal types for quantity, unit_price, tax_rate, tax_amount, and line_total', () => {
      const qtyField = erp3SoLinesMetadata.fields.find((f) => f.name === 'quantity');
      const priceField = erp3SoLinesMetadata.fields.find((f) => f.name === 'unit_price');
      const taxRateField = erp3SoLinesMetadata.fields.find((f) => f.name === 'tax_rate');
      const taxAmountField = erp3SoLinesMetadata.fields.find((f) => f.name === 'tax_amount');
      const lineTotalField = erp3SoLinesMetadata.fields.find((f) => f.name === 'line_total');

      expect(qtyField?.type).toBe('decimal');
      expect(qtyField?.rules).toContain('BR-ERP3-01');

      expect(priceField?.type).toBe('decimal');
      expect(priceField?.rules).toContain('BR-ERP3-01');

      expect(taxRateField?.type).toBe('decimal');
      expect(taxRateField?.rules).toContain('BR-ERP3-02');

      expect(taxAmountField?.type).toBe('decimal');
      expect(taxAmountField?.rules).toContain('BR-ERP3-02');

      expect(lineTotalField?.type).toBe('decimal');
      expect(lineTotalField?.rules).toContain('BR-ERP3-01');
    });
  });

  describe('Invoices Target Schema (erp3_invoices)', () => {
    it('defines invoice attributes and natural key invoice_number (FR-ERP3-02)', () => {
      expect(erp3InvoicesMetadata.entity).toBe('invoices');
      expect(erp3InvoicesMetadata.targetTable).toBe('erp3_invoices');
      expect(erp3InvoicesMetadata.primaryKey).toBe('id');
      expect(erp3InvoicesMetadata.naturalKey).toBe('invoice_number');

      const requiredFieldNames = erp3InvoicesMetadata.fields
        .filter((f) => f.required)
        .map((f) => f.name);

      expect(requiredFieldNames).toContain('invoice_number');
      expect(requiredFieldNames).toContain('order_id');
      expect(requiredFieldNames).toContain('customer_golden_id');
      expect(requiredFieldNames).toContain('invoice_date');
      expect(requiredFieldNames).toContain('due_date');
      expect(requiredFieldNames).toContain('currency');
      expect(requiredFieldNames).toContain('status');
    });

    it('enforces invoice status enum options (Open, Paid, Overdue)', () => {
      const statusField = erp3InvoicesMetadata.fields.find((f) => f.name === 'status');
      expect(statusField?.type).toBe('enum');
      expect(statusField?.enumOptions).toEqual(['Open', 'Paid', 'Overdue']);
    });
  });

  describe('Invoice Lines Target Schema (erp3_invoice_lines)', () => {
    it('defines required invoice line attributes with decimal calculations (BR-ERP3-01)', () => {
      expect(erp3InvoiceLinesMetadata.entity).toBe('invoice_lines');
      expect(erp3InvoiceLinesMetadata.targetTable).toBe('erp3_invoice_lines');

      const requiredFieldNames = erp3InvoiceLinesMetadata.fields
        .filter((f) => f.required)
        .map((f) => f.name);

      expect(requiredFieldNames).toContain('invoice_id');
      expect(requiredFieldNames).toContain('line_number');
      expect(requiredFieldNames).toContain('product_id');
      expect(requiredFieldNames).toContain('quantity');
      expect(requiredFieldNames).toContain('unit_price');

      const qtyField = erp3InvoiceLinesMetadata.fields.find((f) => f.name === 'quantity');
      expect(qtyField?.type).toBe('decimal');
      expect(qtyField?.rules).toContain('BR-ERP3-01');
    });
  });
});
