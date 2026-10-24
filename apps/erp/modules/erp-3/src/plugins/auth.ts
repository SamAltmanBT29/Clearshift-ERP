import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { RoleSchema } from "@clearshift/contracts";
import { AppError } from "@cs/kernel";
import { verifyAccessToken, type HubTokenClaims } from "@cs/identity";
import type { Erp3AuditService } from "../services/audit.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: HubTokenClaims | undefined;
  }
}

export interface Erp3AuthPluginOptions {
  authRequired: boolean;
  auditService: Erp3AuditService;
  isUserDisabled?: ((userId: string) => boolean | Promise<boolean>) | undefined;
}

function correlationId(request: FastifyRequest): string {
  const header = request.headers["x-correlation-id"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  return request.id;
}

async function recordAuthenticationFailure(
  request: FastifyRequest,
  auditService: Erp3AuditService,
  reason: string,
): Promise<void> {
  await auditService.record({
    actor: "anonymous",
    action: "auth.failed",
    targetEntity: "erp3_api",
    correlationId: correlationId(request),
    result: "failure",
    reason,
    metadata: {
      method: request.method,
      route: request.routeOptions.url ?? "unknown",
    },
  });
}

export const authPluginAsync: FastifyPluginAsync<Erp3AuthPluginOptions> = async (
  fastify,
  options,
) => {
  fastify.decorateRequest("user", undefined);

  fastify.addHook("onRequest", async (request) => {
    const authorization = request.headers.authorization;
    if (!authorization) {
      if (!options.authRequired) {
        request.user = {
          iss: "clearshift-test",
          aud: "erp3-test",
          sub: "erp3-test-editor",
          jti: "erp3-test-session",
          exp: Math.floor(Date.now() / 1000) + 60,
          roles: ["editor"],
        };
        return;
      }

      await recordAuthenticationFailure(request, options.auditService, "missing_credentials");
      throw new AppError("UNAUTHORIZED", "Authentication required", 401);
    }

    if (!authorization.startsWith("Bearer ")) {
      await recordAuthenticationFailure(request, options.auditService, "invalid_authorization_scheme");
      throw new AppError("UNAUTHORIZED", "Invalid Authorization header", 401);
    }

    const token = authorization.slice("Bearer ".length).trim();
    if (!token) {
      await recordAuthenticationFailure(request, options.auditService, "empty_bearer_token");
      throw new AppError("UNAUTHORIZED", "Invalid Authorization header", 401);
    }

    let claims: HubTokenClaims;
    try {
      claims = await verifyAccessToken(token);
    } catch {
      await recordAuthenticationFailure(request, options.auditService, "token_verification_failed");
      throw new AppError("UNAUTHORIZED", "Invalid or expired bearer token", 401);
    }

    if (!claims.sub || !Array.isArray(claims.roles) || !RoleSchema.array().safeParse(claims.roles).success) {
      await recordAuthenticationFailure(request, options.auditService, "invalid_token_claims");
      throw new AppError("UNAUTHORIZED", "Invalid access token claims", 401);
    }

    if (options.isUserDisabled && (await options.isUserDisabled(claims.sub))) {
      await options.auditService.record({
        actor: claims.sub,
        action: "auth.failed",
        targetEntity: "user",
        targetId: claims.sub,
        correlationId: correlationId(request),
        result: "failure",
        reason: "account_disabled",
      });
      throw new AppError("UNAUTHORIZED", "Account is disabled", 401);
    }

    request.user = claims;
  });
};

export const authPlugin = fp(authPluginAsync, {
  name: "erp3-auth-plugin",
  fastify: "5.x",
});
