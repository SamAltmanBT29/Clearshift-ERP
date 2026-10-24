/**
 * ERP-3 Sales Orders & Invoices — Public Contract & Domain Rules Test (ERP3-29)
 *
 * Tests prove:
 *   1. Sales order creation Zod validation (customer Golden ID UUID per ADR-003, date, lines)
 *   2. Order lifecycle forward-only transitions: Open -> Invoiced -> Closed (FR-ERP3-05)
 *   3. Fixed-precision 4-dp arithmetic (calculateLineAmounts, validateOrderLineTotals per BR-ERP3-01)
 *   4. Invoice creation validation with mandatory due date (DR-2)
 *   5. Dynamic invoice status derivation: Open -> Paid -> Overdue (FR-ERP3-02, FR-ERP3-04)
 *   6. Payment creation schema validation (FR-ERP3-03: cash/bank/card methods)
 *
 * @module erp3/tests/contracts/erp-3.contract.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  CreateSalesOrderRequestSchema,
  SalesOrderSchema,
  UpdateSalesOrderStatusRequestSchema,
  ALLOWED_ORDER_STATUS_TRANSITIONS,
  calculateLineAmounts,
  validateOrderLineTotals,
  CreateInvoiceRequestSchema,
  InvoiceSchema,
  deriveInvoiceStatus,
  CreatePaymentRequestSchema,
  PaymentSchema,
  CustomerGoldenIdSchema,
  SalesOrderStatusEnum,
  InvoiceStatusEnum,
  PaymentMethodEnum,
} from '@clearshift/contracts';

const VALID_UUID = '55555555-0003-4000-8000-000000000001';
const PRODUCT_UUID = '11111111-0001-4000-8000-000000000001';

describe('ERP-3 Sales Order Contract & Validation (FR-ERP3-01, ADR-003)', () => {
  it('validates a valid CreateSalesOrderRequest payload', () => {
    const payload = {
      customer_golden_id: VALID_UUID,
      order_date: '2026-10-24',
      currency: 'USD',
      lines: [
        {
          product_id: PRODUCT_UUID,
          quantity: '2.0000',
          price: '50.0000',
          tax_rate: '10.0000',
        },
      ],
    };
    const result = CreateSalesOrderRequestSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('strictly validates customer_golden_id as a UUID v4 per ADR-003', () => {
    expect(CustomerGoldenIdSchema.safeParse(VALID_UUID).success).toBe(true);
    expect(CustomerGoldenIdSchema.safeParse('gid-cust-12345').success).toBe(false);
    expect(CustomerGoldenIdSchema.safeParse('').success).toBe(false);
    expect(CustomerGoldenIdSchema.safeParse('not-a-uuid').success).toBe(false);
  });

  it('rejects sales order payload without line items', () => {
    const emptyLines = {
      customer_golden_id: VALID_UUID,
      order_date: '2026-10-24',
      currency: 'USD',
      lines: [],
    };
    expect(CreateSalesOrderRequestSchema.safeParse(emptyLines).success).toBe(false);
  });

  it('rejects invalid or malformed order_date', () => {
    const invalidDate = {
      customer_golden_id: VALID_UUID,
      order_date: '2026-02-31', // non-existent date
      currency: 'USD',
      lines: [{ product_id: PRODUCT_UUID, quantity: '1.0000', price: '10.0000', tax_rate: '0.0000' }],
    };
    expect(CreateSalesOrderRequestSchema.safeParse(invalidDate).success).toBe(false);
  });

  it('rejects negative quantity or negative price', () => {
    const negativeQty = {
      customer_golden_id: VALID_UUID,
      order_date: '2026-10-24',
      currency: 'USD',
      lines: [{ product_id: PRODUCT_UUID, quantity: '-1.0000', price: '10.0000', tax_rate: '0.0000' }],
    };
    expect(CreateSalesOrderRequestSchema.safeParse(negativeQty).success).toBe(false);
  });
});

describe('ERP-3 Sales Order Lifecycle Transitions (FR-ERP3-05)', () => {
  it('enforces forward-only transitions from Open -> Invoiced -> Closed', () => {
    expect(ALLOWED_ORDER_STATUS_TRANSITIONS.Open).toContain('Invoiced');
    expect(ALLOWED_ORDER_STATUS_TRANSITIONS.Open).toContain('Closed');
    expect(ALLOWED_ORDER_STATUS_TRANSITIONS.Invoiced).toContain('Closed');
    expect(ALLOWED_ORDER_STATUS_TRANSITIONS.Closed).toEqual([]);
  });

  it('validates UpdateSalesOrderStatusRequestSchema against enum values', () => {
    expect(UpdateSalesOrderStatusRequestSchema.safeParse({ status: 'Open' }).success).toBe(true);
    expect(UpdateSalesOrderStatusRequestSchema.safeParse({ status: 'Invoiced' }).success).toBe(true);
    expect(UpdateSalesOrderStatusRequestSchema.safeParse({ status: 'Closed' }).success).toBe(true);
    expect(UpdateSalesOrderStatusRequestSchema.safeParse({ status: 'Cancelled' }).success).toBe(false);
  });
});

describe('Decimal Precision & Order Line Calculations (BR-ERP3-01, BR-ERP3-02)', () => {
  it('computes line subtotal, tax_amount, and line_total at 4-dp', () => {
    // 2 units @ 50.0000 with 10.0000% tax: subtotal = 100.0000, tax = 10.0000, total = 110.0000
    const calc = calculateLineAmounts('2.0000', '50.0000', '10.0000');
    expect(calc.subtotal).toBe('100.0000');
    expect(calc.tax_amount).toBe('10.0000');
    expect(calc.line_total).toBe('110.0000');
  });

  it('handles zero tax rate correctly', () => {
    const calc = calculateLineAmounts('5.0000', '20.0000', '0.0000');
    expect(calc.subtotal).toBe('100.0000');
    expect(calc.tax_amount).toBe('0.0000');
    expect(calc.line_total).toBe('100.0000');
  });

  it('validates order total matches sum of lines (BR-ERP3-01)', () => {
    const lines = [
      { line_total: '110.0000' },
      { line_total: '220.0000' },
    ];
    expect(validateOrderLineTotals(lines, '330.0000')).toBe(true);
    expect(validateOrderLineTotals(lines, '330.0001')).toBe(false);
  });
});

describe('ERP-3 Invoice Contract & Lifecycle (FR-ERP3-02, DR-2)', () => {
  it('validates CreateInvoiceRequest with mandatory due_date (DR-2)', () => {
    const payload = {
      order_id: VALID_UUID,
      customer_golden_id: VALID_UUID,
      invoice_date: '2026-10-24',
      due_date: '2026-11-24',
      currency: 'USD',
      lines: [
        {
          order_line_id: VALID_UUID,
          product_id: PRODUCT_UUID,
          quantity: '1.0000',
          price: '100.0000',
          tax_rate: '10.0000',
        },
      ],
    };
    expect(CreateInvoiceRequestSchema.safeParse(payload).success).toBe(true);

    const missingDueDate = { ...payload, due_date: undefined };
    expect(CreateInvoiceRequestSchema.safeParse(missingDueDate).success).toBe(false);
  });

  it('derives status correctly: Paid when fully paid, Overdue when past due, Open otherwise', () => {
    // Fully paid
    expect(deriveInvoiceStatus('100.0000', '100.0000', '2026-11-01', '2026-10-24')).toBe('Paid');
    expect(deriveInvoiceStatus('100.0000', '150.0000', '2026-11-01', '2026-10-24')).toBe('Paid');

    // Overdue
    expect(deriveInvoiceStatus('100.0000', '50.0000', '2026-10-01', '2026-10-24')).toBe('Overdue');

    // Open
    expect(deriveInvoiceStatus('100.0000', '50.0000', '2026-11-01', '2026-10-24')).toBe('Open');
  });
});

describe('ERP-3 Payment Contract (FR-ERP3-03)', () => {
  it('validates payment creation with allowed payment methods', () => {
    for (const method of ['cash', 'bank', 'card'] as const) {
      const payload = {
        invoice_id: VALID_UUID,
        payment_date: '2026-10-24',
        amount: '100.0000',
        currency: 'USD',
        method,
        reference: `REF-${method}`,
      };
      expect(CreatePaymentRequestSchema.safeParse(payload).success).toBe(true);
    }
  });

  it('rejects unapproved payment method (e.g. crypto)', () => {
    const payload = {
      invoice_id: VALID_UUID,
      payment_date: '2026-10-24',
      amount: '100.0000',
      currency: 'USD',
      method: 'crypto',
    };
    expect(CreatePaymentRequestSchema.safeParse(payload).success).toBe(false);
  });
});
