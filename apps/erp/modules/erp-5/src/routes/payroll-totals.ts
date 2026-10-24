/**
 * ERP-5 HR & Employees — Payroll Total Routes
 *
 * GET  /payroll-totals      - List department/month aggregates
 * GET  /payroll-totals/{id} - Read a single aggregate
 * POST /payroll-totals      - Load one department/month aggregate
 *
 * FR-ERP5-06: one number per department, no personal data. The payload
 * carries no employee-level field, so an employee row can never be stored.
 *
 * @module erp5/routes/payroll-totals
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  CreateHrPayrollTotalRequestSchema,
  HrIdParamSchema,
  HrPayrollTotalListQuerySchema,
} from '@clearshift/contracts';
import type { HrService } from '../services/hr.service.js';
import { payrollLoadGuard, payrollReadGuard } from './guard.js';
import { parseWriteBody } from './parsing.js';
import type { HrRouteOptions, HrFastifyInstance } from './types.js';

export const payrollTotalsRoutes: FastifyPluginAsync<HrRouteOptions> = async (fastify, opts) => {
  const { hrService } = opts;
  const app = fastify as HrFastifyInstance;

  // GET /payroll-totals - List department/month aggregates
  fastify.get(
    '/payroll-totals',
    { preHandler: payrollReadGuard },
    async (request, reply) => {
      const query = HrPayrollTotalListQuerySchema.parse(request.query);
      const response = await hrService.listPayrollTotals(query);

      return reply.status(200).send(response);
    }
  );

  // GET /payroll-totals/:id - Read a single aggregate
  fastify.get(
    '/payroll-totals/:id',
    { preHandler: payrollReadGuard },
    async (request, reply) => {
      const params = HrIdParamSchema.parse(request.params);
      const total = await hrService.getPayrollTotalById(params.id);

      return reply.status(200).send(total);
    }
  );

  // POST /payroll-totals - Load one department/month aggregate
  fastify.post('/payroll-totals', { preHandler: payrollLoadGuard }, async (request, reply) => {
    const body = parseWriteBody(CreateHrPayrollTotalRequestSchema, request);
    const result = await hrService.createPayrollTotal(
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
};
