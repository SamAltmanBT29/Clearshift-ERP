/**
 * ERP-2 Route Registry
 *
 * Combines vendors, purchase orders, and migration kit import routes.
 *
 * @module erp2/routes
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Erp2Service } from '../services/erp2.service.js';
import type { VendorService } from '../services/vendor.service.js';
import type { PurchaseOrderService } from '../services/purchase-order.service.js';
import { vendorRoutes } from './vendors.js';
import { purchaseOrderRoutes } from './purchase-orders.js';
import { importRoutes } from './import.js';
import { duplicateRoutes } from './duplicates.js';

export interface Erp2RoutesOptions {
  erp2Service?: Erp2Service | undefined;
  vendorService?: VendorService | undefined;
  purchaseOrderService?: PurchaseOrderService | undefined;
}

export const erpVendorsRoutes: FastifyPluginAsync<Erp2RoutesOptions> = async (
  fastify,
  opts
) => {
  const { erp2Service, vendorService, purchaseOrderService } = opts;
  await fastify.register(vendorRoutes, { erp2Service, vendorService });
  await fastify.register(purchaseOrderRoutes, { erp2Service, purchaseOrderService });
  if (erp2Service) {
    await fastify.register(importRoutes, { erp2Service });
    await fastify.register(duplicateRoutes, { erp2Service });
  }
};

export const erp2Routes = erpVendorsRoutes;

export { vendorRoutes, purchaseOrderRoutes, importRoutes, duplicateRoutes };
export * from './guard.js';
