/**
 * ERP-1 Categories Routes
 *
 * GET   /categories      — list/search one-level categories
 * GET   /categories/{id} — read one category
 * POST  /categories      — create a category
 * PATCH /categories/{id} — edit a category
 *
 * @module erp1/routes/categories
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  CategoryListQuerySchema,
  CreateCategoryInputSchema,
  Erp1IdParamSchema,
  UpdateCategoryInputSchema,
} from '@clearshift/contracts';
import {
  assertObjectMutationAccess,
  assertTenantAccess,
  erp1IngestGuard,
  erp1ReadGuard,
  erp1WriteGuard,
  registerEntityCreator,
  registerEntityTenant,
} from './guard.js';
import { parseWriteBody } from './parsing.js';
import type { Erp1RouteOptions } from './types.js';

export const categoriesRoutes: FastifyPluginAsync<Erp1RouteOptions> = async (fastify, opts) => {
  const { erp1Service } = opts;

  fastify.get(
    '/categories',
    { preHandler: erp1ReadGuard },
    async (request, reply) => {
      const query = CategoryListQuerySchema.parse(request.query);
      const page = await erp1Service.listCategories(query);

      return reply.status(200).send({
        items: page.items,
        total: page.total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(page.total / query.pageSize),
      });
    }
  );

  fastify.get(
    '/categories/:id',
    { preHandler: erp1ReadGuard },
    async (request, reply) => {
      const { id } = Erp1IdParamSchema.parse(request.params);
      const category = await erp1Service.getCategoryById(id);
      assertTenantAccess(request.user, category, request.headers['x-tenant-id'] as string | undefined);
      return reply.status(200).send(category);
    }
  );

  fastify.post(
    '/categories',
    { preHandler: erp1IngestGuard },
    async (request, reply) => {
      const body = parseWriteBody(CreateCategoryInputSchema, request);
      const requestTenant = request.headers['x-tenant-id'] as string | undefined;
      assertTenantAccess(request.user, body as Record<string, unknown>, requestTenant);
      const result = await erp1Service.createCategoryWithIdempotency(body);

      const tenantId = ((body as Record<string, unknown>)['tenant_id'] as string | undefined) ?? requestTenant;
      if (result.entity?.id) {
        registerEntityTenant(result.entity.id, tenantId);
        registerEntityCreator(result.entity.id, request.user?.sub);
      }

      return reply.status(result.priorResult ? 200 : 201).send({
        ...result.entity,
        prior_result: result.priorResult,
      });
    }
  );

  fastify.patch(
    '/categories/:id',
    { preHandler: erp1WriteGuard },
    async (request, reply) => {
      const { id } = Erp1IdParamSchema.parse(request.params);
      const requestTenant = request.headers['x-tenant-id'] as string | undefined;
      const existing = await erp1Service.getCategoryById(id);
      assertObjectMutationAccess(request.user, existing, requestTenant);

      const body = UpdateCategoryInputSchema.parse(request.body ?? {});
      assertTenantAccess(request.user, body as Record<string, unknown>, requestTenant);
      const category = await erp1Service.updateCategory(id, body);
      return reply.status(200).send(category);
    }
  );
};
