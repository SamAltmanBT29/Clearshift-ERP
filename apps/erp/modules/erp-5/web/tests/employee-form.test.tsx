// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Employee Form Tests
 *
 * The acceptance evidence of ERP5-05 for the employee workflow: the create
 * screen, the edit screen and the detail screen.
 *
 * The tests are written against the **contract**: the payload the form sends
 * is the payload the contract accepts, and the message the operator reads is
 * the message the contract defines.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EmployeeCreatePage } from '../src/pages/EmployeeCreatePage.js';
import { EmployeeDetailPage } from '../src/pages/EmployeeDetailPage.js';
import { EmployeeEditPage } from '../src/pages/EmployeeEditPage.js';
import { installHrApiMock, listPage, type HrApiMock } from './support/api-mock.js';
import {
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

/**
 * A form control by its label.
 *
 * The shared `FormField` marks a required control with a trailing asterisk,
 * so the label text is "Name*" — the query matches the start of the label.
 */
function byLabel(name: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`^${name}`));
}

/** The same control, waited for. */
async function findByLabel(name: string): Promise<HTMLElement> {
  return screen.findByLabelText(new RegExp(`^${name}`));
}

function renderCreate(): void {
  render(
    <MemoryRouter initialEntries={['/erp5/employees/new']}>
      <Routes>
        <Route path="/erp5/employees/new" element={<EmployeeCreatePage />} />
        <Route path="/erp5/employees" element={<p>Employee list</p>} />
        <Route path="/erp5/employees/:employeeId" element={<p>Employee detail</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderEdit(): void {
  render(
    <MemoryRouter initialEntries={[`/erp5/employees/${ASHA.id}/edit`]}>
      <Routes>
        <Route path="/erp5/employees/:employeeId/edit" element={<EmployeeEditPage />} />
        <Route path="/erp5/employees/:employeeId" element={<p>Employee detail</p>} />
        <Route path="/erp5/employees" element={<p>Employee list</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderDetail(): void {
  render(
    <MemoryRouter initialEntries={[`/erp5/employees/${ASHA.id}`]}>
      <Routes>
        <Route path="/erp5/employees/:employeeId" element={<EmployeeDetailPage />} />
        <Route path="/erp5/employees" element={<p>Employee list</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function fillEmployeeForm(): Promise<void> {
  fireEvent.change(byLabel('Employee number'), {
    target: { value: 'EMP-0009' },
  });
  fireEvent.change(byLabel('First name'), { target: { value: 'Nisha' } });
  fireEvent.change(byLabel('Last name'), { target: { value: 'Rao' } });
  fireEvent.change(byLabel('Birth date'), { target: { value: '1992-05-04' } });
  fireEvent.change(byLabel('Join date'), { target: { value: '2023-02-01' } });
  fireEvent.change(byLabel('Department'), {
    target: { value: ENGINEERING.id },
  });
  fireEvent.change(byLabel('Job title'), {
    target: { value: 'Data Engineer' },
  });
  fireEvent.change(byLabel('Salary'), { target: { value: '150000.5000' } });
}

describe('ERP-5 employee create, edit and detail screens', () => {
  let api: HrApiMock;

  beforeEach(() => {
    clearStoredAccessToken();
    storeAccessToken(validAccessToken());
    api = installHrApiMock({
      responses: {
        '/departments': listPage([ENGINEERING]),
        '/employees': listPage([ASHA]),
        '/employees/e1000000-0000-4000-8000-000000000001': ASHA,
      },
      writeResponses: {
        '/employees': ASHA,
        '/employees/e1000000-0000-4000-8000-000000000001': ASHA,
      },
    });
  });

  afterEach(() => {
    cleanup();
    clearStoredAccessToken();
    api.restore();
  });

  describe('1. The create screen', () => {
    it('links back to the list it belongs to', async () => {
      renderCreate();

      const back = await screen.findByRole('link', { name: /Back to the employee list/ });
      expect(back.getAttribute('href')).toBe('/erp5/employees');
    });

    it('sends the payload the contract defines', async () => {
      renderCreate();
      await findByLabel('Employee number');

      await fillEmployeeForm();
      fireEvent.click(screen.getByRole('button', { name: 'Create employee' }));

      await waitFor(() => expect(api.writes()).toHaveLength(1));

      const write = api.lastWrite();
      expect(write?.method).toBe('POST');
      expect(write?.path).toBe('/employees');
      expect(write?.body).toEqual({
        employee_no: 'EMP-0009',
        first_name: 'Nisha',
        last_name: 'Rao',
        birth_date: '1992-05-04',
        join_date: '2023-02-01',
        department_id: ENGINEERING.id,
        job_title: 'Data Engineer',
        salary: '150000.5000',
        currency_code: 'INR',
      });
    });

    it('shows the contract’s message when a value breaks a rule, and sends nothing', async () => {
      renderCreate();
      await findByLabel('Employee number');

      await fillEmployeeForm();
      // A join date before the birth date — BR-ERP5-01.
      fireEvent.change(byLabel('Join date'), {
        target: { value: '1991-01-01' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create employee' }));

      expect(
        await screen.findByText('join_date must not be before birth_date')
      ).toBeDefined();
      // Nothing was sent, so nothing can have been mutated.
      expect(api.writes()).toHaveLength(0);
    });

    it('shows the contract’s message for a malformed value, and sends nothing', async () => {
      renderCreate();
      await findByLabel('Employee number');

      await fillEmployeeForm();
      fireEvent.change(byLabel('Employee number'), {
        target: { value: 'EMP 0009!' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create employee' }));

      expect(
        await screen.findByText(
          'Employee number may contain letters, digits, hyphen and underscore only'
        )
      ).toBeDefined();
      expect(api.writes()).toHaveLength(0);
    });

    it('reports every required field when the form is empty, and sends nothing', async () => {
      renderCreate();
      await findByLabel('Employee number');

      fireEvent.click(screen.getByRole('button', { name: 'Create employee' }));

      // Every required field carries its own message.
      await waitFor(() => {
        expect(screen.getAllByRole('alert').length).toBe(8);
      });
      expect(api.writes()).toHaveLength(0);
    });

    it('keeps the other values when the API refuses one field', async () => {
      api.restore();
      api = installHrApiMock({
        responses: { '/departments': listPage([ENGINEERING]) },
        writeFailures: {
          '/employees': {
            status: 422,
            body: {
              code: 'HR_JOIN_DATE_AFTER_BIRTH_DATE',
              message: 'join_date must not be before birth_date',
              details: [
                {
                  field: 'join_date',
                  message: 'join_date must not be before birth_date',
                  code: 'HR_JOIN_DATE_AFTER_BIRTH_DATE',
                },
              ],
              correlation_id: 'corr-42',
            },
          },
        },
      });
      renderCreate();
      await findByLabel('Employee number');

      await fillEmployeeForm();
      fireEvent.click(screen.getByRole('button', { name: 'Create employee' }));

      // The API's field-level error lands on the field …
      expect(await screen.findByText('join_date must not be before birth_date')).toBeDefined();
      // … and the unrelated values are still in the form.
      expect((byLabel('First name') as HTMLInputElement).value).toBe('Nisha');
      expect((byLabel('Job title') as HTMLInputElement).value).toBe(
        'Data Engineer'
      );
      expect((byLabel('Salary') as HTMLInputElement).value).toBe('150000.5000');
    });

    it('takes the operator to the saved record', async () => {
      renderCreate();
      await findByLabel('Employee number');

      await fillEmployeeForm();
      fireEvent.click(screen.getByRole('button', { name: 'Create employee' }));

      expect(await screen.findByText('Employee detail')).toBeDefined();
    });
  });

  describe('2. The edit screen', () => {
    it('shows the current values of the record', async () => {
      renderEdit();

      await waitFor(() => {
        expect((byLabel('Employee number') as HTMLInputElement).value).toBe(
          'EMP-0001'
        );
      });
      expect((byLabel('First name') as HTMLInputElement).value).toBe('Asha');
      expect((byLabel('Job title') as HTMLInputElement).value).toBe(
        'Software Engineer'
      );
    });

    it('never prefills the salary, because the API never returns it', async () => {
      renderEdit();

      await waitFor(() => {
        expect(byLabel('Salary')).toBeDefined();
      });
      expect((byLabel('Salary') as HTMLInputElement).value).toBe('');
      // The masked value is shown beside it, as a value and not as a field.
      expect(screen.getByText('XX,XXX')).toBeDefined();
    });

    it('shows the currency and the timestamps as values, not as fields', async () => {
      renderEdit();

      await waitFor(() => {
        expect(screen.getByText('Employee id')).toBeDefined();
      });
      expect(screen.queryByLabelText('Currency')).toBeNull();
      expect(screen.getByText('INR')).toBeDefined();
    });

    it('sends only the fields the operator changed', async () => {
      renderEdit();
      await waitFor(() => {
        expect((byLabel('First name') as HTMLInputElement).value).toBe('Asha');
      });

      fireEvent.change(byLabel('Job title'), {
        target: { value: 'Staff Engineer' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(api.writes()).toHaveLength(1));

      const write = api.lastWrite();
      expect(write?.method).toBe('PATCH');
      expect(write?.path).toBe(`/employees/${ASHA.id}`);
      // Only the changed field travels — not the id, not the currency, not
      // the timestamps, not the masked salary.
      expect(write?.body).toEqual({ job_title: 'Staff Engineer' });
    });

    it('cannot send a protected field, because there is no control for it', async () => {
      renderEdit();
      await waitFor(() => {
        expect((byLabel('First name') as HTMLInputElement).value).toBe('Asha');
      });

      fireEvent.change(byLabel('Job title'), {
        target: { value: 'Principal Engineer' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(api.writes()).toHaveLength(1));
      const body = api.lastWrite()?.body as Record<string, unknown>;
      // The payload carries the changed field and nothing else — not the
      // id, not the currency, not the timestamps, not the masked salary.
      expect(Object.keys(body)).toEqual(['job_title']);
      for (const protectedField of [
        'id',
        'created_at',
        'updated_at',
        'currency_code',
        'salary_display',
      ]) {
        expect(body[protectedField]).toBeUndefined();
      }
    });

    it('keeps the save disabled while nothing was changed', async () => {
      renderEdit();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save changes' })).toBeDefined();
      });
      expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(
        true
      );
    });
  });

  describe('3. The detail screen', () => {
    it('shows every primary attribute of the record', async () => {
      renderDetail();

      expect(await screen.findByText('EMP-0001')).toBeDefined();
      expect(screen.getByText('Asha')).toBeDefined();
      expect(screen.getByText('Iyer')).toBeDefined();
      expect(screen.getByText('1990-04-12')).toBeDefined();
      expect(screen.getByText('2024-01-08')).toBeDefined();
      expect(screen.getByText('Software Engineer')).toBeDefined();
    });

    it('shows the audit metadata', async () => {
      renderDetail();

      expect(await screen.findByText('Created')).toBeDefined();
      expect(screen.getByText('Updated')).toBeDefined();
      // The created and the updated timestamp are the same in the fixture.
      expect(screen.getAllByText(TIMESTAMP)).toHaveLength(2);
    });

    it('shows the masked salary, never a raw one', async () => {
      renderDetail();

      expect(await screen.findByText('XX,XXX INR')).toBeDefined();
    });

    it('links back to the list and forward to the edit screen', async () => {
      renderDetail();

      const back = await screen.findByRole('link', { name: /Back to the employee list/ });
      expect(back.getAttribute('href')).toBe('/erp5/employees');

      const edit = await screen.findByRole('link', { name: 'Edit employee' });
      expect(edit.getAttribute('href')).toBe(`/erp5/employees/${ASHA.id}/edit`);
    });

    it('shows a not-found view when the record does not exist', async () => {
      api.restore();
      api = installHrApiMock({
        responses: { '/departments': listPage([ENGINEERING]) },
        failures: {
          '/employees/e1000000-0000-4000-8000-000000000001': { status: 404 },
        },
      });
      renderDetail();

      expect(await screen.findByText('Employee not found')).toBeDefined();
    });
  });
});
