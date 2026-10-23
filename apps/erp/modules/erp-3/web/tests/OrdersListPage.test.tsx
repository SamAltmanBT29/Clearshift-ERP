// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OrdersListPage } from '../src/pages/OrdersListPage.js';
import { OrdersTable } from '../src/components/OrdersTable.js';
import { InvoicesTable } from '../src/components/InvoicesTable.js';
import { FilterBar } from '../src/components/FilterBar.js';
import { InvoiceFilterBar } from '../src/components/InvoiceFilterBar.js';
import { SkeletonTable, EmptyState, ErrorState, StatusBadge } from '../src/components/StateViews.js';
import * as api from '../src/api/erp-3.js';

const mockOrder = {
  id: 'so-1',
  orderNumber: 'SO-1001',
  customerGoldenId: 'gid-cust-001',
  orderDate: '2026-10-23',
  status: 'open' as const,
  subtotal: '1000.00',
  taxTotal: '100.00',
  total: '1100.00',
  currencyCode: 'USD',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

const mockInvoice = {
  id: 'inv-1',
  invoiceNumber: 'INV-2026-001',
  orderId: 'so-1',
  customerGoldenId: 'gid-cust-001',
  invoiceDate: '2026-10-23',
  dueDate: '2026-11-23',
  total: '1100.00',
  paidAmount: '0.00',
  currencyCode: 'USD',
  status: 'open' as const,
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

describe('ERP-3 OrdersListPage — React Testing Library Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('Initial Load & Data Rendering', () => {
    it('renders the page header, tabs, and fetches sales orders on mount', async () => {
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

      render(<OrdersListPage />);

      expect(screen.getByText('Sales Orders & Invoices')).toBeDefined();
      expect(screen.getByRole('tab', { name: /Sales Orders/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /Invoices/i })).toBeDefined();

      const orderRow = await screen.findByText('SO-1001');
      expect(orderRow).toBeDefined();
      expect(screen.getByText('gid-cust-001')).toBeDefined();
      expect(screen.getByText(/1,100\.00/)).toBeDefined();
    });
  });

  describe('Search & Filter Interactions on Sales Orders', () => {
    it('typing into search triggers query and resets page to 1', async () => {
      const fetchSpy = vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<OrdersListPage />);
      await screen.findByText('SO-1001');

      const searchInput = screen.getByLabelText(/Search orders by order number or customer Golden ID/i);
      fireEvent.change(searchInput, { target: { value: 'SO-1002' } });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            search: 'SO-1002',
            page: 1,
          })
        );
      });
    });

    it('selecting status triggers query and resets page to 1', async () => {
      const fetchSpy = vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<OrdersListPage />);
      await screen.findByText('SO-1001');

      const statusSelect = screen.getByLabelText(/Filter by order status/i);
      fireEvent.change(statusSelect, { target: { value: 'invoiced' } });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'invoiced',
            page: 1,
          })
        );
      });
    });

    it('clicking Reset Filters resets search and status to initial state', async () => {
      const fetchSpy = vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<OrdersListPage />);
      await screen.findByText('SO-1001');

      const searchInput = screen.getByLabelText(/Search orders by order number or customer Golden ID/i);
      fireEvent.change(searchInput, { target: { value: 'SO-999' } });

      const resetBtn = screen.getByRole('button', { name: /Reset filters/i });
      fireEvent.click(resetBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            search: '',
            status: undefined,
            page: 1,
          })
        );
      });
    });
  });

  describe('Empty Results & Error Recovery on Sales Orders', () => {
    it('shows empty state view when API returns 0 sales orders', async () => {
      vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      render(<OrdersListPage />);

      const emptyTitle = await screen.findByText('No sales orders found');
      expect(emptyTitle).toBeDefined();
      expect(screen.getByText(/No orders match your current filter selection or search query/i)).toBeDefined();
    });

    it('shows error state on API failure and re-triggers fetch on Try Again click', async () => {
      const fetchSpy = vi
        .spyOn(api, 'fetchSalesOrders')
        .mockRejectedValueOnce(new Error('Gateway timeout loading sales orders'))
        .mockResolvedValueOnce({
          items: [mockOrder],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });

      render(<OrdersListPage />);

      const errorTitle = await screen.findByText('Failed to Load Sales Orders');
      expect(errorTitle).toBeDefined();
      expect(screen.getByText('Gateway timeout loading sales orders')).toBeDefined();

      const retryBtn = screen.getByRole('button', { name: /Try Again/i });
      fireEvent.click(retryBtn);

      const orderRow = await screen.findByText('SO-1001');
      expect(orderRow).toBeDefined();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Tab Switching & Invoices Search / Filter / Recovery', () => {
    it('switches between Sales Orders and Invoices tabs and fetches invoices', async () => {
      vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      const invoicesSpy = vi.spyOn(api, 'fetchInvoices').mockResolvedValue({
        items: [mockInvoice],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<OrdersListPage />);
      await screen.findByText('SO-1001');

      const invoicesTab = screen.getByRole('tab', { name: /Invoices/i });
      fireEvent.click(invoicesTab);

      const invoiceRow = await screen.findByText('INV-2026-001');
      expect(invoiceRow).toBeDefined();
      expect(invoicesSpy).toHaveBeenCalled();
    });

    it('invoices tab provides accessible search, status filter, and reset', async () => {
      vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });
      const invoicesSpy = vi.spyOn(api, 'fetchInvoices').mockResolvedValue({
        items: [mockInvoice],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<OrdersListPage />);
      const invoicesTab = screen.getByRole('tab', { name: /Invoices/i });
      fireEvent.click(invoicesTab);
      await screen.findByText('INV-2026-001');

      // Search invoices
      const invoiceSearch = screen.getByLabelText(
        /Search invoices by invoice number, order ID, or customer Golden ID/i
      );
      fireEvent.change(invoiceSearch, { target: { value: 'INV-999' } });

      await waitFor(() => {
        expect(invoicesSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            search: 'INV-999',
            page: 1,
          })
        );
      });

      // Filter by status
      const invoiceStatus = screen.getByLabelText(/Filter by invoice status/i);
      fireEvent.change(invoiceStatus, { target: { value: 'paid' } });

      await waitFor(() => {
        expect(invoicesSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'paid',
            page: 1,
          })
        );
      });

      // Reset invoice filters
      const resetBtn = screen.getByRole('button', { name: /Reset invoice filters/i });
      fireEvent.click(resetBtn);

      await waitFor(() => {
        expect(invoicesSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            search: '',
            status: undefined,
            page: 1,
          })
        );
      });
    });

    it('handles invoices error state and allows recovery on Try Again', async () => {
      vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });
      const invoicesSpy = vi
        .spyOn(api, 'fetchInvoices')
        .mockRejectedValueOnce(new Error('Invoices service unavailable'))
        .mockResolvedValueOnce({
          items: [mockInvoice],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });

      render(<OrdersListPage />);
      const invoicesTab = screen.getByRole('tab', { name: /Invoices/i });
      fireEvent.click(invoicesTab);

      const errorTitle = await screen.findByText('Failed to Load Invoices');
      expect(errorTitle).toBeDefined();
      expect(screen.getByText('Invoices service unavailable')).toBeDefined();

      const retryBtn = screen.getByRole('button', { name: /Try Again/i });
      fireEvent.click(retryBtn);

      const invoiceRow = await screen.findByText('INV-2026-001');
      expect(invoiceRow).toBeDefined();
      expect(invoicesSpy).toHaveBeenCalledTimes(2);
    });
  });
});

