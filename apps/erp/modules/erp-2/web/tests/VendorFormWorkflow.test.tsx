// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { VendorForm, type VendorFormData } from '../src/components/forms/VendorForm.js';
import { VendorCreatePage } from '../src/pages/VendorCreatePage.js';
import { VendorDetailPage } from '../src/pages/VendorDetailPage.js';
import { VendorEditPage } from '../src/pages/VendorEditPage.js';
import * as api from '../src/api/erp-2.js';
import type { Vendor } from '@clearshift/contracts';

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

describe('ERP-2 Vendor Form & Workflow — RTL Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('1. VendorForm Field-Level Client Validation', () => {
    it('displays client validation errors when submitting an empty form', async () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(<VendorForm onSubmit={handleSubmit} onCancel={handleCancel} />);

      const submitButton = screen.getByRole('button', { name: 'Create Vendor' });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeDefined();
        expect(screen.getByText('Tax number is required')).toBeDefined();
        expect(screen.getByText('Valid email is required')).toBeDefined();
      });

      expect(handleSubmit).not.toHaveBeenCalled();
    });

    it('validates email format on input change', async () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(<VendorForm onSubmit={handleSubmit} onCancel={handleCancel} />);

      const emailInput = screen.getByLabelText(/Procurement Email/i);
      fireEvent.change(emailInput, { target: { value: 'invalid-email-format' } });

      await waitFor(() => {
        expect(screen.getByText('Valid email is required')).toBeDefined();
      });

      fireEvent.change(emailInput, { target: { value: 'valid@company.com' } });
      await waitFor(() => {
        expect(screen.queryByText('Valid email is required')).toBeNull();
      });
    });

    it('validates currency format on input change', async () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(<VendorForm onSubmit={handleSubmit} onCancel={handleCancel} />);

      const currencyInput = screen.getByLabelText(/Currency/i);
      fireEvent.change(currencyInput, { target: { value: 'US' } });

      await waitFor(() => {
        expect(screen.getByText('Currency must be a 3-letter ISO code (e.g. USD)')).toBeDefined();
      });

      fireEvent.change(currencyInput, { target: { value: 'EUR' } });
      await waitFor(() => {
        expect(screen.queryByText('Currency must be a 3-letter ISO code (e.g. USD)')).toBeNull();
      });
    });

    it('validates bank details minimum length when provided', async () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(<VendorForm onSubmit={handleSubmit} onCancel={handleCancel} />);

      const bankInput = screen.getByLabelText(/Bank Account Details/i);
      fireEvent.change(bankInput, { target: { value: '12' } });

      await waitFor(() => {
        expect(screen.getByText('Bank details must be at least 4 characters')).toBeDefined();
      });

      fireEvent.change(bankInput, { target: { value: '123456789' } });
      await waitFor(() => {
        expect(screen.queryByText('Bank details must be at least 4 characters')).toBeNull();
      });
    });
  });

  describe('2. VendorForm Creation & Edit Submissions', () => {
    it('submits valid vendor form data in create mode', async () => {
      const handleSubmit = vi.fn().mockResolvedValue(undefined);
      const handleCancel = vi.fn();

      render(<VendorForm onSubmit={handleSubmit} onCancel={handleCancel} />);

      fireEvent.change(screen.getByLabelText(/Legal Name/i), {
        target: { value: 'Pacific Components Inc' },
      });
      fireEvent.change(screen.getByLabelText(/Tax Number/i), {
        target: { value: 'US-EIN-998877665' },
      });
      fireEvent.change(screen.getByLabelText(/Procurement Email/i), {
        target: { value: 'sales@pacific-components.com' },
      });
      fireEvent.change(screen.getByLabelText(/Phone Number/i), {
        target: { value: '+1-555-0244' },
      });
      fireEvent.change(screen.getByLabelText(/Bank Account Details/i), {
        target: { value: '9876543210' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Vendor' }));

      await waitFor(() => {
        expect(handleSubmit).toHaveBeenCalledTimes(1);
        expect(handleSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Pacific Components Inc',
            tax_number: 'US-EIN-998877665',
            email: 'sales@pacific-components.com',
            phone: '+1-555-0244',
            bank_details: '9876543210',
            currency: 'USD',
          })
        );
      });
    });

    it('renders masked bank account details in edit mode and allows updating', async () => {
      const handleSubmit = vi.fn().mockResolvedValue(undefined);
      const handleCancel = vi.fn();

      render(
        <VendorForm
          initialData={mockVendor}
          isEdit={true}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      );

      // Verify initial data prefilled
      expect((screen.getByLabelText(/Legal Name/i) as HTMLInputElement).value).toBe(mockVendor.name);
      expect((screen.getByLabelText(/Tax Number/i) as HTMLInputElement).value).toBe(mockVendor.tax_number);

      // Verify masked bank details helper is visible
      expect(screen.getByText('XXXX-XXXX-7890')).toBeDefined();
      expect(screen.getByText(/Current on file:/)).toBeDefined();

      // Submit changes without re-entering bank details
      fireEvent.change(screen.getByLabelText(/Legal Name/i), {
        target: { value: 'Acme Industrial Supplies International' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => {
        expect(handleSubmit).toHaveBeenCalledTimes(1);
        expect(handleSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Acme Industrial Supplies International',
            tax_number: mockVendor.tax_number,
          })
        );
      });
    });

    it('cancels form and triggers onCancel', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(<VendorForm onSubmit={handleSubmit} onCancel={handleCancel} />);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(handleCancel).toHaveBeenCalledTimes(1);
      expect(handleSubmit).not.toHaveBeenCalled();
    });

    it('handles server validation errors gracefully preserving inputs', async () => {
      const handleSubmit = vi.fn().mockRejectedValue({
        message: 'Vendor with this tax number already exists.',
        details: [{ path: ['tax_number'], message: 'Duplicate tax number' }],
      });
      const handleCancel = vi.fn();

      render(<VendorForm onSubmit={handleSubmit} onCancel={handleCancel} />);

      fireEvent.change(screen.getByLabelText(/Legal Name/i), {
        target: { value: 'Acme LLC' },
      });
      fireEvent.change(screen.getByLabelText(/Tax Number/i), {
        target: { value: 'US-EIN-123456789' },
      });
      fireEvent.change(screen.getByLabelText(/Procurement Email/i), {
        target: { value: 'acme@test.com' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Vendor' }));

      await waitFor(() => {
        expect(screen.getByText('Duplicate tax number')).toBeDefined();
        expect(screen.getByText('Vendor with this tax number already exists.')).toBeDefined();
      });
    });
  });

  describe('3. VendorCreatePage Integration', () => {
    it('renders creation page and submits successfully to createVendor API', async () => {
      const createSpy = vi.spyOn(api, 'createVendor').mockResolvedValue(mockVendor);

      render(
        <MemoryRouter initialEntries={['/erp2/vendors/new']}>
          <Routes>
            <Route path="/erp2/vendors/new" element={<VendorCreatePage />} />
            <Route path="/erp2/vendors/:vendorId" element={<div>Vendor Detail View</div>} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByRole('heading', { name: 'New Vendor' })).toBeDefined();

      fireEvent.change(screen.getByLabelText(/Legal Name/i), {
        target: { value: 'Acme Industrial Supplies LLC' },
      });
      fireEvent.change(screen.getByLabelText(/Tax Number/i), {
        target: { value: 'US-EIN-123456789' },
      });
      fireEvent.change(screen.getByLabelText(/Procurement Email/i), {
        target: { value: 'procurement@acme-industrial.com' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Vendor' }));

      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Vendor Detail View')).toBeDefined();
      });
    });
  });

  describe('4. VendorDetailPage Integration', () => {
    it('fetches and renders vendor details with masked bank account', async () => {
      vi.spyOn(api, 'fetchVendorById').mockResolvedValue(mockVendor);

      render(
        <MemoryRouter initialEntries={[`/erp2/vendors/${mockVendor.id}`]}>
          <Routes>
            <Route path="/erp2/vendors/:vendorId" element={<VendorDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      const title = await screen.findByRole('heading', { name: 'Acme Industrial Supplies LLC' });
      expect(title).toBeDefined();

      expect(screen.getByText('US-EIN-123456789')).toBeDefined();
      expect(screen.getByText('procurement@acme-industrial.com')).toBeDefined();
      expect(screen.getByText('+1-555-0199')).toBeDefined();
      expect(screen.getByText('XXXX-XXXX-7890')).toBeDefined();
      expect(screen.getByText('Edit Vendor')).toBeDefined();
      expect(screen.getByText('+ Create PO')).toBeDefined();
    });

    it('renders error state on failed vendor detail fetch', async () => {
      vi.spyOn(api, 'fetchVendorById').mockRejectedValue(new Error('Vendor not found on server.'));

      render(
        <MemoryRouter initialEntries={['/erp2/vendors/non-existent-id']}>
          <Routes>
            <Route path="/erp2/vendors/:vendorId" element={<VendorDetailPage />} />
          </Routes>
        </MemoryRouter>
      );

      const errorMsg = await screen.findByText('Vendor not found on server.');
      expect(errorMsg).toBeDefined();
      expect(screen.getByText('Failed to Load Vendor Profile')).toBeDefined();
    });
  });

  describe('5. VendorEditPage Integration', () => {
    it('loads vendor, prefills edit form, and submits update successfully', async () => {
      vi.spyOn(api, 'fetchVendorById').mockResolvedValue(mockVendor);
      const updateSpy = vi.spyOn(api, 'updateVendor').mockResolvedValue({
        ...mockVendor,
        name: 'Acme Updated LLC',
      });

      render(
        <MemoryRouter initialEntries={[`/erp2/vendors/${mockVendor.id}/edit`]}>
          <Routes>
            <Route path="/erp2/vendors/:vendorId/edit" element={<VendorEditPage />} />
            <Route path="/erp2/vendors/:vendorId" element={<div>Updated Vendor Detail View</div>} />
          </Routes>
        </MemoryRouter>
      );

      await screen.findByDisplayValue('Acme Industrial Supplies LLC');

      const nameInput = screen.getByLabelText(/Legal Name/i);
      fireEvent.change(nameInput, { target: { value: 'Acme Updated LLC' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          mockVendor.id,
          expect.objectContaining({
            name: 'Acme Updated LLC',
          })
        );
        expect(screen.getByText('Updated Vendor Detail View')).toBeDefined();
      });
    });
  });
});
