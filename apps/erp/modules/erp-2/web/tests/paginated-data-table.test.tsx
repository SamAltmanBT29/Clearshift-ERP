// @vitest-environment jsdom
/**
 * ERP-2 Vendors & Purchasing — Main Paginated Data Table Test Suite
 *
 * Verifies Acceptance Criteria for Issue #133 (ERP2-17 / Gate G2):
 *   AC1. Table displays entity rows with stable columns matching the data dictionary.
 *   AC2. Pagination controls bind to API page and pageSize query parameters.
 *   AC3. Sorting by column headers toggles ascending/descending order predictably.
 *   AC4. Virtualization or bounded paging prevents DOM performance degradation.
 *
 * @module erp2/web/tests/paginated-data-table.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { Vendor, PurchaseOrder } from '@clearshift/contracts';
import { VendorsTable } from '../src/components/VendorsTable.js';
import { PurchaseOrdersTable } from '../src/components/PurchaseOrdersTable.js';

const mockVendors: Vendor[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Acme Industrial Supplies',
    tax_number: 'TX-998877',
    email: 'sales@acme-industrial.com',
    phone: '+1-555-0199',
    address_line: '100 Industrial Parkway',
    city: 'Metropolis',
    country: 'USA',
    bank_masked: 'XXXX-XXXX-7890',
    currency: 'USD',
    source_system: null,
    source_id: null,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'Beta Engineering Works',
    tax_number: 'TX-112233',
    email: 'info@beta-engineering.com',
    phone: null,
    address_line: '200 Tech Way',
    city: 'Gotham',
    country: 'USA',
    bank_masked: 'XXXX-XXXX-1234',
    currency: 'USD',
    source_system: null,
    source_id: null,
    created_at: '2026-03-02T00:00:00.000Z',
    updated_at: '2026-03-02T00:00:00.000Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    name: 'Zenith Logistics Global',
    tax_number: 'TX-445566',
    email: 'contact@zenith-global.com',
    phone: '+44-20-7946-0991',
    address_line: null,
    city: 'London',
    country: 'UK',
    bank_masked: null,
    currency: 'GBP',
    source_system: null,
    source_id: null,
    created_at: '2026-03-03T00:00:00.000Z',
    updated_at: '2026-03-03T00:00:00.000Z',
  },
];

const mockOrders: PurchaseOrder[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    po_number: 'PO-2026-0001',
    vendor_id: '00000000-0000-0000-0000-000000000001',
    order_date: '2026-10-15',
    status: 'Draft',
    currency: 'USD',
    total: '500.00',
    lines: [
      {
        id: 'line-1',
        po_id: '11111111-1111-1111-1111-111111111111',
        product_id: 'prod-1',
        quantity: '5.00',
        price: '100.00',
        line_total: '500.00',
      },
    ],
    created_at: '2026-10-15T00:00:00Z',
    updated_at: '2026-10-15T00:00:00Z',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    po_number: 'PO-2026-0002',
    vendor_id: '00000000-0000-0000-0000-000000000002',
    order_date: '2026-10-18',
    status: 'Sent',
    currency: 'USD',
    total: '2500.50',
    lines: [
      {
        id: 'line-2',
        po_id: '22222222-2222-2222-2222-222222222222',
        product_id: 'prod-2',
        quantity: '10.00',
        price: '250.05',
        line_total: '2500.50',
      },
    ],
    created_at: '2026-10-18T00:00:00Z',
    updated_at: '2026-10-18T00:00:00Z',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    po_number: 'PO-2026-0003',
    vendor_id: '00000000-0000-0000-0000-000000000003',
    order_date: '2026-10-20',
    status: 'Closed',
    currency: 'GBP',
    total: '120.00',
    lines: [],
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
  },
];

describe('ERP-2 Main Paginated Data Table (ERP2-17 / Issue #133)', () => {
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
    it('VendorsTable renders all required columns matching Data Dictionary §2', () => {
      render(
        <VendorsTable
          vendors={mockVendors}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          onPageChange={vi.fn()}
        />
      );

      // Verify table header columns
      expect(screen.getByRole('columnheader', { name: /Vendor Name/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Tax Number/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Email/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Phone/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Currency/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Bank Account/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Location/i })).toBeDefined();

      // Verify entity data rendering
      expect(screen.getByText('Acme Industrial Supplies')).toBeDefined();
      expect(screen.getByText('TX-998877')).toBeDefined();
      expect(screen.getByText('sales@acme-industrial.com')).toBeDefined();
      expect(screen.getByText('+1-555-0199')).toBeDefined();
      expect(screen.getByText('XXXX-XXXX-7890')).toBeDefined();
      expect(screen.getByText('Metropolis, USA')).toBeDefined();

      // Verify null handling
      expect(screen.getByText('Beta Engineering Works')).toBeDefined();
      expect(screen.getByText('London, UK')).toBeDefined();
    });

    it('PurchaseOrdersTable renders all required columns matching Data Dictionary §3', () => {
      render(
        <PurchaseOrdersTable
          purchaseOrders={mockOrders}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          onPageChange={vi.fn()}
        />
      );

      // Verify table headers
      expect(screen.getByRole('columnheader', { name: /PO Number/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Vendor ID/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Order Date/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Status/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Currency/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Order Total/i })).toBeDefined();
      expect(screen.getByRole('columnheader', { name: /Lines/i })).toBeDefined();

      // Verify order data
      expect(screen.getByText('PO-2026-0001')).toBeDefined();
      expect(screen.getByText('2026-10-15')).toBeDefined();
      expect(screen.getByText('Draft')).toBeDefined();
      expect(screen.getByText('500.00')).toBeDefined();
      // Two POs each have 1 line (PO-0001, PO-0002)
      expect(screen.getAllByText(/1\s*line\b/).length).toBe(2);

      expect(screen.getByText('PO-2026-0002')).toBeDefined();
      expect(screen.getByText('Sent')).toBeDefined();
      expect(screen.getByText('2,500.50')).toBeDefined();

      expect(screen.getByText('PO-2026-0003')).toBeDefined();
      expect(screen.getByText('Closed')).toBeDefined();
      expect(screen.getByText(/0\s*lines/)).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC2: Pagination Controls Bind to page & pageSize
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC2: Pagination controls bind to API page and pageSize query parameters', () => {
    it('pagination controls navigate first, prev, next, and last correctly', () => {
      const onPageChange = vi.fn();

      render(
        <VendorsTable
          vendors={mockVendors}
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

    it('disables boundary buttons on first and last page', () => {
      const { rerender } = render(
        <VendorsTable
          vendors={mockVendors}
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
        <VendorsTable
          vendors={mockVendors}
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
        <VendorsTable
          vendors={mockVendors}
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
    it('sets aria-sort and calls onSortChange when header is clicked', () => {
      const onSortChange = vi.fn();

      render(
        <VendorsTable
          vendors={mockVendors}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          sortField="name"
          sortDirection="asc"
          onSortChange={onSortChange}
          onPageChange={vi.fn()}
        />
      );

      // Header should have aria-sort="ascending"
      const nameHeader = screen.getByRole('columnheader', { name: /Vendor Name/i });
      expect(nameHeader.getAttribute('aria-sort')).toBe('ascending');

      // Unsorted headers should have aria-sort="none"
      const taxHeader = screen.getByRole('columnheader', { name: /Tax Number/i });
      expect(taxHeader.getAttribute('aria-sort')).toBe('none');

      // Clicking tax number calls onSortChange
      const taxBtn = screen.getByRole('button', { name: /Sort by Tax Number/i });
      fireEvent.click(taxBtn);
      expect(onSortChange).toHaveBeenCalledWith('tax_number');
    });

    it('predictably sorts rows in ascending and descending order', () => {
      const { rerender } = render(
        <VendorsTable
          vendors={mockVendors}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          sortField="name"
          sortDirection="asc"
          onPageChange={vi.fn()}
        />
      );

      // In ascending order: Acme, Beta, Zenith
      const rowsAsc = screen.getAllByRole('row');
      expect(rowsAsc[1]?.textContent).toContain('Acme Industrial Supplies');
      expect(rowsAsc[2]?.textContent).toContain('Beta Engineering Works');
      expect(rowsAsc[3]?.textContent).toContain('Zenith Logistics Global');

      // Re-render in descending order
      rerender(
        <VendorsTable
          vendors={mockVendors}
          isLoading={false}
          total={3}
          page={1}
          pageSize={20}
          totalPages={1}
          sortField="name"
          sortDirection="desc"
          onPageChange={vi.fn()}
        />
      );

      // In descending order: Zenith, Beta, Acme
      const rowsDesc = screen.getAllByRole('row');
      expect(rowsDesc[1]?.textContent).toContain('Zenith Logistics Global');
      expect(rowsDesc[2]?.textContent).toContain('Beta Engineering Works');
      expect(rowsDesc[3]?.textContent).toContain('Acme Industrial Supplies');
    });

    it('predictably sorts numeric totals on PurchaseOrdersTable', () => {
      const { rerender } = render(
        <PurchaseOrdersTable
          purchaseOrders={mockOrders}
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

      // Ascending: $120.00 (PO-0003), $500.00 (PO-0001), $2,500.50 (PO-0002)
      const rowsAsc = screen.getAllByRole('row');
      expect(rowsAsc[1]?.textContent).toContain('PO-2026-0003');
      expect(rowsAsc[2]?.textContent).toContain('PO-2026-0001');
      expect(rowsAsc[3]?.textContent).toContain('PO-2026-0002');

      // Re-render descending
      rerender(
        <PurchaseOrdersTable
          purchaseOrders={mockOrders}
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

      // Descending: $2,500.50 (PO-0002), $500.00 (PO-0001), $120.00 (PO-0003)
      const rowsDesc = screen.getAllByRole('row');
      expect(rowsDesc[1]?.textContent).toContain('PO-2026-0002');
      expect(rowsDesc[2]?.textContent).toContain('PO-2026-0001');
      expect(rowsDesc[3]?.textContent).toContain('PO-2026-0003');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC4: Bounded Paging & Performance Protection
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC4: Bounded paging prevents DOM performance degradation', () => {
    it('restricts selectable page sizes to bounded maximum 100 per contract', () => {
      render(
        <VendorsTable
          vendors={mockVendors}
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
        <VendorsTable
          vendors={[]}
          isLoading={true}
          total={0}
          page={1}
          pageSize={20}
          totalPages={0}
          onPageChange={vi.fn()}
        />
      );

      expect(screen.getByRole('status', { name: /Loading data/i })).toBeDefined();
    });

    it('renders EmptyState when entity results are empty', () => {
      render(
        <VendorsTable
          vendors={[]}
          isLoading={false}
          total={0}
          page={1}
          pageSize={20}
          totalPages={0}
          onPageChange={vi.fn()}
        />
      );

      expect(screen.getByText('No vendors found')).toBeDefined();
    });
  });
});
