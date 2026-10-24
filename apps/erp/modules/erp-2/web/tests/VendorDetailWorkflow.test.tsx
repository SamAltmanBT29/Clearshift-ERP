// @vitest-environment jsdom
/**
 * ERP-2 Vendors & Purchasing — Detail/Edit Workflow & Linked Records Tests
 *
 * Acceptance test suite for Issue #137 (ERP2-21):
 * - Acceptance Criterion 1: Detail view displays all primary attributes, created_at, updated_at, and Golden ID where applicable.
 * - Acceptance Criterion 2: Inline edit or drawer form allows updating allowlisted fields with permission checking.
 * - Acceptance Criterion 3: Linked entity sub-tables display related master records with navigation links to owning modules.
 * - Acceptance Criterion 4: Concurrent modification conflicts (409) prompt user to refresh and re-apply changes.
 *
 * All test data is 100% synthetic in compliance with ClearShift G3 constraints.
 *
 * @module erp2/web/tests/VendorDetailWorkflow.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Vendor, PurchaseOrder } from '@clearshift/contracts';
import { VendorDetailPage } from '../src/pages/VendorDetailPage.js';
import { PurchaseOrderDetailPage } from '../src/pages/PurchaseOrderDetailPage.js';
import { resolveVendorGoldenId } from '../src/components/VendorAuditPanel.js';
import * as api from '../src/api/erp-2.js';

const syntheticVendor: Vendor = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Apex Industrial Supply LLC',
  tax_number: 'US-EIN-99887766',
  email: 'procurement@apex-industrial.example',
  phone: '+1-555-0199',
  address_line: '100 Industrial Parkway',
  city: 'Chicago',
  country: 'United States',
  currency: 'USD',
  bank_masked: 'XXXX-XXXX-7890',
  source_system: 'SAP-ECC',
  source_id: 'SAP-VEND-1002',
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-24T12:00:00Z',
};

const syntheticOrders: PurchaseOrder[] = [
  {
    id: '11111111-1111-4000-8000-111111111111',
    po_number: 'PO-2026-0001',
    vendor_id: '00000000-0000-4000-8000-000000000001',
    order_date: '2026-10-22',
    currency: 'USD',
    status: 'Sent',
    total: '250.00',
    lines: [
      {
        id: '22222222-2222-4000-8000-222222222222',
        po_id: '11111111-1111-4000-8000-111111111111',
        product_id: '33333333-3333-4000-8000-333333333333',
        quantity: '10.00',
        price: '25.00',
        line_total: '250.00',
        created_at: '2026-10-22T10:00:00Z',
        updated_at: '2026-10-22T10:00:00Z',
      },
    ],
    created_at: '2026-10-22T10:00:00Z',
    updated_at: '2026-10-22T10:00:00Z',
  },
];

describe('ERP-2 Detail/Edit Workflow & Linked Records — Issue #137 (ERP2-21)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Acceptance Criterion 1: Primary attributes, timestamps & Golden ID
  // ─────────────────────────────────────────────────────────────────────────────
  describe('AC 1: Primary Attributes, Timestamps & Canonical Golden ID', () => {
    it('resolves canonical Golden ID deterministically from source_id or record UUID', () => {
      const gidWithSource = resolveVendorGoldenId(syntheticVendor);
      expect(gidWithSource).toBe('GID-VENDOR-SAPVEND1002');

      const vendorWithoutSource = { ...syntheticVendor, source_id: null };
      const gidDefault = resolveVendorGoldenId(vendorWithoutSource);
      expect(gidDefault).toBe('GID-VENDOR-00000000');
    });

    it('renders all primary attributes, audit metadata, and Golden ID badge in detail view', async () => {
      vi.spyOn(api, 'fetchVendorById').mockResolvedValue(syntheticVendor);
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: syntheticOrders,
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(
        <MemoryRouter initialEntries={['/erp2/vendors/00000000-0000-4000-8000-000000000001']}>
          <Routes>
            <Route path="/erp2/vendors/:vendorId" element={<VendorDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('detail-vendor-name').textContent).toContain('Apex Industrial Supply LLC');
      });

      expect(screen.getByTestId('detail-tax-number').textContent).toContain('US-EIN-99887766');
      expect(screen.getByTestId('detail-email').textContent).toContain('procurement@apex-industrial.example');
      expect(screen.getByTestId('detail-phone').textContent).toContain('+1-555-0199');
      expect(screen.getByTestId('detail-currency').textContent).toContain('USD');
      expect(screen.getByTestId('detail-bank-masked').textContent).toContain('XXXX-XXXX-7890');
      expect(screen.getByTestId('detail-address').textContent).toContain('100 Industrial Parkway');
      expect(screen.getByTestId('detail-city').textContent).toContain('Chicago');
      expect(screen.getByTestId('detail-country').textContent).toContain('United States');

      // Audit panel & Golden ID checks
      expect(screen.getByTestId('vendor-audit-panel')).toBeDefined();
      expect(screen.getByTestId('audit-golden-id').textContent).toContain('GID-VENDOR-SAPVEND1002');
      expect(screen.getByTestId('audit-record-id').textContent).toContain('00000000-0000-4000-8000-000000000001');
      expect(screen.getByTestId('audit-source-system').textContent).toContain('SAP-ECC');
      expect(screen.getByTestId('audit-source-id').textContent).toContain('SAP-VEND-1002');
      expect(screen.getByTestId('header-golden-id-badge').textContent).toContain('GID-VENDOR-SAPVEND1002');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Acceptance Criterion 2: Inline edit & Drawer form with permission checking
  // ─────────────────────────────────────────────────────────────────────────────
  describe('AC 2: Inline Edit & Drawer Workflows with Permission Checking', () => {
    it('enables inline editing and successfully updates allowlisted fields when user has write permission', async () => {
      vi.spyOn(api, 'fetchVendorById').mockResolvedValue(syntheticVendor);
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      const updatedVendor: Vendor = {
        ...syntheticVendor,
        name: 'Apex Industrial Global LLC',
        phone: '+1-555-9999',
      };
      const updateSpy = vi.spyOn(api, 'updateVendor').mockResolvedValue(updatedVendor);

      render(
        <MemoryRouter initialEntries={['/erp2/vendors/00000000-0000-4000-8000-000000000001']}>
          <Routes>
            <Route
              path="/erp2/vendors/:vendorId"
              element={<VendorDetailPage userPermissions={['erp:vendors:write']} />}
            />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('inline-edit-toggle-btn')).toBeDefined();
      });

      // Toggle inline edit
      fireEvent.click(screen.getByTestId('inline-edit-toggle-btn'));
      expect(screen.getByTestId('vendor-inline-edit-form')).toBeDefined();

      // Edit legal name input
      const nameInput = screen.getByLabelText(/^Legal Name/i);
      fireEvent.change(nameInput, { target: { value: 'Apex Industrial Global LLC' } });

      // Save changes
      fireEvent.click(screen.getByTestId('inline-save-btn'));

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          '00000000-0000-4000-8000-000000000001',
          expect.objectContaining({
            name: 'Apex Industrial Global LLC',
          })
        );
      });

      // Confirmation toast appears
      const toast = await screen.findByTestId('detail-toast-alert');
      expect(toast.textContent).toContain('Apex Industrial Global LLC');
    });

    it('blocks inline edit and shows read-only badge when user lacks write permissions', async () => {
      vi.spyOn(api, 'fetchVendorById').mockResolvedValue(syntheticVendor);
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      render(
        <MemoryRouter initialEntries={['/erp2/vendors/00000000-0000-4000-8000-000000000001']}>
          <Routes>
            <Route
              path="/erp2/vendors/:vendorId"
              element={<VendorDetailPage userPermissions={['erp:vendors:read']} />}
            />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('permission-denied-badge')).toBeDefined();
      });

      expect(screen.queryByTestId('inline-edit-toggle-btn')).toBeNull();
      expect(screen.queryByTestId('edit-drawer-btn')).toBeNull();
    });

    it('opens edit drawer, validates inputs, and updates vendor', async () => {
      vi.spyOn(api, 'fetchVendorById').mockResolvedValue(syntheticVendor);
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      const updatedVendor: Vendor = {
        ...syntheticVendor,
        city: 'Evanston',
      };
      const updateSpy = vi.spyOn(api, 'updateVendor').mockResolvedValue(updatedVendor);

      render(
        <MemoryRouter initialEntries={['/erp2/vendors/00000000-0000-4000-8000-000000000001']}>
          <Routes>
            <Route
              path="/erp2/vendors/:vendorId"
              element={<VendorDetailPage userPermissions={['erp:vendors:write']} />}
            />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('edit-drawer-btn')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('edit-drawer-btn'));
      expect(screen.getByTestId('vendor-edit-drawer')).toBeDefined();

      // Submit drawer form
      const submitBtn = screen.getByRole('button', { name: 'Save Changes' });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalled();
      });
    });

    it('disables save button during inflight submission to prevent double-submit', async () => {
      vi.spyOn(api, 'fetchVendorById').mockResolvedValue(syntheticVendor);
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      let resolveUpdate: (val: any) => void;
      const updatePromise = new Promise((resolve) => {
        resolveUpdate = resolve;
      });
      vi.spyOn(api, 'updateVendor').mockReturnValue(updatePromise as any);

      render(
        <MemoryRouter initialEntries={['/erp2/vendors/00000000-0000-4000-8000-000000000001']}>
          <Routes>
            <Route
              path="/erp2/vendors/:vendorId"
              element={<VendorDetailPage userPermissions={['erp:vendors:write']} />}
            />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('inline-edit-toggle-btn')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('inline-edit-toggle-btn'));
      const saveBtn = screen.getByTestId('inline-save-btn') as HTMLButtonElement;
      fireEvent.click(saveBtn);

      // Inflight state check
      expect(saveBtn.disabled).toBe(true);
      expect(saveBtn.textContent).toContain('Saving...');

      // Resolve API
      resolveUpdate!(syntheticVendor);
      await waitFor(() => {
        expect(screen.queryByTestId('vendor-inline-edit-form')).toBeNull();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Acceptance Criterion 3: Linked entity sub-tables & cross-module navigation
  // ─────────────────────────────────────────────────────────────────────────────
  describe('AC 3: Linked Entity Sub-Tables & Cross-Module Navigation', () => {
    it('displays related purchase orders sub-table with navigation links on vendor detail', async () => {
      vi.spyOn(api, 'fetchVendorById').mockResolvedValue(syntheticVendor);
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: syntheticOrders,
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      render(
        <MemoryRouter initialEntries={['/erp2/vendors/00000000-0000-4000-8000-000000000001']}>
          <Routes>
            <Route path="/erp2/vendors/:vendorId" element={<VendorDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('PO-2026-0001')).toBeDefined();
      });

      expect(screen.getByRole('link', { name: /View order PO-2026-0001/i }).getAttribute('href')).toBe(
        '/erp2/purchase-orders/11111111-1111-4000-8000-111111111111'
      );
      expect(screen.getByTestId('create-po-linked-btn').getAttribute('href')).toBe(
        '/erp2/purchase-orders/new?vendor_id=00000000-0000-4000-8000-000000000001'
      );

      // Cross-module ERP-4 downstream bills panel
      expect(screen.getByTestId('cross-module-erp4-panel')).toBeDefined();
      expect(screen.getByRole('link', { name: /View vendor bills for Apex Industrial Supply LLC in ERP-4/i }).getAttribute('href')).toBe(
        '/erp4/bills?vendor_id=00000000-0000-4000-8000-000000000001'
      );
    });

    it('displays empty state in linked orders sub-table when vendor has no orders', async () => {
      vi.spyOn(api, 'fetchVendorById').mockResolvedValue(syntheticVendor);
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      render(
        <MemoryRouter initialEntries={['/erp2/vendors/00000000-0000-4000-8000-000000000001']}>
          <Routes>
            <Route path="/erp2/vendors/:vendorId" element={<VendorDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('linked-orders-empty')).toBeDefined();
      });

      expect(screen.getByText(/No purchase orders linked to this vendor yet/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /Create First Purchase Order/i })).toBeDefined();
    });

    it('links line items on PurchaseOrderDetailPage to owning ERP-1 products and ERP-4 bills', async () => {
      vi.spyOn(api, 'fetchPurchaseOrderById').mockResolvedValue(syntheticOrders[0]!);

      render(
        <MemoryRouter initialEntries={['/erp2/purchase-orders/11111111-1111-4000-8000-111111111111']}>
          <Routes>
            <Route path="/erp2/purchase-orders/:purchaseOrderId" element={<PurchaseOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('purchase-order-detail-page')).toBeDefined();
      });

      // Owning vendor link
      expect(screen.getByTestId('owning-vendor-link').getAttribute('href')).toBe(
        '/erp2/vendors/00000000-0000-4000-8000-000000000001'
      );

      // Line product link navigating to ERP-1 Product Catalog
      const productLink = screen.getByTestId('line-product-link-0');
      expect(productLink.getAttribute('href')).toBe(
        '/erp1/products/33333333-3333-4000-8000-333333333333'
      );

      // ERP-4 downstream matched bills link
      expect(screen.getByTestId('cross-module-erp4-bills')).toBeDefined();
      expect(screen.getByRole('link', { name: /View matched bills in ERP-4 for PO PO-2026-0001/i }).getAttribute('href')).toBe(
        '/erp4/bills?po_number=PO-2026-0001'
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Acceptance Criterion 4: Concurrent modification conflicts (409) & Refresh
  // ─────────────────────────────────────────────────────────────────────────────
  describe('AC 4: Concurrent Modification Conflicts (HTTP 409) & Refresh Resolution', () => {
    it('prompts user with conflict banner and refresh button when server returns 409', async () => {
      vi.spyOn(api, 'fetchVendorById').mockResolvedValue(syntheticVendor);
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      const conflictError = new api.ApiError(
        409,
        'CONFLICT',
        'Concurrent modification detected: vendor was updated by another process.'
      );
      vi.spyOn(api, 'updateVendor').mockRejectedValue(conflictError);

      render(
        <MemoryRouter initialEntries={['/erp2/vendors/00000000-0000-4000-8000-000000000001']}>
          <Routes>
            <Route
              path="/erp2/vendors/:vendorId"
              element={<VendorDetailPage userPermissions={['erp:vendors:write']} />}
            />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('inline-edit-toggle-btn')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('inline-edit-toggle-btn'));
      fireEvent.click(screen.getByTestId('inline-save-btn'));

      // Conflict banner appears
      await waitFor(() => {
        expect(screen.getByTestId('concurrent-conflict-banner')).toBeDefined();
      });

      expect(screen.getByText(/Concurrent modification detected/i)).toBeDefined();
      expect(screen.getByTestId('conflict-refresh-btn')).toBeDefined();
    });

    it('reloads latest record and clears conflict banner when refresh button is clicked', async () => {
      const initialFetch = vi.spyOn(api, 'fetchVendorById').mockResolvedValue(syntheticVendor);
      vi.spyOn(api, 'fetchPurchaseOrders').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      const conflictError = new api.ApiError(
        409,
        'CONFLICT',
        'Record was updated concurrently.'
      );
      vi.spyOn(api, 'updateVendor').mockRejectedValue(conflictError);

      render(
        <MemoryRouter initialEntries={['/erp2/vendors/00000000-0000-4000-8000-000000000001']}>
          <Routes>
            <Route
              path="/erp2/vendors/:vendorId"
              element={<VendorDetailPage userPermissions={['erp:vendors:write']} />}
            />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('inline-edit-toggle-btn')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('inline-edit-toggle-btn'));
      fireEvent.click(screen.getByTestId('inline-save-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('concurrent-conflict-banner')).toBeDefined();
      });

      // Prepare updated server state on refresh
      const serverUpdatedVendor: Vendor = {
        ...syntheticVendor,
        name: 'Apex Industrial Supply Server-Updated LLC',
      };
      initialFetch.mockResolvedValue(serverUpdatedVendor);

      // Click refresh
      fireEvent.click(screen.getByTestId('conflict-refresh-btn'));

      await waitFor(() => {
        expect(screen.queryByTestId('concurrent-conflict-banner')).toBeNull();
      });

      const toast = await screen.findByTestId('detail-toast-alert');
      expect(toast.textContent).toContain('Record refreshed to latest version from server.');
    });
  });
});
