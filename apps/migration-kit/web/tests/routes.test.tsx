// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { migrationKitRoutes } from '../src/routes.js';
import { writeAccessToken } from '../src/auth/session.js';
import { MIGRATION_KIT_ROUTE_DESCRIPTORS } from '../src/route-manifest.js';
import * as api from '../src/api/migration-kit.js';

class NavigationRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly signal: AbortSignal | null;
  readonly body: BodyInit | null;

  constructor(input: string | URL, init: RequestInit = {}) {
    this.url = typeof input === 'string' ? input : input.toString();
    this.method = init.method ?? 'GET';
    this.headers =
      init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? undefined);
    this.signal = init.signal ?? null;
    this.body = init.body ?? null;
  }
}

function installNavigationRequestShim(): void {
  const scope = globalThis as { Request?: typeof Request };
  if (typeof scope.Request !== 'function') return;
  try {
    new scope.Request('http://clearshift.invalid/', {
      signal: new AbortController().signal,
    });
    return;
  } catch {
    // Inconsistent environment, install shim
  }
  scope.Request = NavigationRequest as unknown as typeof Request;
}

installNavigationRequestShim();

function flattenRoutes(routes: RouteObject[]): { id?: string; path?: string; index?: boolean }[] {
  const flat: { id?: string; path?: string; index?: boolean }[] = [];
  for (const route of routes) {
    flat.push({ id: route.id, path: route.path, index: route.index });
    if (route.children) flat.push(...flattenRoutes(route.children));
  }
  return flat;
}

describe('Migration Kit Route Registration', () => {
  beforeEach(() => {
    writeAccessToken('header.payload.signature');
    vi.spyOn(api, 'fetchBatches').mockResolvedValue([
      { id: 'b1', name: 'Batch 1', module: 'erp1', entity: 'products', status: 'created', sourceRowCount: 10, createdAt: '2026-01-01T00:00:00Z', dryRunPassed: false, dryRunStale: false },
    ] as any);
  });
  afterEach(() => cleanup());

  it('registers expected routes', () => {
    const flat = flattenRoutes(migrationKitRoutes);
    const paths = flat.map((r) => r.path).filter(Boolean);
    expect(paths).toContain('/kit');
    expect(paths).toContain('batches');
    expect(paths).toContain('batches/new');
  });

  it('renders batch list route inside shell', async () => {
    const loginRoute = { path: '/login', element: <div data-testid="hub-login-screen">login</div> };
    const router = createMemoryRouter([...migrationKitRoutes, loginRoute], { initialEntries: ['/kit/batches'] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByTestId('batch-list-page')).toBeTruthy();
  });

  it('renders new batch wizard route', async () => {
    const loginRoute = { path: '/login', element: <div data-testid="hub-login-screen">login</div> };
    const router = createMemoryRouter([...migrationKitRoutes, loginRoute], { initialEntries: ['/kit/batches/new'] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByTestId('new-batch-wizard')).toBeTruthy();
  });
});