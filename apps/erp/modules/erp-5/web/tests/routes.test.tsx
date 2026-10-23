// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Route Registration Tests
 *
 * Proves that every screen of the module is registered in React Router and
 * that it renders inside the common layout shell.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { installNavigationRequestShim } from './support/jsdom-environment.js';
import { erp5Routes } from '../src/routes.js';
import { ERP5_ROUTE_DESCRIPTORS } from '../src/route-manifest.js';
import { installHrApiMock, type HrApiMock } from './support/api-mock.js';
import { clearStoredAccessToken, storeAccessToken, validAccessToken } from './support/session.js';

installNavigationRequestShim();

let api: HrApiMock;

interface FlatRoute {
  readonly id?: string | undefined;
  readonly path?: string | undefined;
  readonly index?: boolean | undefined;
}

function flattenRoutes(routes: RouteObject[]): FlatRoute[] {
  const flat: FlatRoute[] = [];
  for (const route of routes) {
    flat.push({ id: route.id, path: route.path, index: route.index });
    if (route.children) {
      flat.push(...flattenRoutes(route.children));
    }
  }
  return flat;
}

function renderModule(initialPath: string) {
  const router = createMemoryRouter(erp5Routes, { initialEntries: [initialPath] });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

describe('ERP-5 module route registration', () => {
  beforeEach(() => {
    clearStoredAccessToken();
    storeAccessToken(validAccessToken());
    api = installHrApiMock({ pending: true });
  });

  afterEach(() => {
    cleanup();
    clearStoredAccessToken();
    api.restore();
  });

  describe('1. The route table', () => {
    it('registers every route of the manifest in React Router', () => {
      const registeredIds = flattenRoutes(erp5Routes)
        .map((route) => route.id)
        .filter((id): id is string => typeof id === 'string');

      for (const descriptor of ERP5_ROUTE_DESCRIPTORS) {
        expect(registeredIds).toContain(`erp5-${descriptor.id}`);
      }
    });

    it('registers no screen that the manifest does not declare', () => {
      // The manifest is the single source of truth, so the check runs in both
      // directions: a screen that exists only in the route table would have no
      // navigation entry, no breadcrumb and no browser title.
      const registeredIds = flattenRoutes(erp5Routes)
        .map((route) => route.id)
        .filter((id): id is string => typeof id === 'string');

      const declaredIds = ERP5_ROUTE_DESCRIPTORS.map((descriptor) => `erp5-${descriptor.id}`);
      const structuralIds = ['erp5', 'erp5-shell', 'erp5-index', 'erp5-not-found'];

      for (const id of registeredIds) {
        expect([...declaredIds, ...structuralIds]).toContain(id);
      }
    });

    it('registers the same path in the route table and in the manifest', () => {
      const registeredPaths = flattenRoutes(erp5Routes)
        .map((route) => route.path)
        .filter((path): path is string => typeof path === 'string');

      for (const descriptor of ERP5_ROUTE_DESCRIPTORS) {
        expect(registeredPaths).toContain(descriptor.path);
      }
    });

    it('mounts the whole module under the ERP-5 base path', () => {
      const root = erp5Routes[0];
      expect(root?.path).toBe('/erp5');
    });

    it('nests every screen under the authentication guard and the shell', () => {
      const root = erp5Routes[0];
      const shellRoute = root?.children?.[0];
      expect(shellRoute?.id).toBe('erp5-shell');
      expect(shellRoute?.children?.length).toBeGreaterThan(0);
    });

    it('registers the module index and a not-found catch-all', () => {
      const shellChildren = erp5Routes[0]?.children?.[0]?.children ?? [];
      const ids = shellChildren.map((route) => route.id);
      expect(ids).toContain('erp5-index');
      expect(ids).toContain('erp5-not-found');
    });
  });

  describe('2. Rendering inside the shell', () => {
    it('renders the employees screen inside the module shell', () => {
      renderModule('/erp5/employees');

      expect(screen.getByRole('banner', { name: 'HR & Employees' })).toBeDefined();
      expect(screen.getByRole('navigation', { name: 'HR and Employees' })).toBeDefined();
      expect(screen.getByRole('main')).toBeDefined();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Employees');
    });

    it('renders the department, leave, payroll and identity screens', () => {
      const cases: [string, string][] = [
        ['/erp5/departments', 'Departments'],
        ['/erp5/leave', 'Leave records'],
        ['/erp5/payroll-totals', 'Payroll totals'],
        ['/erp5/identity-users', 'Identity users'],
      ];

      for (const [path, heading] of cases) {
        const { unmount } = renderModule(path);
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
        expect(screen.getByRole('main')).toBeDefined();
        unmount();
      }
    });

    it('renders every create screen of the module', () => {
      const cases: [string, string][] = [
        ['/erp5/employees/new', 'New employee'],
        ['/erp5/departments/new', 'New department'],
        ['/erp5/leave/new', 'New leave record'],
      ];

      for (const [path, heading] of cases) {
        const { unmount } = renderModule(path);
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
        unmount();
      }
    });

    it('renders every detail screen of the module', () => {
      const cases: [string, string][] = [
        ['/erp5/employees/e1000000-0000-4000-8000-000000000001', 'Employee'],
        ['/erp5/departments/d1000000-0000-4000-8000-000000000001', 'Department'],
        ['/erp5/leave/l1000000-0000-4000-8000-000000000001', 'Leave record'],
      ];

      for (const [path, heading] of cases) {
        const { unmount } = renderModule(path);
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
        unmount();
      }
    });

    it('redirects the module index to the employees screen', () => {
      const { router } = renderModule('/erp5');
      expect(router.state.location.pathname).toBe('/erp5/employees');
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Employees');
    });

    it('resolves the static create route instead of the dynamic detail route', () => {
      renderModule('/erp5/employees/new');
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New employee');
    });

    it('resolves the dynamic detail route for a record', () => {
      renderModule('/erp5/employees/e1000000-0000-4000-8000-000000000001');
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Employee');
    });

    it('renders every detail screen of the module', async () => {
      const cases: [string, string][] = [
        ['/erp5/employees/e1000000-0000-4000-8000-000000000001', 'Employee'],
        ['/erp5/departments/d1000000-0000-4000-8000-000000000001', 'Department'],
        ['/erp5/leave/l1000000-0000-4000-8000-000000000001', 'Leave record'],
      ];

      for (const [path, heading] of cases) {
        const { unmount } = renderModule(path);
        expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeDefined();
        unmount();
      }
    });

    it('renders every edit screen of the module', async () => {
      const cases: [string, string][] = [
        ['/erp5/employees/e1000000-0000-4000-8000-000000000001/edit', 'Edit employee'],
        ['/erp5/departments/d1000000-0000-4000-8000-000000000001/edit', 'Edit department'],
        ['/erp5/leave/l1000000-0000-4000-8000-000000000001/edit', 'Edit leave record'],
      ];

      for (const [path, heading] of cases) {
        const { unmount } = renderModule(path);
        expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeDefined();
        unmount();
      }
    });

    it('keeps an unknown module path inside the shell', () => {
      renderModule('/erp5/not-a-real-screen');
      expect(screen.getByRole('banner', { name: 'HR & Employees' })).toBeDefined();
      expect(screen.getByRole('main')).toBeDefined();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Screen not found');
    });

    it('never renders a screen outside the module shell', () => {
      renderModule('/erp5/employees');
      const main = screen.getByRole('main');
      const banner = screen.getByRole('banner', { name: 'HR & Employees' });
      expect(within(main).getByRole('heading', { level: 1 })).toBeDefined();
      expect(banner.textContent).toContain('HR & Employees');
    });
  });

  describe('3. Navigation hierarchy', () => {
    it('lists the five module resources in the navigation', () => {
      renderModule('/erp5/employees');
      const nav = screen.getByRole('navigation', { name: 'HR and Employees' });

      for (const label of [
        'Employees',
        'Departments',
        'Leave records',
        'Payroll totals',
        'Identity users',
      ]) {
        expect(within(nav).getByRole('link', { name: label })).toBeDefined();
      }
    });

    it('keeps the create and detail screens out of the navigation', () => {
      renderModule('/erp5/employees');
      const nav = screen.getByRole('navigation', { name: 'HR and Employees' });
      const linkNames = within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent);

      expect(linkNames).not.toContain('New employee');
      expect(linkNames).not.toContain('Employee');
    });

    it('groups the navigation entries under their group headings', () => {
      renderModule('/erp5/employees');
      const nav = screen.getByRole('navigation', { name: 'HR and Employees' });
      expect(within(nav).getByRole('heading', { name: 'People' })).toBeDefined();
      expect(within(nav).getByRole('heading', { name: 'Reporting' })).toBeDefined();
      expect(within(nav).getByRole('heading', { name: 'Administration' })).toBeDefined();
    });
  });
});
