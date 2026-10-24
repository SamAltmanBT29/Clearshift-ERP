/**
 * ERP-4 Finance and Accounting — Web Test Support
 *
 * Helpers shared by the frontend test suites.
 */

export const ACCESS_TOKEN_STORAGE_KEY = 'clearshift.access_token';

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Builds an unsigned JWT with the given claims.
 *
 * The signature is never verified by the module — the API is the authority —
 * so a structurally valid token with a chosen `exp` is all the guard needs.
 */
export function buildAccessToken(claims: Record<string, unknown>): string {
  const header = base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify(claims));
  return `${header}.${payload}.test-signature`;
}

/** A token that is valid for the next `ttlSeconds`. */
export function validAccessToken(ttlSeconds = 900): string {
  return accessTokenWithRoles(['admin'], ttlSeconds);
}

/** A valid token that carries the given roles. */
export function accessTokenWithRoles(roles: readonly string[], ttlSeconds = 900): string {
  return buildAccessToken({
    iss: 'clearshift-erp-local',
    aud: 'clearshift-erp',
    sub: 'ffffffff-0004-0001-0001-000000000001',
    roles: [...roles],
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}

/** A token whose `exp` claim has already passed. */
export function expiredAccessToken(): string {
  return buildAccessToken({
    iss: 'clearshift-erp-local',
    aud: 'clearshift-erp',
    sub: 'ffffffff-0004-0001-0001-000000000001',
    roles: ['admin'],
    exp: Math.floor(Date.now() / 1000) - 60,
  });
}

/** Puts a token into session storage, as the Hub login flow does. */
export function storeAccessToken(token: string): void {
  window.sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
}

/** Removes every token from session storage. */
export function clearStoredAccessToken(): void {
  window.sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
}
