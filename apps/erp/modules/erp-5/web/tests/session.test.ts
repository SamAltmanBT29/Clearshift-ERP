// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Session Adapter Unit Tests
 *
 * The session adapter is the module's only authentication state. The token is
 * treated as opaque: the module reads the `exp` claim so an expired session
 * never renders a screen the API will reject, but it never verifies the
 * token — the API is the authority.
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
import {
  buildAccessToken,
  expiredAccessToken,
  validAccessToken,
} from './support/session.js';

/** An `exp` claim far enough in the future to still be valid. */
function futureExpiry(): number {
  return Math.floor(Date.now() / 1000) + 900;
}

describe('ERP-5 session adapter', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });
  afterEach(() => {
    // Restore the environment before touching the storage — the "no window"
    // cases stub the global away, and the blocked-storage cases replace the
    // storage getter with one that throws.
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  describe('1. Token storage', () => {
    it('stores and reads the access token', () => {
      writeAccessToken('token-value');
      expect(readAccessToken()).toBe('token-value');
    });

    it('reads the token from the key the Hub login flow writes', () => {
      window.sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, 'from-hub');
      expect(readAccessToken()).toBe('from-hub');
    });

    it('returns no token when none is stored', () => {
      expect(readAccessToken()).toBeNull();
    });

    it('ignores a blank token', () => {
      window.sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, '   ');
      expect(readAccessToken()).toBeNull();
    });

    it('removes the token on sign-out', () => {
      writeAccessToken('token-value');
      clearAccessToken();
      expect(readAccessToken()).toBeNull();
    });
  });

  describe('2. Claim decoding', () => {
    it('decodes the claims of a well-formed token', () => {
      const token = buildAccessToken({ sub: 'user-1', roles: ['admin'], exp: 42 });
      const claims = decodeJwtClaims(token);

      expect(claims?.['sub']).toBe('user-1');
      expect(claims?.['roles']).toEqual(['admin']);
      expect(claims?.['exp']).toBe(42);
    });

    it('decodes a payload that contains non-ASCII characters', () => {
      const token = buildAccessToken({ sub: 'Zoë Müller', exp: 42 });
      expect(decodeJwtClaims(token)?.['sub']).toBe('Zoë Müller');
    });

    it('returns no claims for a token without a payload', () => {
      expect(decodeJwtClaims('only-one-part')).toBeNull();
      expect(decodeJwtClaims('')).toBeNull();
    });

    it('returns no claims for a token with an empty payload', () => {
      expect(decodeJwtClaims('header..signature')).toBeNull();
    });

    it('returns no claims for a payload that is not JSON', () => {
      expect(decodeJwtClaims('a.bm90LWpzb24.c')).toBeNull();
    });

    it('returns no claims for a payload that is not an object', () => {
      const token = `${buildAccessToken({ exp: 1 }).split('.')[0]}.${btoa('[1,2,3]')}.sig`;
      expect(decodeJwtClaims(token)).toBeNull();
    });

    it('returns no claims for a payload that is null', () => {
      const token = `${buildAccessToken({ exp: 1 }).split('.')[0]}.${btoa('null')}.sig`;
      expect(decodeJwtClaims(token)).toBeNull();
    });

    it('returns no claims for a payload that is not base64', () => {
      const token = `${buildAccessToken({ exp: 1 }).split('.')[0]}.%%%%.sig`;
      expect(decodeJwtClaims(token)).toBeNull();
    });
  });

  describe('3. Session resolution', () => {
    it('resolves a valid session with its subject and roles', () => {
      writeAccessToken(validAccessToken());
      const session = getSession();

      expect(session).not.toBeNull();
      expect(session?.subject).toBe('ffffffff-0001-0001-0001-000000000001');
      expect(session?.roles).toEqual(['admin']);
      expect(session?.expiresAt).toBeGreaterThan(Date.now());
    });

    it('resolves no session when no token is stored', () => {
      expect(getSession()).toBeNull();
    });

    it('resolves no session for an expired token', () => {
      writeAccessToken(expiredAccessToken());
      expect(getSession()).toBeNull();
    });

    it('resolves no session for a token without an expiry claim', () => {
      writeAccessToken(buildAccessToken({ sub: 'user-1' }));
      expect(getSession()).toBeNull();
    });

    it('resolves no session for a token with a non-numeric expiry claim', () => {
      writeAccessToken(buildAccessToken({ sub: 'user-1', exp: 'never' }));
      expect(getSession()).toBeNull();
    });

    it('tolerates a token whose roles are not a list of strings', () => {
      writeAccessToken(
        buildAccessToken({ sub: 'user-1', roles: [1, 'admin'], exp: futureExpiry() })
      );
      expect(getSession()?.roles).toEqual(['admin']);
    });

    it('resolves no subject when the token carries none', () => {
      writeAccessToken(buildAccessToken({ exp: futureExpiry() }));
      expect(getSession()?.subject).toBeNull();
    });
  });

  describe('4. Session validity', () => {
    it('accepts a session that has not expired', () => {
      writeAccessToken(validAccessToken());
      expect(isSessionActive(getSession())).toBe(true);
    });

    it('rejects an expired session', () => {
      writeAccessToken(expiredAccessToken());
      expect(isSessionActive(getSession())).toBe(false);
    });

    it('rejects the absence of a session', () => {
      expect(isSessionActive(null)).toBe(false);
    });
  });

  describe('5. Environments without a browser storage', () => {
    it('reads no token when there is no window', () => {
      vi.stubGlobal('window', undefined);
      expect(readAccessToken()).toBeNull();
    });

    it('writes and clears without throwing when there is no window', () => {
      vi.stubGlobal('window', undefined);
      expect(() => writeAccessToken('token-value')).not.toThrow();
      expect(() => clearAccessToken()).not.toThrow();
    });

    it('resolves no session when there is no window', () => {
      vi.stubGlobal('window', undefined);
      expect(getSession()).toBeNull();
    });
  });

  describe('6. A storage that refuses to answer', () => {
    /**
     * Replaces the session storage with one that throws on every operation —
     * the behaviour of a browser in private mode or under a strict privacy
     * setting. The module must treat that as "no session", never as a crash.
     */
    function stubBlockedStorage(): void {
      const blocked = {
        getItem: () => {
          throw new Error('storage is blocked');
        },
        setItem: () => {
          throw new Error('storage is blocked');
        },
        removeItem: () => {
          throw new Error('storage is blocked');
        },
        clear: () => {
          throw new Error('storage is blocked');
        },
        key: () => null,
        length: 0,
      };
      vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(
        blocked as unknown as Storage
      );
    }

    it('reads no token when the storage throws', () => {
      stubBlockedStorage();

      expect(readAccessToken()).toBeNull();
    });

    it('writes and clears without throwing when the storage throws', () => {
      stubBlockedStorage();

      expect(() => writeAccessToken('token-value')).not.toThrow();
      expect(() => clearAccessToken()).not.toThrow();
    });

    it('resolves no session when the storage throws', () => {
      stubBlockedStorage();

      expect(getSession()).toBeNull();
    });
  });
});
