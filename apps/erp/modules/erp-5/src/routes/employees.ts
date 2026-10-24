/**
 * ERP-5 HR & Employees — Employee Routes
 *
 * GET   /employees      - List employees with bounded paging and search
 * GET   /employees/{id} - Read a single employee
 * POST  /employees      - Create an employee
 * PATCH /employees/{id} - Edit an employee
 *
 * The list response carries the **masked** projection — the raw `salary`
 * column never leaves the module (BR-ERP5-02).
 *
 * @module erp5/routes/employees
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  CreateHrEmployeeRequestSchema,
  HrEmployeeListQuerySchema,
  HrIdParamSchema,
  UpdateHrEmployeeRequestSchema,
} from '@clearshift/contracts';
import type { HrService } from '../services/hr.service.js';
import {
  employeeCreateGuard,
  employeeReadGuard,
  employeeUpdateGuard,
} from './guard.js';
import { parseWriteBody } from './parsing.js';
import type { HrRouteOptions, HrFastifyInstance } from './types.js';

export const employeesRoutes: FastifyPluginAsync<HrRouteOptions> = async (fastify, opts) => {
  const { hrService } = opts;
  const app = fastify as HrFastifyInstance;

  // GET /employees - List employees with bounded paging and search
  fastify.get(
    '/employees',
    { preHandler: employeeReadGuard },
    async (request, reply) => {
      const query = HrEmployeeListQuerySchema.parse(request.query);
      const response = await hrService.listEmployees(query, request.user!.roles);

      return reply.status(200).send(response);
    }
  );

  // GET /employees/:id - Read a single employee (masked projection)
  fastify.get(
    '/employees/:id',
    { preHandler: employeeReadGuard },
    async (request, reply) => {
      const params = HrIdParamSchema.parse(request.params);
      const employee = await hrService.getEmployeeById(params.id, request.user!.roles);

      return reply.status(200).send(employee);
    }
  );

  // POST /employees - Create an employee
  fastify.post('/employees', { preHandler: employeeCreateGuard }, async (request, reply) => {
    const body = parseWriteBody(CreateHrEmployeeRequestSchema, request);
    const result = await hrService.createEmployee(
      body,
      request.user!,
      app.resolveCorrelationId(request)
    );

    return reply.status(result.created ? 201 : 200).send({
      ...result.entity,
      ...(result.receipt !== undefined && { import_receipt: result.receipt }),
      ...(result.warnings !== undefined && { warnings: result.warnings }),
    });
  });

  // PATCH /employees/:id - Edit an employee
  fastify.patch('/employees/:id', { preHandler: employeeUpdateGuard }, async (request, reply) => {
    const params = HrIdParamSchema.parse(request.params);
    const body = UpdateHrEmployeeRequestSchema.parse(request.body ?? {});
    const employee = await hrService.updateEmployee(
      params.id,
      body,
      request.user!,
      app.resolveCorrelationId(request)
    );

    return reply.status(200).send(employee);
  });
};
