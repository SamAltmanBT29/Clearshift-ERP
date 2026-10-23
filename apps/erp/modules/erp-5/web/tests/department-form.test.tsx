// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Department Form Tests
 *
 * The acceptance evidence of ERP5-05 for the department workflow, including
 * the one rule that is easy to get wrong: **clearing** the parent of a
 * department is an explicit `null`, not an absent field.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DepartmentCreatePage } from '../src/pages/DepartmentCreatePage.js';
import { DepartmentDetailPage } from '../src/pages/DepartmentDetailPage.js';
import { DepartmentEditPage } from '../src/pages/DepartmentEditPage.js';
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

const PLATFORM = {
  id: 'd1000000-0000-4000-8000-000000000002',
  name: 'Platform',
  code: 'PLAT',
  parent_id: ENGINEERING.id,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
};

function byLabel(name: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`^${name}`));
}

async function findByLabel(name: string): Promise<HTMLElement> {
  return screen.findByLabelText(new RegExp(`^${name}`));
}

function renderCreate(): void {
  render(
    <MemoryRouter initialEntries={['/erp5/departments/new']}>
      <Routes>
        <Route path="/erp5/departments/new" element={<DepartmentCreatePage />} />
        <Route path="/erp5/departments" element={<p>Department list</p>} />
        <Route path="/erp5/departments/:departmentId" element={<p>Department detail</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderEdit(): void {
  render(
    <MemoryRouter initialEntries={[`/erp5/departments/${PLATFORM.id}/edit`]}>
      <Routes>
        <Route path="/erp5/departments/:departmentId/edit" element={<DepartmentEditPage />} />
        <Route path="/erp5/departments/:departmentId" element={<p>Department detail</p>} />
        <Route path="/erp5/departments" element={<p>Department list</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderDetail(): void {
  render(
    <MemoryRouter initialEntries={[`/erp5/departments/${PLATFORM.id}`]}>
      <Routes>
        <Route path="/erp5/departments/:departmentId" element={<DepartmentDetailPage />} />
        <Route path="/erp5/departments" element={<p>Department list</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ERP-5 department create, edit and detail screens', () => {
  let api: HrApiMock;

  beforeEach(() => {
    clearStoredAccessToken();
    storeAccessToken(validAccessToken());
    api = installHrApiMock({
      responses: {
        '/departments': listPage([ENGINEERING, PLATFORM]),
        '/departments/d1000000-0000-4000-8000-000000000002': PLATFORM,
      },
      writeResponses: {
        '/departments': PLATFORM,
        '/departments/d1000000-0000-4000-8000-000000000002': PLATFORM,
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

      const back = await screen.findByRole('link', { name: /Back to the department list/ });
      expect(back.getAttribute('href')).toBe('/erp5/departments');
    });

    it('sends the payload the contract defines', async () => {
      renderCreate();
      await findByLabel('Name');

      fireEvent.change(byLabel('Name'), { target: { value: 'Data' } });
      fireEvent.change(byLabel('Code'), { target: { value: 'DATA' } });
      fireEvent.change(byLabel('Parent department'), {
        target: { value: ENGINEERING.id },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create department' }));

      await waitFor(() => expect(api.writes()).toHaveLength(1));
      expect(api.lastWrite()?.method).toBe('POST');
      expect(api.lastWrite()?.path).toBe('/departments');
      expect(api.lastWrite()?.body).toEqual({
        name: 'Data',
        code: 'DATA',
        parent_id: ENGINEERING.id,
      });
    });

    it('shows the contract’s message for a malformed code, and sends nothing', async () => {
      renderCreate();
      await findByLabel('Name');

      fireEvent.change(byLabel('Name'), { target: { value: 'Data' } });
      fireEvent.change(byLabel('Code'), { target: { value: 'DA TA' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create department' }));

      expect(
        await screen.findByText(
          'Department code may contain letters, digits, hyphen and underscore only'
        )
      ).toBeDefined();
      expect(api.writes()).toHaveLength(0);
    });

    it('reports every required field when the form is empty, and sends nothing', async () => {
      renderCreate();
      await findByLabel('Name');

      fireEvent.click(screen.getByRole('button', { name: 'Create department' }));

      await waitFor(() => {
        expect(screen.getAllByRole('alert').length).toBe(2);
      });
      expect(api.writes()).toHaveLength(0);
    });
  });

  describe('2. The edit screen', () => {
    it('shows the current values of the record', async () => {
      renderEdit();

      await waitFor(() => {
        expect((byLabel('Name') as HTMLInputElement).value).toBe('Platform');
      });
      expect((byLabel('Code') as HTMLInputElement).value).toBe('PLAT');
    });

    it('sends only the fields the operator changed', async () => {
      renderEdit();
      await waitFor(() => {
        expect((byLabel('Name') as HTMLInputElement).value).toBe('Platform');
      });

      fireEvent.change(byLabel('Name'), { target: { value: 'Platform Engineering' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(api.writes()).toHaveLength(1));
      expect(api.lastWrite()?.method).toBe('PATCH');
      expect(api.lastWrite()?.body).toEqual({ name: 'Platform Engineering' });
    });

    it('clears the parent with an explicit null, not with an absent field', async () => {
      renderEdit();
      await waitFor(() => {
        expect((byLabel('Name') as HTMLInputElement).value).toBe('Platform');
      });

      fireEvent.change(byLabel('Parent department'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(api.writes()).toHaveLength(1));
      expect(api.lastWrite()?.body).toEqual({ parent_id: null });
    });

    it('does not offer the department itself as its own parent', async () => {
      renderEdit();

      await waitFor(() => {
        expect((byLabel('Name') as HTMLInputElement).value).toBe('Platform');
      });
      const select = byLabel('Parent department') as HTMLSelectElement;
      const values = Array.from(select.options).map((option) => option.value);

      expect(values).toContain(ENGINEERING.id);
      expect(values).not.toContain(PLATFORM.id);
    });
  });

  describe('3. The detail screen', () => {
    it('shows the attributes of the record and its parent', async () => {
      renderDetail();

      expect(await screen.findByText('PLAT')).toBeDefined();
      expect(screen.getByText('Platform')).toBeDefined();
      expect(screen.getByText('Engineering')).toBeDefined();
    });

    it('links back to the list and forward to the edit screen', async () => {
      renderDetail();

      const back = await screen.findByRole('link', { name: /Back to the department list/ });
      expect(back.getAttribute('href')).toBe('/erp5/departments');

      const edit = await screen.findByRole('link', { name: 'Edit department' });
      expect(edit.getAttribute('href')).toBe(`/erp5/departments/${PLATFORM.id}/edit`);
    });
  });
});
