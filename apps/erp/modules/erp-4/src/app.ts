/**
 * ERP-4 Finance & Accounting — Fastify Application Factory
 *
 * Configures the Fastify server instance:
 *   - Error handling producing standard ApiError envelopes
 *   - Bearer token authentication hook
 *   - Route registration under /api/v1/erp-finance
 *   - Dependency injection for FinanceService and FinanceRepository
 *
 * @module erp4/app
 */

import { randomUUID } from 'node:crypto';
import fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '@cs/kernel';
import { FinanceService, ServiceError } from './services/finance.service.js';
import { DomainError } from '../domain/engine.js';
import type { FinanceRepository } from './services/repository.js';
import { InMemoryFinanceRepository } from './services/repository.js';
import type { ReferenceResolver } from '@cs/kernel';
import { erpFinanceRoutes } from './routes/index.js';
import { authenticateFinanceRequest } from './interface/authz.js';

export interface AppOptions {
  repository?: FinanceRepository | undefined;
  financeService?: FinanceService | undefined;
  referenceResolver?: ReferenceResolver | undefined;
  authRequired?: boolean | undefined;
}

export interface AuthenticatedUser {
  id: string;
  role: string;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = fastify({
    logger: false,
  });

  const repository = options.repository ?? new InMemoryFinanceRepository(true);
  const financeService =
    options.financeService ??
    new FinanceService({ repository, referenceResolver: options.referenceResolver });
  const authRequired = options.authRequired ?? false;

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
        error: error.statusCode === 401 ? 'Unauthorized' : error.statusCode === 403 ? 'Forbidden' : error.code,
        code: error.code,
        message: error.message,
        details: error.details,
        correlation_id: correlationId,
      });
    }

    if (error instanceof ServiceError) {
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.error,
        code: error.code,
        message: error.message,
        details: error.details,
        correlation_id: correlationId,
      });
    }

    if (error instanceof DomainError || (error && (error as any).name === 'DomainError')) {
      const domErr = error as DomainError;
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: domErr.code,
        message: domErr.message,
        details: domErr.context ? [domErr.context] : [],
        correlation_id: correlationId,
      });
    }

    if (
      error instanceof ZodError ||
      (typeof error === 'object' && error !== null && 'issues' in error && Array.isArray((error as { issues: unknown[] }).issues))
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
    const rawMessage = err['message'];
    const errorMessage = typeof rawMessage === 'string' ? rawMessage : 'An unexpected error occurred';

    // In production / external responses, never leak raw SQL, stack traces, database schema, or internal rows
    let safeMessage = errorMessage;
    if (/(SELECT\s|INSERT\s|UPDATE\s|DELETE\s|FROM\s|WHERE\s|password|secret|bearer\s)/i.test(errorMessage)) {
      safeMessage = 'An unexpected internal error occurred.';
    }

    return reply.status(statusCode).send({
      statusCode,
      error: errorName,
      code: statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR',
      message: safeMessage,
      details: [],
      correlation_id: correlationId,
    });
  });

  // ── Authentication & Authorization Hook ────────────────────────────────────
  app.addHook('onRequest', async (request) => {
    await authenticateFinanceRequest(request, authRequired);
  });

  // ── Register Module Routes ─────────────────────────────────────────────────
  app.register(erpFinanceRoutes, {
    prefix: '/api/v1/erp-finance',
    financeService,
  });

  return app;
}
