// @vitest-environment jsdom
/**
 * ERP-1 Products & Inventory — Product Creation Modal Tests
 *
 * Acceptance test suite for Issue #116 (ERP1-20):
 * - Acceptance Criterion 1: Form validates required fields, email format, phone numbers, and decimal ranges before submission.
 * - Acceptance Criterion 2: Client submission button disables during inflight request to prevent double-submit.
 * - Acceptance Criterion 3: Server validation errors (400) map directly to corresponding input fields with error text.
 * - Acceptance Criterion 4: Successful submission closes modal, updates table cache, and shows confirmation toast.
 *
 * All test data is 100% synthetic in compliance with ClearShift G3 constraints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { Category, Product, CreateProductInput } from '@clearshift/contracts';
import { ProductCreateModal } from '../src/components/ProductCreateModal.js';
import { ProductsListPage } from '../src/pages/ProductsListPage.js';
import * as api from '../src/api/erp-1.js';
import { Erp1ApiError } from '../src/api/erp-1.js';

const mockCategory: Category = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Mechanical Components',
  code: 'MECH',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

const syntheticCreatedProduct: Product = {
  id: '00000000-0000-4000-b000-000000000099',
  name: 'Titanium Fastener M6',
  sku: 'FST-TITAN-006',
  normalizedSku: 'FST-TITAN-006',
  categoryId: mockCategory.id,
  unitOfMeasure: 'pcs',
  price: '12.5000',
  currency: 'USD',
  taxRate: '5.00',
  sourceSystem: null,
  sourceId: null,
  createdAt: '2026-10-23T12:00:00Z',
  updatedAt: '2026-10-23T12:00:00Z',
};

describe('ERP-1 ProductCreateModal — Issue #116 (ERP1-20)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('1. Acceptance Criterion 1: Form validates required fields, email format, phone numbers, and decimal ranges before submission', () => {
    it('validates all required fields when submitting an empty form and prevents submission', async () => {
      const mockSubmit = vi.fn();
      const mockClose = vi.fn();

      render(
        <ProductCreateModal
          isOpen={true}
          onClose={mockClose}
          categories={[mockCategory]}
          onSubmitProduct={mockSubmit}
        />
      );

      // Verify modal header is visible
      expect(screen.getByText('Create New Product')).toBeDefined();

      // Submit empty form
      const submitBtn = screen.getByRole('button', { name: 'Create Product' });
      fireEvent.click(submitBtn);

      // Verify required field error messages are displayed with role="alert"
      await waitFor(() => {
        expect(screen.getByText('Product name is required')).toBeDefined();
        expect(screen.getByText('SKU is required')).toBeDefined();
        expect(screen.getByText('Price is required')).toBeDefined();
      });

      // Confirm no API call was dispatched
      expect(mockSubmit).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
    });

    it('validates decimal range for unit price (rejects negative and invalid numbers)', async () => {
      const mockSubmit = vi.fn();

      render(
        <ProductCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitProduct={mockSubmit}
        />
      );

      // Fill in valid name & SKU
      fireEvent.change(screen.getByLabelText(/Product Name/i), {
        target: { value: 'Valid Product Name' },
      });
      fireEvent.change(screen.getByLabelText(/SKU/i), {
        target: { value: 'VAL-PRD-001' },
      });

      // Enter negative price
      fireEvent.change(screen.getByLabelText(/Unit Price/i), {
        target: { value: '-25.50' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(
          screen.getByText('Price must be greater than or equal to 0')
        ).toBeDefined();
      });
      expect(mockSubmit).not.toHaveBeenCalled();

      // Enter non-numeric string
      fireEvent.change(screen.getByLabelText(/Unit Price/i), {
        target: { value: 'invalid-price' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(
          screen.getByText(
            'Price must be a valid non-negative decimal with up to 4 decimal places'
          )
        ).toBeDefined();
      });
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('validates tax rate decimal range (must be between 0.00% and 100.00%)', async () => {
      const mockSubmit = vi.fn();

      render(
        <ProductCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitProduct={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Product Name/i), {
        target: { value: 'Valid Product' },
      });
      fireEvent.change(screen.getByLabelText(/SKU/i), {
        target: { value: 'VAL-001' },
      });
      fireEvent.change(screen.getByLabelText(/Unit Price/i), {
        target: { value: '10.00' },
      });

      // Enter out-of-range tax rate > 100
      fireEvent.change(screen.getByLabelText(/Tax Rate/i), {
        target: { value: '105.00' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(
          screen.getByText('Tax rate must be between 0.00% and 100.00%')
        ).toBeDefined();
      });
      expect(mockSubmit).not.toHaveBeenCalled();

      // Enter negative tax rate
      fireEvent.change(screen.getByLabelText(/Tax Rate/i), {
        target: { value: '-5.00' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(
          screen.getByText(
            'Tax rate must be a valid decimal percentage with up to 2 decimal places'
          )
        ).toBeDefined();
      });
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('validates email format before submission when notification email is provided', async () => {
      const mockSubmit = vi.fn();

      render(
        <ProductCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitProduct={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Product Name/i), {
        target: { value: 'Valid Product' },
      });
      fireEvent.change(screen.getByLabelText(/SKU/i), {
        target: { value: 'VAL-001' },
      });
      fireEvent.change(screen.getByLabelText(/Unit Price/i), {
        target: { value: '10.00' },
      });

      // Enter malformed email
      fireEvent.change(screen.getByLabelText(/Notification Email/i), {
        target: { value: 'not-a-valid-email' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(
          screen.getByText(/Invalid email address format/i)
        ).toBeDefined();
      });
      expect(mockSubmit).not.toHaveBeenCalled();

      // Fix email format
      fireEvent.change(screen.getByLabelText(/Notification Email/i), {
        target: { value: 'procurement@clearshift.synthetic' },
      });

      mockSubmit.mockResolvedValueOnce(syntheticCreatedProduct);
      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });
    });

    it('validates phone numbers format before submission when contact phone is provided', async () => {
      const mockSubmit = vi.fn();

      render(
        <ProductCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitProduct={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Product Name/i), {
        target: { value: 'Valid Product' },
      });
      fireEvent.change(screen.getByLabelText(/SKU/i), {
        target: { value: 'VAL-001' },
      });
      fireEvent.change(screen.getByLabelText(/Unit Price/i), {
        target: { value: '10.00' },
      });

      // Enter invalid phone (too short or letters)
      fireEvent.change(screen.getByLabelText(/Contact Phone/i), {
        target: { value: '123' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(
          screen.getByText(/Invalid phone number format/i)
        ).toBeDefined();
      });
      expect(mockSubmit).not.toHaveBeenCalled();

      // Fix phone number to valid international format
      fireEvent.change(screen.getByLabelText(/Contact Phone/i), {
        target: { value: '+1-555-019-2834' },
      });

      mockSubmit.mockResolvedValueOnce(syntheticCreatedProduct);
      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });
    });

    it('validates currency code format (uppercase 3-letter ISO code)', async () => {
      const mockSubmit = vi.fn();

      render(
        <ProductCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitProduct={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Product Name/i), {
        target: { value: 'Valid Product' },
      });
      fireEvent.change(screen.getByLabelText(/SKU/i), {
        target: { value: 'VAL-001' },
      });
      fireEvent.change(screen.getByLabelText(/Unit Price/i), {
        target: { value: '10.00' },
      });
      fireEvent.change(screen.getByLabelText(/Currency/i), {
        target: { value: 'US' }, // only 2 letters
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(
          screen.getByText(/Currency must be an uppercase 3-letter ISO 4217 code/i)
        ).toBeDefined();
      });
      expect(mockSubmit).not.toHaveBeenCalled();
    });
  });

  describe('2. Acceptance Criterion 2: Client submission button disables during inflight request to prevent double-submit', () => {
    it('disables submit button and shows busy indicator during in-flight submission', async () => {
      let resolvePromise!: (val: Product) => void;
      const deferredPromise = new Promise<Product>((resolve) => {
        resolvePromise = resolve;
      });

      const mockSubmit = vi.fn().mockImplementation(() => deferredPromise);

      render(
        <ProductCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitProduct={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Product Name/i), {
        target: { value: 'Titanium Fastener M6' },
      });
      fireEvent.change(screen.getByLabelText(/SKU/i), {
        target: { value: 'FST-TITAN-006' },
      });
      fireEvent.change(screen.getByLabelText(/Unit Price/i), {
        target: { value: '12.5000' },
      });

      const submitBtn = screen.getByRole('button', { name: 'Create Product' }) as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(false);

      // Trigger first submission
      fireEvent.click(submitBtn);

      // Verify button is now disabled, has aria-busy="true", and displays "Creating..."
      await waitFor(() => {
        expect(submitBtn.disabled).toBe(true);
        expect(submitBtn.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText('Creating...')).toBeDefined();
      });

      // Attempt double-click during inflight request
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);

      // Confirm mockSubmit was only invoked once
      expect(mockSubmit).toHaveBeenCalledTimes(1);

      // Resolve the in-flight promise
      resolvePromise(syntheticCreatedProduct);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('3. Acceptance Criterion 3: Server validation errors (400) map directly to corresponding input fields with error text', () => {
    it('maps server 400 validation error details directly to corresponding form fields', async () => {
      const server400Error = new Erp1ApiError(
        400,
        'VALIDATION_ERROR',
        'Payload failed domain validation',
        [
          { field: 'sku', message: 'SKU "FST-TITAN-006" already exists in catalog' },
          { field: 'price', message: 'Price cannot exceed ceiling threshold' },
        ],
        'corr-400-test'
      );

      const mockSubmit = vi.fn().mockRejectedValue(server400Error);

      render(
        <ProductCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitProduct={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Product Name/i), {
        target: { value: 'Titanium Fastener M6' },
      });
      fireEvent.change(screen.getByLabelText(/SKU/i), {
        target: { value: 'FST-TITAN-006' },
      });
      fireEvent.change(screen.getByLabelText(/Unit Price/i), {
        target: { value: '12.5000' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      // Verify field-level server error mapping on SKU field
      await waitFor(() => {
        expect(
          screen.getByText('SKU "FST-TITAN-006" already exists in catalog')
        ).toBeDefined();
      });

      // Verify field-level server error mapping on Price field
      expect(
        screen.getByText('Price cannot exceed ceiling threshold')
      ).toBeDefined();

      // Verify top-level alert is also displayed with message and correlation ID
      expect(screen.getByText('Payload failed domain validation')).toBeDefined();
      expect(screen.getByText('corr-400-test')).toBeDefined();

      // Verify inputs have aria-invalid="true"
      const skuInput = screen.getByLabelText(/SKU/i);
      expect(skuInput.getAttribute('aria-invalid')).toBe('true');

      // Verify operator inputs were preserved
      expect((skuInput as HTMLInputElement).value).toBe('FST-TITAN-006');
    });

    it('maps snake_case server field names (e.g. unit_of_measure, tax_rate) to form controls', async () => {
      const serverSnakeCaseError = new Erp1ApiError(
        400,
        'VALIDATION_ERROR',
        'Validation failed on snake_case fields',
        [
          { field: 'unit_of_measure', message: 'Unit of measure not permitted for this product type' },
          { field: 'tax_rate', message: 'Tax rate must not exceed jurisdiction limit' },
        ]
      );

      const mockSubmit = vi.fn().mockRejectedValue(serverSnakeCaseError);

      render(
        <ProductCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitProduct={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Product Name/i), {
        target: { value: 'Titanium Fastener M6' },
      });
      fireEvent.change(screen.getByLabelText(/SKU/i), {
        target: { value: 'FST-TITAN-006' },
      });
      fireEvent.change(screen.getByLabelText(/Unit Price/i), {
        target: { value: '12.5000' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(
          screen.getByText('Unit of measure not permitted for this product type')
        ).toBeDefined();
        expect(
          screen.getByText('Tax rate must not exceed jurisdiction limit')
        ).toBeDefined();
      });
    });

    it('maps HTTP 409 duplicate SKU conflict error to the SKU input field', async () => {
      const server409Error = new Erp1ApiError(
        409,
        'DUPLICATE_SKU',
        'Duplicate SKU conflict: SKU already registered to another product'
      );

      const mockSubmit = vi.fn().mockRejectedValue(server409Error);

      render(
        <ProductCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitProduct={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/^Product Name/i), {
        target: { value: 'Titanium Fastener M6' },
      });
      fireEvent.change(screen.getByLabelText(/^SKU/i), {
        target: { value: 'FST-TITAN-006' },
      });
      fireEvent.change(screen.getByLabelText(/^Unit Price/i), {
        target: { value: '12.5000' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        const skuError = document.getElementById('product-sku-error');
        expect(skuError).not.toBeNull();
        expect(skuError?.textContent).toContain('Duplicate SKU conflict');
      });
    });
  });

  describe('4. Acceptance Criterion 4: Successful submission closes modal, updates table cache, and shows confirmation toast', () => {
    it('closes modal and calls onProductCreated when submitted standalone', async () => {
      const mockSubmit = vi.fn().mockResolvedValue(syntheticCreatedProduct);
      const mockClose = vi.fn();
      const mockOnProductCreated = vi.fn();

      render(
        <ProductCreateModal
          isOpen={true}
          onClose={mockClose}
          categories={[mockCategory]}
          onSubmitProduct={mockSubmit}
          onProductCreated={mockOnProductCreated}
        />
      );

      fireEvent.change(screen.getByLabelText(/Product Name/i), {
        target: { value: 'Titanium Fastener M6' },
      });
      fireEvent.change(screen.getByLabelText(/SKU/i), {
        target: { value: 'FST-TITAN-006' },
      });
      fireEvent.change(screen.getByLabelText(/Unit Price/i), {
        target: { value: '12.5000' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
        expect(mockOnProductCreated).toHaveBeenCalledWith(syntheticCreatedProduct);
        expect(mockClose).toHaveBeenCalledTimes(1);
      });
    });

    it('integrates with ProductsListPage: opens modal via toolbar, submits, closes modal, updates table cache, and shows confirmation toast', async () => {
      // Mock initial API queries
      vi.spyOn(api, 'fetchCategories').mockResolvedValue({
        items: [mockCategory],
        total: 1,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      });

      const initialProduct: Product = {
        id: '00000000-0000-4000-a000-000000000001',
        name: 'Existing Hex Bolt',
        sku: 'HEX-001',
        normalizedSku: 'HEX-001',
        categoryId: mockCategory.id,
        unitOfMeasure: 'box',
        price: '45.0000',
        currency: 'USD',
        taxRate: '5.00',
        sourceSystem: null,
        sourceId: null,
        createdAt: '2026-10-23T00:00:00Z',
        updatedAt: '2026-10-23T00:00:00Z',
      };

      vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [initialProduct],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      const createSpy = vi.spyOn(api, 'createProduct').mockResolvedValue(syntheticCreatedProduct);

      render(<ProductsListPage />);

      // Wait for table to load
      await waitFor(() => {
        expect(screen.getByText('Existing Hex Bolt')).toBeDefined();
      });

      // 1. Click "+ New Product" button in toolbar
      const newProductBtn = screen.getByRole('button', { name: /New Product/i });
      fireEvent.click(newProductBtn);

      // Verify modal opened
      expect(await screen.findByText('Create New Product')).toBeDefined();

      // 2. Fill in form values
      fireEvent.change(screen.getByLabelText(/^Product Name/i), {
        target: { value: 'Titanium Fastener M6' },
      });
      fireEvent.change(screen.getByLabelText(/^SKU/i), {
        target: { value: 'FST-TITAN-006' },
      });
      fireEvent.change(screen.getByLabelText(/^Unit Price/i), {
        target: { value: '12.5000' },
      });
      fireEvent.change(screen.getByLabelText(/^Currency/i), {
        target: { value: 'USD' },
      });

      // 3. Submit form
      const submitBtn = screen.getByRole('button', { name: 'Create Product' });
      fireEvent.click(submitBtn);

      // 4. Verify API was called
      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledTimes(1);
      });

      // 5. Verify modal closed
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      // 6. Verify table cache was updated with the new product
      await waitFor(() => {
        expect(screen.getByText('Titanium Fastener M6')).toBeDefined();
        expect(screen.getByText('FST-TITAN-006')).toBeDefined();
      });

      // 7. Verify confirmation toast is displayed with success message
      await waitFor(() => {
        expect(
          screen.getByText(
            'Product "Titanium Fastener M6" (FST-TITAN-006) created successfully.'
          )
        ).toBeDefined();
      });

      // 8. Verify toast can be dismissed
      const dismissBtn = screen.getByRole('button', { name: /Dismiss alert/i });
      fireEvent.click(dismissBtn);

      await waitFor(() => {
        expect(
          screen.queryByText(
            'Product "Titanium Fastener M6" (FST-TITAN-006) created successfully.'
          )
        ).toBeNull();
      });
    });

    it('can open create modal from zero-data empty state CTA button', async () => {
      vi.spyOn(api, 'fetchCategories').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
        totalPages: 0,
      });

      vi.spyOn(api, 'fetchProducts').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 0,
      });

      render(<ProductsListPage />);

      await waitFor(() => {
        expect(screen.getByText('No products in inventory')).toBeDefined();
      });

      // Click "Add Product" CTA in empty state
      const emptyStateAddBtn = screen.getByRole('button', { name: 'Add Product' });
      fireEvent.click(emptyStateAddBtn);

      // Modal should open
      expect(await screen.findByText('Create New Product')).toBeDefined();
    });
  });
});
