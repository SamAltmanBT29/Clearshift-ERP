import * as jose from "jose";
import { randomUUID } from "node:crypto";
import { HubTokenClaims, RoleType } from "./types.js";
import { keyStore } from "./key-store.js";
import { accountStore } from "./account-store.js";

export const TOKEN_CONFIG = {
  ISSUER: "clearshift-hub",
  AUDIENCE: "clearshift",
  ALGORITHM: "EdDSA",
  ACCESS_TOKEN_TTL_SECONDS: 900 // 15 minutes per §9.3 & acceptance criteria
} as const;

export class TokenService {
  private static instance: TokenService;

  public static getInstance(): TokenService {
    if (!TokenService.instance) {
      TokenService.instance = new TokenService();
    }
    return TokenService.instance;
  }

  /**
   * Signs an access token with all non-negotiable claims:
   * iss, aud, sub, iat, exp, jti, kid.
   */
  public async signAccessToken(
    userId: string,
    roles: RoleType[],
    employeeId?: string,
    customTtlSeconds?: number
  ): Promise<string> {
    const { kid, keyPair } = await keyStore.getSigningKey();
    const now = Math.floor(Date.now() / 1000);
    const ttl = customTtlSeconds ?? TOKEN_CONFIG.ACCESS_TOKEN_TTL_SECONDS;
    const jti = `jti_${randomUUID()}`;

    const jwt = new jose.SignJWT({
      roles,
      ...(employeeId ? { employee_id: employeeId } : {})
    })
      .setProtectedHeader({ alg: TOKEN_CONFIG.ALGORITHM, kid })
      .setIssuer(TOKEN_CONFIG.ISSUER)
      .setAudience(TOKEN_CONFIG.AUDIENCE)
      .setSubject(userId)
      .setJti(jti)
      .setIssuedAt(now)
      .setExpirationTime(now + ttl);

    return jwt.sign(keyPair.privateKey);
  }

  /**
   * Verifies an access token:
   * - Algorithm must be EdDSA (rejects 'none', HS*, etc.)
   * - Validates key ID and uses keyStore (supports key rotation window)
   * - Verifies signature, issuer, audience, expiration
   * - Verifies required claims (iss, aud, sub, iat, exp, jti, kid)
   * - Checks that the user account is not disabled
   */
  public async verifyAccessToken(token: string): Promise<HubTokenClaims> {
    // 1. Decode header to inspect algorithm and kid without verifying signature yet
    let header: jose.ProtectedHeaderParameters;
    try {
      header = jose.decodeProtectedHeader(token);
    } catch (err: any) {
      throw new Error(`Invalid token format: ${err.message}`);
    }

    if (header.alg !== TOKEN_CONFIG.ALGORITHM) {
      throw new Error(`Unsupported or rejected token algorithm: '${header.alg}'. Expected '${TOKEN_CONFIG.ALGORITHM}'`);
    }

    if (!header.kid) {
      throw new Error("Missing required 'kid' header parameter in token");
    }

    // 2. Fetch public key corresponding to kid (supports rotation grace period)
    const publicKey = await keyStore.getVerificationKey(header.kid);

    // 3. Verify signature, issuer, audience, expiration
    const { payload } = await jose.jwtVerify(token, publicKey, {
      issuer: TOKEN_CONFIG.ISSUER,
      audience: TOKEN_CONFIG.AUDIENCE
    });

    // 4. Validate non-negotiable claims existence
    if (!payload.sub || typeof payload.sub !== "string") {
      throw new Error("Missing or invalid 'sub' claim");
    }
    if (!payload.jti || typeof payload.jti !== "string") {
      throw new Error("Missing or invalid 'jti' claim");
    }
    if (typeof payload.iat !== "number") {
      throw new Error("Missing or invalid 'iat' claim");
    }
    if (typeof payload.exp !== "number") {
      throw new Error("Missing or invalid 'exp' claim");
    }

    // 5. Verify user account is not disabled
    const user = await accountStore.findById(payload.sub);
    if (user && !user.is_active) {
      throw new Error(`User account '${payload.sub}' is disabled`);
    }

    return {
      iss: payload.iss as string,
      aud: payload.aud as string,
      sub: payload.sub,
      jti: payload.jti,
      iat: payload.iat,
      exp: payload.exp,
      kid: header.kid,
      roles: (payload["roles"] as RoleType[]) || [],
      ...(typeof payload["employee_id"] === "string" ? { employee_id: payload["employee_id"] } : {})
    };
  }
}

export const tokenService = TokenService.getInstance();
