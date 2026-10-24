// @vitest-environment jsdom
/**
 * ERP-2 Vendors & Purchasing — Vendor Creation Modal Tests
 *
 * Acceptance test suite for Issue #136 (ERP2-20):
 * - Acceptance Criterion 1: Form validates required fields, email format, phone numbers, and decimal ranges before submission.
 * - Acceptance Criterion 2: Client submission button disables during inflight request to prevent double-submit.
 * - Acceptance Criterion 3: Server validation errors (400) map directly to corresponding input fields with error text.
 * - Acceptance Criterion 4: Successful submission closes modal, updates table cache, and shows confirmation toast.
 *
 * All test data is 100% synthetic in compliance with ClearShift G3 constraints.
 *
 * @module erp2/web/tests/VendorCreateModal.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { Vendor } from '@clearshift/contracts';
import { VendorCreateModal } from '../src/components/forms/VendorCreateModal.js';
import { PurchaseOrderCreateModal } from '../src/components/forms/PurchaseOrderCreateModal.js';
import { VendorsListPage } from '../src/pages/VendorsListPage.js';
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
  bank_details: 'XXXX-XXXX-7890',
  bank_masked: 'XXXX-XXXX-7890',
  source_system: null,
  source_id: null,
  created_at: '2026-10-24T12:00:00Z',
  updated_at: '2026-10-24T12:00:00Z',
};

describe('ERP-2 VendorCreateModal — Issue #136 (ERP2-20)', () => {
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
        <VendorCreateModal
          isOpen={true}
          onClose={mockClose}
          onSubmitVendor={mockSubmit}
        />
      );

      // Verify modal header is visible
      expect(screen.getByText('Add New Vendor')).toBeDefined();

      // Submit empty form
      const submitBtn = screen.getByRole('button', { name: 'Create Vendor' });
      fireEvent.click(submitBtn);

      // Verify required field error messages are displayed with role="alert"
      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeDefined();
        expect(screen.getByText('Tax number is required')).toBeDefined();
        expect(screen.getByText('Valid email is required')).toBeDefined();
      });

      // Confirm no API call was dispatched
      expect(mockSubmit).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
    });

    it('validates email format before submission (rejects invalid email)', async () => {
      const mockSubmit = vi.fn();

      render(
        <VendorCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitVendor={mockSubmit}
        />
      );

      // Fill in name & tax number
      fireEvent.change(screen.getByLabelText(/Legal Name/i), {
        target: { value: 'Valid Vendor Corp' },
      });
      fireEvent.change(screen.getByLabelText(/Tax Number/i), {
        target: { value: 'TAX-123456' },
      });

      // Fill invalid email
      fireEvent.change(screen.getByLabelText(/Procurement Email/i), {
        target: { value: 'not-an-email' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Vendor' }));

      await waitFor(() => {
        expect(screen.getByText('Valid email is required')).toBeDefined();
      });
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('validates phone number format when provided (rejects malformed numbers)', async () => {
      const mockSubmit = vi.fn();

      render(
        <VendorCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitVendor={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Legal Name/i), {
        target: { value: 'Valid Vendor Corp' },
      });
      fireEvent.change(screen.getByLabelText(/Tax Number/i), {
        target: { value: 'TAX-123456' },
      });
      fireEvent.change(screen.getByLabelText(/Procurement Email/i), {
        target: { value: 'orders@vendor.example' },
      });

      // Provide invalid short / non-phone string
      fireEvent.change(screen.getByLabelText(/Phone Number/i), {
        target: { value: '123' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Vendor' }));

      await waitFor(() => {
        expect(
          screen.getByText(/Phone number must be a valid format/i)
        ).toBeDefined();
      });
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('validates currency code (rejects non-3-letter ISO code)', async () => {
      const mockSubmit = vi.fn();

      render(
        <VendorCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitVendor={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Legal Name/i), {
        target: { value: 'Valid Vendor Corp' },
      });
      fireEvent.change(screen.getByLabelText(/Tax Number/i), {
        target: { value: 'TAX-123456' },
      });
      fireEvent.change(screen.getByLabelText(/Procurement Email/i), {
        target: { value: 'orders@vendor.example' },
      });

      // Invalid currency
      fireEvent.change(screen.getByLabelText(/Currency/i), {
        target: { value: 'US' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Vendor' }));

      await waitFor(() => {
        expect(
          screen.getByText('Currency must be a 3-letter ISO code (e.g. USD)')
        ).toBeDefined();
      });
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('validates bank details length if provided (minimum 4 characters)', async () => {
      const mockSubmit = vi.fn();

      render(
        <VendorCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitVendor={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Legal Name/i), {
        target: { value: 'Valid Vendor Corp' },
      });
      fireEvent.change(screen.getByLabelText(/Tax Number/i), {
        target: { value: 'TAX-123456' },
      });
      fireEvent.change(screen.getByLabelText(/Procurement Email/i), {
        target: { value: 'orders@vendor.example' },
      });

      // Bank details too short
      fireEvent.change(screen.getByLabelText(/Bank Account Details/i), {
        target: { value: '12' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Vendor' }));

      await waitFor(() => {
        expect(
          screen.getByText('Bank details must be at least 4 characters')
        ).toBeDefined();
      });
      expect(mockSubmit).not.toHaveBeenCalled();
    });
  });

  describe('2. Acceptance Criterion 2: Client submission button disables during inflight request to prevent double-submit', () => {
    it('disables the submit and cancel buttons and displays saving indicator during inflight request', async () => {
      let resolvePromise: (value: Vendor) => void = () => {};
      const pendingPromise = new Promise<Vendor>((resolve) => {
        resolvePromise = resolve;
      });

      const mockSubmit = vi.fn().mockReturnValue(pendingPromise);

      render(
        <VendorCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitVendor={mockSubmit}
        />
      );

      // Fill in valid details
      fireEvent.change(screen.getByLabelText(/Legal Name/i), {
        target: { value: 'Acme Parts LLC' },
      });
      fireEvent.change(screen.getByLabelText(/Tax Number/i), {
        target: { value: 'US-EIN-55443322' },
      });
      fireEvent.change(screen.getByLabelText(/Procurement Email/i), {
        target: { value: 'supply@acmeparts.example' },
      });

      const submitBtn = screen.getByRole('button', { name: 'Create Vendor' });
      fireEvent.click(submitBtn);

      // Verify submit dispatched once
      expect(mockSubmit).toHaveBeenCalledTimes(1);

      // Verify button is disabled and text reflects saving state
      await waitFor(() => {
        expect(submitBtn.getAttribute('disabled')).not.toBeNull();
        expect(screen.getByText('Saving...')).toBeDefined();
      });

      // Verify second click does not dispatch duplicate request
      fireEvent.click(submitBtn);
      expect(mockSubmit).toHaveBeenCalledTimes(1);

      // Resolve the pending promise to clean up
      resolvePromise(syntheticVendor);
    });
  });

  describe('3. Acceptance Criterion 3: Server validation errors (400) map directly to corresponding input fields with error text', () => {
    it('maps HTTP 400 validation error details directly to corresponding input fields', async () => {
      const serverValidationError = {
        name: 'ApiError',
        status: 400,
        message: 'Validation failed for vendor creation payload.',
        details: [
          { path: ['name'], message: 'Legal Name already exists in supplier master' },
          { path: ['tax_number'], message: 'Tax Number is already registered to another vendor' },
        ],
      };

      const mockSubmit = vi.fn().mockRejectedValue(serverValidationError);

      render(
        <VendorCreateModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmitVendor={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Legal Name/i), {
        target: { value: 'Duplicate Vendor Name' },
      });
      fireEvent.change(screen.getByLabelText(/Tax Number/i), {
        target: { value: 'US-EIN-DUPLICATE' },
      });
      fireEvent.change(screen.getByLabelText(/Procurement Email/i), {
        target: { value: 'valid@example.com' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Vendor' }));

      await waitFor(() => {
        // Top-level modal error alert
        expect(screen.getByText('Validation failed for vendor creation payload.')).toBeDefined();

        // Field-level error mapping directly on input fields (AC3)
        const nameError = screen.getByText('Legal Name already exists in supplier master');
        expect(nameError).toBeDefined();
        expect(nameError.getAttribute('role')).toBe('alert');

        const taxError = screen.getByText('Tax Number is already registered to another vendor');
        expect(taxError).toBeDefined();
        expect(taxError.getAttribute('role')).toBe('alert');
      });

      // Confirm inputs have aria-invalid="true"
      expect(screen.getByLabelText(/Legal Name/i).getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByLabelText(/Tax Number/i).getAttribute('aria-invalid')).toBe('true');
    });
  });

  describe('4. Acceptance Criterion 4: Successful submission closes modal, updates table cache, and shows confirmation toast', () => {
    it('closes modal and triggers onVendorCreated on successful submission', async () => {
      const mockSubmit = vi.fn().mockResolvedValue(syntheticVendor);
      const mockCreated = vi.fn();
      const mockClose = vi.fn();

      render(
        <VendorCreateModal
          isOpen={true}
          onClose={mockClose}
          onVendorCreated={mockCreated}
          onSubmitVendor={mockSubmit}
        />
      );

      fireEvent.change(screen.getByLabelText(/Legal Name/i), {
        target: { value: 'Apex Industrial Supply LLC' },
      });
      fireEvent.change(screen.getByLabelText(/Tax Number/i), {
        target: { value: 'US-EIN-99887766' },
      });
      fireEvent.change(screen.getByLabelText(/Procurement Email/i), {
        target: { value: 'procurement@apex-industrial.example' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Vendor' }));

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
        expect(mockCreated).toHaveBeenCalledWith(syntheticVendor);
        expect(mockClose).toHaveBeenCalledTimes(1);
      });
    });

    it('integrates with VendorsListPage: opens modal, updates table cache, and displays toast', async () => {
      vi.spyOn(api, 'fetchVendors').mockResolvedValue({
        items: [syntheticVendor],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      const newVendor: Vendor = {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Brand New Vendor LLC',
        tax_number: 'US-EIN-11223344',
        email: 'new@brandnew.example',
        phone: '+1-555-0100',
        address_line: '200 Lake St',
        city: 'Detroit',
        country: 'United States',
        currency: 'USD',
        bank_details: 'XXXX-XXXX-1122',
        bank_masked: 'XXXX-XXXX-1122',
        source_system: null,
        source_id: null,
        created_at: '2026-10-24T12:00:00Z',
        updated_at: '2026-10-24T12:00:00Z',
      };

      vi.spyOn(api, 'createVendor').mockResolvedValue(newVendor);

      render(<VendorsListPage />);

      // Wait for table to load initial vendor
      await waitFor(() => {
        expect(screen.getByText('Apex Industrial Supply LLC')).toBeDefined();
      });

      // Click the header "+ Add Vendor" button
      const addVendorBtn = screen.getByRole('button', { name: 'Add Vendor' });
      fireEvent.click(addVendorBtn);

      // Verify modal opened
      await waitFor(() => {
        expect(screen.getByText('Add New Vendor')).toBeDefined();
      });

      // Fill in new vendor form
      fireEvent.change(screen.getByLabelText(/Legal Name/i), {
        target: { value: 'Brand New Vendor LLC' },
      });
      fireEvent.change(screen.getByLabelText(/^Tax Number \/ EIN/i), {
        target: { value: 'US-EIN-11223344' },
      });
      fireEvent.change(screen.getByLabelText(/Procurement Email/i), {
        target: { value: 'new@brandnew.example' },
      });

      // Submit modal
      const modalSubmitBtn = screen.getByRole('button', { name: 'Create Vendor' });
      fireEvent.click(modalSubmitBtn);

      // Verify modal closes, table cache updates with new vendor, and toast shows
      await waitFor(() => {
        expect(screen.getByText(/Vendor "Brand New Vendor LLC" created successfully\./i)).toBeDefined();
        expect(screen.getByText('Brand New Vendor LLC')).toBeDefined();
      });

      // Dismiss confirmation toast
      const closeToastBtn = screen.getByRole('button', { name: 'Close notification' });
      fireEvent.click(closeToastBtn);

      await waitFor(() => {
        expect(screen.queryByText(/Vendor "Brand New Vendor LLC" created successfully\./i)).toBeNull();
      });
    });
  });

  describe('5. PurchaseOrderCreateModal Integration', () => {
    it('renders PurchaseOrderCreateModal with line items and live total calculation', async () => {
      const mockSubmitOrder = vi.fn();
      const mockClose = vi.fn();

      render(
        <PurchaseOrderCreateModal
          isOpen={true}
          onClose={mockClose}
          onSubmitOrder={mockSubmitOrder}
        />
      );

      expect(screen.getByRole('heading', { name: 'Create Purchase Order' })).toBeDefined();

      // Submit empty order (missing vendor and product UUID)
      const submitBtn = screen.getByRole('button', { name: 'Create Purchase Order' });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText('Valid Vendor UUID is required')).toBeDefined();
        expect(screen.getByText('Product UUID is required (ERP-1)')).toBeDefined();
      });

      expect(mockSubmitOrder).not.toHaveBeenCalled();
    });
  });
});
