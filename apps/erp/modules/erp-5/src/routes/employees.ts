/**
 * ERP-5 HR & Employees — Employee Routes
 *
 * POST  /employees      - Create an employee
 * PATCH /employees/{id} - Edit an employee
 *
 * The list/read endpoints belong to **ERP5-02** (issue #47) and are
 * deliberately not implemented here.
 *
 * @module erp5/routes/employees
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  CreateHrEmployeeRequestSchema,
  HrIdParamSchema,
  UpdateHrEmployeeRequestSchema,
} from '@clearshift/contracts';
import { hrWriteGuard } from './guard.js';
import { parseWriteBody } from './parsing.js';
import type { HrRouteOptions } from './types.js';

export const employeesRoutes: FastifyPluginAsync<HrRouteOptions> = async (fastify, opts) => {
  const { hrService } = opts;

  // POST /employees - Create an employee
  fastify.post('/employees', { preHandler: hrWriteGuard }, async (request, reply) => {
    const body = parseWriteBody(CreateHrEmployeeRequestSchema, request);
    const result = await hrService.createEmployee(body);

    return reply.status(result.created ? 201 : 200).send({
      ...result.entity,
      ...(result.receipt !== undefined && { import_receipt: result.receipt }),
      ...(result.warnings !== undefined && { warnings: result.warnings }),
    });
  });

  // PATCH /employees/{id} - Edit an employee
  fastify.patch('/employees/:id', { preHandler: hrWriteGuard }, async (request, reply) => {
    const params = HrIdParamSchema.parse(request.params);
    const body = UpdateHrEmployeeRequestSchema.parse(request.body ?? {});
    const employee = await hrService.updateEmployee(params.id, body);

    return reply.status(200).send(employee);
  });
};
