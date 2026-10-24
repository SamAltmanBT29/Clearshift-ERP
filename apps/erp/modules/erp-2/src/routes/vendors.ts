/**
 * ERP-2 Vendors Routes
 *
 * Implements:
 *   - GET /vendors (search by name, bounded paging)
 *   - POST /vendors (create vendor, server-side bank details masking, idempotency support)
 *   - GET /vendors/:id (retrieve vendor)
 *   - PATCH /vendors/:id (update editable fields)
 *
 * Security:
 *   - Capability-based authorization via erp2ReadGuard, erp2WriteGuard, erp2IngestGuard
 *   - Object-level tenant and cross-user mutation guards (assertTenantAccess, assertObjectMutationAccess)
 *
 * @module erp2/routes/vendors
 */

import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import {
  VendorListQuerySchema,
  CreateVendorRequestSchema,
  UpdateVendorRequestSchema,
  UuidSchema,
} from '@clearshift/contracts';
import type { Erp2Service } from '../services/erp2.service.js';
import {
  erp2ReadGuard,
  erp2WriteGuard,
  erp2IngestGuard,
  assertTenantAccess,
  assertObjectMutationAccess,
  registerEntityTenant,
  registerEntityCreator,
} from './guard.js';

export const vendorRoutes: FastifyPluginAsync<{ erp2Service: Erp2Service }> = async (
  fastify,
  opts
) => {
  const service = opts.erp2Service;

  // GET /vendors
  fastify.get(
    '/vendors',
    { preHandler: erp2ReadGuard },
    async (request, reply) => {
      const parsed = VendorListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        const correlationId =
          (request.headers['x-correlation-id'] as string | undefined) ??
          (request.headers['x-request-id'] as string | undefined) ??
          randomUUID();
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
          details: parsed.error.issues,
          correlation_id: correlationId,
        });
      }

      const { vendors, total } = await service.listVendors(parsed.data);
      const totalPages = Math.ceil(total / parsed.data.pageSize) || 1;

      return reply.status(200).send({
        items: vendors,
        total,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        totalPages,
      });
    }
  );

  // GET /vendors/:id
  fastify.get(
    '/vendors/:id',
    { preHandler: erp2ReadGuard },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const validUuid = UuidSchema.safeParse(id);
      if (!validUuid.success) {
        const correlationId =
          (request.headers['x-correlation-id'] as string | undefined) ??
          (request.headers['x-request-id'] as string | undefined) ??
          randomUUID();
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_UUID',
          message: 'Vendor ID must be a valid UUID v4',
          details: [],
          correlation_id: correlationId,
        });
      }

      const vendor = await service.getVendorById(id);
      assertTenantAccess(
        request.user,
        vendor,
        request.headers['x-tenant-id'] as string | undefined
      );

      return reply.status(200).send(vendor);
    }
  );

  // POST /vendors
  fastify.post(
    '/vendors',
    { preHandler: erp2IngestGuard },
    async (request, reply) => {
      const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;

      const rawBody = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
      const bodyToValidate = {
        ...rawBody,
        idempotency_key: idempotencyHeader || rawBody['idempotency_key'],
      };

      const parsed = CreateVendorRequestSchema.safeParse(bodyToValidate);
      if (!parsed.success) {
        const correlationId =
          (request.headers['x-correlation-id'] as string | undefined) ??
          (request.headers['x-request-id'] as string | undefined) ??
          randomUUID();
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid vendor data',
          details: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
            code: i.code,
          })),
          correlation_id: correlationId,
        });
      }

      const requestTenant = request.headers['x-tenant-id'] as string | undefined;

      // If batch_id and idempotency_key are present, execute via atomic import dual-write
      if (parsed.data.batch_id && parsed.data.idempotency_key) {
        const importRes = await service.importRow({
          batch_id: parsed.data.batch_id,
          source_row: parsed.data.source_row ?? 0,
          source_system: parsed.data.source_system ?? null,
          source_id: parsed.data.source_id ?? null,
          idempotency_key: parsed.data.idempotency_key,
          entity: 'vendor',
          record: parsed.data as unknown as Record<string, unknown>,
        });
        const vendor = await service.getVendorById(importRes.target_id);

        registerEntityTenant(vendor.id, requestTenant ?? (request.user as any)?.tenant_id);
        registerEntityCreator(vendor.id, request.user?.sub);

        return reply.status(importRes.prior_result ? 200 : 201).send(vendor);
      }

      const vendor = await service.createVendor(parsed.data);

      registerEntityTenant(vendor.id, requestTenant ?? (request.user as any)?.tenant_id);
      registerEntityCreator(vendor.id, request.user?.sub);

      return reply.status(201).send(vendor);
    }
  );

  // PATCH /vendors/:id
  fastify.patch(
    '/vendors/:id',
    { preHandler: erp2WriteGuard },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const validUuid = UuidSchema.safeParse(id);
      if (!validUuid.success) {
        const correlationId =
          (request.headers['x-correlation-id'] as string | undefined) ??
          (request.headers['x-request-id'] as string | undefined) ??
          randomUUID();
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_UUID',
          message: 'Vendor ID must be a valid UUID v4',
          details: [],
          correlation_id: correlationId,
        });
      }

      const parsed = UpdateVendorRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        const correlationId =
          (request.headers['x-correlation-id'] as string | undefined) ??
          (request.headers['x-request-id'] as string | undefined) ??
          randomUUID();
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid vendor update data',
          details: parsed.error.issues,
          correlation_id: correlationId,
        });
      }

      const existing = await service.getVendorById(id);
      assertObjectMutationAccess(
        request.user,
        existing,
        request.headers['x-tenant-id'] as string | undefined
      );

      const updated = await service.updateVendor(id, parsed.data);
      return reply.status(200).send(updated);
    }
  );
};
