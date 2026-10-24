/**
 * ERP-2 Vendors & Purchasing — Migration Kit Field Registry Tests (KIT-14 / ERP2-22)
 *
 * Verifies:
 * - Registration of ERP-2 target schema metadata with the shared MigrationKitRegistry.
 * - Entity definitions and schema compliance for Vendors, Purchase Orders, and PO Lines.
 * - Non-negotiable domain rules:
 *   - Tax number uniqueness for vendors (BR-ERP2-01, FR-ERP2-01)
 *   - Explicit PO status lifecycle: Draft -> Sent -> Received -> Closed (FR-ERP2-04)
 *   - Bank details masked server-side to XXXX-XXXX-7890 (FR-ERP2-02, BR-ERP2-02)
 *   - Decimal price, quantity, and line totals with documented rounding (FR-ERP2-03, BR-ERP2-03)
 *   - Cross-module PO line references to existing ERP-1 product IDs (FR-ERP2-03, Decision C7)
 *   - Raw source value preservation (KIT-08)
 * - Validation of metadata payloads against @clearshift/contracts Zod schemas.
 */

import { describe, it, expect } from 'vitest';
import { ModuleMigrationMetadataSchema } from '@clearshift/contracts';
import { migrationKitRegistry } from '@cs/kit';
import {
  erp2KitMetadata,
  erp2VendorsMetadata,
  erp2PurchaseOrdersMetadata,
  erp2PoLinesMetadata,
} from '../../src/kit/field-registry.js';

