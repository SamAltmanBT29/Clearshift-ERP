import Fastify, { FastifyInstance } from "fastify";
import { AppError } from "@cs/kernel";
import { jwtPlugin, hubIdentityRoutes } from "@cs/identity";
import { requireCapability, Capabilities } from "@cs/rbac";
import { registerBusinessModules } from "./module-registry.js";

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info"
    }
  });

  // 1. Health and Readiness Probes (Section 4.7)
  app.get("/health/live", async () => {
    return { status: "live", timestamp: new Date().toISOString() };
  });

  app.get("/health/ready", async () => {
    return { status: "ready", timestamp: new Date().toISOString() };
  });

  // 2. Authentication Plugin (PLT-05 / Decision C3)
  app.register(jwtPlugin);

  // 3. Central Error Envelope Handler (PLT-04 & Section 4.2)
  app.setErrorHandler((error, request, reply) => {
    const correlationId = (request.headers["x-correlation-id"] as string) || "corr-" + Date.now();
    
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(error.toEnvelope(correlationId));
      return;
    }

    request.log.error(error);
    reply.status(500).send({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message || "An unexpected error occurred",
      details: [],
      correlation_id: correlationId
    });
  });

  // 4. Register API Routes under /api/v1
  app.register(async (v1) => {
    // Hub Identity: /api/v1/hub/auth/login, /api/v1/hub/.well-known/jwks.json, etc.
    v1.register(hubIdentityRoutes);

    // Register all 10 Business Modules (CRM-1..5, ERP-1..5)
    await registerBusinessModules(v1);

    // Protected Route Verification: requires valid JWT + kit.run capability
    v1.post(
      "/migration-kit/test-run",
      {
        preHandler: [v1.authenticate, requireCapability(Capabilities.KIT_RUN)]
      },
      async (request) => {
        return {
          status: "authorized",
          user: request.user?.sub,
          roles: request.user?.roles,
          timestamp: new Date().toISOString()
        };
      }
    );
  }, { prefix: "/api/v1" });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const server = buildServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen({ port, host: "0.0.0.0" }, (err, address) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }
    server.log.info(`ClearShift API server running at ${address}`);
  });
}
