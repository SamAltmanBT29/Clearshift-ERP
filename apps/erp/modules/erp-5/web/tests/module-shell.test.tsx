// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Module Shell Tests
 *
 * Covers the acceptance criteria of ERP5-16 that are not about the route
 * table itself: the active navigation state, the browser title, the
 * breadcrumb trail, the authentication guard and the accessibility
 * landmarks and keyboard affordances of the shell.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, within, act } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { installNavigationRequestShim } from './support/jsdom-environment.js';
import { erp5Routes } from '../src/routes.js';
import { ERP5_MAIN_REGION_ID } from '../src/components/ModuleShell.js';
import { ModuleNav } from '../src/components/ModuleNav.js';
import {
  clearStoredAccessToken,
  expiredAccessToken,
  storeAccessToken,
  validAccessToken,
} from './support/session.js';

installNavigationRequestShim();

/** The Hub login screen is owned by the platform, not by this module. */
const hubLoginRoute: RouteObject = {
  path: '/login',
  element: <p>Hub login screen</p>,
};

function renderModule(initialPath: string) {
  const router = createMemoryRouter([...erp5Routes, hubLoginRoute], {
    initialEntries: [initialPath],
  });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

describe('ERP-5 module shell', () => {
  beforeEach(() => {
    clearStoredAccessToken();
    storeAccessToken(validAccessToken());
  });

  afterEach(() => {
    cleanup();
    clearStoredAccessToken();
  });

  describe('1. Accessibility landmarks', () => {
    it('exposes a banner, a navigation and a main landmark', () => {
      renderModule('/erp5/employees');

      expect(screen.getByRole('banner', { name: 'HR & Employees' })).toBeDefined();
      expect(screen.getByRole('navigation', { name: 'HR and Employees' })).toBeDefined();
      expect(screen.getByRole('main', { name: 'HR & Employees content' })).toBeDefined();
    });

    it('renders exactly one level-one heading per screen', () => {
      renderModule('/erp5/employees');
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('labels the main region with the module name', () => {
      renderModule('/erp5/employees');
      expect(
        screen.getByRole('main').getAttribute('aria-label')
      ).toBe('HR & Employees content');
    });

    it('exposes a breadcrumb navigation landmark', () => {
      renderModule('/erp5/employees');
      expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeDefined();
    });
  });

  describe('2. Keyboard navigation', () => {
    it('puts the skip link first in the tab order', () => {
      renderModule('/erp5/employees');

      const focusable = Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      );

      expect(focusable[0]?.textContent).toBe('Skip to main content');
    });

    it('targets the main region with the skip link', () => {
      renderModule('/erp5/employees');

      const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
      expect(skipLink.getAttribute('href')).toBe(`#${ERP5_MAIN_REGION_ID}`);
      expect(document.getElementById(ERP5_MAIN_REGION_ID)).not.toBeNull();
    });

    it('gives the skip link keyboard focus', () => {
      renderModule('/erp5/employees');

      const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
      skipLink.focus();
      expect(document.activeElement).toBe(skipLink);
    });

    it('renders every navigation entry as a real link', () => {
      renderModule('/erp5/employees');
      const nav = screen.getByRole('navigation', { name: 'HR and Employees' });
      const links = within(nav).getAllByRole('link');

      expect(links.length).toBe(5);
      for (const link of links) {
        expect(link.getAttribute('href')).toBeTruthy();
      }
    });
  });

  describe('3. Active navigation state', () => {
    it('marks the current screen with aria-current="page"', () => {
      renderModule('/erp5/employees');
      const nav = screen.getByRole('navigation', { name: 'HR and Employees' });

      const current = within(nav).getByRole('link', { name: 'Employees' });
      expect(current.getAttribute('aria-current')).toBe('page');
    });

    it('marks exactly one navigation entry as current', () => {
      renderModule('/erp5/leave');
      const nav = screen.getByRole('navigation', { name: 'HR and Employees' });

      const current = within(nav)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');

      expect(current).toHaveLength(1);
      expect(current[0]?.textContent).toBe('Leave records');
    });

    it('keeps the list entry current on a detail route', () => {
      renderModule('/erp5/employees/e1000000-0000-4000-8000-000000000001');
      const nav = screen.getByRole('navigation', { name: 'HR and Employees' });

      const current = within(nav)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');

      expect(current).toHaveLength(1);
      expect(current[0]?.textContent).toBe('Employees');
    });

    it('marks the entry of an explicitly supplied location as current', () => {
      render(
        <MemoryRouter initialEntries={['/erp5/employees']}>
          <ModuleNav pathname="/erp5/leave" />
        </MemoryRouter>
      );

      const nav = screen.getByRole('navigation', { name: 'HR and Employees' });
      const current = within(nav)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');

      expect(current).toHaveLength(1);
      expect(current[0]?.textContent).toBe('Leave records');
    });
  });

  describe('4. Browser title and breadcrumb trail', () => {
    it('updates the browser title for the current screen', () => {
      renderModule('/erp5/employees');
      expect(document.title).toBe('Employees · ClearShift ERP');
    });

    it('updates the browser title when the route changes', async () => {
      const { router } = renderModule('/erp5/employees');
      expect(document.title).toBe('Employees · ClearShift ERP');

      await act(async () => {
        await router.navigate('/erp5/payroll-totals');
      });

      expect(router.state.location.pathname).toBe('/erp5/payroll-totals');
      expect(document.title).toBe('Payroll totals · ClearShift ERP');
    });

    it('shows the module and the current screen in the breadcrumb trail', () => {
      renderModule('/erp5/leave');
      const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
      const text = breadcrumb.textContent ?? '';

      expect(text).toContain('HR & Employees');
      expect(text).toContain('Leave records');
    });
  });

  describe('5. Authentication guard', () => {
    it('redirects an unauthenticated session to the Hub login', () => {
      clearStoredAccessToken();
      const { router } = renderModule('/erp5/employees');

      expect(router.state.location.pathname).toBe('/login');
      expect(screen.getByText('Hub login screen')).toBeDefined();
    });

    it('preserves the requested screen in the returnTo parameter', () => {
      clearStoredAccessToken();
      const { router } = renderModule('/erp5/employees');

      expect(router.state.location.search).toBe('?returnTo=%2Ferp5%2Femployees');
    });

    it('redirects an expired session to the Hub login', () => {
      storeAccessToken(expiredAccessToken());
      const { router } = renderModule('/erp5/employees');

      expect(router.state.location.pathname).toBe('/login');
    });

    it('redirects a malformed token to the Hub login', () => {
      storeAccessToken('not-a-jwt');
      const { router } = renderModule('/erp5/employees');

      expect(router.state.location.pathname).toBe('/login');
    });

    it('renders the screen for a valid session', () => {
      const { router } = renderModule('/erp5/employees');

      expect(router.state.location.pathname).toBe('/erp5/employees');
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Employees');
    });

    it('never leaks a module screen to an unauthenticated visitor', () => {
      clearStoredAccessToken();
      renderModule('/erp5/employees');

      expect(screen.queryByRole('heading', { level: 1, name: 'Employees' })).toBeNull();
    });
  });
});
