// @vitest-environment jsdom
/**
 * ERP-3 Sales Orders & Invoices — Main Paginated Data Table Test Suite
 *
 * Verifies Acceptance Criteria for Issue #153 (ERP3-17 / Gate G2):
 *   AC1. Table displays entity rows with stable columns matching the data dictionary.
 *   AC2. Pagination controls bind to API page and pageSize query parameters.
 *   AC3. Sorting by column headers toggles ascending/descending order predictably.
 *   AC4. Virtualization or bounded paging prevents DOM performance degradation.
 *
 * @module erp3/web/tests/paginated-data-table.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { SalesOrder, Invoice } from '@clearshift/contracts';
import { OrdersTable } from '../src/components/OrdersTable.js';
import { InvoicesTable } from '../src/components/InvoicesTable.js';

const mockOrders: SalesOrder[] = [
  {
    id: '00000000-0003-4000-8000-000000000001',
    order_number: 'SO-2026-0001',
    customer_golden_id: '11111111-0003-4000-8000-000000000001',
    order_date: '2026-10-15',
    status: 'Open',
    currency: 'USD',
    total: '500.00',
    lines: [
      {
        id: 'line-1',
        order_id: '00000000-0003-4000-8000-000000000001',
        product_id: 'prod-1',
        quantity: '5.0000',
        price: '100.0000',
        tax_rate: '0.0000',
        tax_amount: '0.0000',
        line_total: '500.0000',
        created_at: '2026-10-15T00:00:00Z',
      },
    ],
    source_system: null,
    source_id: null,
    created_at: '2026-10-15T00:00:00.000Z',
    updated_at: '2026-10-15T00:00:00.000Z',
  },
  {
    id: '00000000-0003-4000-8000-000000000002',
    order_number: 'SO-2026-0002',
    customer_golden_id: '22222222-0003-4000-8000-000000000002',
    order_date: '2026-10-18',
    status: 'Invoiced',
    currency: 'USD',
    total: '2500.50',
    lines: [
      {
        id: 'line-2',
        order_id: '00000000-0003-4000-8000-000000000002',
        product_id: 'prod-2',
        quantity: '10.0000',
        price: '250.0500',
        tax_rate: '0.0000',
        tax_amount: '0.0000',
        line_total: '2500.5000',
        created_at: '2026-10-18T00:00:00Z',
      },
    ],
    source_system: null,
    source_id: null,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  },
  {
    id: '00000000-0003-4000-8000-000000000003',
    order_number: 'SO-2026-0003',
    customer_golden_id: '33333333-0003-4000-8000-000000000003',
    order_date: '2026-10-20',
    status: 'Closed',
    currency: 'USD',
    total: '120.00',
    lines: [],
    source_system: null,
    source_id: null,
    created_at: '2026-10-20T00:00:00.000Z',
    updated_at: '2026-10-20T00:00:00.000Z',
  },
];

const mockInvoices: Invoice[] = [
  {
    id: 'aaaaaaaa-0003-4000-8000-000000000001',
    invoice_number: 'INV-2026-0001',
    order_id: '00000000-0003-4000-8000-000000000001',
    customer_golden_id: '11111111-0003-4000-8000-000000000001',
    invoice_date: '2026-10-16',
    due_date: '2026-11-16',
    status: 'Open',
    currency: 'USD',
    total: '500.00',
    lines: [],
    source_system: null,
    source_id: null,
    created_at: '2026-10-16T00:00:00.000Z',
    updated_at: '2026-10-16T00:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-0003-4000-8000-000000000002',
    invoice_number: 'INV-2026-0002',
    order_id: '00000000-0003-4000-8000-000000000002',
    customer_golden_id: '22222222-0003-4000-8000-000000000002',
    invoice_date: '2026-10-19',
    due_date: '2026-11-19',
    status: 'Paid',
    currency: 'USD',
    total: '2500.50',
    lines: [],
    source_system: null,
    source_id: null,
    created_at: '2026-10-19T00:00:00.000Z',
    updated_at: '2026-10-19T00:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-0003-4000-8000-000000000003',
    invoice_number: 'INV-2026-0003',
    order_id: null,
    customer_golden_id: '33333333-0003-4000-8000-000000000003',
    invoice_date: '2026-10-21',
    due_date: '2026-11-21',
    status: 'Overdue',
    currency: 'USD',
    total: '120.00',
    lines: [],
    source_system: null,
    source_id: null,
    created_at: '2026-10-21T00:00:00.000Z',
    updated_at: '2026-10-21T00:00:00.000Z',
  },
];

describe('ERP-3 Main Paginated Data Table (ERP3-17 / Issue #153)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC1: Stable Columns Matching Data Dictionary
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC1: Table displays entity rows with stable columns matching data dictionary', () => {
    it('OrdersTable renders all required columns matching Data Dictionary §4.6', () => {
      render(
        <OrdersTable
          orders={mockOrders}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          onPageChange={vi.fn()}
        />
      );

      // Verify table header columns
      expect(screen.getByRole('columnheader', { name: /Order #/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Customer Golden ID/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Date/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Status/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Subtotal/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Tax/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /^Total/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Action/i })).toBeDefined();

      // Verify entity data rendering
      expect(screen.getByText('SO-2026-0001')).toBeDefined();
      expect(screen.getByText('11111111-0003-4000-8000-000000000001')).toBeDefined();
      expect(screen.getByText('2026-10-15')).toBeDefined();
      expect(screen.getByText('Open')).toBeDefined();
      expect(screen.getAllByText('500.00 USD').length).toBeGreaterThanOrEqual(1);

      expect(screen.getByText('SO-2026-0002')).toBeDefined();
      expect(screen.getByText('Invoiced')).toBeDefined();
      expect(screen.getAllByText('2,500.50 USD').length).toBeGreaterThanOrEqual(1);

      expect(screen.getByText('SO-2026-0003')).toBeDefined();
      expect(screen.getByText('Closed')).toBeDefined();
      expect(screen.getAllByText('120.00 USD').length).toBeGreaterThanOrEqual(1);
    });

    it('InvoicesTable renders all required columns matching Data Dictionary §4.7', () => {
      render(
        <InvoicesTable
          invoices={mockInvoices}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          onPageChange={vi.fn()}
        />
      );

      // Verify table headers
      expect(screen.getByRole('columnheader', { name: /Invoice #/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Order ID/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Customer Golden ID/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Issue Date/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Due Date/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Status/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Total/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Action/i })).toBeDefined();

      // Verify invoice data
      expect(screen.getByText('INV-2026-0001')).toBeDefined();
      expect(screen.getByText('00000000-0003-4000-8000-000000000001')).toBeDefined();
      expect(screen.getByText('2026-10-16')).toBeDefined();
      expect(screen.getByText('2026-11-16')).toBeDefined();
      expect(screen.getByText('Open')).toBeDefined();

      expect(screen.getByText('INV-2026-0002')).toBeDefined();
      expect(screen.getByText('Paid')).toBeDefined();
      expect(screen.getByText('2,500.50 USD')).toBeDefined();

      expect(screen.getByText('INV-2026-0003')).toBeDefined();
      expect(screen.getByText('Overdue')).toBeDefined();
      expect(screen.getByText('—')).toBeDefined(); // Order ID null fallback
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC2: Pagination Controls Bind to page & pageSize
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC2: Pagination controls bind to API page and pageSize query parameters', () => {
    it('pagination controls navigate first, prev, next, and last correctly on OrdersTable', () => {
      const onPageChange = vi.fn();

      render(
        <OrdersTable
          orders={mockOrders}
          isLoading={false}
          total={55}
          page={2}
          pageSize={20}
          totalPages={3}
          onPageChange={onPageChange}
        />
      );

      // Verify range info
      expect(screen.getByText(/Showing/)).toBeDefined();
      expect(screen.getByText('21')).toBeDefined();
      expect(screen.getByText('40')).toBeDefined();
      expect(screen.getByText('55')).toBeDefined();
      expect(screen.getByText(/Page 2 of 3/)).toBeDefined();

      // Click First page
      const firstBtn = screen.getByRole('button', { name: /First page/i });
      fireEvent.click(firstBtn);
      expect(onPageChange).toHaveBeenCalledWith(1);

      // Click Previous page
      const prevBtn = screen.getByRole('button', { name: /Previous page/i });
      fireEvent.click(prevBtn);
      expect(onPageChange).toHaveBeenCalledWith(1);

      // Click Next page
      const nextBtn = screen.getByRole('button', { name: /Next page/i });
      fireEvent.click(nextBtn);
      expect(onPageChange).toHaveBeenCalledWith(3);

      // Click Last page
      const lastBtn = screen.getByRole('button', { name: /Last page/i });
      fireEvent.click(lastBtn);
      expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it('disables boundary buttons on first and last page on InvoicesTable', () => {
      const { rerender } = render(
        <InvoicesTable
          invoices={mockInvoices}
          isLoading={false}
          total={55}
          page={1}
          pageSize={20}
          totalPages={3}
          onPageChange={vi.fn()}
        />
      );

      // On page 1: First and Previous must be disabled
      expect((screen.getByRole('button', { name: /First page/i }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: /Previous page/i }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: /Next page/i }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole('button', { name: /Last page/i }) as HTMLButtonElement).disabled).toBe(false);

      // Re-render on page 3 (last page)
      rerender(
        <InvoicesTable
          invoices={mockInvoices}
          isLoading={false}
          total={55}
          page={3}
          pageSize={20}
          totalPages={3}
          onPageChange={vi.fn()}
        />
      );

      // On page 3: Next and Last must be disabled
      expect((screen.getByRole('button', { name: /First page/i }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole('button', { name: /Previous page/i }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole('button', { name: /Next page/i }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: /Last page/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('rows per page dropdown triggers onPageSizeChange callback', () => {
      const onPageSizeChange = vi.fn();

      render(
        <OrdersTable
          orders={mockOrders}
          isLoading={false}
          total={100}
          page={1}
          pageSize={20}
          totalPages={5}
          onPageChange={vi.fn()}
          onPageSizeChange={onPageSizeChange}
        />
      );

      const select = screen.getByLabelText(/Rows per page/i) as HTMLSelectElement;
      expect(select.value).toBe('20');

      fireEvent.change(select, { target: { value: '50' } });
      expect(onPageSizeChange).toHaveBeenCalledWith(50);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC3: Predictable Sorting by Column Headers
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC3: Sorting by column headers toggles ascending/descending order predictably', () => {
    it('sets aria-sort and calls onSortChange when header is clicked in OrdersTable', () => {
      const onSortChange = vi.fn();

      render(
        <OrdersTable
          orders={mockOrders}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          sortField="order_number"
          sortDirection="asc"
          onSortChange={onSortChange}
          onPageChange={vi.fn()}
        />
      );

      // Header should have aria-sort="ascending"
      const orderHeader = screen.getByRole('columnheader', { name: /Order #/i });
      expect(orderHeader.getAttribute('aria-sort')).toBe('ascending');

      // Unsorted headers should have aria-sort="none"
      const statusHeader = screen.getByRole('columnheader', { name: /Status/i });
      expect(statusHeader.getAttribute('aria-sort')).toBe('none');

      // Clicking status calls onSortChange
      const statusBtn = screen.getByRole('button', { name: /Sort by Status/i });
      fireEvent.click(statusBtn);
      expect(onSortChange).toHaveBeenCalledWith('status');
    });

    it('predictably sorts rows in ascending and descending order in OrdersTable', () => {
      const { rerender } = render(
        <OrdersTable
          orders={mockOrders}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          sortField="status"
          sortDirection="asc"
          onPageChange={vi.fn()}
        />
      );

      // Alphabetical status asc: Closed, Invoiced, Open
      const rowsAsc = screen.getAllByRole('row');
      expect(rowsAsc[1]?.textContent).toContain('Closed');
      expect(rowsAsc[2]?.textContent).toContain('Invoiced');
      expect(rowsAsc[3]?.textContent).toContain('Open');

      // Re-render in descending order
      rerender(
        <OrdersTable
          orders={mockOrders}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          sortField="status"
          sortDirection="desc"
          onPageChange={vi.fn()}
        />
      );

      // In descending order: Open, Invoiced, Closed
      const rowsDesc = screen.getAllByRole('row');
      expect(rowsDesc[1]?.textContent).toContain('Open');
      expect(rowsDesc[2]?.textContent).toContain('Invoiced');
      expect(rowsDesc[3]?.textContent).toContain('Closed');
    });

    it('predictably sorts numeric totals on OrdersTable', () => {
      const { rerender } = render(
        <OrdersTable
          orders={mockOrders}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          sortField="total"
          sortDirection="asc"
          onPageChange={vi.fn()}
        />
      );

      // Ascending: $120.00 (SO-0003), $500.00 (SO-0001), $2,500.50 (SO-0002)
      const rowsAsc = screen.getAllByRole('row');
      expect(rowsAsc[1]?.textContent).toContain('SO-2026-0003');
      expect(rowsAsc[2]?.textContent).toContain('SO-2026-0001');
      expect(rowsAsc[3]?.textContent).toContain('SO-2026-0002');

      // Re-render descending
      rerender(
        <OrdersTable
          orders={mockOrders}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          sortField="total"
          sortDirection="desc"
          onPageChange={vi.fn()}
        />
      );

      // Descending: $2,500.50 (SO-0002), $500.00 (SO-0001), $120.00 (SO-0003)
      const rowsDesc = screen.getAllByRole('row');
      expect(rowsDesc[1]?.textContent).toContain('SO-2026-0002');
      expect(rowsDesc[2]?.textContent).toContain('SO-2026-0001');
      expect(rowsDesc[3]?.textContent).toContain('SO-2026-0003');
    });

    it('predictably sorts numeric totals on InvoicesTable', () => {
      const { rerender } = render(
        <InvoicesTable
          invoices={mockInvoices}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          sortField="total"
          sortDirection="asc"
          onPageChange={vi.fn()}
        />
      );

      // Ascending: $120.00 (INV-0003), $500.00 (INV-0001), $2,500.50 (INV-0002)
      const rowsAsc = screen.getAllByRole('row');
      expect(rowsAsc[1]?.textContent).toContain('INV-2026-0003');
      expect(rowsAsc[2]?.textContent).toContain('INV-2026-0001');
      expect(rowsAsc[3]?.textContent).toContain('INV-2026-0002');

      // Re-render descending
      rerender(
        <InvoicesTable
          invoices={mockInvoices}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          sortField="total"
          sortDirection="desc"
          onPageChange={vi.fn()}
        />
      );

      // Descending: $2,500.50 (INV-0002), $500.00 (INV-0001), $120.00 (INV-0003)
      const rowsDesc = screen.getAllByRole('row');
      expect(rowsDesc[1]?.textContent).toContain('INV-2026-0002');
      expect(rowsDesc[2]?.textContent).toContain('INV-2026-0001');
      expect(rowsDesc[3]?.textContent).toContain('INV-2026-0003');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC4: Bounded Paging & Performance Protection
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC4: Bounded paging prevents DOM performance degradation', () => {
    it('restricts selectable page sizes to bounded maximum 100 per contract', () => {
      render(
        <OrdersTable
          orders={mockOrders}
          isLoading={false}
          total={100}
          page={1}
          pageSize={20}
          totalPages={5}
          onPageChange={vi.fn()}
          onPageSizeChange={vi.fn()}
        />
      );

      const select = screen.getByLabelText(/Rows per page/i) as HTMLSelectElement;
      const optionValues = Array.from(select.options).map((opt) => Number(opt.value));
      expect(optionValues).toEqual([10, 20, 50, 100]);
      expect(Math.max(...optionValues)).toBeLessThanOrEqual(100);
    });

    it('renders SkeletonTable during data loading state', () => {
      render(
        <OrdersTable
          orders={[]}
          isLoading={true}
          total={0}
          page={1}
          pageSize={20}
          totalPages={0}
          onPageChange={vi.fn()}
        />
      );

      expect(screen.getByRole('status', { name: /Loading sales orders data/i })).toBeDefined();
    });

    it('renders EmptyState when entity results are empty', () => {
      render(
        <OrdersTable
          orders={[]}
          isLoading={false}
          total={0}
          page={1}
          pageSize={20}
          totalPages={0}
          onPageChange={vi.fn()}
        />
      );

      expect(screen.getByText('No sales orders found')).toBeDefined();
    });
  });
});
