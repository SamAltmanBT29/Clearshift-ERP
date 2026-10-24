// @vitest-environment jsdom
/**
 * ERP2-18 — Search, Filters and Sorting Controls
 * Issue #134 — Unit tests covering AC1–AC4
 *
 * AC1: Search input debounces keystrokes (300ms) before triggering callback
 * AC2: Faceted filters update filter state on radio selection
 * AC3: Filter pill tags can be cleared individually or with 'Clear All'
 * AC4: Empty search/filter results display informative empty state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { SearchBar } from '../src/components/SearchBar.js';
import { FilterPillTags } from '../src/components/FilterPillTags.js';
import type { Erp2ActiveFilters, Erp2FilterKey } from '../src/components/FilterPillTags.js';
import { VendorFilterSidebar, POFilterSidebar } from '../src/components/FilterSidebar.js';
import { EmptyState } from '../src/components/StateViews.js';

// ─── AC1: Search Debounce (300ms) ──────────────────────────────────────────────

describe('AC1 — SearchBar debounce (300ms)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('does NOT call onChange before 300ms elapses', () => {
    const onChange = vi.fn();
    render(
      <SearchBar
        value=""
        onChange={onChange}
        placeholder="Search vendors..."
        debounceMs={300}
        inputId="test-search"
      />,
    );

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'Acme' } });

    // Advance to 299ms — callback should NOT have been called
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('calls onChange once after 300ms elapses', () => {
    const onChange = vi.fn();
    render(
      <SearchBar
        value=""
        onChange={onChange}
        placeholder="Search vendors..."
        debounceMs={300}
        inputId="test-search"
      />,
    );

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'Acme' } });

    // Advance to exactly 300ms — callback should fire
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('Acme');
  });

  it('resets the timer on subsequent keystrokes within 300ms', () => {
    const onChange = vi.fn();
    render(
      <SearchBar
        value=""
        onChange={onChange}
        placeholder="Search vendors..."
        debounceMs={300}
        inputId="test-search"
      />,
    );

    const input = screen.getByRole('searchbox');

    // Type "A" at t=0
    fireEvent.change(input, { target: { value: 'A' } });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Type "Ac" at t=150ms — timer resets
    fireEvent.change(input, { target: { value: 'Ac' } });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // At t=300ms total, but only 150ms since last keystroke — should NOT fire
    expect(onChange).not.toHaveBeenCalled();

    // Advance another 150ms to reach 300ms from last keystroke
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('Ac');
  });

  it('fires onChange immediately on clear button click (no debounce)', () => {
    const onChange = vi.fn();
    render(
      <SearchBar
        value="existing"
        onChange={onChange}
        placeholder="Search vendors..."
        debounceMs={300}
        inputId="test-search"
      />,
    );

    const clearBtn = screen.getByLabelText('Clear search input');
    fireEvent.click(clearBtn);

    // No timer needed — clear fires synchronously
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('syncs internal text when external value prop changes (Clear All reset)', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchBar
        value="hello"
        onChange={onChange}
        placeholder="Search vendors..."
        debounceMs={300}
        inputId="test-search"
      />,
    );

    const input = screen.getByRole('searchbox') as HTMLInputElement;
    expect(input.value).toBe('hello');

    // Parent resets value to ''
    rerender(
      <SearchBar
        value=""
        onChange={onChange}
        placeholder="Search vendors..."
        debounceMs={300}
        inputId="test-search"
      />,
    );

    expect(input.value).toBe('');
  });
});

// ─── AC2: Faceted Filters Update State ─────────────────────────────────────────

describe('AC2 — Faceted filter sidebar updates filter state', () => {
  afterEach(() => {
    cleanup();
  });

  it('VendorFilterSidebar calls onFilterChange with currency when radio is selected', () => {
    const onFilterChange = vi.fn();
    const onReset = vi.fn();
    const onToggle = vi.fn();

    render(
      <VendorFilterSidebar
        filters={{ currency: undefined }}
        onFilterChange={onFilterChange}
        onResetFilters={onReset}
        isLoading={false}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    // Find the USD radio option and click it
    const usdRadio = screen.getByLabelText('USD — US Dollar');
    fireEvent.click(usdRadio);

    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith({ currency: 'USD' });
  });

  it('VendorFilterSidebar calls onFilterChange with undefined currency for "All" option', () => {
    const onFilterChange = vi.fn();
    render(
      <VendorFilterSidebar
        filters={{ currency: 'USD' }}
        onFilterChange={onFilterChange}
        onResetFilters={vi.fn()}
        isLoading={false}
        isOpen={true}
        onToggle={vi.fn()}
      />,
    );

    // Click the "All Currencies" radio
    const allRadio = screen.getByLabelText('All Currencies');
    fireEvent.click(allRadio);

    expect(onFilterChange).toHaveBeenCalledWith({ currency: undefined });
  });

  it('POFilterSidebar calls onFilterChange with status when radio is selected', () => {
    const onFilterChange = vi.fn();
    render(
      <POFilterSidebar
        filters={{ status: undefined }}
        onFilterChange={onFilterChange}
        onResetFilters={vi.fn()}
        isLoading={false}
        isOpen={true}
        onToggle={vi.fn()}
      />,
    );

    const draftRadio = screen.getByLabelText('Draft');
    fireEvent.click(draftRadio);

    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith({ status: 'Draft' });
  });

  it('POFilterSidebar calls onFilterChange with undefined status for "All" option', () => {
    const onFilterChange = vi.fn();
    render(
      <POFilterSidebar
        filters={{ status: 'Draft' }}
        onFilterChange={onFilterChange}
        onResetFilters={vi.fn()}
        isLoading={false}
        isOpen={true}
        onToggle={vi.fn()}
      />,
    );

    const allRadio = screen.getByLabelText('All Statuses');
    fireEvent.click(allRadio);

    expect(onFilterChange).toHaveBeenCalledWith({ status: undefined });
  });

  it('sidebar collapses when toggle button is clicked', () => {
    const onToggle = vi.fn();
    render(
      <VendorFilterSidebar
        filters={{ currency: undefined }}
        onFilterChange={vi.fn()}
        onResetFilters={vi.fn()}
        isLoading={false}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    const toggleBtn = screen.getByLabelText('Collapse filters sidebar');
    fireEvent.click(toggleBtn);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

// ─── AC3: Filter Pill Tags — Individual Clear and Clear All ────────────────────

describe('AC3 — FilterPillTags individual clear and Clear All', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when no active filters', () => {
    const { container } = render(
      <FilterPillTags
        filters={{}}
        onRemoveFilter={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );

    // Component returns null — container should be empty
    expect(container.innerHTML).toBe('');
  });

  it('renders a pill for each active filter with correct labels', () => {
    const filters: Erp2ActiveFilters = {
      search: 'Acme',
      currency: 'USD',
      status: 'Draft',
    };

    render(
      <FilterPillTags
        filters={filters}
        onRemoveFilter={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );

    expect(screen.getByText('"Acme"')).toBeDefined();
    expect(screen.getByText('USD')).toBeDefined();
    expect(screen.getByText('Draft')).toBeDefined();
    expect(screen.getByText('Active filters:')).toBeDefined();
  });

  it('calls onRemoveFilter with correct key when individual pill ✕ is clicked', () => {
    const onRemoveFilter = vi.fn();
    const filters: Erp2ActiveFilters = {
      search: 'Acme',
      currency: 'EUR',
    };

    render(
      <FilterPillTags
        filters={filters}
        onRemoveFilter={onRemoveFilter}
        onClearAll={vi.fn()}
      />,
    );

    // Click the currency pill remove button
    const currencyRemoveBtn = screen.getByLabelText('Remove currency filter: EUR');
    fireEvent.click(currencyRemoveBtn);

    expect(onRemoveFilter).toHaveBeenCalledTimes(1);
    expect(onRemoveFilter).toHaveBeenCalledWith('currency');
  });

  it('calls onRemoveFilter("search") when search pill ✕ is clicked', () => {
    const onRemoveFilter = vi.fn();

    render(
      <FilterPillTags
        filters={{ search: 'testing' }}
        onRemoveFilter={onRemoveFilter}
        onClearAll={vi.fn()}
      />,
    );

    const searchRemoveBtn = screen.getByLabelText('Remove search filter: testing');
    fireEvent.click(searchRemoveBtn);

    expect(onRemoveFilter).toHaveBeenCalledWith('search');
  });

  it('calls onClearAll when "Clear All" button is clicked', () => {
    const onClearAll = vi.fn();
    const filters: Erp2ActiveFilters = {
      search: 'Acme',
      status: 'Sent',
    };

    render(
      <FilterPillTags
        filters={filters}
        onRemoveFilter={vi.fn()}
        onClearAll={onClearAll}
      />,
    );

    const clearAllBtn = screen.getByLabelText('Clear all active filters');
    fireEvent.click(clearAllBtn);

    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('disables pill remove and Clear All buttons when disabled prop is true', () => {
    render(
      <FilterPillTags
        filters={{ search: 'test', currency: 'GBP' }}
        onRemoveFilter={vi.fn()}
        onClearAll={vi.fn()}
        disabled={true}
      />,
    );

    const removeButtons = screen.getAllByRole('button');
    removeButtons.forEach((btn) => {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });
});

// ─── AC4: Empty State Display ──────────────────────────────────────────────────

describe('AC4 — Empty state with informative message', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders default empty state title and message', () => {
    render(<EmptyState />);

    expect(screen.getByText('No records found')).toBeDefined();
    expect(
      screen.getByText('There are no records matching your current search or filter criteria.'),
    ).toBeDefined();
  });

  it('renders custom title and message', () => {
    render(
      <EmptyState
        title="No vendors found"
        message="Try adjusting your search or filter criteria."
      />,
    );

    expect(screen.getByText('No vendors found')).toBeDefined();
    expect(screen.getByText('Try adjusting your search or filter criteria.')).toBeDefined();
  });

  it('renders action button and fires callback when provided', () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        title="No results"
        message="Nothing matches."
        actionLabel="Clear filters"
        onAction={onAction}
      />,
    );

    const actionBtn = screen.getByText('Clear filters');
    expect(actionBtn).toBeDefined();

    fireEvent.click(actionBtn);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
