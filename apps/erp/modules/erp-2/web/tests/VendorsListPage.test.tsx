// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { VendorsListPage } from '../src/pages/VendorsListPage.js';
import { SkeletonTable, EmptyState } from '../src/components/StateViews.js';
import * as api from '../src/api/erp-2.js';
import type { Vendor, PurchaseOrder } from '@clearshift/contracts';

const mockVendor: Vendor = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Acme Industrial Supplies LLC',
  tax_number: 'US-EIN-123456789',
  email: 'procurement@acme-industrial.com',
  phone: '+1-555-0199',
  address_line: '100 Industrial Parkway',
  city: 'Chicago',
  country: 'United States',
  bank_masked: 'XXXX-XXXX-7890',
  currency: 'USD',
  source_system: null,
  source_id: null,
  created_at: '2026-10-23T00:00:00Z',
  updated_at: '2026-10-23T00:00:00Z',
};

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

describe('ERP-2 VendorsListPage — React Testing Library Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('Initial Load & Vendors Rendering', () => {
    it('renders the page header, tabs, and fetches vendors on mount', async () => {
      vi.spyOn(api, 'fetchVendors').mockResolvedValue({
        items: [mockVendor],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<VendorsListPage />);

      expect(screen.getByText('Vendors & Purchasing')).toBeDefined();
      expect(screen.getByRole('tab', { name: /Vendors/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /Purchase Orders/i })).toBeDefined();

      const vendorRow = await screen.findByText('Acme Industrial Supplies LLC');
      expect(vendorRow).toBeDefined();
      expect(screen.getByText('US-EIN-123456789')).toBeDefined();
      expect(screen.getByText('XXXX-XXXX-7890')).toBeDefined();
      expect(screen.getByText(/Chicago, United States/)).toBeDefined();
    });
  });

  describe('Search & Filter Interactions on Vendors', () => {
    it('typing into search triggers query and resets page to 1', async () => {
      const fetchSpy = vi.spyOn(api, 'fetchVendors').mockResolvedValue({
        items: [mockVendor],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<VendorsListPage />);
      await screen.findByText('Acme Industrial Supplies LLC');

      const searchInput = screen.getByLabelText(/Search vendors by legal name/i);
      fireEvent.change(searchInput, { target: { value: 'Global' } });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            search: 'Global',
            page: 1,
          })
        );
      });
    });

    it('clicking Reset Filters resets search and page to 1', async () => {
      const fetchSpy = vi.spyOn(api, 'fetchVendors').mockResolvedValue({
        items: [mockVendor],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<VendorsListPage />);
      await screen.findByText('Acme Industrial Supplies LLC');

      const searchInput = screen.getByLabelText(/Search vendors by legal name/i);
      fireEvent.change(searchInput, { target: { value: 'Global' } });

      const resetBtn = screen.getByRole('button', { name: /Reset filters/i });
      fireEvent.click(resetBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            search: '',
            page: 1,
          })
        );
      });
    });

    it('clicking next page in pagination triggers query with updated page', async () => {
      const fetchSpy = vi.spyOn(api, 'fetchVendors').mockResolvedValue({
        items: [mockVendor],
        total: 40,
        page: 1,
        pageSize: 20,
        totalPages: 2,
      });

      render(<VendorsListPage />);
      await screen.findByText('Acme Industrial Supplies LLC');

      const nextBtn = screen.getByRole('button', { name: /Next page/i });
      expect(nextBtn).toBeDefined();
      fireEvent.click(nextBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            page: 2,
          })
        );
      });
    });
  });

  describe('Empty Results & Error States on Vendors', () => {
    it('shows empty state view when API returns 0 vendors', async () => {
      vi.spyOn(api, 'fetchVendors').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      render(<VendorsListPage />);

      const emptyTitle = await screen.findByText('No vendors found');
      expect(emptyTitle).toBeDefined();
      expect(screen.getByText(/No vendor profiles match your current search criteria/i)).toBeDefined();
    });

    it('shows error state on API failure and re-triggers fetch on Try Again click', async () => {
      const fetchSpy = vi
        .spyOn(api, 'fetchVendors')
        .mockRejectedValueOnce(new Error('Gateway timeout connecting to vendors database'))
        .mockResolvedValueOnce({
          items: [mockVendor],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });

      render(<VendorsListPage />);

      const errorTitle = await screen.findByText('Failed to Load Vendors');
      expect(errorTitle).toBeDefined();
      expect(screen.getByText('Gateway timeout connecting to vendors database')).toBeDefined();

      const retryBtn = screen.getByRole('button', { name: /Try Again/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });
    });

    it('shows access denied state on 403 Forbidden error', async () => {
      vi.spyOn(api, 'fetchVendors').mockRejectedValueOnce(
        new api.ApiError(403, 'FORBIDDEN', 'User lacks erp:vendors:read permission')
      );

      render(<VendorsListPage />);

      const forbiddenTitle = await screen.findByText('Access Denied');
      expect(forbiddenTitle).toBeDefined();
      expect(
        screen.getByText(/You do not have permission to view vendor profiles/i)
      ).toBeDefined();
    });
  });

  describe('Purchase Orders Tab & Interactions', () => {
    it('switches to Purchase Orders tab and renders purchase order data', async () => {
      vi.spyOn(api, 'fetchVendors').mockResolvedValue({
        items: [mockVendor],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      const fetchPoSpy = vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<VendorsListPage />);
      await screen.findByText('Acme Industrial Supplies LLC');

      const poTab = screen.getByRole('tab', { name: /Purchase Orders/i });
      fireEvent.click(poTab);

      await waitFor(() => {
        expect(fetchPoSpy).toHaveBeenCalled();
      });

      const poNumber = await screen.findByText('PO-2026-0001');
      expect(poNumber).toBeDefined();
      expect(screen.getAllByText('Draft').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('1,250.00')).toBeDefined();
      expect(screen.getByText('1 line')).toBeDefined();
    });

    it('filtering by status triggers query with status and resets page to 1', async () => {
      vi.spyOn(api, 'fetchVendors').mockResolvedValue({
        items: [mockVendor],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      const fetchPoSpy = vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [mockOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(<VendorsListPage />);
      const poTab = screen.getByRole('tab', { name: /Purchase Orders/i });
      fireEvent.click(poTab);

      await screen.findByText('PO-2026-0001');

      const statusSelect = screen.getByLabelText(/Filter by order status/i);
      fireEvent.change(statusSelect, { target: { value: 'Sent' } });

      await waitFor(() => {
        expect(fetchPoSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'Sent',
            page: 1,
          })
        );
      });
    });

    it('shows empty state view when API returns 0 purchase orders', async () => {
      vi.spyOn(api, 'fetchVendors').mockResolvedValue({
        items: [mockVendor],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      render(<VendorsListPage />);
      const poTab = screen.getByRole('tab', { name: /Purchase Orders/i });
      fireEvent.click(poTab);

      const emptyTitle = await screen.findByText('No purchase orders found');
      expect(emptyTitle).toBeDefined();
    });

    it('shows access denied state when purchase orders API returns 403', async () => {
      vi.spyOn(api, 'fetchVendors').mockResolvedValue({
        items: [mockVendor],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      vi.spyOn(api, 'fetchPurchaseOrders').mockRejectedValueOnce(
        new api.ApiError(403, 'FORBIDDEN', 'User lacks erp:purchase_orders:read permission')
      );

      render(<VendorsListPage />);
      const poTab = screen.getByRole('tab', { name: /Purchase Orders/i });
      fireEvent.click(poTab);

      const forbiddenTitle = await screen.findByText('Access Denied');
      expect(forbiddenTitle).toBeDefined();
      expect(
        screen.getByText(/You do not have permission to view purchase orders/i)
      ).toBeDefined();
    });
  });
});
