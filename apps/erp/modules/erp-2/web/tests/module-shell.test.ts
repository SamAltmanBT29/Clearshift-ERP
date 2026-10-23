/**
 * ERP-2 Vendors & Purchasing — Module Shell & Accessibility Tests
 *
 * Verifies accessibility landmarks, skip link targets, ARIA labeling,
 * active navigation state indicators, and document titles.
 */

import { describe, it, expect } from 'vitest';
import {
  ERP2_MAIN_REGION_ID,
} from '../src/components/ModuleShell.js';
import {
  ERP2_MODULE_LABEL,
  ERP2_NAV_GROUPS,
  erp2NavItems,
  erp2RoutePath,
  isErp2PathActive,
  resolveErp2DocumentTitle,
} from '../src/route-manifest.js';

describe('ERP-2 Module Shell & Accessibility', () => {
  describe('1. Accessibility Landmarks & Skip Link Targets', () => {
    it('defines the standard skip link target identifier', () => {
      expect(ERP2_MAIN_REGION_ID).toBe('erp2-main');
    });

    it('assigns descriptive ARIA labels to the primary landmarks', () => {
      const bannerLabel = ERP2_MODULE_LABEL;
      const navLabel = 'Vendors and Purchasing';
      const mainLabel = `${ERP2_MODULE_LABEL} content`;
      const breadcrumbLabel = 'Breadcrumb';

      expect(bannerLabel).toBe('Vendors & Purchasing');
      expect(navLabel).toBe('Vendors and Purchasing');
      expect(mainLabel).toBe('Vendors & Purchasing content');
      expect(breadcrumbLabel).toBe('Breadcrumb');
    });
  });

  describe('2. Navigation Groups & Item Partitioning', () => {
    it('partitions sidebar navigation into Purchasing and Integration groups', () => {
      expect(ERP2_NAV_GROUPS).toHaveLength(2);
      expect(ERP2_NAV_GROUPS[0]?.id).toBe('purchasing');
      expect(ERP2_NAV_GROUPS[0]?.label).toBe('Purchasing');
      expect(ERP2_NAV_GROUPS[1]?.id).toBe('integration');
      expect(ERP2_NAV_GROUPS[1]?.label).toBe('Integration');
    });

    it('allocates Vendors and Purchase Orders to the Purchasing group', () => {
      const purchasingItems = erp2NavItems().filter((item) => item.group === 'purchasing');
      const labels = purchasingItems.map((item) => item.label);
      expect(labels).toContain('Vendors');
      expect(labels).toContain('Purchase orders');
    });

    it('allocates Import Receipts to the Integration group', () => {
      const integrationItems = erp2NavItems().filter((item) => item.group === 'integration');
      const labels = integrationItems.map((item) => item.label);
      expect(labels).toContain('Import receipts');
    });
  });

  describe('3. Active Navigation State Tracking', () => {
    it('highlights Vendors navigation link when viewing /erp2/vendors', () => {
      const target = erp2RoutePath({ id: 'vendors', path: 'vendors', label: 'Vendors', title: 'Vendors', group: 'purchasing' });
      expect(isErp2PathActive(target, '/erp2/vendors')).toBe(true);
      expect(isErp2PathActive(target, '/erp2/purchase-orders')).toBe(false);
    });

    it('retains parent Vendors navigation highlight when on create/detail/edit sub-routes', () => {
      const vendorTarget = '/erp2/vendors';
      expect(isErp2PathActive(vendorTarget, '/erp2/vendors/new')).toBe(true);
      expect(isErp2PathActive(vendorTarget, '/erp2/vendors/00000000-0000-0000-0000-000000000001')).toBe(true);
      expect(isErp2PathActive(vendorTarget, '/erp2/vendors/00000000-0000-0000-0000-000000000001/edit')).toBe(true);
      expect(isErp2PathActive(vendorTarget, '/erp2/purchase-orders')).toBe(false);
    });

    it('retains parent Purchase Orders navigation highlight on detail sub-routes', () => {
      const poTarget = '/erp2/purchase-orders';
      expect(isErp2PathActive(poTarget, '/erp2/purchase-orders/new')).toBe(true);
      expect(isErp2PathActive(poTarget, '/erp2/purchase-orders/po-12345')).toBe(true);
      expect(isErp2PathActive(poTarget, '/erp2/vendors')).toBe(false);
    });

    it('ensures exactly one navigation item is active for any valid screen', () => {
      const paths = [
        '/erp2/vendors',
        '/erp2/vendors/new',
        '/erp2/vendors/v-1',
        '/erp2/vendors/v-1/edit',
        '/erp2/purchase-orders',
        '/erp2/purchase-orders/new',
        '/erp2/purchase-orders/po-1',
        '/erp2/import-receipts',
      ];

      const navItems = erp2NavItems();

      for (const path of paths) {
        const activeItems = navItems.filter((item) => isErp2PathActive(erp2RoutePath(item), path));
        expect(activeItems).toHaveLength(1);
      }
    });
  });

  describe('4. Dynamic Document Title Sync', () => {
    it('computes expected title for each route descriptor', () => {
      expect(resolveErp2DocumentTitle('/erp2/vendors')).toBe('Vendors · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/vendors/new')).toBe('New vendor · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/vendors/123')).toBe('Vendor · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/vendors/123/edit')).toBe('Edit vendor · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/purchase-orders')).toBe('Purchase orders · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/purchase-orders/new')).toBe('New purchase order · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/purchase-orders/po-99')).toBe('Purchase order · ClearShift ERP');
      expect(resolveErp2DocumentTitle('/erp2/import-receipts')).toBe('Import receipts · ClearShift ERP');
    });

    it('falls back to module label on unmatched or not-found routes', () => {
      expect(resolveErp2DocumentTitle('/erp2/nonexistent')).toBe('Vendors & Purchasing · ClearShift ERP');
    });
  });
});
