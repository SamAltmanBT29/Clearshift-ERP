/**
 * ERP-3 Sales Orders Routes (Issue #28 / ERP3-03)
 *
 * Implements:
 *   - POST /sales-orders (create sales order with server-computed line taxes & total,
 *     mandatory customer Golden ID, product verification, and atomic import idempotency)
 *   - PATCH /sales-orders/:id (allowed forward-only status transition only; rejects
 *     attempts to modify protected/immutable fields)
 *   - GET /sales-orders/:id (minimal read-back route to verify mutation state;
 *     paginated list/search GET /sales-orders is owned by Issue #27 / ERP3-02)
 *
 * @module erp3/routes/sales-orders
 */

import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import {
  CreateSalesOrderRequestSchema,
  Erp3IdParamSchema,
  UpdateSalesOrderStatusRequestSchema,
} from "@clearshift/contracts";
import type { Erp3Service } from "../services/erp3.service.js";

const STRICT_UPDATE_STATUS_SCHEMA = UpdateSalesOrderStatusRequestSchema.strict();

export const salesOrderRoutes: FastifyPluginAsync<{
  erp3Service: Erp3Service;
}> = async (fastify, opts) => {
  const service = opts.erp3Service;

  // Minimal by-ID read-back for mutation verification (list/search is #27 scope)
  fastify.get("/sales-orders/:id", async (request, reply) => {
    const parsedParams = Erp3IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      const correlationId =
        (request.headers["x-correlation-id"] as string | undefined) ??
        (request.headers["x-request-id"] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        code: "INVALID_UUID",
        message: "Sales order ID must be a valid UUID v4",
        details: parsedParams.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
        correlation_id: correlationId,
      });
    }

    const order = await service.getSalesOrderById(parsedParams.data.id);
    return reply.status(200).send(order);
  });

  // POST /sales-orders
  fastify.post("/sales-orders", async (request, reply) => {
    const idempotencyHeader = request.headers["idempotency-key"] as
      | string
      | undefined;
    const rawBody = (
      request.body && typeof request.body === "object" ? request.body : {}
    ) as Record<string, unknown>;

    const bodyToValidate: Record<string, unknown> = {
      ...rawBody,
      ...(idempotencyHeader || rawBody["idempotency_key"] !== undefined
        ? {
            idempotency_key: idempotencyHeader ?? rawBody["idempotency_key"],
          }
        : {}),
    };

    const parsed = CreateSalesOrderRequestSchema.safeParse(bodyToValidate);
    if (!parsed.success) {
      const correlationId =
        (request.headers["x-correlation-id"] as string | undefined) ??
        (request.headers["x-request-id"] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid sales order payload",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
        correlation_id: correlationId,
      });
    }

    // Atomic import dual-write when batch_id and idempotency_key are supplied
    if (parsed.data.batch_id && parsed.data.idempotency_key) {
      const importRes = await service.importRow({
        batch_id: parsed.data.batch_id,
        source_row: parsed.data.source_row ?? 0,
        source_system: parsed.data.source_system ?? null,
        source_id: parsed.data.source_id ?? null,
        idempotency_key: parsed.data.idempotency_key,
        entity: "sales_order",
        record: parsed.data as unknown as Record<string, unknown>,
      });
      const order = await service.getSalesOrderById(importRes.target_id);
      return reply.status(importRes.prior_result ? 200 : 201).send(order);
    }

    const created = await service.createSalesOrder(parsed.data);
    return reply.status(201).send(created);
  });

  // PATCH /sales-orders/:id (allowed status transition only)
  fastify.patch("/sales-orders/:id", async (request, reply) => {
    const parsedParams = Erp3IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      const correlationId =
        (request.headers["x-correlation-id"] as string | undefined) ??
        (request.headers["x-request-id"] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        code: "INVALID_UUID",
        message: "Sales order ID must be a valid UUID v4",
        details: parsedParams.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
        correlation_id: correlationId,
      });
    }

    const parsedBody = STRICT_UPDATE_STATUS_SCHEMA.safeParse(request.body);
    if (!parsedBody.success) {
      const correlationId =
        (request.headers["x-correlation-id"] as string | undefined) ??
        (request.headers["x-request-id"] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message:
          parsedBody.error.issues[0]?.message ??
          "Invalid sales order status transition payload",
        details: parsedBody.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
        correlation_id: correlationId,
      });
    }

    const updated = await service.updateSalesOrderStatus(
      parsedParams.data.id,
      parsedBody.data.status,
    );
    return reply.status(200).send(updated);
  });
};
