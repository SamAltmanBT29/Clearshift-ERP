// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Module Navigation Tests
 *
 * Covers the navigation behaviour that the shell suite exercises only
 * indirectly: the fallback to the router location when no explicit path is
 * supplied, and the rendering of a navigation group that owns no screen.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ModuleNav } from '../src/components/ModuleNav.js';

/**
 * The navigation is rendered from the frozen manifest. A group that owns no
 * screen is a defensive case the manifest does not currently contain, so the
 * manifest is stubbed for this suite — the stub leaves only the "People"
 * group with a screen in it.
 */
vi.mock('../src/route-manifest.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/route-manifest.js')>('../src/route-manifest.js');

  return {
    ...actual,
    erp5NavItems: () => [
      {
        id: 'employees',
        path: 'employees',
        label: 'Employees',
        title: 'Employees',
        group: 'people' as const,
      },
    ],
  };
});

describe('ERP-5 module navigation', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('falls back to the router location when no explicit path is supplied', () => {
    render(
      <MemoryRouter initialEntries={['/erp5/employees']}>
        <ModuleNav />
      </MemoryRouter>
    );

    const nav = screen.getByRole('navigation', { name: 'HR and Employees' });
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    // The router location is `/erp5/employees`, so the "Employees" entry is
    // the active one — the fallback resolved the current path.
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('Employees');
  });

  it('omits a navigation group that owns no screen', () => {
    render(
      <MemoryRouter initialEntries={['/erp5/employees']}>
        <ModuleNav pathname="/erp5/employees" />
      </MemoryRouter>
    );

    const nav = screen.getByRole('navigation', { name: 'HR and Employees' });

    // The "Reporting" and "Administration" groups own no screen in the
    // stubbed manifest and are therefore not rendered at all.
    expect(within(nav).queryByText('Reporting')).toBeNull();
    expect(within(nav).queryByText('Administration')).toBeNull();
    expect(within(nav).getByText('People')).toBeDefined();
    expect(within(nav).getByRole('link', { name: 'Employees' })).toBeDefined();
  });
});
