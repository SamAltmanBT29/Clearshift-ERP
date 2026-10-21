/**
 * ERP-2 Purchase Order Route Handlers
 *
 * Implements:
 *   - GET /api/v1/erp-vendors/purchase-orders
 *   - GET /api/v1/erp-vendors/purchase-orders/:id
 *   - POST /api/v1/erp-vendors/purchase-orders
 *   - PATCH /api/v1/erp-vendors/purchase-orders/:id (status transition only)
 *
 * @module erp2/routes/purchase-orders
 */

import { FastifyPluginAsync } from 'fastify';
import {
  PurchaseOrderListQuerySchema,
  CreatePurchaseOrderRequestSchema,
  UpdatePurchaseOrderStatusRequestSchema,
  UuidSchema,
} from '@clearshift/contracts';
import { ERP2_ENDPOINT_ROLES } from '../policies/rbac.js';
import { requireRoles } from '../plugins/auth.js';
import type { PurchaseOrderService } from '../services/purchase-order.service.js';

export interface PurchaseOrderRoutesOptions {
  purchaseOrderService: PurchaseOrderService;
}

export const purchaseOrderRoutes: FastifyPluginAsync<PurchaseOrderRoutesOptions> = async (
  fastify,
  options
) => {
  const { purchaseOrderService } = options;

  // 1. GET /purchase-orders — list/filter POs
  fastify.get(
    '/purchase-orders',
    {
      preHandler: [fastify.authenticate, requireRoles(ERP2_ENDPOINT_ROLES.LIST_PURCHASE_ORDERS)],
    },
    async (request, reply) => {
      const query = PurchaseOrderListQuerySchema.parse(request.query);
      const result = await purchaseOrderService.listPurchaseOrders(query);
      return reply.status(200).send(result);
    }
  );

  // 2. GET /purchase-orders/:id — get PO by ID
  fastify.get(
    '/purchase-orders/:id',
    {
      preHandler: [fastify.authenticate, requireRoles(ERP2_ENDPOINT_ROLES.GET_PURCHASE_ORDER)],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      UuidSchema.parse(id);

      const po = await purchaseOrderService.getPurchaseOrderById(id);
      return reply.status(200).send(po);
    }
  );

  // 3. POST /purchase-orders — create PO with lines
  fastify.post(
    '/purchase-orders',
    {
      preHandler: [fastify.authenticate, requireRoles(ERP2_ENDPOINT_ROLES.CREATE_PURCHASE_ORDER)],
    },
    async (request, reply) => {
      const body = CreatePurchaseOrderRequestSchema.parse(request.body);
      const actor = request.user?.sub || 'system';
      const correlationId =
        (request as any).correlationId ??
        (typeof request.headers['x-correlation-id'] === 'string'
          ? request.headers['x-correlation-id']
          : undefined);

      const created = await purchaseOrderService.createPurchaseOrder(body, {
        actor,
        correlationId,
      });
      return reply.status(201).send(created);
    }
  );

  // 4. PATCH /purchase-orders/:id — allowed status transition only
  fastify.patch(
    '/purchase-orders/:id',
    {
      preHandler: [
        fastify.authenticate,
        requireRoles(ERP2_ENDPOINT_ROLES.UPDATE_PURCHASE_ORDER_STATUS),
      ],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      UuidSchema.parse(id);

      const body = UpdatePurchaseOrderStatusRequestSchema.parse(request.body);
      const actor = request.user?.sub || 'system';
      const correlationId =
        (request as any).correlationId ??
        (typeof request.headers['x-correlation-id'] === 'string'
          ? request.headers['x-correlation-id']
          : undefined);

      const updated = await purchaseOrderService.updatePurchaseOrderStatus(
        id,
        body.status,
        { actor, correlationId }
      );
      return reply.status(200).send(updated);
    }
  );
};
