/**
 * ERP-1 Stock Routes
 *
 * GET  /stock         — list stock levels with product/warehouse filters
 * POST /stock/opening — idempotent opening-stock load for the Kit
 *
 * @module erp1/routes/stock
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  SetOpeningStockInputSchema,
  StockLevelListQuerySchema,
} from '@clearshift/contracts';
import { erp1IngestGuard, erp1ReadGuard } from './guard.js';
import { parseWriteBody } from './parsing.js';
import type { Erp1RouteOptions } from './types.js';

export const stockRoutes: FastifyPluginAsync<Erp1RouteOptions> = async (fastify, opts) => {
  const { erp1Service } = opts;

  fastify.get('/stock', { preHandler: erp1ReadGuard }, async (request, reply) => {
    const query = StockLevelListQuerySchema.parse(request.query);
    const page = await erp1Service.listStockLevels(query);

    const response: Record<string, unknown> = {
      items: page.items,
      total: page.total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(page.total / query.pageSize),
    };

    // Backwards compatibility with the original single-product contract:
    // a `productId` filter also exposes the matching level at the top level.
    if (query.productId !== undefined && page.items.length === 1) {
      Object.assign(response, page.items[0]);
    }

    return reply.status(200).send(response);
  });

  fastify.post(
    '/stock/opening',
    { preHandler: erp1IngestGuard },
    async (request, reply) => {
      const body = parseWriteBody(SetOpeningStockInputSchema, request);
      const result = await erp1Service.setOpeningStock(body);

      return reply.status(200).send({
        ...result.entity,
        prior_result: result.priorResult,
        ...(result.receipt !== undefined && {
          import_receipt: {
            id: result.receipt.id,
            batch_id: result.receipt.batchId,
            source_row: result.receipt.sourceRow,
            target_id: result.receipt.targetId,
            target_entity: result.receipt.targetEntity,
            idempotency_key: result.receipt.idempotencyKey,
            outcome: result.receipt.outcome,
            created_at: result.receipt.createdAt,
          },
        }),
      });
    }
  );
};
