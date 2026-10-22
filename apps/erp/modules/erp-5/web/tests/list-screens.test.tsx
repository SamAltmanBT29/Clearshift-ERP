// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Remaining List Screen Tests
 *
 * The same acceptance criteria as the employee screen, applied to the other
 * four collections of the module: the department list, the leave list, the
 * payroll aggregate list and the read-only Hub Identity projection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DepartmentsListPage } from '../src/pages/DepartmentsListPage.js';
import { IdentityUsersListPage } from '../src/pages/IdentityUsersListPage.js';
import { LeaveListPage } from '../src/pages/LeaveListPage.js';
import { PayrollTotalsListPage } from '../src/pages/PayrollTotalsListPage.js';
import { installHrApiMock, listPage, type HrApiMock } from './support/api-mock.js';
import { clearStoredAccessToken, storeAccessToken, validAccessToken } from './support/session.js';

const TIMESTAMP = '2026-04-15T12:00:00.000Z';

const ENGINEERING = {
  id: 'd1000000-0000-4000-8000-000000000001',
  name: 'Engineering',
  code: 'ENG',
  parent_id: null,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

const PLATFORM = {
  id: 'd1000000-0000-4000-8000-000000000002',
  name: 'Platform',
  code: 'PLAT',
  parent_id: ENGINEERING.id,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

const SICK_LEAVE = {
  id: 'l1000000-0000-4000-8000-000000000001',
  employee_id: 'e1000000-0000-4000-8000-000000000001',
  date_from: '2026-03-02',
  date_to: '2026-03-04',
  type: 'sick',
  status: 'approved',
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

const PENDING_LEAVE = {
  id: 'l1000000-0000-4000-8000-000000000002',
  employee_id: 'e1000000-0000-4000-8000-000000000002',
  date_from: '2026-04-01',
  date_to: '2026-04-05',
  type: 'holiday',
  status: 'pending',
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

const PAYROLL_AGGREGATE = {
  id: 'p1000000-0000-4000-8000-000000000001',
  department_id: ENGINEERING.id,
  month: '2026-04',
  total_amount: '125000.0000',
  currency_code: 'INR',
  headcount: 12,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

const IDENTITY_USER = {
  id: 'h1000000-0000-4000-8000-000000000001',
  username: 'a.iyer',
  roles: ['viewer', 'editor'],
  employee_ref: 'e1000000-0000-4000-8000-000000000001',
  status: 'active',
};

function renderScreen(element: React.ReactElement): void {
  render(<MemoryRouter initialEntries={['/erp5']}>{element}</MemoryRouter>);
}

describe('ERP-5 remaining list screens', () => {
  let api: HrApiMock;

  beforeEach(() => {
    clearStoredAccessToken();
    storeAccessToken(validAccessToken());
    api = installHrApiMock({
      responses: {
        '/departments': listPage([ENGINEERING, PLATFORM]),
        '/leave': listPage([SICK_LEAVE, PENDING_LEAVE]),
        '/payroll-totals': listPage([PAYROLL_AGGREGATE]),
        '/identity-users': listPage([IDENTITY_USER]),
      },
    });
  });

  afterEach(() => {
    cleanup();
    clearStoredAccessToken();
    api.restore();
  });

  describe('1. Department list', () => {
    it('shows the departments the API returned', async () => {
      renderScreen(<DepartmentsListPage />);

      const table = await screen.findByRole('table', { name: 'Departments' });
      const rows = within(table).getAllByRole('row');
      expect(rows[1]?.textContent).toContain('Engineering');
      expect(rows[1]?.textContent).toContain('ENG');
    });

    it('resolves the parent department', async () => {
      renderScreen(<DepartmentsListPage />);

      const table = await screen.findByRole('table', { name: 'Departments' });
      const rows = within(table).getAllByRole('row');
      // The Platform row points at Engineering.
      expect(rows[2]?.textContent).toContain('Engineering');
    });

    it('sends the search to the server', async () => {
      renderScreen(<DepartmentsListPage />);

      fireEvent.change(screen.getByLabelText('Search departments'), {
        target: { value: 'plat' },
      });

      await waitFor(() => {
        expect(
          api.callsTo('/departments').some((call) => call.query.get('search') === 'plat')
        ).toBe(true);
      });
    });

    it('sends the sort field to the server', async () => {
      renderScreen(<DepartmentsListPage />);

      fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'code' } });

      await waitFor(() => {
        expect(
          api.callsTo('/departments').some((call) => call.query.get('sort') === 'code')
        ).toBe(true);
      });
    });

    it('shows an empty state when the API returns no department', async () => {
      api.restore();
      api = installHrApiMock({ responses: { '/departments': listPage([]) } });
      renderScreen(<DepartmentsListPage />);

      expect(await screen.findByText('No departments found')).toBeDefined();
    });
  });

  describe('2. Leave list', () => {
    it('shows the leave records with their period, type and status', async () => {
      renderScreen(<LeaveListPage />);

      const table = await screen.findByRole('table', { name: 'Leave records' });
      expect(within(table).getByText('2026-03-02')).toBeDefined();
      expect(within(table).getByText('sick')).toBeDefined();
      expect(within(table).getByText('APPROVED')).toBeDefined();
    });

    it('sends the type filter to the server', async () => {
      renderScreen(<LeaveListPage />);
      await waitFor(() => expect(api.callsTo('/leave')).toHaveLength(1));

      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'sick' } });

      await waitFor(() => {
        expect(api.lastCallTo('/leave')?.query.get('type')).toBe('sick');
      });
    });

    it('sends the status filter to the server', async () => {
      renderScreen(<LeaveListPage />);
      await waitFor(() => expect(api.callsTo('/leave')).toHaveLength(1));

      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'pending' } });

      await waitFor(() => {
        expect(api.lastCallTo('/leave')?.query.get('status')).toBe('pending');
      });
    });

    it('offers no search box, because the endpoint has no search parameter', async () => {
      renderScreen(<LeaveListPage />);

      // The collection is loaded first, so the assertion runs against a
      // settled screen.
      await screen.findByRole('table', { name: 'Leave records' });
      expect(screen.queryByLabelText('Search leave records')).toBeNull();
    });

    it('links the record to the employee it belongs to', async () => {
      renderScreen(<LeaveListPage />);

      const link = await screen.findByRole('link', {
        name: `View employee ${SICK_LEAVE.employee_id}`,
      });
      expect(link.getAttribute('href')).toBe(`/erp5/employees/${SICK_LEAVE.employee_id}`);
    });
  });

  describe('3. Payroll totals list', () => {
    it('shows the department/month aggregate', async () => {
      renderScreen(<PayrollTotalsListPage />);

      const table = await screen.findByRole('table', { name: 'Payroll totals' });
      expect(within(table).getByText('2026-04')).toBeDefined();
      expect(within(table).getByText('125,000')).toBeDefined();
      expect(within(table).getByText('12')).toBeDefined();
    });

    it('never shows an employee row', async () => {
      renderScreen(<PayrollTotalsListPage />);

      const table = await screen.findByRole('table', { name: 'Payroll totals' });
      const headers = within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent);

      expect(headers).not.toContain('Employee');
      expect(headers).not.toContain('First name');
      expect(headers).not.toContain('Last name');
    });

    it('sends the month filter to the server', async () => {
      renderScreen(<PayrollTotalsListPage />);
      await waitFor(() => expect(api.callsTo('/payroll-totals')).toHaveLength(1));

      fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-04' } });

      await waitFor(() => {
        expect(api.lastCallTo('/payroll-totals')?.query.get('month')).toBe('2026-04');
      });
    });

    it('sends the department filter to the server', async () => {
      renderScreen(<PayrollTotalsListPage />);
      await waitFor(() => expect(api.callsTo('/payroll-totals')).toHaveLength(1));

      const filter = await screen.findByLabelText('Department');
      fireEvent.change(filter, { target: { value: ENGINEERING.id } });

      await waitFor(() => {
        expect(api.lastCallTo('/payroll-totals')?.query.get('department_id')).toBe(
          ENGINEERING.id
        );
      });
    });
  });

  describe('4. Identity users list', () => {
    it('shows the read-only projection', async () => {
      renderScreen(<IdentityUsersListPage />);

      const table = await screen.findByRole('table', { name: 'Identity users' });
      expect(within(table).getByText('a.iyer')).toBeDefined();
      expect(within(table).getByText('viewer, editor')).toBeDefined();
      expect(within(table).getByText('ACTIVE')).toBeDefined();
    });

    it('shows no credential column', async () => {
      renderScreen(<IdentityUsersListPage />);

      const table = await screen.findByRole('table', { name: 'Identity users' });
      const headers = within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent);

      expect(headers).not.toContain('Password');
      expect(headers).not.toContain('Token');
      expect(headers).not.toContain('Secret');
      expect(headers).not.toContain('Refresh token');
    });

    it('sends the search to the server', async () => {
      renderScreen(<IdentityUsersListPage />);

      fireEvent.change(screen.getByLabelText('Search identity users'), {
        target: { value: 'a.iyer' },
      });

      await waitFor(() => {
        expect(
          api.callsTo('/identity-users').some((call) => call.query.get('search') === 'a.iyer')
        ).toBe(true);
      });
    });

    it('shows a user without a linked employee and without a role', async () => {
      api.restore();
      api = installHrApiMock({
        responses: {
          '/identity-users': listPage([
            {
              id: 'h1000000-0000-4000-8000-000000000002',
              username: 'service.account',
              roles: [],
              employee_ref: null,
              status: 'disabled',
            },
          ]),
        },
      });
      renderScreen(<IdentityUsersListPage />);

      const table = await screen.findByRole('table', { name: 'Identity users' });
      expect(within(table).getByText('service.account')).toBeDefined();
      expect(within(table).getAllByText('—')).toHaveLength(2);
      expect(within(table).getByText('DISABLED')).toBeDefined();
    });

    it('explains an empty projection instead of showing a failure', async () => {
      api.restore();
      api = installHrApiMock({ responses: { '/identity-users': listPage([]) } });
      renderScreen(<IdentityUsersListPage />);

      expect(await screen.findByText('No identity users found')).toBeDefined();
      expect(screen.getByText(/The Hub Identity projection is empty/)).toBeDefined();
    });
  });

  describe('5. The shared states', () => {
    it('shows a skeleton while the page is loading', async () => {
      api.restore();
      api = installHrApiMock({ pending: true });
      renderScreen(<LeaveListPage />);

      const skeleton = await screen.findByRole('status');
      expect(skeleton.getAttribute('aria-busy')).toBe('true');
    });

    it('shows the access-denied state on a 403 instead of the error state', async () => {
      api.restore();
      api = installHrApiMock({ failure: { status: 403 } });
      renderScreen(<LeaveListPage />);

      expect(await screen.findByText('Access denied')).toBeDefined();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('offers a retry on a recoverable failure', async () => {
      api.restore();
      api = installHrApiMock({ failure: { status: 503 } });
      renderScreen(<DepartmentsListPage />);

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('Unable to load the department list');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
    });

    it('never renders a hard-coded row when the API is empty', async () => {
      api.restore();
      api = installHrApiMock({ responses: { '/leave': listPage([]) } });
      renderScreen(<LeaveListPage />);

      await screen.findByText('No leave records found');
      const table = screen.queryByRole('table');
      expect(table).toBeNull();
    });
  });
});
