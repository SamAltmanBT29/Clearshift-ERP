/**
 * ERP-2 Route Registry
 *
 * Combines vendors, purchase orders, and migration kit import routes.
 *
 * @module erp2/routes
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Erp2Service } from '../services/erp2.service.js';
import { vendorRoutes } from './vendors.js';
import { purchaseOrderRoutes } from './purchase-orders.js';
import { importRoutes } from './import.js';
import { duplicateRoutes } from './duplicates.js';

export const erpVendorsRoutes: FastifyPluginAsync<{ erp2Service: Erp2Service }> = async (
  fastify,
  opts
) => {
  const childOpts = { erp2Service: opts.erp2Service };
  await fastify.register(vendorRoutes, childOpts);
  await fastify.register(purchaseOrderRoutes, childOpts);
  await fastify.register(importRoutes, childOpts);
  await fastify.register(duplicateRoutes, childOpts);
};

export { vendorRoutes, purchaseOrderRoutes, importRoutes, duplicateRoutes };
