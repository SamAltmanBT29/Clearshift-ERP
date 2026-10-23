/**
 * ERP-2 Vendors & Purchasing — Route Table Tests
 *
 * Verifies that the React Router route definitions match the manifest,
 * are properly nested under the authentication guard and common layout shell,
 * and define the index redirect and 404 catch-all.
 */

import { describe, it, expect } from 'vitest';
import type { RouteObject } from 'react-router-dom';
import { erp2Routes } from '../src/routes.js';
import { ERP2_ROUTE_DESCRIPTORS, ERP2_BASE_PATH } from '../src/route-manifest.js';

interface FlattenedRoute {
  readonly id?: string | undefined;
  readonly path?: string | undefined;
  readonly index?: boolean | undefined;
}

function flattenRoutes(routes: RouteObject[]): FlattenedRoute[] {
  const flat: FlattenedRoute[] = [];
  for (const route of routes) {
    flat.push({ id: route.id, path: route.path, index: route.index });
    if (route.children) {
      flat.push(...flattenRoutes(route.children));
    }
  }
  return flat;
}

describe('ERP-2 Route Table Registration', () => {
  describe('1. Structure & Root Guard Nesting', () => {
    it('mounts the root route under ERP2_BASE_PATH (/erp2)', () => {
      const root = erp2Routes[0];
      expect(root).toBeDefined();
      expect(root?.id).toBe('erp2');
      expect(root?.path).toBe(ERP2_BASE_PATH);
    });

    it('nests the entire module under the authentication guard and shell', () => {
      const root = erp2Routes[0];
      expect(root?.element).toBeDefined(); // <RequireAuth />
      const shellRoute = root?.children?.[0];
      expect(shellRoute?.id).toBe('erp2-shell');
      expect(shellRoute?.element).toBeDefined(); // <ModuleShell />
      expect(shellRoute?.children && shellRoute.children.length > 0).toBe(true);
    });

    it('registers index redirect to /erp2/vendors', () => {
      const shellChildren = erp2Routes[0]?.children?.[0]?.children ?? [];
      const indexRoute = shellChildren.find((r) => r.id === 'erp2-index');
      expect(indexRoute).toBeDefined();
      expect(indexRoute?.index).toBe(true);
    });

    it('registers catch-all not-found route', () => {
      const shellChildren = erp2Routes[0]?.children?.[0]?.children ?? [];
      const notFoundRoute = shellChildren.find((r) => r.id === 'erp2-not-found');
      expect(notFoundRoute).toBeDefined();
      expect(notFoundRoute?.path).toBe('*');
    });
  });

  describe('2. Manifest-Route Parity', () => {
    it('registers every descriptor from route-manifest in the router', () => {
      const allRoutes = flattenRoutes(erp2Routes);
      const registeredIds = allRoutes
        .map((r) => r.id)
        .filter((id): id is string => typeof id === 'string');

      for (const descriptor of ERP2_ROUTE_DESCRIPTORS) {
        expect(registeredIds).toContain(`erp2-${descriptor.id}`);
      }
    });

    it('registers matching relative paths for every descriptor', () => {
      const allRoutes = flattenRoutes(erp2Routes);
      const registeredPaths = allRoutes
        .map((r) => r.path)
        .filter((p): p is string => typeof p === 'string');

      for (const descriptor of ERP2_ROUTE_DESCRIPTORS) {
        expect(registeredPaths).toContain(descriptor.path);
      }
    });

    it('contains no unregistered orphaned screens outside the manifest', () => {
      const allRoutes = flattenRoutes(erp2Routes);
      const registeredIds = allRoutes
        .map((r) => r.id)
        .filter((id): id is string => typeof id === 'string');

      const expectedIds = [
        'erp2',
        'erp2-shell',
        'erp2-index',
        'erp2-not-found',
        ...ERP2_ROUTE_DESCRIPTORS.map((d) => `erp2-${d.id}`),
      ];

      for (const id of registeredIds) {
        expect(expectedIds).toContain(id);
      }
    });
  });
});
