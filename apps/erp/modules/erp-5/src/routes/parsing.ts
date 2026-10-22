/**
 * ERP-5 HR & Employees — Route Boundary Helpers
 *
 * The route boundary owns the *shape* of a request: Zod validation and the
 * `Idempotency-Key` header. Business rules live in the service layer, the
 * database constraints are the second line of defence.
 *
 * This module deliberately does not import `zod`: the contract package
 * resolves its own Zod 3 instance, while the workspace root resolves Zod 4.
 * Importing a schema by its structural `parse` signature keeps the two
 * versions apart.
 *
 * @module erp5/routes/parsing
 */

import type { FastifyRequest } from 'fastify';
import { HR_DOMAIN_RULES } from '@clearshift/contracts';
import { HrBadRequestError } from '../services/errors.js';

/** A Zod-like schema — any object with a `parse` method. */
export interface HrSchema<TSchema> {
  parse: (data: unknown) => TSchema;
}

/**
 * Reads the `Idempotency-Key` request header.
 *
 * The header is the transport a browser or the Migration Kit uses to carry
 * the stable idempotency key. It may also be supplied in the body as
 * `idempotency_key`; the two must agree.
 */
export function readIdempotencyKeyHeader(request: FastifyRequest): string | undefined {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parses a write body at the route boundary.
 *
 * The `Idempotency-Key` header is merged into the body so the contract sees
 * one canonical `idempotency_key` field. A header and a body field that
 * disagree are rejected instead of being resolved silently.
 */
export function parseWriteBody<TSchema>(
  schema: HrSchema<TSchema>,
  request: FastifyRequest
): TSchema {
  const raw = (
    request.body !== null && typeof request.body === 'object' ? request.body : {}
  ) as Record<string, unknown>;

  const headerKey = readIdempotencyKeyHeader(request);
  const bodyKey = typeof raw['idempotency_key'] === 'string' ? raw['idempotency_key'] : undefined;

  if (
    headerKey !== undefined &&
    typeof bodyKey === 'string' &&
    headerKey !== bodyKey
  ) {
    throw new HrBadRequestError(
      'The Idempotency-Key header and the idempotency_key body field disagree.',
      [
        {
          field: 'idempotency_key',
          message: 'The Idempotency-Key header and the body field must be identical',
          code: HR_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED,
        },
      ],
      HR_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED
    );
  }

  const payload = headerKey !== undefined ? { ...raw, idempotency_key: headerKey } : raw;
  return schema.parse(payload);
}
