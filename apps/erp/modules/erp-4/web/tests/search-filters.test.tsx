// @vitest-environment jsdom
/**
 * Automated Verification Suite for ERP4-18: Search, Filters and Sorting Controls
 *
 * Verifies:
 * - Search input debounces keystrokes (300ms) before triggering API requests
 * - Faceted filters update URL query state and reload table results
 * - Filter tags can be cleared individually or reset with a 'Clear All' action
 * - Empty search/filter results display an informative empty state message
 *
 * @module erp4/web/tests/search-filters
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { installNavigationRequestShim } from './support/jsdom-environment.js';
import { FilterBar } from '../src/components/FilterBar.js';
import { FilterPills, type ActiveFilterPill } from '../src/components/FilterPills.js';
import { FilterSidebar } from '../src/components/FilterSidebar.js';
import { AccountsTable } from '../src/components/AccountsTable.js';
import type { AccountsFilterQuery } from '@clearshift/contracts';

installNavigationRequestShim();

describe('ERP4-18: Search, Filters and Sorting Controls Suite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('1. Acceptance Criterion: Search input debounces keystrokes (300ms)', () => {
    it('debounces rapid keystrokes by 300ms before calling onFilterChange', () => {
      const onFilterChange = vi.fn();
      const onReset = vi.fn();
      const filters: AccountsFilterQuery = { page: 1, limit: 20, search: '' };

      render(
        <MemoryRouter>
          <FilterBar
            filters={filters}
            onFilterChange={onFilterChange}
            onReset={onReset}
          />
        </MemoryRouter>
      );

      const searchInput = screen.getByRole('textbox', {
        name: /Search accounts by code or name/i,
      });

      // Type initial character 'C'
      fireEvent.change(searchInput, { target: { value: 'C' } });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      // Should not have triggered yet at 100ms
      expect(onFilterChange).not.toHaveBeenCalled();

      // Type additional characters rapidly
      fireEvent.change(searchInput, { target: { value: 'Ca' } });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(onFilterChange).not.toHaveBeenCalled();

      fireEvent.change(searchInput, { target: { value: 'Cash' } });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(onFilterChange).not.toHaveBeenCalled();

      // Advance remaining time to complete 300ms debounce window
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // Exactly one debounced call triggered with the final query and page reset to 1
      expect(onFilterChange).toHaveBeenCalledTimes(1);
      expect(onFilterChange).toHaveBeenCalledWith({
        search: 'Cash',
        page: 1,
      });
    });

    it('immediately clears search when clear button is clicked', () => {
      const onFilterChange = vi.fn();
      const filters: AccountsFilterQuery = { page: 1, limit: 20, search: 'Operating' };

      render(
        <MemoryRouter>
          <FilterBar
            filters={filters}
            onFilterChange={onFilterChange}
            onReset={vi.fn()}
          />
        </MemoryRouter>
      );

      const clearBtn = screen.getByRole('button', { name: /Clear search input/i });
      fireEvent.click(clearBtn);

      expect(onFilterChange).toHaveBeenCalledWith({
        search: undefined,
        page: 1,
      });
    });
  });

  describe('2. Acceptance Criterion: Faceted filters update query state', () => {
    it('updates account type facet and triggers filter change with page reset', () => {
      const onFilterChange = vi.fn();
      const filters: AccountsFilterQuery = { page: 3, limit: 20 };

      render(
        <MemoryRouter>
          <FilterBar
            filters={filters}
            onFilterChange={onFilterChange}
            onReset={vi.fn()}
          />
        </MemoryRouter>
      );

      const typeSelect = screen.getByRole('combobox', { name: /Filter by account type/i });
      fireEvent.change(typeSelect, { target: { value: 'asset' } });

      expect(onFilterChange).toHaveBeenCalledWith({
        type: 'asset',
        page: 1,
      });
    });

    it('updates status facet in faceted sidebar drawer', () => {
      const onFilterChange = vi.fn();
      const filters: AccountsFilterQuery = { page: 1, limit: 20 };

      render(
        <FilterSidebar
          isOpen={true}
          onClose={vi.fn()}
          filters={filters}
          onFilterChange={onFilterChange}
          onReset={vi.fn()}
          totalResults={42}
        />
      );

      // Verify header and matching count
      expect(screen.getByText('42 matching accounts')).toBeDefined();

      // Select 'Active Only'
      const activeRadio = screen.getByLabelText(/Active Only/i);
      fireEvent.click(activeRadio);

      expect(onFilterChange).toHaveBeenCalledWith({
        isActive: true,
        is_active: true,
        page: 1,
      });
    });

    it('updates currency facet in faceted sidebar drawer', () => {
      const onFilterChange = vi.fn();
      const filters: AccountsFilterQuery = { page: 1, limit: 20 };

      render(
        <FilterSidebar
          isOpen={true}
          onClose={vi.fn()}
          filters={filters}
          onFilterChange={onFilterChange}
          onReset={vi.fn()}
        />
      );

      const usdRadio = screen.getByLabelText('USD');
      fireEvent.click(usdRadio);

      expect(onFilterChange).toHaveBeenCalledWith({
        currencyCode: 'USD',
        currency_code: 'USD',
        page: 1,
      });
    });
  });

  describe('3. Acceptance Criterion: Filter tags can be cleared individually or reset with Clear All', () => {
    it('renders active filter pills with individual removal affordances', () => {
      const onRemoveSearch = vi.fn();
      const onRemoveType = vi.fn();
      const onClearAll = vi.fn();

      const pills: ActiveFilterPill[] = [
        { id: 'search', label: 'Search', value: '"Payroll"', onRemove: onRemoveSearch },
        { id: 'type', label: 'Type', value: 'Expense', onRemove: onRemoveType },
      ];

      render(
        <FilterPills
          pills={pills}
          onClearAll={onClearAll}
        />
      );

      // Verify pills rendered
      expect(screen.getByText('"Payroll"')).toBeDefined();
      expect(screen.getByText('Expense')).toBeDefined();

      // Click remove on individual search pill
      const removeSearchBtn = screen.getByRole('button', { name: /Remove filter for Search/i });
      fireEvent.click(removeSearchBtn);
      expect(onRemoveSearch).toHaveBeenCalledTimes(1);

      // Click Clear All
      const clearAllBtn = screen.getByRole('button', { name: /Clear all active filters/i });
      fireEvent.click(clearAllBtn);
      expect(onClearAll).toHaveBeenCalledTimes(1);
    });

    it('FilterBar renders active pills and resets all filters on Reset Filters click', () => {
      const onFilterChange = vi.fn();
      const onReset = vi.fn();
      const filters: AccountsFilterQuery = {
        page: 1,
        limit: 20,
        search: 'Bank',
        type: 'asset',
        isActive: true,
      };

      render(
        <MemoryRouter>
          <FilterBar
            filters={filters}
            onFilterChange={onFilterChange}
            onReset={onReset}
          />
        </MemoryRouter>
      );

      // Should render 3 pills with individual remove buttons: Search, Type, Status
      expect(screen.getByText('"Bank"')).toBeDefined();
      expect(screen.getByRole('button', { name: /Remove filter for Search/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Remove filter for Type/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Remove filter for Status/i })).toBeDefined();

      // Reset all filters button
      const resetBtn = screen.getByRole('button', { name: /Reset all filters/i });
      fireEvent.click(resetBtn);
      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Acceptance Criterion: Empty search/filter results display informative message', () => {
    it('displays informative empty state message when filters are active with 0 results', () => {
      const onClearFilters = vi.fn();

      render(
        <MemoryRouter>
          <AccountsTable
            accounts={[]}
            isLoading={false}
            total={0}
            page={1}
            totalPages={1}
            hasActiveFilters={true}
            onPageChange={vi.fn()}
            onClearFilters={onClearFilters}
          />
        </MemoryRouter>
      );

      expect(screen.getByText('No matching accounts found')).toBeDefined();
      expect(
        screen.getByText(/No accounts match your current search query or filter selection/i)
      ).toBeDefined();

      const clearBtn = screen.getByRole('button', { name: /Clear All Filters/i });
      fireEvent.click(clearBtn);
      expect(onClearFilters).toHaveBeenCalledTimes(1);
    });

    it('displays default zero-data message when no filters are active', () => {
      render(
        <MemoryRouter>
          <AccountsTable
            accounts={[]}
            isLoading={false}
            total={0}
            page={1}
            totalPages={1}
            hasActiveFilters={false}
            onPageChange={vi.fn()}
          />
        </MemoryRouter>
      );

      expect(screen.getByText('No accounts found')).toBeDefined();
      expect(screen.getByText(/No accounts have been created yet/i)).toBeDefined();
    });
  });
});
