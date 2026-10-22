/**
 * ERP-5 HR & Employees — Leave Routes
 *
 * POST  /leave      - Create a leave record
 * PATCH /leave/{id} - Edit a leave record and apply the V1 state transition
 *
 * V1 records the leave status only. The request → approve/reject **workflow
 * with a log** is FR-ERP5-10 and stays in V2 (decision record DR-10).
 *
 * The list/read endpoints belong to **ERP5-02** (issue #47) and are
 * deliberately not implemented here.
 *
 * @module erp5/routes/leave
 */

import type { FastifyPluginAsync } from 'fastify';
import { CreateHrLeaveRequestSchema, HrIdParamSchema, UpdateHrLeaveRequestSchema } from '@clearshift/contracts';
import type { HrService } from '../services/hr.service.js';
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
      ...(result.warnings !== undefined && { warnings: result.warnings }),
    });
  });

  // PATCH /leave/{id} - Edit a leave record / apply the state transition
  fastify.patch('/leave/:id', { preHandler: hrWriteGuard }, async (request, reply) => {
    const params = HrIdParamSchema.parse(request.params);
    const body = UpdateHrLeaveRequestSchema.parse(request.body ?? {});
    const record = await hrService.updateLeave(params.id, body);

    return reply.status(200).send(record);
  });
};
