/**
 * ERP-2 Vendors & Purchasing — Authorization & RBAC Policies (PLT-06 / ERP2-15)
 *
 * Implements:
 *   - Route-level capability guards consuming @cs/rbac (Read, Write, Ingest, Review, Admin)
 *   - Object-level authorization guards preventing unauthorized multi-tenant
 *     or cross-user record mutations (ERP2-15 / Issue #131).
 *
 * Policy Invariant: DEFAULT DENY.
 *
 * @module erp2/policies/rbac
 */

import { AppError } from '@cs/kernel';
import { Capabilities, hasCapability, requireCapability } from '@cs/rbac';
import { Roles, type RoleType, type HubTokenClaims } from '@cs/identity';

export const Erp2Policies = {
  // ── Vendors ─────────────────────────────────────────────────────────────
  VENDORS_READ: 'vendors.read',
  VENDORS_CREATE: 'vendors.create',
  VENDORS_UPDATE: 'vendors.update',

  // ── Purchase Orders ─────────────────────────────────────────────────────
  PURCHASE_ORDERS_READ: 'purchase_orders.read',
  PURCHASE_ORDERS_CREATE: 'purchase_orders.create',
  PURCHASE_ORDERS_UPDATE: 'purchase_orders.update',

  // ── Duplicate Candidates & Review ───────────────────────────────────────
  DUPLICATES_READ: 'duplicates.read',
  DUPLICATES_REVIEW: 'duplicates.review',

  // ── Ingestion & Migration ───────────────────────────────────────────────
  IMPORT_LOAD: 'import.load',
} as const;

export type Erp2Policy = (typeof Erp2Policies)[keyof typeof Erp2Policies];

export const ERP2_READ_ROLES: readonly RoleType[] = [
  Roles.VIEWER,
  Roles.EDITOR,
  Roles.MIGRATION_RUNNER,
  Roles.ANALYST,
  Roles.ADMIN,
];

export const ERP2_WRITE_ROLES: readonly RoleType[] = [
  Roles.EDITOR,
  Roles.ADMIN,
];

export const ERP2_INGEST_ROLES: readonly RoleType[] = [
  Roles.EDITOR,
  Roles.MIGRATION_RUNNER,
  Roles.ADMIN,
];

export const ERP2_REVIEW_ROLES: readonly RoleType[] = [
  Roles.EDITOR,
  Roles.MIGRATION_RUNNER,
  Roles.ADMIN,
];

export interface Erp2PolicyDefinition {
  policy: Erp2Policy;
  allowedRoles: readonly RoleType[];
  description: string;
}

export const ERP2_ROUTE_POLICIES: Record<Erp2Policy, Erp2PolicyDefinition> = {
  [Erp2Policies.VENDORS_READ]: {
    policy: Erp2Policies.VENDORS_READ,
    allowedRoles: ERP2_READ_ROLES,
    description: 'Read and list vendor records',
  },
  [Erp2Policies.VENDORS_CREATE]: {
    policy: Erp2Policies.VENDORS_CREATE,
    allowedRoles: ERP2_INGEST_ROLES,
    description: 'Create vendors via manual entry or migration ingest',
  },
  [Erp2Policies.VENDORS_UPDATE]: {
    policy: Erp2Policies.VENDORS_UPDATE,
    allowedRoles: ERP2_WRITE_ROLES,
    description: 'Update vendor procurement details',
  },
  [Erp2Policies.PURCHASE_ORDERS_READ]: {
    policy: Erp2Policies.PURCHASE_ORDERS_READ,
    allowedRoles: ERP2_READ_ROLES,
    description: 'Read and list purchase orders',
  },
  [Erp2Policies.PURCHASE_ORDERS_CREATE]: {
    policy: Erp2Policies.PURCHASE_ORDERS_CREATE,
    allowedRoles: ERP2_INGEST_ROLES,
    description: 'Create purchase orders via entry or migration ingest',
  },
  [Erp2Policies.PURCHASE_ORDERS_UPDATE]: {
    policy: Erp2Policies.PURCHASE_ORDERS_UPDATE,
    allowedRoles: ERP2_WRITE_ROLES,
    description: 'Update purchase order status transitions',
  },
  [Erp2Policies.DUPLICATES_READ]: {
    policy: Erp2Policies.DUPLICATES_READ,
    allowedRoles: ERP2_READ_ROLES,
    description: 'Read and inspect duplicate candidates and match results',
  },
  [Erp2Policies.DUPLICATES_REVIEW]: {
    policy: Erp2Policies.DUPLICATES_REVIEW,
    allowedRoles: ERP2_REVIEW_ROLES,
    description: 'Submit human merge decisions for duplicate candidates',
  },
  [Erp2Policies.IMPORT_LOAD]: {
    policy: Erp2Policies.IMPORT_LOAD,
    allowedRoles: ERP2_INGEST_ROLES,
    description: 'Execute batch load ingestion for vendors and purchase orders',
  },
};

export function isErp2PolicyAllowed(roles: readonly string[] | undefined, policy: Erp2Policy): boolean {
  if (!roles || roles.length === 0) return false;
  const def = ERP2_ROUTE_POLICIES[policy];
  if (!def) return false;
  return def.allowedRoles.some((r) => roles.includes(r));
}

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
