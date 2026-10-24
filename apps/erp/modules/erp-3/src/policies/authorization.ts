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
