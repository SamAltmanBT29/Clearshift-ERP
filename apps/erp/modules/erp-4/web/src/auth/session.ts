/**
 * ERP-4 Finance & Accounting — Session Adapter
 *
 * Provides browser-side session token management for ERP-4 web routes.
 * Decodes standard JWT claims (specifically `exp`, `sub`, and `roles`) to prevent
 * expired sessions from rendering routes that the backend API would reject.
 *
 * @module erp4/web/auth/session
 */

export const ACCESS_TOKEN_STORAGE_KEY = 'clearshift.access_token';

export interface Erp4Session {
  readonly token: string;
  readonly subject: string | null;
  readonly roles: readonly string[];
  readonly expiresAt: number;
}

function hasSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

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

interface JwtPayloadClaims {
  sub?: string;
  roles?: string[];
  exp?: number;
}

function parseJwtClaims(token: string): JwtPayloadClaims | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = atob(padded);
    return JSON.parse(json) as JwtPayloadClaims;
  } catch {
    return null;
  }
}

export function getSession(): Erp4Session | null {
  const token = readAccessToken();
  if (!token) {
    return null;
  }

  const claims = parseJwtClaims(token);
  if (!claims || typeof claims.exp !== 'number') {
    return null;
  }

  const expiresAt = claims.exp * 1000;
  if (Date.now() >= expiresAt) {
    clearAccessToken();
    return null;
  }

  return {
    token,
    subject: claims.sub ?? null,
    roles: Array.isArray(claims.roles) ? claims.roles : [],
    expiresAt,
  };
}
