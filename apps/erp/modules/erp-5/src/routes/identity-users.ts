/**
 * ERP-5 HR & Employees — Identity User Routes (read-only projection)
 *
 * GET /identity-users - List the Hub Identity users
 *
 * The projection is owned by the platform (Master Architecture Spec C3): HR
 * never stores a credential and never grants an application role. The
 * response therefore carries identity attributes only — no password, hash,
 * token or refresh-token field is ever selected or returned.
 *
 * The endpoint answers with an **empty** list when the platform has not
 * created the projection yet; it is a read of another module's projection,
 * never a write into it (Decision C7).
 *
 * @module erp5/routes/identity-users
 */

import type { FastifyPluginAsync } from 'fastify';
import { HrIdentityUserListQuerySchema } from '@clearshift/contracts';
import type { HrService } from '../services/hr.service.js';
import { identityUsersReadGuard } from './guard.js';
import type { HrRouteOptions } from './types.js';

export const identityUsersRoutes: FastifyPluginAsync<HrRouteOptions> = async (fastify, opts) => {
  const { hrService } = opts;

  // GET /identity-users - List the read-only Hub Identity projection
  fastify.get(
    '/identity-users',
    { preHandler: identityUsersReadGuard },
    async (request, reply) => {
      const query = HrIdentityUserListQuerySchema.parse(request.query);
      const response = await hrService.listIdentityUsers(query);

      return reply.status(200).send(response);
    }
  );
};
