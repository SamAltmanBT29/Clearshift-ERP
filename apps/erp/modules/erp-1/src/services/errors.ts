/**
 * ERP-1 Products & Inventory — Service Errors
 *
 * Every failure is mapped onto the shared platform envelope
 * `{code, message, details, correlation_id}`. This file only chooses the HTTP
 * status and the stable code; it does not define a second envelope.
 *
 * @module erp1/services/errors
 */

import { StandardErrorCodes, type ErrorDetail } from '@clearshift/contracts';

export type Erp1ErrorDetail = ErrorDetail;

export class Erp1ServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Erp1ErrorDetail[] = []
  ) {
    super(message);
    this.name = 'Erp1ServiceError';
  }
}

export class Erp1BadRequestError extends Erp1ServiceError {
  constructor(
    message: string,
    details: Erp1ErrorDetail[] = [],
    code: string = StandardErrorCodes.VALIDATION_ERROR
  ) {
    super(400, code, message, details);
    this.name = 'Erp1BadRequestError';
  }
}

export class Erp1NotFoundError extends Erp1ServiceError {
  constructor(
    entity: string,
    id: string,
    code: string = StandardErrorCodes.NOT_FOUND,
    details: Erp1ErrorDetail[] = []
  ) {
    super(404, code, `${entity} with identifier "${id}" was not found.`, details);
    this.name = 'Erp1NotFoundError';
  }
}

export class Erp1ConflictError extends Erp1ServiceError {
  constructor(
    message: string,
    details: Erp1ErrorDetail[] = [],
    code: string = StandardErrorCodes.CONFLICT
  ) {
    super(409, code, message, details);
    this.name = 'Erp1ConflictError';
  }
}

export class Erp1UnprocessableError extends Erp1ServiceError {
  constructor(
    message: string,
    details: Erp1ErrorDetail[] = [],
    code: string = StandardErrorCodes.UNPROCESSABLE_ENTITY
  ) {
    super(422, code, message, details);
    this.name = 'Erp1UnprocessableError';
  }
}

export class Erp1ForbiddenError extends Erp1ServiceError {
  constructor(
    message: string,
    details: Erp1ErrorDetail[] = [],
    code: string = StandardErrorCodes.FORBIDDEN
  ) {
    super(403, code, message, details);
    this.name = 'Erp1ForbiddenError';
  }
}
