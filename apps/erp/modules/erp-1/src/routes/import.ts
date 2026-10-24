/**
 * ERP-1 Public Import Routes (KIT-08 / Decision C4)
 *
 * Exposes endpoints for the Migration Kit to load records
 * safely through the public API without direct target-table database access:
 *
 *   POST /api/v1/erp-products/import
 *     Single-row import with per-row idempotency key and optional upsert flag.
 *     Returns 201 on fresh load, 200 on idempotent replay.
 *
 *   POST /api/v1/erp-products/import/batch
 *     Batch import: processes an array of rows sequentially via Erp1TargetAdapter.
 *     Returns 200 with per-row outcomes and aggregate totals.
 *
 * @module erp1/routes/import
 */

import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ImportRowRequestSchema } from '@clearshift/contracts';
import { Erp1TargetAdapter } from '../migration/target-adapter.js';
import { erp1IngestGuard } from './guard.js';
import type { Erp1RouteOptions } from './types.js';

const BatchRowInputSchema = z.object({
  source_row: z.number().int().nonnegative(),
  idempotency_key: z.string().min(1).max(128),
  source_system: z.string().max(64).optional().nullable(),
  source_id: z.string().max(128).optional().nullable(),
  record: z.record(z.string(), z.unknown()),
});

const ImportBatchRequestSchema = z.object({
  batch_id: z.string().uuid({ message: 'batch_id must be a valid UUID' }),
  entity: z.string().min(1).max(64),
  upsert: z.boolean().optional().default(false),
  chunk_size: z.number().int().positive().max(500).optional(),
  failure_threshold: z.number().min(0).max(1).optional(),
  min_attempted_rows: z.number().int().nonnegative().optional(),
  rows: z.array(BatchRowInputSchema).min(1),
});

export const importRoutes: FastifyPluginAsync<Erp1RouteOptions> = async (fastify, opts) => {
  const { erp1Service } = opts;

  fastify.post('/import', { preHandler: erp1IngestGuard }, async (request, reply) => {
    const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;
    const rawBody =
      request.body && typeof request.body === 'object'
        ? (request.body as Record<string, unknown>)
        : {};

    const bodyToValidate = {
      ...rawBody,
      idempotency_key: idempotencyHeader || rawBody['idempotency_key'],
    };

    const parsed = ImportRowRequestSchema.safeParse(bodyToValidate);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid import row request',
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      });
    }

    const upsert = typeof rawBody['upsert'] === 'boolean' ? rawBody['upsert'] : false;
    const result = await erp1Service.importRow({
      ...parsed.data,
      record: parsed.data.record as Record<string, unknown>,
      upsert,
    });

    const statusCode = result.prior_result ? 200 : 201;
    return reply.status(statusCode).send(result);
  });

  fastify.post('/import/batch', { preHandler: erp1IngestGuard }, async (request, reply) => {
    const rawBody =
      request.body && typeof request.body === 'object'
        ? (request.body as Record<string, unknown>)
        : {};

    const parsed = ImportBatchRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid batch import request',
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
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

    const adapter = new Erp1TargetAdapter(erp1Service, entity);

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

    return reply.status(200).send(result);
  });
};
