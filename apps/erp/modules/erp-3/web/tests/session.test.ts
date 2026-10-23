// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ACCESS_TOKEN_STORAGE_KEY,
  readAccessToken,
  writeAccessToken,
  clearAccessToken,
  decodeJwtClaims,
  getSession,
  isSessionActive,
} from '../src/auth/session.js';
import {
  clearStoredAccessToken,
  storeAccessToken,
  validAccessToken,
  expiredAccessToken,
} from './support/session.js';

describe('ERP-3 session adapter', () => {
  beforeEach(() => {
    clearStoredAccessToken();
  });

  afterEach(() => {
    clearStoredAccessToken();
  });

  describe('1. Token storage access', () => {
    it('reads and writes token to sessionStorage', () => {
      expect(readAccessToken()).toBeNull();
      writeAccessToken('test-token-123');
      expect(readAccessToken()).toBe('test-token-123');
      clearAccessToken();
      expect(readAccessToken()).toBeNull();
    });

    it('tolerates sessionStorage errors (e.g. private browsing)', () => {
      const originalGet = window.sessionStorage.getItem;
      window.sessionStorage.getItem = () => {
        throw new Error('QuotaExceeded / SecurityError');
      };
      expect(readAccessToken()).toBeNull();
      window.sessionStorage.getItem = originalGet;
    });
  });

  describe('2. JWT decoding and claims parsing', () => {
    it('decodes valid claims from unsigned JWT payload', () => {
      const token = validAccessToken(300);
      const claims = decodeJwtClaims(token);
      expect(claims).not.toBeNull();
      expect(claims?.['sub']).toBe('ffffffff-0001-0001-0001-000000000001');
      expect(claims?.['roles']).toEqual(['admin']);
    });

    it('returns null on malformed or truncated tokens', () => {
      expect(decodeJwtClaims('not-a-jwt')).toBeNull();
      expect(decodeJwtClaims('a.badbase64@@@.c')).toBeNull();
      expect(decodeJwtClaims('header.' + btoa('not-json') + '.sig')).toBeNull();
    });
  });

  describe('3. Session state verification', () => {
    it('returns active session for unexpired token', () => {
      const token = validAccessToken(600);
      storeAccessToken(token);

      const session = getSession();
      expect(session).not.toBeNull();
      expect(session?.token).toBe(token);
      expect(session?.subject).toBe('ffffffff-0001-0001-0001-000000000001');
      expect(session?.roles).toEqual(['admin']);
      expect(isSessionActive(session)).toBe(true);
    });

    it('returns null when token is expired', () => {
      const token = expiredAccessToken();
      storeAccessToken(token);

      const session = getSession();
      expect(session).toBeNull();
      expect(isSessionActive(session)).toBe(false);
    });

    it('returns null when token is missing', () => {
      clearStoredAccessToken();
      expect(getSession()).toBeNull();
    });
  });
});
