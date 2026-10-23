import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fastify, { FastifyInstance } from "fastify";
import { healthRoutes } from "../src/routes/health.js";
import {
  setLogSink,
  createLogger,
  LogEntry,
  globalWorkerMetrics,
  checkLiveness,
  checkReadiness,
} from "@cs/core";
import { MigrationWorkerHealthMonitor } from "../../migration-kit/src/workers/health.js";

describe("[PLT-11] Health, Structured Logs, Correlation IDs and Metrics", () => {
  let app: FastifyInstance;
  let capturedLogs: LogEntry[] = [];

  beforeEach(async () => {
    capturedLogs = [];
    setLogSink((entry) => capturedLogs.push(entry));
    globalWorkerMetrics.reset();

    app = fastify();
  });

  afterEach(async () => {
    setLogSink(null);
    await app.close();
  });

  describe("Liveness vs Readiness Separation", () => {
    it("readiness fails with 503 when DB dependency is down, while liveness remains 200 ok", async () => {
      // Mock DB dependency that is DOWN
      const mockDownDbChecker = async () => ({
        status: "down" as const,
        latencyMs: 15,
        message: "Database ping failed (connection refused)",
      });

      const mockOkRedisChecker = async () => ({
        status: "ok" as const,
        latencyMs: 2,
      });

      await app.register(healthRoutes, {
        moduleName: "hub",
        version: "1.0.0",
        dbChecker: mockDownDbChecker,
        redisChecker: mockOkRedisChecker,
      });
      await app.ready();

      // 1. Liveness Probe must still return 200 OK (process is alive!)
      const liveRes = await app.inject({
        method: "GET",
        url: "/health/live",
      });
      expect(liveRes.statusCode).toBe(200);
      const liveJson = liveRes.json();
      expect(liveJson.status).toBe("ok");
      expect(liveJson.module).toBe("hub");
      expect(liveJson.uptimeSeconds).toBeGreaterThanOrEqual(0);

      // 2. Readiness Probe must return 503 Service Unavailable (cannot accept traffic)
      const readyRes = await app.inject({
        method: "GET",
        url: "/health/ready",
      });
      expect(readyRes.statusCode).toBe(503);
      const readyJson = readyRes.json();
      expect(readyJson.status).toBe("down");
      expect(readyJson.dependencies?.postgres?.status).toBe("down");
      expect(readyJson.dependencies?.redis?.status).toBe("ok");
    });

    it("readiness returns 200 ok when all dependencies are healthy", async () => {
      const mockHealthyDb = async () => ({ status: "ok" as const, latencyMs: 3 });
      const mockHealthyRedis = async () => ({ status: "ok" as const, latencyMs: 1 });

      await app.register(healthRoutes, {
        moduleName: "hub",
        version: "1.0.0",
        dbChecker: mockHealthyDb,
        redisChecker: mockHealthyRedis,
      });
      await app.ready();

      const readyRes = await app.inject({
        method: "GET",
        url: "/health/ready",
      });
      expect(readyRes.statusCode).toBe(200);
      const json = readyRes.json();
      expect(json.status).toBe("ok");
      expect(json.dependencies?.postgres?.status).toBe("ok");
      expect(json.dependencies?.redis?.status).toBe("ok");
    });
  });

  describe("Zero-Leakage Security Invariant for Health Endpoints", () => {
    it("never reveals database credentials, connection URLs, or stack traces in health response", async () => {
      // Checker simulates an unhandled raw driver error containing credentials
      const leakingDriverChecker = async () => {
        throw new Error(
          "FATAL: password authentication failed for user 'cs_app' at postgresql://cs_app:super_secret_db_password_123@10.0.0.5:5432/clearshift\n    at Connection.parse (/node_modules/pg/lib/connection.js:123:45)"
        );
      };

      await app.register(healthRoutes, {
        moduleName: "hub",
        dbChecker: leakingDriverChecker,
      });
      await app.ready();

      const readyRes = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      const bodyText = readyRes.body;
      expect(bodyText).not.toContain("super_secret_db_password_123");
      expect(bodyText).not.toContain("postgresql://");
      expect(bodyText).not.toContain("10.0.0.5:5432");
      expect(bodyText).not.toContain("/node_modules/pg");

      const json = readyRes.json();
      expect(json.status).toBe("down");
      expect(json.dependencies?.postgres?.message).toBe(
        "Dependency check failed (connection refused or timed out)"
      );
    });
  });

  describe("Correlation ID Propagation & Structured JSON Logs", () => {
    it("propagates client x-correlation-id through response header and structured logs", async () => {
      const logger = createLogger("test-service");

      await app.register(healthRoutes, { moduleName: "hub" });
      await app.ready();

      const customCorrId = "corr-custom-trace-8899";
      const response = await app.inject({
        method: "GET",
        url: "/health/live",
        headers: {
          "x-correlation-id": customCorrId,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-correlation-id"]).toBe(customCorrId);

      // Verify logger with explicit or context correlation ID
      logger.info("operation.execute", "Processing user operation", { correlation_id: customCorrId });
      const matchingLog = capturedLogs.find((l) => l.correlation_id === customCorrId);
      expect(matchingLog).toBeDefined();
      expect(matchingLog?.module).toBe("test-service");
      expect(matchingLog?.operation).toBe("operation.execute");
      expect(matchingLog?.level).toBe("info");
    });

    it("generates UUID correlation ID when client does not provide one", async () => {
      await app.register(healthRoutes, { moduleName: "hub" });
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/health/live",
      });

      const corrId = response.headers["x-correlation-id"] as string;
      expect(corrId).toBeDefined();
      expect(corrId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe("Worker Failures and Queue Lag Observability", () => {
    it("tracks worker jobs, failures, and queue lag for local operational monitoring", async () => {
      const workerMonitor = new MigrationWorkerHealthMonitor();

      await app.register(healthRoutes, { moduleName: "hub" });
      await app.ready();

      // 1. Report queue lag of 75 items
      workerMonitor.reportQueueLag(75);

      // 2. Successful job
      await workerMonitor.executeJob(
        {
          jobId: "job-1",
          queueName: "kit.cleaning",
          correlationId: "corr-j-1",
          data: { batchId: "b-1" },
        },
        async () => {
          return { rowsProcessed: 500 };
        }
      );

      // 3. Failed job
      await expect(
        workerMonitor.executeJob(
          {
            jobId: "job-2",
            queueName: "kit.cleaning",
            correlationId: "corr-j-2",
            data: { batchId: "b-2" },
          },
          async () => {
            throw new Error("CSV malformed header on row 1");
          }
        )
      ).rejects.toThrow("CSV malformed header on row 1");

      // 4. Query /health/metrics
      const metricsRes = await app.inject({
        method: "GET",
        url: "/health/metrics",
      });

      expect(metricsRes.statusCode).toBe(200);
      const json = metricsRes.json();
      expect(json.metrics.queueLag).toBe(75);
      expect(json.metrics.completedJobs).toBe(1);
      expect(json.metrics.failedJobs).toBe(1);
      expect(json.metrics.lastHeartbeat).toBeDefined();

      // 5. Worker health report
      const status = workerMonitor.getHealthStatus();
      expect(status.queueLag).toBe(75);
      expect(status.completedJobs).toBe(1);
      expect(status.failedJobs).toBe(1);
    });
  });
});
