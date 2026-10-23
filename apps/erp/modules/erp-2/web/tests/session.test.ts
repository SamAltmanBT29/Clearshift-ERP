/**
 * ERP-2 Vendors & Purchasing — Session Adapter Tests
 *
 * Verifies token storage handling, JWT claim decoding, expiry detection,
 * and session state checks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ACCESS_TOKEN_STORAGE_KEY,
  clearAccessToken,
  decodeJwtClaims,
  getSession,
  isSessionActive,
  readAccessToken,
  writeAccessToken,
} from '../src/auth/session.js';

function base64Url(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeToken(payload: Record<string, unknown>): string {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  return `${header}.${body}.mock-signature`;
}

describe('ERP-2 Session Adapter', () => {
  let mockStorage: Map<string, string>;

  beforeEach(() => {
    mockStorage = new Map();
    const fakeSessionStorage = {
      getItem: (key: string) => mockStorage.get(key) ?? null,
      setItem: (key: string, val: string) => mockStorage.set(key, val),
      removeItem: (key: string) => mockStorage.delete(key),
      clear: () => mockStorage.clear(),
      key: (i: number) => Array.from(mockStorage.keys())[i] ?? null,
      get length() {
        return mockStorage.size;
      },
    };

    vi.stubGlobal('window', {
      sessionStorage: fakeSessionStorage,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('1. Storage Operations', () => {
    it('writes and reads access token to sessionStorage', () => {
      expect(readAccessToken()).toBeNull();
      writeAccessToken('test-token-123');
      expect(readAccessToken()).toBe('test-token-123');
      expect(mockStorage.get(ACCESS_TOKEN_STORAGE_KEY)).toBe('test-token-123');
    });

    it('clears access token from sessionStorage', () => {
      writeAccessToken('test-token-123');
      expect(readAccessToken()).toBe('test-token-123');
      clearAccessToken();
      expect(readAccessToken()).toBeNull();
    });

    it('gracefully handles missing window/storage without throwing', () => {
      vi.stubGlobal('window', undefined);
      expect(() => writeAccessToken('t')).not.toThrow();
      expect(readAccessToken()).toBeNull();
      expect(() => clearAccessToken()).not.toThrow();
    });
  });

  describe('2. JWT Decoding', () => {
    it('decodes payload claims from valid 3-part token', () => {
      const token = makeToken({ sub: 'user-001', roles: ['purchasing_admin'], exp: 1999999999 });
      const claims = decodeJwtClaims(token);
      expect(claims).not.toBeNull();
      expect(claims?.sub).toBe('user-001');
      expect(claims?.roles).toEqual(['purchasing_admin']);
      expect(claims?.exp).toBe(1999999999);
    });

    it('returns null on invalid token formats', () => {
      expect(decodeJwtClaims('')).toBeNull();
      expect(decodeJwtClaims('not-a-jwt')).toBeNull();
      expect(decodeJwtClaims('part1.part2')).toBeNull();
      expect(decodeJwtClaims('part1.part2.part3.extra')).toBeNull();
      expect(decodeJwtClaims('part1.not-base64.part3')).toBeNull();
    });
  });

  describe('3. Session Lifecycle & Expiration Checks', () => {
    it('resolves valid session when unexpired', () => {
      const nowSec = 1700000000;
      const token = makeToken({
        sub: 'user-001',
        roles: ['purchasing_agent'],
        exp: nowSec + 3600,
      });
      writeAccessToken(token);

      const session = getSession(nowSec * 1000);
      expect(session).not.toBeNull();
      expect(session?.token).toBe(token);
      expect(session?.subject).toBe('user-001');
      expect(session?.roles).toEqual(['purchasing_agent']);
      expect(session?.expiresAt).toBe((nowSec + 3600) * 1000);
      expect(isSessionActive(nowSec * 1000)).toBe(true);
    });

    it('returns null when token has expired', () => {
      const nowSec = 1700000000;
      const token = makeToken({
        sub: 'user-001',
        roles: ['purchasing_agent'],
        exp: nowSec - 10,
      });
      writeAccessToken(token);

      const session = getSession(nowSec * 1000);
      expect(session).toBeNull();
      expect(isSessionActive(nowSec * 1000)).toBe(false);
    });

    it('returns null when token lacks exp claim', () => {
      const token = makeToken({ sub: 'user-no-exp' });
      writeAccessToken(token);

      expect(getSession()).toBeNull();
      expect(isSessionActive()).toBe(false);
    });

    it('returns null when no token is present', () => {
      expect(getSession()).toBeNull();
      expect(isSessionActive()).toBe(false);
    });
  });
});
