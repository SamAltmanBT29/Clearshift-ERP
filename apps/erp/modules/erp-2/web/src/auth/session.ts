/**
 * ERP-2 Vendors & Purchasing — Session Adapter
 *
 * Provides browser-side session token management for ERP-2 web routes.
 * Decodes standard JWT claims (specifically `exp`, `sub`, and `roles`) to prevent
 * expired sessions from rendering routes that the backend API would reject.
 *
 * @module erp2/web/auth/session
 */

/** Storage key the Hub login writes the access token to. */
export const ACCESS_TOKEN_STORAGE_KEY = 'clearshift.access_token';

export interface Erp2Session {
  readonly token: string;
  readonly subject: string | null;
  readonly roles: readonly string[];
  /** Epoch timestamp in milliseconds. */
  readonly expiresAt: number;
}

function hasSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

/** Reads the access token from session storage. */
export function readAccessToken(): string | null {
  if (!hasSessionStorage()) {
    return null;
  }
  try {
    const token = window.sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    return token && token.trim().length > 0 ? token.trim() : null;
  } catch {
    return null;
  }
}

/** Stores the access token in session storage. */
export function writeAccessToken(token: string): void {
  if (!hasSessionStorage()) {
    return;
  }
  try {
    window.sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore restricted storage errors
  }
}

/** Clears the access token from session storage. */
export function clearAccessToken(): void {
  if (!hasSessionStorage()) {
    return;
  }
  try {
    window.sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore restricted storage errors
  }
}

/**
 * Decodes the payload segment of a JWT without full verification.
 * (Verification is the exclusive authority of the backend Fastify server).
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const payload = parts[1] as string;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '='
    );

    let jsonStr: string;
    if (typeof atob === 'function') {
      jsonStr = atob(padded);
    } else if (typeof Buffer !== 'undefined') {
      jsonStr = Buffer.from(padded, 'base64').toString('utf8');
    } else {
      return null;
    }

    const parsed = JSON.parse(jsonStr);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the active session if one exists and has not yet expired.
 */
export function getSession(currentTimeMs: number = Date.now()): Erp2Session | null {
  const token = readAccessToken();
  if (!token) {
    return null;
  }

  const claims = decodeJwtClaims(token);
  if (!claims) {
    return null;
  }

  const expSec = typeof claims['exp'] === 'number' ? claims['exp'] : null;
  if (expSec === null) {
    return null;
  }

  const expiresAt = expSec * 1000;
  if (expiresAt <= currentTimeMs) {
    return null;
  }

  const subject = typeof claims['sub'] === 'string' ? claims['sub'] : null;
  const roles = Array.isArray(claims['roles'])
    ? claims['roles'].filter((r): r is string => typeof r === 'string')
    : [];

  return {
    token,
    subject,
    roles,
    expiresAt,
  };
}

/** Returns true if an unexpired session exists. */
export function isSessionActive(currentTimeMs: number = Date.now()): boolean {
  return getSession(currentTimeMs) !== null;
}
