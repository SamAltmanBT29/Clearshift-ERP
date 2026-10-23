/**
 * ERP-1 Products & Inventory — Duplicate Detection & Human Review Routes
 *
 * Implements:
 *   - POST /duplicates/check (deterministic exact duplicate scanning)
 *   - GET  /duplicates/candidates (list held duplicate candidates)
 *   - GET  /duplicates/candidates/:id (retrieve candidate details)
 *   - POST /duplicates/review (authorized human review decision & audit trail)
 *
 * Traceability:
 *   - ERP1-12: Exact duplicate key policy for the module
 *   - KIT-10: Exact duplicate candidate review and audited merge decisions
 *
 * @module erp1/routes/duplicates
 */

import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import {
  CheckErp1DuplicatesRequestSchema,
  ReviewErp1DuplicateRequestSchema,
  UuidSchema,
} from '@clearshift/contracts';
import type { Erp1Service } from '../services/erp1.service.js';

export const duplicateRoutes: FastifyPluginAsync<{ erp1Service: Erp1Service }> = async (
  fastify,
  opts
) => {
  const service = opts.erp1Service;

  // POST /duplicates/check
  fastify.post('/duplicates/check', async (request, reply) => {
    const parsed = CheckErp1DuplicatesRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const correlationId =
        (request.headers['x-correlation-id'] as string | undefined) ??
        (request.headers['x-request-id'] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid duplicate check request',
        details: parsed.error.issues,
        correlation_id: correlationId,
      });
    }

    const response = await service.checkDuplicates(parsed.data);
    return reply.status(200).send(response);
  });

  // GET /duplicates/candidates
  fastify.get('/duplicates/candidates', async (request, reply) => {
    const query = request.query as { entity?: 'product' | 'category' | undefined };
    const candidates = await service.getDuplicateCandidates(query.entity);
    return reply.status(200).send({
      items: candidates,
      total: candidates.length,
    });
  });

  // GET /duplicates/candidates/:id
  fastify.get('/duplicates/candidates/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const validUuid = UuidSchema.safeParse(id);
    if (!validUuid.success) {
      const correlationId =
        (request.headers['x-correlation-id'] as string | undefined) ??
        (request.headers['x-request-id'] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'INVALID_IDENTIFIER',
        message: `Invalid candidate UUID format: '${id}'`,
        correlation_id: correlationId,
      });
    }

    const candidate = await service.getDuplicateCandidateById(id);
    if (!candidate) {
      const correlationId =
        (request.headers['x-correlation-id'] as string | undefined) ??
        (request.headers['x-request-id'] as string | undefined) ??
        randomUUID();
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        code: 'NOT_FOUND',
        message: `Duplicate candidate '${id}' not found`,
        correlation_id: correlationId,
      });
    }

    return reply.status(200).send(candidate);
  });

  // POST /duplicates/review
  fastify.post('/duplicates/review', async (request, reply) => {
    const parsed = ReviewErp1DuplicateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const correlationId =
        (request.headers['x-correlation-id'] as string | undefined) ??
        (request.headers['x-request-id'] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid duplicate review payload',
        details: parsed.error.issues,
        correlation_id: correlationId,
      });
    }

    // Extract operator context from headers or auth token claims
    const user = (request as unknown as { user?: { sub?: string; role?: string } }).user;
    const actorId =
      (request.headers['x-actor-id'] as string | undefined) ??
      (request.headers['x-user-id'] as string | undefined) ??
      user?.sub ??
      'operator-001';

    const role =
      (request.headers['x-actor-role'] as string | undefined) ??
      user?.role ??
      'migration_runner';

    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ??
      (request.headers['x-request-id'] as string | undefined) ??
      randomUUID();

    const response = await service.reviewDuplicateCandidate(parsed.data, {
      id: actorId,
      role,
      correlationId,
    });

    return reply.status(200).send(response);
  });
};
