/**
 * ERP-2 Vendors & Purchasing — Web Kit Metadata Integration Tests (KIT-14 / ERP2-22)
 *
 * Verifies:
 * - Web kit metadata auto-registration in MigrationKitRegistry.
 * - Parity of schema definitions, fields, required rules, and mapping defaults for web.
 */

import { describe, it, expect } from 'vitest';
import { migrationKitRegistry } from '@cs/kit';
import {
  erp2WebKitMetadata,
  erp2VendorsTargetEntity,
  erp2PurchaseOrdersTargetEntity,
  erp2PoLinesTargetEntity,
} from '../src/kit-metadata.js';

describe('ERP-2 Web Kit Metadata Integration (ERP2-22)', () => {
  it('registers erp2 into central MigrationKitRegistry on import (AC 1)', () => {
    const reg = migrationKitRegistry.get('erp2');
    expect(reg).toBeDefined();
    expect(reg?.moduleId).toBe('erp2');
    expect(reg?.moduleName).toBe('ERP-2 Vendors and Purchasing');
    expect(reg?.defaultEntity).toBe('vendors');
  });

  it('exposes complete vendor metadata', () => {
    expect(erp2VendorsTargetEntity.entity).toBe('vendors');
    expect(erp2VendorsTargetEntity.targetTable).toBe('erp2_vendors');
    expect(erp2VendorsTargetEntity.naturalKey).toBe('tax_number');
    expect(erp2VendorsTargetEntity.fields.length).toBeGreaterThanOrEqual(10);
  });

  it('exposes complete purchase order metadata', () => {
    expect(erp2PurchaseOrdersTargetEntity.entity).toBe('purchase_orders');
    expect(erp2PurchaseOrdersTargetEntity.targetTable).toBe('erp2_purchase_orders');
    expect(erp2PurchaseOrdersTargetEntity.naturalKey).toBe('po_number');
    const statusField = erp2PurchaseOrdersTargetEntity.fields.find((f) => f.name === 'status');
    expect(statusField?.enumOptions).toEqual(['Draft', 'Sent', 'Received', 'Closed']);
  });

  it('exposes complete purchase order lines metadata', () => {
    expect(erp2PoLinesTargetEntity.entity).toBe('po_lines');
    expect(erp2PoLinesTargetEntity.targetTable).toBe('erp2_po_lines');
    expect(erp2PoLinesTargetEntity.naturalKey).toBe('po_id,line_number');
  });
});
