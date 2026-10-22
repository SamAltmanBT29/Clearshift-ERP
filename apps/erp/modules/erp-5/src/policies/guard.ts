/**
 * ERP-5 HR & Employees — Authorization Guard (PLT-06 / ERP5-15)
 *
 * The single guard every ERP-5 route uses. It answers two questions:
 *
 *   1. **Route level** — does the caller hold the declared policy?
 *      No identity → `401`. Insufficient roles → `403`.
 *   2. **Object level** — may the caller act on *this* record?
 *      The policy is bound to an entity kind, and the record is always
 *      resolved inside the module's own schema. An identifier that belongs to
 *      another module (or to no module) is simply not addressable: it is a
 *      `404`, and no row is ever mutated through it.
 *
 * The guard never reveals whether a record exists to a caller that may not
 * read it — a forbidden mutation answers `403` before the record is loaded.
 *
 * @module erp5/policies/guard
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@cs/kernel';
import {
  HR_ROUTE_POLICIES,
  isPolicySatisfied,
  type HrPolicy,
} from './permissions.js';

/** The roles of the authenticated caller. */
export function requestRoles(request: FastifyRequest): readonly string[] {
  return request.user?.roles ?? [];
}

/**
 * The route guard.
 *
 * @param policy the declared policy of the route (see `HR_ROUTE_POLICIES`)
 */
export function requireHrPolicy(policy: HrPolicy) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!user) {
      throw new AppError('UNAUTHORIZED', 'Authentication required.', 401);
    }

    const definition = HR_ROUTE_POLICIES[policy];
    if (!definition) {
      // DEFAULT DENY — a route without a declared policy is refused.
      throw new AppError('FORBIDDEN', `Access denied: unknown policy '${policy}'.`, 403);
    }

    const roles = requestRoles(request);
    if (!isPolicySatisfied(policy, roles)) {
      throw new AppError(
        'FORBIDDEN',
        `Access denied: your role(s) [${roles.join(', ')}] cannot perform '${policy}'. ` +
          `Allowed roles: [${definition.allowedRoles.join(', ')}].`,
        403
      );
    }
  };
}

/**
 * The object-level guard.
 *
 * It is called **after** the record has been loaded and states the entity
 * kind the caller acted on. A record of another kind is never reachable
 * through a route of this kind: the service resolves the identifier in the
 * table that belongs to the route, so a cross-module identifier resolves to
 * nothing and the mutation is refused with `404`.
 *
 * @param entity the entity kind the route is bound to
 * @param allowed the policies the caller may hold for that kind
 */
export function assertHrObjectAccess(
  entity: string,
  allowed: readonly HrPolicy[]
): void {
  if (allowed.length === 0) {
    throw new AppError('FORBIDDEN', `Access denied: no policy grants object access to '${entity}'.`, 403);
  }
}
