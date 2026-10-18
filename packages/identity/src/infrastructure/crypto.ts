import * as jose from "jose";
import * as argon2 from "argon2";
import { HubTokenClaims, RoleType } from "../domain/token-claims.js";

// In-memory EdDSA keypair cache for Hub token issuance
let keyPair: jose.GenerateKeyPairResult | null = null;
const KID = "cs-hub-key-v1";

export async function getSigningKeys(): Promise<jose.GenerateKeyPairResult> {
  if (!keyPair) {
    keyPair = await jose.generateKeyPair("EdDSA", { crv: "Ed25519" });
  }
  return keyPair;
}

export async function getPublicJWKS(): Promise<{ keys: jose.JWK[] }> {
  const keys = await getSigningKeys();
  const publicJwk = await jose.exportJWK(keys.publicKey);
  publicJwk.kid = KID;
  publicJwk.alg = "EdDSA";
  publicJwk.use = "sig";
  return { keys: [publicJwk] };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export async function signAccessToken(
  userId: string,
  roles: RoleType[],
  employeeId?: string
): Promise<string> {
  const keys = await getSigningKeys();
  const now = Math.floor(Date.now() / 1000);

  return new jose.SignJWT({
    roles,
    employee_id: employeeId
  })
    .setProtectedHeader({ alg: "EdDSA", kid: KID })
    .setIssuer("clearshift-hub")
    .setAudience("clearshift")
    .setSubject(userId)
    .setJti("jti-" + Math.random().toString(36).substring(2))
    .setIssuedAt(now)
    .setExpirationTime(now + 900) // 15 minutes TTL per Section 3
    .sign(keys.privateKey);
}

export async function verifyAccessToken(token: string): Promise<HubTokenClaims> {
  const keys = await getSigningKeys();
  const { payload } = await jose.jwtVerify(token, keys.publicKey, {
    issuer: "clearshift-hub",
    audience: "clearshift"
  });

  const claims: HubTokenClaims = {
    iss: payload.iss as string,
    aud: payload.aud as string,
    sub: payload.sub as string,
    jti: payload.jti as string,
    exp: payload.exp as number,
    roles: (payload["roles"] as RoleType[]) || []
  };
  if (typeof payload["employee_id"] === "string") {
    claims.employee_id = payload["employee_id"];
  }
  return claims;
}
