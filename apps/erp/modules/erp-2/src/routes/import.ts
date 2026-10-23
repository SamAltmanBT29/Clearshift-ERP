/**
 * ERP-2 Public Import Routes (KIT-08 / Decision C4, ERP2-11)
 *
 * Exposes two endpoints for the Migration Kit to load records
 * safely through the public API without direct target-table database access:
 *
 *   POST /api/v1/erp-vendors/import
 *     Single-row import with per-row idempotency key and optional upsert flag.
 *     Returns 201 on fresh load, 200 on idempotent replay.
 *
 *   POST /api/v1/erp-vendors/import/batch
 *     Batch import: processes an array of rows sequentially.
 *     Each row has its own idempotency key ensuring replay-safety.
 *     Returns 200 with per-row outcomes and aggregate totals.
 *     A data-validation failure on one row does NOT abort subsequent rows.
 *
 * @module erp2/routes/import
 */

import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ImportRowRequestSchema } from '@clearshift/contracts';
import type { Erp2Service } from '../services/erp2.service.js';
import { Erp2TargetAdapter } from '../migration/target-adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Batch request schema (ERP2-11)
// ─────────────────────────────────────────────────────────────────────────────

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
    .uuid({ message: 'batch_id must be a valid UUID' }),
  entity: z.enum(['vendor', 'purchase_order']),
  /** When true, existing records with matching natural keys will be updated. */
  upsert: z.boolean().optional().default(false),
  rows: z.array(BatchRowInputSchema).min(1).max(500),
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export const importRoutes: FastifyPluginAsync<{ erp2Service: Erp2Service }> = async (
  fastify,
  opts
) => {
  const service = opts.erp2Service;

  /**
   * POST /import
   * Single-row import endpoint (KIT-08 / Decision C4).
   */
  fastify.post('/import', async (request, reply) => {
    const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;

    const rawBody = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
    const bodyToValidate = {
      ...rawBody,
      idempotency_key: idempotencyHeader || rawBody['idempotency_key'],
    };

    const parsed = ImportRowRequestSchema.safeParse(bodyToValidate);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid import row request',
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      });
    }

    // Propagate upsert flag if present in the body
    const upsert = typeof rawBody['upsert'] === 'boolean' ? rawBody['upsert'] : false;
    const result = await service.importRow({ ...parsed.data, upsert } as any);

    // If idempotent replay of identical key & payload: HTTP 200; if fresh: HTTP 201
    const statusCode = result.prior_result ? 200 : 201;
    return reply.status(statusCode).send(result);
  });

  /**
   * POST /import/batch
   * Batch row import endpoint (ERP2-11 / KIT-08).
   *
   * Processes rows sequentially via Erp2TargetAdapter.loadBatch.
   * Each row's outcome is independent: data-validation failures are collected
   * per-row without aborting the batch. Infrastructure failures propagate.
   */
  fastify.post('/import/batch', async (request, reply) => {
    const rawBody = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;

    const parsed = ImportBatchRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid batch import request',
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      });
    }

    const { batch_id, entity, upsert, rows } = parsed.data;

    // Instantiate in-process target adapter scoped to the declared entity
    const adapter = new Erp2TargetAdapter(service, entity);

    // Map request rows to BatchRowInput
    const batchRows = rows.map((r) => ({
      sourceRow: r.source_row,
      idempotencyKey: r.idempotency_key,
      sourceSystem: r.source_system ?? undefined,
      sourceId: r.source_id ?? undefined,
      data: r.record,
    }));

    const result = await adapter.loadBatch(batch_id, batchRows, { upsert });

    return reply.status(200).send(result);
  });
};
