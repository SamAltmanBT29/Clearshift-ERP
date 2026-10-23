/**
 * ERP-2 Vendors & Purchasing — Web Public Facade Test
 *
 * Verifies that the module exports the expected public interface,
 * route table, route manifest, session adapter, shell components,
 * and page components for consumption by the host ERP application.
 */

import { describe, it, expect } from 'vitest';
import * as erp2Web from '../src/index.js';

describe('ERP-2 Web Public Facade', () => {
  it('exports the route table of the module', () => {
    expect(Array.isArray(erp2Web.erp2Routes)).toBe(true);
    expect(erp2Web.erp2Routes).toHaveLength(1);
    expect(erp2Web.erp2Routes[0]?.path).toBe('/erp2');
  });

  it('exports the route manifest and navigation model', () => {
    expect(erp2Web.ERP2_BASE_PATH).toBe('/erp2');
    expect(erp2Web.HUB_LOGIN_PATH).toBe('/login');
    expect(erp2Web.ERP2_MODULE_LABEL).toBe('Vendors & Purchasing');
    expect(erp2Web.ERP2_ROUTE_DESCRIPTORS.length).toBe(8);
    expect(erp2Web.ERP2_NAV_GROUPS.length).toBe(2);
  });

  it('exports the session adapter and route guard', () => {
    expect(typeof erp2Web.getSession).toBe('function');
    expect(typeof erp2Web.readAccessToken).toBe('function');
    expect(typeof erp2Web.writeAccessToken).toBe('function');
    expect(typeof erp2Web.clearAccessToken).toBe('function');
    expect(typeof erp2Web.isSessionActive).toBe('function');
    expect(erp2Web.RequireAuth).toBeDefined();
  });

  it('exports the shell components and landmark identifiers', () => {
    expect(erp2Web.ModuleShell).toBeDefined();
    expect(erp2Web.ModuleNav).toBeDefined();
    expect(erp2Web.ModuleBreadcrumbs).toBeDefined();
    expect(erp2Web.ERP2_MAIN_REGION_ID).toBe('erp2-main');
  });

  it('exports all 9 page components', () => {
    expect(erp2Web.VendorsListPage).toBeDefined();
    expect(erp2Web.VendorCreatePage).toBeDefined();
    expect(erp2Web.VendorDetailPage).toBeDefined();
    expect(erp2Web.VendorEditPage).toBeDefined();
    expect(erp2Web.PurchaseOrdersListPage).toBeDefined();
    expect(erp2Web.PurchaseOrderCreatePage).toBeDefined();
    expect(erp2Web.PurchaseOrderDetailPage).toBeDefined();
    expect(erp2Web.ImportReceiptsListPage).toBeDefined();
    expect(erp2Web.ModuleNotFoundPage).toBeDefined();
  });
});
