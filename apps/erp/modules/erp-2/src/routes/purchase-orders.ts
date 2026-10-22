/**
 * ERP-2 Purchase Orders Routes
 *
 * Implements:
 *   - GET /purchase-orders (list with vendor/status filters, bounded paging)
 *   - GET /purchase-orders/:id (retrieve PO with line items)
 *   - POST /purchase-orders (create PO with lines, server-side calculated totals, ERP-1 product validation)
 *   - PATCH /purchase-orders/:id (allowed status transition only: Draft -> Sent -> Received -> Closed)
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

export const purchaseOrderRoutes: FastifyPluginAsync<{ erp2Service: Erp2Service }> = async (
  fastify,
  opts
) => {
  const service = opts.erp2Service;

  // GET /purchase-orders
  fastify.get('/purchase-orders', async (request, reply) => {
    const parsed = PurchaseOrderListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      const correlationId =
        (request.headers['x-correlation-id'] as string | undefined) ??
        (request.headers['x-request-id'] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
        details: parsed.error.issues,
        correlation_id: correlationId,
      });
    }

    const { purchaseOrders, total } = await service.listPurchaseOrders(parsed.data);
    const totalPages = Math.ceil(total / parsed.data.pageSize) || 1;

    return reply.status(200).send({
      items: purchaseOrders,
      total,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      totalPages,
    });
  });

  // GET /purchase-orders/:id
  fastify.get('/purchase-orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const validUuid = UuidSchema.safeParse(id);
    if (!validUuid.success) {
      const correlationId =
        (request.headers['x-correlation-id'] as string | undefined) ??
        (request.headers['x-request-id'] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'INVALID_UUID',
        message: 'Purchase order ID must be a valid UUID v4',
        details: [],
        correlation_id: correlationId,
      });
    }

    const po = await service.getPurchaseOrderById(id);
    return reply.status(200).send(po);
  });

  // POST /purchase-orders
  fastify.post('/purchase-orders', async (request, reply) => {
    const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;

    const rawBody = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
    const bodyToValidate = {
      ...rawBody,
      idempotency_key: idempotencyHeader || rawBody['idempotency_key'],
    };

    const parsed = CreatePurchaseOrderRequestSchema.safeParse(bodyToValidate);
    if (!parsed.success) {
      const correlationId =
        (request.headers['x-correlation-id'] as string | undefined) ??
        (request.headers['x-request-id'] as string | undefined) ??
        randomUUID();
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

    // If batch_id and idempotency_key are present, execute via atomic import dual-write
    if (parsed.data.batch_id && parsed.data.idempotency_key) {
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
      return reply.status(importRes.prior_result ? 200 : 201).send(po);
    }

    const po = await service.createPurchaseOrder(parsed.data);
    return reply.status(201).send(po);
  });

  // PATCH /purchase-orders/:id (allowed status transition only)
  fastify.patch('/purchase-orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const validUuid = UuidSchema.safeParse(id);
    if (!validUuid.success) {
      const correlationId =
        (request.headers['x-correlation-id'] as string | undefined) ??
        (request.headers['x-request-id'] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'INVALID_UUID',
        message: 'Purchase order ID must be a valid UUID v4',
        details: [],
        correlation_id: correlationId,
      });
    }

    const parsed = UpdatePurchaseOrderStatusRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const correlationId =
        (request.headers['x-correlation-id'] as string | undefined) ??
        (request.headers['x-request-id'] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid purchase order status update',
        details: parsed.error.issues,
        correlation_id: correlationId,
      });
    }

    const updated = await service.updatePurchaseOrderStatus(id, parsed.data.status);
    return reply.status(200).send(updated);
  });
};

