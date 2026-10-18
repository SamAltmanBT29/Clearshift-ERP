/**
 * ERP-4 Finance — Accounts Routes (Chart of Accounts)
 *
 * GET  /accounts      - List accounts with server-side filter, search, stable sort, and bounded paging
 * GET  /accounts/:id  - Get a single account by UUID
 * POST /accounts      - Create a new account (seed/admin/editor only)
 *
 * @module erp4/routes/accounts
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  AccountListQuerySchema,
  CreateAccountRequestSchema,
  IdParamSchema,
} from '@clearshift/contracts';
import type { FinanceService } from '../services/finance.service.js';

export interface AccountsRouteOptions {
  financeService: FinanceService;
}

export const accountsRoutes: FastifyPluginAsync<AccountsRouteOptions> = async (fastify, opts) => {
  const { financeService } = opts;

  // GET /accounts - List accounts
  fastify.get('/accounts', async (request, reply) => {
    const query = AccountListQuerySchema.parse(request.query);
    const response = await financeService.listAccounts(query);
    return reply.status(200).send(response);
  });

  // GET /accounts/:id - Get account by ID
  fastify.get('/accounts/:id', async (request, reply) => {
    const params = IdParamSchema.parse(request.params);
    const account = await financeService.getAccountById(params.id);
    return reply.status(200).send(account);
  });

  // POST /accounts - Create a new account
  fastify.post('/accounts', async (request, reply) => {
    const body = CreateAccountRequestSchema.parse(request.body);
    const created = await financeService.createAccount(body);
    return reply.status(201).send(created);
  });
};

