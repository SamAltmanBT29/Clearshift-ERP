/**
 * ERP-2 Vendors & Purchasing — Fastify Application Factory
 *
 * Configures the Fastify server instance:
 *   - Error handling producing standard ApiError envelopes (PLT-04)
 *   - Safe error masking (never leaks raw SQL or secrets)
 *   - EdDSA/Ed25519 JWT Authentication plugin (@cs/identity)
 *   - Route registration under /api/v1/erp-vendors
 *   - Dependency injection for services, repository, and reference resolvers
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
import { VendorService } from './services/vendor.service.js';
import { PurchaseOrderService } from './services/purchase-order.service.js';
import { AuditService, defaultAuditService } from './services/audit.js';
import { Erp2DomainError } from './domain/rules.js';
import { erp2AuthPlugin } from './plugins/auth.js';
import { erpVendorsRoutes } from './routes/index.js';
import { erp1Resolver } from '@cs/mod-erp1';

export interface AppOptions {
  repository?: Erp2Repository;
  erp2Service?: Erp2Service;
  vendorService?: VendorService;
  purchaseOrderService?: PurchaseOrderService;
  referenceResolver?: ReferenceResolver;
  auditService?: AuditService;
  strictAuth?: boolean;
  authRequired?: boolean;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = fastify({
    logger: false,
  });

  const repository = options.repository ?? new InMemoryErp2Repository(true);
  const auditService = options.auditService ?? defaultAuditService;
  const referenceResolver = options.referenceResolver ?? erp1Resolver;

  const vendorService =
    options.vendorService ?? new VendorService(repository, auditService);
  const purchaseOrderService =
    options.purchaseOrderService ??
    new PurchaseOrderService(repository, referenceResolver, auditService);

  const erp2Service =
    options.erp2Service ??
    new Erp2Service({ repository, referenceResolver });

  const strictAuth = options.strictAuth ?? options.authRequired ?? false;

  // ── Correlation ID Propagation Hook ───────────────────────────────────────
  app.addHook('onRequest', async (request, reply) => {
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ??
      (request.headers['x-request-id'] as string | undefined) ??
      randomUUID();

    reply.header('x-correlation-id', correlationId);
    (request as any).correlationId = correlationId;
  });

  // ── Global Error Handler ───────────────────────────────────────────────────
  app.setErrorHandler((error: unknown, request, reply) => {
    const correlationId =
      (reply.getHeader('x-correlation-id') as string | undefined) ??
      (request as any).correlationId ??
      (request.headers['x-correlation-id'] as string | undefined) ??
      (request.headers['x-request-id'] as string | undefined) ??
      randomUUID();
    reply.header('x-correlation-id', correlationId);

    if (error instanceof AppError) {
      const statusCode = error.statusCode ?? 500;
      const statusNames: Record<number, string> = {
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        409: 'Conflict',
        422: 'Unprocessable Entity',
        500: 'Internal Server Error',
        503: 'Service Unavailable',
      };
      const errorName = statusNames[statusCode] || (error.name !== 'AppError' ? error.name : 'Error');
      return reply.status(statusCode).send({
        statusCode,
        error: errorName,
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
    let errorMessage = 'An unexpected internal error occurred.';
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

  // ── Authentication Plugin ──────────────────────────────────────────────────
  app.register(erp2AuthPlugin, { strictAuth });

  // ── Register Routes ────────────────────────────────────────────────────────
  app.register(erpVendorsRoutes, {
    prefix: '/api/v1/erp-vendors',
    erp2Service,
    vendorService,
    purchaseOrderService,
  });

  return app;
}
