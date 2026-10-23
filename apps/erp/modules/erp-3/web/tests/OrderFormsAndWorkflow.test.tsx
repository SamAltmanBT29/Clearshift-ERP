// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OrderForm } from '../src/components/forms/OrderForm.js';
import { InvoiceForm } from '../src/components/forms/InvoiceForm.js';
import { PaymentModal } from '../src/components/forms/PaymentModal.js';
import { ConfirmActionDialog } from '../src/components/forms/ConfirmActionDialog.js';
import { OrderCreatePage } from '../src/pages/OrderCreatePage.js';
import { OrderDetailPage } from '../src/pages/OrderDetailPage.js';
import { InvoiceCreatePage } from '../src/pages/InvoiceCreatePage.js';
import { InvoiceDetailPage } from '../src/pages/InvoiceDetailPage.js';
import { OrdersListPage } from '../src/pages/OrdersListPage.js';
import * as api from '../src/api/erp-3.js';
import type { SalesOrder, Invoice, Payment } from '@clearshift/contracts';

const mockOrder: SalesOrder = {
  id: 'so-101',
  orderNumber: 'SO-101',
  customerGoldenId: 'gid-cust-001',
  orderDate: '2026-10-23',
  status: 'open',
  subtotal: '200.00',
  taxTotal: '20.00',
  total: '220.00',
  currencyCode: 'USD',
  notes: 'Ship via priority freight',
  lines: [
    {
      id: 'sol-1',
      orderId: 'so-101',
      productId: 'PROD-01',
      productName: 'Product Alpha',
      quantity: 2,
      unitPrice: '100.00',
      taxRate: '0.10',
      taxAmount: '20.00',
      lineTotal: '220.00',
    },
  ],
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

const mockInvoice: Invoice = {
  id: 'inv-201',
  invoiceNumber: 'INV-2026-201',
  orderId: 'so-101',
  customerGoldenId: 'gid-cust-001',
  invoiceDate: '2026-10-23',
  dueDate: '2026-11-23',
  total: '220.00',
  paidAmount: '0.00',
  currencyCode: 'USD',
  status: 'open',
  notes: 'Net 30 payment terms',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

const mockPayment: Payment = {
  id: 'pay-301',
  invoiceId: 'inv-201',
  amount: '220.00',
  currencyCode: 'USD',
  paidAt: '2026-10-23',
  method: 'bank',
  reference: 'WIRE-998877',
  createdAt: '2026-10-23T00:00:00Z',
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
    it('validates Customer Golden ID format and rejects non-conforming IDs', async () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(<OrderForm onSubmit={onSubmit} onCancel={onCancel} />);

      const gidInput = screen.getByLabelText(/Customer Golden ID/i);
      const submitBtn = screen.getByRole('button', { name: /Save sales order/i });

      // Invalid ID
      fireEvent.change(gidInput, { target: { value: 'invalid-cust-id' } });
      fireEvent.click(submitBtn);

      expect(await screen.findByText(/Customer Golden ID is required and must follow the gid-<identifier> format/i)).toBeDefined();
      expect(onSubmit).not.toHaveBeenCalled();

      // Valid case-insensitive ID
      fireEvent.change(gidInput, { target: { value: 'GID-ACME-001' } });
      const prodInput = screen.getByLabelText(/Line 1 Product ID/i);
      fireEvent.change(prodInput, { target: { value: 'PROD-101' } });

      fireEvent.click(submitBtn);
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            customerGoldenId: 'GID-ACME-001',
          })
        );
      });
    });

    it('computes live line amounts and order totals as user edits line items', async () => {
      render(<OrderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

      const qtyInput = screen.getByLabelText(/Line 1 Quantity/i);
      const priceInput = screen.getByLabelText(/Line 1 Unit Price/i);
      const taxRateInput = screen.getByLabelText(/Line 1 Tax Rate/i);

      // Set Qty: 5, Price: 50.00, Tax Rate: 0.10
      // Subtotal = 250.00, Tax = 25.00, Total = 275.00
      fireEvent.change(qtyInput, { target: { value: '5' } });
      fireEvent.change(priceInput, { target: { value: '50.00' } });
      fireEvent.change(taxRateInput, { target: { value: '0.10' } });

      expect(await screen.findByText('$275.00')).toBeDefined();
      expect(screen.getByText('$250.00 USD')).toBeDefined();
      expect(screen.getByText('$25.00 USD')).toBeDefined();
      expect(screen.getByText('$275.00 USD')).toBeDefined();
    });

    it('preserves user inputs and displays error banner when server rejects submission', async () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      const { rerender } = render(
        <OrderForm
          onSubmit={onSubmit}
          onCancel={onCancel}
          initialValues={{ customerGoldenId: 'gid-keep-me', notes: 'Important memo' }}
          apiError="Database connection timeout"
        />
      );

      expect(screen.getByText(/Database connection timeout/i)).toBeDefined();
      const gidInput = screen.getByLabelText(/Customer Golden ID/i) as HTMLInputElement;
      const notesInput = screen.getByLabelText(/Notes \/ Instructions/i) as HTMLTextAreaElement;

      expect(gidInput.value).toBe('gid-keep-me');
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
    it('enforces required due date and order ID', async () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(<InvoiceForm onSubmit={onSubmit} onCancel={onCancel} initialValues={{ orderId: '', dueDate: '' }} />);

      const submitBtn = screen.getByRole('button', { name: /Generate invoice/i });
      fireEvent.click(submitBtn);

      expect(await screen.findByText(/Sales Order ID is required/i)).toBeDefined();
      expect(await screen.findByText(/Due date is required/i)).toBeDefined();
      expect(onSubmit).not.toHaveBeenCalled();

      // Enter valid values
      const orderInput = screen.getByLabelText(/Sales Order ID/i);
      const dueInput = screen.getByLabelText(/Due Date/i);

      fireEvent.change(orderInput, { target: { value: 'so-101' } });
      fireEvent.change(dueInput, { target: { value: '2026-11-30' } });

      fireEvent.click(submitBtn);
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            orderId: 'so-101',
            dueDate: '2026-11-30',
          })
        );
      });
    });
  });

  describe('PaymentModal: Invariant Full Settlement Validation', () => {
    it('enforces full payment amount matching invoice balance due in V1', async () => {
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
            invoiceId: 'inv-201',
            amount: '220.00',
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

      const { rerender } = render(
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
        status: 'closed',
      });
      const onBack = vi.fn();
      const onCreateInvoice = vi.fn();

      render(
        <OrderDetailPage
          orderId="so-101"
          onBack={onBack}
          onCreateInvoice={onCreateInvoice}
        />
      );

      expect(await screen.findByText('Sales Order SO-101')).toBeDefined();
      expect(screen.getByText('Product Alpha')).toBeDefined();
      expect(screen.getAllByText('$220.00 USD').length).toBeGreaterThan(0);

      // Trigger Close Order confirmation
      const closeBtn = screen.getByRole('button', { name: /Close sales order/i });
      fireEvent.click(closeBtn);

      expect(screen.getByText('Close Sales Order?')).toBeDefined();
      const confirmCloseBtn = screen.getByRole('button', { name: 'Yes, Close Order' });
      fireEvent.click(confirmCloseBtn);

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith('so-101', { status: 'closed' });
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
          orderId="so-101"
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
        status: 'overdue',
        dueDate: '2026-10-01',
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

      render(<InvoiceDetailPage invoiceId="inv-201" onBack={onBack} />);

      expect(await screen.findByText('Invoice INV-2026-201')).toBeDefined();
      expect(screen.getByText(/⚠️ Overdue/i)).toBeDefined();
      expect(screen.getByText('WIRE-998877')).toBeDefined();

      // Open payment modal
      const recordBtn = screen.getByRole('button', { name: /Record payment for invoice/i });
      fireEvent.click(recordBtn);

      expect(screen.getByText(/Record Payment for INV-2026-201/i)).toBeDefined();
      const submitPaymentBtn = screen.getByRole('button', { name: /Confirm payment submission/i });
      fireEvent.click(submitPaymentBtn);

      await waitFor(() => {
        expect(paymentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            invoiceId: 'inv-201',
            amount: '220.00',
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
      vi.spyOn(api, 'fetchPayments').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 });

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
