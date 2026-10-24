// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { erp3Routes } from '../src/routes.js';
import { accessTokenWithRoles, clearStoredAccessToken, storeAccessToken } from './support/session.js';

describe('ERP-3 UI authorization', () => {
  beforeEach(() => clearStoredAccessToken());
  afterEach(() => {
    cleanup();
    clearStoredAccessToken();
  });

  function renderPath(path: string) {
    const router = createMemoryRouter(erp3Routes, { initialEntries: [path] });
    return render(<RouterProvider router={router} />);
  }

  it('shows the forbidden state for an analyst on the sales order screen', () => {
    storeAccessToken(accessTokenWithRoles(['analyst']));
    renderPath('/erp3/sales-orders');
    expect(screen.getByRole('heading', { name: 'Access Denied' })).toBeDefined();
  });

  it('allows an editor to open the new sales order screen', () => {
    storeAccessToken(accessTokenWithRoles(['editor']));
    renderPath('/erp3/sales-orders/new');
    expect(screen.getByRole('heading', { name: /new sales order/i })).toBeDefined();
  });

  it('denies a viewer access to the sales order create screen', () => {
    storeAccessToken(accessTokenWithRoles(['viewer']));
    renderPath('/erp3/sales-orders/new');
    expect(screen.getByRole('heading', { name: 'Access Denied' })).toBeDefined();
  });
});
