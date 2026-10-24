// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { OrderDetailPage } from '../src/pages/OrderDetailPage.js';
import * as api from '../src/api/erp-3.js';
import type { SalesOrder } from '@clearshift/contracts';

const ORDER_ID = 'aaaaaaaa-0003-4000-8000-000000000101';
const LINE_ID = 'bbbbbbbb-0003-4000-8000-000000000101';
const CUSTOMER_GOLDEN_ID = '55555555-0003-4000-8000-000000000001';
const PRODUCT_ID = '11111111-0001-4000-8000-000000000001';

const mockOrder: SalesOrder = {
  id: ORDER_ID,
  order_number: 'SO-2026-101',
  customer_golden_id: CUSTOMER_GOLDEN_ID,
  order_date: '2026-10-24',
  status: 'Open',
  currency: 'USD',
  total: '250.0000',
  lines: [
    {
      id: LINE_ID,
      order_id: ORDER_ID,
      product_id: PRODUCT_ID,
      quantity: '2.0000',
      price: '110.0000',
      tax_rate: '13.6364',
      tax_amount: '30.0000',
      line_total: '250.0000',
      created_at: '2026-10-24T08:00:00.000Z',
    },
  ],
  source_system: 'ERP-LEGACY-MIG',
  source_id: 'LEGACY-ORD-999',
  created_at: '2026-10-24T08:00:00.000Z',
  updated_at: '2026-10-24T09:30:00.000Z',
};

const mockLinkedRecords: api.SalesOrderLinkedRecords = {
  orderId: ORDER_ID,
  customer: {
    goldenId: CUSTOMER_GOLDEN_ID,
    name: 'Acme Global Corp',
    email: 'finance@acme.internal',
    tier: 'Enterprise Tier-1',
  },
  products: [
    {
      productId: PRODUCT_ID,
      sku: 'SKU-WIDGET-01',
      name: 'Industrial Widget Alpha',
      quantity: '2.0000',
      unitPrice: '110.0000',
      currency: 'USD',
    },
  ],
  invoices: [
    {
      id: 'inv-301',
      invoiceNumber: 'INV-2026-301',
      status: 'Open',
      total: '250.0000',
      currency: 'USD',
      dueDate: '2026-11-24',
      issuedDate: '2026-10-24',
    },
  ],
  payments: [
    {
      id: 'pay-401',
      paymentNumber: 'PAY-2026-401',
      amount: '250.0000',
      currency: 'USD',
      method: 'Bank Transfer',
      paidAt: '2026-10-24T10:00:00.000Z',
    },
  ],
};

