import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { AppError } from "@cs/kernel";
import { verifyAccessToken } from "../infrastructure/crypto.js";
import { HubTokenClaims } from "../domain/token-claims.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: HubTokenClaims;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

const jwtPluginAsync: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest("user", undefined);

  fastify.decorate("authenticate", async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError("UNAUTHORIZED", "Missing or invalid Authorization header", 401);
    }

    const token = authHeader.substring(7);
    try {
      const claims = await verifyAccessToken(token);
      request.user = claims;
    } catch (err: any) {
      throw new AppError("UNAUTHORIZED", `Token verification failed: ${err.message}`, 401);
    }
  });
};

export const jwtPlugin = fp(jwtPluginAsync, {
  name: "hub-jwt-plugin",
  fastify: "5.x"
});
