import { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "@cs/kernel";
import { CapabilityType, hasCapability } from "./matrix.js";

/**
 * Creates a route guard verifying the user possesses the required capability.
 */
export function requireCapability(capability: CapabilityType) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user) {
      throw new AppError("UNAUTHORIZED", "Authentication required", 401);
    }

    if (!hasCapability(request.user.roles, capability)) {
      throw new AppError(
        "FORBIDDEN",
        `Access denied. Required capability: '${capability}'`,
        403
      );
    }
  };
}
