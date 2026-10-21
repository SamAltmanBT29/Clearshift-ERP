/**
 * ERP-2 Route Index
 *
 * Registers vendor and purchase order routes under the module route prefix.
 *
 * @module erp2/routes
 */

import { FastifyPluginAsync } from 'fastify';
import { vendorRoutes } from './vendors.js';
import { purchaseOrderRoutes } from './purchase-orders.js';
import type { VendorService } from '../services/vendor.service.js';
import type { PurchaseOrderService } from '../services/purchase-order.service.js';

export interface Erp2RoutesOptions {
  vendorService: VendorService;
  purchaseOrderService: PurchaseOrderService;
}

export const erp2Routes: FastifyPluginAsync<Erp2RoutesOptions> = async (
  fastify,
  options
) => {
  const { vendorService, purchaseOrderService } = options;

  fastify.register(vendorRoutes, { vendorService });
  fastify.register(purchaseOrderRoutes, { purchaseOrderService });
};
