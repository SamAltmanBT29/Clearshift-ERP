/**
 * ERP-5 HR & Employees — Payroll Total Routes
 *
 * POST /payroll-totals - Load one department/month aggregate
 *
 * FR-ERP5-06: one number per department, no personal data. The payload
 * carries no employee-level field, so an employee row can never be stored.
 *
 * The list/read endpoints belong to **ERP5-02** (issue #47) and are
 * deliberately not implemented here.
 *
 * @module erp5/routes/payroll-totals
 */

import type { FastifyPluginAsync } from 'fastify';
import { CreateHrPayrollTotalRequestSchema } from '@clearshift/contracts';
import { hrPayrollWriteGuard } from './guard.js';
import { parseWriteBody } from './parsing.js';
import type { HrRouteOptions } from './types.js';

export const payrollTotalsRoutes: FastifyPluginAsync<HrRouteOptions> = async (fastify, opts) => {
  const { hrService } = opts;

  // POST /payroll-totals - Load one department/month aggregate
  fastify.post('/payroll-totals', { preHandler: hrPayrollWriteGuard }, async (request, reply) => {
    const body = parseWriteBody(CreateHrPayrollTotalRequestSchema, request);
    const result = await hrService.createPayrollTotal(body);

    return reply.status(result.created ? 201 : 200).send({
      ...result.entity,
      ...(result.receipt !== undefined && { import_receipt: result.receipt }),
    });
  });
};