describe('ERP-2 Field Registry for Migration Kit (ERP2-22)', () => {
  it('registers ERP-2 metadata into central MigrationKitRegistry on import (AC 1)', () => {
    const registered = migrationKitRegistry.get('erp2');
    expect(registered).toBeDefined();
    expect(registered?.moduleId).toBe('erp2');
    expect(registered?.moduleName).toBe('ERP-2 Vendors and Purchasing');
    expect(registered?.defaultEntity).toBe('vendors');
    expect(Object.keys(registered?.entities || {})).toEqual([
      'vendors',
      'purchase_orders',
      'po_lines',
    ]);
  });

  it('validates against ModuleMigrationMetadataSchema from @clearshift/contracts', () => {
    const parseResult = ModuleMigrationMetadataSchema.safeParse(erp2KitMetadata);
    expect(parseResult.success).toBe(true);
  });

  describe('Vendors Target Schema (erp2_vendors)', () => {
    it('defines primary table attributes and keys', () => {
      expect(erp2VendorsMetadata.entity).toBe('vendors');
      expect(erp2VendorsMetadata.targetTable).toBe('erp2_vendors');
      expect(erp2VendorsMetadata.primaryKey).toBe('id');
      expect(erp2VendorsMetadata.naturalKey).toBe('tax_number');
      expect(erp2VendorsMetadata.schemaVersion).toBe(1);
    });

    it('enforces required primary fields: name, tax_number, email, currency', () => {
      const requiredFieldNames = erp2VendorsMetadata.fields
        .filter((f) => f.required)
        .map((f) => f.name);

      expect(requiredFieldNames).toContain('name');
      expect(requiredFieldNames).toContain('tax_number');
      expect(requiredFieldNames).toContain('email');
      expect(requiredFieldNames).toContain('currency');
    });

    it('defines optional fields: phone, address_line, city, country, bank_masked, source_system, source_id', () => {
      const optionalFieldNames = erp2VendorsMetadata.fields
        .filter((f) => !f.required)
        .map((f) => f.name);

      expect(optionalFieldNames).toContain('phone');
      expect(optionalFieldNames).toContain('address_line');
      expect(optionalFieldNames).toContain('city');
      expect(optionalFieldNames).toContain('country');
      expect(optionalFieldNames).toContain('bank_masked');
      expect(optionalFieldNames).toContain('source_system');
      expect(optionalFieldNames).toContain('source_id');
    });

    it('documents bank details server-side masking rule (FR-ERP2-02, BR-ERP2-02)', () => {
      const bankField = erp2VendorsMetadata.fields.find((f) => f.name === 'bank_masked');
      expect(bankField).toBeDefined();
      expect(bankField?.type).toBe('string');
      expect(bankField?.rules).toContain('FR-ERP2-02');
      expect(bankField?.rules).toContain('BR-ERP2-02');
      expect(bankField?.example).toBe('XXXX-XXXX-7890');
    });

    it('provides standard legacy mapping defaults', () => {
      expect(erp2VendorsMetadata.mappingDefaults).toEqual(
        expect.objectContaining({
          name: 'vendor_name',
          tax_number: 'tax_id',
          email: 'email',
          currency: 'currency',
          bank_masked: 'bank_account',
        })
      );
    });
  });

  describe('Purchase Orders Target Schema (erp2_purchase_orders)', () => {
    it('defines primary table attributes and keys', () => {
      expect(erp2PurchaseOrdersMetadata.entity).toBe('purchase_orders');
      expect(erp2PurchaseOrdersMetadata.targetTable).toBe('erp2_purchase_orders');
      expect(erp2PurchaseOrdersMetadata.primaryKey).toBe('id');
      expect(erp2PurchaseOrdersMetadata.naturalKey).toBe('po_number');
      expect(erp2PurchaseOrdersMetadata.schemaVersion).toBe(1);
    });

    it('enforces required fields: po_number, vendor_id, order_date, status, currency, total', () => {
      const requiredFieldNames = erp2PurchaseOrdersMetadata.fields
        .filter((f) => f.required)
        .map((f) => f.name);

      expect(requiredFieldNames).toContain('po_number');
      expect(requiredFieldNames).toContain('vendor_id');
      expect(requiredFieldNames).toContain('order_date');
      expect(requiredFieldNames).toContain('status');
      expect(requiredFieldNames).toContain('currency');
      expect(requiredFieldNames).toContain('total');
    });

    it('enforces explicit lifecycle states for status enum (FR-ERP2-04)', () => {
      const statusField = erp2PurchaseOrdersMetadata.fields.find((f) => f.name === 'status');
      expect(statusField).toBeDefined();
      expect(statusField?.type).toBe('enum');
      expect(statusField?.enumOptions).toEqual(['Draft', 'Sent', 'Received', 'Closed']);
      expect(statusField?.rules).toContain('FR-ERP2-04');
    });

    it('specifies decimal type for total (FR-ERP2-03, BR-ERP2-03)', () => {
      const totalField = erp2PurchaseOrdersMetadata.fields.find((f) => f.name === 'total');
      expect(totalField?.type).toBe('decimal');
      expect(totalField?.rules).toContain('FR-ERP2-03');
      expect(totalField?.rules).toContain('BR-ERP2-03');
    });
  });

  describe('Purchase Order Lines Target Schema (erp2_po_lines)', () => {
    it('defines primary table attributes and keys', () => {
      expect(erp2PoLinesMetadata.entity).toBe('po_lines');
      expect(erp2PoLinesMetadata.targetTable).toBe('erp2_po_lines');
      expect(erp2PoLinesMetadata.primaryKey).toBe('id');
      expect(erp2PoLinesMetadata.naturalKey).toBe('po_id,line_number');
      expect(erp2PoLinesMetadata.schemaVersion).toBe(1);
    });

    it('enforces required fields: po_id, product_id, line_number, quantity, price, line_total', () => {
      const requiredFieldNames = erp2PoLinesMetadata.fields
        .filter((f) => f.required)
        .map((f) => f.name);

      expect(requiredFieldNames).toContain('po_id');
      expect(requiredFieldNames).toContain('product_id');
      expect(requiredFieldNames).toContain('line_number');
      expect(requiredFieldNames).toContain('quantity');
      expect(requiredFieldNames).toContain('price');
      expect(requiredFieldNames).toContain('line_total');
    });

    it('enforces decimal types for quantity, price, and line_total', () => {
      const qtyField = erp2PoLinesMetadata.fields.find((f) => f.name === 'quantity');
      const priceField = erp2PoLinesMetadata.fields.find((f) => f.name === 'price');
      const totalField = erp2PoLinesMetadata.fields.find((f) => f.name === 'line_total');

      expect(qtyField?.type).toBe('decimal');
      expect(priceField?.type).toBe('decimal');
      expect(totalField?.type).toBe('decimal');
    });

    it('specifies cross-module reference rule to ERP-1 product master (Decision C7)', () => {
      const prodField = erp2PoLinesMetadata.fields.find((f) => f.name === 'product_id');
      expect(prodField?.type).toBe('uuid');
      expect(prodField?.rules).toContain('Decision C7');
    });
  });
});
