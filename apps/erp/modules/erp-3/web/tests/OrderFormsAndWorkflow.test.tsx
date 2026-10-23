// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OrderForm } from '../src/components/forms/OrderForm.js';
import { InvoiceForm } from '../src/components/forms/InvoiceForm.js';
import { PaymentModal } from '../src/components/forms/PaymentModal.js';
import { ConfirmActionDialog } from '../src/components/forms/ConfirmActionDialog.js';
import { OrderDetailPage } from '../src/pages/OrderDetailPage.js';
import { InvoiceDetailPage } from '../src/pages/InvoiceDetailPage.js';
import { OrdersListPage } from '../src/pages/OrdersListPage.js';
import * as api from '../src/api/erp-3.js';
import type { SalesOrder, Invoice, Payment } from '@clearshift/contracts';

const ORDER_ID = 'aaaaaaaa-0003-4000-8000-000000000101';
const LINE_ID = 'bbbbbbbb-0003-4000-8000-000000000101';
const INVOICE_ID = 'cccccccc-0003-4000-8000-000000000201';
const PAYMENT_ID = 'eeeeeeee-0003-4000-8000-000000000301';
const CUSTOMER_GOLDEN_ID = '55555555-0003-4000-8000-000000000001';
const PRODUCT_ID = '11111111-0001-4000-8000-000000000001';

const mockOrder: SalesOrder = {
  id: ORDER_ID,
  order_number: 'SO-101',
  customer_golden_id: CUSTOMER_GOLDEN_ID,
  order_date: '2026-10-23',
  status: 'Open',
  currency: 'USD',
  total: '220.0000',
  lines: [
    {
      id: LINE_ID,
      order_id: ORDER_ID,
      product_id: PRODUCT_ID,
      quantity: '2.0000',
      price: '100.0000',
      tax_rate: '10.0000',
      tax_amount: '20.0000',
      line_total: '220.0000',
      created_at: '2026-10-23T00:00:00.000Z',
    },
  ],
  source_system: null,
  source_id: null,
  created_at: '2026-10-23T00:00:00.000Z',
  updated_at: '2026-10-23T00:00:00.000Z',
};

const mockInvoice: Invoice = {
  id: INVOICE_ID,
  invoice_number: 'INV-2026-201',
  order_id: ORDER_ID,
  customer_golden_id: CUSTOMER_GOLDEN_ID,
  invoice_date: '2026-10-23',
  due_date: '2026-11-23',
  status: 'Open',
  currency: 'USD',
  total: '220.0000',
  lines: [
    {
      id: 'dddddddd-0003-4000-8000-000000000201',
      invoice_id: INVOICE_ID,
      product_id: PRODUCT_ID,
      quantity: '2.0000',
      price: '100.0000',
      tax_rate: '10.0000',
      tax_amount: '20.0000',
      line_total: '220.0000',
      created_at: '2026-10-23T00:00:00.000Z',
    },
  ],
  source_system: null,
  source_id: null,
  created_at: '2026-10-23T00:00:00.000Z',
  updated_at: '2026-10-23T00:00:00.000Z',
};

const mockPayment: Payment = {
  id: PAYMENT_ID,
  invoice_id: INVOICE_ID,
  amount: '220.0000',
  paid_at: '2026-10-23T00:00:00.000Z',
  method: 'bank',
  created_at: '2026-10-23T00:00:00.000Z',
};

