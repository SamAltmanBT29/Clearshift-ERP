import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "@cs/kernel";
import { getPublicJWKS, signAccessToken } from "../infrastructure/crypto.js";
import { RoleType, Roles } from "../domain/token-claims.js";

const LoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const ServiceTokenBodySchema = z.object({
  serviceName: z.string().min(1),
  role: z.enum([Roles.MIGRATION_RUNNER, Roles.ADMIN])
});

export const hubIdentityRoutes: FastifyPluginAsync = async (fastify) => {
  // Public JWKS discovery endpoint (Decision C3 & Section 4.3)
  fastify.get("/hub/.well-known/jwks.json", async () => {
    return await getPublicJWKS();
  });

  // Hub Login endpoint (Decision C3)
  fastify.post("/hub/auth/login", async (request) => {
    const parseResult = LoginBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid login payload", 400);
    }

    const { username, password } = parseResult.data;

    // Default admin / development bootstrap authentication
    if (username === "admin" && password === "admin123") {
      const token = await signAccessToken("user-admin-01", [Roles.ADMIN]);
      return {
        access_token: token,
        token_type: "Bearer",
        expires_in: 900
      };
    }

    if (username === "runner" && password === "runner123") {
      const token = await signAccessToken("user-runner-01", [Roles.MIGRATION_RUNNER]);
      return {
        access_token: token,
        token_type: "Bearer",
        expires_in: 900
      };
    }

    throw new AppError("UNAUTHORIZED", "Invalid username or password", 401);
  });

  // Issue scoped service token (Admin capability)
  fastify.post("/hub/service-tokens", async (request) => {
    const parseResult = ServiceTokenBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid service token payload", 400);
    }

    const { serviceName, role } = parseResult.data;
    const token = await signAccessToken(`service-${serviceName}`, [role as RoleType]);

    return {
      service_name: serviceName,
      access_token: token,
      token_type: "Bearer",
      expires_in: 900
    };
  });
};
