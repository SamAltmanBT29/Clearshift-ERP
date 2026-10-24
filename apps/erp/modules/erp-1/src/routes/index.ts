/**
 * ERP-1 Products & Inventory — Routes Plugin Index
 *
 * @module erp1/routes
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Erp1Service } from '../services/erp1.service.js';
import { categoriesRoutes } from './categories.js';
import { productsRoutes } from './products.js';
import { stockRoutes } from './stock.js';
import { importRoutes } from './import.js';

export interface Erp1RoutesOptions {
  erp1Service: Erp1Service;
}

export const erp1Routes: FastifyPluginAsync<Erp1RoutesOptions> = async (fastify, opts) => {
  const childOpts = { erp1Service: opts.erp1Service };
  await fastify.register(productsRoutes, childOpts);
  await fastify.register(categoriesRoutes, childOpts);
  await fastify.register(stockRoutes, childOpts);
  await fastify.register(importRoutes, childOpts);
};

export { categoriesRoutes, productsRoutes, stockRoutes, importRoutes };
