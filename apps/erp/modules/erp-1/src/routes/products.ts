/**
 * ERP-1 Products Routes
 *
 * Exposes:
 *   GET   /api/v1/erp-products/products
 *   POST  /api/v1/erp-products/products
 *   GET   /api/v1/erp-products/products/:id
 *   PATCH /api/v1/erp-products/products/:id
 *   GET   /api/v1/erp-products/products/:id/linked-records
 *
 * @module erp1/routes/products
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  CreateProductInputSchema,
  UpdateProductInputSchema,
  ProductListQuerySchema,
} from '@clearshift/contracts';
import type { Erp1Service } from '../services/erp1.service.js';

export const productsRoutes: FastifyPluginAsync<{ erp1Service: Erp1Service }> = async (
  fastify,
  options
) => {
  const { erp1Service } = options;

  // GET /products
  fastify.get('/products', async (request, reply) => {
    const query = ProductListQuerySchema.parse(request.query);
    const result = await erp1Service.listProducts(query);
    return reply.status(200).send(result);
  });

  // POST /products
  fastify.post('/products', async (request, reply) => {
    const input = CreateProductInputSchema.parse(request.body);
    const product = await erp1Service.createProduct(input);
    return reply.status(201).send(product);
  });

  // GET /products/:id
  fastify.get('/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = await erp1Service.getProductById(id);
    return reply.status(200).send(product);
  });

  // PATCH /products/:id
  fastify.patch('/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = UpdateProductInputSchema.parse(request.body);
    const updated = await erp1Service.updateProduct(id, input);
    return reply.status(200).send(updated);
  });

  // GET /products/:id/linked-records
  fastify.get('/products/:id/linked-records', async (request, reply) => {
    const { id } = request.params as { id: string };
    const linked = await erp1Service.getLinkedRecords(id);
    return reply.status(200).send(linked);
  });
};
