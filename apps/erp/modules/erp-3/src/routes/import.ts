/**
 * ERP-3 Public Import Route (KIT-08 / Decision C4 / Issue #28)
 *
 * Exposes POST /api/v1/erp-orders/import for the Migration Kit to load
 * sales_order, invoice, and payment rows atomically with durable import receipts.
 *
 * @module erp3/routes/import
 */

import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { ImportRowRequestSchema } from "@clearshift/contracts";
import type { Erp3Service } from "../services/erp3.service.js";

export const importRoutes: FastifyPluginAsync<{
  erp3Service: Erp3Service;
}> = async (fastify, opts) => {
  const service = opts.erp3Service;

  fastify.post("/import", async (request, reply) => {
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
    return reply.status(result.prior_result ? 200 : 201).send(result);
  });
};
