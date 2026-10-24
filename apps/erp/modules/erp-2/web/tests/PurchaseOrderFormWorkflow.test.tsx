// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PurchaseOrderForm } from '../src/components/forms/PurchaseOrderForm.js';
import { ConfirmActionDialog } from '../src/components/forms/ConfirmActionDialog.js';
import { PurchaseOrderCreatePage } from '../src/pages/PurchaseOrderCreatePage.js';
import { PurchaseOrderDetailPage } from '../src/pages/PurchaseOrderDetailPage.js';
import * as api from '../src/api/erp-2.js';
import type { PurchaseOrder } from '@clearshift/contracts';

const mockOrder: PurchaseOrder = {
  id: '11111111-1111-1111-1111-111111111111',
  po_number: 'PO-2026-0001',
  vendor_id: '00000000-0000-0000-0000-000000000001',
  order_date: '2026-10-23',
  status: 'Draft',
  currency: 'USD',
  total: '1250.00',
  lines: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      po_id: '11111111-1111-1111-1111-111111111111',
      product_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      quantity: '10.00',
      price: '125.00',
      line_total: '1250.00',
    },
  ],
  created_at: '2026-10-23T00:00:00Z',
  updated_at: '2026-10-23T00:00:00Z',
};

describe('ERP-2 Purchase Order Form & Workflow — RTL Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('1. ConfirmActionDialog Component', () => {
    it('does not render when isOpen is false', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmActionDialog
          isOpen={false}
          title="Confirm"
          message="Are you sure?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renders title, message, and triggers onConfirm / onCancel', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmActionDialog
          isOpen={true}
          title="Send to Vendor"
          message="Are you sure you want to send this order?"
          confirmLabel="Send Order"
          cancelLabel="Dismiss"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByText('Send to Vendor')).toBeDefined();
      expect(screen.getByText('Are you sure you want to send this order?')).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(onCancel).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'Send Order' }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. PurchaseOrderForm Line Items & Live Total Calculation', () => {
    it('computes line total and read-only order total dynamically', async () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(<PurchaseOrderForm onSubmit={onSubmit} onCancel={onCancel} />);

      const qtyInput = screen.getByLabelText(/Quantity for line 1/i);
      const priceInput = screen.getByLabelText(/Unit price for line 1/i);

      fireEvent.change(qtyInput, { target: { value: '5.00' } });
      fireEvent.change(priceInput, { target: { value: '200.00' } });

      await waitFor(() => {
        // Line total 5 * 200 = 1,000.00
        expect(screen.getAllByText('1,000.00').length).toBeGreaterThan(0);
        // Order total summary
        expect(screen.getByText(/USD 1,000.00/)).toBeDefined();
      });
    });

    it('adds and removes lines updating overall total', async () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(<PurchaseOrderForm onSubmit={onSubmit} onCancel={onCancel} />);

      // Line 1: 5 * 100 = 500
      fireEvent.change(screen.getByLabelText(/Quantity for line 1/i), {
        target: { value: '5.00' },
      });
      fireEvent.change(screen.getByLabelText(/Unit price for line 1/i), {
        target: { value: '100.00' },
      });

      // Add Line 2
      fireEvent.click(screen.getByRole('button', { name: 'Add item line' }));

      const qtyInput2 = screen.getByLabelText(/Quantity for line 2/i);
      const priceInput2 = screen.getByLabelText(/Unit price for line 2/i);

      fireEvent.change(qtyInput2, { target: { value: '2.00' } });
      fireEvent.change(priceInput2, { target: { value: '250.00' } });

      await waitFor(() => {
        // Line 1 = 500.00, Line 2 = 500.00 -> Total = 1,000.00
        expect(screen.getByText(/USD 1,000.00/)).toBeDefined();
      });

      // Remove Line 2
      fireEvent.click(screen.getByRole('button', { name: 'Remove line 2' }));

      await waitFor(() => {
        // Only Line 1 remains = 500.00
        expect(screen.getByText(/USD 500.00/)).toBeDefined();
        expect(screen.queryByLabelText(/Quantity for line 2/i)).toBeNull();
      });
    });

    it('validates vendor UUID and product UUID format', async () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(<PurchaseOrderForm onSubmit={onSubmit} onCancel={onCancel} />);

      fireEvent.click(screen.getByRole('button', { name: 'Create Purchase Order' }));

      await waitFor(() => {
        expect(screen.getByText('Valid Vendor UUID is required')).toBeDefined();
        expect(screen.getByText('Product UUID is required (ERP-1)')).toBeDefined();
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('validates quantity > 0 and unit price >= 0', async () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(<PurchaseOrderForm onSubmit={onSubmit} onCancel={onCancel} />);

      fireEvent.change(screen.getByLabelText(/Vendor UUID/i), {
        target: { value: '00000000-0000-0000-0000-000000000001' },
      });
      fireEvent.change(screen.getByLabelText(/Product UUID for line 1/i), {
        target: { value: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      });
      fireEvent.change(screen.getByLabelText(/Quantity for line 1/i), {
        target: { value: '0' },
      });
      fireEvent.change(screen.getByLabelText(/Unit price for line 1/i), {
        target: { value: '-10' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Purchase Order' }));

      await waitFor(() => {
        expect(screen.getByText('Quantity must be > 0')).toBeDefined();
        expect(screen.getByText('Price must be >= 0')).toBeDefined();
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('submits valid purchase order data with read-only calculated total excluded from payload', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const onCancel = vi.fn();

      render(<PurchaseOrderForm onSubmit={onSubmit} onCancel={onCancel} />);

      fireEvent.change(screen.getByLabelText(/Vendor UUID/i), {
        target: { value: '00000000-0000-0000-0000-000000000001' },
      });
      fireEvent.change(screen.getByLabelText(/PO Number/i), {
        target: { value: 'PO-2026-9999' },
      });
      fireEvent.change(screen.getByLabelText(/Product UUID for line 1/i), {
        target: { value: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      });
      fireEvent.change(screen.getByLabelText(/Quantity for line 1/i), {
        target: { value: '10.00' },
      });
      fireEvent.change(screen.getByLabelText(/Unit price for line 1/i), {
        target: { value: '125.00' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Purchase Order' }));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith({
          vendor_id: '00000000-0000-0000-0000-000000000001',
          po_number: 'PO-2026-9999',
          order_date: expect.any(String),
          currency: 'USD',
          lines: [
            {
              product_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              quantity: '10.00',
              price: '125.00',
            },
          ],
        });
      });
    });
  });

  describe('3. PurchaseOrderCreatePage Integration', () => {
    it('prefills vendor ID from query params and navigates on creation', async () => {
      const createSpy = vi.spyOn(api, 'createPurchaseOrder').mockResolvedValue(mockOrder);

      render(
        <MemoryRouter initialEntries={['/erp2/purchase-orders/new?vendor_id=00000000-0000-0000-0000-000000000001']}>
          <Routes>
            <Route path="/erp2/purchase-orders/new" element={<PurchaseOrderCreatePage />} />
            <Route path="/erp2/purchase-orders/:purchaseOrderId" element={<div>PO Detail Screen</div>} />
          </Routes>
        </MemoryRouter>
      );

      const vendorInput = screen.getByLabelText(/Vendor UUID/i) as HTMLInputElement;
      expect(vendorInput.value).toBe('00000000-0000-0000-0000-000000000001');

      fireEvent.change(screen.getByLabelText(/Product UUID for line 1/i), {
        target: { value: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      });
      fireEvent.change(screen.getByLabelText(/Quantity for line 1/i), {
        target: { value: '10.00' },
      });
      fireEvent.change(screen.getByLabelText(/Unit price for line 1/i), {
        target: { value: '125.00' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Purchase Order' }));

      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByText('PO Detail Screen')).toBeDefined();
      });
    });
  });

  describe('4. PurchaseOrderDetailPage & Irreversible Status Transitions', () => {
    it('renders PO details and allows transitioning from Draft -> Sent via Confirmation Dialog', async () => {
      vi.spyOn(api, 'fetchPurchaseOrderById').mockResolvedValue(mockOrder);
      const updateStatusSpy = vi.spyOn(api, 'updatePurchaseOrderStatus').mockResolvedValue({
        ...mockOrder,
        status: 'Sent',
      });

      render(
        <MemoryRouter initialEntries={[`/erp2/purchase-orders/${mockOrder.id}`]}>
          <Routes>
            <Route path="/erp2/purchase-orders/:purchaseOrderId" element={<PurchaseOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await screen.findByText('Purchase Order PO-2026-0001');
      expect(screen.getByText('USD 1,250.00')).toBeDefined();

      const sendButton = screen.getByRole('button', { name: 'Send order to vendor' });
      expect(sendButton).toBeDefined();

      // Open confirmation dialog
      fireEvent.click(sendButton);

      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByText('Send Purchase Order to Vendor?')).toBeDefined();

      // Confirm transition
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Transition' }));

      await waitFor(() => {
        expect(updateStatusSpy).toHaveBeenCalledWith(mockOrder.id, { status: 'Sent' });
      });
    });

    it('renders transition to Received when status is Sent', async () => {
      const sentOrder: PurchaseOrder = { ...mockOrder, status: 'Sent' };
      vi.spyOn(api, 'fetchPurchaseOrderById').mockResolvedValue(sentOrder);
      const updateStatusSpy = vi.spyOn(api, 'updatePurchaseOrderStatus').mockResolvedValue({
        ...sentOrder,
        status: 'Received',
      });

      render(
        <MemoryRouter initialEntries={[`/erp2/purchase-orders/${sentOrder.id}`]}>
          <Routes>
            <Route path="/erp2/purchase-orders/:purchaseOrderId" element={<PurchaseOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await screen.findByText('Purchase Order PO-2026-0001');

      const receiveButton = screen.getByRole('button', { name: 'Mark order as received' });
      expect(receiveButton).toBeDefined();

      fireEvent.click(receiveButton);

      expect(screen.getByText('Mark Purchase Order as Received?')).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: 'Confirm Transition' }));

      await waitFor(() => {
        expect(updateStatusSpy).toHaveBeenCalledWith(sentOrder.id, { status: 'Received' });
      });
    });

    it('renders transition to Closed when status is Received', async () => {
      const receivedOrder: PurchaseOrder = { ...mockOrder, status: 'Received' };
      vi.spyOn(api, 'fetchPurchaseOrderById').mockResolvedValue(receivedOrder);
      const updateStatusSpy = vi.spyOn(api, 'updatePurchaseOrderStatus').mockResolvedValue({
        ...receivedOrder,
        status: 'Closed',
      });

      render(
        <MemoryRouter initialEntries={[`/erp2/purchase-orders/${receivedOrder.id}`]}>
          <Routes>
            <Route path="/erp2/purchase-orders/:purchaseOrderId" element={<PurchaseOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await screen.findByText('Purchase Order PO-2026-0001');

      const closeButton = screen.getByRole('button', { name: 'Close purchase order' });
      expect(closeButton).toBeDefined();

      fireEvent.click(closeButton);

      expect(screen.getByText('Close Purchase Order?')).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: 'Confirm Transition' }));

      await waitFor(() => {
        expect(updateStatusSpy).toHaveBeenCalledWith(receivedOrder.id, { status: 'Closed' });
      });
    });

    it('renders no transition buttons when status is Closed (terminal state)', async () => {
      const closedOrder: PurchaseOrder = { ...mockOrder, status: 'Closed' };
      vi.spyOn(api, 'fetchPurchaseOrderById').mockResolvedValue(closedOrder);

      render(
        <MemoryRouter initialEntries={[`/erp2/purchase-orders/${closedOrder.id}`]}>
          <Routes>
            <Route path="/erp2/purchase-orders/:purchaseOrderId" element={<PurchaseOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await screen.findByText('Purchase Order PO-2026-0001');

      expect(screen.queryByRole('button', { name: 'Send order to vendor' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Mark order as received' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Close purchase order' })).toBeNull();
    });
  });
});
