/**
 * ERP-3 Public Import Routes (KIT-08 / Decision C4 / Issue #32 / Issue #147)
 *
 * Exposes endpoints for the Migration Kit to load
 * sales_order, invoice, and payment rows atomically with durable import receipts:
 *
 *   POST /api/v1/erp-orders/import
 *     Single-row import with per-row idempotency key.
 *     Returns 201 on fresh load, 200 on idempotent replay.
 *
 *   POST /api/v1/erp-orders/import/batch
 *     Batch row import via Erp3TargetAdapter.loadBatch.
 *     Sequential chunked processing (500 rows), bounded retry on transient errors,
 *     and 10% failure rate threshold stop behavior.
 *
 * @module erp3/routes/import
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { ImportRowRequestSchema } from "@clearshift/contracts";
import { requireErp3Policy } from "../policies/authorization.js";
import { auditRequest, type Erp3AuditService } from "../services/audit.js";
import type { Erp3Service } from "../services/erp3.service.js";
import { Erp3TargetAdapter } from "../migration/target-adapter.js";

const BatchRowInputSchema = z.object({
  source_row: z.number().int().nonnegative(),
  idempotency_key: z.string().min(1).max(128),
  source_system: z.string().max(64).optional().nullable(),
  source_id: z.string().max(128).optional().nullable(),
  record: z.record(z.string(), z.unknown()),
});

const ImportBatchRequestSchema = z.object({
  batch_id: z
    .string()
    .uuid({ message: "batch_id must be a valid UUID" }),
  entity: z.enum(["sales_order", "invoice", "payment"]),
  upsert: z.boolean().optional().default(false),
  chunk_size: z.number().int().positive().max(500).optional(),
  failure_threshold: z.number().min(0).max(1).optional(),
  min_attempted_rows: z.number().int().nonnegative().optional(),
  rows: z.array(BatchRowInputSchema).min(1),
});

export const importRoutes: FastifyPluginAsync<{
  erp3Service: Erp3Service;
  auditService: Erp3AuditService;
}> = async (fastify, opts) => {
  const service = opts.erp3Service;
  const auditService = opts.auditService;

  /**
   * POST /import
   * Single-row import endpoint (KIT-08 / Decision C4).
   */
  fastify.post("/import", {
    preHandler: [requireErp3Policy("IMPORT_EXECUTE", auditService)],
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

    const parsed = ImportRowRequestSchema.safeParse(bodyToValidate);
    if (!parsed.success) {
      const correlationId =
        (request.headers["x-correlation-id"] as string | undefined) ??
        (request.headers["x-request-id"] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message:
          parsed.error.issues[0]?.message ?? "Invalid import row request",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
        correlation_id: correlationId,
      });
    }

    const result = await service.importRow(parsed.data);
    if (!result.prior_result) {
      await auditRequest(auditService, request, {
        action: "load.requested",
        targetEntity: parsed.data.entity,
        targetId: result.target_id,
        batchId: parsed.data.batch_id,
        result: "success",
        metadata: { module: "erp-3", rowCount: 1 },
      });
    }
    return reply.status(result.prior_result ? 200 : 201).send(result);
  });

  /**
   * POST /import/batch
   * Batch row import endpoint (ERP3-11 / KIT-08 / Decision C4).
   */
  fastify.post("/import/batch", {
    preHandler: [requireErp3Policy("IMPORT_EXECUTE", auditService)],
  }, async (request, reply) => {
    const rawBody = (
      request.body && typeof request.body === "object" ? request.body : {}
    ) as Record<string, unknown>;

    const parsed = ImportBatchRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const correlationId =
        (request.headers["x-correlation-id"] as string | undefined) ??
        (request.headers["x-request-id"] as string | undefined) ??
        randomUUID();
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message:
          parsed.error.issues[0]?.message ?? "Invalid batch import request",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
        correlation_id: correlationId,
      });
    }

    const {
      batch_id,
      entity,
      upsert,
      chunk_size,
      failure_threshold,
      min_attempted_rows,
      rows,
    } = parsed.data;

    const adapter = new Erp3TargetAdapter(service, entity);
    const batchRows = rows.map((r) => ({
      sourceRow: r.source_row,
      idempotencyKey: r.idempotency_key,
      sourceSystem: r.source_system ?? undefined,
      sourceId: r.source_id ?? undefined,
      data: r.record,
    }));

    const result = await adapter.loadBatch(batch_id, batchRows, {
      upsert,
      chunkSize: chunk_size,
      failureThreshold: failure_threshold,
      minAttemptedRows: min_attempted_rows,
    });

    await auditRequest(auditService, request, {
      action: "load.requested",
      targetEntity: entity,
      batchId: batch_id,
      result: result.status === "COMPLETED" ? "success" : "failure",
      metadata: {
        module: "erp-3",
        total: result.total,
        loaded: result.loaded,
        rejected: result.rejected,
        status: result.status,
      },
    });

    return reply.status(200).send(result);
  });
};
