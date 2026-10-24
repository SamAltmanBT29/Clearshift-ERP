// @vitest-environment jsdom
/**
 * ERP-1 Products & Inventory — Module Shell & Route Registration Suite (ERP1-16)
 *
 * Verifies:
 *   1. Module routes are registered in React Router within the common layout shell.
 *   2. Navigation highlights active module, sub-routes, and updates browser title.
 *   3. Route guards enforce authentication and redirect unauthenticated sessions to Hub login.
 *   4. Keyboard navigation and ARIA landmarks meet accessibility standards.
 *
 * @module erp1/web/tests/module-shell.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { erp1Routes } from '../src/routes.js';
import { ERP1_ROUTE_DESCRIPTORS } from '../src/route-manifest.js';
import { ERP1_MAIN_REGION_ID } from '../src/components/ModuleShell.js';
import {
  writeAccessToken,
  clearAccessToken,
  ACCESS_TOKEN_STORAGE_KEY,
} from '../src/auth/session.js';
import * as api from '../src/api/erp-1.js';

class NavigationRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly signal: AbortSignal | null;
  readonly body: BodyInit | null;

  constructor(input: string | URL, init: RequestInit = {}) {
    this.url = typeof input === 'string' ? input : input.toString();
    this.method = init.method ?? 'GET';
    this.headers =
      init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? undefined);
    this.signal = init.signal ?? null;
    this.body = init.body ?? null;
  }
}

function installNavigationRequestShim(): void {
  const scope = globalThis as { Request?: typeof Request };
  if (typeof scope.Request !== 'function') return;
  try {
    new scope.Request('http://clearshift.invalid/', {
      signal: new AbortController().signal,
    });
    return;
  } catch {
    // Inconsistent environment, install shim
  }
  scope.Request = NavigationRequest as unknown as typeof Request;
}

installNavigationRequestShim();

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

function validTestJwt(): string {
  const header = btoa(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      sub: 'usr-valid-01',
      roles: ['admin'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  );
  return `${header}.${payload}.mock-signature`;
}

function expiredTestJwt(): string {
  const header = btoa(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      sub: 'usr-expired-01',
      roles: ['admin'],
      exp: Math.floor(Date.now() / 1000) - 300,
    })
  );
  return `${header}.${payload}.mock-signature`;
}

const hubLoginRoute: RouteObject = {
  path: '/login',
  element: <div data-testid="hub-login-screen">Hub login screen</div>,
};

function renderModule(initialPath: string) {
  const router = createMemoryRouter([...erp1Routes, hubLoginRoute], {
    initialEntries: [initialPath],
  });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

describe('ERP-1 Module Route & Shell Integration (ERP1-16 / PLT-08)', () => {
  beforeEach(() => {
    clearAccessToken();
    writeAccessToken(validTestJwt());

    vi.spyOn(api, 'fetchProducts').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 0,
    });
    vi.spyOn(api, 'fetchCategories').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      totalPages: 0,
    });
  });

  afterEach(() => {
    cleanup();
    clearAccessToken();
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Acceptance Criterion 1: Route Registration in React Router & Shell
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Route Table Registration', () => {
    it('registers all manifest routes in React Router', () => {
      const registeredIds = flattenRoutes(erp1Routes)
        .map((r) => r.id)
        .filter((id): id is string => typeof id === 'string');

      for (const descriptor of ERP1_ROUTE_DESCRIPTORS) {
        expect(registeredIds).toContain(`erp1-${descriptor.id}`);
      }
    });

    it('mounts module under the /erp1 base path prefix', () => {
      const root = erp1Routes[0];
      expect(root?.path).toBe('/erp1');
    });

    it('renders products screen inside the common shell', async () => {
      renderModule('/erp1/products');

      expect(screen.getByRole('banner', { name: 'Products & Inventory' })).toBeDefined();
      expect(screen.getByRole('navigation', { name: 'Products & Inventory' })).toBeDefined();
      expect(screen.getByRole('main', { name: 'Products & Inventory content' })).toBeDefined();
    });

    it('renders categories and stock screens inside the common shell', async () => {
      const catView = renderModule('/erp1/categories');
      expect(screen.getByTestId('categories-list-page')).toBeDefined();
      catView.unmount();

      renderModule('/erp1/stock');
      expect(screen.getByTestId('stock-levels-list-page')).toBeDefined();
    });

    it('renders not found page on unknown sub-route', async () => {
      renderModule('/erp1/unknown-screen');
      expect(screen.getByTestId('module-not-found-page')).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Acceptance Criterion 2: Active Navigation & Browser Title
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Active Navigation Highlights & Document Titles', () => {
    it('marks active navigation item with aria-current="page" and is-active class', () => {
      renderModule('/erp1/products');

      const activeLink = screen.getByRole('link', { name: 'Products' });
      expect(activeLink.getAttribute('aria-current')).toBe('page');
      expect(activeLink.className).toContain('is-active');

      const inactiveLink = screen.getByRole('link', { name: 'Categories' });
      expect(inactiveLink.getAttribute('aria-current')).toBeNull();
      expect(inactiveLink.className).not.toContain('is-active');
    });

    it('updates document title based on the active screen', () => {
      renderModule('/erp1/products');
      expect(document.title).toBe('Products · ClearShift ERP');
    });

    it('renders breadcrumb trail with correct module hierarchy', () => {
      renderModule('/erp1/products');
      const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(breadcrumb.textContent).toContain('Products & Inventory');
      expect(breadcrumb.textContent).toContain('Products');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Acceptance Criterion 3: Route Guards & Authentication Redirects
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Route Guards & Auth Redirects', () => {
    it('redirects unauthenticated session to Hub login with returnTo query param', () => {
      clearAccessToken();
      const { router } = renderModule('/erp1/products');

      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.search).toBe('?returnTo=%2Ferp1%2Fproducts');
      expect(screen.getByTestId('hub-login-screen')).toBeDefined();
    });

    it('redirects expired session to Hub login with returnTo', () => {
      writeAccessToken(expiredTestJwt());
      const { router } = renderModule('/erp1/stock');

      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.search).toBe('?returnTo=%2Ferp1%2Fstock');
      expect(screen.getByTestId('hub-login-screen')).toBeDefined();
    });

    it('allows access when valid non-expired access token is present', () => {
      const { router } = renderModule('/erp1/products');
      expect(router.state.location.pathname).toBe('/erp1/products');
      expect(screen.getByRole('banner', { name: 'Products & Inventory' })).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Acceptance Criterion 4: Accessibility Landmarks & Keyboard Navigation
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Accessibility Landmarks & Keyboard Affordances', () => {
    it('exposes banner, navigation, main, and breadcrumb ARIA landmarks', () => {
      renderModule('/erp1/products');

      expect(screen.getByRole('banner', { name: 'Products & Inventory' })).toBeDefined();
      expect(screen.getAllByRole('navigation').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole('main')).toBeDefined();
    });

    it('includes a skip link targeting the main content region', () => {
      renderModule('/erp1/products');

      const skipLink = screen.getByText('Skip to main content');
      expect(skipLink.getAttribute('href')).toBe(`#${ERP1_MAIN_REGION_ID}`);

      const main = screen.getByRole('main');
      expect(main.getAttribute('id')).toBe(ERP1_MAIN_REGION_ID);
      expect(main.getAttribute('tabindex')).toBe('-1');
    });
  });
});
