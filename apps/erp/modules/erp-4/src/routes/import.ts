/**
 * ERP-4 Public Import Route (KIT-08 / Decision C4)
 *
 * Exposes POST /api/v1/erp-finance/import for the Migration Kit to load records
 * safely through the public API without direct target-table database access.
 *
 * @module erp4/routes/import
 */

import type { FastifyPluginAsync } from 'fastify';
import { ImportRowRequestSchema } from '@clearshift/contracts';
import type { FinanceService } from '../services/finance.service.js';

export interface ImportRoutesOptions {
  financeService: FinanceService;
}

export const importRoutes: FastifyPluginAsync<ImportRoutesOptions> = async (
  fastify,
  opts
) => {
  const service = opts.financeService;

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

    const result = await service.importRow(parsed.data);

    // If idempotent replay of identical key & payload: HTTP 200; if fresh mutation: HTTP 201
    const statusCode = result.prior_result ? 200 : 201;
    return reply.status(statusCode).send(result);
  });
};
