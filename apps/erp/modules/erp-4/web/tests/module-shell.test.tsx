// @vitest-environment jsdom
/**
 * ERP-4 Finance and Accounting — Module Shell Tests
 *
 * Covers the acceptance criteria of ERP4-16: active navigation state,
 * browser title, breadcrumb trail, authentication guard, accessibility landmarks,
 * and keyboard affordances of the shell.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { installNavigationRequestShim } from './support/jsdom-environment.js';
import { erp4Routes } from '../src/routes.js';
import { ERP4_MAIN_REGION_ID } from '../src/components/ModuleShell.js';
import { installFinanceApiMock, type FinanceApiMock } from './support/api-mock.js';
import {
  clearStoredAccessToken,
  expiredAccessToken,
  storeAccessToken,
  validAccessToken,
} from './support/session.js';

installNavigationRequestShim();

let api: FinanceApiMock;

const hubLoginRoute: RouteObject = {
  path: '/login',
  element: <p>Hub login screen</p>,
};

function renderModule(initialPath: string) {
  const router = createMemoryRouter([...erp4Routes, hubLoginRoute], {
    initialEntries: [initialPath],
  });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

describe('ERP-4 module shell', () => {
  beforeEach(() => {
    clearStoredAccessToken();
    storeAccessToken(validAccessToken());
    api = installFinanceApiMock({ pending: true });
  });

  afterEach(() => {
    cleanup();
    clearStoredAccessToken();
    api.restore();
  });

  describe('1. Accessibility landmarks', () => {
    it('exposes a banner, a navigation, a main landmark and breadcrumb', () => {
      renderModule('/erp4/accounts');

      expect(screen.getByRole('banner', { name: 'Finance & Accounting' })).toBeDefined();
      expect(screen.getByRole('navigation', { name: 'Finance and Accounting' })).toBeDefined();
      expect(screen.getByRole('main', { name: 'Finance & Accounting content' })).toBeDefined();
      expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeDefined();
    });

    it('renders heading in header landmark', () => {
      renderModule('/erp4/trial-balance');
      expect(screen.getByRole('banner', { name: 'Finance & Accounting' })).toBeDefined();
    });

    it('labels the main region with the module content description', () => {
      renderModule('/erp4/accounts');
      expect(screen.getByRole('main').getAttribute('aria-label')).toBe(
        'Finance & Accounting content'
      );
    });
  });

  describe('2. Keyboard navigation and skip link', () => {
    it('places the skip link first in the tab order', () => {
      renderModule('/erp4/accounts');

      const focusable = Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      );

      expect(focusable[0]?.textContent).toBe('Skip to main content');
    });

    it('targets the main content region with the skip link', () => {
      renderModule('/erp4/accounts');
      const skipLink = screen.getByText('Skip to main content');
      expect(skipLink.getAttribute('href')).toBe(`#${ERP4_MAIN_REGION_ID}`);
      expect(screen.getByRole('main').getAttribute('id')).toBe(ERP4_MAIN_REGION_ID);
    });
  });

  describe('3. Route guards and authentication redirect', () => {
    it('redirects an unauthenticated session to Hub login with returnTo', () => {
      clearStoredAccessToken();
      const { router } = renderModule('/erp4/accounts');

      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.search).toBe('?returnTo=%2Ferp4%2Faccounts');
      expect(screen.getByText('Hub login screen')).toBeDefined();
    });

    it('redirects an expired session to Hub login with returnTo', () => {
      storeAccessToken(expiredAccessToken());
      const { router } = renderModule('/erp4/trial-balance');

      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.search).toBe('?returnTo=%2Ferp4%2Ftrial-balance');
      expect(screen.getByText('Hub login screen')).toBeDefined();
    });

    it('allows access to module routes when valid token is present', () => {
      const { router } = renderModule('/erp4/accounts');
      expect(router.state.location.pathname).toBe('/erp4/accounts');
      expect(screen.getByRole('banner', { name: 'Finance & Accounting' })).toBeDefined();
    });
  });

  describe('4. Browser title and breadcrumb trail', () => {
    it('updates document title based on active screen', () => {
      renderModule('/erp4/accounts');
      expect(document.title).toBe('Chart of Accounts · ClearShift ERP');
    });

    it('shows the module and current screen in the breadcrumb trail', () => {
      renderModule('/erp4/accounts');
      const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(breadcrumb.textContent).toContain('Finance & Accounting');
      expect(breadcrumb.textContent).toContain('Chart of Accounts');
    });
  });

  describe('5. Active navigation states', () => {
    it('marks active navigation item with aria-current="page" and .is-active class', () => {
      renderModule('/erp4/accounts');

      const activeLink = screen.getByRole('link', { name: 'Chart of Accounts' });
      expect(activeLink.getAttribute('aria-current')).toBe('page');
      expect(activeLink.className).toContain('is-active');

      const inactiveLink = screen.getByRole('link', { name: 'Trial Balance' });
      expect(inactiveLink.getAttribute('aria-current')).toBeNull();
      expect(inactiveLink.className).not.toContain('is-active');
    });
  });
});
