# ADR-002: Shared Zod/OpenAPI API Contract, Error Envelope and Pagination Standard

## Status
Accepted

## Context
ClearShift ERP is divided across multiple feature teams (ERP-1 through ERP-5) plus Platform/Migration Kit. Without a single shared contract layer:
- Route paths, query parameters, and pagination conventions drift.
- Error payloads diverge across module boundaries.
- Status codes become inconsistent across module implementations.
- Event payloads lack uniform tracing and deduplication identifiers.

Traceability: Project Plan v3.0 §§9.3-9.6, 17; relevant shared engineering contract in all three SDS v2.0; Issue #59 ([PLT-04]).

## Decision

1. **Interface Source of Truth**:
   - OpenAPI specifications located in `packages/contracts/openapi/` represent the public interface source of truth.
   - Runtime request and response validation at Fastify boundaries is powered by Zod schemas defined in `@clearshift/contracts` (`packages/contracts/src/`).
   - Every shared schema must be imported directly from `@clearshift/contracts` rather than duplicated ad hoc across modules.

2. **Standard Error Envelope**:
   - All error responses across all modules must adhere to the standard JSON error envelope:
     ```json
     {
       "code": "BAD_REQUEST",
       "message": "Human-readable summary of the error",
       "details": [
         {
           "field": "pageSize",
           "message": "pageSize cannot exceed 100",
           "code": "VALUE_OUT_OF_RANGE"
         }
       ],
       "correlation_id": "123e4567-e89b-12d3-a456-426614174000"
     }
     ```
   - Mandatory HTTP status codes and semantics:
     - `400 Bad Request`: Malformed syntax, invalid JSON, or schema validation failure (`BAD_REQUEST`, `VALIDATION_ERROR`).
     - `401 Unauthorized`: Missing, invalid, or expired authentication token (`UNAUTHORIZED`).
     - `403 Forbidden`: Authenticated user lacks required RBAC role or capability (`FORBIDDEN`).
     - `404 Not Found`: Target entity or route does not exist (`NOT_FOUND`).
     - `409 Conflict`: Deterministic state conflict or natural key duplicate (`CONFLICT`).
     - `413 Payload Too Large`: Request body or uploaded file exceeds limit (`PAYLOAD_TOO_LARGE`).
     - `422 Unprocessable Entity`: Syntactically valid request violates a domain business invariant (`UNPROCESSABLE_ENTITY`, `BUSINESS_RULE_VIOLATION`).
     - `429 Too Many Requests`: Rate limit exceeded (`TOO_MANY_REQUESTS`, `RATE_LIMITED`).
     - `500 Internal Server Error`: Unhandled exception or infrastructure failure (`INTERNAL_SERVER_ERROR`).

3. **Bounded Pagination**:
   - All paginated endpoints must accept bounded `page` and `pageSize` parameters.
   - `page`: Integer $\ge 1$ (default `1`).
   - `pageSize`: Integer $\ge 1$ and strictly capped at $\le 100$ (default `20`). Requests with `pageSize > 100` are rejected immediately with HTTP 400.
   - Large streams, migration step ledgers, and audit logs use cursor-based pagination (`cursor`, `limit <= 100`, `direction`).

4. **Event Envelope**:
   - Outbox rows, Redis Streams messages, and inter-module events adhere to `EventEnvelopeSchema`:
     ```json
     {
       "event_id": "uuid",
       "event_type": "string",
       "schema_version": "1.0.0",
       "occurred_at": "ISO-8601 datetime",
       "correlation_id": "string",
       "producer": "string",
       "entity_type": "string",
       "entity_id": "string",
       "payload": {},
       "metadata": {}
     }
     ```
   - Ensures idempotent consumption and end-to-end request correlation across modules.

## Consequences

- **Positive:**
  - Modules have a single source of truth for all common schemas and error structures.
  - Unblocks downstream module contracts (e.g. ERP-3 / #150).
  - Breaking API or contract changes are caught at compile-time and in CI contract test suites.
  - Client applications, UI components, and API consumers receive predictable, strongly-typed error responses with correlation IDs.
- **Negative:**
  - Modules must adhere strictly to the shared contract and cannot invent one-off error or pagination formats.
