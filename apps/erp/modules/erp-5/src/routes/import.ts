/**
 * ERP-5 Public Import Routes (KIT-08 / Decision C4, ERP5-11)
 *
 * Exposes two endpoints for the Migration Kit to load records
 * safely through the public API without direct target-table database access:
 *
 *   POST /api/v1/erp-hr/import
 *     Single-row import with per-row idempotency key and optional upsert flag.
 *     Returns 201 on fresh load, 200 on idempotent replay.
 *
 *   POST /api/v1/erp-hr/import/batch
 *     Batch import: processes an array of rows sequentially in 500-row chunks.
 *     Each row has its own idempotency key ensuring replay-safety.
 *     Returns 200 with per-row outcomes and aggregate totals.
 *     A data-validation failure on one row does NOT abort subsequent rows.
 *
 * @module erp5/routes/import
 */

import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ImportRowRequestSchema } from '@clearshift/contracts';
import type { HrService } from '../services/hr.service.js';
import { HrTargetAdapter } from '../migration/target-adapter.js';
import { erp5IngestGuard, assertTenantAccess } from './guard.js';

// ─────────────────────────────────────────────────────────────────────────────
// Batch request schema (ERP5-11)
// ─────────────────────────────────────────────────────────────────────────────

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
  /** When true, existing records with matching natural keys will be updated. */
  upsert: z.boolean().optional().default(false),
  chunk_size: z.number().int().positive().max(500).optional(),
  failure_threshold: z.number().min(0).max(1).optional(),
  min_attempted_rows: z.number().int().nonnegative().optional(),
  rows: z.array(BatchRowInputSchema).min(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export const importRoutes: FastifyPluginAsync<{ hrService: HrService }> = async (
  fastify,
  opts
) => {
  const service = opts.hrService;

  /**
   * POST /import
   * Single-row import endpoint (KIT-08 / Decision C4).
   */
  fastify.post('/import', { preHandler: erp5IngestGuard }, async (request, reply) => {
    const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;

    const rawBody = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
    assertTenantAccess(request.user, rawBody, request.headers['x-tenant-id'] as string | undefined);

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

    const upsert = typeof rawBody['upsert'] === 'boolean' ? rawBody['upsert'] : false;
    try {
      const result = await service.importRow({
        ...parsed.data,
        record: parsed.data.record as Record<string, unknown>,
        upsert,
      });

      const statusCode = result.prior_result ? 200 : 201;
      return reply.status(statusCode).send(result);
    } catch (error: any) {
      if (error.reasonCode === 'IDEMPOTENCY_CONFLICT' || error.code === 'IDEMPOTENCY_CONFLICT') {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          code: 'IDEMPOTENCY_CONFLICT',
          message: error.message || 'The idempotency key was used with a different payload',
        });
      }
      throw error;
    }
  });

  /**
   * POST /import/batch
   * Batch row import endpoint (ERP5-11 / KIT-08).
   *
   * Processes rows sequentially via HrTargetAdapter.loadBatch.
   * Each row's outcome is independent: data-validation failures are collected
   * per-row without aborting the batch. Infrastructure failures propagate.
   */
  fastify.post('/import/batch', { preHandler: erp5IngestGuard }, async (request, reply) => {
    const rawBody = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
    assertTenantAccess(request.user, rawBody, request.headers['x-tenant-id'] as string | undefined);

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

    const {
      batch_id,
      entity,
      upsert,
      chunk_size,
      failure_threshold,
      min_attempted_rows,
      rows,
    } = parsed.data;

    // Instantiate in-process target adapter scoped to the declared entity
    const adapter = new HrTargetAdapter(service.repository, entity);

    const batchRows = rows.map((r) => {
      const row: any = {
        sourceRow: r.source_row,
        idempotencyKey: r.idempotency_key,
        data: r.record,
      };
      if (r.source_system !== null && r.source_system !== undefined) row.sourceSystem = r.source_system;
      if (r.source_id !== null && r.source_id !== undefined) row.sourceId = r.source_id;
      return row;
    });

    const options: any = { upsert };
    if (chunk_size !== undefined) options.chunkSize = chunk_size;
    if (failure_threshold !== undefined) options.failureThreshold = failure_threshold;
    if (min_attempted_rows !== undefined) options.minAttemptedRows = min_attempted_rows;

    const result = await adapter.loadBatch(batch_id, batchRows, options);

    return reply.status(200).send(result);
  });
};
