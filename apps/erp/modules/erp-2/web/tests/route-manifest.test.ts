/**
 * ERP-2 Vendors & Purchasing — Route Manifest Tests
 *
 * Verifies that the route manifest defines a coherent single source of truth
 * for route paths, navigation hierarchy, active route detection, breadcrumbs,
 * and browser titles.
 */

import { describe, it, expect } from 'vitest';
import {
  ERP2_BASE_PATH,
  ERP2_MODULE_LABEL,
  ERP2_APP_TITLE,
  ERP2_NAV_GROUPS,
  ERP2_ROUTE_DESCRIPTORS,
  buildErp2Breadcrumbs,
  erp2NavItems,
  erp2RoutePath,
  erp2RoutePathById,
  findErp2NavItemForPath,
  isErp2PathActive,
  matchErp2Route,
  resolveErp2DocumentTitle,
} from '../src/route-manifest.js';

describe('ERP-2 Route Manifest', () => {
  describe('1. Frozen Route Table & Navigation Hierarchy', () => {
    it('declares the 8 standard module routes for Vendors, POs, and Import Receipts', () => {
      const ids = ERP2_ROUTE_DESCRIPTORS.map((d) => d.id);
      expect(ids).toEqual([
        'vendors',
        'vendors-create',
        'vendors-detail',
        'vendors-edit',
        'purchase-orders',
        'purchase-orders-create',
        'purchase-orders-detail',
        'import-receipts',
      ]);
    });

    it('ensures every route descriptor has a unique identifier', () => {
      const ids = ERP2_ROUTE_DESCRIPTORS.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('mounts all descriptors under the /erp2 module base path', () => {
      for (const descriptor of ERP2_ROUTE_DESCRIPTORS) {
        const full = erp2RoutePath(descriptor);
        expect(full.startsWith('/erp2/')).toBe(true);
      }
    });

    it('partitions navigation groups into Purchasing and Integration', () => {
      const groups = ERP2_NAV_GROUPS.map((g) => g.id);
      expect(groups).toEqual(['purchasing', 'integration']);
    });

    it('erp2NavItems filters out child/detail routes (group: null)', () => {
      const navItems = erp2NavItems();
      const ids = navItems.map((item) => item.id);
      expect(ids).toEqual(['vendors', 'purchase-orders', 'import-receipts']);
      for (const item of navItems) {
        expect(item.group).not.toBeNull();
      }
    });

    it('resolves routes by descriptor ID via erp2RoutePathById', () => {
      expect(erp2RoutePathById('vendors')).toBe('/erp2/vendors');
      expect(erp2RoutePathById('vendors-create')).toBe('/erp2/vendors/new');
      expect(erp2RoutePathById('purchase-orders')).toBe('/erp2/purchase-orders');
      expect(erp2RoutePathById('import-receipts')).toBe('/erp2/import-receipts');
      expect(() => erp2RoutePathById('nonexistent')).toThrowError("Unknown ERP-2 route descriptor: 'nonexistent'");
    });
  });

  describe('2. Route Matching & Param Extraction', () => {
    it('prioritizes static create route over parameterized detail route', () => {
      const matched = matchErp2Route('/erp2/vendors/new');
      expect(matched).not.toBeNull();
      expect(matched?.descriptor.id).toBe('vendors-create');
      expect(matched?.params).toEqual({});
    });

    it('matches parameterized vendor detail route', () => {
      const matched = matchErp2Route('/erp2/vendors/00000000-0000-0000-0000-000000000001');
      expect(matched).not.toBeNull();
      expect(matched?.descriptor.id).toBe('vendors-detail');
      expect(matched?.params.vendorId).toBe('00000000-0000-0000-0000-000000000001');
    });

    it('matches vendor edit sub-route', () => {
      const matched = matchErp2Route('/erp2/vendors/v-123/edit');
      expect(matched).not.toBeNull();
      expect(matched?.descriptor.id).toBe('vendors-edit');
      expect(matched?.params.vendorId).toBe('v-123');
    });

    it('matches parameterized purchase order detail route', () => {
      const matched = matchErp2Route('/erp2/purchase-orders/po-999');
      expect(matched).not.toBeNull();
      expect(matched?.descriptor.id).toBe('purchase-orders-detail');
      expect(matched?.params.purchaseOrderId).toBe('po-999');
    });

    it('safely decodes path parameters without throwing on malformed percent escapes', () => {
      const matched = matchErp2Route('/erp2/vendors/invalid%escape');
      expect(matched).not.toBeNull();
      expect(matched?.descriptor.id).toBe('vendors-detail');
      expect(matched?.params.vendorId).toBe('invalid%escape');
    });

    it('returns null on unhandled route or different module prefix', () => {
      expect(matchErp2Route('/erp1/products')).toBeNull();
      expect(matchErp2Route('/erp2/extra/segments/not/found')).toBeNull();
    });
  });

  describe('3. Active Path Matching (isErp2PathActive & findErp2NavItemForPath)', () => {
    it('matches exact paths as active', () => {
      expect(isErp2PathActive('/erp2/vendors', '/erp2/vendors')).toBe(true);
      expect(isErp2PathActive('/erp2/purchase-orders', '/erp2/purchase-orders')).toBe(true);
    });

    it('matches child sub-routes as active for their parent nav item', () => {
      expect(isErp2PathActive('/erp2/vendors', '/erp2/vendors/new')).toBe(true);
      expect(isErp2PathActive('/erp2/vendors', '/erp2/vendors/v-1/edit')).toBe(true);
      expect(isErp2PathActive('/erp2/purchase-orders', '/erp2/purchase-orders/po-123')).toBe(true);
    });

    it('enforces strict segment boundaries and rejects substring prefixes', () => {
      expect(isErp2PathActive('/erp2/vendors', '/erp2/vendors-archive')).toBe(false);
      expect(isErp2PathActive('/erp2/purchase-orders', '/erp2/purchase-orders-old')).toBe(false);
    });

    it('findErp2NavItemForPath returns the correct parent descriptor', () => {
      expect(findErp2NavItemForPath('/erp2/vendors/new')?.id).toBe('vendors');
      expect(findErp2NavItemForPath('/erp2/purchase-orders/po-1')?.id).toBe('purchase-orders');
      expect(findErp2NavItemForPath('/erp2/import-receipts')?.id).toBe('import-receipts');
      expect(findErp2NavItemForPath('/erp2/unregistered')).toBeNull();
    });
  });

  describe('4. Breadcrumb Construction', () => {
    it('constructs breadcrumb for root module list view', () => {
      const trail = buildErp2Breadcrumbs('/erp2/vendors');
      expect(trail).toEqual([
        { label: 'Vendors & Purchasing', href: '/erp2' },
        { label: 'Vendors', isCurrent: true },
      ]);
    });

    it('constructs breadcrumb for static create view', () => {
      const trail = buildErp2Breadcrumbs('/erp2/vendors/new');
      expect(trail).toEqual([
        { label: 'Vendors & Purchasing', href: '/erp2' },
        { label: 'Vendors', href: '/erp2/vendors' },
        { label: 'New', isCurrent: true },
      ]);
    });

    it('constructs breadcrumb for record detail view', () => {
      const trail = buildErp2Breadcrumbs('/erp2/purchase-orders/po-888');
      expect(trail).toEqual([
        { label: 'Vendors & Purchasing', href: '/erp2' },
        { label: 'Purchase orders', href: '/erp2/purchase-orders' },
        { label: 'po-888', isCurrent: true },
      ]);
    });

    it('constructs breadcrumb for edit view', () => {
      const trail = buildErp2Breadcrumbs('/erp2/vendors/v-1/edit');
      expect(trail).toEqual([
        { label: 'Vendors & Purchasing', href: '/erp2' },
        { label: 'Vendors', href: '/erp2/vendors' },
        { label: 'v-1', isCurrent: false },
        { label: 'Edit', isCurrent: true },
      ]);
    });

    it('handles unrecognized path with Not Found marker', () => {
      const trail = buildErp2Breadcrumbs('/erp2/mystery');
      expect(trail).toEqual([
        { label: 'Vendors & Purchasing', href: '/erp2' },
        { label: 'Not found', isCurrent: true },
      ]);
    });
  });

  describe('5. Document Title Resolution', () => {
    it('formats document title with application suffix', () => {
      expect(resolveErp2DocumentTitle('/erp2/vendors')).toBe('Vendors · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/vendors/new')).toBe('New vendor · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/vendors/v-1')).toBe('Vendor · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/purchase-orders')).toBe('Purchase orders · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/purchase-orders/new')).toBe('New purchase order · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/import-receipts')).toBe('Import receipts · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/unknown')).toBe('Vendors & Purchasing · ClearShift ERP');
    });
  });
});