describe('ERP-3 Form Components & Client-Side Validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('OrderForm: Client-Side Validation & Live Calculations', () => {
    it('validates Customer Golden ID UUID format (ADR-003) and rejects non-UUID IDs', async () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(<OrderForm onSubmit={onSubmit} onCancel={onCancel} />);

      const gidInput = screen.getByLabelText(/Customer Golden ID/i);
      const submitBtn = screen.getByRole('button', { name: /Save sales order/i });

      // Invalid non-UUID ID (e.g. legacy gid-* string)
      fireEvent.change(gidInput, { target: { value: 'gid-cust-001' } });
      fireEvent.click(submitBtn);

      expect(
        await screen.findByText(/Customer Golden ID is required and must be a valid UUID/i)
      ).toBeDefined();
      expect(onSubmit).not.toHaveBeenCalled();

      // Valid UUID Golden ID and Product ID
      fireEvent.change(gidInput, { target: { value: CUSTOMER_GOLDEN_ID } });
      const prodInput = screen.getByLabelText(/Line 1 Product ID/i);
      fireEvent.change(prodInput, { target: { value: PRODUCT_ID } });

      fireEvent.click(submitBtn);
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            customer_golden_id: CUSTOMER_GOLDEN_ID,
            currency: 'USD',
            lines: [
              expect.objectContaining({
                product_id: PRODUCT_ID,
                quantity: '1.0000',
                price: '100.0000',
                tax_rate: '10.0000',
              }),
            ],
          })
        );
      });
    });

    it('computes live line amounts and order totals as user edits line items', async () => {
      render(<OrderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

      const qtyInput = screen.getByLabelText(/Line 1 Quantity/i);
      const priceInput = screen.getByLabelText(/Line 1 Unit Price/i);
      const taxRateInput = screen.getByLabelText(/Line 1 Tax Rate/i);

      // Set Qty: 5, Price: 50.0000, Tax Rate: 10.0000 (10%)
      // Subtotal = 250.00, Tax = 25.00, Total = 275.00
      fireEvent.change(qtyInput, { target: { value: '5' } });
      fireEvent.change(priceInput, { target: { value: '50.0000' } });
      fireEvent.change(taxRateInput, { target: { value: '10.0000' } });

      expect(await screen.findByText('$275.00')).toBeDefined();
      expect(screen.getByText('$250.00 USD')).toBeDefined();
      expect(screen.getByText('$25.00 USD')).toBeDefined();
      expect(screen.getByText('$275.00 USD')).toBeDefined();
    });

    it('preserves user inputs and displays error banner when server rejects submission', async () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <OrderForm
          onSubmit={onSubmit}
          onCancel={onCancel}
          initialValues={{ customer_golden_id: CUSTOMER_GOLDEN_ID, notes: 'Important memo' }}
          apiError="Database connection timeout"
        />
      );

      expect(screen.getByText(/Database connection timeout/i)).toBeDefined();
      const gidInput = screen.getByLabelText(/Customer Golden ID/i) as HTMLInputElement;
      const notesInput = screen.getByLabelText(/Notes \/ Instructions/i) as HTMLTextAreaElement;

      expect(gidInput.value).toBe(CUSTOMER_GOLDEN_ID);
      expect(notesInput.value).toBe('Important memo');
    });

    it('allows adding and removing dynamic line items but retains at least one line', async () => {
      render(<OrderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

      expect(screen.getAllByLabelText(/Product ID/i)).toHaveLength(1);

      // Add a line
      const addBtn = screen.getByRole('button', { name: /Add line item/i });
      fireEvent.click(addBtn);

      expect(screen.getAllByLabelText(/Product ID/i)).toHaveLength(2);

      // Remove the second line
      const removeBtns = screen.getAllByRole('button', { name: /Remove line/i });
      fireEvent.click(removeBtns[1]!);

      expect(screen.getAllByLabelText(/Product ID/i)).toHaveLength(1);
    });
  });

  describe('InvoiceForm: Required Due Date & Order Reference Validation', () => {
    it('enforces required due_date and UUID order_id and submits canonical CreateInvoiceRequest', async () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <InvoiceForm
          onSubmit={onSubmit}
          onCancel={onCancel}
          sourceOrder={mockOrder}
          initialValues={{ order_id: '', due_date: '' }}
        />
      );

      const submitBtn = screen.getByRole('button', { name: /Generate invoice/i });
      fireEvent.click(submitBtn);

      expect(await screen.findByText(/Sales Order ID is required/i)).toBeDefined();
      expect(await screen.findByText(/Due date is required/i)).toBeDefined();
      expect(onSubmit).not.toHaveBeenCalled();

      // Enter valid canonical UUID and due_date
      const orderInput = screen.getByLabelText(/Sales Order ID/i);
      const dueInput = screen.getByLabelText(/Due Date/i);

      fireEvent.change(orderInput, { target: { value: ORDER_ID } });
      fireEvent.change(dueInput, { target: { value: '2026-11-30' } });

      fireEvent.click(submitBtn);
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            order_id: ORDER_ID,
            customer_golden_id: CUSTOMER_GOLDEN_ID,
            due_date: '2026-11-30',
            currency: 'USD',
            lines: expect.arrayContaining([
              expect.objectContaining({
                product_id: PRODUCT_ID,
                quantity: '2.0000',
                price: '100.0000',
                tax_rate: '10.0000',
              }),
            ]),
          })
        );
      });
    });
  });

  describe('PaymentModal: Invariant Full Settlement Validation', () => {
    it('enforces full payment amount matching invoice balance due and submits canonical CreatePaymentRequest', async () => {
      const onSubmit = vi.fn();
      const onClose = vi.fn();

      render(
        <PaymentModal
          isOpen={true}
          invoice={mockInvoice}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      );

      const amountInput = screen.getByLabelText(/Payment Amount/i);
      const submitBtn = screen.getByRole('button', { name: /Confirm payment submission/i });

      // Try partial payment (e.g. 50.00 when balance is 220.00)
      fireEvent.change(amountInput, { target: { value: '50.00' } });
      fireEvent.click(submitBtn);

      expect(await screen.findByText(/V1 requires full invoice settlement/i)).toBeDefined();
      expect(onSubmit).not.toHaveBeenCalled();

      // Restore full balance (220.00)
      fireEvent.change(amountInput, { target: { value: '220.00' } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            invoice_id: INVOICE_ID,
            amount: '220.0000',
            method: 'bank',
          })
        );
      });
    });
  });

  describe('ConfirmActionDialog: Irreversible Status Transitions', () => {
    it('executes callbacks on confirm and cancel', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmActionDialog
          isOpen={true}
          title="Close Sales Order?"
          message="This action is irreversible."
          confirmLabel="Yes, Close"
          cancelLabel="No, Cancel"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText('Close Sales Order?')).toBeDefined();
      const cancelBtn = screen.getByRole('button', { name: 'No, Cancel' });
      fireEvent.click(cancelBtn);
      expect(onCancel).toHaveBeenCalledTimes(1);

      const confirmBtn = screen.getByRole('button', { name: 'Yes, Close' });
      fireEvent.click(confirmBtn);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ERP-3 Detail Views & Full Workflow Interactions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('OrderDetailPage: Viewing Lines & Triggering Status Transitions', () => {
    it('renders order metadata, lines table, and prompts confirmation when closing order', async () => {
      vi.spyOn(api, 'fetchSalesOrderById').mockResolvedValue(mockOrder);
      const patchSpy = vi.spyOn(api, 'updateSalesOrderStatus').mockResolvedValue({
        ...mockOrder,
        status: 'Closed',
      });
      const onBack = vi.fn();
      const onCreateInvoice = vi.fn();

      render(
        <OrderDetailPage
          orderId={ORDER_ID}
          onBack={onBack}
          onCreateInvoice={onCreateInvoice}
        />
      );

      expect(await screen.findByText('Sales Order SO-101')).toBeDefined();
      expect(screen.getByText(PRODUCT_ID)).toBeDefined();
      expect(screen.getAllByText('$220.00 USD').length).toBeGreaterThan(0);

      // Trigger Close Order confirmation
      const closeBtn = screen.getByRole('button', { name: /Close sales order/i });
      fireEvent.click(closeBtn);

      expect(screen.getByText('Close Sales Order?')).toBeDefined();
      const confirmCloseBtn = screen.getByRole('button', { name: 'Yes, Close Order' });
      fireEvent.click(confirmCloseBtn);

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith(ORDER_ID, { status: 'Closed' });
      });

      // Back navigation
      const backBtn = screen.getByRole('button', { name: /Back to Sales Orders & Invoices list/i });
      fireEvent.click(backBtn);
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('triggers generate invoice action when button is clicked', async () => {
      vi.spyOn(api, 'fetchSalesOrderById').mockResolvedValue(mockOrder);
      const onCreateInvoice = vi.fn();

      render(
        <OrderDetailPage
          orderId={ORDER_ID}
          onBack={vi.fn()}
          onCreateInvoice={onCreateInvoice}
        />
      );

      await screen.findByText('Sales Order SO-101');
      const invoiceActionBtn = screen.getByRole('button', { name: /Generate invoice for order/i });
      fireEvent.click(invoiceActionBtn);

      expect(onCreateInvoice).toHaveBeenCalledWith(mockOrder);
    });
  });

  describe('InvoiceDetailPage: Viewing Invoices, History & Payment Workflow', () => {
    it('renders invoice details, shows overdue notice, and records full payment', async () => {
      const overdueInvoice: Invoice = {
        ...mockInvoice,
        status: 'Overdue',
        due_date: '2026-10-01',
      };

      vi.spyOn(api, 'fetchInvoiceById').mockResolvedValue(overdueInvoice);
      vi.spyOn(api, 'fetchPayments').mockResolvedValue({
        items: [mockPayment],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });
      const paymentSpy = vi.spyOn(api, 'createPayment').mockResolvedValue(mockPayment);
      const onBack = vi.fn();

      render(<InvoiceDetailPage invoiceId={INVOICE_ID} onBack={onBack} />);

      expect(await screen.findByText('Invoice INV-2026-201')).toBeDefined();
      expect(screen.getByText(/⚠️ Overdue/i)).toBeDefined();
      expect(screen.getByText(PAYMENT_ID)).toBeDefined();

      // Open payment modal
      const recordBtn = screen.getByRole('button', { name: /Record payment for invoice/i });
      fireEvent.click(recordBtn);

      expect(screen.getByText(/Record Payment for INV-2026-201/i)).toBeDefined();
      const submitPaymentBtn = screen.getByRole('button', { name: /Confirm payment submission/i });
      fireEvent.click(submitPaymentBtn);

      await waitFor(() => {
        expect(paymentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            invoice_id: INVOICE_ID,
            amount: '220.0000',
          })
        );
      });
    });
  });

  describe('OrdersListPage: Full Workflow View Switching', () => {
    it('navigates seamlessly between list, create order, order detail, and invoice detail', async () => {
      vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      vi.spyOn(api, 'fetchInvoices').mockResolvedValue({
        items: [mockInvoice],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      vi.spyOn(api, 'fetchSalesOrderById').mockResolvedValue(mockOrder);
      vi.spyOn(api, 'fetchInvoiceById').mockResolvedValue(mockInvoice);
      vi.spyOn(api, 'fetchPayments').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
      });

      render(<OrdersListPage />);

      await screen.findByText('SO-101');

      // Click "+ New Sales Order"
      const newOrderBtn = screen.getByRole('button', { name: /Create new sales order/i });
      fireEvent.click(newOrderBtn);

      expect(await screen.findByText('New Sales Order')).toBeDefined();

      // Click "← Back to Sales Orders & Invoices"
      const backBtn = screen.getByRole('button', { name: /Back to Sales Orders & Invoices list/i });
      fireEvent.click(backBtn);

      // Back to list
      expect(await screen.findByText('SO-101')).toBeDefined();

      // Click "View" on order SO-101
      const viewOrderBtn = screen.getByRole('button', { name: 'View order SO-101' });
      fireEvent.click(viewOrderBtn);

      expect(await screen.findByText('Sales Order SO-101')).toBeDefined();
    });
  });
});
