/**
 * ERP-1 Migration Metadata and Rejection Review Routes
 *
 * Exposes:
 *   GET /api/v1/erp-products/migration-metadata
 *   GET /api/v1/erp-products/rejections
 *
 * @module erp1/routes/metadata
 */

import type { FastifyPluginAsync } from 'fastify';
import { erp1KitMetadata } from '../kit/field-registry.js';
import { erp1FailureExplanations } from '../kit/rejection-context.js';

export const metadataRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /migration-metadata
  fastify.get('/migration-metadata', async (_request, reply) => {
    return reply.status(200).send(erp1KitMetadata);
  });

  // GET /rejections
  fastify.get('/rejections', async (_request, reply) => {
    return reply.status(200).send({
      module: 'erp1',
      title: 'ERP-1 Products & Inventory Rejection Rules',
      rules: erp1FailureExplanations,
      timestamp: new Date().toISOString(),
    });
  });
};

