/**
 * ERP-3 Payments Routes (Issue #28 / ERP3-03)
 *
 * Implements:
 *   - POST /payments (record one full payment per invoice, automatically transition
 *     invoice status to Paid in the same transaction, and support atomic import idempotency)
 *
 * @module erp3/routes/payments
 */

import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import {
  CreatePaymentRequestSchema,
  PaymentListQuerySchema,
} from "@clearshift/contracts";
import { requireErp3Policy } from "../policies/authorization.js";
import { auditRequest, type Erp3AuditService } from "../services/audit.js";
import type { Erp3Service } from "../services/erp3.service.js";

export const paymentRoutes: FastifyPluginAsync<{
  erp3Service: Erp3Service;
  auditService: Erp3AuditService;
}> = async (fastify, opts) => {
  const service = opts.erp3Service;
  const auditService = opts.auditService;

  // GET /payments
  fastify.get("/payments", {
    preHandler: [requireErp3Policy("PAYMENTS_READ", auditService)],
  }, async (request, reply) => {
    const parsedQuery = PaymentListQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      const correlationId =
        (request.headers["x-correlation-id"] as string | undefined) ??
        (request.headers["x-request-id"] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message: "Invalid query parameters for payments",
        details: parsedQuery.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
        correlation_id: correlationId,
      });
    }

    const result = await service.listPayments(parsedQuery.data);
    return reply.status(200).send(result);
  });

  // POST /payments
  fastify.post("/payments", {
    preHandler: [requireErp3Policy("PAYMENTS_CREATE", auditService)],
  }, async (request, reply) => {
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

    const parsed = CreatePaymentRequestSchema.safeParse(bodyToValidate);
    if (!parsed.success) {
      const correlationId =
        (request.headers["x-correlation-id"] as string | undefined) ??
        (request.headers["x-request-id"] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid payment payload",
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
        source_system: null,
        source_id: null,
        idempotency_key: parsed.data.idempotency_key,
        entity: "payment",
        record: parsed.data as unknown as Record<string, unknown>,
      });
      if (!importRes.prior_result) {
        await auditRequest(auditService, request, {
          action: "load.requested",
          targetEntity: "payment",
          targetId: importRes.target_id,
          batchId: parsed.data.batch_id,
          result: "success",
          metadata: { module: "erp-3", rowCount: 1 },
        });
        await auditRequest(auditService, request, {
          action: "erp.invoice.status_changed",
          targetEntity: "invoice",
          targetId: parsed.data.invoice_id,
          result: "success",
          metadata: { status: "Paid", source: "migration_import" },
        });
      }
      return reply
        .status(importRes.prior_result ? 200 : 201)
        .send(importRes.receipt.response_payload);
    }

    const created = await service.createPayment(parsed.data);
    await auditRequest(auditService, request, {
      action: "erp.payment.created",
      targetEntity: "payment",
      targetId: created.id,
      result: "success",
    });
    await auditRequest(auditService, request, {
      action: "erp.invoice.status_changed",
      targetEntity: "invoice",
      targetId: created.invoice_id,
      result: "success",
      metadata: { status: "Paid" },
    });
    return reply.status(201).send(created);
  });
};
