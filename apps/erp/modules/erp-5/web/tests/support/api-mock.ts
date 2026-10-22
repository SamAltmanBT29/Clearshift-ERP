/**
 * ERP-5 HR & Employees — Web Test API Mock
 *
 * Installs a `fetch` stub that answers the module's collection endpoints.
 * The list screens are the only place the module talks to the API, so this
 * is the single seam every screen test needs.
 *
 * The stub records every call — the path **and the query string** — so a
 * test can assert that a search, a filter or a page change really reached
 * the server.
 */

import { vi } from 'vitest';

const ERP5_API_BASE = '/api/v1/erp-hr';

export interface HrApiMockCall {
  /** The full request URL. */
  readonly url: URL;
  /** The path below the module API base, e.g. `/employees`. */
  readonly path: string;
  /** The query parameters the screen sent. */
  readonly query: URLSearchParams;
}

export interface HrApiMockOptions {
  /**
   * The response body per module path, e.g. `{ '/employees': { data, meta } }`.
   * A path that is not listed answers with an empty page.
   */
  readonly responses?: Readonly<Record<string, unknown>> | undefined;
  /** Answers every request with this failure instead of a list. */
  readonly failure?: { readonly status: number; readonly body?: unknown } | undefined;
  /** Answers the given path with this failure. */
  readonly failures?: Readonly<
    Record<string, { readonly status: number; readonly body?: unknown }>
  > | undefined;
  /**
   * Leaves every request pending.
   *
   * A suite that is not about the data — a routing or a shell suite — uses
   * this to keep the screens in their loading state, so no state update
   * lands after the synchronous body of a test.
   */
  readonly pending?: boolean | undefined;
}

export interface HrApiMock {
  /** Every request the screen made, in order. */
  readonly calls: HrApiMockCall[];
  /** The calls for one module path. */
  callsTo(path: string): HrApiMockCall[];
  /** The most recent call for one module path. */
  lastCallTo(path: string): HrApiMockCall | undefined;
  /** Removes the stub. */
  restore(): void;
}

function emptyPage(): unknown {
  return { data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function installHrApiMock(options: HrApiMockOptions = {}): HrApiMock {
  const calls: HrApiMockCall[] = [];

  const stub = vi.fn(async (input: unknown) => {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as { url?: unknown })?.url ?? input);

    const url = new URL(raw, 'http://clearshift.test');
    const path = url.pathname.startsWith(ERP5_API_BASE)
      ? url.pathname.slice(ERP5_API_BASE.length)
      : url.pathname;

    calls.push({ url, path, query: url.searchParams });

    if (options.pending) {
      // The request never settles — the screen stays in its loading state.
      return new Promise<Response>(() => undefined);
    }

    const failure = options.failures?.[path] ?? options.failure;
    if (failure) {
      return jsonResponse(
        failure.status,
        failure.body ?? {
          code: 'HR_TEST_FAILURE',
          message: 'The request failed.',
          details: [],
          correlation_id: 'test-correlation-id',
        }
      );
    }

    const body = options.responses?.[path] ?? emptyPage();
    return jsonResponse(200, body);
  });

  vi.stubGlobal('fetch', stub);

  return {
    calls,
    callsTo: (path) => calls.filter((call) => call.path === path),
    lastCallTo: (path) => {
      const matching = calls.filter((call) => call.path === path);
      return matching[matching.length - 1];
    },
    restore: () => {
      vi.unstubAllGlobals();
    },
  };
}

/** A list response body for one collection. */
export function listPage<T>(
  data: readonly T[],
  overrides: Partial<{ page: number; pageSize: number; total: number; totalPages: number }> = {}
): { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } } {
  const page = overrides.page ?? 1;
  const pageSize = overrides.pageSize ?? 25;
  const total = overrides.total ?? data.length;
  return {
    data: data as T[],
    meta: {
      page,
      pageSize,
      total,
      totalPages: overrides.totalPages ?? Math.ceil(total / pageSize),
    },
  };
}
