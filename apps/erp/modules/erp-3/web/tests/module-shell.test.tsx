// @vitest-environment jsdom
/**
 * ERP-3 Sales Orders and Invoices — Module Shell Tests
 *
 * Covers the acceptance criteria of ERP3-16: active navigation state,
 * browser title, breadcrumb trail, authentication guard, accessibility landmarks,
 * and keyboard affordances of the shell.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { installNavigationRequestShim } from './support/jsdom-environment.js';
import { erp3Routes } from '../src/routes.js';
import { ERP3_MAIN_REGION_ID } from '../src/components/ModuleShell.js';
import { installOrdersApiMock, type OrdersApiMock } from './support/api-mock.js';
import {
  clearStoredAccessToken,
  expiredAccessToken,
  storeAccessToken,
  validAccessToken,
} from './support/session.js';

installNavigationRequestShim();

let api: OrdersApiMock;

const hubLoginRoute: RouteObject = {
  path: '/login',
  element: <p>Hub login screen</p>,
};

function renderModule(initialPath: string) {
  const router = createMemoryRouter([...erp3Routes, hubLoginRoute], {
    initialEntries: [initialPath],
  });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

describe('ERP-3 module shell', () => {
  beforeEach(() => {
    clearStoredAccessToken();
    storeAccessToken(validAccessToken());
    api = installOrdersApiMock({ pending: true });
  });

  afterEach(() => {
    cleanup();
    clearStoredAccessToken();
    api.restore();
  });

  describe('1. Accessibility landmarks', () => {
    it('exposes a banner, a navigation, a main landmark and breadcrumb', () => {
      renderModule('/erp3/sales-orders');

      expect(screen.getByRole('banner', { name: 'Sales Orders & Invoices' })).toBeDefined();
      expect(screen.getByRole('navigation', { name: 'Sales Orders and Invoices' })).toBeDefined();
      expect(screen.getByRole('main', { name: 'Sales Orders & Invoices content' })).toBeDefined();
      expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeDefined();
    });

    it('renders exactly one level-one heading per screen', () => {
      renderModule('/erp3/payments');
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('labels the main region with the module content description', () => {
      renderModule('/erp3/sales-orders');
      expect(screen.getByRole('main').getAttribute('aria-label')).toBe(
        'Sales Orders & Invoices content'
      );
    });
  });

  describe('2. Keyboard navigation and skip link', () => {
    it('places the skip link first in the tab order', () => {
      renderModule('/erp3/sales-orders');

      const focusable = Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      );

      expect(focusable[0]?.textContent).toBe('Skip to main content');
    });

    it('targets the main content region with the skip link', () => {
      renderModule('/erp3/sales-orders');
      const skipLink = screen.getByText('Skip to main content');
      expect(skipLink.getAttribute('href')).toBe(`#${ERP3_MAIN_REGION_ID}`);
      expect(screen.getByRole('main').getAttribute('id')).toBe(ERP3_MAIN_REGION_ID);
    });
  });

  describe('3. Route guards and authentication redirect', () => {
    it('redirects an unauthenticated session to Hub login with returnTo', () => {
      clearStoredAccessToken();
      const { router } = renderModule('/erp3/sales-orders');

      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.search).toBe('?returnTo=%2Ferp3%2Fsales-orders');
      expect(screen.getByText('Hub login screen')).toBeDefined();
    });

    it('redirects an expired session to Hub login with returnTo', () => {
      storeAccessToken(expiredAccessToken());
      const { router } = renderModule('/erp3/payments');

      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.search).toBe('?returnTo=%2Ferp3%2Fpayments');
      expect(screen.getByText('Hub login screen')).toBeDefined();
    });

    it('allows access to module routes when valid token is present', () => {
      const { router } = renderModule('/erp3/sales-orders');
      expect(router.state.location.pathname).toBe('/erp3/sales-orders');
      expect(screen.getByRole('banner', { name: 'Sales Orders & Invoices' })).toBeDefined();
    });
  });

  describe('4. Browser title and breadcrumb trail', () => {
    it('updates document title based on active screen', () => {
      renderModule('/erp3/sales-orders');
      expect(document.title).toBe('Sales orders · ClearShift ERP');
    });

    it('shows the module and current screen in the breadcrumb trail', () => {
      renderModule('/erp3/sales-orders');
      const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(breadcrumb.textContent).toContain('Sales Orders & Invoices');
      expect(breadcrumb.textContent).toContain('Sales orders');
    });
  });

  describe('5. Active navigation states', () => {
    it('marks active navigation item with aria-current="page" and .is-active class', () => {
      renderModule('/erp3/sales-orders');

      const activeLink = screen.getByRole('link', { name: 'Sales orders' });
      expect(activeLink.getAttribute('aria-current')).toBe('page');
      expect(activeLink.className).toContain('is-active');

      const inactiveLink = screen.getByRole('link', { name: 'Invoices' });
      expect(inactiveLink.getAttribute('aria-current')).toBeNull();
      expect(inactiveLink.className).not.toContain('is-active');
    });
  });
});
