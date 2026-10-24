import React from 'react';
import { Actions, Resources, RoleSchema, type ActionType, type ResourceType } from '@clearshift/contracts';
import { hasPermission } from '@cs/core';
import { getSession } from './session.js';
import { ForbiddenView } from '../components/StateViews.js';

export const Erp3UiPermissions = {
  SALES_ORDERS_READ: { action: Actions.READ, resource: Resources.ERP3_SALES_ORDERS },
  SALES_ORDERS_CREATE: { action: Actions.CREATE, resource: Resources.ERP3_SALES_ORDERS },
  SALES_ORDERS_UPDATE: { action: Actions.UPDATE, resource: Resources.ERP3_SALES_ORDERS },
  INVOICES_READ: { action: Actions.READ, resource: Resources.ERP3_INVOICES },
  INVOICES_CREATE: { action: Actions.CREATE, resource: Resources.ERP3_INVOICES },
  PAYMENTS_READ: { action: Actions.READ, resource: Resources.ERP3_PAYMENTS },
} as const satisfies Record<string, { action: ActionType; resource: ResourceType }>;

export type Erp3UiPermission = keyof typeof Erp3UiPermissions;

export function canAccessErp3Ui(permission: Erp3UiPermission, roles: readonly string[]): boolean {
  const parsedRoles = RoleSchema.array().safeParse(roles);
  if (!parsedRoles.success) return false;
  const definition = Erp3UiPermissions[permission];
  return hasPermission([...parsedRoles.data], definition.action, definition.resource);
}

export const RequireErp3Permission: React.FC<{
  permission: Erp3UiPermission;
  children: React.ReactNode;
}> = ({ permission, children }) => {
  const session = getSession();
  return session && canAccessErp3Ui(permission, session.roles)
    ? <>{children}</>
    : <ForbiddenView message="Your Hub role does not allow this ERP-3 action." />;
};
