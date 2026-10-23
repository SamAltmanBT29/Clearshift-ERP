/**
 * ERP-1 Stock Routes
 *
 * Exposes:
 *   GET  /api/v1/erp-products/stock
 *   POST /api/v1/erp-products/stock/opening
 *
 * @module erp1/routes/stock
 */

import type { FastifyPluginAsync } from 'fastify';
import { SetOpeningStockInputSchema } from '@clearshift/contracts';
import type { Erp1Service } from '../services/erp1.service.js';
import { Erp1DomainError } from '../domain/rules.js';

export const stockRoutes: FastifyPluginAsync<{ erp1Service: Erp1Service }> = async (
  fastify,
  options
) => {
  const { erp1Service } = options;

  // GET /stock
  fastify.get('/stock', async (request, reply) => {
    const query = request.query as { productId?: string; warehouseId?: string };
    const list = await erp1Service.listStock(query);
    return reply.status(200).send({
      items: list,
      total: list.length,
      page: 1,
      pageSize: Math.max(1, list.length),
    });
  });

  // POST /stock/opening
  fastify.post('/stock/opening', async (request, reply) => {
    const raw = request.body as Record<string, unknown> | undefined;
    if (raw && typeof raw['quantity'] !== 'undefined') {
      const qNum = typeof raw['quantity'] === 'number' ? raw['quantity'] : parseFloat(String(raw['quantity']));
      if (!isNaN(qNum) && qNum < 0) {
        throw new Erp1DomainError(
          'Stock quantity cannot become negative (BR-ERP1-02)',
          'NEGATIVE_STOCK',
          422,
          'quantity'
        );
      }
    }
    const input = SetOpeningStockInputSchema.parse(request.body);
    const stock = await erp1Service.setOpeningStock(input);
    return reply.status(200).send(stock);
  });
};