describe('ERP-3 Subcomponent DOM Tests', () => {
  afterEach(() => {
    cleanup();
  });

  describe('StatusBadge', () => {
    it('renders with appropriate styling classes for order and invoice statuses', () => {
      const { rerender } = render(<StatusBadge status="open" />);
      expect(screen.getByText('open')).toBeDefined();

      rerender(<StatusBadge status="invoiced" />);
      expect(screen.getByText('invoiced')).toBeDefined();

      rerender(<StatusBadge status="closed" />);
      expect(screen.getByText('closed')).toBeDefined();

      rerender(<StatusBadge status="paid" />);
      expect(screen.getByText('paid')).toBeDefined();

      rerender(<StatusBadge status="overdue" />);
      expect(screen.getByText('overdue')).toBeDefined();
    });
  });

  describe('SkeletonTable & EmptyState & ErrorState', () => {
    it('renders SkeletonTable with aria-busy and status role', () => {
      render(<SkeletonTable columns={4} rows={3} />);
      const skeleton = screen.getByRole('status', { name: /Loading sales orders data/i });
      expect(skeleton.getAttribute('aria-busy')).toBe('true');
    });

    it('renders EmptyState and fires callback on button click', () => {
      const onAction = vi.fn();
      render(
        <EmptyState
          title="No results found"
          message="Try adjusting filters"
          actionLabel="Clear"
          onAction={onAction}
        />
      );

      expect(screen.getByText('No results found')).toBeDefined();
      const actionBtn = screen.getByRole('button', { name: /Clear/i });
      fireEvent.click(actionBtn);
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('renders ErrorState and fires onRetry on button click', () => {
      const onRetry = vi.fn();
      render(
        <ErrorState
          title="Error loading"
          message="Server 500 error"
          onRetry={onRetry}
        />
      );

      expect(screen.getByText('Error loading')).toBeDefined();
      const retryBtn = screen.getByRole('button', { name: /Try Again/i });
      fireEvent.click(retryBtn);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('OrdersTable & InvoicesTable Pagination Navigation', () => {
    it('triggers onPageChange when clicking pagination buttons in OrdersTable', () => {
      const onPageChange = vi.fn();
      render(
        <OrdersTable
          orders={[mockOrder]}
          isLoading={false}
          total={50}
          page={2}
          pageSize={20}
          totalPages={3}
          onPageChange={onPageChange}
        />
      );

      const prevBtn = screen.getByRole('button', { name: /Previous page/i });
      fireEvent.click(prevBtn);
      expect(onPageChange).toHaveBeenCalledWith(1);

      const nextBtn = screen.getByRole('button', { name: /Next page/i });
      fireEvent.click(nextBtn);
      expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it('triggers onPageChange when clicking pagination buttons in InvoicesTable', () => {
      const onPageChange = vi.fn();
      render(
        <InvoicesTable
          invoices={[mockInvoice]}
          isLoading={false}
          total={50}
          page={1}
          pageSize={20}
          totalPages={3}
          onPageChange={onPageChange}
        />
      );

      const nextBtn = screen.getByRole('button', { name: /Next page/i });
      fireEvent.click(nextBtn);
      expect(onPageChange).toHaveBeenCalledWith(2);
    });
  });
});
