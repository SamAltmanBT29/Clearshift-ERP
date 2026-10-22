/**
 * ERP-5 HR & Employees — Department Routes
 *
 * POST  /departments      - Create a department
 * PATCH /departments/{id} - Edit a department
 *
 * The list/read endpoints belong to **ERP5-02** (issue #47) and are
 * deliberately not implemented here.
 *
 * @module erp5/routes/departments
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  CreateHrDepartmentRequestSchema,
  HrIdParamSchema,
  UpdateHrDepartmentRequestSchema,
} from '@clearshift/contracts';
import { hrWriteGuard } from './guard.js';
import { parseWriteBody } from './parsing.js';
import type { HrRouteOptions } from './types.js';

export const departmentsRoutes: FastifyPluginAsync<HrRouteOptions> = async (fastify, opts) => {
  const { hrService } = opts;

  // POST /departments - Create a department
  fastify.post('/departments', { preHandler: hrWriteGuard }, async (request, reply) => {
    const body = parseWriteBody(CreateHrDepartmentRequestSchema, request);
    const result = await hrService.createDepartment(body);

    return reply.status(result.created ? 201 : 200).send({
      ...result.entity,
      ...(result.receipt !== undefined && { import_receipt: result.receipt }),
      ...(result.warnings !== undefined && { warnings: result.warnings }),
    });
  });

  // PATCH /departments/{id} - Edit a department
  fastify.patch('/departments/:id', { preHandler: hrWriteGuard }, async (request, reply) => {
    const params = HrIdParamSchema.parse(request.params);
    const body = UpdateHrDepartmentRequestSchema.parse(request.body ?? {});
    const department = await hrService.updateDepartment(params.id, body);

    return reply.status(200).send(department);
  });
};
