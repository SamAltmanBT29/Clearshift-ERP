/**
 * ERP-2 Purchase Orders Routes
 *
 * Implements:
 *   - GET /purchase-orders (list with vendor/status filter, bounded pagination)
 *   - POST /purchase-orders (create with lines, product validation via ERP-1 contract, server-side totals)
 *   - GET /purchase-orders/:id (retrieve PO with line items)
 *   - PATCH /purchase-orders/:id (allowed status transitions only: Draft -> Sent -> Received -> Closed)
 *
 * Security:
 *   - RBAC matrix enforcement (ERP2_ENDPOINT_ROLES)
 *   - Object-level tenant and cross-user mutation guards (assertTenantAccess, assertObjectMutationAccess)
 *
 * @module erp2/routes/purchase-orders
 */

import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import {
  PurchaseOrderListQuerySchema,
  CreatePurchaseOrderRequestSchema,
  UpdatePurchaseOrderStatusRequestSchema,
  UuidSchema,
} from '@clearshift/contracts';
import type { Erp2Service } from '../services/erp2.service.js';
import type { PurchaseOrderService } from '../services/purchase-order.service.js';
import {
  ERP2_ENDPOINT_ROLES,
  assertTenantAccess,
  assertObjectMutationAccess,
  registerEntityTenant,
  registerEntityCreator,
} from './guard.js';
import { requireRoles } from '../plugins/auth.js';

export interface PurchaseOrderRoutesOptions {
  erp2Service?: Erp2Service | undefined;
  purchaseOrderService?: PurchaseOrderService | undefined;
}

