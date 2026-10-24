import type { FastifyReply, FastifyRequest } from "fastify";
import { Actions, Resources, hasPermission } from "@cs/core";
import type { ActionType, ResourceType, RoleType } from "@clearshift/contracts";
import { AppError } from "@cs/kernel";
import type { Erp3AuditService } from "../services/audit.js";

export const Erp3Policies = {
  SALES_ORDERS_READ: { action: Actions.READ, resource: Resources.ERP3_SALES_ORDERS },
  SALES_ORDERS_CREATE: { action: Actions.CREATE, resource: Resources.ERP3_SALES_ORDERS },
  SALES_ORDERS_UPDATE: { action: Actions.UPDATE, resource: Resources.ERP3_SALES_ORDERS },
  INVOICES_READ: { action: Actions.READ, resource: Resources.ERP3_INVOICES },
  INVOICES_CREATE: { action: Actions.CREATE, resource: Resources.ERP3_INVOICES },
  PAYMENTS_READ: { action: Actions.READ, resource: Resources.ERP3_PAYMENTS },
  PAYMENTS_CREATE: { action: Actions.CREATE, resource: Resources.ERP3_PAYMENTS },
  IMPORT_EXECUTE: { action: Actions.EXECUTE_BULK, resource: Resources.ERP3_IMPORTS },
} as const satisfies Record<string, { action: ActionType; resource: ResourceType }>;

export type Erp3Policy = keyof typeof Erp3Policies;

export function isErp3PolicyAllowed(
  roles: readonly RoleType[] | undefined,
  policy: Erp3Policy,
): boolean {
  const definition = Erp3Policies[policy];
  return hasPermission(
    roles ? [...roles] : [],
    definition.action,
    definition.resource,
  );
}

export function requireErp3Policy(
  policy: Erp3Policy,
  auditService: Erp3AuditService,
) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!user) {
      throw new AppError("UNAUTHORIZED", "Authentication required", 401);
    }

    if (!isErp3PolicyAllowed(user.roles, policy)) {
      const correlationHeader = request.headers["x-correlation-id"];
      await auditService.record({
        actor: user.sub,
        actorRole: user.roles[0],
        action: "auth.failed",
        targetEntity: "erp3_api",
        correlationId:
          typeof correlationHeader === "string" && correlationHeader.trim()
            ? correlationHeader.trim()
            : request.id,
        result: "failure",
        reason: "authorization_denied",
        metadata: {
          method: request.method,
          route: request.routeOptions.url ?? "unknown",
          policy,
        },
      });
      throw new AppError("FORBIDDEN", "Access denied", 403);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Object-Level Authorization Guards (Multi-tenant & Cross-User)
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantScopedEntity {
  tenant_id?: string | null | undefined;
  id?: string | undefined;
  [key: string]: unknown;
}

export interface UserScopedEntity extends TenantScopedEntity {
  created_by?: string | null | undefined;
  created_by_user_id?: string | null | undefined;
}

/** In-memory registry for entity tenant bindings */
export const erp3EntityTenantRegistry = new Map<string, string>();
/** In-memory registry for entity creator bindings */
export const erp3EntityCreatorRegistry = new Map<string, string>();

export function registerEntityTenant(
  entityId: string | undefined,
  tenantId: string | undefined | null,
): void {
  if (entityId && tenantId) {
    erp3EntityTenantRegistry.set(entityId, tenantId);
  }
}

export function registerEntityCreator(
  entityId: string | undefined,
  userId: string | undefined | null,
): void {
  if (entityId && userId) {
    erp3EntityCreatorRegistry.set(entityId, userId);
  }
}

/**
 * Enforces multi-tenant boundary isolation.
 * Throws HTTP 403 OBJECT_ACCESS_DENIED if caller attempts cross-tenant manipulation.
 */
export function assertTenantAccess(
  user: { sub: string; roles: readonly string[]; tenant_id?: string } | undefined,
  entity: TenantScopedEntity | undefined,
  requestTenantId?: string | undefined,
): void {
  if (!entity) return;

  const userTenant = user?.tenant_id ?? requestTenantId;
  const entityId = entity.id;
  const entityTenant =
    (entityId ? erp3EntityTenantRegistry.get(entityId) : undefined) ??
    entity.tenant_id;

  // If both define a tenant boundary and they disagree, deny access
  if (userTenant && entityTenant && userTenant !== entityTenant) {
    throw new AppError(
      "OBJECT_ACCESS_DENIED",
      `Cross-tenant access violation: user tenant '${userTenant}' cannot access resource belonging to tenant '${entityTenant}'.`,
      403,
    );
  }
}

/**
 * Enforces object-level mutation safety for records.
 * Prevents non-admin users from mutating records belonging to another tenant or created by another user.
 */
export function assertObjectMutationAccess(
  user: { sub: string; roles: readonly string[]; tenant_id?: string } | undefined,
  entry: UserScopedEntity | undefined,
  requestTenantId?: string | undefined,
): void {
  if (!user) {
    throw new AppError("UNAUTHORIZED", "Authentication required.", 401);
  }

  // 1. Enforce tenant boundary first
  assertTenantAccess(user, entry, requestTenantId);

  if (!entry) return;

  const roles = user.roles ?? [];
  const isAdmin = roles.includes("admin");

  // Administrators can manage records across users within their tenant
  if (isAdmin) {
    return;
  }

  const entityId = entry.id;
  const creatorId =
    (entityId ? erp3EntityCreatorRegistry.get(entityId) : undefined) ??
    entry.created_by ??
    entry.created_by_user_id;
  const userId = user.sub;

  if (creatorId && userId && creatorId !== userId) {
    throw new AppError(
      "CROSS_USER_MUTATION_FORBIDDEN",
      `Access denied: record was created by '${creatorId}'. Non-admin user '${userId}' cannot modify another user's record.`,
      403,
    );
  }
}