describe('OrderDetailPage — Issue #157 (ERP3-21) Detail/Edit Workflow & Linked Records', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'fetchSalesOrderById').mockResolvedValue({ ...mockOrder });
    vi.spyOn(api, 'fetchSalesOrderLinkedRecords').mockResolvedValue({ ...mockLinkedRecords });
  });

  afterEach(() => {
    cleanup();
  });

  describe('AC1: Primary Attributes, Timestamps & Golden ID Audit Panel', () => {
    it('renders all primary attributes in the detail view', async () => {
      render(<OrderDetailPage orderId={ORDER_ID} initialOrder={mockOrder} onBack={vi.fn()} />);

      expect(screen.getByTestId('attr-order-number').textContent).toContain('SO-2026-101');
      expect(screen.getByTestId('attr-customer-gid').textContent).toContain(CUSTOMER_GOLDEN_ID);
      expect(screen.getByTestId('attr-order-date').textContent).toContain('2026-10-24');
      expect(screen.getByTestId('attr-currency').textContent).toContain('USD');
      expect(screen.getByTestId('attr-total').textContent).toContain('$250.00 USD');
      expect(screen.getByTestId('attr-status').textContent).toContain('Open');
    });

    it('displays created_at and updated_at ISO timestamps in attributes grid', async () => {
      render(<OrderDetailPage orderId={ORDER_ID} initialOrder={mockOrder} onBack={vi.fn()} />);

      expect(screen.getByTestId('attr-created-at').textContent).toContain(
        '2026-10-24T08:00:00.000Z'
      );
      expect(screen.getByTestId('attr-updated-at').textContent).toContain(
        '2026-10-24T09:30:00.000Z'
      );
    });

    it('renders OrderAuditPanel with Golden ID resolution badge and source traceability', async () => {
      render(<OrderDetailPage orderId={ORDER_ID} initialOrder={mockOrder} onBack={vi.fn()} />);

      const auditPanel = screen.getByTestId('order-audit-panel');
      expect(auditPanel).toBeDefined();

      // Audit panel displays customer golden ID with resolution indicator
      const gidBadge = screen.getByTestId('audit-golden-id');
      expect(gidBadge).toBeDefined();
      expect(gidBadge.textContent).toContain(CUSTOMER_GOLDEN_ID);

      // Audit panel displays internal UUID
      expect(screen.getByTestId('audit-order-id').textContent).toContain(ORDER_ID);

      // Audit panel displays source system traceability
      expect(screen.getByTestId('audit-source-link').textContent).toContain(
        'ERP-LEGACY-MIG #LEGACY-ORD-999'
      );
    });
  });

  describe('AC2: Inline Edit & Drawer Form with Permission Checking', () => {
    it('disables edit actions when user lacks orders:write permission', async () => {
      render(
        <OrderDetailPage
          orderId={ORDER_ID}
          initialOrder={mockOrder}
          userPermissions={['orders:read']}
          onBack={vi.fn()}
        />
      );

      const inlineBtn = screen.getByTestId('enable-inline-edit-btn') as HTMLButtonElement;
      const drawerBtn = screen.getByTestId('open-edit-drawer-btn') as HTMLButtonElement;

      expect(inlineBtn.disabled).toBe(true);
      expect(drawerBtn.disabled).toBe(true);
      expect(inlineBtn.getAttribute('title')).toBe(
        'Insufficient permissions (orders:write required)'
      );
    });

    it('disables edit actions when order status is Closed or Invoiced', async () => {
      const closedOrder: SalesOrder = { ...mockOrder, status: 'Closed' };
      render(
        <OrderDetailPage
          orderId={ORDER_ID}
          initialOrder={closedOrder}
          userPermissions={['orders:write']}
          onBack={vi.fn()}
        />
      );

      const inlineBtn = screen.getByTestId('enable-inline-edit-btn') as HTMLButtonElement;
      const drawerBtn = screen.getByTestId('open-edit-drawer-btn') as HTMLButtonElement;

      expect(inlineBtn.disabled).toBe(true);
      expect(drawerBtn.disabled).toBe(true);
      expect(inlineBtn.getAttribute('title')).toBe('Only Open orders can be modified');
    });

    it('allows opening inline edit form, modifying allowlisted fields, and cancelling', async () => {
      render(
        <OrderDetailPage
          orderId={ORDER_ID}
          initialOrder={mockOrder}
          userPermissions={['orders:write']}
          onBack={vi.fn()}
        />
      );

      const inlineBtn = screen.getByTestId('enable-inline-edit-btn') as HTMLButtonElement;
      expect(inlineBtn.disabled).toBe(false);
      fireEvent.click(inlineBtn);

      // Inline edit form is rendered
      const form = screen.getByTestId('inline-edit-form');
      expect(form).toBeDefined();

      // Order number is immutable and disabled
      const orderNumberInput = screen.getByLabelText(/Order Number \(Immutable\)/i) as HTMLInputElement;
      expect(orderNumberInput.disabled).toBe(true);
      expect(orderNumberInput.value).toBe('SO-2026-101');

      // Allowlisted fields can be updated
      const dateInput = screen.getByTestId('inline-order-date-input') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2026-11-01' } });
      expect(dateInput.value).toBe('2026-11-01');

      // Cancel inline edit
      const cancelBtn = screen.getByTestId('inline-cancel-btn');
      fireEvent.click(cancelBtn);

      expect(screen.queryByTestId('inline-edit-form')).toBeNull();
    });

    it('submits inline edits with If-Match header and updates view', async () => {
      const updateSpy = vi.spyOn(api, 'updateSalesOrder').mockResolvedValue({
        ...mockOrder,
        order_date: '2026-11-05',
        currency: 'EUR',
      });
      const onUpdated = vi.fn();

      render(
        <OrderDetailPage
          orderId={ORDER_ID}
          initialOrder={mockOrder}
          userPermissions={['orders:write']}
          onBack={vi.fn()}
          onOrderUpdated={onUpdated}
        />
      );

      fireEvent.click(screen.getByTestId('enable-inline-edit-btn'));

      const dateInput = screen.getByTestId('inline-order-date-input');
      const currencySelect = screen.getByTestId('inline-currency-input');
      const saveBtn = screen.getByTestId('inline-save-btn');

      fireEvent.change(dateInput, { target: { value: '2026-11-05' } });
      fireEvent.change(currencySelect, { target: { value: 'EUR' } });

      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          ORDER_ID,
          expect.objectContaining({
            order_date: '2026-11-05',
            currency: 'EUR',
          }),
          { ifMatch: '2026-10-24T09:30:00.000Z' }
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId('detail-toast-alert').textContent).toContain(
          'Sales order updated successfully.'
        );
      });
      expect(onUpdated).toHaveBeenCalled();
    });

    it('opens edit drawer dialog and enforces validation', async () => {
      render(
        <OrderDetailPage
          orderId={ORDER_ID}
          initialOrder={mockOrder}
          userPermissions={['orders:write']}
          onBack={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('open-edit-drawer-btn'));

      // Drawer dialog is open
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeDefined();
      expect(within(dialog).getByText(/Edit Sales Order: SO-2026-101/i)).toBeDefined();

      // Clear required date to trigger validation error
      const dateInput = within(dialog).getByLabelText(/Order Date/i);
      fireEvent.change(dateInput, { target: { value: '' } });

      const saveBtn = within(dialog).getByRole('button', { name: /Save Changes/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(
          within(dialog).getByText(/Order date is required and must be in YYYY-MM-DD format/i)
        ).toBeDefined();
      });
    });
  });

  describe('AC3: Linked Entity Sub-tables & Cross-module Navigation Links', () => {
    it('renders linked records table with CRM, ERP-1, ERP-3, ERP-4 sub-tables', async () => {
      render(<OrderDetailPage orderId={ORDER_ID} initialOrder={mockOrder} onBack={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByTestId('order-linked-records-section')).toBeDefined();
      });

      // Default tab: All Linked Records includes CRM Customer
      expect(screen.getByText('Acme Global Corp')).toBeDefined();
      expect(screen.getByText(/finance@acme.internal/)).toBeDefined();
      expect(screen.getByText(/Enterprise Tier-1/)).toBeDefined();

      // Switch to ERP-1 Products tab
      const productsTab = screen.getByRole('tab', { name: /ERP-1 Products/i });
      fireEvent.click(productsTab);
      expect(screen.getByText('Industrial Widget Alpha')).toBeDefined();
      expect(screen.getByText(/SKU-WIDGET-01/)).toBeDefined();

      // Switch to Invoices tab
      const invoicesTab = screen.getByRole('tab', { name: /Billing Invoices/i });
      fireEvent.click(invoicesTab);
      expect(screen.getByText('INV-2026-301')).toBeDefined();

      // Switch to Payments tab
      const paymentsTab = screen.getByRole('tab', { name: /ERP-4 Payments/i });
      fireEvent.click(paymentsTab);
      expect(screen.getByText('PAY-2026-401')).toBeDefined();
    });

    it('triggers onNavigateModule when navigation links are clicked', async () => {
      const onNavigate = vi.fn();
      render(
        <OrderDetailPage
          orderId={ORDER_ID}
          initialOrder={mockOrder}
          onBack={vi.fn()}
          onNavigateModule={onNavigate}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('order-linked-records-section')).toBeDefined();
      });

      // Click customer navigation link
      const navCustomerLink = screen.getByRole('link', { name: /View CRM-1 Customer/i });
      fireEvent.click(navCustomerLink);
      expect(onNavigate).toHaveBeenCalledWith('crm-1', CUSTOMER_GOLDEN_ID);

      // Switch to Products and click product navigation link
      fireEvent.click(screen.getByRole('tab', { name: /ERP-1 Products/i }));
      const navProductLink = screen.getByRole('link', { name: /View Product/i });
      fireEvent.click(navProductLink);
      expect(onNavigate).toHaveBeenCalledWith('erp-1', PRODUCT_ID);

      // Switch to Invoices and click invoice link
      fireEvent.click(screen.getByRole('tab', { name: /Billing Invoices/i }));
      const navInvoiceLink = screen.getByRole('link', { name: /View Invoice/i });
      fireEvent.click(navInvoiceLink);
      expect(onNavigate).toHaveBeenCalledWith('erp-3', 'inv-301');

      // Switch to Payments and click payment link
      fireEvent.click(screen.getByRole('tab', { name: /ERP-4 Payments/i }));
      const navPaymentLink = screen.getByRole('link', { name: /View Payment/i });
      fireEvent.click(navPaymentLink);
      expect(onNavigate).toHaveBeenCalledWith('erp-4', 'pay-401');
    });
  });

  describe('AC4: Concurrent Modification Conflicts (409) & Refresh Recovery', () => {
    it('displays 409 conflict banner and recovers via conflict-refresh-btn', async () => {
      const conflictError: any = new Error(
        'Concurrent modification conflict: this order was modified by another user or session. Please refresh and re-apply changes.'
      );
      conflictError.status = 409;

      vi.spyOn(api, 'updateSalesOrder').mockRejectedValue(conflictError);
      const fetchSpy = vi.spyOn(api, 'fetchSalesOrderById').mockResolvedValue({
        ...mockOrder,
        order_date: '2026-10-25',
        updated_at: '2026-10-24T11:00:00.000Z',
      });

      render(
        <OrderDetailPage
          orderId={ORDER_ID}
          initialOrder={mockOrder}
          userPermissions={['orders:write']}
          onBack={vi.fn()}
        />
      );

      // Start inline edit and submit
      fireEvent.click(screen.getByTestId('enable-inline-edit-btn'));
      fireEvent.click(screen.getByTestId('inline-save-btn'));

      // Conflict banner appears
      await waitFor(() => {
        expect(screen.getByTestId('concurrent-conflict-banner')).toBeDefined();
      });
      expect(screen.getByRole('alert').textContent).toContain(
        'Concurrent Modification Conflict (409)'
      );

      // User clicks refresh button in conflict banner
      const refreshBtn = screen.getByTestId('conflict-refresh-btn');
      fireEvent.click(refreshBtn);

      // Latest order data is fetched
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(ORDER_ID);
      });

      // Conflict banner is dismissed and confirmation toast is displayed
      await waitFor(() => {
        expect(screen.queryByTestId('concurrent-conflict-banner')).toBeNull();
        expect(screen.getByTestId('detail-toast-alert').textContent).toContain(
          'Latest order data refreshed successfully.'
        );
      });
    });
  });
});
