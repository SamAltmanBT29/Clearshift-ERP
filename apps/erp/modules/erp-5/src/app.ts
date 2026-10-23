/**
 * ERP-5 HR & Employees — Fastify Application Factory
 *
 * Configures the Fastify server instance:
 *   - a global error handler that renders the **shared** platform error
 *     envelope `{code, message, details, correlation_id}`
 *   - `x-correlation-id` propagation
 *   - a bearer-token authentication hook that populates `request.user.roles`
 *   - route registration under the module prefix `/api/v1/erp-hr`
 *   - dependency injection for `HrService` and `HrRepository`
 *
 * Status mapping (issue #48):
 *   400 malformed request · 401 unauthenticated · 403 forbidden ·
 *   404 missing record · 409 duplicate / idempotency conflict ·
 *   422 invalid business value · 500 unexpected (sanitised)
 *
 * @module erp5/app
 */

import { randomUUID } from 'node:crypto';
import fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { AppError } from '@cs/kernel';
import {
  HR_DOMAIN_RULES,
  HR_PROTECTED_FIELD_NAMES,
  HR_UNPROCESSABLE_CODES,
  StandardErrorCodes,
} from '@clearshift/contracts';
import { authenticateHrToken } from './auth/authenticate.js';
import { HrDomainError } from './domain/rules.js';
import { HrServiceError, type HrErrorDetail } from './services/errors.js';
import { HrService } from './services/hr.service.js';
import { InMemoryHrRepository } from './services/in-memory.repository.js';
import { AuditService, InMemoryAuditRepository } from '@cs/core';
import type { HrRepository } from './services/repository.js';
import { erpHrRoutes } from './routes/index.js';
import type { HrFastifyInstance } from './routes/types.js';

export interface HrAppOptions {
  repository?: HrRepository | undefined;
  hrService?: HrService | undefined;
  /** When true (the default) a request without a bearer token is rejected. */
  authRequired?: boolean | undefined;
  /** Resolves whether an account is disabled (the platform owns the state). */
  isUserDisabled?: ((userId: string) => boolean | Promise<boolean>) | undefined;
}

/**
 * The shared error envelope — owned by the platform (PLT-04:
 * `packages/contracts/src/common.ts` → `FlatErrorEnvelopeSchema`). It is never
 * redefined per module.
 */
export interface HrErrorEnvelope {
  code: string;
  message: string;
  details: HrErrorDetail[];
  correlation_id: string;
}

/** Structural shape of a Zod issue — the module does not import `zod`. */
interface ZodIssueLike {
  code: string;
  message: string;
  path: (string | number)[];
  keys?: string[];
  params?: Record<string, unknown>;
}

/** Structural shape of a Zod error. */
interface ZodErrorLike {
  issues: ZodIssueLike[];
}

/** Resolves the correlation id of a request (header first, generated second). */
export function resolveCorrelationId(request: FastifyRequest): string {
  const raw = request.headers['x-correlation-id'] ?? request.headers['x-request-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return randomUUID();
}

/** True when the value looks like a Zod error (Zod 3 or Zod 4). */
function isZodErrorLike(error: unknown): error is ZodErrorLike {
  return (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray((error as { issues: unknown[] }).issues)
  );
}

/**
 * Maps a Zod failure onto the shared envelope.
 *
 *   - a refinement that carries a business-rule code → `422`
 *   - an unknown key that is protected/system-maintained → `400`
 *     with `HR_PROTECTED_FIELD`
 *   - any other structural failure → `400 VALIDATION_ERROR`
 */
export function mapZodIssues(error: ZodErrorLike): {
  statusCode: number;
  code: string;
  message: string;
  details: HrErrorDetail[];
} {
  const issues = error.issues;

  const business = issues.find(
    (issue) =>
      issue.code === 'custom' &&
      typeof issue.params?.['code'] === 'string' &&
      HR_UNPROCESSABLE_CODES.includes(issue.params['code'] as string)
  );
  if (business) {
    const code = business.params?.['code'] as string;
    return {
      statusCode: 422,
      code,
      message: business.message,
      details: [
        {
          field: business.path.join('.'),
          message: business.message,
          code,
        },
      ],
    };
  }

  const unknownKeys = issues.find((issue) => issue.code === 'unrecognized_keys');
  if (unknownKeys) {
    const offending = (unknownKeys.keys ?? []).filter((key) =>
      (HR_PROTECTED_FIELD_NAMES as readonly string[]).includes(key)
    );
    if (offending.length > 0) {
      return {
        statusCode: 400,
        code: HR_DOMAIN_RULES.PROTECTED_FIELD,
        message: `The field${offending.length > 1 ? 's' : ''} ${offending
          .map((key) => `"${key}"`)
          .join(', ')} ${offending.length > 1 ? 'are' : 'is'} protected or system-maintained and cannot be written through this API.`,
        details: offending.map((key) => ({
          field: key,
          message: 'Protected or system-maintained field',
          code: HR_DOMAIN_RULES.PROTECTED_FIELD,
        })),
      };
    }
  }

  const first = issues[0];
  return {
    statusCode: 400,
    code: StandardErrorCodes.VALIDATION_ERROR,
    message: first?.message ?? 'Validation failed',
    details: issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    })),
  };
}

