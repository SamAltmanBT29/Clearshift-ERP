/**
 * ERP-5 HR & Employees — Department Routes
 *
 * GET   /departments      - List departments with bounded paging and search
 * GET   /departments/{id} - Read a single department
 * POST  /departments      - Create a department
 * PATCH /departments/{id} - Edit a department
 *
 * @module erp5/routes/departments
 */

import type { FastifyPluginAsync } from 'fastify';
import { Capabilities, requireCapability } from '@cs/rbac';
import {
  CreateHrDepartmentRequestSchema,
  HrDepartmentListQuerySchema,
  HrIdParamSchema,
  UpdateHrDepartmentRequestSchema,
} from '@clearshift/contracts';
import type { HrService } from '../services/hr.service.js';
import { hrWriteGuard } from './guard.js';
import { parseWriteBody } from './parsing.js';
import type { HrRouteOptions } from './types.js';

export const departmentsRoutes: FastifyPluginAsync<HrRouteOptions> = async (fastify, opts) => {
  const { hrService } = opts;

  // GET /departments - List departments
  fastify.get(
    '/departments',
    { preHandler: requireCapability(Capabilities.MODULE_READ) },
    async (request, reply) => {
      const query = HrDepartmentListQuerySchema.parse(request.query);
      const response = await hrService.listDepartments(query);

      return reply.status(200).send(response);
    }
  );

  // GET /departments/:id - Read a single department
  fastify.get(
    '/departments/:id',
    { preHandler: requireCapability(Capabilities.MODULE_READ) },
    async (request, reply) => {
      const params = HrIdParamSchema.parse(request.params);
      const department = await hrService.getDepartmentById(params.id);

      return reply.status(200).send(department);
    }
  );

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

  // PATCH /departments/:id - Edit a department
  fastify.patch('/departments/:id', { preHandler: hrWriteGuard }, async (request, reply) => {
    const params = HrIdParamSchema.parse(request.params);
    const body = UpdateHrDepartmentRequestSchema.parse(request.body ?? {});
    const department = await hrService.updateDepartment(params.id, body);

    return reply.status(200).send(department);
  });
};
