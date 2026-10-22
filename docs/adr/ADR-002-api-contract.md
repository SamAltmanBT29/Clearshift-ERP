# ADR-002: Shared API Contract, Error Envelope, and Bounded Pagination

## Status
Accepted

## Context
Different module implementations (CRM-1 through CRM-5 in Clearshift-CRM, ERP-1 through ERP-5 in Clearshift-ERP) would otherwise drift on endpoint paths, HTTP status codes, pagination envelopes, and error representations.
Traceability: Project Plan v3.0 §§9.3-9.6, 17; relevant shared engineering contract in all SDS v2.0.

## Decision
1. **Interface Source of Truth**: OpenAPI 3.1 in `packages/contracts/openapi` is the contract source of truth; Fastify HTTP request/response boundary schemas use Zod schemas in `packages/contracts/src`.
2. **Error Envelope**: All error responses must adhere to `{ code, message, details, correlation_id }`:
   - `code`: Stable, machine-readable string (e.g. `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`).
   - `message`: Human-readable summary safe for client consumption.
   - `details`: Structured array of field-level errors or diagnostic context.
   - `correlation_id` / `correlationId`: Request tracking identifier.
3. **HTTP Status Code Mapping**:
   - `400 Bad Request`: Validation failure or malformed payload.
   - `401 Unauthenticated`: Missing or invalid JWT credentials.
   - `403 Forbidden`: Authenticated user lacks RBAC permission.
   - `404 Not Found`: Target entity does not exist.
   - `409 Conflict`: Unique constraint or idempotent state conflict.
   - `413 Payload Too Large`: Upload limit exceeded (max 50 MB for migration batches).
   - `422 Unprocessable Entity`: Business rule or domain transition violation.
   - `429 Too Many Requests`: Rate limit exceeded.
   - `500 Internal Server Error`: Unhandled/unexpected failure.
4. **Pagination**:
   - Offset pagination: Bounded `page` (min 1, default 1) and `pageSize` (min 1, default 25, max 100). Any request requesting `pageSize > 100` MUST return `400 Bad Request`.
   - Cursor pagination: Bounded `limit` (max 100) for large logs and streams.
   - Response envelope: `{ items: T[], meta: { page, pageSize, total, totalPages, hasNextPage, hasPrevPage } }`.
5. **Transactional Outbox Event Envelope**:
   - Outbox events require `{ id, eventType, aggregateType, aggregateId, timestamp, version, producer, payload }` with UUID identifiers and ISO-8601 timestamps.

## Consequences
- Every module imports shared contract primitives from `@clearshift/contracts` rather than duplicating ad hoc schemas.
- Invalid response payloads fail contract tests deterministically.
- Downstream feature modules (CRM-2 through CRM-5, ERP-1 through ERP-5) and Platform services (PLT-05, PLT-06, PLT-07, PLT-09) can immediately proceed against stabilized interfaces.
