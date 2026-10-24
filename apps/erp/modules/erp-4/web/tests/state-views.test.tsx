// @vitest-environment jsdom
/**
 * Automated Verification Suite for ERP4-19: Loading, Empty, Error, and Access-Denied States
 *
 * Verifies Acceptance Criteria:
 * 1. [x] Table displays animated skeleton placeholder during initial data fetching.
 * 2. [x] Zero-data condition shows helpful empty state with call-to-action button.
 * 3. [x] API failure displays alert banner with retry action; raw error stack traces are hidden.
 * 4. [x] 403 Forbidden response renders access-denied view explaining missing role.
 *
 * @module erp4/web/tests/state-views
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { installNavigationRequestShim } from './support/jsdom-environment.js';
import {
  SkeletonTable,
  EmptyState,
  ErrorAlert,
  ErrorState,
  AccessDeniedView,
  sanitizeErrorMessage,
  containsRawStackTrace,
  DEFAULT_FINANCE_ROLES,
} from '../src/components/StateViews.js';
import { AccountsTable } from '../src/components/AccountsTable.js';
import { JournalEntriesTable } from '../src/components/JournalEntriesTable.js';
import { ApiError } from '../src/api/erp-4.js';

installNavigationRequestShim();

describe('ERP4-19: Screen States & Error Sanitization Suite', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. Acceptance Criterion: Table displays animated skeleton placeholder during initial data fetching
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Animated Skeleton Placeholder (Loading State)', () => {
    it('renders skeleton table placeholder with role="status", aria-busy="true", and animated pulse', () => {
      render(<SkeletonTable columns={5} rows={6} />);

      const statusEl = screen.getByRole('status');
      expect(statusEl).toBeDefined();
      expect(statusEl.getAttribute('aria-busy')).toBe('true');
      expect(statusEl.className).toContain('animate-pulse');

      // Accessible screen-reader text is present
      expect(screen.getByText(/loading content, please wait/i)).toBeDefined();
      expect(screen.getByText(/loading data from api/i)).toBeDefined();

      // Structure has table, thead, tbody, th, and td
      const theadCells = statusEl.querySelectorAll('thead th');
      expect(theadCells.length).toBe(5);

      const tbodyRows = statusEl.querySelectorAll('tbody tr');
      expect(tbodyRows.length).toBe(6);
    });

    it('renders skeleton table in AccountsTable during initial data fetching (isLoading=true)', () => {
      render(
        <MemoryRouter>
          <AccountsTable
            accounts={[]}
            isLoading={true}
            total={0}
            page={1}
            totalPages={1}
            onPageChange={vi.fn()}
          />
        </MemoryRouter>
      );

      const skeleton = screen.getByRole('status');
      expect(skeleton).toBeDefined();
      expect(skeleton.getAttribute('aria-busy')).toBe('true');
      expect(skeleton.className).toContain('animate-pulse');
      // Real table caption should not be present while loading
      expect(screen.queryByText('Chart of Accounts')).toBeNull();
    });

    it('renders skeleton table in JournalEntriesTable during initial data fetching (isLoading=true)', () => {
      render(
        <MemoryRouter>
          <JournalEntriesTable
            entries={[]}
            isLoading={true}
            total={0}
            page={1}
            totalPages={1}
            onPageChange={vi.fn()}
          />
        </MemoryRouter>
      );

      const skeleton = screen.getByRole('status');
      expect(skeleton).toBeDefined();
      expect(skeleton.getAttribute('aria-busy')).toBe('true');
      expect(screen.queryByText('Journal Entries Ledger')).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Acceptance Criterion: Zero-data condition shows helpful empty state with call-to-action button
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Helpful Empty State with Call-to-Action Button', () => {
    it('renders empty state region with icon, title, description, and primary CTA button', () => {
      const handleAction = vi.fn();

      render(
        <EmptyState
          icon="📂"
          title="No accounts found"
          message="No chart of accounts records match your current criteria. Create your first account."
          actionLabel="+ New Account"
          onAction={handleAction}
        />
      );

      const region = screen.getByRole('region', { name: /empty state results/i });
      expect(region).toBeDefined();
      expect(screen.getByText('📂')).toBeDefined();
      expect(screen.getByText('No accounts found')).toBeDefined();
      expect(screen.getByText(/create your first account/i)).toBeDefined();

      const ctaBtn = screen.getByRole('button', { name: '+ New Account' });
      expect(ctaBtn).toBeDefined();

      fireEvent.click(ctaBtn);
      expect(handleAction).toHaveBeenCalledTimes(1);
    });

    it('renders secondary action button when provided', () => {
      const handlePrimary = vi.fn();
      const handleSecondary = vi.fn();

      render(
        <EmptyState
          title="Zero records"
          actionLabel="Primary Action"
          onAction={handlePrimary}
          secondaryActionLabel="Clear Filters"
          onSecondaryAction={handleSecondary}
        />
      );

      const secBtn = screen.getByRole('button', { name: 'Clear Filters' });
      fireEvent.click(secBtn);
      expect(handleSecondary).toHaveBeenCalledTimes(1);
    });

    it('AccountsTable displays empty state with CTA button on zero records', () => {
      const handleCreate = vi.fn();
      const handleRefresh = vi.fn();

      render(
        <MemoryRouter>
          <AccountsTable
            accounts={[]}
            isLoading={false}
            total={0}
            page={1}
            totalPages={1}
            onPageChange={vi.fn()}
            onCreateAccount={handleCreate}
            onRefresh={handleRefresh}
          />
        </MemoryRouter>
      );

      expect(screen.getByText('No accounts found')).toBeDefined();
      const ctaBtn = screen.getByRole('button', { name: '+ New Account' });
      expect(ctaBtn).toBeDefined();

      fireEvent.click(ctaBtn);
      expect(handleCreate).toHaveBeenCalledTimes(1);

      const refreshBtn = screen.getByRole('button', { name: 'Refresh Accounts' });
      fireEvent.click(refreshBtn);
      expect(handleRefresh).toHaveBeenCalledTimes(1);
    });

    it('JournalEntriesTable displays empty state with CTA button on zero records', () => {
      const handleCreate = vi.fn();
      const handleRefresh = vi.fn();

      render(
        <MemoryRouter>
          <JournalEntriesTable
            entries={[]}
            isLoading={false}
            total={0}
            page={1}
            totalPages={1}
            onPageChange={vi.fn()}
            onCreateEntry={handleCreate}
            onRefresh={handleRefresh}
          />
        </MemoryRouter>
      );

      expect(screen.getByText('No journal entries found')).toBeDefined();
      const ctaBtn = screen.getByRole('button', { name: '+ New Journal Entry' });
      expect(ctaBtn).toBeDefined();

      fireEvent.click(ctaBtn);
      expect(handleCreate).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Acceptance Criterion: API failure displays alert banner with retry action; raw error stack traces are hidden
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. API Failure Alert Banner & Raw Stack Trace Sanitization', () => {
    it('detects and suppresses raw stack traces, Node engine errors, and internal SQL statements', () => {
      const stackTrace = `TypeError: Cannot read properties of undefined (reading 'rows')
    at Object.fetchAccounts (file:///apps/erp/modules/erp-4/src/services/finance.service.ts:145:22)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;

      expect(containsRawStackTrace(stackTrace)).toBe(true);

      const sqlLeak = `Error: SELECT id, code, name FROM erp4_accounts WHERE tenant_id = 'xxx' failed with ECONNREFUSED`;
      expect(containsRawStackTrace(sqlLeak)).toBe(true);

      // Sanitizer strips all raw stack traces and leaks
      const sanitized = sanitizeErrorMessage(new Error(stackTrace));
      expect(sanitized.title).toBe('Server Communication Error');
      expect(sanitized.message).not.toContain('TypeError');
      expect(sanitized.message).not.toContain('finance.service.ts');
      expect(sanitized.message).not.toContain('processTicksAndRejections');
      expect(sanitized.message).toContain('server or network error occurred');

      const sanitizedSql = sanitizeErrorMessage(new Error(sqlLeak));
      expect(sanitizedSql.message).not.toContain('SELECT id, code');
      expect(sanitizedSql.message).not.toContain('erp4_accounts');
    });

    it('translates standard ClearShift financial domain error codes to helpful business messages', () => {
      const unbalancedErr = new ApiError(400, 'JOURNAL_UNBALANCED', 'Unbalanced');
      const sanitizedUnbalanced = sanitizeErrorMessage(unbalancedErr);
      expect(sanitizedUnbalanced.title).toBe('Double-Entry Invariant Violation');
      expect(sanitizedUnbalanced.message).toContain('total debits must equal total credits');

      const closedErr = new ApiError(400, 'PERIOD_CLOSED', 'Closed');
      const sanitizedClosed = sanitizeErrorMessage(closedErr);
      expect(sanitizedClosed.title).toBe('Accounting Period Closed');
      expect(sanitizedClosed.message).toContain('Transactions and postings cannot be recorded in closed periods');

      const softClosedErr = new ApiError(403, 'PERIOD_SOFT_CLOSED', 'Soft closed');
      const sanitizedSoftClosed = sanitizeErrorMessage(softClosedErr);
      expect(sanitizedSoftClosed.isForbidden).toBe(true);
      expect(sanitizedSoftClosed.requiredRoles).toEqual(DEFAULT_FINANCE_ROLES);
    });

    it('ErrorAlert displays alert banner with role="alert", sanitized text, and working retry button', () => {
      const handleRetry = vi.fn();
      const rawErrorWithStack = new Error(
        `Database query failed\n    at queryDb (/internal/db.ts:40:10)\n    at node_modules/pg/lib/client.js:521:7`
      );

      render(
        <ErrorAlert
          error={rawErrorWithStack}
          onRetry={handleRetry}
        />
      );

      const alertEl = screen.getByRole('alert');
      expect(alertEl).toBeDefined();

      // Title & message are sanitized — no internal paths visible
      expect(screen.getByText('Server Communication Error')).toBeDefined();
      expect(alertEl.textContent).not.toContain('queryDb');
      expect(alertEl.textContent).not.toContain('client.js');

      // Retry button is present and triggers callback
      const retryBtn = screen.getByRole('button', { name: /retry failed operation/i });
      expect(retryBtn).toBeDefined();
      fireEvent.click(retryBtn);
      expect(handleRetry).toHaveBeenCalledTimes(1);
    });

    it('ErrorAlert dismiss button calls onDismiss', () => {
      const handleDismiss = vi.fn();

      render(
        <ErrorAlert
          title="Network Warning"
          message="Connection restored."
          onDismiss={handleDismiss}
        />
      );

      const dismissBtn = screen.getByRole('button', { name: /dismiss alert/i });
      fireEvent.click(dismissBtn);
      expect(handleDismiss).toHaveBeenCalledTimes(1);
    });

    it('ErrorState card sanitizes errors and provides retry button', () => {
      const handleRetry = vi.fn();
      const rawError = new Error('ECONNREFUSED 127.0.0.1:5432');

      render(
        <ErrorState
          error={rawError}
          onRetry={handleRetry}
        />
      );

      const alert = screen.getByRole('alert');
      expect(alert).toBeDefined();
      expect(screen.getByText('Server Communication Error')).toBeDefined();
      expect(alert.textContent).not.toContain('5432');

      const retryBtn = screen.getByRole('button', { name: 'Retry Request' });
      fireEvent.click(retryBtn);
      expect(handleRetry).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Acceptance Criterion: 403 Forbidden response renders access-denied view explaining missing role
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. 403 Forbidden & Access-Denied View', () => {
    it('AccessDeniedView renders accessible region explaining missing role', () => {
      const handleRetry = vi.fn();
      const handleBack = vi.fn();

      render(
        <MemoryRouter>
          <AccessDeniedView
            title="Access Denied (403 Forbidden)"
            message="You do not have permissions to post to General Ledger."
            resourceName="General Ledger"
            requiredRoles={['Finance Admin', 'Finance Controller']}
            currentRole="Viewer"
            onRetry={handleRetry}
            onBack={handleBack}
          />
        </MemoryRouter>
      );

      const region = screen.getByRole('region', { name: 'Access Denied' });
      expect(region).toBeDefined();

      expect(screen.getByText('Access Denied (403 Forbidden)')).toBeDefined();
      expect(screen.getByText(/you do not have permissions to post to general ledger/i)).toBeDefined();

      // Required roles are listed
      expect(screen.getByText('Finance Admin')).toBeDefined();
      expect(screen.getByText('Finance Controller')).toBeDefined();

      // Current role is displayed
      expect(screen.getByText(/your current active role is:/i)).toBeDefined();
      expect(screen.getByText('Viewer')).toBeDefined();

      // Guidance to contact administrator/PMO is displayed
      expect(screen.getByText(/contact your organization administrator or pmo security officer/i)).toBeDefined();

      // Back button invokes onBack
      const backBtn = screen.getByRole('button', { name: '← Go Back' });
      fireEvent.click(backBtn);
      expect(handleBack).toHaveBeenCalledTimes(1);

      // Return to Finance Overview link is present
      const overviewLink = screen.getByRole('link', { name: 'Return to Finance Overview' });
      expect(overviewLink.getAttribute('href')).toBe('/erp4');

      // Retry button invokes onRetry
      const retryBtn = screen.getByRole('button', { name: 'Retry Request' });
      fireEvent.click(retryBtn);
      expect(handleRetry).toHaveBeenCalledTimes(1);
    });

    it('ErrorState automatically renders AccessDeniedView when given a 403 ApiError', () => {
      const forbiddenError = new ApiError(403, 'FORBIDDEN', 'Role finance_admin required');

      render(
        <MemoryRouter>
          <ErrorState error={forbiddenError} />
        </MemoryRouter>
      );

      // It must render the Access Denied region, not the generic error card
      const accessDenied = screen.getByRole('region', { name: 'Access Denied' });
      expect(accessDenied).toBeDefined();
      expect(screen.getByText('Access Denied (403 Forbidden)')).toBeDefined();

      // Explains required finance roles
      expect(screen.getByText('Finance Admin')).toBeDefined();
      expect(screen.getByText('Finance Editor')).toBeDefined();
      expect(screen.getByText('Finance Viewer')).toBeDefined();
    });

    it('ErrorState automatically renders AccessDeniedView when given an error with code="FORBIDDEN"', () => {
      const forbiddenObj = { code: 'FORBIDDEN', message: 'Missing required role' };

      render(
        <MemoryRouter>
          <ErrorState error={forbiddenObj} />
        </MemoryRouter>
      );

      expect(screen.getByRole('region', { name: 'Access Denied' })).toBeDefined();
      expect(screen.getByText(/access policy requirements/i)).toBeDefined();
    });
  });
});
