/**
 * ERP-2 Vendors & Purchasing — Fastify Application Factory
 *
 * Configures the Fastify server instance:
 *   - Error handling producing standard ApiError envelopes
 *   - Safe error masking (never leaks raw SQL or secrets)
 *   - EdDSA/Ed25519 JWT Authentication plugin (@cs/identity)
 *   - Route registration under /api/v1/erp-vendors
 *   - Dependency injection for services and repository
 *
 * @module erp2/app
 */

import { randomUUID } from 'node:crypto';
import fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, type ReferenceResolver } from '@cs/kernel';
import { InMemoryErp2Repository, type Erp2Repository } from './services/repository.js';
import { VendorService } from './services/vendor.service.js';
import { PurchaseOrderService } from './services/purchase-order.service.js';
import { AuditService, defaultAuditService } from './services/audit.js';
import { erp2AuthPlugin } from './plugins/auth.js';
import { erp2Routes } from './routes/index.js';
import { sanitizeForLogging } from './policies/field-masking.js';
import { erp1Resolver } from '@cs/mod-erp1';

export interface AppOptions {
  repository?: Erp2Repository;
  vendorService?: VendorService;
  purchaseOrderService?: PurchaseOrderService;
  referenceResolver?: ReferenceResolver;
  auditService?: AuditService;
  strictAuth?: boolean;
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

  const strictAuth = options.strictAuth ?? true;

  // ── Correlation ID Hook ───────────────────────────────────────────────────
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
      (request as any).correlationId ??
      (request.headers['x-correlation-id'] as string | undefined) ??
      (request.headers['x-request-id'] as string | undefined) ??
      randomUUID();

    reply.header('x-correlation-id', correlationId);

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(error.toEnvelope(correlationId));
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
    const rawMessage = err['message'];
    const errorMessage =
      typeof rawMessage === 'string' ? rawMessage : 'An unexpected error occurred';

    // Safe error masking: never leak raw SQL, table names, tokens, or credentials
    let safeMessage = errorMessage;
    if (
      /(SELECT\s|INSERT\s|UPDATE\s|DELETE\s|FROM\s|WHERE\s|password|secret|bearer\s|token)/i.test(
        errorMessage
      )
    ) {
      safeMessage = 'An unexpected internal error occurred.';
    }

    return reply.status(statusCode).send({
      code: statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR',
      message: safeMessage,
      details: [],
      correlation_id: correlationId,
    });
  });

  // ── Register Auth Plugin ───────────────────────────────────────────────────
  app.register(erp2AuthPlugin, { strictAuth });

  // ── Register Module Routes ─────────────────────────────────────────────────
  app.register(erp2Routes, {
    prefix: '/api/v1/erp-vendors',
    vendorService,
    purchaseOrderService,
  });

  return app;
}
