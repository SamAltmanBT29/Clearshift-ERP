import { describe, it, expect } from 'vitest';
import {
  ERP3_BASE_PATH,
  HUB_LOGIN_PATH,
  ERP3_MODULE_LABEL,
  ERP3_APP_TITLE,
  ERP3_NAV_GROUPS,
  ERP3_ROUTE_DESCRIPTORS,
  erp3RoutePath,
  erp3RoutePathById,
  erp3NavItems,
  matchErp3Route,
  isErp3PathActive,
  findErp3NavItemForPath,
  buildErp3Breadcrumbs,
  resolveErp3DocumentTitle,
} from '../src/route-manifest.js';

describe('ERP-3 route manifest', () => {
  describe('1. Constants and navigation groups', () => {
    it('declares the expected base paths and titles', () => {
      expect(ERP3_BASE_PATH).toBe('/erp3');
      expect(HUB_LOGIN_PATH).toBe('/login');
      expect(ERP3_MODULE_LABEL).toBe('Sales Orders & Invoices');
      expect(ERP3_APP_TITLE).toBe('ClearShift ERP');
    });

    it('declares sales and billing navigation groups in order', () => {
      expect(ERP3_NAV_GROUPS.map((g) => g.id)).toEqual(['sales', 'billing']);
      expect(ERP3_NAV_GROUPS.map((g) => g.label)).toEqual(['Sales', 'Billing & Payments']);
    });
  });

  describe('2. Route descriptors', () => {
    it('has non-empty and unique descriptor IDs', () => {
      const ids = ERP3_ROUTE_DESCRIPTORS.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id.trim().length).toBeGreaterThan(0);
      }
    });

    it('ensures every path is relative and clean', () => {
      for (const descriptor of ERP3_ROUTE_DESCRIPTORS) {
        expect(descriptor.path.startsWith('/')).toBe(false);
        expect(descriptor.path.endsWith('/')).toBe(false);
        expect(descriptor.label.trim().length).toBeGreaterThan(0);
        expect(descriptor.title.trim().length).toBeGreaterThan(0);
      }
    });

    it('includes Master Architecture Spec §3.1 resources: sales-orders, invoices, payments', () => {
      const paths = ERP3_ROUTE_DESCRIPTORS.map((d) => d.path);
      expect(paths).toContain('sales-orders');
      expect(paths).toContain('invoices');
      expect(paths).toContain('payments');
    });

    it('computes absolute route paths', () => {
      expect(erp3RoutePathById('sales-orders')).toBe('/erp3/sales-orders');
      expect(erp3RoutePathById('invoices')).toBe('/erp3/invoices');
      expect(erp3RoutePathById('payments')).toBe('/erp3/payments');
      expect(() => erp3RoutePathById('nonexistent')).toThrow();
    });
  });

  describe('3. Navigation items', () => {
    it('filters only descriptors that declare a group', () => {
      const navItems = erp3NavItems();
      expect(navItems.every((item) => item.group !== null)).toBe(true);
      expect(navItems.map((item) => item.id)).toEqual(['sales-orders', 'invoices', 'payments']);
    });
  });

  describe('4. Path matching', () => {
    it('matches top-level collection routes', () => {
      const orderMatch = matchErp3Route('/erp3/sales-orders');
      expect(orderMatch?.descriptor.id).toBe('sales-orders');

      const invoiceMatch = matchErp3Route('/erp3/invoices');
      expect(invoiceMatch?.descriptor.id).toBe('invoices');

      const paymentsMatch = matchErp3Route('/erp3/payments');
      expect(paymentsMatch?.descriptor.id).toBe('payments');
    });

    it('prioritizes static segments over dynamic params', () => {
      const createMatch = matchErp3Route('/erp3/sales-orders/new');
      expect(createMatch?.descriptor.id).toBe('sales-orders-create');

      const detailMatch = matchErp3Route('/erp3/sales-orders/ord-999');
      expect(detailMatch?.descriptor.id).toBe('sales-orders-detail');
      expect(detailMatch?.params['orderId']).toBe('ord-999');
    });

    it('matches edit routes with params', () => {
      const editMatch = matchErp3Route('/erp3/invoices/inv-456/edit');
      expect(editMatch?.descriptor.id).toBe('invoices-edit');
      expect(editMatch?.params['invoiceId']).toBe('inv-456');
    });

    it('safely handles malformed percent escapes without throwing', () => {
      expect(() => matchErp3Route('/erp3/sales-orders/100%')).not.toThrow();
      const match = matchErp3Route('/erp3/sales-orders/100%');
      expect(match?.params['orderId']).toBe('100%');
    });

    it('returns null for routes outside the erp3 base path or unmatched', () => {
      expect(matchErp3Route('/erp5/employees')).toBeNull();
      expect(matchErp3Route('/login')).toBeNull();
      expect(matchErp3Route('/erp3/something/unmatched/nested/deep')).toBeNull();
    });
  });

  describe('5. Active path detection', () => {
    it('correctly detects active paths respecting segment boundaries', () => {
      expect(isErp3PathActive('/erp3/sales-orders', '/erp3/sales-orders')).toBe(true);
      expect(isErp3PathActive('/erp3/sales-orders', '/erp3/sales-orders/ord-1')).toBe(true);
      expect(isErp3PathActive('/erp3/sales-orders', '/erp3/sales-orders-archive')).toBe(false);
    });

    it('finds navigation item owning a path', () => {
      expect(findErp3NavItemForPath('/erp3/sales-orders/new')?.id).toBe('sales-orders');
      expect(findErp3NavItemForPath('/erp3/invoices/inv-1')?.id).toBe('invoices');
      expect(findErp3NavItemForPath('/erp3/payments')?.id).toBe('payments');
      expect(findErp3NavItemForPath('/other/path')).toBeNull();
    });
  });

  describe('6. Breadcrumb generation', () => {
    it('builds breadcrumb trail for base and sub-paths', () => {
      const rootTrail = buildErp3Breadcrumbs('/erp3');
      expect(rootTrail).toHaveLength(1);
      expect(rootTrail[0]?.label).toBe('Sales Orders & Invoices');
      expect(rootTrail[0]?.isCurrent).toBe(true);

      const orderTrail = buildErp3Breadcrumbs('/erp3/sales-orders');
      expect(orderTrail).toHaveLength(2);
      expect(orderTrail[1]?.label).toBe('Sales orders');
      expect(orderTrail[1]?.isCurrent).toBe(true);

      const createTrail = buildErp3Breadcrumbs('/erp3/sales-orders/new');
      expect(createTrail).toHaveLength(3);
      expect(createTrail[1]?.label).toBe('Sales orders');
      expect(createTrail[2]?.label).toBe('New');
      expect(createTrail[2]?.isCurrent).toBe(true);
    });

    it('returns Not found breadcrumb for unknown entity path', () => {
      const trail = buildErp3Breadcrumbs('/erp3/unknown-entity');
      expect(trail[1]?.label).toBe('Not found');
      expect(trail[1]?.isCurrent).toBe(true);
    });
  });

  describe('7. Document title resolution', () => {
    it('resolves correct document title matching format', () => {
      expect(resolveErp3DocumentTitle('/erp3/sales-orders')).toBe(
        'Sales orders · ClearShift ERP'
      );
      expect(resolveErp3DocumentTitle('/erp3/sales-orders/new')).toBe(
        'New sales order · ClearShift ERP'
      );
      expect(resolveErp3DocumentTitle('/erp3/invoices')).toBe(
        'Invoices · ClearShift ERP'
      );
      expect(resolveErp3DocumentTitle('/erp3/payments')).toBe(
        'Payments · ClearShift ERP'
      );
      expect(resolveErp3DocumentTitle('/unknown')).toBe(
        'Sales Orders & Invoices · ClearShift ERP'
      );
    });
  });
});
