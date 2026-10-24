// @vitest-environment jsdom
/**
 * ERP-1 Products & Inventory — Create / Edit / Detail Workflow & Client-Side Validation Test Suite
 *
 * Exhaustively validates the human-operated workflow for Issue #10 (ERP1-05):
 *   - AC-1: Every V1 screen listed exists and links back to its list context
 *   - AC-2: Valid inputs save through the API and the updated record is visible
 *   - AC-3: Invalid input shows a field-level message and does not submit or mutate data
 *   - AC-4: API validation errors are presented without losing unrelated form values
 *   - AC-5: Read-only fields, masked values, computed fields and status transitions cannot be bypassed
 *
 * @module erp1/web/tests/workflow-forms.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ProductsListPage } from '../src/pages/ProductsListPage.js';
import { ProductDetailPage } from '../src/pages/ProductDetailPage.js';
import { ProductCreateModal } from '../src/components/ProductCreateModal.js';
import { ProductEditDrawer } from '../src/components/ProductEditDrawer.js';
import * as api from '../src/api/erp-1.js';
import { Erp1ApiError } from '../src/api/erp-1.js';
import type { Product, Category, ProductLinkedRecords } from '@clearshift/contracts';

const mockCategory: Category = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Hydraulics',
  code: 'HYD',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

const mockProduct: Product = {
  id: '00000000-0000-4000-a000-000000000010',
  name: 'Hydraulic Piston Pump H50',
  sku: 'PMP-HYD-050',
  normalizedSku: 'PMP-HYD-050',
  categoryId: mockCategory.id,
  unitOfMeasure: 'pcs',
  price: '450.0000',
  currency: 'USD',
  taxRate: '5.00',
  notificationEmail: 'supplier@hydraulics.test',
  contactPhone: '+1-555-019-2834',
  sourceSystem: 'SAP-PROD',
  sourceId: '10042',
  goldenId: 'GLD-SAP-10042',
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-23T14:30:00Z',
};

const mockLinkedRecords: ProductLinkedRecords = {
  productId: mockProduct.id,
  stockLevels: [
    {
      warehouseId: '00000000-0000-4000-8000-000000000002',
      warehouseCode: 'WH-01',
      warehouseName: 'Main Warehouse',
      quantity: '85.0000',
      unitOfMeasure: 'pcs',
      updatedAt: '2026-10-23T12:00:00Z',
    },
  ],
  purchaseOrders: [
    {
      id: '00000000-0000-4000-8000-000000000088',
      purchaseOrderId: '00000000-0000-4000-8000-000000000089',
      poNumber: 'PO-2026-0042',
      vendorName: 'Continental Hydraulics GmbH',
      orderDate: '2026-10-15T09:00:00Z',
      quantity: '50.0000',
      unitPrice: '380.0000',
      currency: 'USD',
      status: 'RECEIVED',
    },
  ],
  salesOrders: [
    {
      id: '00000000-0000-4000-8000-000000000099',
      orderId: '00000000-0000-4000-8000-000000000100',
      orderNumber: 'SO-2026-0101',
      customerGoldenId: 'GLD-CUST-881',
      orderDate: '2026-10-18T14:00:00Z',
      quantity: '5.0000',
      unitPrice: '450.0000',
      lineTotal: '2250.0000',
      currency: 'USD',
      status: 'CONFIRMED',
    },
  ],
};

describe('[ERP1-05] ERP-1 Products and Inventory: Create/edit/detail workflow and client-side validation (#10)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(api, 'fetchCategories').mockResolvedValue({
      items: [mockCategory],
      total: 1,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    vi.spyOn(api, 'fetchProducts').mockResolvedValue({
      items: [mockProduct],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });

    vi.spyOn(api, 'fetchProductById').mockResolvedValue(mockProduct);
    vi.spyOn(api, 'fetchProductLinkedRecords').mockResolvedValue(mockLinkedRecords);

    if (typeof window !== 'undefined' && window.history) {
      window.history.replaceState(null, '', '/');
    }
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── AC-1: Screen Navigation and Context Return ──────────────────────────────
  describe('AC-1: Every V1 screen exists and links back to its list context', () => {
    it('navigates from ProductsListPage to ProductDetailPage on clicking a row and returns via Back button', async () => {
      render(<ProductsListPage />);

      const productLink = await screen.findByRole('button', {
        name: `View details for ${mockProduct.name}`,
      });
      expect(productLink).toBeDefined();

      // Click row to enter detail page
      fireEvent.click(productLink);

      // Detail page is mounted
      expect(await screen.findByRole('heading', { name: mockProduct.name })).toBeDefined();
      expect(screen.getByTestId('detail-sku').textContent).toBe(mockProduct.sku);
      expect(screen.getByText(mockProduct.goldenId!)).toBeDefined();

      // Click Back to return to List Page
      const backBtn = screen.getByRole('button', { name: /Back to Products/i });
      fireEvent.click(backBtn);

      // Returned to list page
      await waitFor(() => {
        expect(screen.getByText('Products & Inventory')).toBeDefined();
      });
    });

    it('opens ProductCreateModal on "+ New Product" and closes back to list context on Cancel', async () => {
      render(<ProductsListPage />);
      await screen.findByText(mockProduct.name);

      const addBtn = screen.getByRole('button', { name: '+ New Product' });
      fireEvent.click(addBtn);

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toBeDefined();

      const cancelBtn = within(dialog).getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    });
  });

  // ── AC-2: Valid Inputs Save Through API & Record Is Visible ────────────────
  describe('AC-2: Valid inputs save through API and update record in view', () => {
    it('creates product through API, closes modal, and prepends to table cache with confirmation toast', async () => {
      const createdProduct: Product = {
        id: '00000000-0000-4000-b000-000000000099',
        name: 'Electric Servo Actuator',
        sku: 'ACT-SRV-01',
        normalizedSku: 'ACT-SRV-01',
        categoryId: mockCategory.id,
        unitOfMeasure: 'pcs',
        price: '280.0000',
        currency: 'USD',
        taxRate: '5.00',
        sourceSystem: null,
        sourceId: null,
        createdAt: '2026-10-24T00:00:00Z',
        updatedAt: '2026-10-24T00:00:00Z',
      };

      const createSpy = vi.spyOn(api, 'createProduct').mockResolvedValue(createdProduct);

      render(<ProductsListPage />);
      await screen.findByText(mockProduct.name);

      fireEvent.click(screen.getByRole('button', { name: '+ New Product' }));
      const dialog = await screen.findByRole('dialog');

      // Fill in required fields scoped to the modal dialog
      fireEvent.change(within(dialog).getByLabelText(/Product Name/i), {
        target: { value: 'Electric Servo Actuator' },
      });
      fireEvent.change(within(dialog).getByLabelText(/Stock Keeping Unit/i), {
        target: { value: 'ACT-SRV-01' },
      });
      fireEvent.change(within(dialog).getByLabelText(/Unit of Measure/i), {
        target: { value: 'pcs' },
      });
      fireEvent.change(within(dialog).getByLabelText(/Unit Price/i), {
        target: { value: '280.00' },
      });
      fireEvent.change(within(dialog).getByLabelText(/Currency/i), {
        target: { value: 'USD' },
      });

      // Submit form
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Electric Servo Actuator',
            sku: 'ACT-SRV-01',
            unitOfMeasure: 'pcs',
            price: '280.00',
            currency: 'USD',
          })
        );
      });

      // Modal is closed and newly created item is rendered in the list
      await waitFor(() => {
        expect(screen.getByText('Electric Servo Actuator')).toBeDefined();
        expect(screen.getByText(/created successfully/i)).toBeDefined();
      });
    });

    it('updates product attributes through edit drawer and displays updated values', async () => {
      const updatedProduct: Product = {
        ...mockProduct,
        name: 'Hydraulic Piston Pump H50-Pro',
        price: '495.0000',
      };

      const updateSpy = vi.spyOn(api, 'updateProduct').mockResolvedValue(updatedProduct);

      render(
        <ProductDetailPage
          productId={mockProduct.id}
          initialProduct={mockProduct}
          categories={[mockCategory]}
          userPermissions={['inventory:write']}
        />
      );

      await screen.findByRole('heading', { name: mockProduct.name });

      // Open Edit Drawer
      fireEvent.click(screen.getByTestId('open-edit-drawer-btn'));
      const dialog = await screen.findByRole('dialog', { name: /Edit Product:/i });

      // Update name and price
      const nameInput = dialog.querySelector('#edit-product-name') as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'Hydraulic Piston Pump H50-Pro' } });

      const priceInput = dialog.querySelector('#edit-price') as HTMLInputElement;
      fireEvent.change(priceInput, { target: { value: '495.00' } });

      // Save changes
      fireEvent.click(within(dialog).getByTestId('drawer-save-btn'));

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          mockProduct.id,
          expect.objectContaining({
            name: 'Hydraulic Piston Pump H50-Pro',
            price: '495.00',
          }),
          expect.any(Object)
        );
      });

      // Updated product name is visible in detail view
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Hydraulic Piston Pump H50-Pro' })).toBeDefined();
        expect(screen.getByTestId('detail-toast-alert')).toBeDefined();
      });
    });
  });

  // ── AC-3: Invalid Input Shows Field-Level Errors & Blocks Mutation ─────────
  describe('AC-3: Invalid input shows field-level message and does not submit data', () => {
    it('validates empty required fields, marks aria-invalid="true", and prevents createProduct API call', async () => {
      const createSpy = vi.spyOn(api, 'createProduct');

      render(
        <ProductCreateModal
          isOpen={true}
          categories={[mockCategory]}
          onClose={vi.fn()}
        />
      );

      // Submit immediately with empty inputs
      const submitBtn = screen.getByRole('button', { name: 'Create Product' });
      fireEvent.click(submitBtn);

      // Field error messages rendered
      await waitFor(() => {
        expect(screen.getByText('Product name is required')).toBeDefined();
        expect(screen.getByText('SKU is required')).toBeDefined();
      });

      // API was NOT called
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects negative price and invalid currency code with field-level errors', async () => {
      const createSpy = vi.spyOn(api, 'createProduct');

      render(
        <ProductCreateModal
          isOpen={true}
          categories={[mockCategory]}
          onClose={vi.fn()}
        />
      );

      fireEvent.change(screen.getByLabelText(/Product Name/i), { target: { value: 'Valve' } });
      fireEvent.change(screen.getByLabelText(/Stock Keeping Unit/i), { target: { value: 'VLV-01' } });
      fireEvent.change(screen.getByLabelText(/Unit Price/i), { target: { value: '-15.00' } });
      fireEvent.change(screen.getByLabelText(/Currency/i), { target: { value: 'US' } }); // only 2 chars

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(screen.getByText('Price must be greater than or equal to 0')).toBeDefined();
        expect(screen.getByText(/Currency must be an uppercase 3-letter ISO 4217 code/i)).toBeDefined();
      });

      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  // ── AC-4: API Validation Errors Preserved Without Losing Other Fields ──────
  describe('AC-4: Server validation errors (400) presented without wiping unrelated form inputs', () => {
    it('displays server field error while preserving all operator-entered values in form', async () => {
      vi.spyOn(api, 'createProduct').mockRejectedValue(
        new Erp1ApiError(400, 'VALIDATION_ERROR', 'Validation failed', [
          { field: 'price', message: 'Price cannot exceed allowable margin threshold' },
        ])
      );

      render(
        <ProductCreateModal
          isOpen={true}
          categories={[mockCategory]}
          onClose={vi.fn()}
        />
      );

      fireEvent.change(screen.getByLabelText(/Product Name/i), {
        target: { value: 'Custom High-Pressure Flange' },
      });
      fireEvent.change(screen.getByLabelText(/Stock Keeping Unit/i), {
        target: { value: 'FLG-HP-999' },
      });
      fireEvent.change(screen.getByLabelText(/Unit Price/i), {
        target: { value: '9999.00' },
      });
      fireEvent.change(screen.getByLabelText(/Currency/i), {
        target: { value: 'USD' },
      });
      fireEvent.change(screen.getByLabelText(/Notification Email/i), {
        target: { value: 'alerts@factory.test' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      // Server error mapped to price field
      const priceError = await screen.findByText('Price cannot exceed allowable margin threshold');
      expect(priceError).toBeDefined();

      // Invariant: Unrelated fields must retain operator values without loss
      expect(
        (screen.getByLabelText(/Product Name/i) as HTMLInputElement).value
      ).toBe('Custom High-Pressure Flange');
      expect(
        (screen.getByLabelText(/Stock Keeping Unit/i) as HTMLInputElement).value
      ).toBe('FLG-HP-999');
      expect(
        (screen.getByLabelText(/Currency/i) as HTMLInputElement).value
      ).toBe('USD');
      expect(
        (screen.getByLabelText(/Notification Email/i) as HTMLInputElement).value
      ).toBe('alerts@factory.test');
    });
  });

  // ── AC-5: Protected Fields, Computed Statuses & Conflict Recovery ──────────
  describe('AC-5: Read-only protected fields, derived statuses, and concurrent conflict recovery', () => {
    it('disallows modifying SKU in edit workflow (strictly read-only and immutable)', async () => {
      render(
        <ProductEditDrawer
          isOpen={true}
          product={mockProduct}
          categories={[mockCategory]}
          onClose={vi.fn()}
          onProductUpdated={vi.fn()}
        />
      );

      // SKU input is disabled / read-only in edit drawer
      const skuInput = screen.getByDisplayValue(mockProduct.sku) as HTMLInputElement;
      expect(skuInput.disabled).toBe(true);
      expect(screen.getByText(/Immutable Master Key/i)).toBeDefined();
    });

    it('surfaces concurrent modification conflict banner (HTTP 409) and provides Refresh CTA', async () => {
      vi.spyOn(api, 'updateProduct').mockRejectedValue(
        new Erp1ApiError(
          409,
          'CONFLICT',
          'Record was modified by another operator. Please refresh before saving.'
        )
      );

      render(
        <ProductDetailPage
          productId={mockProduct.id}
          initialProduct={mockProduct}
          categories={[mockCategory]}
          userPermissions={['inventory:write']}
        />
      );

      await screen.findByRole('heading', { name: mockProduct.name });

      // Enable inline editing
      fireEvent.click(screen.getByTestId('enable-inline-edit-btn'));
      expect(screen.getByTestId('inline-edit-form')).toBeDefined();

      // Submit inline form triggering 409
      fireEvent.click(screen.getByTestId('inline-save-btn'));

      // Conflict alert banner displayed
      const conflictBanner = await screen.findByTestId('concurrent-conflict-banner');
      expect(conflictBanner).toBeDefined();
      expect(within(conflictBanner).getByText(/Concurrent Modification Conflict/i)).toBeDefined();

      // Refresh CTA available to reload latest server state
      const refreshBtn = screen.getByTestId('conflict-refresh-btn');
      expect(refreshBtn).toBeDefined();
    });

    it('renders server-computed stock status and linked sub-records in detail view', async () => {
      render(
        <ProductDetailPage
          productId={mockProduct.id}
          initialProduct={mockProduct}
          categories={[mockCategory]}
          userPermissions={['inventory:read']}
        />
      );

      await screen.findByRole('heading', { name: mockProduct.name });

      // Stock status badge
      expect(await screen.findByText('In Stock (85)')).toBeDefined();

      // Linked inventory stock level sub-table
      expect(await screen.findByText('Main Warehouse')).toBeDefined();
      expect(screen.getByText('85.00')).toBeDefined();

      // Linked purchasing lines
      const poTab = screen.getByRole('tab', { name: /ERP-2 Purchasing/i });
      fireEvent.click(poTab);
      expect(await screen.findByText(/PO-2026-0042/)).toBeDefined();
      expect(screen.getByText('Continental Hydraulics GmbH')).toBeDefined();

      // Linked sales lines
      const soTab = screen.getByRole('tab', { name: /ERP-3 Sales/i });
      fireEvent.click(soTab);
      expect(await screen.findByText(/SO-2026-0101/)).toBeDefined();
      expect(screen.getByText('GLD-CUST-881')).toBeDefined();
    });
  });
});
