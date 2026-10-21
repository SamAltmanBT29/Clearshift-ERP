/**
 * ERP-2 Vendor Route Handlers
 *
 * Implements:
 *   - GET /api/v1/erp-vendors/vendors (search, paged)
 *   - POST /api/v1/erp-vendors/vendors
 *   - PATCH /api/v1/erp-vendors/vendors/:id
 *
 * @module erp2/routes/vendors
 */

import { FastifyPluginAsync } from 'fastify';
import {
  VendorListQuerySchema,
  CreateVendorRequestSchema,
  UpdateVendorRequestSchema,
  UuidSchema,
} from '@clearshift/contracts';
import { ERP2_ENDPOINT_ROLES } from '../policies/rbac.js';
import { requireRoles } from '../plugins/auth.js';
import type { VendorService } from '../services/vendor.service.js';

export interface VendorRoutesOptions {
  vendorService: VendorService;
}

export const vendorRoutes: FastifyPluginAsync<VendorRoutesOptions> = async (
  fastify,
  options
) => {
  const { vendorService } = options;

  // 1. GET /vendors — search, paged
  fastify.get(
    '/vendors',
    {
      preHandler: [fastify.authenticate, requireRoles(ERP2_ENDPOINT_ROLES.LIST_VENDORS)],
    },
    async (request, reply) => {
      const query = VendorListQuerySchema.parse(request.query);
      const result = await vendorService.listVendors(query);
      return reply.status(200).send(result);
    }
  );

  // 2. GET /vendors/:id — get vendor by ID
  fastify.get(
    '/vendors/:id',
    {
      preHandler: [fastify.authenticate, requireRoles(ERP2_ENDPOINT_ROLES.LIST_VENDORS)],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      UuidSchema.parse(id);

      const vendor = await vendorService.getVendorById(id);
      return reply.status(200).send(vendor);
    }
  );

  // 3. POST /vendors — create vendor
  fastify.post(
    '/vendors',
    {
      preHandler: [fastify.authenticate, requireRoles(ERP2_ENDPOINT_ROLES.CREATE_VENDOR)],
    },
    async (request, reply) => {
      const body = CreateVendorRequestSchema.parse(request.body);
      const actor = request.user?.sub || 'system';
      const correlationId =
        (request as any).correlationId ??
        (typeof request.headers['x-correlation-id'] === 'string'
          ? request.headers['x-correlation-id']
          : undefined);

      const created = await vendorService.createVendor(body, { actor, correlationId });
      return reply.status(201).send(created);
    }
  );

  // 4. PATCH /vendors/:id — edit vendor
  fastify.patch(
    '/vendors/:id',
    {
      preHandler: [fastify.authenticate, requireRoles(ERP2_ENDPOINT_ROLES.UPDATE_VENDOR)],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      UuidSchema.parse(id);

      const body = UpdateVendorRequestSchema.parse(request.body);
      const actor = request.user?.sub || 'system';
      const correlationId =
        (request as any).correlationId ??
        (typeof request.headers['x-correlation-id'] === 'string'
          ? request.headers['x-correlation-id']
          : undefined);

      const updated = await vendorService.updateVendor(id, body, { actor, correlationId });
      return reply.status(200).send(updated);
    }
  );
};
