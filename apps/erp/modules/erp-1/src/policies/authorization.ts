/**
 * ERP-1 Products & Inventory — Authorization Policies
 *
 * Implements:
 *   - SDS endpoint permission matrix enforcement across standard Hub roles:
 *     Viewer, Editor, Migration Runner, Analyst, Admin.
 *   - Route-level pre-handlers backed by @cs/core fixed RBAC matrix.
 *   - Security audit recording on authorization denial.
 *
 * @module erp1/policies/authorization
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { Actions, Resources, hasPermission } from '@cs/core';
import type { ActionType, ResourceType, RoleType } from '@clearshift/contracts';
import { AppError } from '@cs/kernel';
import type { Erp1AuditService } from '../services/audit.js';

export const Erp1Policies = {
  PRODUCTS_READ: { action: Actions.READ, resource: Resources.ERP1_PRODUCTS },
  PRODUCTS_CREATE: { action: Actions.CREATE, resource: Resources.ERP1_PRODUCTS },
  PRODUCTS_UPDATE: { action: Actions.UPDATE, resource: Resources.ERP1_PRODUCTS },
  CATEGORIES_READ: { action: Actions.READ, resource: Resources.ERP1_CATEGORIES },
  CATEGORIES_CREATE: { action: Actions.CREATE, resource: Resources.ERP1_CATEGORIES },
  CATEGORIES_UPDATE: { action: Actions.UPDATE, resource: Resources.ERP1_CATEGORIES },
  STOCK_READ: { action: Actions.READ, resource: Resources.ERP1_STOCK_LEVELS },
  STOCK_CREATE: { action: Actions.CREATE, resource: Resources.ERP1_STOCK_LEVELS },
  IMPORT_EXECUTE: { action: Actions.EXECUTE_BULK, resource: Resources.ERP1_IMPORTS },
  DUPLICATES_READ: { action: Actions.READ, resource: Resources.ERP1_DUPLICATES },
  DUPLICATES_REVIEW: { action: Actions.APPROVE_MERGE, resource: Resources.ERP1_DUPLICATES },
} as const satisfies Record<string, { action: ActionType; resource: ResourceType }>;

export type Erp1Policy = keyof typeof Erp1Policies;

export function isErp1PolicyAllowed(
  roles: readonly RoleType[] | undefined,
  policy: Erp1Policy
): boolean {
  const definition = Erp1Policies[policy];
  return hasPermission(
    roles ? [...roles] : [],
    definition.action,
    definition.resource
  );
}

function resolveCorrelationId(request: FastifyRequest): string {
  const header = request.headers['x-correlation-id'] ?? request.headers['x-request-id'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return request.id;
}

export function requireErp1Policy(
  policy: Erp1Policy,
  auditService?: Erp1AuditService
) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!user) {
      throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    }

    if (!isErp1PolicyAllowed(user.roles, policy)) {
      if (auditService) {
        await auditService.record({
          actor: user.sub,
          actorRole: user.roles?.[0],
          action: 'auth.failed',
          targetEntity: 'erp1_api',
          correlationId: resolveCorrelationId(request),
          result: 'failure',
          reason: 'authorization_denied',
          metadata: {
            method: request.method,
            route: request.routeOptions?.url ?? request.url ?? 'unknown',
            policy,
          },
        });
      }

      throw new AppError('FORBIDDEN', `Access denied. Policy '${policy}' requires appropriate role.`, 403);
    }
  };
}
