import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  checkLiveness,
  checkReadiness,
  DependencyChecker,
  globalWorkerMetrics,
  extractCorrelationId,
  runWithCorrelationContext,
} from "@cs/core";

export interface HealthRouteOptions {
  moduleName?: string | undefined;
  version?: string | undefined;
  dbChecker?: DependencyChecker | undefined;
  redisChecker?: DependencyChecker | undefined;
}

export async function healthRoutes(fastify: FastifyInstance, options?: HealthRouteOptions): Promise<void> {
  const moduleName = options?.moduleName ?? "hub";
  const version = options?.version ?? "1.0.0";

  // Correlation ID Middleware Hook
  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = extractCorrelationId(request.headers);
    reply.header("x-correlation-id", correlationId);
    (request as any).correlationId = correlationId;
  });

  // Wrap route handler execution in correlation context
  fastify.addHook("preHandler", async (request: FastifyRequest) => {
    const correlationId = (request as any).correlationId || extractCorrelationId(request.headers);
    runWithCorrelationContext({ correlationId, module: moduleName }, () => {});
  });

  /**
   * Process Liveness Probe (/health/live)
   * Confirms Node.js event loop is responsive; never checks downstream DBs.
   */
  fastify.get("/health/live", async (_request: FastifyRequest, reply: FastifyReply) => {
    const payload = checkLiveness(moduleName, version);
    return reply.status(200).send(payload);
  });

  /**
   * Dependency Readiness Probe (/health/ready)
   * Evaluates DB and Redis dependencies; returns 503 if any critical dependency is down.
   */
  fastify.get("/health/ready", async (_request: FastifyRequest, reply: FastifyReply) => {
    const checkers: Record<string, DependencyChecker> = {};
    if (options?.dbChecker) checkers["postgres"] = options.dbChecker;
    if (options?.redisChecker) checkers["redis"] = options.redisChecker;

    const { statusCode, payload } = await checkReadiness(moduleName, version, checkers);
    return reply.status(statusCode).send(payload);
  });

  /**
   * General /health route
   */
  fastify.get("/health", async (_request: FastifyRequest, reply: FastifyReply) => {
    const checkers: Record<string, DependencyChecker> = {};
    if (options?.dbChecker) checkers["postgres"] = options.dbChecker;
    if (options?.redisChecker) checkers["redis"] = options.redisChecker;

    const { statusCode, payload } = await checkReadiness(moduleName, version, checkers);
    return reply.status(statusCode).send(payload);
  });

  /**
   * Local Demo Worker Metrics (/health/metrics)
   * Observability for job completions, failures, and queue lag.
   */
  fastify.get("/health/metrics", async (_request: FastifyRequest, reply: FastifyReply) => {
    const metrics = globalWorkerMetrics.getMetrics();
    return reply.status(200).send({
      module: moduleName,
      metrics,
    });
  });
}