export const purchaseOrderRoutes: FastifyPluginAsync<PurchaseOrderRoutesOptions> = async (
  fastify,
  opts
) => {
  const service = opts.erp2Service;
  const poService = opts.purchaseOrderService;

  // 1. GET /purchase-orders — list with filter & pagination
  fastify.get(
    '/purchase-orders',
    {
      preHandler: [fastify.authenticate, requireRoles(ERP2_ENDPOINT_ROLES.LIST_PURCHASE_ORDERS)],
    },
    async (request, reply) => {
      const parsed = PurchaseOrderListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        const correlationId =
          (reply.getHeader('x-correlation-id') as string | undefined) ??
          (request as any).correlationId ??
          (request.headers['x-correlation-id'] as string | undefined) ??
          (request.headers['x-request-id'] as string | undefined) ??
          randomUUID();
        reply.header('x-correlation-id', correlationId);
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
          details: parsed.error.issues,
          correlation_id: correlationId,
        });
      }

      if (poService) {
        const result = await poService.listPurchaseOrders(parsed.data);
        return reply.status(200).send(result);
      }

      const { purchaseOrders, total } = await service!.listPurchaseOrders(parsed.data);
      const totalPages = Math.ceil(total / parsed.data.pageSize) || 1;

      return reply.status(200).send({
        items: purchaseOrders,
        total,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        totalPages,
      });
    }
  );

  // 2. GET /purchase-orders/:id — get by UUID
  fastify.get(
    '/purchase-orders/:id',
    {
      preHandler: [fastify.authenticate, requireRoles(ERP2_ENDPOINT_ROLES.GET_PURCHASE_ORDER)],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const validUuid = UuidSchema.safeParse(id);
      if (!validUuid.success) {
        const correlationId =
          (reply.getHeader('x-correlation-id') as string | undefined) ??
          (request as any).correlationId ??
          (request.headers['x-correlation-id'] as string | undefined) ??
          (request.headers['x-request-id'] as string | undefined) ??
          randomUUID();
        reply.header('x-correlation-id', correlationId);
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_UUID',
          message: 'Purchase Order ID must be a valid UUID v4',
          details: [],
          correlation_id: correlationId,
        });
      }

      const po = poService
        ? await poService.getPurchaseOrderById(id)
        : await service!.getPurchaseOrderById(id);

      assertTenantAccess(
        request.user,
        po,
        request.headers['x-tenant-id'] as string | undefined
      );

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
      const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;

      const rawBody = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
      const bodyToValidate = {
        ...rawBody,
        idempotency_key: idempotencyHeader || rawBody['idempotency_key'],
      };

      const parsed = CreatePurchaseOrderRequestSchema.safeParse(bodyToValidate);
      if (!parsed.success) {
        const correlationId =
          (reply.getHeader('x-correlation-id') as string | undefined) ??
          (request as any).correlationId ??
          (request.headers['x-correlation-id'] as string | undefined) ??
          (request.headers['x-request-id'] as string | undefined) ??
          randomUUID();
        reply.header('x-correlation-id', correlationId);
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid purchase order data',
          details: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
            code: i.code,
          })),
          correlation_id: correlationId,
        });
      }

      const requestTenant = request.headers['x-tenant-id'] as string | undefined;

      // If batch_id and idempotency_key are present and service is available, execute via atomic import dual-write
      if (service && parsed.data.batch_id && parsed.data.idempotency_key) {
        const importRes = await service.importRow({
          batch_id: parsed.data.batch_id,
          source_row: parsed.data.source_row ?? 0,
          source_system: null,
          source_id: null,
          idempotency_key: parsed.data.idempotency_key,
          entity: 'purchase_order',
          record: parsed.data as unknown as Record<string, unknown>,
        });
        const po = await service.getPurchaseOrderById(importRes.target_id);

        registerEntityTenant(po.id, requestTenant ?? (request.user as any)?.tenant_id);
        registerEntityCreator(po.id, request.user?.sub);

        return reply.status(importRes.prior_result ? 200 : 201).send(po);
      }

      const actor = request.user?.sub || 'system';
      const correlationId =
        (reply.getHeader('x-correlation-id') as string | undefined) ??
        (request as any).correlationId ??
        (typeof request.headers['x-correlation-id'] === 'string'
          ? request.headers['x-correlation-id']
          : undefined);

      let created;
      if (poService) {
        created = await poService.createPurchaseOrder(parsed.data, { actor, correlationId });
      } else {
        created = await service!.createPurchaseOrder(parsed.data);
      }

      registerEntityTenant(created.id, requestTenant ?? (request.user as any)?.tenant_id);
      registerEntityCreator(created.id, request.user?.sub);

      return reply.status(201).send(created);
    }
  );

  // 4. PATCH /purchase-orders/:id — update status transition
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
      const validUuid = UuidSchema.safeParse(id);
      if (!validUuid.success) {
        const correlationId =
          (reply.getHeader('x-correlation-id') as string | undefined) ??
          (request as any).correlationId ??
          (request.headers['x-correlation-id'] as string | undefined) ??
          (request.headers['x-request-id'] as string | undefined) ??
          randomUUID();
        reply.header('x-correlation-id', correlationId);
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_UUID',
          message: 'Purchase Order ID must be a valid UUID v4',
          details: [],
          correlation_id: correlationId,
        });
      }

      const parsed = UpdatePurchaseOrderStatusRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        const correlationId =
          (reply.getHeader('x-correlation-id') as string | undefined) ??
          (request as any).correlationId ??
          (request.headers['x-correlation-id'] as string | undefined) ??
          (request.headers['x-request-id'] as string | undefined) ??
          randomUUID();
        reply.header('x-correlation-id', correlationId);
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid status transition request',
          details: parsed.error.issues,
          correlation_id: correlationId,
        });
      }

      const existing = poService
        ? await poService.getPurchaseOrderById(id)
        : await service!.getPurchaseOrderById(id);

      assertObjectMutationAccess(
        request.user,
        existing,
        request.headers['x-tenant-id'] as string | undefined
      );

      const actor = request.user?.sub || 'system';
      const correlationId =
        (reply.getHeader('x-correlation-id') as string | undefined) ??
        (request as any).correlationId ??
        (typeof request.headers['x-correlation-id'] === 'string'
          ? request.headers['x-correlation-id']
          : undefined);

      if (poService) {
        const updated = await poService.updatePurchaseOrderStatus(id, parsed.data.status, {
          actor,
          correlationId,
        });
        return reply.status(200).send(updated);
      }

      const updated = await service!.updatePurchaseOrderStatus(id, parsed.data.status);
      return reply.status(200).send(updated);
    }
  );
};
