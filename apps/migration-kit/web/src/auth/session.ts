export const ACCESS_TOKEN_STORAGE_KEY = 'cs_access_token';

function getStorage(): Storage | null {
  if (typeof window !== 'undefined') {
    if (window.sessionStorage) return window.sessionStorage;
    if (window.localStorage) return window.localStorage;
  }
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
  } catch {
    return null;
  }
}

export function readAccessToken(): string | null {
  try {
    return getStorage()?.getItem(ACCESS_TOKEN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeAccessToken(token: string): void {
  try {
    getStorage()?.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore
  }
}

export function clearAccessToken(): void {
  try {
    getStorage()?.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function parseJwtRoles(token: string | null): string[] {
  if (!token) return [];
  try {
    const parts = token.split('.');
    if (parts.length < 2) return [];
    const payload = JSON.parse(atob(parts[1]!));
    return Array.isArray(payload?.roles) ? payload.roles : [];
  } catch {
    return [];
  }
}

export function hasPermission(roles: string[], permission: string): boolean {
  if (roles.includes('admin') || roles.includes('platform_admin')) return true;
  return roles.includes(permission);
}