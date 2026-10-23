/**
 * ERP-2 Vendors & Purchasing — Public Contract & Domain Rules Test
 *
 * Tests prove:
 *   1. Vendor creation & update Zod validation (FR-ERP2-01, FR-ERP2-02)
 *   2. Bank details masking behavior (FR-ERP2-06): format XXXX-XXXX-7890
 *   3. Purchase order lifecycle state machine (FR-ERP2-04): Draft -> Sent -> Received -> Closed
 *   4. Decimal arithmetic for line totals and order totals (FR-ERP2-05)
 *   5. Product reference requirement on PO lines (BR-ERP2-01)
 *
 * @module erp2/tests/contracts/erp-2.contract.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  VendorSchema,
  CreateVendorRequestSchema,
  PatchVendorRequestSchema,
  CreatePurchaseOrderRequestSchema,
  PatchPurchaseOrderStatusRequestSchema,
  PurchaseOrderSchema,
  maskBankDetails,
  calculateLineTotal,
  calculateOrderTotal,
  parseToCents,
  formatFromCents,
  isValidPoStatusTransition,
  assertValidPoStatusTransition,
  PurchaseOrderStatusEnum,
} from '@clearshift/contracts';

describe('ERP-2 Vendor Contract & Masking (FR-ERP2-01, FR-ERP2-02, FR-ERP2-06)', () => {
  it('validates a valid create vendor request', () => {
    const input = {
      name: 'Acme Industrial Supplies',
      tax_number: 'GSTIN-27AAAAA0000A1Z5',
      email: 'sales@acme-supplies.com',
      phone: '+91-9876543210',
      address_line: '123 Maker Chambers',
      city: 'Mumbai',
      country: 'India',
      bank_details: '1234567890',
    };

    const parsed = CreateVendorRequestSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it('rejects a vendor request without name or tax number', () => {
    const missingName = {
      tax_number: 'TX-12345',
    };
    expect(CreateVendorRequestSchema.safeParse(missingName).success).toBe(false);

    const missingTax = {
      name: 'Acme',
    };
    expect(CreateVendorRequestSchema.safeParse(missingTax).success).toBe(false);
  });

  it('rejects unknown properties in CreateVendorRequest (strict schema)', () => {
    const withForbidden = {
      name: 'Acme',
      tax_number: 'TX-12345',
      role: 'admin',
    };
    expect(CreateVendorRequestSchema.safeParse(withForbidden).success).toBe(false);
  });

  it('masks bank details to XXXX-XXXX-7890 format (FR-ERP2-06)', () => {
    expect(maskBankDetails('1234567890')).toBe('XXXX-XXXX-7890');
    expect(maskBankDetails('9876543211')).toBe('XXXX-XXXX-3211');
    expect(maskBankDetails('99')).toBe('XXXX-XXXX-0099');
    expect(maskBankDetails('XXXX-XXXX-7890')).toBe('XXXX-XXXX-7890');
  });

  it('enforces BankMaskedSchema on serialized Vendor', () => {
    const validVendor = {
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'Acme Supplies',
      tax_number: 'TX-12345',
      email: 'acme@test.com',
      bank_masked: 'XXXX-XXXX-7890',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(VendorSchema.safeParse(validVendor).success).toBe(true);

    const unmaskedVendor = {
      ...validVendor,
      bank_masked: '1234567890', // Unmasked = invalid
    };
    expect(VendorSchema.safeParse(unmaskedVendor).success).toBe(false);
  });
});

describe('ERP-2 Purchase Order Lifecycle State Machine (FR-ERP2-04)', () => {
  it('allows valid forward status transitions: Draft -> Sent -> Received -> Closed', () => {
    expect(isValidPoStatusTransition('draft', 'sent')).toBe(true);
    expect(isValidPoStatusTransition('sent', 'received')).toBe(true);
    expect(isValidPoStatusTransition('received', 'closed')).toBe(true);

    expect(() => assertValidPoStatusTransition('draft', 'sent')).not.toThrow();
    expect(() => assertValidPoStatusTransition('sent', 'received')).not.toThrow();
    expect(() => assertValidPoStatusTransition('received', 'closed')).not.toThrow();
  });

  it('allows idempotent status transitions (same state)', () => {
    expect(isValidPoStatusTransition('draft', 'draft')).toBe(true);
    expect(isValidPoStatusTransition('sent', 'sent')).toBe(true);
  });

  it('rejects backwards status transitions', () => {
    expect(isValidPoStatusTransition('sent', 'draft')).toBe(false);
    expect(isValidPoStatusTransition('received', 'sent')).toBe(false);
    expect(isValidPoStatusTransition('closed', 'received')).toBe(false);

    expect(() => assertValidPoStatusTransition('sent', 'draft')).toThrow(/Invalid purchase order status transition/);
  });

  it('rejects skipping status steps (Draft -> Received without Sent)', () => {
    expect(isValidPoStatusTransition('draft', 'received')).toBe(false);
    expect(isValidPoStatusTransition('draft', 'closed')).toBe(false);
    expect(() => assertValidPoStatusTransition('draft', 'received')).toThrow();
  });

  it('forbids any transition out of closed (terminal state)', () => {
    expect(isValidPoStatusTransition('closed', 'draft')).toBe(false);
    expect(isValidPoStatusTransition('closed', 'sent')).toBe(false);
    expect(isValidPoStatusTransition('closed', 'received')).toBe(false);
  });

  it('validates PatchPurchaseOrderStatusRequestSchema', () => {
    expect(PatchPurchaseOrderStatusRequestSchema.safeParse({ status: 'sent' }).success).toBe(true);
    expect(PatchPurchaseOrderStatusRequestSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
  });
});

describe('Fixed-Precision Decimal Arithmetic (FR-ERP2-05)', () => {
  it('parses amounts to minor units without floating point loss', () => {
    expect(parseToCents('100.50')).toBe(10050n);
    expect(parseToCents('100.5')).toBe(10050n);
    expect(parseToCents('100')).toBe(10000n);
    expect(parseToCents('0.05')).toBe(5n);
    expect(formatFromCents(10050n)).toBe('100.50');
  });

  it('calculates line_total = quantity * price correctly', () => {
    // 5 units @ 12.50 = 62.50
    expect(calculateLineTotal('5', '12.50')).toBe('62.50');
    // Fractional quantity: 2.5 units @ 10.00 = 25.00
    expect(calculateLineTotal('2.5', '10.00')).toBe('25.00');
    // 3 units @ 33.33 = 99.99
    expect(calculateLineTotal('3', '33.33')).toBe('99.99');
  });

  it('calculates order total from multiple lines', () => {
    const lines = [
      { quantity: '2', price: '10.50' }, // 21.00
      { quantity: '3', price: '5.25' },  // 15.75
      { quantity: '1', price: '100.00' },// 100.00
    ];
    // 21.00 + 15.75 + 100.00 = 136.75
    expect(calculateOrderTotal(lines)).toBe('136.75');
  });

  it('avoids IEEE-754 0.1 + 0.2 error in totals', () => {
    const lines = [
      { quantity: '1', price: '0.10' },
      { quantity: '1', price: '0.20' },
    ];
    expect(calculateOrderTotal(lines)).toBe('0.30');
  });
});

describe('Purchase Order Lines & Product Reference (BR-ERP2-01)', () => {
  it('validates a complete purchase order creation payload with product lines', () => {
    const payload = {
      po_number: 'PO-2026-0001',
      vendor_id: 'b0000000-0000-0000-0000-000000000001',
      order_date: '2026-10-22',
      currency: 'INR',
      notes: 'Initial test procurement',
      lines: [
        {
          product_id: 'c0000000-0000-0000-0000-000000000001',
          quantity: '10',
          price: '150.00',
        },
        {
          product_id: 'c0000000-0000-0000-0000-000000000002',
          quantity: '5.5',
          price: '200.00',
        },
      ],
    };

    const res = CreatePurchaseOrderRequestSchema.safeParse(payload);
    expect(res.success).toBe(true);
  });

  it('rejects a purchase order without line items', () => {
    const payload = {
      po_number: 'PO-2026-0002',
      vendor_id: 'b0000000-0000-0000-0000-000000000001',
      order_date: '2026-10-22',
      lines: [],
    };
    expect(CreatePurchaseOrderRequestSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects purchase order lines with zero or negative quantity', () => {
    const zeroQuantity = {
      po_number: 'PO-2026-0003',
      vendor_id: 'b0000000-0000-0000-0000-000000000001',
      order_date: '2026-10-22',
      lines: [
        {
          product_id: 'c0000000-0000-0000-0000-000000000001',
          quantity: '0',
          price: '50.00',
        },
      ],
    };
    expect(CreatePurchaseOrderRequestSchema.safeParse(zeroQuantity).success).toBe(false);
  });

  it('rejects purchase order lines with negative price', () => {
    const negativePrice = {
      po_number: 'PO-2026-0004',
      vendor_id: 'b0000000-0000-0000-0000-000000000001',
      order_date: '2026-10-22',
      lines: [
        {
          product_id: 'c0000000-0000-0000-0000-000000000001',
          quantity: '5',
          price: '-10.00',
        },
      ],
    };
    expect(CreatePurchaseOrderRequestSchema.safeParse(negativePrice).success).toBe(false);
  });
});
