/**
 * ERP-1 Products & Inventory — Route Manifest Unit Tests (ERP1-16)
 *
 * Verifies:
 *   1. Constants and navigation groups.
 *   2. Route descriptors declaration and uniqueness.
 *   3. Navigation items and path computation.
 *   4. URL segment matching and static vs dynamic precedence.
 *   5. Active path determination and item lookups.
 *   6. Document title and breadcrumb generation.
 *
 * @module erp1/web/tests/route-manifest.test
 */

import { describe, it, expect } from 'vitest';
import {
  ERP1_BASE_PATH,
  HUB_LOGIN_PATH,
  ERP1_MODULE_LABEL,
  ERP1_APP_TITLE,
  ERP1_NAV_GROUPS,
  ERP1_ROUTE_DESCRIPTORS,
  erp1RoutePath,
  erp1RoutePathById,
  erp1NavItems,
  matchErp1Route,
  isErp1PathActive,
  findErp1NavItemForPath,
  buildErp1Breadcrumbs,
  resolveErp1DocumentTitle,
} from '../src/route-manifest.js';

describe('ERP-1 Route Manifest (ERP1-16)', () => {
  describe('1. Constants and Navigation Groups', () => {
    it('declares the expected base path, login path, and titles', () => {
      expect(ERP1_BASE_PATH).toBe('/erp1');
      expect(HUB_LOGIN_PATH).toBe('/login');
      expect(ERP1_MODULE_LABEL).toBe('Products & Inventory');
      expect(ERP1_APP_TITLE).toBe('ClearShift ERP');
    });

    it('declares catalog, inventory, and migration navigation groups in order', () => {
      expect(ERP1_NAV_GROUPS.map((g) => g.id)).toEqual(['catalog', 'inventory', 'migration']);
      expect(ERP1_NAV_GROUPS.map((g) => g.label)).toEqual(['Catalog', 'Inventory', 'Migration']);
    });
  });

  describe('2. Route Descriptors', () => {
    it('has non-empty and unique descriptor IDs', () => {
      const ids = ERP1_ROUTE_DESCRIPTORS.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id.trim().length).toBeGreaterThan(0);
      }
    });

    it('ensures every path is clean and relative', () => {
      for (const descriptor of ERP1_ROUTE_DESCRIPTORS) {
        expect(descriptor.path.startsWith('/')).toBe(false);
        expect(descriptor.path.endsWith('/')).toBe(false);
        expect(descriptor.label.trim().length).toBeGreaterThan(0);
        expect(descriptor.title.trim().length).toBeGreaterThan(0);
      }
    });

    it('includes core SDS resources: products, categories, stock, duplicates, import', () => {
      const paths = ERP1_ROUTE_DESCRIPTORS.map((d) => d.path);
      expect(paths).toContain('products');
      expect(paths).toContain('categories');
      expect(paths).toContain('stock');
      expect(paths).toContain('duplicates');
      expect(paths).toContain('import');
    });

    it('computes absolute route paths', () => {
      expect(erp1RoutePathById('products')).toBe('/erp1/products');
      expect(erp1RoutePathById('categories')).toBe('/erp1/categories');
      expect(erp1RoutePathById('stock')).toBe('/erp1/stock');
      expect(erp1RoutePathById('duplicates')).toBe('/erp1/duplicates');
      expect(erp1RoutePathById('import')).toBe('/erp1/import');
      expect(() => erp1RoutePathById('nonexistent')).toThrow();
    });
  });

  describe('3. Navigation Items', () => {
    it('filters only descriptors that declare a navigation group', () => {
      const navItems = erp1NavItems();
      expect(navItems.every((item) => item.group !== null)).toBe(true);
      expect(navItems.map((item) => item.id)).toEqual([
        'products',
        'categories',
        'stock',
        'duplicates',
        'import',
      ]);
    });
  });

  describe('4. Path Matching', () => {
    it('matches top-level collection routes', () => {
      const prodMatch = matchErp1Route('/erp1/products');
      expect(prodMatch?.descriptor.id).toBe('products');

      const catMatch = matchErp1Route('/erp1/categories');
      expect(catMatch?.descriptor.id).toBe('categories');

      const stockMatch = matchErp1Route('/erp1/stock');
      expect(stockMatch?.descriptor.id).toBe('stock');

      const dupMatch = matchErp1Route('/erp1/duplicates');
      expect(dupMatch?.descriptor.id).toBe('duplicates');
    });

    it('prioritizes static segments over dynamic parameters', () => {
      const createMatch = matchErp1Route('/erp1/products/new');
      expect(createMatch?.descriptor.id).toBe('products-create');

      const detailMatch = matchErp1Route('/erp1/products/prod-001');
      expect(detailMatch?.descriptor.id).toBe('products-detail');
      expect(detailMatch?.params['productId']).toBe('prod-001');
    });

    it('matches edit routes with parameters', () => {
      const editMatch = matchErp1Route('/erp1/products/prod-001/edit');
      expect(editMatch?.descriptor.id).toBe('products-edit');
      expect(editMatch?.params['productId']).toBe('prod-001');
    });

    it('returns null for paths outside the /erp1 prefix', () => {
      expect(matchErp1Route('/erp2/vendors')).toBeNull();
      expect(matchErp1Route('/login')).toBeNull();
      expect(matchErp1Route('/')).toBeNull();
    });
  });

  describe('5. Active Navigation State and Lookups', () => {
    it('determines if a pathname belongs to a nav entry', () => {
      expect(isErp1PathActive('/erp1/products', '/erp1/products')).toBe(true);
      expect(isErp1PathActive('/erp1/products', '/erp1/products/new')).toBe(true);
      expect(isErp1PathActive('/erp1/products', '/erp1/products/prod-123')).toBe(true);
      expect(isErp1PathActive('/erp1/products', '/erp1/products-archive')).toBe(false);
      expect(isErp1PathActive('/erp1/products', '/erp1/categories')).toBe(false);
    });

    it('finds the nav item descriptor for sub-paths', () => {
      const found = findErp1NavItemForPath('/erp1/products/new');
      expect(found?.id).toBe('products');

      const foundStock = findErp1NavItemForPath('/erp1/stock');
      expect(foundStock?.id).toBe('stock');

      const outside = findErp1NavItemForPath('/other/path');
      expect(outside).toBeNull();
    });
  });

  describe('6. Document Titles and Breadcrumbs', () => {
    it('resolves document title with application suffix', () => {
      expect(resolveErp1DocumentTitle('/erp1/products')).toBe('Products · ClearShift ERP');
      expect(resolveErp1DocumentTitle('/erp1/products/new')).toBe('New product · ClearShift ERP');
      expect(resolveErp1DocumentTitle('/erp1/stock')).toBe('Stock levels · ClearShift ERP');
      expect(resolveErp1DocumentTitle('/unknown')).toBe('Products & Inventory · ClearShift ERP');
    });

    it('builds standard breadcrumb trail hierarchy', () => {
      const listCrumbs = buildErp1Breadcrumbs('/erp1/products');
      expect(listCrumbs).toHaveLength(2);
      expect(listCrumbs[0]).toEqual({ label: 'Products & Inventory', href: '/erp1' });
      expect(listCrumbs[1]).toEqual({ label: 'Products', isCurrent: true });

      const newCrumbs = buildErp1Breadcrumbs('/erp1/products/new');
      expect(newCrumbs).toHaveLength(3);
      expect(newCrumbs[0]).toEqual({ label: 'Products & Inventory', href: '/erp1' });
      expect(newCrumbs[1]).toEqual({ label: 'Products', href: '/erp1/products' });
      expect(newCrumbs[2]).toEqual({ label: 'New', isCurrent: true });
    });
  });
});
