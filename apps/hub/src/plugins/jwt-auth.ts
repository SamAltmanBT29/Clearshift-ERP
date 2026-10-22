import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { AppError } from "@cs/kernel";
import { tokenService } from "../identity/index.js";
import { HubTokenClaims } from "@cs/identity";

declare module "fastify" {
  interface FastifyRequest {
    user?: HubTokenClaims;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

const jwtAuthPluginAsync: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest("user", undefined);

  fastify.decorate("authenticate", async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError("UNAUTHORIZED", "Missing or invalid Authorization header", 401);
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new AppError("UNAUTHORIZED", "Empty Bearer token provided", 401);
    }

    try {
      const claims = await tokenService.verifyAccessToken(token);
      request.user = claims;
    } catch (err: any) {
      throw new AppError("UNAUTHORIZED", `Token verification failed: ${err.message}`, 401);
    }
  });
};

export const jwtAuthPlugin = fp(jwtAuthPluginAsync, {
  name: "hub-jwt-auth-plugin",
  fastify: "5.x"
});
