/**
 * ERP-1 Categories Routes
 *
 * Exposes:
 *   GET   /api/v1/erp-products/categories
 *   POST  /api/v1/erp-products/categories
 *   GET   /api/v1/erp-products/categories/:id
 *   PATCH /api/v1/erp-products/categories/:id
 *
 * @module erp1/routes/categories
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  CreateCategoryInputSchema,
  UpdateCategoryInputSchema,
} from '@clearshift/contracts';
import type { Erp1Service } from '../services/erp1.service.js';
import { Erp1DomainError } from '../domain/rules.js';

export const categoriesRoutes: FastifyPluginAsync<{ erp1Service: Erp1Service }> = async (
  fastify,
  options
) => {
  const { erp1Service } = options;

  // GET /categories
  fastify.get('/categories', async (_request, reply) => {
    const list = await erp1Service.listCategories();
    return reply.status(200).send({
      items: list,
      total: list.length,
      page: 1,
      pageSize: Math.max(1, list.length),
    });
  });

  // POST /categories
  fastify.post('/categories', async (request, reply) => {
    const input = CreateCategoryInputSchema.parse(request.body);
    const category = await erp1Service.createCategory(input);
    return reply.status(201).send(category);
  });

  // GET /categories/:id
  fastify.get('/categories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const category = await erp1Service.getCategoryById(id);
    if (!category) {
      throw new Erp1DomainError(`Category "${id}" not found`, 'CATEGORY_NOT_FOUND', 404, 'id');
    }
    return reply.status(200).send(category);
  });

  // PATCH /categories/:id
  fastify.patch('/categories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = UpdateCategoryInputSchema.parse(request.body);
    const updated = await erp1Service.updateCategory(id, input);
    return reply.status(200).send(updated);
  });
};
