# ClearShift Operations, Health & Observability Runbook (PLT-11)

## 1. Overview & Architectural Principles

In accordance with **ClearShift Project Plan v3.0 §§9.3–9.6, 17**, all services in the ClearShift monorepo must maintain:
1. **Liveness vs. Readiness Separation**: Kubernetes / Compose health checks distinguish between process liveness (`/health/live`) and dependency readiness (`/health/ready`).
2. **Correlation ID Propagation**: An unbroken request correlation ID traces operations from API requests through outbox envelopes, Redis Streams messages, and BullMQ batch workers.
3. **Structured JSON Logs**: Logs are structured JSON, strictly containing `timestamp`, `level`, `module`, `operation`, `correlation_id`, and safe machine error codes.
4. **Data Protection Invariant**: Raw CSV/XLSX row contents, passwords, JWT tokens, bank account numbers, and salaries must never be logged.

---

## 2. Health & Readiness Probes

### 2.1 Process Liveness Probe: `GET /health/live`
- **Purpose**: Verifies that the Node.js process is running and its event loop is responsive.
- **Behavior**: Returns `200 OK` without querying downstream dependencies.
- **Sample Output**:
  ```json
  {
    "status": "ok",
    "module": "hub",
    "version": "1.0.0",
    "uptimeSeconds": 3450,
    "timestamp": "2026-10-22T12:00:00.000Z"
  }
  ```

### 2.2 Dependency Readiness Probe: `GET /health/ready`
- **Purpose**: Verifies that the service can process customer traffic by checking PostgreSQL and Redis.
- **Status Codes**:
  - `200 OK`: All critical dependencies report `"ok"`.
  - `503 Service Unavailable`: Any critical dependency reports `"down"`.
- **Security Invariant**: Never reveals connection strings, database usernames/passwords, or internal stack traces.
- **Sample Healthy Output (200 OK)**:
  ```json
  {
    "status": "ok",
    "module": "hub",
    "version": "1.0.0",
    "timestamp": "2026-10-22T12:00:00.000Z",
    "dependencies": {
      "postgres": { "status": "ok", "latencyMs": 2 },
      "redis": { "status": "ok", "latencyMs": 1 }
    }
  }
  ```
- **Sample Unhealthy Output (503 Service Unavailable)**:
  ```json
  {
    "status": "down",
    "module": "hub",
    "version": "1.0.0",
    "timestamp": "2026-10-22T12:00:00.000Z",
    "dependencies": {
      "postgres": {
        "status": "down",
        "latencyMs": 5,
        "message": "Database ping failed (connection refused or timeout)"
      },
      "redis": { "status": "ok", "latencyMs": 1 }
    }
  }
  ```

---

## 3. Correlation ID Propagation Standard

Every incoming request or pipeline trigger establishes a correlation ID:

1. **HTTP Ingestion**: Extracted from `x-correlation-id` or `x-request-id` header. If absent, a UUID is generated.
2. **Context Storage**: Bound to the request lifecycle via Node.js `AsyncLocalStorage` (`runWithCorrelationContext`).
3. **HTTP Response**: Echoed in response header `x-correlation-id`.
4. **Outbox Events**: Propagated to `EventEnvelope.correlation_id`.
5. **Background Jobs**: Passed in BullMQ job data as `{ correlationId: "..." }`.

---

## 4. Structured JSON Logging Format

All module logs must adhere to the structured JSON schema:

```json
{
  "timestamp": "2026-10-22T12:00:00.000Z",
  "level": "info",
  "module": "erp-finance",
  "operation": "journal.post",
  "correlation_id": "7f13b2e5-392c-47bc-8fa2-68045610b271",
  "message": "Posting journal entry je-1001",
  "details": {
    "journalEntryId": "je-1001",
    "periodId": "2026-10"
  }
}
```

On error:
```json
{
  "timestamp": "2026-10-22T12:00:01.000Z",
  "level": "error",
  "module": "erp-finance",
  "operation": "journal.post",
  "correlation_id": "7f13b2e5-392c-47bc-8fa2-68045610b271",
  "message": "Period 2026-10 is closed",
  "error_code": "PERIOD_CLOSED",
  "details": {
    "error": "Error: Accounting period is closed"
  }
}
```

---

## 5. Worker Metrics & Queue Lag Observability

Available via `GET /health/metrics`:

```json
{
  "module": "migration-kit-worker",
  "metrics": {
    "activeWorkers": 3,
    "completedJobs": 1420,
    "failedJobs": 4,
    "activeJobs": 2,
    "queueLag": 18,
    "averageDurationMs": 240,
    "lastHeartbeat": "2026-10-22T12:00:02.000Z"
  }
}
```

### Alerting & Triage:
- **Queue Lag > 1,000**: Worker concurrency bottleneck. Scale up worker pods.
- **Failed Jobs Spike (> 10% of batch)**: Inspect safe error codes. Stop batch load if failure rate threshold exceeded.