export function buildHrApp(options: HrAppOptions = {}): HrFastifyInstance {
  const app = fastify({ logger: false }) as unknown as HrFastifyInstance;

  const repository = options.repository ?? new InMemoryHrRepository(true);
  const auditService = new AuditService(new InMemoryAuditRepository());
  const hrService = options.hrService ?? new HrService(repository, auditService);
  const authRequired = options.authRequired ?? true;

  // ── Global Error Handler ───────────────────────────────────────────────────
  app.setErrorHandler((error: unknown, request, reply) => {
    const correlationId = resolveCorrelationId(request);
    reply.header('x-correlation-id', correlationId);

    const envelope = (statusCode: number, body: HrErrorEnvelope) =>
      reply.status(statusCode).send(body);

    // 1. Module service errors — they already carry the shared envelope shape.
    if (error instanceof HrServiceError) {
      return envelope(error.statusCode, {
        code: error.code,
        message: error.message,
        details: error.details,
        correlation_id: correlationId,
      });
    }

    // 2. A domain invariant that escaped the service layer.
    if (error instanceof HrDomainError) {
      const field =
        typeof error.context['field'] === 'string' ? error.context['field'] : undefined;
      return envelope(422, {
        code: error.code,
        message: error.message,
        details:
          field !== undefined
            ? [{ field, message: error.message, code: error.code }]
            : [{ message: error.message, code: error.code }],
        correlation_id: correlationId,
      });
    }

    // 3. Platform errors — the shared RBAC guard throws `AppError`.
    if (error instanceof AppError) {
      return envelope(error.statusCode, {
        code: error.code,
        message: error.message,
        details: error.details,
        correlation_id: correlationId,
      });
    }

    // 4. Route-boundary validation failures.
    if (isZodErrorLike(error)) {
      const mapped = mapZodIssues(error);
      return envelope(mapped.statusCode, {
        code: mapped.code,
        message: mapped.message,
        details: mapped.details,
        correlation_id: correlationId,
      });
    }

    // 5. Anything else is unexpected. The response never carries a SQL
    //    statement, a stack trace, a secret or a raw row — only a
    //    correlation id the operator can use to find the entry in the log.
    console.error(`[SERVER ERROR] ${error}`);
    return envelope(500, {
      code: StandardErrorCodes.INTERNAL_SERVER_ERROR,
      message: 'An unexpected internal error occurred.',
      details: [],
      correlation_id: correlationId,
    });
  });

  // ── Not Found Handler ──────────────────────────────────────────────────────
  // An unknown route answers with the shared envelope too, so a client never
  // has to parse two different error shapes.
  app.setNotFoundHandler((request, reply) => {
    const correlationId = resolveCorrelationId(request);
    reply.header('x-correlation-id', correlationId);

    return reply.status(404).send({
      code: StandardErrorCodes.NOT_FOUND,
      message: 'The requested resource does not exist.',
      details: [],
      correlation_id: correlationId,
    } satisfies HrErrorEnvelope);
  });

  // ── Authentication Hook ────────────────────────────────────────────────────
  // The platform (PLT-05) normally authenticates the request before the
  // module is mounted. When the module runs standalone — its own test app —
  // it verifies the Hub access token itself.
  app.addHook('onRequest', async (request, reply) => {
    const correlationId = resolveCorrelationId(request);
    reply.header('x-correlation-id', correlationId);

    if (request.user) {
      // Already authenticated by the platform — keep the verified identity.
      return;
    }

    try {
      request.user = await authenticateHrToken(request.headers.authorization, {
        authRequired,
        ...(options.isUserDisabled !== undefined && { isUserDisabled: options.isUserDisabled }),
      });
    } catch (error) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
          details: error.details,
          correlation_id: correlationId,
        } satisfies HrErrorEnvelope);
      }
      throw error;
    }
  });

  // ── Route Registration ─────────────────────────────────────────────────────
  app.resolveCorrelationId = resolveCorrelationId;
  app.register(erpHrRoutes, {
    prefix: '/api/v1/erp-hr',
    hrService,
  });

  return app;
}
