/**
 * ERP-5 HR & Employees — Leave Routes
 *
 * GET   /leave      - List leave records with bounded paging and filters
 * GET   /leave/{id} - Read a single leave record
 * POST  /leave      - Create a leave record
 * PATCH /leave/{id} - Edit a leave record and apply the V1 state transition
 *
 * V1 records the leave status only. The request → approve/reject **workflow
 * with a log** is FR-ERP5-10 and stays in V2 (decision record DR-10).
 *
 * @module erp5/routes/leave
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  CreateHrLeaveRequestSchema,
  HrIdParamSchema,
  HrLeaveListQuerySchema,
  UpdateHrLeaveRequestSchema,
} from '@clearshift/contracts';
import type { HrService } from '../services/hr.service.js';
import { leaveCreateGuard, leaveReadGuard, leaveUpdateGuard } from './guard.js';
import { parseWriteBody } from './parsing.js';
import type { HrRouteOptions } from './types.js';

export const leaveRoutes: FastifyPluginAsync<HrRouteOptions> = async (fastify, opts) => {
  const { hrService } = opts;

  // GET /leave - List leave records
  fastify.get(
    '/leave',
    { preHandler: leaveReadGuard },
    async (request, reply) => {
      const query = HrLeaveListQuerySchema.parse(request.query);
      const response = await hrService.listLeave(query);

      return reply.status(200).send(response);
    }
  );

  // GET /leave/:id - Read a single leave record
  fastify.get(
    '/leave/:id',
    { preHandler: leaveReadGuard },
    async (request, reply) => {
      const params = HrIdParamSchema.parse(request.params);
      const record = await hrService.getLeaveById(params.id);

      return reply.status(200).send(record);
    }
  );

  // POST /leave - Create a leave record
  fastify.post('/leave', { preHandler: leaveCreateGuard }, async (request, reply) => {
    const body = parseWriteBody(CreateHrLeaveRequestSchema, request);
    const result = await hrService.createLeave(body);

    return reply.status(result.created ? 201 : 200).send({
      ...result.entity,
      ...(result.receipt !== undefined && { import_receipt: result.receipt }),
      ...(result.warnings !== undefined && { warnings: result.warnings }),
    });
  });

  // PATCH /leave/{id} - Edit a leave record / apply the state transition
  fastify.patch('/leave/:id', { preHandler: leaveUpdateGuard }, async (request, reply) => {
    const params = HrIdParamSchema.parse(request.params);
    const body = UpdateHrLeaveRequestSchema.parse(request.body ?? {});
    const record = await hrService.updateLeave(params.id, body);

    return reply.status(200).send(record);
  });
};
