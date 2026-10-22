/**
 * ERP-5 HR & Employees — Service Errors
 *
 * The module maps its failures onto the **shared** platform error envelope
 * (`{code, message, details, correlation_id}` owned by PLT-04 —
 * `@clearshift/contracts` → `ErrorEnvelopeSchema`). This file only describes
 * *which* HTTP status and *which* stable code a failure carries — it does not
 * define a second envelope.
 *
 * Status mapping (issue #48):
 *   400 — malformed request (Zod / structural problem)
 *   403 — authenticated but not allowed to write
 *   404 — the referenced or addressed record does not exist
 *   409 — duplicate key or idempotency conflict
 *   422 — invalid business value (a domain invariant was violated)
 *
 * @module erp5/services/errors
 */

import { HR_DOMAIN_RULES, StandardErrorCodes } from '@clearshift/contracts';
import type { ErrorDetail } from '@clearshift/contracts';

/**
 * A safe, structured detail entry of the shared error envelope.
 *
 * The type is the platform-owned `ErrorDetail` of the merged PLT-04 contract
 * (`packages/contracts/src/common.ts`) — the module never defines a second
 * detail shape.
 */
export type HrErrorDetail = ErrorDetail;

/**
 * Base class of every failure raised by the ERP-5 service layer.
 *
 * `details` never contains a SQL statement, a stack trace, a secret or a raw
 * database row.
 */
export class HrServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: HrErrorDetail[] = []
  ) {
    super(message);
    this.name = 'HrServiceError';
  }
}

/** 400 — the request itself is malformed. */
export class HrBadRequestError extends HrServiceError {
  constructor(message: string, details: HrErrorDetail[] = [], code: string = StandardErrorCodes.VALIDATION_ERROR) {
    super(400, code, message, details);
    this.name = 'HrBadRequestError';
  }
}

/** 403 — the caller may not perform this write. */
export class HrForbiddenError extends HrServiceError {
  constructor(message: string, code: string = StandardErrorCodes.FORBIDDEN, details: HrErrorDetail[] = []) {
    super(403, code, message, details);
    this.name = 'HrForbiddenError';
  }
}

/** 404 — the addressed or referenced record does not exist. */
export class HrNotFoundError extends HrServiceError {
  constructor(entity: string, id: string, code: string = StandardErrorCodes.NOT_FOUND, details: HrErrorDetail[] = []) {
    super(404, code, `${entity} with identifier "${id}" was not found.`, details);
    this.name = 'HrNotFoundError';
  }
}

/** 409 — a unique key or the idempotency key is already taken. */
export class HrConflictError extends HrServiceError {
  constructor(message: string, details: HrErrorDetail[] = [], code: string = StandardErrorCodes.CONFLICT) {
    super(409, code, message, details);
    this.name = 'HrConflictError';
  }
}

/** 409 — the idempotency key was already used for a different payload. */
export class HrIdempotencyConflictError extends HrConflictError {
  constructor(message: string, details: HrErrorDetail[] = []) {
    super(message, details, HR_DOMAIN_RULES.IDEMPOTENCY_CONFLICT);
    this.name = 'HrIdempotencyConflictError';
  }
}

/** 422 — a business value violates a domain invariant. */
export class HrUnprocessableError extends HrServiceError {
  constructor(message: string, details: HrErrorDetail[] = [], code: string = StandardErrorCodes.UNPROCESSABLE_ENTITY) {
    super(422, code, message, details);
    this.name = 'HrUnprocessableError';
  }
}
