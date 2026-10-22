import { FastifyRequest, FastifyReply } from "fastify";
import { AppError } from "@cs/kernel";
import { Roles, RoleType, ActionType, ResourceType, hasPermission } from "@cs/core";

export interface RoutePolicyDefinition {
  routeId: string;
  isPublic?: boolean;
  allowedRoles: RoleType[];
  resource?: ResourceType;
  action?: ActionType;
  description: string;
}

/**
 * Standard Central Route Groups and Permissions Matrix (PLT-06)
 * Non-Negotiable Invariant: DEFAULT DENY.
 */
export const ROUTE_POLICIES: Record<string, RoutePolicyDefinition> = {
  // Public Hub Endpoints
  "hub.jwks": {
    routeId: "hub.jwks",
    isPublic: true,
    allowedRoles: [],
    description: "Public JWKS key discovery endpoint"
  },
  "hub.login": {
    routeId: "hub.login",
    isPublic: true,
    allowedRoles: [],
    description: "Hub account login endpoint"
  },

  // Authenticated Hub Endpoints
  "hub.logout": {
    routeId: "hub.logout",
    allowedRoles: [Roles.VIEWER, Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ANALYST, Roles.ADMIN],
    description: "Hub logout and session revocation"
  },
  "hub.refresh": {
    routeId: "hub.refresh",
    allowedRoles: [Roles.VIEWER, Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ANALYST, Roles.ADMIN],
    description: "Session token refresh with anti-CSRF check"
  },
  "hub.me": {
    routeId: "hub.me",
    allowedRoles: [Roles.VIEWER, Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ANALYST, Roles.ADMIN],
    description: "Current user claims and profile"
  },
  "hub.rotate_keys": {
    routeId: "hub.rotate_keys",
    allowedRoles: [Roles.ADMIN],
    description: "Admin signing key rotation trigger"
  },

  // Finance & Accounting (ERP-4)
  "finance.read": {
    routeId: "finance.read",
    allowedRoles: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN],
    description: "Read accounts, journal entries, trial balance"
  },
  "finance.mutate": {
    routeId: "finance.mutate",
    allowedRoles: [Roles.EDITOR, Roles.ADMIN],
    description: "Create/edit accounts and journal entries"
  },
  "finance.bulk_opening_balances": {
    routeId: "finance.bulk_opening_balances",
    allowedRoles: [Roles.MIGRATION_RUNNER, Roles.ADMIN],
    description: "Bulk load opening balances (Migration Runner only)"
  },

  // Human Resources (ERP-5)
  "hr.read": {
    routeId: "hr.read",
    allowedRoles: [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN],
    description: "Read employee records (salaries masked for non-admin)"
  },
  "hr.mutate": {
    routeId: "hr.mutate",
    allowedRoles: [Roles.EDITOR, Roles.ADMIN],
    description: "Create and update employee records"
  },
  "hr.payroll_bulk": {
    routeId: "hr.payroll_bulk",
    allowedRoles: [Roles.MIGRATION_RUNNER, Roles.ADMIN],
    description: "Bulk load payroll totals"
  },

  // Migration Kit
  "migration.read": {
    routeId: "migration.read",
    allowedRoles: [Roles.VIEWER, Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ANALYST, Roles.ADMIN],
    description: "View batches and profile reports"
  },
  "migration.execute": {
    routeId: "migration.execute",
    allowedRoles: [Roles.MIGRATION_RUNNER, Roles.ADMIN],
    description: "Execute migration batches and dry-runs"
  },
  "migration.approve_merge": {
    routeId: "migration.approve_merge",
    allowedRoles: [Roles.ADMIN],
    description: "Approve merge/skip decisions (Migration Runner CANNOT approve its own merges)"
  },

  // Control Center & Audit
  "control_center.read": {
    routeId: "control_center.read",
    allowedRoles: [Roles.VIEWER, Roles.ANALYST, Roles.ADMIN],
    description: "View quality metrics, reconciliations, and audit logs"
  }
};

/**
 * Checks whether user roles satisfy a given route policy.
 * Non-negotiable invariant: DEFAULT DENY.
 */
export function isRouteAllowed(roles: RoleType[] | undefined, policyId: string): boolean {
  const policy = ROUTE_POLICIES[policyId];
  if (!policy) {
    // Unrecognized route: DEFAULT DENY
    return false;
  }

  if (policy.isPublic) {
    return true;
  }

  if (!roles || roles.length === 0) {
    return false;
  }

  return policy.allowedRoles.some((allowedRole) => roles.includes(allowedRole));
}

/**
 * Reusable Fastify route preHandler guard.
 * Returns 403 FORBIDDEN with standard error envelope when denied.
 */
export function requireRoutePolicy(policyId: string) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const policy = ROUTE_POLICIES[policyId];
    if (!policy) {
      throw new AppError("FORBIDDEN", `Access denied: unknown route policy '${policyId}' (Default Deny)`, 403);
    }

    if (policy.isPublic) {
      return;
    }

    const user = request.user;
    if (!user) {
      throw new AppError("UNAUTHORIZED", "Authentication required to access this resource", 401);
    }

    if (!isRouteAllowed(user.roles, policyId)) {
      throw new AppError(
        "FORBIDDEN",
        `Access denied: your role(s) [${user.roles.join(", ")}] cannot access route '${policyId}'. Allowed roles: [${policy.allowedRoles.join(", ")}]`,
        403
      );
    }
  };
}

/**
 * Fine-grained resource/action preHandler guard.
 */
export function requireActionPermission(action: ActionType, resource: ResourceType) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = request.user;
    if (!user) {
      throw new AppError("UNAUTHORIZED", "Authentication required", 401);
    }

    if (!hasPermission(user.roles, action, resource)) {
      throw new AppError(
        "FORBIDDEN",
        `Access denied: action '${action}' on resource '${resource}' is forbidden for roles [${user.roles.join(", ")}]`,
        403
      );
    }
  };
}
