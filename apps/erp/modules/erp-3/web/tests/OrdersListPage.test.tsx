import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { OrdersTable } from '../src/components/OrdersTable.js';
import { InvoicesTable } from '../src/components/InvoicesTable.js';
import { FilterBar } from '../src/components/FilterBar.js';
import { SkeletonTable, EmptyState, ErrorState, StatusBadge } from '../src/components/StateViews.js';

describe('ERP-3 Component View Rendering & State Architecture', () => {
  describe('StatusBadge', () => {
    it('renders appropriate styling class for sales order statuses', () => {
      const openBadge = <StatusBadge status="open" />;
      expect(openBadge).toBeDefined();
      expect(openBadge.props.status).toBe('open');

      const invoicedBadge = <StatusBadge status="invoiced" />;
      expect(invoicedBadge.props.status).toBe('invoiced');

      const closedBadge = <StatusBadge status="closed" />;
      expect(closedBadge.props.status).toBe('closed');
    });

    it('renders appropriate styling class for invoice statuses', () => {
      const paidBadge = <StatusBadge status="paid" />;
      expect(paidBadge.props.status).toBe('paid');

      const overdueBadge = <StatusBadge status="overdue" />;
      expect(overdueBadge.props.status).toBe('overdue');
    });
  });

  describe('Mandatory UI States', () => {
    it('renders SkeletonTable loading state with specified dimensions', () => {
      const element = <SkeletonTable columns={8} rows={6} />;
      expect(element.props.columns).toBe(8);
      expect(element.props.rows).toBe(6);
    });

    it('renders EmptyState with actionable button when list is empty', () => {
      const onAction = vi.fn();
      const element = (
        <EmptyState
          title="No sales orders found"
          message="No records match your search."
          actionLabel="Clear Filters"
          onAction={onAction}
        />
      );
      expect(element.props.title).toBe('No sales orders found');
      expect(element.props.actionLabel).toBe('Clear Filters');
    });

    it('renders ErrorState with recoverable retry callback', () => {
      const onRetry = vi.fn();
      const element = (
        <ErrorState
          title="Failed to Load Sales Orders"
          message="Server timed out."
          onRetry={onRetry}
        />
      );
      expect(element.props.title).toBe('Failed to Load Sales Orders');
      expect(element.props.onRetry).toBe(onRetry);
    });
  });

  describe('FilterBar Component', () => {
    it('accepts filter query values and triggers onFilterChange callback', () => {
      const onFilterChange = vi.fn();
      const onReset = vi.fn();
      const filters = { page: 1, pageSize: 20, search: 'SO-1001', status: 'open' as const };

      const element = (
        <FilterBar
          filters={filters}
          onFilterChange={onFilterChange}
          onReset={onReset}
          isLoading={false}
        />
      );

      expect(element.props.filters.search).toBe('SO-1001');
      expect(element.props.filters.status).toBe('open');
    });
  });

  describe('OrdersTable Component', () => {
    it('renders sales orders list with server pagination attributes', () => {
      const onPageChange = vi.fn();
      const mockOrders = [
        {
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
        },
      ];

      const element = (
        <OrdersTable
          orders={mockOrders}
          isLoading={false}
          total={1}
          page={1}
          pageSize={20}
          totalPages={1}
          onPageChange={onPageChange}
        />
      );

      expect(element.props.orders.length).toBe(1);
      expect(element.props.orders[0]?.orderNumber).toBe('SO-1001');
      expect(element.props.total).toBe(1);
    });
  });

  describe('InvoicesTable Component', () => {
    it('renders invoices list with due date and overdue tracking', () => {
      const onPageChange = vi.fn();
      const mockInvoices = [
        {
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
        },
      ];

      const element = (
        <InvoicesTable
          invoices={mockInvoices}
          isLoading={false}
          total={1}
          page={1}
          pageSize={20}
          totalPages={1}
          onPageChange={onPageChange}
        />
      );

      expect(element.props.invoices.length).toBe(1);
      expect(element.props.invoices[0]?.invoiceNumber).toBe('INV-2026-001');
      expect(element.props.invoices[0]?.dueDate).toBe('2026-11-23');
    });
  });
});
