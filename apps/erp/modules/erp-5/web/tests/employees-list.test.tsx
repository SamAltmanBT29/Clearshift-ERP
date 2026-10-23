// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Employee List Screen Tests
 *
 * The acceptance evidence of ERP5-04 for the primary collection screen:
 * initial load, search and filter, the empty result, the API failure and its
 * recovery, the permission-denied state, page navigation, and the keyboard
 * and accessibility affordances.
 *
 * The screen is exercised against the **module API** — every assertion about
 * the data goes through a mocked `fetch`, and every assertion about the
 * query proves the request really carried the parameter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EmployeesListPage } from '../src/pages/EmployeesListPage.js';
import { installHrApiMock, listPage, type HrApiMock } from './support/api-mock.js';
import {
  accessTokenWithRoles,
  clearStoredAccessToken,
  storeAccessToken,
  validAccessToken,
} from './support/session.js';

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

const ASHA = {
  id: 'e1000000-0000-4000-8000-000000000001',
  employee_no: 'EMP-0001',
  first_name: 'Asha',
  last_name: 'Iyer',
  birth_date: '1990-04-12',
  join_date: '2024-01-08',
  department_id: ENGINEERING.id,
  job_title: 'Software Engineer',
  salary_display: 'XX,XXX',
  currency_code: 'INR',
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

const ROHAN = {
  id: 'e1000000-0000-4000-8000-000000000002',
  employee_no: 'EMP-0002',
  first_name: 'Rohan',
  last_name: 'Nair',
  birth_date: '1988-02-02',
  join_date: '2022-06-01',
  department_id: PLATFORM.id,
  job_title: 'Platform Engineer',
  salary_display: 'salary hidden',
  currency_code: 'INR',
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

function renderScreen(): void {
  render(
    <MemoryRouter initialEntries={['/erp5/employees']}>
      <EmployeesListPage />
    </MemoryRouter>
  );
}

describe('ERP-5 employee list screen', () => {
  let api: HrApiMock;

  beforeEach(() => {
    clearStoredAccessToken();
    storeAccessToken(validAccessToken());
    api = installHrApiMock({
      responses: {
        '/employees': listPage([ASHA, ROHAN], { total: 60, totalPages: 3 }),
        '/departments': listPage([ENGINEERING, PLATFORM]),
      },
    });
  });

  afterEach(() => {
    cleanup();
    clearStoredAccessToken();
    api.restore();
  });

  describe('1. Initial load', () => {
    it('asks the module API for the first page', async () => {
      renderScreen();

      await waitFor(() => expect(api.callsTo('/employees')).toHaveLength(1));
      const query = api.lastCallTo('/employees')?.query;
      expect(query?.get('page')).toBe('1');
      expect(query?.get('pageSize')).toBe('25');
    });

    it('shows the rows the API returned', async () => {
      renderScreen();

      expect(await screen.findByText('EMP-0001')).toBeDefined();
      expect(screen.getByText('EMP-0002')).toBeDefined();
      expect(screen.getByText('Asha')).toBeDefined();
      expect(screen.getByText('Software Engineer')).toBeDefined();
    });

    it('resolves the department name from the department collection', async () => {
      renderScreen();

      const table = await screen.findByRole('table', { name: 'Employees' });
      expect(within(table).getByText('Engineering')).toBeDefined();
      expect(within(table).getByText('Platform')).toBeDefined();
    });

    it('shows the masked salary only', async () => {
      renderScreen();

      expect(await screen.findByText('XX,XXX INR')).toBeDefined();
      expect(screen.getByText('salary hidden INR')).toBeDefined();
    });

    it('shows the row link to the employee screen', async () => {
      renderScreen();

      const link = await screen.findByRole('link', { name: 'View employee EMP-0001' });
      expect(link.getAttribute('href')).toBe(`/erp5/employees/${ASHA.id}`);
    });
  });

  describe('2. Search and filter', () => {
    it('sends the search term to the server', async () => {
      renderScreen();
      await waitFor(() => expect(api.callsTo('/employees')).toHaveLength(1));

      const search = screen.getByLabelText('Search employees');
      fireEvent.change(search, { target: { value: 'asha' } });

      await waitFor(() => {
        const query = api.lastCallTo('/employees')?.query;
        expect(query?.get('search')).toBe('asha');
      });
    });

    it('resets the page to the first one when the search changes', async () => {
      renderScreen();
      await waitFor(() => expect(api.callsTo('/employees')).toHaveLength(1));

      const page2 = await screen.findByRole('button', { name: 'Go to page 2' });
      fireEvent.click(page2);
      await waitFor(() => {
        expect(api.lastCallTo('/employees')?.query.get('page')).toBe('2');
      });

      fireEvent.change(screen.getByLabelText('Search employees'), {
        target: { value: 'asha' },
      });

      await waitFor(() => {
        expect(api.lastCallTo('/employees')?.query.get('page')).toBe('1');
      });
    });

    it('sends the department filter to the server', async () => {
      renderScreen();
      await waitFor(() => expect(api.callsTo('/employees')).toHaveLength(1));

      const filter = await screen.findByLabelText('Department');
      fireEvent.change(filter, { target: { value: PLATFORM.id } });

      await waitFor(() => {
        expect(api.lastCallTo('/employees')?.query.get('department_id')).toBe(PLATFORM.id);
      });
    });

    it('sends the sort field to the server', async () => {
      renderScreen();
      await waitFor(() => expect(api.callsTo('/employees')).toHaveLength(1));

      fireEvent.change(screen.getByLabelText('Sort by'), {
        target: { value: 'employee_no' },
      });

      await waitFor(() => {
        expect(api.lastCallTo('/employees')?.query.get('sort')).toBe('employee_no');
      });
    });

    it('never filters the returned page in the browser', async () => {
      renderScreen();
      await waitFor(() => expect(api.callsTo('/employees')).toHaveLength(1));

      fireEvent.change(screen.getByLabelText('Search employees'), {
        target: { value: 'asha' },
      });
      await waitFor(() => {
        expect(api.lastCallTo('/employees')?.query.get('search')).toBe('asha');
      });

      // The table still shows exactly what the API answered — the browser
      // does not narrow the page on its own.
      expect(screen.getByText('EMP-0001')).toBeDefined();
      expect(screen.getByText('EMP-0002')).toBeDefined();
    });

    it('clears every filter on request', async () => {
      renderScreen();
      await waitFor(() => expect(api.callsTo('/employees')).toHaveLength(1));

      fireEvent.change(screen.getByLabelText('Search employees'), {
        target: { value: 'asha' },
      });
      await waitFor(() => {
        expect(api.lastCallTo('/employees')?.query.get('search')).toBe('asha');
      });

      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

      await waitFor(() => {
        expect(api.lastCallTo('/employees')?.query.get('search')).toBeNull();
      });
    });
  });

  describe('3. Page navigation', () => {
    it('asks the server for the next page', async () => {
      renderScreen();
      await waitFor(() => expect(api.callsTo('/employees')).toHaveLength(1));

      const page2 = await screen.findByRole('button', { name: 'Go to page 2' });
      fireEvent.click(page2);

      await waitFor(() => {
        expect(api.lastCallTo('/employees')?.query.get('page')).toBe('2');
      });
    });

    it('shows the paging metadata of the server', async () => {
      renderScreen();

      const pagination = await screen.findByRole('navigation', { name: 'Pagination' });
      expect(within(pagination).getByText(/60 total items/)).toBeDefined();
    });
  });

  describe('4. The four states', () => {
    it('shows a skeleton while the page is loading', async () => {
      api.restore();
      api = installHrApiMock({ pending: true });
      renderScreen();

      const skeleton = await screen.findByRole('status');
      expect(skeleton.getAttribute('aria-busy')).toBe('true');
    });

    it('shows an empty state when the API returns no rows', async () => {
      api.restore();
      api = installHrApiMock({ responses: { '/employees': listPage([]) } });
      renderScreen();

      expect(await screen.findByText('No employees found')).toBeDefined();
      expect(screen.queryByText('EMP-0001')).toBeNull();
    });

    it('shows a recoverable error state when the API fails', async () => {
      api.restore();
      api = installHrApiMock({ failure: { status: 500 } });
      renderScreen();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('Unable to load the employee list');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
    });

    it('recovers from the error when the retry action is used', async () => {
      api.restore();
      api = installHrApiMock({ failure: { status: 500 } });
      renderScreen();
      await screen.findByRole('button', { name: 'Try again' });

      api.restore();
      api = installHrApiMock({
        responses: { '/employees': listPage([ASHA], { total: 1, totalPages: 1 }) },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('EMP-0001')).toBeDefined();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shows the access-denied state — not the error state — on a 403', async () => {
      api.restore();
      api = installHrApiMock({ failure: { status: 403 } });
      renderScreen();

      expect(await screen.findByText('Access denied')).toBeDefined();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(screen.queryByText('EMP-0001')).toBeNull();
    });
  });

  describe('5. Permission-aware actions', () => {
    it('offers the create action to a session that may write', async () => {
      clearStoredAccessToken();
      storeAccessToken(accessTokenWithRoles(['editor']));
      renderScreen();

      expect(await screen.findByRole('link', { name: 'New employee' })).toBeDefined();
    });

    it('offers no create action to a session that may only read', async () => {
      clearStoredAccessToken();
      storeAccessToken(accessTokenWithRoles(['viewer']));
      renderScreen();

      await screen.findByText('EMP-0001');
      expect(screen.queryByRole('link', { name: 'New employee' })).toBeNull();
    });
  });

  describe('6. Keyboard and accessibility', () => {
    it('exposes the search as a labelled native input', async () => {
      renderScreen();
      const search = await screen.findByLabelText('Search employees');

      expect(search.tagName).toBe('INPUT');
      expect(search.getAttribute('type')).toBe('search');
      expect(search.getAttribute('tabindex')).not.toBe('-1');
    });

    it('exposes the filters as labelled native selects', async () => {
      renderScreen();
      const filter = await screen.findByLabelText('Department');

      expect(filter.tagName).toBe('SELECT');
      expect(filter.getAttribute('tabindex')).not.toBe('-1');
    });

    it('exposes the pagination as buttons inside a navigation landmark', async () => {
      renderScreen();
      const pagination = await screen.findByRole('navigation', { name: 'Pagination' });

      const next = within(pagination).getByRole('button', { name: 'Go to next page' });
      expect(next.tagName).toBe('BUTTON');
      expect(next.getAttribute('tabindex')).not.toBe('-1');
    });

    it('exposes the row action as a real link', async () => {
      renderScreen();
      const link = await screen.findByRole('link', { name: 'View employee EMP-0001' });

      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')).toBeTruthy();
    });

    it('puts the search controls in a search landmark before the table', async () => {
      renderScreen();
      const search = await screen.findByRole('search', { name: 'Search and filter employees' });
      const table = await screen.findByRole('table', { name: 'Employees' });

      // The landmark comes before the table in the document order, so a
      // keyboard operator meets the filters first.
      expect(
        search.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });
  });
});
