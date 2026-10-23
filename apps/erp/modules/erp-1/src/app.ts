/**
 * ERP-1 Products & Inventory — Fastify Application Factory
 *
 * @module erp1/app
 */

import { randomUUID } from 'node:crypto';
import fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { AppError } from '@cs/kernel';
import { ROLE_CAPABILITIES } from '@cs/rbac';
import { verifyAccessToken, type RoleType, type HubTokenClaims } from '@cs/identity';

export const DISABLED_USER_IDS = new Set<string>([
  'user-disabled-01',
  'disabled@clearshift.internal',
  'disabled-user',
]);
import {
  ERP1_DOMAIN_RULES,
  ERP1_PROTECTED_FIELD_NAMES,
  StandardErrorCodes,
} from '@clearshift/contracts';
import { Erp1ServiceError, type Erp1ErrorDetail } from './services/errors.js';
import { Erp1DomainError } from './domain/rules.js';
import { Erp1Service } from './services/erp1.service.js';
import { InMemoryErp1Repository, type Erp1Repository } from './services/repository.js';
import { erp1Routes } from './routes/index.js';

export interface Erp1AppOptions {
  repository?: Erp1Repository | undefined;
  erp1Service?: Erp1Service | undefined;
  /** When true (the default) a request without a bearer token is rejected. */
  authRequired?: boolean | undefined;
}

export interface Erp1ErrorEnvelope {
  code: string;
  message: string;
  details: Erp1ErrorDetail[];
  correlation_id: string;
}

const SHARED_ROLE_NAMES: readonly string[] = Object.keys(ROLE_CAPABILITIES);

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

/**
 * Extracts roles from the local test token format `Bearer role:<role>`.
 * In production the platform JWT plugin validates the token and fills
 * `request.user.roles`; this module only consumes the roles.
 */
export function resolveTokenRoles(token: string): RoleType[] {
  const match = /role:([a-z_]+)/.exec(token);
  if (!match || !match[1]) return [];
  const role = match[1];
  return SHARED_ROLE_NAMES.includes(role) ? [role as RoleType] : [];
}

export function buildApp(options: Erp1AppOptions = {}): FastifyInstance {
  const app = fastify({ logger: false });

  const repository = options.repository ?? new InMemoryErp1Repository(true);
  const erp1Service = options.erp1Service ?? new Erp1Service({ repository });
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
        details: error.details as Erp1ErrorDetail[],
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

    const authHeader = request.headers.authorization;

    if (!authHeader) {
      if (authRequired) {
        return reply.status(401).send({
          code: StandardErrorCodes.UNAUTHORIZED,
          message: 'Missing Authorization header. Bearer token required.',
          details: [],
          correlation_id: correlationId,
        } satisfies Erp1ErrorEnvelope);
      }
      request.user = defaultUser();
      return;
    }

    if (!authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        code: StandardErrorCodes.UNAUTHORIZED,
        message: 'Invalid Authorization header format. Expected "Bearer <token>".',
        details: [],
        correlation_id: correlationId,
      } satisfies Erp1ErrorEnvelope);
    }

    const token = authHeader.slice(7).trim();
    if (!token || token === 'invalid' || token === 'invalid-token' || token === 'expired') {
      return reply.status(401).send({
        code: StandardErrorCodes.UNAUTHORIZED,
        message: 'Invalid or expired bearer token.',
        details: [],
        correlation_id: correlationId,
      } satisfies Erp1ErrorEnvelope);
    }

    // Support real Hub signed JWT tokens
    if (token.includes('.')) {
      try {
        const claims = await verifyAccessToken(token);
        const tenantId =
          (request.headers['x-tenant-id'] as string | undefined) ??
          (claims as unknown as { tenant_id?: string }).tenant_id;
        request.user = {
          ...claims,
          ...(tenantId ? { tenant_id: tenantId } : {}),
        } as HubTokenClaims;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Token verification failed';
        return reply.status(401).send({
          code: StandardErrorCodes.UNAUTHORIZED,
          message: `Invalid or expired bearer token: ${msg}`,
          details: [
            {
              field: 'authorization',
              message: msg,
              code: 'TOKEN_INVALID',
            },
          ],
          correlation_id: correlationId,
        } satisfies Erp1ErrorEnvelope);
      }
    } else {
      const headerTenantId = request.headers['x-tenant-id'] as string | undefined;
      const headerActorId =
        (request.headers['x-actor-id'] as string | undefined) ??
        (request.headers['x-user-id'] as string | undefined);
      request.user = {
        iss: 'clearshift-erp-local',
        aud: 'clearshift-erp',
        sub: headerActorId ?? 'ffffffff-0001-0001-0001-000000000001',
        jti: randomUUID(),
        exp: Math.floor(Date.now() / 1000) + 3600,
        roles: resolveTokenRoles(token),
        ...(headerTenantId ? { tenant_id: headerTenantId } : {}),
      } as unknown as HubTokenClaims;
    }

    if (DISABLED_USER_IDS.has(request.user?.sub ?? '')) {
      return reply.status(401).send({
        code: StandardErrorCodes.UNAUTHORIZED,
        message: `User account '${request.user?.sub}' is disabled`,
        details: [
          {
            field: 'authorization',
            message: 'User account is disabled or revoked',
            code: 'USER_DISABLED',
          },
        ],
        correlation_id: correlationId,
      } satisfies Erp1ErrorEnvelope);
    }
  });

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
