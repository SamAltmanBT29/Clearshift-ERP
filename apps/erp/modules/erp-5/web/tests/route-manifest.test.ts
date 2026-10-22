/**
 * ERP-5 HR & Employees — Route Manifest Unit Tests
 *
 * The manifest is the single source of truth for the route table, the
 * navigation hierarchy, the breadcrumb trail and the browser title. These
 * tests are pure — no DOM is involved.
 */

import { describe, it, expect } from 'vitest';
import {
  ERP5_BASE_PATH,
  ERP5_NAV_GROUPS,
  ERP5_ROUTE_DESCRIPTORS,
  buildErp5Breadcrumbs,
  erp5RoutePath,
  erp5RoutePathById,
  findErp5NavItemForPath,
  isErp5PathActive,
  matchErp5Route,
  resolveErp5DocumentTitle,
} from '../src/route-manifest.js';

describe('ERP-5 route manifest', () => {
  describe('1. Frozen route table', () => {
    it('registers the five module resources plus their create and detail routes', () => {
      const ids = ERP5_ROUTE_DESCRIPTORS.map((descriptor) => descriptor.id);
      expect(ids).toEqual([
        'employees',
        'employees-create',
        'employees-detail',
        'departments',
        'departments-create',
        'departments-detail',
        'leave',
        'leave-create',
        'leave-detail',
        'payroll-totals',
        'identity-users',
      ]);
    });

    it('gives every route a unique id', () => {
      const ids = ERP5_ROUTE_DESCRIPTORS.map((descriptor) => descriptor.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('keeps every route under the module base path', () => {
      for (const descriptor of ERP5_ROUTE_DESCRIPTORS) {
        expect(erp5RoutePath(descriptor).startsWith(`${ERP5_BASE_PATH}/`)).toBe(true);
      }
    });

    it('resolves a route path by its descriptor id', () => {
      expect(erp5RoutePathById('leave')).toBe('/erp5/leave');
      expect(() => erp5RoutePathById('does-not-exist')).toThrow(/Unknown ERP-5 route/);
    });
  });

  describe('2. Navigation hierarchy', () => {
    it('exposes the three navigation groups in display order', () => {
      expect(ERP5_NAV_GROUPS.map((group) => group.id)).toEqual([
        'people',
        'reporting',
        'administration',
      ]);
    });

    it('lists only the list screens in the navigation', () => {
      const navigable = ERP5_ROUTE_DESCRIPTORS.filter((descriptor) => descriptor.group !== null);
      expect(navigable.map((descriptor) => descriptor.id)).toEqual([
        'employees',
        'departments',
        'leave',
        'payroll-totals',
        'identity-users',
      ]);
    });

    it('gives every navigation entry a declared group', () => {
      const groupIds = ERP5_NAV_GROUPS.map((group) => group.id);
      for (const descriptor of ERP5_ROUTE_DESCRIPTORS) {
        if (descriptor.group !== null) {
          expect(groupIds).toContain(descriptor.group);
        }
      }
    });
  });

  describe('3. Route matching', () => {
    it('matches a list route exactly', () => {
      const match = matchErp5Route('/erp5/employees');
      expect(match?.descriptor.id).toBe('employees');
      expect(match?.params).toEqual({});
    });

    it('matches a static create route ahead of the dynamic detail route', () => {
      const match = matchErp5Route('/erp5/employees/new');
      expect(match?.descriptor.id).toBe('employees-create');
    });

    it('captures the record identifier of a detail route', () => {
      const match = matchErp5Route('/erp5/employees/e1000000-0000-4000-8000-000000000001');
      expect(match?.descriptor.id).toBe('employees-detail');
      expect(match?.params['employeeId']).toBe('e1000000-0000-4000-8000-000000000001');
    });

    it('returns no match for a path outside the module', () => {
      expect(matchErp5Route('/erp4/accounts')).toBeNull();
      expect(matchErp5Route('/')).toBeNull();
    });

    it('does not match a partially equal static segment', () => {
      expect(matchErp5Route('/erp5/employees-archive')).toBeNull();
    });

    it('matches a detail route whose identifier carries a malformed percent escape', () => {
      // A browser can hand the module any pathname. `decodeURIComponent`
      // throws on a malformed escape, which must not take the shell down.
      const match = matchErp5Route('/erp5/employees/100%');
      expect(match?.descriptor.id).toBe('employees-detail');
      expect(match?.params['employeeId']).toBe('100%');
    });

    it('decodes a well-formed percent escape in a route identifier', () => {
      const match = matchErp5Route('/erp5/employees/e%20100');
      expect(match?.params['employeeId']).toBe('e 100');
    });
  });

  describe('4. Active navigation state', () => {
    it('is active on the exact path and on its descendants', () => {
      expect(isErp5PathActive('/erp5/employees', '/erp5/employees')).toBe(true);
      expect(isErp5PathActive('/erp5/employees', '/erp5/employees/123')).toBe(true);
    });

    it('is not active for a sibling that merely shares a prefix', () => {
      expect(isErp5PathActive('/erp5/employees', '/erp5/employees-archive')).toBe(false);
      expect(isErp5PathActive('/erp5/leave', '/erp5/employees')).toBe(false);
    });

    it('finds the navigation entry that owns a detail path', () => {
      const owner = findErp5NavItemForPath('/erp5/leave/leave-1');
      expect(owner?.id).toBe('leave');
    });

    it('finds no navigation entry outside the module', () => {
      expect(findErp5NavItemForPath('/kit/batches')).toBeNull();
    });
  });

  describe('5. Breadcrumb trail', () => {
    it('shows the module and the entity of a list route', () => {
      const trail = buildErp5Breadcrumbs('/erp5/employees');
      expect(trail.map((item) => item.label)).toEqual(['HR & Employees', 'Employees']);
      expect(trail[1]?.isCurrent).toBe(true);
    });

    it('links back to the list screen from a detail route', () => {
      const trail = buildErp5Breadcrumbs('/erp5/employees/abc-123');
      expect(trail.map((item) => item.label)).toEqual(['HR & Employees', 'Employees', 'abc-123']);
      expect(trail[1]?.href).toBe('/erp5/employees');
    });

    it('shows the create step of a create route', () => {
      const trail = buildErp5Breadcrumbs('/erp5/departments/new');
      expect(trail.map((item) => item.label)).toEqual(['HR & Employees', 'Departments', 'New']);
    });

    it('builds a trail for an identifier with a malformed percent escape', () => {
      const trail = buildErp5Breadcrumbs('/erp5/employees/100%');
      expect(trail.map((item) => item.label)).toEqual(['HR & Employees', 'Employees', '100%']);
    });
  });

  describe('6. Browser title', () => {
    it('titles a list route with its entity name', () => {
      expect(resolveErp5DocumentTitle('/erp5/employees')).toBe('Employees · ClearShift ERP');
      expect(resolveErp5DocumentTitle('/erp5/payroll-totals')).toBe('Payroll totals · ClearShift ERP');
    });

    it('titles a create route with the create label', () => {
      expect(resolveErp5DocumentTitle('/erp5/leave/new')).toBe('New leave record · ClearShift ERP');
    });

    it('falls back to the module name outside a known route', () => {
      expect(resolveErp5DocumentTitle('/erp4/accounts')).toBe('HR & Employees · ClearShift ERP');
    });

    it('titles a detail route whose identifier carries a malformed percent escape', () => {
      expect(resolveErp5DocumentTitle('/erp5/employees/100%')).toBe('Employee · ClearShift ERP');
    });
  });
});
