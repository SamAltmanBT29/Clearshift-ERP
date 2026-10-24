// @vitest-environment jsdom
/**
 * Automated Verification Suite for ERP4-20: Create Form with Field-Level Validation
 *
 * Verifies Acceptance Criteria:
 * 1. [x] Form validates required fields, email format, phone numbers, and decimal ranges before submission.
 * 2. [x] Client submission button disables during inflight request to prevent double-submit.
 * 3. [x] Server validation errors (400) map directly to corresponding input fields with error text.
 * 4. [x] Successful submission closes modal, updates table cache, and shows confirmation toast.
 *
 * @module erp4/web/tests/AccountCreateModal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Account } from '@clearshift/contracts';
import { installNavigationRequestShim } from './support/jsdom-environment.js';
import { AccountCreateModal } from '../src/components/forms/AccountCreateModal.js';
import { AccountForm } from '../src/components/forms/AccountForm.js';
import { AccountsListPage } from '../src/pages/AccountsListPage.js';
import * as erp4Api from '../src/api/erp-4.js';

installNavigationRequestShim();

describe('ERP4-20: Create Form with Field-Level Validation Suite', () => {
  const mockCreatedAccount: Account = {
    id: 'acc-new-uuid-1234',
    code: '1020',
    name: 'Payroll Operating Cash',
    type: 'asset',
    currency_code: 'USD',
    parent_id: null,
    description: 'Operating cash reserved for payroll disbursements',
    is_active: true,
    is_posting_account: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Acceptance Criterion: Form validates required fields, email format, phone numbers, and decimal ranges
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Field-Level Validation (Required, Email, Phone, Decimal Ranges)', () => {
    it('blocks submission and highlights errors when required fields are missing or empty', async () => {
      const handleSubmit = vi.fn();

      render(
        <AccountForm
          onSubmit={handleSubmit}
          onCancel={vi.fn()}
        />
      );

      // Attempt to submit empty form
      const submitBtn = screen.getByRole('button', { name: /create account/i });
      fireEvent.click(submitBtn);

      // Required field validation errors must be visible
      expect(screen.getByText(/account code is required/i)).toBeDefined();
      expect(screen.getByText(/account name is required/i)).toBeDefined();

      // Submit callback was blocked
      expect(handleSubmit).not.toHaveBeenCalled();
    });

    it('validates email format before submission', async () => {
      const handleSubmit = vi.fn();

      render(
        <AccountForm
          onSubmit={handleSubmit}
          onCancel={vi.fn()}
        />
      );

      // Fill required fields
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 1010/i), { target: { value: '1010' } });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Operating Checking/i), { target: { value: 'Operating Cash' } });

      // Enter invalid email
      const emailInput = screen.getByPlaceholderText(/finance-team@company\.com/i);
      fireEvent.change(emailInput, { target: { value: 'invalid-email-address' } });

      const submitBtn = screen.getByRole('button', { name: /create account/i });
      fireEvent.click(submitBtn);

      expect(screen.getByText(/please enter a valid email address/i)).toBeDefined();
      expect(handleSubmit).not.toHaveBeenCalled();

      // Correct email clears error
      fireEvent.change(emailInput, { target: { value: 'finance@clearshift.internal' } });
      expect(screen.queryByText(/please enter a valid email address/i)).toBeNull();
    });

    it('validates phone number format before submission', async () => {
      const handleSubmit = vi.fn();

      render(
        <AccountForm
          onSubmit={handleSubmit}
          onCancel={vi.fn()}
        />
      );

      // Fill required fields
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 1010/i), { target: { value: '1010' } });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Operating Checking/i), { target: { value: 'Operating Cash' } });

      // Enter invalid phone (less than 7 digits)
      const phoneInput = screen.getByPlaceholderText(/\+1-555-0199/i);
      fireEvent.change(phoneInput, { target: { value: '123' } });

      const submitBtn = screen.getByRole('button', { name: /create account/i });
      fireEvent.click(submitBtn);

      expect(screen.getByText(/phone number must be a valid format/i)).toBeDefined();
      expect(handleSubmit).not.toHaveBeenCalled();

      // Correct phone format
      fireEvent.change(phoneInput, { target: { value: '+1-555-0199' } });
      expect(screen.queryByText(/phone number must be a valid format/i)).toBeNull();
    });

    it('validates decimal range for opening balance (>= 0.00 and <= 999,999,999.99)', async () => {
      const handleSubmit = vi.fn();

      render(
        <AccountForm
          onSubmit={handleSubmit}
          onCancel={vi.fn()}
        />
      );

      // Fill required fields
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 1010/i), { target: { value: '1010' } });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Operating Checking/i), { target: { value: 'Operating Cash' } });

      const balanceInput = screen.getByPlaceholderText('0.00');

      // 1. Negative amount
      fireEvent.change(balanceInput, { target: { value: '-250.00' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));
      expect(screen.getByText(/must be a non-negative decimal amount/i)).toBeDefined();
      expect(handleSubmit).not.toHaveBeenCalled();

      // 2. Non-numeric string
      fireEvent.change(balanceInput, { target: { value: 'not-a-number' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));
      expect(screen.getByText(/must be a valid decimal number/i)).toBeDefined();

      // 3. Exceeds max range
      fireEvent.change(balanceInput, { target: { value: '10000000000.00' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));
      expect(screen.getByText(/cannot exceed 999,999,999\.99/i)).toBeDefined();

      // 4. Valid decimal range clears error
      fireEvent.change(balanceInput, { target: { value: '15000.50' } });
      expect(screen.queryByText(/opening balance/i)?.parentElement?.querySelector('[role="alert"]')).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Acceptance Criterion: Client submission button disables during inflight request to prevent double-submit
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Double-Submit Prevention & Inflight Disabled State', () => {
    it('disables the submit button and displays loading indicator while submission is inflight', async () => {
      let resolveSubmit: (val: any) => void;
      const deferredSubmit = new Promise((resolve) => {
        resolveSubmit = resolve;
      });
      const handleSubmit = vi.fn().mockImplementation(() => deferredSubmit);

      render(
        <AccountForm
          onSubmit={handleSubmit}
          onCancel={vi.fn()}
        />
      );

      // Fill valid required fields
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 1010/i), { target: { value: '1020' } });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Operating Checking/i), { target: { value: 'Payroll Operating Cash' } });

      const submitBtn = screen.getByRole('button', { name: /create account/i }) as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(false);

      // Click to submit
      fireEvent.click(submitBtn);

      // Button is now disabled to prevent double-submit
      expect(submitBtn.disabled).toBe(true);
      expect(submitBtn.getAttribute('aria-busy')).toBe('true');
      expect(screen.getByText(/saving account/i)).toBeDefined();

      // Second click does NOT trigger additional submission
      fireEvent.click(submitBtn);
      expect(handleSubmit).toHaveBeenCalledTimes(1);

      // Resolve pending submit
      resolveSubmit!(mockCreatedAccount);

      await waitFor(() => {
        expect(submitBtn.disabled).toBe(false);
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Acceptance Criterion: Server validation errors (400) map directly to corresponding input fields
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. Server Validation Errors (400) Direct Field Mapping', () => {
    it('maps server 400 validation error details directly to matching input fields', async () => {
      const server400Error = {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Account validation failed on server',
        details: [
          { field: 'code', message: 'Account code "1020" already exists in ledger' },
          { field: 'name', message: 'Account name cannot contain reserved keywords' },
        ],
      };

      const handleSubmit = vi.fn().mockRejectedValue(server400Error);

      render(
        <AccountForm
          onSubmit={handleSubmit}
          onCancel={vi.fn()}
        />
      );

      // Fill valid client inputs
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 1010/i), { target: { value: '1020' } });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Operating Checking/i), { target: { value: 'Cash' } });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      // Wait for server error mapping
      await waitFor(() => {
        expect(screen.getByText('Account code "1020" already exists in ledger')).toBeDefined();
        expect(screen.getByText('Account name cannot contain reserved keywords')).toBeDefined();
      });

      // Both errors should be rendered with role="alert"
      const alerts = screen.getAllByRole('alert');
      expect(alerts.length).toBeGreaterThanOrEqual(2);
    });

    it('handles Zod path-style server validation errors (issue.path[0])', async () => {
      const serverZodError = {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [
          { path: ['currency_code'], message: 'Currency code is unsupported' },
        ],
      };

      const handleSubmit = vi.fn().mockRejectedValue(serverZodError);

      render(
        <AccountForm
          onSubmit={handleSubmit}
          onCancel={vi.fn()}
        />
      );

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 1010/i), { target: { value: '1030' } });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Operating Checking/i), { target: { value: 'Savings' } });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(screen.getByText('Currency code is unsupported')).toBeDefined();
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Acceptance Criterion: Successful submission closes modal, updates table cache, and shows confirmation toast
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. Modal Lifecycle, Table Cache Update & Confirmation Toast', () => {
    it('AccountCreateModal closes and calls onAccountCreated on successful submit', async () => {
      const handleClose = vi.fn();
      const handleCreated = vi.fn();
      const mockSubmitAccount = vi.fn().mockResolvedValue(mockCreatedAccount);

      render(
        <AccountCreateModal
          isOpen={true}
          onClose={handleClose}
          onAccountCreated={handleCreated}
          onSubmitAccount={mockSubmitAccount}
        />
      );

      // Modal dialog is visible
      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByText('Create General Ledger Account')).toBeDefined();

      // Fill in valid details
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 1010/i), { target: { value: '1020' } });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Operating Checking/i), { target: { value: 'Payroll Operating Cash' } });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(mockSubmitAccount).toHaveBeenCalledTimes(1);
        expect(handleCreated).toHaveBeenCalledWith(mockCreatedAccount);
        expect(handleClose).toHaveBeenCalledTimes(1);
      });
    });

    it('AccountsListPage integration: opens modal, creates account, updates table cache, and renders confirmation toast', async () => {
      // Mock fetchAccounts to return empty initial list
      vi.spyOn(erp4Api, 'fetchAccounts').mockResolvedValue({
        items: [],
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        pageSize: 20,
        totalPages: 1,
      });

      // Mock createAccount
      vi.spyOn(erp4Api, 'createAccount').mockResolvedValue(mockCreatedAccount);

      render(
        <MemoryRouter>
          <AccountsListPage />
        </MemoryRouter>
      );

      // Initially zero accounts
      await waitFor(() => {
        expect(screen.getByText(/total accounts/i)).toBeDefined();
      });

      // Click "+ New Account" button to open modal
      const newAccountBtn = screen.getByRole('button', { name: /create new account/i });
      fireEvent.click(newAccountBtn);

      // Modal appears
      expect(screen.getByRole('dialog')).toBeDefined();

      // Enter account information
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 1010/i), { target: { value: '1020' } });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Operating Checking/i), { target: { value: 'Payroll Operating Cash' } });

      // Submit form
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      // 1. Modal is closed
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      // 2. Confirmation toast is displayed with status role
      const toast = await screen.findByRole('status');
      expect(toast.textContent).toContain('Account 1020 — Payroll Operating Cash created successfully');

      // 3. Table cache is updated: row with 1020 is rendered in the list
      expect(screen.getByText('1020')).toBeDefined();
      expect(screen.getByText('Payroll Operating Cash')).toBeDefined();
    });
  });
});
