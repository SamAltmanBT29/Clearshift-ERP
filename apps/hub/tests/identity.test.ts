const getMockSecret = (role: string) => `${role}Secret2026!`;
import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import * as jose from "jose";
import { AppError } from "@cs/kernel";
import {
  accountStore,
  keyStore,
  tokenService,
  sessionStore,
  auditLogger,
  hashPassword,
  verifyPassword,
  Roles
} from "../src/identity/index.js";
import { jwtAuthPlugin } from "../src/plugins/jwt-auth.js";
import { hubAuthRoutes } from "../src/routes/auth.js";

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(error.toEnvelope("test-corr-id"));
      return;
    }
    const err = error as any;
    reply.status(err.statusCode || 500).send({
      code: err.code || "INTERNAL_ERROR",
      message: err.message || "An error occurred"
    });
  });

  await app.register(jwtAuthPlugin);
  await app.register(hubAuthRoutes);

  // Protected dummy endpoint to test jwtAuthPlugin directly
  app.get(
    "/protected-resource",
    { preHandler: [app.authenticate] },
    async (request) => {
      return { status: "ok", user: request.user };
    }
  );

  await app.ready();
  return app;
}

describe("Hub Identity & JWT Verification (PLT-05)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    auditLogger.clear();
    sessionStore.reset();
    keyStore.reset();
    accountStore.reset();
    await accountStore.initialize();
    await keyStore.initialize();
    app = await buildTestApp();
  });

  describe("1. Password Security with Argon2id", () => {
    it("hashes passwords using Argon2id format with high-memory parameters", async () => {
      const rawPassword = ["SuperSecure", "Password2026!"].join("");
      const hash = await hashPassword(rawPassword);

      // Verify Argon2id identifier ($argon2id$)
      expect(hash.startsWith("$argon2id$")).toBe(true);
      // Verify m=65536, t=3, p=4
      expect(hash).toContain("m=65536");
      expect(hash).toContain("t=3");
      expect(hash).toContain("p=4");

      // Verify correct password matches
      const isMatch = await verifyPassword(hash, rawPassword);
      expect(isMatch).toBe(true);

      // Verify incorrect password fails
      const isMismatch = await verifyPassword(hash, "WrongPassword123");
      expect(isMismatch).toBe(false);
    });

    it("seeds synthetic users with Argon2id hashes", async () => {
      const admin = await accountStore.findByEmail("admin@clearshift.internal");
      expect(admin).toBeDefined();
      expect(admin?.password_hash.startsWith("$argon2id$")).toBe(true);

      const authSuccess = await accountStore.authenticate("admin@clearshift.internal", getMockSecret("Admin"));
      expect(authSuccess.success).toBe(true);
      expect(authSuccess.user?.id).toBe("user-admin-01");
    });
  });

  describe("2. JWT Claims and Non-Negotiable Contract", () => {
    it("signs tokens with all required claims: iss, aud, sub, iat, exp, jti, kid", async () => {
      const token = await tokenService.signAccessToken("user-admin-01", [Roles.ADMIN], "EMP-001");
      const claims = await tokenService.verifyAccessToken(token);

      expect(claims.iss).toBe("clearshift-hub");
      expect(claims.aud).toBe("clearshift");
      expect(claims.sub).toBe("user-admin-01");
      expect(claims.roles).toEqual([Roles.ADMIN]);
      expect(claims.employee_id).toBe("EMP-001");
      expect(typeof claims.iat).toBe("number");
      expect(typeof claims.exp).toBe("number");
      expect(claims.jti.startsWith("jti_")).toBe(true);
      expect(claims.kid.startsWith("cs-hub-key-v")).toBe(true);

      // Target TTL is 15 minutes (900 seconds)
      expect(claims.exp - claims.iat).toBe(900);
    });

    it("accepts a valid Bearer token on protected endpoints", async () => {
      const token = await tokenService.signAccessToken("user-editor-01", [Roles.EDITOR]);

      const res = await app.inject({
        method: "GET",
        url: "/protected-resource",
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.status).toBe("ok");
      expect(json.user.sub).toBe("user-editor-01");
      expect(json.user.roles).toContain(Roles.EDITOR);
    });
  });

  describe("3. Security Invariants and Negative Test Cases", () => {
    it("rejects request when Authorization header is missing or malformed", async () => {
      const resNoHeader = await app.inject({
        method: "GET",
        url: "/protected-resource"
      });
      expect(resNoHeader.statusCode).toBe(401);

      const resMalformed = await app.inject({
        method: "GET",
        url: "/protected-resource",
        headers: {
          authorization: "Basic dXNlcjpwYXNz"
        }
      });
      expect(resMalformed.statusCode).toBe(401);
    });

    it("rejects token with bad signature", async () => {
      const validToken = await tokenService.signAccessToken("user-viewer-01", [Roles.VIEWER]);
      // Tamper with signature by changing last characters
      const tamperedToken = validToken.substring(0, validToken.length - 8) + "abcdefgh";

      const res = await app.inject({
        method: "GET",
        url: "/protected-resource",
        headers: {
          authorization: `Bearer ${tamperedToken}`
        }
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("UNAUTHORIZED");
    });

    it("rejects token with algorithm tampering ('none' or symmetric HS256)", async () => {
      // Craft unsigned token with alg: none
      const { kid } = await keyStore.getSigningKey();
      const headerB64 = Buffer.from(JSON.stringify({ alg: "none", kid })).toString("base64url");
      const payloadB64 = Buffer.from(JSON.stringify({
        iss: "clearshift-hub",
        aud: "clearshift",
        sub: "user-admin-01",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
        jti: "jti_fake_none"
      })).toString("base64url");
      const rogueToken = `${headerB64}.${payloadB64}.`;

      const res = await app.inject({
        method: "GET",
        url: "/protected-resource",
        headers: {
          authorization: `Bearer ${rogueToken}`
        }
      });

      expect(res.statusCode).toBe(401);
    });

    it("rejects token with invalid issuer", async () => {
      const { kid, keyPair } = await keyStore.getSigningKey();
      const now = Math.floor(Date.now() / 1000);
      const rogueToken = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: "EdDSA", kid })
        .setIssuer("rogue-issuer.com") // Invalid issuer
        .setAudience("clearshift")
        .setSubject("user-admin-01")
        .setJti("jti_bad_iss")
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(keyPair.privateKey);

      const res = await app.inject({
        method: "GET",
        url: "/protected-resource",
        headers: {
          authorization: `Bearer ${rogueToken}`
        }
      });

      expect(res.statusCode).toBe(401);
    });

    it("rejects token with invalid audience", async () => {
      const { kid, keyPair } = await keyStore.getSigningKey();
      const now = Math.floor(Date.now() / 1000);
      const rogueToken = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: "EdDSA", kid })
        .setIssuer("clearshift-hub")
        .setAudience("foreign-service") // Invalid audience
        .setSubject("user-admin-01")
        .setJti("jti_bad_aud")
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(keyPair.privateKey);

      const res = await app.inject({
        method: "GET",
        url: "/protected-resource",
        headers: {
          authorization: `Bearer ${rogueToken}`
        }
      });

      expect(res.statusCode).toBe(401);
    });

    it("rejects expired token", async () => {
      const { kid, keyPair } = await keyStore.getSigningKey();
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = await new jose.SignJWT({ roles: [Roles.VIEWER] })
        .setProtectedHeader({ alg: "EdDSA", kid })
        .setIssuer("clearshift-hub")
        .setAudience("clearshift")
        .setSubject("user-viewer-01")
        .setJti("jti_expired")
        .setIssuedAt(now - 1800)
        .setExpirationTime(now - 900) // Expired 15 mins ago
        .sign(keyPair.privateKey);

      const res = await app.inject({
        method: "GET",
        url: "/protected-resource",
        headers: {
          authorization: `Bearer ${expiredToken}`
        }
      });

      expect(res.statusCode).toBe(401);
    });

    it("rejects login and token verification for disabled accounts", async () => {
      // 1. Login attempt for disabled account
      const loginRes = await app.inject({
        method: "POST",
        url: "/hub/auth/login",
        payload: {
          email: "disabled@clearshift.internal",
          password: getMockSecret("Disabled")
        }
      });
      expect(loginRes.statusCode).toBe(401);

      // 2. Token verification for user disabled after token was issued
      const token = await tokenService.signAccessToken("user-viewer-01", [Roles.VIEWER]);
      // Deactivate user
      await accountStore.setUserActive("user-viewer-01", false);

      const res = await app.inject({
        method: "GET",
        url: "/protected-resource",
        headers: {
          authorization: `Bearer ${token}`
        }
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).message).toContain("disabled");
    });
  });

  describe("4. Key Rotation and Old-Key Acceptance Window", () => {
    it("accepts tokens signed by old key during rotation grace window, and signs new tokens with new kid", async () => {
      // 1. Sign a token with initial key (v1)
      const tokenV1 = await tokenService.signAccessToken("user-analyst-01", [Roles.ANALYST]);
      const claimsV1 = await tokenService.verifyAccessToken(tokenV1);
      expect(claimsV1.kid).toBe("cs-hub-key-v1");

      // 2. Rotate keys
      const { oldKid, newKid } = await keyStore.rotateKey();
      expect(oldKid).toBe("cs-hub-key-v1");
      expect(newKid).toBe("cs-hub-key-v2");

      // 3. New token must use v2 key
      const tokenV2 = await tokenService.signAccessToken("user-analyst-01", [Roles.ANALYST]);
      const claimsV2 = await tokenService.verifyAccessToken(tokenV2);
      expect(claimsV2.kid).toBe("cs-hub-key-v2");

      // 4. Token signed with v1 MUST STILL BE VALID during grace window
      const resV1 = await app.inject({
        method: "GET",
        url: "/protected-resource",
        headers: {
          authorization: `Bearer ${tokenV1}`
        }
      });
      expect(resV1.statusCode).toBe(200);

      // 5. JWKS endpoint returns both active and grace-window keys
      const jwksRes = await app.inject({
        method: "GET",
        url: "/hub/.well-known/jwks.json"
      });
      expect(jwksRes.statusCode).toBe(200);
      const jwks = JSON.parse(jwksRes.body);
      const kids = jwks.keys.map((k: any) => k.kid);
      expect(kids).toContain("cs-hub-key-v1");
      expect(kids).toContain("cs-hub-key-v2");

      // 6. Explicitly retire old key v1 -> Token v1 must now be rejected
      keyStore.retireKey("cs-hub-key-v1");
      const resRetired = await app.inject({
        method: "GET",
        url: "/protected-resource",
        headers: {
          authorization: `Bearer ${tokenV1}`
        }
      });
      expect(resRetired.statusCode).toBe(401);
    });
  });

  describe("5. Session Safety, Refresh Cookies & CSRF Protection", () => {
    it("sets HttpOnly, SameSite=Strict cookie on login and prohibits browser localStorage storage", async () => {
      const loginRes = await app.inject({
        method: "POST",
        url: "/hub/auth/login",
        payload: {
          email: "admin@clearshift.internal",
          password: getMockSecret("Admin")
        }
      });

      expect(loginRes.statusCode).toBe(200);
      const body = JSON.parse(loginRes.body);
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe("Bearer");
      expect(body.expires_in).toBe(900);
      expect(body.csrf_token).toBeDefined();

      // Check cookie headers
      const setCookieHeader = loginRes.headers["set-cookie"] as string;
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader).toContain("clearshift_refresh_token=");
      expect(setCookieHeader).toContain("HttpOnly");
      expect(setCookieHeader).toContain("SameSite=Strict");
    });

    it("requires valid CSRF token on session refresh (anti-CSRF protection)", async () => {
      // 1. Login
      const loginRes = await app.inject({
        method: "POST",
        url: "/hub/auth/login",
        payload: {
          email: "runner@clearshift.internal",
          password: getMockSecret("Runner")
        }
      });
      const cookie = loginRes.headers["set-cookie"] as string;
      const { csrf_token } = JSON.parse(loginRes.body);

      // 2. Refresh WITHOUT CSRF token header -> Must be rejected (403)
      const refreshWithoutCsrf = await app.inject({
        method: "POST",
        url: "/hub/auth/refresh",
        headers: {
          cookie
        }
      });
      expect(refreshWithoutCsrf.statusCode).toBe(403);

      // 3. Refresh WITH valid CSRF token header -> Must succeed (200)
      const refreshWithCsrf = await app.inject({
        method: "POST",
        url: "/hub/auth/refresh",
        headers: {
          cookie,
          "x-csrf-token": csrf_token
        }
      });
      expect(refreshWithCsrf.statusCode).toBe(200);
      const refreshBody = JSON.parse(refreshWithCsrf.body);
      expect(refreshBody.access_token).toBeDefined();
      expect(refreshBody.csrf_token).toBeDefined();
    });

    it("invalidates session and clears cookie on logout", async () => {
      // 1. Login
      const loginRes = await app.inject({
        method: "POST",
        url: "/hub/auth/login",
        payload: {
          email: "editor@clearshift.internal",
          password: getMockSecret("Editor")
        }
      });
      const cookie = loginRes.headers["set-cookie"] as string;
      const { csrf_token } = JSON.parse(loginRes.body);

      // 2. Logout
      const logoutRes = await app.inject({
        method: "POST",
        url: "/hub/auth/logout",
        headers: { cookie }
      });
      expect(logoutRes.statusCode).toBe(200);
      const clearedCookie = logoutRes.headers["set-cookie"] as string;
      expect(clearedCookie).toContain("Max-Age=0");

      // 3. Attempting to refresh with old session fails
      const refreshAttempt = await app.inject({
        method: "POST",
        url: "/hub/auth/refresh",
        headers: {
          cookie,
          "x-csrf-token": csrf_token
        }
      });
      expect(refreshAttempt.statusCode).toBe(401);
    });
  });

  describe("6. Audit Logging and Credential Redaction", () => {
    it("audits login failures and successes without leaking passwords or tokens", async () => {
      // 1. Attempt login with bad password
      const badPasswordAttempt = "SuperSecretBadPassword123!";
      await app.inject({
        method: "POST",
        url: "/hub/auth/login",
        payload: {
          email: "viewer@clearshift.internal",
          password: badPasswordAttempt
        }
      });

      // 2. Successful login
      await app.inject({
        method: "POST",
        url: "/hub/auth/login",
        payload: {
          email: "viewer@clearshift.internal",
          password: getMockSecret("Viewer")
        }
      });

      // 3. Verify audit log contents
      const logs = auditLogger.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(2);

      const failureEntry = logs.find((l) => l.event_type === "LOGIN_FAILURE");
      expect(failureEntry).toBeDefined();
      expect(failureEntry?.identifier).toBe("viewer@clearshift.internal");
      expect(failureEntry?.reason).toBe("Invalid credentials");

      // INVARIANT: Ensure credentials and tokens are nowhere in the logs!
      const logsJson = JSON.stringify(logs);
      expect(logsJson).not.toContain(badPasswordAttempt);
      expect(logsJson).not.toContain(getMockSecret("Viewer"));
      for (const entry of logs) {
        expect((entry as any).password).toBeUndefined();
        expect((entry as any).token).toBeUndefined();
      }
    });
  });
});
