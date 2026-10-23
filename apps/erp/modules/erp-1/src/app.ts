/**
 * ERP-1 Products & Inventory — Fastify Application Factory
 *
 * Configures the Fastify server instance:
 *   - Standard error envelope matching PLT-04 and ADR-002
 *   - Correlation ID tracking and propagation (x-correlation-id)
 *   - Route registration under /api/v1/erp-products
 *   - Dependency injection for Erp1Service, Erp1Repository, and ReferenceResolver
 *
 * @module erp1/app
 */

import { randomUUID } from 'node:crypto';
import fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '@cs/kernel';
import type { ReferenceResolver } from '@cs/kernel';
import { Erp1Service } from './services/erp1.service.js';
import { type Erp1Repository, InMemoryErp1Repository } from './services/repository.js';
import { Erp1DomainError } from './domain/rules.js';
import { erpProductsRoutes } from './routes/index.js';

export interface AppOptions {
  repository?: Erp1Repository | undefined;
  erp1Service?: Erp1Service | undefined;
  referenceResolver?: ReferenceResolver | undefined;
  authRequired?: boolean | undefined;
}

export const ERP1_API_PREFIX = '/api/v1/erp-products';

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = fastify({
    logger: false,
  });

  const repository = options.repository ?? new InMemoryErp1Repository(true);
  const erp1Service =
    options.erp1Service ??
    new Erp1Service({ repository, referenceResolver: options.referenceResolver });

  // ── Correlation ID Propagation Hook ───────────────────────────────────────
  app.addHook('onSend', async (request, reply) => {
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ??
      (request.headers['x-request-id'] as string | undefined) ??
      randomUUID();
    reply.header('x-correlation-id', correlationId);
  });

  // ── Global Error Handler ───────────────────────────────────────────────────
  app.setErrorHandler((error: unknown, request, reply) => {
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ??
      (request.headers['x-request-id'] as string | undefined) ??
      randomUUID();
    reply.header('x-correlation-id', correlationId);

    if (error instanceof Erp1DomainError) {
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.statusCode === 409 ? 'Conflict' : error.statusCode === 404 ? 'Not Found' : 'Unprocessable Entity',
        code: error.code,
        message: error.message,
        details: error.field
          ? [{ field: error.field, message: error.message, code: error.code }]
          : [],
        correlation_id: correlationId,
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.name,
        code: error.code,
        message: error.message,
        details: error.details,
        correlation_id: correlationId,
      });
    }

    if (
      error instanceof ZodError ||
      (typeof error === 'object' &&
        error !== null &&
        'issues' in error &&
        Array.isArray((error as { issues: unknown[] }).issues))
    ) {
      const zodErr = error as ZodError;
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: zodErr.issues[0]?.message ?? 'Validation failed',
        details: zodErr.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
        correlation_id: correlationId,
      });
    }

    // Default 500 handler with sanitized message
    const internalErr = error as Error | undefined;
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      code: 'INTERNAL_SERVER_ERROR',
      message: internalErr?.message ?? 'An unexpected error occurred',
      correlation_id: correlationId,
    });
  });

  // ── Register Module Routes ─────────────────────────────────────────────────
  app.register(erpProductsRoutes, {
    prefix: ERP1_API_PREFIX,
    erp1Service,
  });

  return app;
}
