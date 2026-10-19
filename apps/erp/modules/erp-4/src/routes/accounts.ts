/**
 * ERP-4 Finance — Accounts Routes (Chart of Accounts)
 *
 * GET   /accounts      - List accounts with server-side filter, search, stable sort, and bounded paging
 * GET   /accounts/:id  - Get a single account by UUID
 * POST  /accounts      - Create a new account (seed/admin/editor only)
 * PATCH /accounts/:id  - Update an account (admin/editor only, immutable system fields protected)
 *
 * @module erp4/routes/accounts
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  AccountListQuerySchema,
  CreateAccountRequestSchema,
  UpdateAccountRequestSchema,
  IdParamSchema,
} from '@clearshift/contracts';
import type { FinanceService } from '../services/finance.service.js';
import { ForbiddenError } from '../services/finance.service.js';

export interface AccountsRouteOptions {
  financeService: FinanceService;
}

const ACCOUNT_WRITE_ROLES = new Set(['admin', 'editor', 'finance_admin', 'seed', 'system']);

function assertAccountWriteRole(role?: string) {
  if (!role || !ACCOUNT_WRITE_ROLES.has(role)) {
    throw new ForbiddenError(
      'Account creation and modifications are restricted to seed, admin, or editor roles.',
      'INSUFFICIENT_PERMISSIONS'
    );
  }
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

  // POST /accounts - Create a new account (seed/admin/editor only)
  fastify.post('/accounts', async (request, reply) => {
    const user = (request as unknown as { user?: { id: string; role?: string } }).user;
    assertAccountWriteRole(user?.role);

    const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;
    const rawBody = (request.body && typeof request.body === 'object') ? request.body : {};
    const body = CreateAccountRequestSchema.parse({
      ...rawBody,
      ...(idempotencyHeader && !(rawBody as any).idempotency_key && { idempotency_key: idempotencyHeader }),
    });

    const result = await financeService.createAccount(body);
    return reply.status(result.created ? 201 : 200).send(result.account);
  });

  // PATCH /accounts/:id - Update mutable account fields (admin/editor only)
  fastify.patch('/accounts/:id', async (request, reply) => {
    const user = (request as unknown as { user?: { id: string; role?: string } }).user;
    assertAccountWriteRole(user?.role);

    const params = IdParamSchema.parse(request.params);
    const body = UpdateAccountRequestSchema.parse(request.body);
    const updated = await financeService.updateAccount(params.id, body);
    return reply.status(200).send(updated);
  });
};


