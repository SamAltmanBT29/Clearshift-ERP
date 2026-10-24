// @vitest-environment jsdom
/**
 * ERP-4 Finance and Accounting — Route Registration Tests
 *
 * Proves that every screen of the module is registered in React Router and
 * renders inside the common layout shell.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { installNavigationRequestShim } from './support/jsdom-environment.js';
import { erp4Routes } from '../src/routes.js';
import { ERP4_ROUTE_DESCRIPTORS } from '../src/route-manifest.js';
import { installFinanceApiMock, type FinanceApiMock } from './support/api-mock.js';
import { clearStoredAccessToken, storeAccessToken, validAccessToken } from './support/session.js';

installNavigationRequestShim();

let api: FinanceApiMock;

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
  const router = createMemoryRouter(erp4Routes, { initialEntries: [initialPath] });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

describe('ERP-4 module route registration', () => {
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

  describe('1. The route table', () => {
    it('registers every route of the manifest in React Router', () => {
      const registeredIds = flattenRoutes(erp4Routes)
        .map((route) => route.id)
        .filter((id): id is string => typeof id === 'string');

      for (const descriptor of ERP4_ROUTE_DESCRIPTORS) {
        expect(registeredIds).toContain(`erp4-${descriptor.id}`);
      }
    });

    it('registers no screen that the manifest does not declare', () => {
      const registeredIds = flattenRoutes(erp4Routes)
        .map((route) => route.id)
        .filter((id): id is string => typeof id === 'string');

      const declaredIds = ERP4_ROUTE_DESCRIPTORS.map((descriptor) => `erp4-${descriptor.id}`);
      const structuralIds = ['erp4', 'erp4-shell', 'erp4-index', 'erp4-not-found'];

      for (const id of registeredIds) {
        expect([...declaredIds, ...structuralIds]).toContain(id);
      }
    });

    it('mounts the whole module under the ERP-4 base path', () => {
      const root = erp4Routes[0];
      expect(root?.path).toBe('/erp4');
    });

    it('registers the same paths in the route table as in the manifest', () => {
      const registeredPaths = flattenRoutes(erp4Routes)
        .map((route) => route.path)
        .filter((path): path is string => typeof path === 'string');

      for (const descriptor of ERP4_ROUTE_DESCRIPTORS) {
        expect(registeredPaths).toContain(descriptor.path);
      }
    });
  });

  describe('2. Rendering routes inside the common shell', () => {
    it('renders the accounts screen inside the shell banner and navigation', () => {
      renderModule('/erp4/accounts');
      expect(screen.getByRole('banner', { name: 'Finance & Accounting' })).toBeDefined();
      expect(screen.getByRole('navigation', { name: 'Finance and Accounting' })).toBeDefined();
      expect(screen.getByRole('main', { name: 'Finance & Accounting content' })).toBeDefined();
    });

    it('renders the journal entries screen inside the shell', () => {
      renderModule('/erp4/journal-entries');
      expect(screen.getByRole('banner', { name: 'Finance & Accounting' })).toBeDefined();
      expect(screen.getByRole('main')).toBeDefined();
    });

    it('renders the trial balance screen inside the shell', () => {
      renderModule('/erp4/trial-balance');
      expect(screen.getByRole('banner', { name: 'Finance & Accounting' })).toBeDefined();
      expect(screen.getByRole('heading', { level: 1, name: 'Trial Balance' })).toBeDefined();
    });

    it('renders the not found screen on an unmatched sub-route', () => {
      renderModule('/erp4/not-a-valid-screen');
      expect(screen.getByRole('heading', { level: 1, name: 'Screen not found' })).toBeDefined();
      expect(screen.getByRole('alert')).toBeDefined();
    });
  });
});
