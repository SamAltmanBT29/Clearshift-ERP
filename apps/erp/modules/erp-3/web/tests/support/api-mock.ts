/**
 * ERP-3 Sales Orders and Invoices — Web Test API Mock
 *
 * Installs a `fetch` stub that answers the module's API endpoints.
 */

import { vi } from 'vitest';

const ERP3_API_BASE = '/api/v1/erp-orders';

export interface OrdersApiMockCall {
  readonly url: URL;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly method: string;
  readonly body: unknown;
}

export interface OrdersApiMockOptions {
  readonly responses?: Readonly<Record<string, unknown>> | undefined;
  readonly failure?: { readonly status: number; readonly body?: unknown } | undefined;
  readonly pending?: boolean | undefined;
}

export interface OrdersApiMock {
  readonly calls: OrdersApiMockCall[];
  restore(): void;
}

function emptyListResponse(path: string): unknown {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

export function installOrdersApiMock(options: OrdersApiMockOptions = {}): OrdersApiMock {
  const calls: OrdersApiMockCall[] = [];
  const originalFetch = globalThis.fetch;

  const stub = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (options.pending) {
      return new Promise<Response>(() => {});
    }

    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

    const url = new URL(rawUrl, 'http://clearshift.invalid');
    const fullPath = url.pathname;

    let path = fullPath;
    if (fullPath.startsWith(ERP3_API_BASE)) {
      path = fullPath.slice(ERP3_API_BASE.length) || '/';
    }

    let parsedBody: unknown = null;
    if (init.body && typeof init.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }

    calls.push({
      url,
      path,
      query: url.searchParams,
      method: init.method ?? 'GET',
      body: parsedBody,
    });

    if (options.failure) {
      return new Response(JSON.stringify(options.failure.body ?? { error: 'Failed' }), {
        status: options.failure.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    const configured = options.responses?.[path];
    const body = configured !== undefined ? configured : emptyListResponse(path);

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  globalThis.fetch = stub as unknown as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}
