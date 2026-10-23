/**
 * ERP-1 Products Routes
 *
 * GET   /products      — search by name/SKU with bounded pagination
 * GET   /products/{id} — read one product
 * POST  /products      — create a product
 * PATCH /products/{id} — edit editable product fields
 *
 * @module erp1/routes/products
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  CreateProductInputSchema,
  Erp1IdParamSchema,
  ProductListQuerySchema,
  UpdateProductInputSchema,
} from '@clearshift/contracts';
import { erp1IngestGuard, erp1ReadGuard, erp1WriteGuard } from './guard.js';
import { parseWriteBody } from './parsing.js';
import type { Erp1RouteOptions } from './types.js';

export const productsRoutes: FastifyPluginAsync<Erp1RouteOptions> = async (fastify, opts) => {
  const { erp1Service } = opts;

  fastify.get(
    '/products',
    { preHandler: erp1ReadGuard },
    async (request, reply) => {
      const query = ProductListQuerySchema.parse(request.query);
      const page = await erp1Service.listProducts(query);

      return reply.status(200).send({
        items: page.items,
        total: page.total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(page.total / query.pageSize),
      });
    }
  );

  fastify.get(
    '/products/:id',
    { preHandler: erp1ReadGuard },
    async (request, reply) => {
      const { id } = Erp1IdParamSchema.parse(request.params);
      const product = await erp1Service.getProductById(id);
      return reply.status(200).send(product);
    }
  );

  fastify.get(
    '/products/:id/linked-records',
    { preHandler: erp1ReadGuard },
    async (request, reply) => {
      const { id } = Erp1IdParamSchema.parse(request.params);
      const product = await erp1Service.getProductById(id);
      const defaultWh = await erp1Service.getDefaultWarehouse();
      const stockList = await erp1Service.listStockLevels({
        productId: product.id,
        page: 1,
        pageSize: 100,
      });

      const stockLevels = await Promise.all(
        stockList.items.map(async (level) => {
          const wh =
            level.warehouseId === defaultWh?.id
              ? defaultWh
              : (await erp1Service.getWarehouseById(level.warehouseId)) ?? defaultWh;
          return {
            warehouseId: level.warehouseId,
            warehouseCode: wh?.code ?? 'WH-01',
            warehouseName: wh?.name ?? 'Main Warehouse',
            quantity: level.quantity,
            unitOfMeasure: product.unitOfMeasure,
            updatedAt: level.updatedAt,
          };
        })
      );

      return reply.status(200).send({
        productId: product.id,
        stockLevels,
        purchaseOrders: [],
        salesOrders: [],
      });
    }
  );

  fastify.post(
    '/products',
    { preHandler: erp1IngestGuard },
    async (request, reply) => {
      const body = parseWriteBody(CreateProductInputSchema, request);
      const result = await erp1Service.createProductWithIdempotency(body);

      return reply.status(result.priorResult ? 200 : 201).send({
        ...result.entity,
        prior_result: result.priorResult,
      });
    }
  );

  fastify.patch(
    '/products/:id',
    { preHandler: erp1WriteGuard },
    async (request, reply) => {
      const { id } = Erp1IdParamSchema.parse(request.params);
      const body = UpdateProductInputSchema.parse(request.body ?? {});
      const product = await erp1Service.updateProduct(id, body);
      return reply.status(200).send(product);
    }
  );
};
