/**
 * ERP-1 Products & Inventory — Route Boundary Helpers
 *
 * @module erp1/routes/parsing
 */

import type { FastifyRequest } from 'fastify';
import { ERP1_DOMAIN_RULES } from '@clearshift/contracts';
import { Erp1BadRequestError } from '../services/errors.js';

export interface Erp1Schema<T> {
  parse: (data: unknown) => T;
}

/** Reads the Idempotency-Key header, if present. */
export function readIdempotencyKeyHeader(request: FastifyRequest): string | undefined {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parses a write body after merging the `Idempotency-Key` header into the
 * canonical `idempotency_key` field. A header/body mismatch is rejected.
 */
export function parseWriteBody<T>(schema: Erp1Schema<T>, request: FastifyRequest): T {
  const raw = (
    request.body !== null && typeof request.body === 'object' ? request.body : {}
  ) as Record<string, unknown>;

  const headerKey = readIdempotencyKeyHeader(request);
  const bodyKeyRaw = raw['idempotency_key'] ?? raw['idempotencyKey'];
  const bodyKey = typeof bodyKeyRaw === 'string' ? bodyKeyRaw.trim() : undefined;

  if (headerKey !== undefined && bodyKey !== undefined && headerKey !== bodyKey) {
    throw new Erp1BadRequestError(
      'The Idempotency-Key header and the idempotency_key body field disagree.',
      [
        {
          field: 'idempotency_key',
          code: ERP1_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED,
          message: 'The Idempotency-Key header and the body field must be identical',
        },
      ],
      ERP1_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED
    );
  }

  const payload =
    headerKey !== undefined ? { ...raw, idempotency_key: headerKey } : raw;
  return schema.parse(payload);
}
