/**
 * ERP-3 Invoices Routes (Issue #28 / ERP3-03)
 *
 * Implements:
 *   - POST /invoices (create invoice with mandatory due_date, unique invoice_number,
 *     1:1 V1 sales order constraint, server-computed line taxes & total, and atomic
 *     import idempotency)
 *   - GET /invoices/:id (minimal read-back route to verify mutation/payment state;
 *     paginated list/search GET /invoices is owned by Issue #27 / ERP3-02)
 *
 * @module erp3/routes/invoices
 */

import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import {
  CreateInvoiceRequestSchema,
  Erp3IdParamSchema,
  InvoiceListQuerySchema,
} from "@clearshift/contracts";
import { requireErp3Policy } from "../policies/authorization.js";
import { auditRequest, type Erp3AuditService } from "../services/audit.js";
import type { Erp3Service } from "../services/erp3.service.js";

export const invoiceRoutes: FastifyPluginAsync<{
  erp3Service: Erp3Service;
  auditService: Erp3AuditService;
}> = async (fastify, opts) => {
  const service = opts.erp3Service;
  const auditService = opts.auditService;

  // GET /invoices (paginated list/search)
  fastify.get("/invoices", {
    preHandler: [requireErp3Policy("INVOICES_READ", auditService)],
  }, async (request, reply) => {
    const parsedQuery = InvoiceListQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      const correlationId =
        (request.headers["x-correlation-id"] as string | undefined) ??
        (request.headers["x-request-id"] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message: "Invalid query parameters for invoices",
        details: parsedQuery.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
        correlation_id: correlationId,
      });
    }

    const result = await service.listInvoices(parsedQuery.data);
    return reply.status(200).send(result);
  });

  // Minimal by-ID read-back for mutation verification (list/search is #27 scope)
  fastify.get("/invoices/:id", {
    preHandler: [requireErp3Policy("INVOICES_READ", auditService)],
  }, async (request, reply) => {
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
        message: "Invoice ID must be a valid UUID v4",
        details: parsedParams.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
        correlation_id: correlationId,
      });
    }

    const invoice = await service.getInvoiceById(parsedParams.data.id);
    return reply.status(200).send(invoice);
  });

  // POST /invoices
  fastify.post("/invoices", {
    preHandler: [requireErp3Policy("INVOICES_CREATE", auditService)],
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

    const parsed = CreateInvoiceRequestSchema.safeParse(bodyToValidate);
    if (!parsed.success) {
      const correlationId =
        (request.headers["x-correlation-id"] as string | undefined) ??
        (request.headers["x-request-id"] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid invoice payload",
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
        entity: "invoice",
        record: parsed.data as unknown as Record<string, unknown>,
      });
      const invoice = await service.getInvoiceById(importRes.target_id);
      if (!importRes.prior_result) {
        await auditRequest(auditService, request, {
          action: "load.requested",
          targetEntity: "invoice",
          targetId: invoice.id,
          batchId: parsed.data.batch_id,
          result: "success",
          metadata: { module: "erp-3", rowCount: 1 },
        });
      }
      return reply.status(importRes.prior_result ? 200 : 201).send(invoice);
    }

    const created = await service.createInvoice(parsed.data);
    await auditRequest(auditService, request, {
      action: "erp.invoice.created",
      targetEntity: "invoice",
      targetId: created.id,
      result: "success",
    });
    return reply.status(201).send(created);
  });
};
