/**
 * ERP-1 Products & Inventory — Fastify Application Factory
 *
 * @module erp1/app
 */

import { randomUUID } from 'node:crypto';
import fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { AppError } from '@cs/kernel';
import {
  ERP1_DOMAIN_RULES,
  ERP1_PROTECTED_FIELD_NAMES,
  StandardErrorCodes,
  type RoleType,
} from '@clearshift/contracts';
import { Erp1ServiceError, type Erp1ErrorDetail } from './services/errors.js';
import { Erp1DomainError } from './domain/rules.js';
import { Erp1Service } from './services/erp1.service.js';
import { InMemoryErp1Repository, type Erp1Repository } from './services/repository.js';
import { erp1Routes } from './routes/index.js';
import { Erp1AuditService } from './services/audit.js';
import { erp1AuthPlugin, DISABLED_USER_IDS, resolveTokenRoles } from './plugins/auth.js';
import { erp1FieldMaskingPlugin } from './policies/field-masking.js';

export { DISABLED_USER_IDS, resolveTokenRoles };

export interface Erp1AppOptions {
  repository?: Erp1Repository | undefined;
  erp1Service?: Erp1Service | undefined;
  auditService?: Erp1AuditService | undefined;
  /** When true (the default) a request without a bearer token is rejected. */
  authRequired?: boolean | undefined;
  isUserDisabled?: ((userId: string) => boolean | Promise<boolean>) | undefined;
}

export interface Erp1ErrorEnvelope {
  code: string;
  message: string;
  details: Erp1ErrorDetail[];
  correlation_id: string;
}


interface ZodIssueLike {
  code: string;
  message: string;
  path: (string | number)[];
  keys?: string[];
  params?: Record<string, unknown>;
}

interface ZodErrorLike {
  issues: ZodIssueLike[];
}

export function resolveCorrelationId(request: FastifyRequest): string {
  const raw = request.headers['x-correlation-id'] ?? request.headers['x-request-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return randomUUID();
}

function isZodErrorLike(error: unknown): error is ZodErrorLike {
  return (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray((error as { issues: unknown[] }).issues)
  );
}

export function mapZodIssues(error: ZodErrorLike): {
  statusCode: number;
  code: string;
  message: string;
  details: Erp1ErrorDetail[];
} {
  const issues = error.issues;

  const negativeStock = issues.find((issue) =>
    issue.message.includes('Stock quantity cannot become negative')
  );
  if (negativeStock) {
    return {
      statusCode: 422,
      code: ERP1_DOMAIN_RULES.NEGATIVE_STOCK,
      message: negativeStock.message,
      details: [
        {
          field: negativeStock.path.join('.'),
          message: negativeStock.message,
          code: ERP1_DOMAIN_RULES.NEGATIVE_STOCK,
        },
      ],
    };
  }

  const unknownKeys = issues.find((issue) => issue.code === 'unrecognized_keys');
  if (unknownKeys) {
    const protectedKeys = (unknownKeys.keys ?? []).filter((key) =>
      (ERP1_PROTECTED_FIELD_NAMES as readonly string[]).includes(key)
    );
    if (protectedKeys.length > 0) {
      return {
        statusCode: 400,
        code: ERP1_DOMAIN_RULES.PROTECTED_FIELD,
        message: `The field${protectedKeys.length > 1 ? 's' : ''} ${protectedKeys
          .map((key) => `"${key}"`)
          .join(', ')} ${protectedKeys.length > 1 ? 'are' : 'is'} protected or system-maintained and cannot be written through this API.`,
        details: protectedKeys.map((key) => ({
          field: key,
          message: 'Protected or system-maintained field',
          code: ERP1_DOMAIN_RULES.PROTECTED_FIELD,
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

export function buildApp(options: Erp1AppOptions = {}): FastifyInstance {
  const app = fastify({ logger: false });

  const auditService = options.auditService ?? new Erp1AuditService();
  const repository = options.repository ?? new InMemoryErp1Repository(true);
  const erp1Service = options.erp1Service ?? new Erp1Service({ repository, auditService: auditService.auditService });
  const authRequired = options.authRequired ?? true;

  app.setErrorHandler((error: unknown, request, reply) => {
    const correlationId = resolveCorrelationId(request);
    reply.header('x-correlation-id', correlationId);

    const envelope = (statusCode: number, body: Erp1ErrorEnvelope) =>
      reply.status(statusCode).send(body);

    if (error instanceof Erp1ServiceError) {
      return envelope(error.statusCode, {
        code: error.code,
        message: error.message,
        details: error.details,
        correlation_id: correlationId,
      });
    }

    if (error instanceof Erp1DomainError) {
      const isUnprocessable = [
        ERP1_DOMAIN_RULES.NEGATIVE_STOCK,
        ERP1_DOMAIN_RULES.INVALID_STATUS_TRANSITION,
        ERP1_DOMAIN_RULES.SOURCE_IDENTITY_INCOMPLETE,
        ERP1_DOMAIN_RULES.READ_MODEL_INCONSISTENT,
        ERP1_DOMAIN_RULES.CROSS_MODULE_WRITE_FORBIDDEN,
      ].includes(error.code as any);

      return envelope(isUnprocessable ? 422 : 400, {
        code: error.code,
        message: error.message,
        details: error.field
          ? [{ field: error.field, message: error.message, code: error.code }]
          : [],
        correlation_id: correlationId,
      });
    }

    if (error instanceof AppError) {
      return envelope(error.statusCode, {
        code: error.code,
        message: error.message,
        details: (error.details ?? []) as Erp1ErrorDetail[],
        correlation_id: correlationId,
      });
    }

    if (isZodErrorLike(error)) {
      const mapped = mapZodIssues(error);
      return envelope(mapped.statusCode, {
        code: mapped.code,
        message: mapped.message,
        details: mapped.details,
        correlation_id: correlationId,
      });
    }

    return envelope(500, {
      code: StandardErrorCodes.INTERNAL_SERVER_ERROR,
      message: 'An unexpected internal error occurred.',
      details: [],
      correlation_id: correlationId,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const correlationId = resolveCorrelationId(request);
    reply.header('x-correlation-id', correlationId);

    return reply.status(404).send({
      code: StandardErrorCodes.NOT_FOUND,
      message: 'The requested resource does not exist.',
      details: [],
      correlation_id: correlationId,
    } satisfies Erp1ErrorEnvelope);
  });

  app.addHook('onRequest', async (request, reply) => {
    const correlationId = resolveCorrelationId(request);
    reply.header('x-correlation-id', correlationId);
  });

  app.register(erp1AuthPlugin, {
    authRequired,
    auditService,
    isUserDisabled: options.isUserDisabled,
  });

  app.register(erp1FieldMaskingPlugin);

  app.register(erp1Routes, {
    prefix: '/api/v1/erp-products',
    erp1Service,
  });

  return app;
}

/** Alias that makes the module name explicit at the platform boundary. */
export const buildErp1App = buildApp;

function defaultUser() {
  return {
    iss: 'clearshift-erp-local',
    aud: 'clearshift-erp',
    sub: 'ffffffff-0001-0001-0001-000000000001',
    jti: randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 3600,
    roles: ['admin' as RoleType],
  };
}
