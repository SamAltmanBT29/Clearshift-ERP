import { HealthResponse, HealthStatus } from "@clearshift/contracts";

export interface DependencyCheckResult {
  status: HealthStatus;
  latencyMs?: number | undefined;
  message?: string | undefined;
}

export type DependencyChecker = () => Promise<DependencyCheckResult>;

export interface LivenessResponse {
  status: "ok";
  module: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

/**
 * Liveness Check (Kubernetes /health/live)
 * Pure process-level check confirming the Node.js event loop is operational.
 * Does not check downstream databases or external services.
 */
export function checkLiveness(module: string, version = "1.0.0"): LivenessResponse {
  return {
    status: "ok",
    module,
    version,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Readiness Check (Kubernetes /health/ready)
 * Evaluates operational readiness by checking essential external dependencies
 * (PostgreSQL, Redis) without exposing sensitive connection strings or stack traces.
 */
export async function checkReadiness(
  module: string,
  version: string = "1.0.0",
  checkers: Record<string, DependencyChecker> = {}
): Promise<{ statusCode: number; payload: HealthResponse }> {
  const dependencies: Record<string, DependencyCheckResult> = {};
  const entries = Object.entries(checkers);
  const results = await Promise.all(
    entries.map(async ([depName, checker]): Promise<HealthStatus> => {
      try {
        const start = Date.now();
        const res = await checker();
        const latency = res.latencyMs ?? (Date.now() - start);

        dependencies[depName] = {
          status: res.status,
          latencyMs: latency,
          ...(res.message ? { message: res.message } : {}),
        };

        return res.status;
      } catch {
        // Safe sanitization: never leak credentials or internal connection strings
        dependencies[depName] = {
          status: "down",
          message: "Dependency check failed (connection refused or timed out)",
        };
        return "down";
      }
    })
  );

  let aggregateStatus: HealthStatus = "ok";
  if (results.includes("down")) {
    aggregateStatus = "down";
  } else if (results.includes("degraded")) {
    aggregateStatus = "degraded";
  }

  const payload: HealthResponse = {
    status: aggregateStatus,
    module,
    version,
    timestamp: new Date().toISOString(),
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
  };

  const statusCode = aggregateStatus === "down" ? 503 : 200;

  return { statusCode, payload };
}

/**
 * Helper to build a safe database ping checker without leaking DB credentials
 */
export function createDbHealthChecker(pingFn: () => Promise<boolean>): DependencyChecker {
  return async () => {
    const start = Date.now();
    try {
      const ok = await pingFn();
      const latencyMs = Date.now() - start;
      return {
        status: ok ? "ok" : "down",
        latencyMs,
        message: ok ? undefined : "Database returned non-healthy response",
      };
    } catch {
      return {
        status: "down",
        latencyMs: Date.now() - start,
        message: "Database ping failed (connection refused or timeout)",
      };
    }
  };
}

/**
 * Helper to build a safe Redis ping checker without leaking Redis credentials
 */
export function createRedisHealthChecker(pingFn: () => Promise<boolean>): DependencyChecker {
  return async () => {
    const start = Date.now();
    try {
      const ok = await pingFn();
      const latencyMs = Date.now() - start;
      return {
        status: ok ? "ok" : "down",
        latencyMs,
        message: ok ? undefined : "Redis returned non-healthy response",
      };
    } catch {
      return {
        status: "down",
        latencyMs: Date.now() - start,
        message: "Redis ping failed (connection refused or timeout)",
      };
    }
  };
}
