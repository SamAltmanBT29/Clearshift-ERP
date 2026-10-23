/**
 * ERP-3 Sales Orders & Invoices — Route Aggregator
 *
 * Registers ERP-3 mutation routes (and minimal by-ID read-backs) under `/api/v1/erp-orders`.
 *
 * @module erp3/routes
 */

import type { FastifyPluginAsync } from "fastify";
import type { Erp3Service } from "../services/erp3.service.js";
import { salesOrderRoutes } from "./sales-orders.js";
import { invoiceRoutes } from "./invoices.js";
import { paymentRoutes } from "./payments.js";
import { importRoutes } from "./import.js";

export interface Erp3RouteOptions {
  erp3Service: Erp3Service;
}

export const erpOrdersRoutes: FastifyPluginAsync<Erp3RouteOptions> = async (
  fastify,
  opts,
) => {
  await fastify.register(salesOrderRoutes, { erp3Service: opts.erp3Service });
  await fastify.register(invoiceRoutes, { erp3Service: opts.erp3Service });
  await fastify.register(paymentRoutes, { erp3Service: opts.erp3Service });
  await fastify.register(importRoutes, { erp3Service: opts.erp3Service });
};
