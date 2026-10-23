// @vitest-environment jsdom
/**
 * ERP-3 Sales Orders and Invoices — Module Navigation Component Tests
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ModuleNav } from '../src/components/ModuleNav.js';

describe('ERP-3 ModuleNav', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders all navigation groups with their headings', () => {
    render(
      <MemoryRouter initialEntries={['/erp3/sales-orders']}>
        <ModuleNav />
      </MemoryRouter>
    );

    expect(screen.getByRole('navigation', { name: 'Sales Orders and Invoices' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: 'Sales' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: 'Billing & Payments' })).toBeDefined();
  });

  it('marks current navigation item active based on pathname prop', () => {
    render(
      <MemoryRouter initialEntries={['/erp3']}>
        <ModuleNav pathname="/erp3/invoices" />
      </MemoryRouter>
    );

    const invoicesLink = screen.getByRole('link', { name: 'Invoices' });
    expect(invoicesLink.getAttribute('aria-current')).toBe('page');
    expect(invoicesLink.className).toContain('is-active');

    const ordersLink = screen.getByRole('link', { name: 'Sales orders' });
    expect(ordersLink.getAttribute('aria-current')).toBeNull();
  });
});
