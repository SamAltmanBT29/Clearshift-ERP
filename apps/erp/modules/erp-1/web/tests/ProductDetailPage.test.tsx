// @vitest-environment jsdom
/**
 * ERP-1 Products & Inventory — Product Detail & Edit Workflow Tests
 *
 * Acceptance test suite for Issue #117 (ERP1-21):
 * - Acceptance Criterion 1: Detail view displays all primary attributes, created_at, updated_at, and Golden ID where applicable.
 * - Acceptance Criterion 2: Inline edit or drawer form allows updating allowlisted fields with permission checking.
 * - Acceptance Criterion 3: Linked entity sub-tables display related master records with navigation links to owning modules.
 * - Acceptance Criterion 4: Concurrent modification conflicts (409) prompt user to refresh and re-apply changes.
 *
 * 100% synthetic mock test data adhering to ClearShift G3 constraints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { Category, Product, ProductLinkedRecords } from '@clearshift/contracts';
import { ProductDetailPage } from '../src/pages/ProductDetailPage.js';
import { ProductAuditPanel, resolveGoldenId } from '../src/components/ProductAuditPanel.js';
import { ProductLinkedRecordsTable } from '../src/components/ProductLinkedRecordsTable.js';
import { ProductEditDrawer } from '../src/components/ProductEditDrawer.js';
import * as api from '../src/api/erp-1.js';
import { Erp1ApiError } from '../src/api/erp-1.js';

const mockCategory: Category = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Mechanical Components',
  code: 'MECH',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

const syntheticProduct: Product = {
  id: '00000000-0000-4000-8000-000000000055',
  name: 'Heavy Duty Steel Bushing',
  sku: 'BSH-STL-055',
  normalizedSku: 'BSH-STL-055',
  categoryId: mockCategory.id,
  unitOfMeasure: 'pcs',
  price: '45.0000',
  currency: 'USD',
  taxRate: '5.00',
  notificationEmail: 'supplier@heavy-duty.internal',
  contactPhone: '+1-555-444-2222',
  sourceSystem: 'LEGACY-ERP',
  sourceId: 'SRC-9988',
  goldenId: 'GLD-LEGACY-SRC-9988',
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-23T14:30:00Z',
};

const syntheticLinkedRecords: ProductLinkedRecords = {
  productId: syntheticProduct.id,
  stockLevels: [
    {
      warehouseId: '00000000-0000-4000-8000-000000000010',
      warehouseCode: 'WH-01',
      warehouseName: 'Central Logistics Facility',
      quantity: '250.0000',
      unitOfMeasure: 'pcs',
      updatedAt: '2026-10-23T08:00:00Z',
    },
  ],
  purchaseOrders: [
    {
      id: '00000000-0000-4000-8000-000000000020',
      purchaseOrderId: '00000000-0000-4000-8000-000000000021',
      poNumber: 'PO-2026-0088',
      vendorName: 'Continental Steels Ltd.',
      orderDate: '2026-10-18',
      quantity: '400.0000',
      unitPrice: '38.5000',
      currency: 'USD',
      status: 'received',
    },
  ],
  salesOrders: [
    {
      id: '00000000-0000-4000-8000-000000000030',
      orderId: '00000000-0000-4000-8000-000000000031',
      orderNumber: 'SO-2026-1540',
      customerGoldenId: 'CUST-GLD-77001',
      orderDate: '2026-10-22',
      quantity: '50.0000',
      unitPrice: '45.0000',
      lineTotal: '2250.0000',
      currency: 'USD',
      status: 'invoiced',
    },
  ],
};

describe('ERP-1 ProductDetailPage & Workflow — Issue #117 (ERP1-21)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'fetchCategories').mockResolvedValue({
      items: [mockCategory],
      total: 1,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });
    vi.spyOn(api, 'fetchProductById').mockResolvedValue(syntheticProduct);
    vi.spyOn(api, 'fetchProductLinkedRecords').mockResolvedValue(syntheticLinkedRecords);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('1. Acceptance Criterion 1: Detail view displays primary attributes, created_at, updated_at, and Golden ID', () => {
    it('displays all primary attributes in the view grid', async () => {
      render(
        <ProductDetailPage
          productId={syntheticProduct.id}
          initialProduct={syntheticProduct}
          categories={[mockCategory]}
        />
      );

      // Verify Product Name and SKU in header
      expect(screen.getByRole('heading', { name: syntheticProduct.name })).toBeTruthy();
      expect(screen.getByTestId('detail-sku').textContent).toBe(syntheticProduct.sku);

      // Verify Primary Attributes
      expect(screen.getByTestId('attr-name').textContent).toBe(syntheticProduct.name);
      expect(screen.getByTestId('attr-sku').textContent).toBe(syntheticProduct.sku);
      expect(screen.getByTestId('attr-category').textContent).toContain(mockCategory.name);
      expect(screen.getByTestId('attr-unit').textContent).toBe('pcs');
      expect(screen.getByTestId('attr-price').textContent).toContain('$45.00 USD');
      expect(screen.getByTestId('attr-tax-rate').textContent).toBe('5.00%');
      expect(screen.getByTestId('attr-email').textContent).toBe('supplier@heavy-duty.internal');
      expect(screen.getByTestId('attr-phone').textContent).toBe('+1-555-444-2222');
    });

    it('renders audit metadata panel with created_at, updated_at, and Golden ID badge', async () => {
      render(
        <ProductDetailPage
          productId={syntheticProduct.id}
          initialProduct={syntheticProduct}
          categories={[mockCategory]}
        />
      );

      // Audit panel attributes
      expect(screen.getByTestId('audit-golden-id').textContent).toBe('GLD-LEGACY-SRC-9988');
      expect(screen.getByTestId('audit-normalized-sku').textContent).toBe(syntheticProduct.normalizedSku);
      expect(screen.getByTestId('audit-product-id').textContent).toBe(syntheticProduct.id);
      expect(screen.getByTestId('audit-created-at').getAttribute('title')).toBe(syntheticProduct.createdAt);
      expect(screen.getByTestId('audit-updated-at').getAttribute('title')).toBe(syntheticProduct.updatedAt);
      expect(screen.getByTestId('audit-source-link').textContent).toContain('LEGACY-ERP #SRC-9988');
    });

    it('generates deterministic Golden ID fallback when goldenId property is absent', () => {
      const prodWithoutGolden: Product = {
        ...syntheticProduct,
        goldenId: null,
        sourceSystem: null,
        sourceId: null,
      };
      const golden = resolveGoldenId(prodWithoutGolden);
      expect(golden).toBe(`GLD-PRD-${syntheticProduct.id.slice(0, 8).toUpperCase()}`);
    });
  });

  describe('2. Acceptance Criterion 2: Inline edit or drawer form allows updating allowlisted fields with permission checking', () => {
    it('toggles inline edit mode, keeps SKU immutable, and updates allowlisted attributes', async () => {
      const updateSpy = vi.spyOn(api, 'updateProduct').mockResolvedValue({
        ...syntheticProduct,
        name: 'Heavy Duty Steel Bushing V2',
        price: '49.9500',
        updatedAt: '2026-10-23T15:00:00Z',
      });

      const onUpdatedMock = vi.fn();

      render(
        <ProductDetailPage
          productId={syntheticProduct.id}
          initialProduct={syntheticProduct}
          categories={[mockCategory]}
          userPermissions={['inventory:write']}
          onProductUpdated={onUpdatedMock}
        />
      );

      // Click "Inline Edit" button
      const inlineBtn = screen.getByTestId('enable-inline-edit-btn');
      fireEvent.click(inlineBtn);

      // Form should be visible
      expect(screen.getByTestId('inline-edit-form')).toBeTruthy();

      // SKU input should be disabled and read-only
      const skuInput = screen.getByLabelText(/SKU \(Immutable Master Key\)/i) as HTMLInputElement;
      expect(skuInput.disabled).toBe(true);
      expect(skuInput.readOnly).toBe(true);

      // Modify Product Name and Price
      const nameInput = screen.getByLabelText(/Product Name/i);
      fireEvent.change(nameInput, { target: { value: 'Heavy Duty Steel Bushing V2' } });

      const priceInput = screen.getByLabelText(/Unit Price/i);
      fireEvent.change(priceInput, { target: { value: '49.95' } });

      // Submit inline form
      const saveBtn = screen.getByTestId('inline-save-btn');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          syntheticProduct.id,
          expect.objectContaining({
            name: 'Heavy Duty Steel Bushing V2',
            price: '49.95',
            unitOfMeasure: 'pcs',
            currency: 'USD',
          }),
          expect.objectContaining({
            version: syntheticProduct.updatedAt,
          })
        );
      });

      await waitFor(() => {
        expect(onUpdatedMock).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'Heavy Duty Steel Bushing V2' })
        );
        expect(screen.getByTestId('detail-toast-alert')).toBeTruthy();
      });
    });

    it('enforces permission checking: restricts editing when inventory:write capability is absent', async () => {
      render(
        <ProductDetailPage
          productId={syntheticProduct.id}
          initialProduct={syntheticProduct}
          userPermissions={['inventory:read']} // Missing inventory:write
        />
      );

      const inlineBtn = screen.getByTestId('enable-inline-edit-btn') as HTMLButtonElement;
      const drawerBtn = screen.getByTestId('open-edit-drawer-btn') as HTMLButtonElement;

      expect(inlineBtn.disabled).toBe(true);
      expect(drawerBtn.disabled).toBe(true);
    });

    it('opens Edit Drawer, performs field-level validation, and submits changes', async () => {
      const updateSpy = vi.spyOn(api, 'updateProduct').mockResolvedValue({
        ...syntheticProduct,
        taxRate: '8.50',
      });

      render(
        <ProductDetailPage
          productId={syntheticProduct.id}
          initialProduct={syntheticProduct}
          userPermissions={['inventory:write']}
        />
      );

      // Open drawer
      fireEvent.click(screen.getByTestId('open-edit-drawer-btn'));

      // Drawer dialog should be open
      expect(screen.getByRole('dialog', { name: /Edit Product:/i })).toBeTruthy();

      // Clear price to trigger validation
      const priceInput = screen.getByRole('dialog').querySelector('#edit-price') as HTMLInputElement;
      fireEvent.change(priceInput, { target: { value: '' } });

      // Try submitting empty price
      fireEvent.click(screen.getByTestId('drawer-save-btn'));

      await waitFor(() => {
        expect(screen.getByText('Price is required')).toBeTruthy();
      });

      // Correct price and submit
      fireEvent.change(priceInput, { target: { value: '45.00' } });
      const taxInput = screen.getByRole('dialog').querySelector('#edit-tax-rate') as HTMLInputElement;
      fireEvent.change(taxInput, { target: { value: '8.50' } });

      fireEvent.click(screen.getByTestId('drawer-save-btn'));

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          syntheticProduct.id,
          expect.objectContaining({
            price: '45.00',
            taxRate: '8.50',
          }),
          expect.anything()
        );
      });
    });

    it('disables save button during in-flight request to prevent double-submit', async () => {
      let resolveUpdate: (val: any) => void = () => {};
      const pendingPromise = new Promise((res) => {
        resolveUpdate = res;
      });
      vi.spyOn(api, 'updateProduct').mockReturnValue(pendingPromise as any);

      render(
        <ProductDetailPage
          productId={syntheticProduct.id}
          initialProduct={syntheticProduct}
          userPermissions={['inventory:write']}
        />
      );

      fireEvent.click(screen.getByTestId('enable-inline-edit-btn'));
      const saveBtn = screen.getByTestId('inline-save-btn') as HTMLButtonElement;

      fireEvent.click(saveBtn);

      // Button should be disabled and aria-busy
      expect(saveBtn.disabled).toBe(true);
      expect(saveBtn.getAttribute('aria-busy')).toBe('true');

      resolveUpdate(syntheticProduct);
    });
  });

  describe('3. Acceptance Criterion 3: Linked entity sub-tables display related master records with navigation links', () => {
    it('displays warehouse stock levels, ERP-2 purchase lines, and ERP-3 sales lines', async () => {
      render(
        <ProductDetailPage
          productId={syntheticProduct.id}
          initialProduct={syntheticProduct}
          categories={[mockCategory]}
        />
      );

      // Verify sub-tables exist
      await waitFor(() => {
        expect(screen.getByTestId('linked-stock-card')).toBeTruthy();
      });
      expect(screen.getByTestId('linked-purchasing-card')).toBeTruthy();
      expect(screen.getByTestId('linked-sales-card')).toBeTruthy();

      // Warehouse Stock row
      expect(screen.getByText('Central Logistics Facility')).toBeTruthy();
      expect(screen.getByText('WH-01')).toBeTruthy();

      // ERP-2 Purchase Order row
      expect(screen.getByText('PO-2026-0088 ↗')).toBeTruthy();
      expect(screen.getByText('Continental Steels Ltd.')).toBeTruthy();

      // ERP-3 Sales Order row
      expect(screen.getByText('SO-2026-1540 ↗')).toBeTruthy();
      expect(screen.getByText('CUST-GLD-77001')).toBeTruthy();
    });

    it('filters sub-tables when tabs are clicked', () => {
      render(
        <ProductLinkedRecordsTable
          linkedRecords={syntheticLinkedRecords}
          isLoading={false}
        />
      );

      // Click "ERP-2 Purchasing" tab
      fireEvent.click(screen.getByRole('tab', { name: /ERP-2 Purchasing/i }));
      expect(screen.queryByTestId('linked-stock-card')).toBeNull();
      expect(screen.getByTestId('linked-purchasing-card')).toBeTruthy();
      expect(screen.queryByTestId('linked-sales-card')).toBeNull();

      // Click "ERP-3 Sales" tab
      fireEvent.click(screen.getByRole('tab', { name: /ERP-3 Sales/i }));
      expect(screen.queryByTestId('linked-stock-card')).toBeNull();
      expect(screen.queryByTestId('linked-purchasing-card')).toBeNull();
      expect(screen.getByTestId('linked-sales-card')).toBeTruthy();
    });

    it('invokes onNavigateModule callback when a module link is clicked', () => {
      const navigateMock = vi.fn();

      render(
        <ProductLinkedRecordsTable
          linkedRecords={syntheticLinkedRecords}
          onNavigateModule={navigateMock}
        />
      );

      const poLink = screen.getByRole('link', { name: /View Purchase Order PO-2026-0088/i });
      fireEvent.click(poLink);

      expect(navigateMock).toHaveBeenCalledWith('erp2', '00000000-0000-4000-8000-000000000021');

      const soLink = screen.getByRole('link', { name: /View Sales Order SO-2026-1540/i });
      fireEvent.click(soLink);

      expect(navigateMock).toHaveBeenCalledWith('erp3', '00000000-0000-4000-8000-000000000031');
    });
  });

  describe('4. Acceptance Criterion 4: Concurrent modification conflicts (409) prompt user to refresh and re-apply changes', () => {
    it('surfaces 409 conflict alert banner and provides Refresh CTA when updateProduct fails with 409', async () => {
      vi.spyOn(api, 'updateProduct').mockRejectedValue(
        new Erp1ApiError(
          409,
          'CONFLICT',
          'Concurrent modification conflict: record was modified by another operator.'
        )
      );

      const refreshProductSpy = vi.spyOn(api, 'fetchProductById').mockResolvedValue({
        ...syntheticProduct,
        name: 'Refreshed Steel Bushing',
        price: '52.0000',
        updatedAt: '2026-10-23T16:00:00Z',
      });

      render(
        <ProductDetailPage
          productId={syntheticProduct.id}
          initialProduct={syntheticProduct}
          userPermissions={['inventory:write']}
        />
      );

      // Trigger inline edit & submit to get 409
      fireEvent.click(screen.getByTestId('enable-inline-edit-btn'));
      fireEvent.click(screen.getByTestId('inline-save-btn'));

      // Conflict banner should appear with 409 message
      await waitFor(() => {
        expect(screen.getByTestId('concurrent-conflict-banner')).toBeTruthy();
        expect(
          screen.getByText(/Concurrent Modification Conflict \(HTTP 409\)/i)
        ).toBeTruthy();
      });

      // Click "Refresh Record and Re-apply Changes" button
      const refreshBtn = screen.getByTestId('conflict-refresh-btn');
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        expect(refreshProductSpy).toHaveBeenCalled();
        expect(screen.queryByTestId('concurrent-conflict-banner')).toBeNull();
        expect(screen.getByText('Record refreshed to latest version from server.')).toBeTruthy();
      });
    });

    it('handles 409 in Edit Drawer form with refresh and re-apply CTA button', async () => {
      vi.spyOn(api, 'updateProduct').mockRejectedValue(
        new Erp1ApiError(
          409,
          'CONCURRENT_MODIFICATION',
          'This product was updated in another session.'
        )
      );

      const onRefreshMock = vi.fn();

      render(
        <ProductEditDrawer
          isOpen={true}
          product={syntheticProduct}
          categories={[mockCategory]}
          canEdit={true}
          onClose={vi.fn()}
          onProductUpdated={vi.fn()}
          onRefreshProduct={onRefreshMock}
        />
      );

      // Submit drawer form
      fireEvent.click(screen.getByTestId('drawer-save-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('drawer-conflict-alert')).toBeTruthy();
        expect(screen.getByText(/This product was updated in another session/i)).toBeTruthy();
      });

      // Click "Refresh and Re-apply Changes"
      const refreshBtn = screen.getByTestId('drawer-refresh-btn');
      fireEvent.click(refreshBtn);

      expect(onRefreshMock).toHaveBeenCalled();
    });
  });
});
