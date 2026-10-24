// @vitest-environment jsdom
/**
 * ERP-4 Finance and Accounting — Detail/Edit Workflow and Linked Records Suite
 *
 * Validates all Acceptance Criteria for Issue #177 / ERP4-21:
 * - AC1: Detail view displays all primary attributes, created_at, updated_at, and Golden ID where applicable.
 * - AC2: Inline edit or drawer form allows updating allowlisted fields with permission checking.
 * - AC3: Linked entity sub-tables display related master records with navigation links to owning modules.
 * - AC4: Concurrent modification conflicts (HTTP 409) prompt user to refresh and re-apply changes.
 *
 * @module erp4/web/tests/detail-edit-workflow.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Account } from '@clearshift/contracts';
import { AccountDetailPage } from '../src/pages/AccountDetailPage.js';
import { AccountEditPage } from '../src/pages/AccountEditPage.js';
import { AccountAuditPanel, resolveGoldenId, formatDateTime } from '../src/components/AccountAuditPanel.js';
import { AccountLinkedRecordsTable } from '../src/components/AccountLinkedRecordsTable.js';
import { AccountEditDrawer } from '../src/components/AccountEditDrawer.js';
import * as erp4Api from '../src/api/erp-4.js';

describe('ERP4-21: Detail/Edit Workflow and Linked Records (#177)', () => {
  const syntheticAccount: Account = {
    id: 'a0000000-0001-0001-0001-000000000001',
    code: '1010-CASH',
    name: 'Operating Petty Cash Account',
    type: 'asset',
    currency_code: 'USD',
    parent_id: null,
    description: 'Main operating petty cash reserve for headquarters.',
    is_active: true,
    is_posting_account: true,
    created_at: '2026-04-01T08:00:00.000Z',
    updated_at: '2026-04-15T12:30:00.000Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC1: Detail view displays all primary attributes, created_at, updated_at, and Golden ID
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Acceptance Criterion 1: Primary Attributes, Timestamps & Golden ID', () => {
    it('resolves deterministic Golden ID with fallback GLD-ACC-<UUID_PREFIX>', () => {
      const golden = resolveGoldenId(syntheticAccount);
      expect(golden).toBe('GLD-ACC-A0000000');
    });

    it('preserves existing golden_id property when present', () => {
      const withGolden = {
        ...syntheticAccount,
        golden_id: 'GLD-SAP-ACC-9988',
      };
      expect(resolveGoldenId(withGolden)).toBe('GLD-SAP-ACC-9988');
    });

    it('formats ISO timestamps cleanly and gracefully handles invalid dates', () => {
      const formatted = formatDateTime('2026-04-01T08:00:00.000Z');
      expect(formatted).toContain('2026');
      expect(formatDateTime('')).toBe('—');
      expect(formatDateTime(null)).toBe('—');
    });

    it('renders AccountAuditPanel with created_at, updated_at, Golden ID, and canonical badge', () => {
      render(<AccountAuditPanel account={syntheticAccount} />);

      expect(screen.getByTestId('audit-golden-id').textContent).toBe('GLD-ACC-A0000000');
      expect(screen.getByText('Canonical')).toBeDefined();
      expect(screen.getByTestId('audit-account-id').textContent).toBe(syntheticAccount.id);
      expect(screen.getByTestId('audit-account-code').textContent).toBe('1010-CASH');
      expect(screen.getByTestId('audit-created-at')).toBeDefined();
      expect(screen.getByTestId('audit-updated-at')).toBeDefined();
    });

    it('renders all primary attributes in AccountDetailPage', async () => {
      vi.spyOn(erp4Api, 'fetchAccountById').mockResolvedValue(syntheticAccount);

      render(
        <MemoryRouter initialEntries={[`/erp4/accounts/${syntheticAccount.id}`]}>
          <Routes>
            <Route
              path="/erp4/accounts/:accountId"
              element={<AccountDetailPage initialAccount={syntheticAccount} />}
            />
          </Routes>
        </MemoryRouter>
      );

      // Primary attributes
      expect(screen.getByText('1010-CASH · Operating Petty Cash Account')).toBeDefined();
      expect(screen.getByText('Operating Petty Cash Account')).toBeDefined();
      expect(screen.getByText('Main operating petty cash reserve for headquarters.')).toBeDefined();
      expect(screen.getByTestId('audit-golden-id').textContent).toBe('GLD-ACC-A0000000');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC2: Inline edit or drawer form allows updating allowlisted fields with permission checking
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Acceptance Criterion 2: Inline & Drawer Edit with Allowlist & Permissions', () => {
    it('disables edit actions and displays read-only banner when user lacks edit permissions', () => {
      render(
        <MemoryRouter initialEntries={[`/erp4/accounts/${syntheticAccount.id}`]}>
          <AccountDetailPage
            initialAccount={syntheticAccount}
            canEdit={false}
            userPermissions={['viewer']}
          />
        </MemoryRouter>
      );

      // Verify read-only notice
      expect(screen.getByText(/You are viewing this account with read-only permissions/i)).toBeDefined();

      // Inline edit and drawer edit buttons should be disabled
      const inlineBtn = screen.getByRole('button', { name: /Inline Edit/i });
      expect((inlineBtn as HTMLButtonElement).disabled).toBe(true);

      const drawerBtn = screen.getByRole('button', { name: /Edit in Drawer/i });
      expect((drawerBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('enables inline edit mode and updates allowlisted fields (name, description, is_active)', async () => {
      const updateSpy = vi.spyOn(erp4Api, 'updateAccount').mockResolvedValue({
        ...syntheticAccount,
        name: 'Updated Operating Cash',
        description: 'New operational description',
      });

      render(
        <MemoryRouter initialEntries={[`/erp4/accounts/${syntheticAccount.id}`]}>
          <AccountDetailPage initialAccount={syntheticAccount} canEdit={true} />
        </MemoryRouter>
      );

      // Click Inline Edit button
      const inlineBtn = screen.getByRole('button', { name: /Inline Edit/i });
      fireEvent.click(inlineBtn);

      // Verify inline inputs are rendered
      const nameInput = screen.getByLabelText(/Account Name \*/i) as HTMLInputElement;
      expect(nameInput.value).toBe(syntheticAccount.name);

      // Modify allowlisted fields
      fireEvent.change(nameInput, { target: { value: 'Updated Operating Cash' } });
      const descInput = screen.getByLabelText(/Description/i) as HTMLTextAreaElement;
      fireEvent.change(descInput, { target: { value: 'New operational description' } });

      // Save inline
      const saveBtn = screen.getByRole('button', { name: /Save Inline/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(syntheticAccount.id, {
          name: 'Updated Operating Cash',
          description: 'New operational description',
          is_active: true,
        });
      });
    });

    it('validates required name field in inline edit mode', async () => {
      render(
        <MemoryRouter initialEntries={[`/erp4/accounts/${syntheticAccount.id}`]}>
          <AccountDetailPage initialAccount={syntheticAccount} canEdit={true} />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /Inline Edit/i }));
      const nameInput = screen.getByLabelText(/Account Name \*/i);
      fireEvent.change(nameInput, { target: { value: '   ' } });

      fireEvent.click(screen.getByRole('button', { name: /Save Inline/i }));

      expect(screen.getByText('Account name is required.')).toBeDefined();
    });

    it('opens AccountEditDrawer and allows saving allowlisted fields', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();

      render(
        <AccountEditDrawer
          isOpen={true}
          account={syntheticAccount}
          canEdit={true}
          onClose={onClose}
          onSave={onSave}
        />
      );

      // Account code should be locked
      expect(screen.getByText('1010-CASH')).toBeDefined();

      const nameInput = screen.getByLabelText(/Account Name \*/i) as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'Drawer Renamed Account' } });

      const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith({
          name: 'Drawer Renamed Account',
          description: syntheticAccount.description,
          is_active: true,
        });
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC3: Linked entity sub-tables display related master records with navigation links
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Acceptance Criterion 3: Linked Entity Sub-Tables & Navigation Links', () => {
    it('displays related sub-tables with count badges across all modules', () => {
      render(
        <MemoryRouter>
          <AccountLinkedRecordsTable
            accountId={syntheticAccount.id}
            accountCode={syntheticAccount.code}
            currencyCode={syntheticAccount.currency_code}
          />
        </MemoryRouter>
      );

      // Check tab buttons and count badges
      expect(screen.getByRole('tab', { name: /All Linked/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /Journal Entries \(3\)/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /ERP-2 Bills \(2\)/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /ERP-3 Invoices \(2\)/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /ERP-5 Payroll \(1\)/i })).toBeDefined();

      // Check ERP-4 Journal entry rows
      expect(screen.getByText('JE-2026-1010-CASH-001')).toBeDefined();
      expect(screen.getByText('Opening balance journal entry')).toBeDefined();

      // Check ERP-2 Vendor bills
      expect(screen.getByText('BILL-2026-081')).toBeDefined();
      expect(screen.getByText('Apex Logistics Corp')).toBeDefined();

      // Check ERP-3 Customer invoices
      expect(screen.getByText('INV-2026-0421')).toBeDefined();
      expect(screen.getByText('Acme Enterprise Ltd')).toBeDefined();

      // Check ERP-5 Payroll records
      expect(screen.getByText('PAY-2026-M04')).toBeDefined();
    });

    it('invokes onNavigateModule callback when cross-module link is clicked', () => {
      const onNavigate = vi.fn();

      render(
        <MemoryRouter>
          <AccountLinkedRecordsTable
            accountId={syntheticAccount.id}
            accountCode={syntheticAccount.code}
            onNavigateModule={onNavigate}
          />
        </MemoryRouter>
      );

      // Click ERP-2 Purchasing link
      const erp2Link = screen.getAllByRole('link', { name: /ERP-2 Purchasing/i })[0]!;
      fireEvent.click(erp2Link);

      expect(onNavigate).toHaveBeenCalledWith('erp2', `bill-${syntheticAccount.id.slice(0, 8)}-01`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC4: Concurrent modification conflicts (409) prompt user to refresh and re-apply
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Acceptance Criterion 4: HTTP 409 Concurrent Modification Handling', () => {
    it('prompts user with conflict banner and refresh button when update throws 409', async () => {
      const conflictError = new erp4Api.ApiError(
        409,
        'CONFLICT',
        'Record was concurrently modified by another operator.'
      );
      vi.spyOn(erp4Api, 'updateAccount').mockRejectedValue(conflictError);
      const fetchSpy = vi.spyOn(erp4Api, 'fetchAccountById').mockResolvedValue({
        ...syntheticAccount,
        name: 'Server Latest Account Name',
      });

      render(
        <MemoryRouter initialEntries={[`/erp4/accounts/${syntheticAccount.id}`]}>
          <AccountDetailPage initialAccount={syntheticAccount} canEdit={true} />
        </MemoryRouter>
      );

      // Trigger inline edit save
      fireEvent.click(screen.getByRole('button', { name: /Inline Edit/i }));
      fireEvent.click(screen.getByRole('button', { name: /Save Inline/i }));

      // Expect conflict alert banner to appear
      await waitFor(() => {
        expect(screen.getByTestId('concurrent-conflict-banner')).toBeDefined();
        expect(screen.getByText(/Concurrent Modification Conflict \(HTTP 409\)/i)).toBeDefined();
      });

      // Click refresh button in conflict prompt
      const refreshBtn = screen.getByTestId('conflict-refresh-btn');
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(syntheticAccount.id);
        expect(screen.queryByTestId('concurrent-conflict-banner')).toBeNull();
      });
    });

    it('handles 409 conflict in AccountEditPage full-page workflow', async () => {
      const conflictError = new erp4Api.ApiError(
        409,
        'CONFLICT',
        'Version mismatch: Account was modified concurrently.'
      );
      vi.spyOn(erp4Api, 'updateAccount').mockRejectedValue(conflictError);
      const fetchSpy = vi.spyOn(erp4Api, 'fetchAccountById').mockResolvedValue(syntheticAccount);

      render(
        <MemoryRouter initialEntries={[`/erp4/accounts/${syntheticAccount.id}/edit`]}>
          <Routes>
            <Route
              path="/erp4/accounts/:accountId/edit"
              element={<AccountEditPage initialAccount={syntheticAccount} canEdit={true} />}
            />
          </Routes>
        </MemoryRouter>
      );

      const submitBtn = screen.getByRole('button', { name: /Save Changes/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('concurrent-conflict-banner')).toBeDefined();
      });

      const refreshBtn = screen.getByTestId('conflict-refresh-btn');
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(syntheticAccount.id);
      });
    });
  });
});
