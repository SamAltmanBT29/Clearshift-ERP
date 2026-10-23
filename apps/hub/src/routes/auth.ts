import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "@cs/kernel";
import {
  accountStore,
  tokenService,
  sessionStore,
  keyStore,
  auditLogger
} from "../identity/index.js";

const LoginBodySchema = z.object({
  email: z.string().optional(),
  username: z.string().optional(),
  identifier: z.string().optional(),
  password: z.string().min(1, "Password is required")
}).refine(
  (data) => !!(data.email || data.username || data.identifier),
  { message: "Either email, username, or identifier must be provided" }
);

function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;

  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const name = parts.shift()?.trim();
    if (name) {
      list[name] = decodeURIComponent(parts.join("=").trim());
    }
  });

  return list;
}

export const hubAuthRoutes: FastifyPluginAsync = async (fastify) => {
  // Public JWKS discovery endpoint (Section 4.3 & RFC 7517)
  fastify.get("/hub/.well-known/jwks.json", async () => {
    return await keyStore.getPublicJWKS();
  });

  // Hub Login endpoint
  fastify.post("/hub/auth/login", async (request, reply) => {
    const parseResult = LoginBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new AppError("VALIDATION_ERROR", parseResult.error.issues[0]?.message || "Invalid login payload", 400);
    }

    const { email, username, identifier, password } = parseResult.data;
    const loginIdentifier = (identifier || email || username)!.trim();
    const clientIp = request.ip;
    const userAgent = request.headers["user-agent"];

    const authResult = await accountStore.authenticate(loginIdentifier, password, {
      ip_address: clientIp,
      user_agent: userAgent
    });

    if (!authResult.success) {
      if (authResult.reason === "ACCOUNT_DISABLED") {
        throw new AppError("UNAUTHORIZED", "Account is disabled. Contact your administrator.", 401);
      }
      throw new AppError("UNAUTHORIZED", "Invalid username or password", 401);
    }

    const user = authResult.user!;
    const accessToken = await tokenService.signAccessToken(user.id, user.roles, user.employee_id);
    const { rawRefreshToken, csrfToken } = await sessionStore.createSession(user.id, {
      ip_address: clientIp,
      user_agent: userAgent
    });

    // Set HttpOnly, Secure, SameSite=Strict cookie for refresh session
    const isProduction = process.env["NODE_ENV"] === "production";
    const secureFlag = isProduction ? "; Secure" : "";
    reply.header(
      "Set-Cookie",
      `clearshift_refresh_token=${rawRefreshToken}; Path=/; HttpOnly${secureFlag}; SameSite=Strict; Max-Age=604800`
    );

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 900,
      csrf_token: csrfToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        employee_id: user.employee_id
      }
    };
  });

  // Hub Refresh Session endpoint
  fastify.post("/hub/auth/refresh", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const body = (request.body as { refresh_token?: string }) || {};
    const refreshToken = cookies["clearshift_refresh_token"] || body.refresh_token;

    if (!refreshToken) {
      throw new AppError("UNAUTHORIZED", "Missing refresh token cookie or parameter", 401);
    }

    // CSRF Protection for state-changing cookie auth
    const csrfHeader = (request.headers["x-csrf-token"] as string) || (request.body as any)?.csrf_token;
    const clientIp = request.ip;
    const userAgent = request.headers["user-agent"];

    const rotateResult = await sessionStore.rotateSession(refreshToken, csrfHeader, {
      ip_address: clientIp,
      user_agent: userAgent
    });

    if (!rotateResult.success) {
      if (rotateResult.reason === "CSRF_FAILED") {
        throw new AppError("FORBIDDEN", "CSRF token validation failed", 403);
      }
      if (rotateResult.reason === "ACCOUNT_DISABLED") {
        throw new AppError("UNAUTHORIZED", "Account is disabled", 401);
      }
      throw new AppError("UNAUTHORIZED", `Refresh failed: ${rotateResult.reason || "Invalid session"}`, 401);
    }

    const user = await accountStore.findById(rotateResult.userId!);
    if (!user || !user.is_active) {
      throw new AppError("UNAUTHORIZED", "Account is disabled", 401);
    }

    const accessToken = await tokenService.signAccessToken(user.id, user.roles, user.employee_id);

    const isProduction = process.env["NODE_ENV"] === "production";
    const secureFlag = isProduction ? "; Secure" : "";
    reply.header(
      "Set-Cookie",
      `clearshift_refresh_token=${rotateResult.newRawRefreshToken}; Path=/; HttpOnly${secureFlag}; SameSite=Strict; Max-Age=604800`
    );

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 900,
      csrf_token: rotateResult.newCsrfToken
    };
  });

  // Hub Logout endpoint
  fastify.post("/hub/auth/logout", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const body = (request.body as { refresh_token?: string }) || {};
    const refreshToken = cookies["clearshift_refresh_token"] || body.refresh_token;

    if (refreshToken) {
      sessionStore.revokeSession(refreshToken);
    }

    // Clear refresh cookie
    reply.header("Set-Cookie", "clearshift_refresh_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict");

    return {
      success: true,
      message: "Logged out successfully"
    };
  });

  // Hub Key Rotation endpoint
  fastify.post("/hub/auth/rotate-keys", async (request) => {
    const result = await keyStore.rotateKey();
    return {
      status: "keys_rotated",
      old_key_id: result.oldKid,
      new_key_id: result.newKid,
      timestamp: new Date().toISOString()
    };
  });

  // Protected Identity Profile verification
  fastify.get(
    "/hub/auth/me",
    { preHandler: [fastify.authenticate] },
    async (request) => {
      const user = await accountStore.findById(request.user!.sub);
      return {
        claims: request.user,
        account: user ? {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: user.roles,
          is_active: user.is_active,
          employee_id: user.employee_id
        } : null
      };
    }
  );
};
