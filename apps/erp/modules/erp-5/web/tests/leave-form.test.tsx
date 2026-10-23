// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Leave Form Tests
 *
 * The acceptance evidence of ERP5-05 for the leave workflow. The leave
 * record carries the module's only irreversible action, so this suite is
 * mostly about the **state matrix**: the status is a transition, not a free
 * field, a decided record offers no transition, and a decision is confirmed
 * once before it is written.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LeaveCreatePage } from '../src/pages/LeaveCreatePage.js';
import { LeaveDetailPage } from '../src/pages/LeaveDetailPage.js';
import { LeaveEditPage } from '../src/pages/LeaveEditPage.js';
import { installHrApiMock, listPage, type HrApiMock } from './support/api-mock.js';
import {
  clearStoredAccessToken,
  storeAccessToken,
  validAccessToken,
} from './support/session.js';

const TIMESTAMP = '2026-04-15T12:00:00.000Z';

const EMPLOYEE = {
  id: 'e1000000-0000-4000-8000-000000000001',
  employee_no: 'EMP-0001',
  first_name: 'Asha',
  last_name: 'Iyer',
  birth_date: '1990-04-12',
  join_date: '2024-01-08',
  department_id: 'd1000000-0000-4000-8000-000000000001',
  job_title: 'Software Engineer',
  salary_display: 'XX,XXX',
  currency_code: 'INR',
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

const PENDING_LEAVE = {
  id: 'l1000000-0000-4000-8000-000000000001',
  employee_id: EMPLOYEE.id,
  date_from: '2026-03-02',
  date_to: '2026-03-04',
  type: 'sick',
  status: 'pending',
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

const APPROVED_LEAVE = {
  ...PENDING_LEAVE,
  id: 'l1000000-0000-4000-8000-000000000002',
  status: 'approved',
};

function byLabel(name: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`^${name}`));
}

async function findByLabel(name: string): Promise<HTMLElement> {
  return screen.findByLabelText(new RegExp(`^${name}`));
}

