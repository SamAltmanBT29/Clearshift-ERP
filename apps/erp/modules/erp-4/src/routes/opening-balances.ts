/**
 * ERP-4 Finance — Opening Balances Routes
 *
 * GET  /opening-balances     - List opening balances with bounded paging
 * GET  /opening-balances/:id - Get a single opening balance by UUID
 * POST /opening-balances     - Bulk-load opening balances (one-time per account/currency)
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

export interface OpeningBalancesRouteOptions {
  financeService: FinanceService;
}

export const openingBalancesRoutes: FastifyPluginAsync<OpeningBalancesRouteOptions> = async (
  fastify,
  opts
) => {
  const { financeService } = opts;

  // GET /opening-balances - List opening balances
  fastify.get('/opening-balances', async (request, reply) => {
    const query = OpeningBalanceListQuerySchema.parse(request.query);
    const response = await financeService.listOpeningBalances(query);
    return reply.status(200).send(response);
  });

  // GET /opening-balances/:id - Get opening balance by ID
  fastify.get('/opening-balances/:id', async (request, reply) => {
    const params = IdParamSchema.parse(request.params);
    const balance = await financeService.getOpeningBalanceById(params.id);
    return reply.status(200).send(balance);
  });

  // POST /opening-balances - Bulk load opening balances
  fastify.post('/opening-balances', async (request, reply) => {
    const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;
    const rawBody = (request.body && typeof request.body === 'object') ? request.body : {};
    const body = CreateOpeningBalancesRequestSchema.parse({
      ...rawBody,
      ...(idempotencyHeader && !(rawBody as any).idempotency_key && { idempotency_key: idempotencyHeader }),
    });
    const user = (request as unknown as { user: { id: string; role?: string } }).user;
    const response = await financeService.createOpeningBalances(body, user.id);
    return reply.status(201).send(response);
  });
};
