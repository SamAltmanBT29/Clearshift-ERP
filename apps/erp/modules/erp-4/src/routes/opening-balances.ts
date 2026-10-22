/**
 * ERP-4 Finance — Opening Balances Routes
 *
 * GET  /opening-balances     - List opening balances with bounded paging
 * GET  /opening-balances/:id - Get a single opening balance by UUID
 * POST /opening-balances     - Bulk-load opening balances (one-time per account/currency, Migration Runner & Admin only)
 *
 * @module erp4/routes/opening-balances
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  OpeningBalanceListQuerySchema,
  CreateOpeningBalancesRequestSchema,
  IdParamSchema,
} from '@clearshift/contracts';
import type { FinanceService } from '../services/finance.service.js';
import {
  assertTenantAccess,
} from './guard.js';
import { requireFinancePolicy, FinancePolicies } from '../policies/index.js';

export interface OpeningBalancesRouteOptions {
  financeService: FinanceService;
}

export const openingBalancesRoutes: FastifyPluginAsync<OpeningBalancesRouteOptions> = async (
  fastify,
  opts
) => {
  const { financeService } = opts;

  // GET /opening-balances - List opening balances (Viewer, Editor, Analyst, Migration Runner, Admin)
  fastify.get(
    '/opening-balances',
    { preHandler: [requireFinancePolicy(FinancePolicies.OPENING_BALANCES_READ)] },
    async (request, reply) => {
      const query = OpeningBalanceListQuerySchema.parse(request.query);
      const response = await financeService.listOpeningBalances(query);
      return reply.status(200).send(response);
    }
  );

  // GET /opening-balances/:id - Get opening balance by ID (Viewer, Editor, Analyst, Migration Runner, Admin)
  fastify.get(
    '/opening-balances/:id',
    { preHandler: [requireFinancePolicy(FinancePolicies.OPENING_BALANCES_READ)] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const balance = await financeService.getOpeningBalanceById(params.id);
      assertTenantAccess(request.user, balance, request.headers['x-tenant-id'] as string | undefined);
      return reply.status(200).send(balance);
    }
  );

  // POST /opening-balances - Bulk load opening balances (Migration Runner & Admin only)
  fastify.post(
    '/opening-balances',
    { preHandler: [requireFinancePolicy(FinancePolicies.OPENING_BALANCES_LOAD)] },
    async (request, reply) => {
      const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;
      const rawBody = (request.body && typeof request.body === 'object') ? request.body : {};
      const body = CreateOpeningBalancesRequestSchema.parse({
        ...rawBody,
        ...(idempotencyHeader && !(rawBody as any).idempotency_key && { idempotency_key: idempotencyHeader }),
      });

      assertTenantAccess(request.user, body, request.headers['x-tenant-id'] as string | undefined);

      const userId = request.user?.sub ?? 'ffffffff-0001-0001-0001-000000000001';
      const response = await financeService.createOpeningBalances(body, userId);
      return reply.status(201).send(response);
    }
  );
};
