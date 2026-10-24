// @vitest-environment jsdom
/**
 * ERP-3 Search, Filters, and Sorting Controls Tests
 *
 * Verifies Acceptance Criteria for Issue #154 (ERP3-18):
 *   - AC1: Search input debounces keystrokes (300ms) before triggering API requests.
 *   - AC2: Faceted filters update state, sync to URL query, and trigger reloads.
 *   - AC3: Filter tags can be cleared individually or reset with a 'Clear All' action.
 *   - AC4: Empty search/filter results display an informative empty state with reset CTA.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { SearchBar } from '../src/components/SearchBar.js';
import { FilterPillTags } from '../src/components/FilterPillTags.js';
import { SalesOrderFilterSidebar, InvoiceFilterSidebar } from '../src/components/FilterSidebar.js';
import { OrdersListPage } from '../src/pages/OrdersListPage.js';
import * as api from '../src/api/erp-3.js';
import type { SalesOrder, Invoice } from '@clearshift/contracts';

const mockOrder: SalesOrder = {
  id: 'aaaaaaaa-0003-4000-8000-000000000001',
  order_number: 'SO-1001',
  customer_golden_id: '55555555-0003-4000-8000-000000000001',
  order_date: '2026-10-23',
  status: 'Open',
  currency: 'USD',
  total: '1100.0000',
  lines: [],
  source_system: null,
  source_id: null,
  created_at: '2026-10-23T00:00:00.000Z',
  updated_at: '2026-10-23T00:00:00.000Z',
};

const mockInvoice: Invoice = {
  id: 'cccccccc-0003-4000-8000-000000000001',
  invoice_number: 'INV-2026-001',
  order_id: 'aaaaaaaa-0003-4000-8000-000000000001',
  customer_golden_id: '55555555-0003-4000-8000-000000000001',
  invoice_date: '2026-10-23',
  due_date: '2026-11-23',
  status: 'Open',
  currency: 'USD',
  total: '1100.0000',
  lines: [],
  source_system: null,
  source_id: null,
  created_at: '2026-10-23T00:00:00.000Z',
  updated_at: '2026-10-23T00:00:00.000Z',
};

describe('Issue #154 — ERP-3 Search, Filters, and Sorting Controls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ─── AC1: Debounced Search Input (300ms) ────────────────────────────────────
  describe('AC1: Debounced Search Input (SearchBar)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('debounces keystrokes by 300ms before calling onChange', () => {
      const onChange = vi.fn();
      render(
        <SearchBar
          value=""
          onChange={onChange}
          placeholder="Search orders..."
          inputId="test-search"
          ariaLabel="Search orders"
        />
      );

      const input = screen.getByLabelText('Search orders');

      // User types 'S'
      fireEvent.change(input, { target: { value: 'S' } });
      expect(onChange).not.toHaveBeenCalled();

      // 100ms later, types 'O'
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.change(input, { target: { value: 'SO' } });
      expect(onChange).not.toHaveBeenCalled();

      // 100ms later, types '-1001'
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.change(input, { target: { value: 'SO-1001' } });
      expect(onChange).not.toHaveBeenCalled();

      // Advance by 299ms: still not called
      act(() => {
        vi.advanceTimersByTime(299);
      });
      expect(onChange).not.toHaveBeenCalled();

      // Advance 1ms more (total 300ms since last keystroke)
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('SO-1001');
    });

    it('immediately calls onChange with empty string when clear button (✕) is clicked', () => {
      const onChange = vi.fn();
      render(
        <SearchBar
          value="SO-1001"
          onChange={onChange}
          inputId="test-search"
          ariaLabel="Search orders"
        />
      );

      const clearBtn = screen.getByRole('button', { name: /Clear search input/i });
      fireEvent.click(clearBtn);

      expect(onChange).toHaveBeenCalledWith('');
      expect(screen.getByLabelText('Search orders')).toHaveProperty('value', '');
    });

    it('syncs internal display value when prop value changes externally', () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <SearchBar
          value="Initial"
          onChange={onChange}
          inputId="test-search"
          ariaLabel="Search orders"
        />
      );

      expect(screen.getByLabelText('Search orders')).toHaveProperty('value', 'Initial');

      rerender(
        <SearchBar
          value=""
          onChange={onChange}
          inputId="test-search"
          ariaLabel="Search orders"
        />
      );

      expect(screen.getByLabelText('Search orders')).toHaveProperty('value', '');
    });
  });

  // ─── AC2: Faceted Filter Sidebar ───────────────────────────────────────────
  describe('AC2: Faceted Filter Sidebar (SalesOrder & Invoice sidebars)', () => {
    it('SalesOrderFilterSidebar triggers filter change on status and currency selection', () => {
      const onFilterChange = vi.fn();
      const onResetFilters = vi.fn();

      render(
        <SalesOrderFilterSidebar
          filters={{ status: undefined, currency: undefined }}
          onFilterChange={onFilterChange}
          onResetFilters={onResetFilters}
          isOpen={true}
        />
      );

      // Select 'Invoiced' status radio
      const invoicedRadio = screen.getByRole('radio', { name: 'Invoiced' });
      fireEvent.click(invoicedRadio);
      expect(onFilterChange).toHaveBeenCalledWith({ status: 'Invoiced' });

      // Select 'EUR' currency radio
      const eurRadio = screen.getByRole('radio', { name: /EUR — Euro/i });
      fireEvent.click(eurRadio);
      expect(onFilterChange).toHaveBeenCalledWith({ currency: 'EUR' });
    });

    it('InvoiceFilterSidebar triggers filter change on status and currency selection', () => {
      const onFilterChange = vi.fn();
      const onResetFilters = vi.fn();

      render(
        <InvoiceFilterSidebar
          filters={{ status: undefined, currency: undefined }}
          onFilterChange={onFilterChange}
          onResetFilters={onResetFilters}
          isOpen={true}
        />
      );

      // Select 'Paid' status
      const paidRadio = screen.getByRole('radio', { name: 'Paid' });
      fireEvent.click(paidRadio);
      expect(onFilterChange).toHaveBeenCalledWith({ status: 'Paid' });

      // Select 'GBP' currency
      const gbpRadio = screen.getByRole('radio', { name: /GBP — British Pound/i });
      fireEvent.click(gbpRadio);
      expect(onFilterChange).toHaveBeenCalledWith({ currency: 'GBP' });
    });

    it('collapses sidebar when toggle button is clicked', () => {
      const onToggle = vi.fn();
      render(
        <SalesOrderFilterSidebar
          filters={{}}
          onFilterChange={vi.fn()}
          onResetFilters={vi.fn()}
          isOpen={true}
          onToggle={onToggle}
        />
      );

      const toggleBtn = screen.getByRole('button', { name: /Collapse filters sidebar/i });
      fireEvent.click(toggleBtn);
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('renders Clear Sidebar Filters button only when active facets exist', () => {
      const onResetFilters = vi.fn();
      const { rerender } = render(
        <SalesOrderFilterSidebar
          filters={{ status: undefined, currency: undefined }}
          onFilterChange={vi.fn()}
          onResetFilters={onResetFilters}
          isOpen={true}
        />
      );

      expect(screen.queryByRole('button', { name: /Clear all sidebar filters/i })).toBeNull();

      rerender(
        <SalesOrderFilterSidebar
          filters={{ status: 'Open', currency: undefined }}
          onFilterChange={vi.fn()}
          onResetFilters={onResetFilters}
          isOpen={true}
        />
      );

      const clearSidebarBtn = screen.getByRole('button', { name: /Clear all sidebar filters/i });
      expect(clearSidebarBtn).toBeDefined();
      fireEvent.click(clearSidebarBtn);
      expect(onResetFilters).toHaveBeenCalledTimes(1);
    });
  });

  // ─── AC3: Filter Pill Tags ──────────────────────────────────────────────────
  describe('AC3: Filter Pill Tags (FilterPillTags)', () => {
    it('returns null when no active filters are present', () => {
      const { container } = render(
        <FilterPillTags
          filters={{}}
          onRemoveFilter={vi.fn()}
          onClearAll={vi.fn()}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders pills for search, status, and currency', () => {
      render(
        <FilterPillTags
          filters={{
            search: 'SO-1001',
            status: 'Open',
            currency: 'USD',
          }}
          onRemoveFilter={vi.fn()}
          onClearAll={vi.fn()}
        />
      );

      expect(screen.getByText('"SO-1001"')).toBeDefined();
      expect(screen.getByText('Open')).toBeDefined();
      expect(screen.getByText('USD')).toBeDefined();
      expect(screen.getByRole('button', { name: /Clear all active filters/i })).toBeDefined();
    });

    it('removes an individual filter pill when clicking its ✕ button', () => {
      const onRemoveFilter = vi.fn();
      render(
        <FilterPillTags
          filters={{ search: 'SO-1001', status: 'Open' }}
          onRemoveFilter={onRemoveFilter}
          onClearAll={vi.fn()}
        />
      );

      const removeSearchBtn = screen.getByRole('button', {
        name: /Remove search filter: SO-1001/i,
      });
      fireEvent.click(removeSearchBtn);
      expect(onRemoveFilter).toHaveBeenCalledWith('search');

      const removeStatusBtn = screen.getByRole('button', {
        name: /Remove status filter: Open/i,
      });
      fireEvent.click(removeStatusBtn);
      expect(onRemoveFilter).toHaveBeenCalledWith('status');
    });

    it('calls onClearAll when Clear All button is clicked', () => {
      const onClearAll = vi.fn();
      render(
        <FilterPillTags
          filters={{ search: 'SO-1001', status: 'Invoiced' }}
          onRemoveFilter={vi.fn()}
          onClearAll={onClearAll}
        />
      );

      const clearAllBtn = screen.getByRole('button', { name: /Clear all active filters/i });
      fireEvent.click(clearAllBtn);
      expect(onClearAll).toHaveBeenCalledTimes(1);
    });
  });

  // ─── AC4 & Integration: URL Query State, Empty States & Reset ───────────────
  describe('AC4 & Full Page Integration (OrdersListPage)', () => {
    it('syncs active filters to window.history.replaceState URL query', async () => {
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
      vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<OrdersListPage />);
      await screen.findByText('SO-1001');

      // Check replaceState called on initial render
      expect(replaceStateSpy).toHaveBeenCalled();
      const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
      expect(lastCall?.[2]).toContain('tab=orders');
    });

    it('displays informative empty state with reset CTA when 0 results match search/filter', async () => {
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
      expect(
        screen.getByText(/No orders match your current filter selection or search query/i)
      ).toBeDefined();

      const clearAndReloadBtn = screen.getByRole('button', {
        name: /Clear Filters & Reload/i,
      });
      expect(clearAndReloadBtn).toBeDefined();
    });

    it('renders FilterPillTags and clicking Clear All in pills resets filters', async () => {
      const fetchSpy = vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<OrdersListPage />);
      await screen.findByText('SO-1001');

      // Select 'Closed' status in sidebar
      const closedRadio = screen.getByRole('radio', { name: 'Closed' });
      fireEvent.click(closedRadio);

      // Verify pill appears
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Remove status filter: Closed/i })
        ).toBeDefined();
      });

      // Click 'Clear All' in active pills bar
      const clearAllBtn = screen.getByRole('button', { name: /Clear all active filters/i });
      fireEvent.click(clearAllBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            status: undefined,
            search: '',
            page: 1,
          })
        );
      });
    });
  });
});
