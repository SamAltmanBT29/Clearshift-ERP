/**
 * ERP-3 Sales Orders and Invoices — jsdom Environment Shim
 *
 * Replaces `Request` with a compatible class when Vitest's `jsdom` environment
 * mixes jsdom's `AbortController` with Node's undici `Request`.
 */

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

export function installNavigationRequestShim(): void {
  const scope = globalThis as RequestCapableGlobal;

  if (typeof scope.Request !== 'function') {
    return;
  }

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
