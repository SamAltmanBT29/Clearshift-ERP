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

  // ── Correlation ID Propagation Hook ───────────────────────────────────────
  app.addHook('onSend', async (request, reply) => {
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ??
      (request.headers['x-request-id'] as string | undefined) ??
      randomUUID();
    reply.header('x-correlation-id', correlationId);
  });

  // ── Optional Authentication / Authorization Hook ───────────────────────────
  if (options.authRequired) {
    app.addHook('onRequest', async (request, reply) => {
      const correlationId =
        (request.headers['x-correlation-id'] as string | undefined) ??
        (request.headers['x-request-id'] as string | undefined) ??
        randomUUID();
      reply.header('x-correlation-id', correlationId);

      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          code: 'UNAUTHORIZED',
          message: 'Authorization header with Bearer token is required',
          details: [],
          correlation_id: correlationId,
        });
      }

      const token = authHeader.slice(7).trim();
      if (!token) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          code: 'UNAUTHORIZED',
          message: 'Invalid or missing Bearer token',
          details: [],
          correlation_id: correlationId,
        });
      }

      // Populate user info from Bearer token
      let role = 'user';
      if (token.startsWith('role:')) {
        role = token.slice(5);
      } else if (token === 'admin-token') {
        role = 'admin';
      } else if (token === 'editor-token') {
        role = 'editor';
      }

      (request as unknown as { user: Record<string, unknown> }).user = {
        sub: 'user-001',
        role,
        token,
      };
    });
  }

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

    return reply.status(statusCode).send({
      statusCode,
      error: errorName,
      code: statusCode === 503 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_SERVER_ERROR',
      message: errorMessage,
      details: [],
      correlation_id: correlationId,
    });
  });

  // ── Register Routes under /api/v1/erp-vendors ──────────────────────────────
  app.register(erpVendorsRoutes, {
    prefix: '/api/v1/erp-vendors',
    erp2Service,
  });

  return app;
}

