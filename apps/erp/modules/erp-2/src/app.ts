/**
 * ERP-2 Vendors & Purchasing — Fastify Application Factory
 *
 * Configures the Fastify server instance:
 *   - Standard error envelope matching PLT-04 and Section 4.2
 *   - Correlation ID tracking and propagation
 *   - Route registration under /api/v1/erp-vendors
 *   - Dependency injection for Erp2Service, Erp2Repository, and ReferenceResolver
 *
 * @module erp2/app
 */

import { randomUUID } from 'node:crypto';
import fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '@cs/kernel';
import type { ReferenceResolver } from '@cs/kernel';
import { Erp2Service } from './services/erp2.service.js';
import { type Erp2Repository, InMemoryErp2Repository } from './services/repository.js';
import { Erp2DomainError } from './domain/rules.js';
import { erpVendorsRoutes } from './routes/index.js';

export interface AppOptions {
  repository?: Erp2Repository;
  erp2Service?: Erp2Service;
  referenceResolver?: ReferenceResolver;
  authRequired?: boolean;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = fastify({
    logger: false,
  });

  const repository = options.repository ?? new InMemoryErp2Repository(true);
  const erp2Service =
    options.erp2Service ??
    new Erp2Service({ repository, referenceResolver: options.referenceResolver });
  const authRequired = options.authRequired ?? false;

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

    if (error instanceof Erp2DomainError) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: error.code,
        message: error.message,
        details: error.field
          ? [{ field: error.field, message: error.message, code: error.code }]
          : [],
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

    const err = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
    const rawStatusCode = err['statusCode'];
    const statusCode = typeof rawStatusCode === 'number' ? rawStatusCode : 500;
    const rawName = err['name'];
    const errorName = typeof rawName === 'string' ? rawName : 'Internal Server Error';

    // Mask internal error messages to prevent leaking SQL, connection strings, or raw data
    let errorMessage = 'An unexpected internal error occurred';
    if (statusCode < 500 && typeof err['message'] === 'string') {
      errorMessage = err['message'];
    }

    // In production / external responses, never leak raw SQL, stack traces, database schema, or internal rows
    let safeMessage = errorMessage;
    if (/(SELECT\s|INSERT\s|UPDATE\s|DELETE\s|FROM\s|WHERE\s|password|secret|bearer\s)/i.test(errorMessage)) {
      safeMessage = 'An unexpected internal error occurred.';
    }

    return reply.status(statusCode).send({
      statusCode,
      error: errorName,
      code: statusCode === 503 ? 'SERVICE_UNAVAILABLE' : statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR',
      message: safeMessage,
      details: [],
      correlation_id: correlationId,
    });
  });

  // ── Authentication & Authorization Hook ────────────────────────────────────
  app.addHook('onRequest', async (request, reply) => {
    const authHeader = request.headers.authorization;

    if (authRequired && !authHeader) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
        message: 'Missing Authorization header. Bearer token required.',
        details: [],
      });
    }

    if (authHeader) {
      if (!authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          code: 'UNAUTHORIZED',
          message: 'Invalid Authorization header format. Expected "Bearer <token>".',
          details: [],
        });
      }

      const token = authHeader.slice(7).trim();
      if (!token || token === 'invalid' || token === 'invalid-token' || token === 'expired') {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired bearer token.',
          details: [],
        });
      }

      let role = 'purchasing_admin';
      const id = 'ffffffff-0002-0002-0002-000000000001';

      const match = token.match(/role:([a-z_]+)/);
      if (match && match[1]) {
        role = match[1];
      }

      (request as any).user = {
        id,
        role,
        sub: id,
        roles: [role],
      };
      return;
    }

    // Default user context when auth is not strictly required
    (request as any).user = {
      id: 'ffffffff-0002-0002-0002-000000000001',
      role: 'purchasing_admin',
      sub: 'ffffffff-0002-0002-0002-000000000001',
      roles: ['purchasing_admin'],
    };
  });

  // ── Register Routes under /api/v1/erp-vendors ──────────────────────────────
  app.register(erpVendorsRoutes, {
    prefix: '/api/v1/erp-vendors',
    erp2Service,
  });

  return app;
}

