/**
 * ERP-4 Finance & Accounting — Fastify Application Factory
 *
 * Configures the Fastify server instance:
 *   - Global error handler producing standard ApiError envelopes (PLT-04)
 *   - EdDSA asymmetric JWT authentication hook & user resolution (PLT-05 / ERP4-09)
 *   - Field-level masking hook for sensitive financial details on JSON & CSV (PLT-06)
 *   - Route policy preHandler guards matching SDS §4.8 matrix
 *   - Append-only audit trail logging for state transitions (PLT-10)
 *   - Dependency injection for FinanceService, FinanceRepository, and AuditService
 *
 * @module erp4/app
 */

import { randomUUID } from 'node:crypto';
import fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, type ReferenceResolver } from '@cs/kernel';
import { FinanceService, ServiceError } from './services/finance.service.js';
import { DomainError } from '../domain/engine.js';
import type { FinanceRepository } from './services/repository.js';
import { InMemoryFinanceRepository } from './services/repository.js';
import { Erp4AuditService } from './services/audit.js';
import { authPlugin, type AuthenticatedFinanceUser } from './plugins/auth.js';
import { erp4FieldMaskingPlugin } from './policies/masking.js';
import { erpFinanceRoutes } from './routes/index.js';

export interface AppOptions {
  repository?: FinanceRepository | undefined;
  financeService?: FinanceService | undefined;
  referenceResolver?: ReferenceResolver | undefined;
  auditService?: Erp4AuditService | undefined;
  authRequired?: boolean | undefined;
  isUserDisabled?: ((userId: string) => boolean | Promise<boolean>) | undefined;
}

export type AuthenticatedUser = AuthenticatedFinanceUser;

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = fastify({
    logger: false,
  });

  const repository = options.repository ?? new InMemoryFinanceRepository(true);
  const auditService = options.auditService ?? new Erp4AuditService();
  const financeService =
    options.financeService ??
    new FinanceService({
      repository,
      referenceResolver: options.referenceResolver,
      auditService,
    });
  const authRequired = options.authRequired ?? false;

  // ── Global Error Handler ───────────────────────────────────────────────────
  app.setErrorHandler((error: unknown, request, reply) => {
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ??
      (request.headers['x-request-id'] as string | undefined) ??
      randomUUID();
    reply.header('x-correlation-id', correlationId);

    // 1. Platform AppError (Auth 401, Forbidden 403, PreHandler guards)
    if (error instanceof AppError) {
      const statusCode = error.statusCode;
      const errorTitle =
        statusCode === 401 ? 'Unauthorized' : (statusCode === 403 ? 'Forbidden' : error.code);
      return reply.status(statusCode).send({
        statusCode,
        error: errorTitle,
        code: error.code,
        message: error.message,
        details: Array.isArray(error.details) ? error.details : (error.details ? [error.details] : []),
        correlation_id: correlationId,
      });
    }

    // 2. Service layer errors
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

    // 3. Domain invariant errors
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

    // 4. Zod validation failures
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

    // 5. Unexpected errors — strictly sanitize SQL, tokens, and raw rows
    const err = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
    const rawStatusCode = err['statusCode'];
    const statusCode = typeof rawStatusCode === 'number' ? rawStatusCode : 500;
    const rawName = err['name'];
    const errorName = typeof rawName === 'string' ? rawName : 'Internal Server Error';
    const rawMessage = err['message'];
    const errorMessage = typeof rawMessage === 'string' ? rawMessage : 'An unexpected error occurred';

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

  // ── Field-Level Masking Plugin (onSend hook) ───────────────────────────────
  app.register(erp4FieldMaskingPlugin);

  // ── Authentication Plugin (onRequest hook & verifyAccessToken) ─────────────
  app.register(authPlugin, {
    authRequired,
    ...(options.isUserDisabled ? { isUserDisabled: options.isUserDisabled } : {}),
  });

  // ── Register Module Routes ─────────────────────────────────────────────────
  app.register(erpFinanceRoutes, {
    prefix: '/api/v1/erp-finance',
    financeService,
  });

  return app;
}