function renderCreate(): void {
  render(
    <MemoryRouter initialEntries={['/erp5/leave/new']}>
      <Routes>
        <Route path="/erp5/leave/new" element={<LeaveCreatePage />} />
        <Route path="/erp5/leave" element={<p>Leave list</p>} />
        <Route path="/erp5/leave/:leaveId" element={<p>Leave detail</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderEdit(leaveId: string): void {
  render(
    <MemoryRouter initialEntries={[`/erp5/leave/${leaveId}/edit`]}>
      <Routes>
        <Route path="/erp5/leave/:leaveId/edit" element={<LeaveEditPage />} />
        <Route path="/erp5/leave/:leaveId" element={<p>Leave detail</p>} />
        <Route path="/erp5/leave" element={<p>Leave list</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderDetail(leaveId: string): void {
  render(
    <MemoryRouter initialEntries={[`/erp5/leave/${leaveId}`]}>
      <Routes>
        <Route path="/erp5/leave/:leaveId" element={<LeaveDetailPage />} />
        <Route path="/erp5/leave" element={<p>Leave list</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ERP-5 leave create, edit and detail screens', () => {
  let api: HrApiMock;

  beforeEach(() => {
    clearStoredAccessToken();
    storeAccessToken(validAccessToken());
    api = installHrApiMock({
      responses: {
        '/employees': listPage([EMPLOYEE]),
        '/leave': listPage([PENDING_LEAVE]),
        '/leave/l1000000-0000-4000-8000-000000000001': PENDING_LEAVE,
        '/leave/l1000000-0000-4000-8000-000000000002': APPROVED_LEAVE,
      },
      writeResponses: {
        '/leave': PENDING_LEAVE,
        '/leave/l1000000-0000-4000-8000-000000000001': APPROVED_LEAVE,
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

      const back = await screen.findByRole('link', { name: /Back to the leave list/ });
      expect(back.getAttribute('href')).toBe('/erp5/leave');
    });

    it('sends the payload the contract defines, and no status', async () => {
      renderCreate();
      await findByLabel('Employee');

      fireEvent.change(byLabel('Employee'), { target: { value: EMPLOYEE.id } });
      fireEvent.change(byLabel('From'), { target: { value: '2026-05-04' } });
      fireEvent.change(byLabel('To'), { target: { value: '2026-05-08' } });
      fireEvent.change(byLabel('Type'), { target: { value: 'holiday' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create leave record' }));

      await waitFor(() => expect(api.writes()).toHaveLength(1));
      expect(api.lastWrite()?.method).toBe('POST');
      expect(api.lastWrite()?.body).toEqual({
        employee_id: EMPLOYEE.id,
        date_from: '2026-05-04',
        date_to: '2026-05-08',
        type: 'holiday',
      });
    });

    it('never offers a status — a new record is created as pending', async () => {
      renderCreate();

      await findByLabel('Employee');
      expect(screen.queryByLabelText(/^Decide this record/)).toBeNull();
      expect(screen.getByText('Pending')).toBeDefined();
    });

    it('shows the contract’s message for an invalid period, and sends nothing', async () => {
      renderCreate();
      await findByLabel('Employee');

      fireEvent.change(byLabel('Employee'), { target: { value: EMPLOYEE.id } });
      fireEvent.change(byLabel('From'), { target: { value: '2026-05-08' } });
      fireEvent.change(byLabel('To'), { target: { value: '2026-05-04' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create leave record' }));

      expect(
        await screen.findByText('date_to must not be before date_from')
      ).toBeDefined();
      expect(api.writes()).toHaveLength(0);
    });
  });

  describe('2. The edit screen', () => {
    it('shows the employee as a value, because it can never change', async () => {
      renderEdit(PENDING_LEAVE.id);

      await waitFor(() => {
        expect(screen.getByText('Employee')).toBeDefined();
      });
      expect(screen.queryByLabelText(/^Employee/)).toBeNull();
      expect(screen.getByText(EMPLOYEE.id)).toBeDefined();
    });

    it('offers only the transitions the state matrix allows', async () => {
      renderEdit(PENDING_LEAVE.id);

      await waitFor(() => {
        expect(byLabel('Decide this record')).toBeDefined();
      });
      const select = byLabel('Decide this record') as HTMLSelectElement;
      const values = Array.from(select.options).map((option) => option.value);

      expect(values).toEqual(['', 'approved', 'rejected']);
    });

    it('offers no transition once the record is decided', async () => {
      renderEdit(APPROVED_LEAVE.id);

      await waitFor(() => {
        expect(screen.getByText('Approved')).toBeDefined();
      });
      expect(screen.queryByLabelText(/^Decide this record/)).toBeNull();
    });

    it('confirms a decision before it writes anything', async () => {
      renderEdit(PENDING_LEAVE.id);
      await waitFor(() => {
        expect(byLabel('Decide this record')).toBeDefined();
      });

      fireEvent.change(byLabel('Decide this record'), { target: { value: 'approved' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      // The confirmation is open, and nothing was written yet.
      expect(await screen.findByText('Decide this leave record')).toBeDefined();
      expect(api.writes()).toHaveLength(0);
    });

    it('writes the decision once the confirmation is accepted', async () => {
      renderEdit(PENDING_LEAVE.id);
      await waitFor(() => {
        expect(byLabel('Decide this record')).toBeDefined();
      });

      fireEvent.change(byLabel('Decide this record'), { target: { value: 'approved' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Decide this leave record');

      fireEvent.click(screen.getByRole('button', { name: 'Approved' }));

      await waitFor(() => expect(api.writes()).toHaveLength(1));
      expect(api.lastWrite()?.method).toBe('PATCH');
      expect(api.lastWrite()?.body).toEqual({ status: 'approved' });
    });

    it('writes nothing when the confirmation is cancelled, and clears the decision', async () => {
      renderEdit(PENDING_LEAVE.id);
      await waitFor(() => {
        expect(byLabel('Decide this record')).toBeDefined();
      });

      fireEvent.change(byLabel('Decide this record'), { target: { value: 'rejected' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Decide this leave record');

      fireEvent.click(
        screen.getByRole('button', { name: 'Keep the current value' })
      );

      await waitFor(() => {
        expect((byLabel('Decide this record') as HTMLSelectElement).value).toBe('');
      });
      expect(api.writes()).toHaveLength(0);
    });

    it('sends only the period and the type when the status is untouched', async () => {
      renderEdit(PENDING_LEAVE.id);
      await waitFor(() => {
        expect((byLabel('From') as HTMLInputElement).value).toBe('2026-03-02');
      });

      fireEvent.change(byLabel('To'), { target: { value: '2026-03-06' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(api.writes()).toHaveLength(1));
      expect(api.lastWrite()?.body).toEqual({ date_to: '2026-03-06' });
    });
  });

  describe('3. The detail screen', () => {
    it('shows the period, the type and the status', async () => {
      renderDetail(PENDING_LEAVE.id);

      expect(await screen.findByText('2026-03-02')).toBeDefined();
      expect(screen.getByText('2026-03-04')).toBeDefined();
      expect(screen.getByText('sick')).toBeDefined();
      expect(screen.getByText('Pending')).toBeDefined();
    });

    it('says that a decided record can no longer be decided', async () => {
      renderDetail(APPROVED_LEAVE.id);

      expect(await screen.findByText('Approved')).toBeDefined();
      expect(
        screen.getByText('The record is decided — a decision is never reversed.')
      ).toBeDefined();
    });

    it('links back to the list and forward to the edit screen', async () => {
      renderDetail(PENDING_LEAVE.id);

      const back = await screen.findByRole('link', { name: /Back to the leave list/ });
      expect(back.getAttribute('href')).toBe('/erp5/leave');

      const edit = await screen.findByRole('link', { name: 'Edit leave record' });
      expect(edit.getAttribute('href')).toBe(`/erp5/leave/${PENDING_LEAVE.id}/edit`);
    });
  });
});
