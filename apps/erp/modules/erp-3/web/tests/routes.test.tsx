// @vitest-environment jsdom
/**
 * ERP-3 Sales Orders and Invoices — Route Registration Tests
 *
 * Proves that every screen of the module is registered in React Router and
 * renders inside the common layout shell.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { installNavigationRequestShim } from './support/jsdom-environment.js';
import { erp3Routes } from '../src/routes.js';
import { ERP3_ROUTE_DESCRIPTORS } from '../src/route-manifest.js';
import { installOrdersApiMock, type OrdersApiMock } from './support/api-mock.js';
import { clearStoredAccessToken, storeAccessToken, validAccessToken } from './support/session.js';

installNavigationRequestShim();

let api: OrdersApiMock;

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
  const router = createMemoryRouter(erp3Routes, { initialEntries: [initialPath] });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

describe('ERP-3 module route registration', () => {
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

  describe('1. The route table', () => {
    it('registers every route of the manifest in React Router', () => {
      const registeredIds = flattenRoutes(erp3Routes)
        .map((route) => route.id)
        .filter((id): id is string => typeof id === 'string');

      for (const descriptor of ERP3_ROUTE_DESCRIPTORS) {
        expect(registeredIds).toContain(`erp3-${descriptor.id}`);
      }
    });

    it('registers no screen that the manifest does not declare', () => {
      const registeredIds = flattenRoutes(erp3Routes)
        .map((route) => route.id)
        .filter((id): id is string => typeof id === 'string');

      const declaredIds = ERP3_ROUTE_DESCRIPTORS.map((descriptor) => `erp3-${descriptor.id}`);
      const structuralIds = ['erp3', 'erp3-shell', 'erp3-index', 'erp3-not-found'];

      for (const id of registeredIds) {
        expect([...declaredIds, ...structuralIds]).toContain(id);
      }
    });

    it('mounts the whole module under the ERP-3 base path', () => {
      const root = erp3Routes[0];
      expect(root?.path).toBe('/erp3');
    });

    it('registers the same paths in the route table as in the manifest', () => {
      const registeredPaths = flattenRoutes(erp3Routes)
        .map((route) => route.path)
        .filter((path): path is string => typeof path === 'string');

      for (const descriptor of ERP3_ROUTE_DESCRIPTORS) {
        expect(registeredPaths).toContain(descriptor.path);
      }
    });
  });

  describe('2. Rendering routes inside the common shell', () => {
    it('renders the sales orders screen inside the shell banner and navigation', () => {
      renderModule('/erp3/sales-orders');
      expect(screen.getByRole('banner', { name: 'Sales Orders & Invoices' })).toBeDefined();
      expect(screen.getByRole('navigation', { name: 'Sales Orders and Invoices' })).toBeDefined();
      expect(screen.getByRole('main', { name: 'Sales Orders & Invoices content' })).toBeDefined();
    });

    it('renders the invoices screen inside the shell', () => {
      renderModule('/erp3/invoices');
      expect(screen.getByRole('banner', { name: 'Sales Orders & Invoices' })).toBeDefined();
      expect(screen.getByRole('main')).toBeDefined();
    });

    it('renders the payments screen inside the shell', () => {
      renderModule('/erp3/payments');
      expect(screen.getByRole('banner', { name: 'Sales Orders & Invoices' })).toBeDefined();
      expect(screen.getByRole('heading', { level: 1, name: 'Payments' })).toBeDefined();
    });

    it('renders the not found screen on an unmatched sub-route', () => {
      renderModule('/erp3/not-a-valid-screen');
      expect(screen.getByRole('heading', { level: 1, name: 'Screen not found' })).toBeDefined();
      expect(screen.getByRole('alert')).toBeDefined();
    });
  });
});
