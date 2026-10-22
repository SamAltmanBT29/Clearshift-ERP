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
import {
  requireFinanceRead,
  requireFinanceWrite,
  assertTenantAccess,
  registerEntityTenant,
} from './guard.js';

export interface AccountsRouteOptions {
  financeService: FinanceService;
}

export const accountsRoutes: FastifyPluginAsync<AccountsRouteOptions> = async (fastify, opts) => {
  const { financeService } = opts;

  // GET /accounts - List accounts
  fastify.get('/accounts', { preHandler: [requireFinanceRead] }, async (request, reply) => {
    const query = AccountListQuerySchema.parse(request.query);
    const response = await financeService.listAccounts(query);
    return reply.status(200).send(response);
  });

  // GET /accounts/:id - Get account by ID
  fastify.get('/accounts/:id', { preHandler: [requireFinanceRead] }, async (request, reply) => {
    const params = IdParamSchema.parse(request.params);
    const account = await financeService.getAccountById(params.id);
    assertTenantAccess(request.user, account, request.headers['x-tenant-id'] as string | undefined);
    return reply.status(200).send(account);
  });

  // POST /accounts - Create a new account (seed/admin/editor only)
  fastify.post('/accounts', { preHandler: [requireFinanceWrite] }, async (request, reply) => {
    const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;
    const rawBody = (request.body && typeof request.body === 'object') ? request.body : {};
    const body = CreateAccountRequestSchema.parse({
      ...rawBody,
      ...(idempotencyHeader && !(rawBody as any).idempotency_key && { idempotency_key: idempotencyHeader }),
    });

    assertTenantAccess(request.user, body, request.headers['x-tenant-id'] as string | undefined);

    const result = await financeService.createAccount(body);
    const tenantId = (rawBody as any).tenant_id ?? (request.headers['x-tenant-id'] as string | undefined);
    if (result.account?.id && tenantId) {
      registerEntityTenant(result.account.id, tenantId);
    }
    return reply.status(result.created ? 201 : 200).send(result.account);
  });

  // PATCH /accounts/:id - Update mutable account fields (admin/editor only)
  fastify.patch('/accounts/:id', { preHandler: [requireFinanceWrite] }, async (request, reply) => {
    const params = IdParamSchema.parse(request.params);
    const body = UpdateAccountRequestSchema.parse(request.body);

    const existing = await financeService.getAccountById(params.id);
    assertTenantAccess(request.user, existing, request.headers['x-tenant-id'] as string | undefined);

    const updated = await financeService.updateAccount(params.id, body);
    return reply.status(200).send(updated);
  });
};


