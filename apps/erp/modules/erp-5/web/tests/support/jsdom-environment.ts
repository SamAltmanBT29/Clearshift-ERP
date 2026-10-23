/**
 * ERP-5 HR & Employees — jsdom Environment Shim
 *
 * **Why this exists.** Vitest's `jsdom` environment installs jsdom's
 * `AbortController` but keeps Node's `Request` (undici). React Router's data
 * router builds a navigation `Request` with `new AbortController().signal`,
 * and undici refuses a signal that is not an instance of *its* `AbortSignal`:
 *
 *     TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an
 *     instance of AbortSignal.
 *
 * **What it does.** It replaces `Request` with a minimal implementation that
 * carries the same fields React Router reads (`url`, `method`, `headers`,
 * `signal`, `body`). React Router only builds this request to hand it to
 * route loaders and actions; the ERP-5 module registers neither.
 *
 * **Scope.** The shim is installed by the module's own jsdom test suites
 * only. It is self-disabling: it first probes whether the environment is
 * already consistent and does nothing when it is. No application code is
 * affected — a browser always has a matching `Request`/`AbortSignal` pair.
 */

/** The fields React Router reads from a navigation request. */
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

interface RequestCapableGlobal {
  Request?: typeof Request;
}

/**
 * Installs the shim when — and only when — the environment mixes jsdom's
 * `AbortController` with Node's `Request`.
 */
export function installNavigationRequestShim(): void {
  const scope = globalThis as RequestCapableGlobal;

  if (typeof scope.Request !== 'function') {
    return;
  }

  try {
    // A consistent environment accepts a request built from its own signal.
    new scope.Request('http://clearshift.invalid/', {
      signal: new AbortController().signal,
    });
    return;
  } catch {
    // The environment is inconsistent — fall through and install the shim.
  }

  scope.Request = NavigationRequest as unknown as typeof Request;
}
