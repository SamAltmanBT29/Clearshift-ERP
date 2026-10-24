/**
 * ERP-2 Vendors & Purchasing — Route Guards & Authorization Policies
 *
 * Implements:
 *   - Route-level capability guards consuming @cs/rbac (Read, Write, Ingest, Review, Admin)
 *   - Object-level authorization guards preventing unauthorized multi-tenant
 *     or cross-user record mutations (ERP2-15 / Issue #131).
 *
 * @module erp2/routes/guard
 */

import { AppError } from '@cs/kernel';
import { Capabilities, hasCapability, requireCapability } from '@cs/rbac';
import { Roles, type HubTokenClaims } from '@cs/identity';

export const erp2ReadGuard = requireCapability(Capabilities.MODULE_READ);
export const erp2WriteGuard = requireCapability(Capabilities.MODULE_WRITE);
export const erp2AdminGuard = requireCapability(Capabilities.HUB_ADMIN);

/** Create/load writes may also be executed by the Migration Kit. */
export async function erp2IngestGuard(request: Parameters<typeof erp2WriteGuard>[0]): Promise<void> {
  if (!request.user) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
  }

  const roles = request.user.roles ?? [];
  if (
    !hasCapability(roles, Capabilities.MODULE_WRITE) &&
    !hasCapability(roles, Capabilities.KIT_RUN)
  ) {
    throw new AppError(
      'FORBIDDEN',
      "Access denied. Required capability: 'module.write' or 'kit.run'",
      403
    );
  }
}

/** Duplicate candidate human review requires kit.review, module.write, or hub.admin. */
export async function erp2ReviewGuard(request: Parameters<typeof erp2WriteGuard>[0]): Promise<void> {
  if (!request.user) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
  }

  const roles = request.user.roles ?? [];
  if (
    !hasCapability(roles, Capabilities.KIT_REVIEW) &&
    !hasCapability(roles, Capabilities.MODULE_WRITE) &&
    !hasCapability(roles, Capabilities.HUB_ADMIN)
  ) {
    throw new AppError(
      'FORBIDDEN',
      "Access denied. Required capability: 'kit.review' or 'module.write'",
      403
    );
  }
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
export const erp2EntityTenantRegistry = new Map<string, string>();
/** In-memory registry for entity creator bindings */
export const erp2EntityCreatorRegistry = new Map<string, string>();

export function registerEntityTenant(entityId: string | undefined, tenantId: string | undefined | null): void {
  if (entityId && tenantId) {
    erp2EntityTenantRegistry.set(entityId, tenantId);
  }
}

export function registerEntityCreator(entityId: string | undefined, userId: string | undefined | null): void {
  if (entityId && userId) {
    erp2EntityCreatorRegistry.set(entityId, userId);
  }
}

/**
 * Enforces multi-tenant boundary isolation.
 * Throws HTTP 403 OBJECT_ACCESS_DENIED if caller attempts cross-tenant manipulation.
 */
export function assertTenantAccess(
  user: HubTokenClaims | undefined,
  entity: TenantScopedEntity | undefined,
  requestTenantId?: string | undefined
): void {
  if (!entity) return;

  const userTenant = (user as (HubTokenClaims & { tenant_id?: string }) | undefined)?.tenant_id ?? requestTenantId;
  const entityId = entity.id;
  const entityTenant = (entityId ? erp2EntityTenantRegistry.get(entityId) : undefined) ?? entity.tenant_id;

  // If both define a tenant boundary and they disagree, deny access
  if (userTenant && entityTenant && userTenant !== entityTenant) {
    throw new AppError(
      'OBJECT_ACCESS_DENIED',
      `Cross-tenant access violation: user tenant '${userTenant}' cannot access resource belonging to tenant '${entityTenant}'.`,
      403
    );
  }
}

/**
 * Enforces object-level mutation safety for records.
 * Prevents non-admin users from mutating records belonging to another tenant or created by another user.
 */
export function assertObjectMutationAccess(
  user: HubTokenClaims | undefined,
  entry: UserScopedEntity | undefined,
  requestTenantId?: string | undefined
): void {
  if (!user) {
    throw new AppError('UNAUTHORIZED', 'Authentication required.', 401);
  }

  // 1. Enforce tenant boundary first
  assertTenantAccess(user, entry, requestTenantId);

  if (!entry) return;

  const roles = user.roles ?? [];
  const isAdmin = roles.includes(Roles.ADMIN);

  // Administrators can manage records across users within their tenant
  if (isAdmin) {
    return;
  }

  const entityId = entry.id;
  const creatorId =
    (entityId ? erp2EntityCreatorRegistry.get(entityId) : undefined) ??
    entry.created_by ??
    entry.created_by_user_id;
  const userId = user.sub;

  if (creatorId && userId && creatorId !== userId) {
    throw new AppError(
      'CROSS_USER_MUTATION_FORBIDDEN',
      `Access denied: record was created by '${creatorId}'. Non-admin user '${userId}' cannot modify another user's record.`,
      403
    );
  }
}
