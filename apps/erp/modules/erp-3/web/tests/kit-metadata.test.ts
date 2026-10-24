/**
 * ERP-3 Sales Orders & Invoices — Web Kit Metadata Tests (ERP3-22)
 *
 * Verifies:
 * - Web kit metadata auto-registration in MigrationKitRegistry.
 * - Supply of target field definitions, human-readable labels, enum options, and required constraints.
 * - Exported entity definitions for Sales Orders, Sales Order Lines, Invoices, Invoice Lines.
 */

import { describe, it, expect } from 'vitest';
import { migrationKitRegistry } from '@cs/kit';
import {
  erp3WebKitMetadata,
  erp3SalesOrdersTargetMetadata,
  erp3SoLinesTargetMetadata,
  erp3InvoicesTargetMetadata,
  erp3InvoiceLinesTargetMetadata,
} from '../src/kit-metadata.js';

describe('ERP-3 Web Kit Metadata (ERP3-22)', () => {
  it('registers erp3 module metadata in the central registry (AC 1)', () => {
    const reg = migrationKitRegistry.get('erp3');
    expect(reg).toBeDefined();
    expect(reg?.moduleId).toBe('erp3');
    expect(reg?.moduleName).toBe('ERP-3 Sales Orders and Invoices');
    expect(reg?.defaultEntity).toBe('sales_orders');
  });

  it('contains all 4 domain entities', () => {
    expect(Object.keys(erp3WebKitMetadata.entities)).toEqual([
      'sales_orders',
      'so_lines',
      'invoices',
      'invoice_lines',
    ]);
  });

  it('supplies full target field definitions with data types and labels (AC 2)', () => {
    const fields = erp3SalesOrdersTargetMetadata.fields;
    const orderNumberField = fields.find((f) => f.name === 'order_number');
    const customerField = fields.find((f) => f.name === 'customer_golden_id');
    const orderDateField = fields.find((f) => f.name === 'order_date');
    const currField = fields.find((f) => f.name === 'currency');
    const statusField = fields.find((f) => f.name === 'status');
    const totalField = fields.find((f) => f.name === 'total');

    expect(orderNumberField).toMatchObject({
      name: 'order_number',
      label: 'Order Number',
      type: 'string',
      required: true,
    });
    expect(customerField).toMatchObject({
      name: 'customer_golden_id',
      label: 'Customer Golden ID',
      type: 'uuid',
      required: true,
    });
    expect(orderDateField).toMatchObject({
      name: 'order_date',
      label: 'Order Date',
      type: 'date',
      required: true,
    });
    expect(currField).toMatchObject({
      name: 'currency',
      label: 'Currency Code (ISO-4217)',
      type: 'string',
      required: true,
    });
    expect(statusField).toMatchObject({
      name: 'status',
      label: 'Order Status',
      type: 'enum',
      required: true,
      enumOptions: ['Open', 'Invoiced', 'Closed'],
    });
    expect(totalField).toMatchObject({
      name: 'total',
      label: 'Total Order Amount',
      type: 'decimal',
      required: false,
    });
  });

  it('supplies so_lines, invoices, and invoice_lines metadata', () => {
    expect(erp3SoLinesTargetMetadata.fields.map((f) => f.name)).toEqual([
      'order_id',
      'line_number',
      'product_id',
      'quantity',
      'unit_price',
      'tax_rate',
      'tax_amount',
      'line_total',
    ]);
    expect(erp3InvoicesTargetMetadata.fields.map((f) => f.name)).toEqual([
      'invoice_number',
      'order_id',
      'customer_golden_id',
      'invoice_date',
      'due_date',
      'currency',
      'status',
      'subtotal',
      'tax_total',
      'total',
      'source_system',
      'source_id',
    ]);
    expect(erp3InvoiceLinesTargetMetadata.fields.map((f) => f.name)).toEqual([
      'invoice_id',
      'line_number',
      'product_id',
      'quantity',
      'unit_price',
      'tax_rate',
      'tax_amount',
      'line_total',
    ]);
  });
});
