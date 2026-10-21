/**
 * ERP-2 Role-Based Access Control (RBAC) Policies
 *
 * Implements the SDS ClearShift ERP v2.0 endpoint role permissions matrix.
 *
 * @module erp2/policies/rbac
 */

import { Roles, type RoleType } from '@cs/identity';

export const ERP2_ENDPOINT_ROLES = {
  // GET /api/v1/erp-vendors/vendors
  LIST_VENDORS: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],

  // POST /api/v1/erp-vendors/vendors
  CREATE_VENDOR: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],

  // PATCH /api/v1/erp-vendors/vendors/:id
  UPDATE_VENDOR: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],

  // GET /api/v1/erp-vendors/purchase-orders
  LIST_PURCHASE_ORDERS: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],

  // GET /api/v1/erp-vendors/purchase-orders/:id
  GET_PURCHASE_ORDER: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN] as RoleType[],

  // POST /api/v1/erp-vendors/purchase-orders
  CREATE_PURCHASE_ORDER: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],

  // PATCH /api/v1/erp-vendors/purchase-orders/:id
  UPDATE_PURCHASE_ORDER_STATUS: [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN] as RoleType[],
} as const;

export function isRoleAllowed(userRoles: string[], allowedRoles: readonly string[]): boolean {
  if (!userRoles || userRoles.length === 0) {
    return false;
  }
  // Admin always has universal access across all endpoints
  if (userRoles.includes(Roles.ADMIN)) {
    return true;
  }

  return userRoles.some((r) => allowedRoles.includes(r as RoleType));
}
