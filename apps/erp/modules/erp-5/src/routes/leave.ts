/**
 * ERP-5 HR & Employees — Leave Routes
 *
 * POST /leave - Create a leave record
 *
 * V1 records the leave status only. The request → approve/reject workflow
 * (FR-ERP5-10) is a V2 capability and is out of scope for this issue.
 *
 * The list/read endpoints belong to **ERP5-02** (issue #47) and are
 * deliberately not implemented here.
 *
 * @module erp5/routes/leave
 */

import type { FastifyPluginAsync } from 'fastify';
import { CreateHrLeaveRequestSchema } from '@clearshift/contracts';
import { hrWriteGuard } from './guard.js';
import { parseWriteBody } from './parsing.js';
import type { HrRouteOptions } from './types.js';

export const leaveRoutes: FastifyPluginAsync<HrRouteOptions> = async (fastify, opts) => {
  const { hrService } = opts;

  // POST /leave - Create a leave record
  fastify.post('/leave', { preHandler: hrWriteGuard }, async (request, reply) => {
    const body = parseWriteBody(CreateHrLeaveRequestSchema, request);
    const result = await hrService.createLeave(body);

    return reply.status(result.created ? 201 : 200).send({
      ...result.entity,
      ...(result.receipt !== undefined && { import_receipt: result.receipt }),
    });
  });
};
