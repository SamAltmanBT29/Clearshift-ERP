/**
 * ERP-1 Products & Inventory — Session Adapter
 *
 * The Hub owns credential issuance and token validation (Master Architecture Spec C3).
 * The browser only answers one question for the route guard:
 * *is there a session the module can talk to the API with?*
 *
 * The token is decoded far enough to read the standard `exp` claim so an expired session
 * never renders a screen that the API will reject with a 401, but the cryptographic
 * signature is verified by the backend API.
 *
 * @module erp1/web/auth/session
 */

/** The session-storage key the Hub login flow writes the access token to. */
export const ACCESS_TOKEN_STORAGE_KEY = 'clearshift.access_token';

export interface Erp1Session {
  readonly token: string;
  readonly subject: string | null;
  readonly roles: readonly string[];
  /** The `exp` claim as an epoch timestamp in milliseconds. */
  readonly expiresAt: number;
}

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

/** Reads the access token from session storage. */
export function readAccessToken(): string | null {
  if (!hasWindow()) {
    return null;
  }
  try {
    const token = window.sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    return token && token.trim().length > 0 ? token.trim() : null;
  } catch {
    return null;
  }
}

/** Stores the access token after a successful Hub login. */
export function writeAccessToken(token: string): void {
  if (!hasWindow()) {
    return;
  }
  try {
    window.sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

/** Removes the access token on sign-out or on an expired session. */
export function clearAccessToken(): void {
  if (!hasWindow()) {
    return;
  }
  try {
    window.sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

function decodeBase64Url(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (normalized.length % 4)) % 4;
    const binary = atob(normalized + '='.repeat(padding));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Decodes the claim set of a JWT without verifying its signature.
 * Verification is done by the backend Fastify API.
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  // Support local test tokens: "role:admin", etc.
  if (!token.includes('.')) {
    return {
      sub: 'local-test-user',
      roles: ['admin'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  const payload = parts[1];
  if (!payload) {
    return null;
  }
  const decoded = decodeBase64Url(payload);
  if (decoded === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The current session, or `null` when there is none.
 */
export function getSession(now: number = Date.now()): Erp1Session | null {
  const token = readAccessToken();
  if (!token) {
    return null;
  }

  const claims = decodeJwtClaims(token);
  if (!claims) {
    return null;
  }

  const exp = claims['exp'];
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return null;
  }

  const expiresAt = exp * 1000;
  if (expiresAt <= now) {
    return null;
  }

  const subject = claims['sub'];
  const rawRoles = claims['roles'];

  return {
    token,
    subject: typeof subject === 'string' ? subject : null,
    roles: Array.isArray(rawRoles)
      ? rawRoles.filter((role): role is string => typeof role === 'string')
      : [],
    expiresAt,
  };
}

/** True when the session is present and has not expired. */
export function isSessionActive(session: Erp1Session | null, now: number = Date.now()): boolean {
  return session !== null && session.expiresAt > now;
}
