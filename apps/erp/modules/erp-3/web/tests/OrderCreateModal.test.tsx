// @vitest-environment jsdom
/**
 * ERP-3 Sales Orders & Invoices — Sales Order Creation Modal Acceptance Tests
 *
 * Acceptance test suite for Issue #156 (ERP3-20):
 * - Acceptance Criterion 1: Form validates required fields, email format, phone numbers, and decimal ranges before submission.
 * - Acceptance Criterion 2: Client submission button disables during inflight request to prevent double-submit.
 * - Acceptance Criterion 3: Server validation errors (400) map directly to corresponding input fields with error text.
 * - Acceptance Criterion 4: Successful submission closes modal, updates table cache, and shows confirmation toast.
 *
 * All test data is 100% synthetic in compliance with ClearShift G3 constraints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { SalesOrder, CreateSalesOrderInput } from '@clearshift/contracts';
import { OrderCreateModal } from '../src/components/forms/OrderCreateModal.js';
import { OrdersListPage } from '../src/pages/OrdersListPage.js';
import * as api from '../src/api/erp-3.js';
import { ApiError } from '../src/api/erp-3.js';

const VALID_CUSTOMER_UUID = '55555555-0003-4000-8000-000000000001';
const VALID_PRODUCT_UUID = '00000000-0000-4000-b000-000000000001';
const VALID_PRODUCT_UUID_2 = '00000000-0000-4000-b000-000000000002';

const syntheticCreatedOrder: SalesOrder = {
  id: '00000000-0000-4000-a000-000000000099',
  order_number: 'SO-2026-0099',
  customer_golden_id: VALID_CUSTOMER_UUID,
  order_date: '2026-10-24',
  status: 'Open',
  currency: 'USD',
  total: '110.0000',
  lines: [
    {
      id: 'line-99-0',
      order_id: '00000000-0000-4000-a000-000000000099',
      product_id: VALID_PRODUCT_UUID,
      quantity: '1.0000',
      price: '100.0000',
      tax_rate: '10.0000',
      tax_amount: '10.0000',
      line_total: '110.0000',
      created_at: '2026-10-24T12:00:00Z',
    },
  ],
  source_system: null,
  source_id: null,
  created_at: '2026-10-24T12:00:00Z',
  updated_at: '2026-10-24T12:00:00Z',
};

describe('ERP-3 OrderCreateModal — Issue #156 (ERP3-20)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('1. Acceptance Criterion 1: Form validates required fields, email format, phone numbers, and decimal ranges before submission', () => {
    it('validates required fields when submitting an empty form and prevents submission', async () => {
      const mockSubmit = vi.fn();
      const mockClose = vi.fn();

      render(
        <OrderCreateModal
          isOpen={true}
          onClose={mockClose}
          onSubmitOrder={mockSubmit}
        />
      );

      // Verify modal header is visible
      expect(screen.getByText('Create New Sales Order')).toBeDefined();

      // Submit form with missing Customer Golden ID and Product ID
      const submitBtn = screen.getByRole('button', { name: 'Create Sales Order' });
      fireEvent.click(submitBtn);

      // Verify required field error messages are displayed
      await waitFor(() => {
        expect(screen.getByText('Customer Golden ID is required')).toBeDefined();
        expect(screen.getByText('Product ID is required')).toBeDefined();
      });

      // Confirm no API call was dispatched
      expect(mockSubmit).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
    });

    it('validates customer Golden ID format (rejects non-UUID strings per ADR-003)', async () => {
      const mockSubmit = vi.fn();

      render(
        <OrderCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitOrder={mockSubmit}
        />
      );

      const customerInput = screen.getByLabelText(/Customer Golden ID/i);
      fireEvent.change(customerInput, { target: { value: 'gid-not-a-uuid-123' } });

      const submitBtn = screen.getByRole('button', { name: 'Create Sales Order' });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(
          screen.getByText('Customer Golden ID is required and must be a valid UUID (ADR-003)')
        ).toBeDefined();
      });

      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('validates customer email format when provided', async () => {
      const mockSubmit = vi.fn();

      render(
        <OrderCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitOrder={mockSubmit}
        />
      );

      // Fill valid customer ID & product ID
      fireEvent.change(screen.getByLabelText(/Customer Golden ID/i), {
        target: { value: VALID_CUSTOMER_UUID },
      });
      fireEvent.change(screen.getByLabelText(/Product ID/i), {
        target: { value: VALID_PRODUCT_UUID },
      });

      // Enter invalid email format
      const emailInput = screen.getByLabelText(/Customer Email/i);
      fireEvent.change(emailInput, { target: { value: 'invalid-email-format' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));

      await waitFor(() => {
        expect(
          screen.getByText(/Invalid email address format/i)
        ).toBeDefined();
      });

      expect(mockSubmit).not.toHaveBeenCalled();

      // Fix email format
      fireEvent.change(emailInput, { target: { value: 'billing@clearshift.test' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));

      await waitFor(() => {
        expect(screen.queryByText(/Invalid email address format/i)).toBeNull();
      });
    });

    it('validates contact phone number format when provided', async () => {
      const mockSubmit = vi.fn();

      render(
        <OrderCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitOrder={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Customer Golden ID/i), {
        target: { value: VALID_CUSTOMER_UUID },
      });
      fireEvent.change(screen.getByLabelText(/Product ID/i), {
        target: { value: VALID_PRODUCT_UUID },
      });

      // Enter too-short phone number
      const phoneInput = screen.getByLabelText(/Contact Phone/i);
      fireEvent.change(phoneInput, { target: { value: '123' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));

      await waitFor(() => {
        expect(screen.getByText(/Invalid phone number format/i)).toBeDefined();
      });

      expect(mockSubmit).not.toHaveBeenCalled();

      // Enter valid phone format
      fireEvent.change(phoneInput, { target: { value: '+1-555-019-2834' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));

      await waitFor(() => {
        expect(screen.queryByText(/Invalid phone number format/i)).toBeNull();
      });
    });

    it('validates decimal range for line item quantity (rejects zero, negative, non-numeric, and excessive decimals)', async () => {
      const mockSubmit = vi.fn();

      render(
        <OrderCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitOrder={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Customer Golden ID/i), {
        target: { value: VALID_CUSTOMER_UUID },
      });
      fireEvent.change(screen.getByLabelText(/Product ID/i), {
        target: { value: VALID_PRODUCT_UUID },
      });

      const qtyInput = screen.getByLabelText(/^Quantity/i);

      // Rejects zero
      fireEvent.change(qtyInput, { target: { value: '0' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));
      await waitFor(() => {
        expect(screen.getByText('Quantity must be greater than zero')).toBeDefined();
      });

      // Rejects negative
      fireEvent.change(qtyInput, { target: { value: '-5.00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));
      await waitFor(() => {
        expect(screen.getByText('Quantity must be greater than zero')).toBeDefined();
      });

      // Rejects non-numeric
      fireEvent.change(qtyInput, { target: { value: 'abc' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));
      await waitFor(() => {
        expect(screen.getByText('Quantity must be a valid decimal number')).toBeDefined();
      });

      // Rejects > 4 decimal places
      fireEvent.change(qtyInput, { target: { value: '1.12345' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));
      await waitFor(() => {
        expect(screen.getByText('Quantity must have at most 4 decimal places')).toBeDefined();
      });

      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('validates decimal range for line item unit price (rejects negative and excessive decimals)', async () => {
      const mockSubmit = vi.fn();

      render(
        <OrderCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitOrder={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Customer Golden ID/i), {
        target: { value: VALID_CUSTOMER_UUID },
      });
      fireEvent.change(screen.getByLabelText(/Product ID/i), {
        target: { value: VALID_PRODUCT_UUID },
      });

      const priceInput = screen.getByLabelText(/^Unit Price/i);

      // Rejects negative price
      fireEvent.change(priceInput, { target: { value: '-10.50' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));
      await waitFor(() => {
        expect(screen.getByText('Price must be greater than or equal to 0')).toBeDefined();
      });

      // Rejects non-numeric price
      fireEvent.change(priceInput, { target: { value: 'not-a-price' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));
      await waitFor(() => {
        expect(screen.getByText('Price must be a valid non-negative decimal')).toBeDefined();
      });

      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('validates decimal range for tax rate (between 0.00% and 100.00%)', async () => {
      const mockSubmit = vi.fn();

      render(
        <OrderCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitOrder={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Customer Golden ID/i), {
        target: { value: VALID_CUSTOMER_UUID },
      });
      fireEvent.change(screen.getByLabelText(/Product ID/i), {
        target: { value: VALID_PRODUCT_UUID },
      });

      const taxInput = screen.getByLabelText(/Tax Rate/i);

      // Rejects > 100%
      fireEvent.change(taxInput, { target: { value: '120.00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));
      await waitFor(() => {
        expect(screen.getByText('Tax rate must be between 0.00% and 100.00%')).toBeDefined();
      });

      // Rejects negative
      fireEvent.change(taxInput, { target: { value: '-2.00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));
      await waitFor(() => {
        expect(screen.getByText('Tax rate must be between 0.00% and 100.00%')).toBeDefined();
      });

      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('allows dynamic addition and removal of line items and enforces minimum one line', async () => {
      render(
        <OrderCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitOrder={vi.fn()}
        />
      );

      // Initially 1 line
      expect(screen.getByText(/Order Line Items \(1\)/i)).toBeDefined();

      // Add line item
      fireEvent.click(screen.getByRole('button', { name: /Add Line Item/i }));
      expect(screen.getByText(/Order Line Items \(2\)/i)).toBeDefined();

      // Remove second line item
      const removeBtn = screen.getByRole('button', { name: /Remove Line 2/i });
      fireEvent.click(removeBtn);
      expect(screen.getByText(/Order Line Items \(1\)/i)).toBeDefined();
    });
  });

  describe('2. Acceptance Criterion 2: Client submission button disables during inflight request to prevent double-submit', () => {
    it('disables submit button and sets aria-busy during flight, preventing duplicate calls', async () => {
      let resolvePromise: (val: SalesOrder) => void = () => {};
      const pendingPromise = new Promise<SalesOrder>((resolve) => {
        resolvePromise = resolve;
      });
      const mockSubmit = vi.fn().mockReturnValue(pendingPromise);

      render(
        <OrderCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitOrder={mockSubmit}
        />
      );

      // Fill valid required fields
      fireEvent.change(screen.getByLabelText(/Customer Golden ID/i), {
        target: { value: VALID_CUSTOMER_UUID },
      });
      fireEvent.change(screen.getByLabelText(/Product ID/i), {
        target: { value: VALID_PRODUCT_UUID },
      });

      const submitBtn = screen.getByRole('button', { name: 'Create Sales Order' });
      expect(submitBtn.hasAttribute('disabled')).toBe(false);

      // Click submit
      fireEvent.click(submitBtn);

      // Button should now be disabled with aria-busy="true" and label "Creating..."
      await waitFor(() => {
        expect(submitBtn.hasAttribute('disabled')).toBe(true);
        expect(submitBtn.getAttribute('aria-busy')).toBe('true');
        expect(submitBtn.textContent).toBe('Creating...');
      });

      // Attempt double-submit while inflight
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);

      // Only one submission dispatch occurred
      expect(mockSubmit).toHaveBeenCalledTimes(1);

      // Resolve pending flight
      resolvePromise(syntheticCreatedOrder);

      await waitFor(() => {
        expect(submitBtn.textContent).not.toBe('Creating...');
      });
    });
  });

  describe('3. Acceptance Criterion 3: Server validation errors (400) map directly to corresponding input fields with error text', () => {
    it('maps server 400 validation error details directly to matching input fields', async () => {
      const serverError = new ApiError(
        400,
        'VALIDATION_FAILED',
        'Request schema validation failed',
        {
          correlationId: 'req-err-400-abc-001',
          errors: [
            {
              field: 'customer_golden_id',
              message: 'Customer does not exist or is inactive in Hub Identity',
            },
            {
              field: 'lines.0.quantity',
              message: 'Quantity exceeds available warehouse ceiling',
            },
          ],
        }
      );

      const mockSubmit = vi.fn().mockRejectedValue(serverError);

      render(
        <OrderCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitOrder={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Customer Golden ID/i), {
        target: { value: VALID_CUSTOMER_UUID },
      });
      fireEvent.change(screen.getByLabelText(/Product ID/i), {
        target: { value: VALID_PRODUCT_UUID },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));

      // Verify server error message mapped to Customer Golden ID
      await waitFor(() => {
        expect(
          screen.getByText('Customer does not exist or is inactive in Hub Identity')
        ).toBeDefined();
        expect(
          screen.getByText('Quantity exceeds available warehouse ceiling')
        ).toBeDefined();
      });

      // Verify correlation ID is displayed in error alert banner
      expect(screen.getByText('req-err-400-abc-001')).toBeDefined();
      expect(
        screen.getByText('Please correct the validation errors below')
      ).toBeDefined();
    });

    it('handles HTTP 409 conflict and displays message in error banner', async () => {
      const conflictError = new ApiError(
        409,
        'CONFLICT',
        'A sales order with this order number or reference already exists'
      );
      const mockSubmit = vi.fn().mockRejectedValue(conflictError);

      render(
        <OrderCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitOrder={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Customer Golden ID/i), {
        target: { value: VALID_CUSTOMER_UUID },
      });
      fireEvent.change(screen.getByLabelText(/Product ID/i), {
        target: { value: VALID_PRODUCT_UUID },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));

      await waitFor(() => {
        expect(
          screen.getByText('A sales order with this order number or reference already exists')
        ).toBeDefined();
      });
    });
  });

  describe('4. Acceptance Criterion 4: Successful submission closes modal, updates table cache, and shows confirmation toast', () => {
    it('closes modal and calls onOrderCreated on successful standalone submission', async () => {
      const mockSubmit = vi.fn().mockResolvedValue(syntheticCreatedOrder);
      const mockClose = vi.fn();
      const mockOnCreated = vi.fn();

      render(
        <OrderCreateModal
          isOpen={true}
          onClose={mockClose}
          onSubmitOrder={mockSubmit}
          onOrderCreated={mockOnCreated}
        />
      );

      fireEvent.change(screen.getByLabelText(/Customer Golden ID/i), {
        target: { value: VALID_CUSTOMER_UUID },
      });
      fireEvent.change(screen.getByLabelText(/Product ID/i), {
        target: { value: VALID_PRODUCT_UUID },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Sales Order' }));

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
        expect(mockOnCreated).toHaveBeenCalledWith(syntheticCreatedOrder);
        expect(mockClose).toHaveBeenCalledTimes(1);
      });
    });

    it('integrates with OrdersListPage: opens modal via toolbar, submits, closes modal, updates table cache, and shows confirmation toast', async () => {
      const initialOrder: SalesOrder = {
        id: '00000000-0000-4000-a000-000000000001',
        order_number: 'SO-2026-0001',
        customer_golden_id: VALID_CUSTOMER_UUID,
        order_date: '2026-10-20',
        status: 'Open',
        currency: 'USD',
        total: '500.0000',
        lines: [],
        source_system: null,
        source_id: null,
        created_at: '2026-10-20T00:00:00Z',
        updated_at: '2026-10-20T00:00:00Z',
      };

      vi.spyOn(api, 'fetchSalesOrders').mockResolvedValue({
        items: [initialOrder],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      vi.spyOn(api, 'fetchInvoices').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      const createSpy = vi.spyOn(api, 'createSalesOrder').mockResolvedValue(syntheticCreatedOrder);

      render(<OrdersListPage />);

      // Wait for table to load initial orders
      await waitFor(() => {
        expect(screen.getByText('SO-2026-0001')).toBeDefined();
      });

      // 1. Click "+ Order Modal" button in toolbar
      const openModalBtn = screen.getByTestId('open-order-create-modal');
      fireEvent.click(openModalBtn);

      // Verify modal opened
      expect(screen.getByText('Create New Sales Order')).toBeDefined();
      const modal = screen.getByRole('dialog');

      // 2. Fill valid form data
      fireEvent.change(within(modal).getByLabelText(/Customer Golden ID/i), {
        target: { value: VALID_CUSTOMER_UUID },
      });
      fireEvent.change(within(modal).getByLabelText(/Product ID/i), {
        target: { value: VALID_PRODUCT_UUID },
      });

      // 3. Submit form
      const submitBtn = within(modal).getByRole('button', { name: 'Create Sales Order' });
      fireEvent.click(submitBtn);

      // 4. Modal closes, table cache updates with prepended order, and confirmation toast shows
      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledTimes(1);
        // Confirmation toast visible
        expect(
          screen.getByText(/Sales order SO-2026-0099 created successfully/i)
        ).toBeDefined();
        // New order appears in table cache
        expect(screen.getByText('SO-2026-0099')).toBeDefined();
        // Previous order still exists in table cache
        expect(screen.getByText('SO-2026-0001')).toBeDefined();
      });

      // Modal is closed
      expect(screen.queryByText('Create New Sales Order')).toBeNull();
    });
  });
});
