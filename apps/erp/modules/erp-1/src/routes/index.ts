/**
 * ERP-1 Products & Inventory Routes Aggregator
 *
 * Registers all module endpoints under /api/v1/erp-products:
 *   - /products
 *   - /categories
 *   - /stock
 *   - /migration-metadata
 *   - /rejections
 *
 * @module erp1/routes
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Erp1Service } from '../services/erp1.service.js';
import { productsRoutes } from './products.js';
import { categoriesRoutes } from './categories.js';
import { stockRoutes } from './stock.js';
import { metadataRoutes } from './metadata.js';

export const erpProductsRoutes: FastifyPluginAsync<{ erp1Service: Erp1Service }> = async (
  fastify,
  options
) => {
  const { erp1Service } = options;
  await fastify.register(productsRoutes, { erp1Service });
  await fastify.register(categoriesRoutes, { erp1Service });
  await fastify.register(stockRoutes, { erp1Service });
  await fastify.register(metadataRoutes);
};
