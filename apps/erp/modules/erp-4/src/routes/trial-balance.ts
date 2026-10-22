/**
 * ERP-4 Finance — Trial Balance Route
 *
 * GET /trial-balance?period=YYYY-MM[&currency_code=INR]
 *
 * @module erp4/routes/trial-balance
 */

import type { FastifyPluginAsync } from 'fastify';
import { TrialBalanceQuerySchema } from '@clearshift/contracts';
import type { FinanceService } from '../services/finance.service.js';
import { requireFinanceRead } from './guard.js';

export interface TrialBalanceRouteOptions {
  financeService: FinanceService;
}

export const trialBalanceRoutes: FastifyPluginAsync<TrialBalanceRouteOptions> = async (
  fastify,
  opts
) => {
  const { financeService } = opts;

  fastify.get('/trial-balance', { preHandler: [requireFinanceRead] }, async (request, reply) => {
    const query = TrialBalanceQuerySchema.parse(request.query);
    const report = await financeService.getTrialBalance(query);
    return reply.status(200).send(report);
  });
};
