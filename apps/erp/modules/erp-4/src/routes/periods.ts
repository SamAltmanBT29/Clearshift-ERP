/**
 * ERP-4 Finance — Accounting Periods Routes
 *
 * GET   /periods     - List accounting periods with status, fiscal year filter, and bounded paging
 * GET   /periods/:id - Get a single period by UUID
 * PATCH /periods/:id - Update accounting period status (Admin only)
 *
 * @module erp4/routes/periods
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  PeriodListQuerySchema,
  IdParamSchema,
  UpdatePeriodRequestSchema,
} from '@clearshift/contracts';
import type { FinanceService } from '../services/finance.service.js';
import {
  assertTenantAccess,
} from './guard.js';
import { requireFinancePolicy, FinancePolicies } from '../policies/index.js';

export interface PeriodsRouteOptions {
  financeService: FinanceService;
}

export const periodsRoutes: FastifyPluginAsync<PeriodsRouteOptions> = async (fastify, opts) => {
  const { financeService } = opts;

  // GET /periods - List accounting periods (Viewer, Editor, Analyst, Admin)
  fastify.get(
    '/periods',
    { preHandler: [requireFinancePolicy(FinancePolicies.PERIODS_READ)] },
    async (request, reply) => {
      const query = PeriodListQuerySchema.parse(request.query);
      const response = await financeService.listPeriods(query);
      return reply.status(200).send(response);
    }
  );

  // GET /periods/:id - Get accounting period by ID (Viewer, Editor, Analyst, Admin)
  fastify.get(
    '/periods/:id',
    { preHandler: [requireFinancePolicy(FinancePolicies.PERIODS_READ)] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const period = await financeService.getPeriodById(params.id);
      assertTenantAccess(request.user, period, request.headers['x-tenant-id'] as string | undefined);
      return reply.status(200).send(period);
    }
  );

  // PATCH /periods/:id - Update accounting period status (Admin only)
  fastify.patch(
    '/periods/:id',
    { preHandler: [requireFinancePolicy(FinancePolicies.PERIODS_UPDATE)] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const body = UpdatePeriodRequestSchema.parse(request.body);

      const existing = await financeService.getPeriodById(params.id);
      assertTenantAccess(request.user, existing, request.headers['x-tenant-id'] as string | undefined);

      const user = {
        id: request.user?.sub ?? 'ffffffff-0001-0001-0001-000000000001',
        role: request.user?.roles?.[0] ?? 'admin',
      };
      const period = await financeService.updatePeriod(params.id, body, user);
      return reply.status(200).send(period);
    }
  );
};
