// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Web Public Facade Test
 *
 * The facade is what a host application imports. The test pins the exported
 * surface so a rename or a missing re-export breaks here rather than in the
 * application that mounts the module.
 */

import { describe, it, expect } from 'vitest';
import * as erp5Web from '../src/index.js';

describe('ERP-5 web public facade', () => {
  it('exports the route table of the module', () => {
    expect(Array.isArray(erp5Web.erp5Routes)).toBe(true);
    expect(erp5Web.erp5Routes).toHaveLength(1);
    expect(erp5Web.erp5Routes[0]?.path).toBe('/erp5');
  });

  it('exports the route manifest and the navigation model', () => {
    expect(erp5Web.ERP5_BASE_PATH).toBe('/erp5');
    expect(erp5Web.HUB_LOGIN_PATH).toBe('/login');
    expect(erp5Web.ERP5_ROUTE_DESCRIPTORS.length).toBeGreaterThan(0);
    expect(erp5Web.ERP5_NAV_GROUPS.length).toBeGreaterThan(0);
  });

  it('exports the session adapter and the route guard', () => {
    expect(typeof erp5Web.getSession).toBe('function');
    expect(typeof erp5Web.readAccessToken).toBe('function');
    expect(erp5Web.RequireAuth).toBeDefined();
  });

  it('exports the shell components', () => {
    expect(erp5Web.ModuleShell).toBeDefined();
    expect(erp5Web.ModuleNav).toBeDefined();
    expect(erp5Web.ModuleBreadcrumbs).toBeDefined();
    expect(erp5Web.ERP5_MAIN_REGION_ID).toBe('erp5-main');
  });

  it('exports the page components', () => {
    expect(erp5Web.ModuleNotFoundPage).toBeDefined();
  });
});
