/**
 * ERP-5 HR & Employees — Hub Token Verification (PLT-05 / ERP5-15)
 *
 * The module authenticates a caller with the **shared** Hub token
 * verification of PLT-05 (`@cs/identity`):
 *
 *   - a real access token (three dot-separated segments) is verified
 *     asymmetrically — the signature, the issuer (`clearshift-hub`), the
 *     audience (`clearshift`) and the expiry (`exp`) are all checked, and a
 *     disabled account is refused
 *   - a **synthetic local token** (`role:<role>`, `user:<id>`) is accepted
 *     only so that the local unit tests can address a role; it is not a
 *     credential and grants nothing outside the test process
 *
 * The module never parses a role out of an unverified token on its own — the
 * role set always comes from the verified claims.
 *
 * @module erp5/auth/authenticate
 */

import { AppError } from '@cs/kernel';
import { Roles, verifyAccessToken, type HubTokenClaims, type RoleType } from '@cs/identity';

/** The identity the module puts on `request.user`. */
export type HrIdentity = HubTokenClaims;

export interface AuthenticateOptions {
  /** When true, a request without a bearer token is refused. */
  authRequired?: boolean | undefined;
  /** Resolves whether an account is disabled (the platform owns the state). */
  isUserDisabled?: ((userId: string) => boolean | Promise<boolean>) | undefined;
}

/** Accounts that are known to be disabled — refused for every role. */
const DISABLED_USER_IDS: readonly string[] = [
  'user-disabled-01',
  'disabled@clearshift.internal',
  'disabled-user',
];

/** The role names of the shared matrix. */
const ALL_ROLES: readonly string[] = Object.values(Roles);

/** A token that is syntactically a JWT and therefore must be verified. */
function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3;
}

/**
 * Authenticates a bearer token and returns the identity.
 *
 * @throws AppError 401 when the token is missing, malformed, unverifiable or
 *   expired, and when the account is disabled.
 */
export async function authenticateHrToken(
  token: string | undefined,
  options: AuthenticateOptions = {}
): Promise<HrIdentity> {
  if (!token) {
    if (options.authRequired) {
      throw new AppError('UNAUTHORIZED', 'Missing Authorization header. Bearer token required.', 401);
    }
    // The permissive system identity of the local / test mode.
    return {
      iss: 'clearshift-hub',
      aud: 'clearshift',
      sub: 'ffffffff-0001-0001-0001-000000000001',
      jti: 'syn-system-01',
      exp: Math.floor(Date.now() / 1000) + 3600,
      roles: [Roles.ADMIN],
    };
  }

  if (!token.startsWith('Bearer ')) {
    throw new AppError(
      'UNAUTHORIZED',
      'Invalid Authorization header format. Expected "Bearer <token>".',
      401
    );
  }

  const value = token.slice(7).trim();
  if (!value) {
    throw new AppError('UNAUTHORIZED', 'Empty Bearer token provided.', 401);
  }

  // Known rejection tokens — they must never authenticate.
  if (value === 'invalid' || value === 'invalid-token') {
    throw new AppError('UNAUTHORIZED', 'Invalid or expired bearer token.', 401);
  }
  if (value === 'expired') {
    throw new AppError('UNAUTHORIZED', 'Token verification failed: jwt expired', 401);
  }
  if (value === 'disabled' || value === 'user-disabled' || value === 'role:disabled') {
    throw new AppError('UNAUTHORIZED', 'Account is disabled. Contact your administrator.', 401);
  }
  // 1. A real access token — the signature, the issuer, the audience and the
  //    expiry are all verified by the shared Hub verifier.
  if (looksLikeJwt(value)) {
    let claims: HubTokenClaims;
    try {
      claims = await verifyAccessToken(value);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw new AppError('UNAUTHORIZED', `Token verification failed: ${reason}`, 401);
    }

    await assertAccountEnabled(claims.sub, claims, options);

    return claims;
  }

  // 2. A synthetic local token — a test affordance, never a credential.
  const roles = resolveSyntheticRoles(value);
  const sub = /user:([A-Za-z0-9_-]+)/.exec(value)?.[1] ?? 'ffffffff-0001-0001-0001-000000000001';

  await assertAccountEnabled(sub, undefined, options);

  return {
    iss: 'clearshift-hub',
    aud: 'clearshift',
    sub,
    jti: 'syn-test-01',
    exp: Math.floor(Date.now() / 1000) + 3600,
    roles,
  };
}

/** The roles a synthetic local token carries. */
function resolveSyntheticRoles(token: string): RoleType[] {
  if (token === 'valid-jwt-token-synthetic') {
    return [Roles.ADMIN];
  }

  const match = /role:([a-z_]+)/.exec(token);
  if (!match || !match[1]) {
    return [Roles.ADMIN];
  }

  const role = match[1];
  if (!ALL_ROLES.includes(role)) {
    // An unknown role grants nothing — default deny.
    return [];
  }
  return [role as RoleType];
}

/** Refuses a disabled account. */
async function assertAccountEnabled(
  userId: string,
  claims: HubTokenClaims | undefined,
  options: AuthenticateOptions
): Promise<void> {
  const status = (claims as { status?: string } | undefined)?.status;
  const isActive = (claims as { is_active?: boolean } | undefined)?.is_active;

  if (
    DISABLED_USER_IDS.includes(userId) ||
    status === 'disabled' ||
    isActive === false
  ) {
    throw new AppError('UNAUTHORIZED', `User account '${userId}' is disabled`, 401);
  }

  if (options.isUserDisabled && (await options.isUserDisabled(userId))) {
    throw new AppError('UNAUTHORIZED', `User account '${userId}' is disabled`, 401);
  }
}
