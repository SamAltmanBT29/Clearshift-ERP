/**
 * ERP-4 Finance & Accounting — Routes Plugin Index
 *
 * Exposes all V1 module routes under the approved API base path:
 *   /api/v1/erp-finance
 *
 * @module erp4/routes
 */

import type { FastifyPluginAsync } from 'fastify';
import type { FinanceService } from '../services/finance.service.js';
import { accountsRoutes } from './accounts.js';
import { journalEntriesRoutes } from './journal-entries.js';
import { trialBalanceRoutes } from './trial-balance.js';
import { openingBalancesRoutes } from './opening-balances.js';
import { periodsRoutes } from './periods.js';
import { profilingRoutes } from './profiling.js';
import { cleaningRoutes } from './cleaning.js';
import { mappingRoutes } from './mapping.js';
import { importRoutes } from './import.js';

export interface ErpFinanceRoutesOptions {
  financeService: FinanceService;
}

export const erpFinanceRoutes: FastifyPluginAsync<ErpFinanceRoutesOptions> = async (
  fastify,
  opts
) => {
  const childOpts = { financeService: opts.financeService };
  await fastify.register(accountsRoutes, childOpts);
  await fastify.register(journalEntriesRoutes, childOpts);
  await fastify.register(trialBalanceRoutes, childOpts);
  await fastify.register(openingBalancesRoutes, childOpts);
  await fastify.register(periodsRoutes, childOpts);
  await fastify.register(importRoutes, childOpts);
  await fastify.register(profilingRoutes);
  await fastify.register(cleaningRoutes);
  await fastify.register(mappingRoutes);
};

export {
  accountsRoutes,
  journalEntriesRoutes,
  trialBalanceRoutes,
  openingBalancesRoutes,
  periodsRoutes,
  importRoutes,
  profilingRoutes,
  cleaningRoutes,
  mappingRoutes,
};
