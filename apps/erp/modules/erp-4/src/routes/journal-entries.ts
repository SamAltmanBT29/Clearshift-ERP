/**
 * ERP-4 Finance — Journal Entries Routes
 *
 * GET   /journal-entries            - List journal entries with filter, search, stable sort, and bounded paging
 * GET   /journal-entries/:id        - Get a single journal entry with lines
 * POST  /journal-entries            - Create a new journal entry (draft)
 * PATCH /journal-entries/:id        - Edit draft entry
 * POST  /journal-entries/:id/post   - Approve and post entry (locks entry, enforces double-entry & period guards)
 * POST  /journal-entries/:id/reverse- Reverse a posted entry via compensating reversal
 * POST  /journal-entries/:id/void   - Void draft entry
 *
 * @module erp4/routes/journal-entries
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  JournalEntryListQuerySchema,
  CreateJournalEntryRequestSchema,
  UpdateJournalEntryRequestSchema,
  ReverseJournalEntryRequestSchema,
  IdParamSchema,
} from '@clearshift/contracts';
import type { FinanceService } from '../services/finance.service.js';
import {
  requireFinanceRead,
  requireFinanceWrite,
  requireJournalCreate,
  requireJournalPost,
  assertTenantAccess,
  assertObjectMutationAccess,
  registerEntityTenant,
} from './guard.js';

export interface JournalEntriesRouteOptions {
  financeService: FinanceService;
}

export const journalEntriesRoutes: FastifyPluginAsync<JournalEntriesRouteOptions> = async (
  fastify,
  opts
) => {
  const { financeService } = opts;

  // GET /journal-entries - List journal entries
  fastify.get('/journal-entries', { preHandler: [requireFinanceRead] }, async (request, reply) => {
    const query = JournalEntryListQuerySchema.parse(request.query);
    const response = await financeService.listJournalEntries(query);
    return reply.status(200).send(response);
  });

  // GET /journal-entries/:id - Get journal entry by ID
  fastify.get('/journal-entries/:id', { preHandler: [requireFinanceRead] }, async (request, reply) => {
    const params = IdParamSchema.parse(request.params);
    const entry = await financeService.getJournalEntryById(params.id);
    assertTenantAccess(request.user, entry, request.headers['x-tenant-id'] as string | undefined);
    return reply.status(200).send(entry);
  });

  // POST /journal-entries - Create draft journal entry
  fastify.post('/journal-entries', { preHandler: [requireJournalCreate] }, async (request, reply) => {
    const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;
    const rawBody = (request.body && typeof request.body === 'object') ? request.body : {};
    const body = CreateJournalEntryRequestSchema.parse({
      ...rawBody,
      ...(idempotencyHeader && !(rawBody as any).idempotency_key && { idempotency_key: idempotencyHeader }),
    });

    assertTenantAccess(request.user, body, request.headers['x-tenant-id'] as string | undefined);

    const userId = request.user?.sub ?? 'ffffffff-0001-0001-0001-000000000001';
    const { entry, created } = await financeService.createJournalEntry(body, userId);
    const tenantId = (rawBody as any).tenant_id ?? (request.headers['x-tenant-id'] as string | undefined);
    if (entry?.id && tenantId) {
      registerEntityTenant(entry.id, tenantId);
    }
    return reply.status(created ? 201 : 200).send(entry);
  });

  // PATCH /journal-entries/:id - Update draft journal entry
  fastify.patch('/journal-entries/:id', { preHandler: [requireFinanceWrite] }, async (request, reply) => {
    const params = IdParamSchema.parse(request.params);
    const body = UpdateJournalEntryRequestSchema.parse(request.body);

    const existing = await financeService.getJournalEntryById(params.id);
    assertObjectMutationAccess(request.user, existing, request.headers['x-tenant-id'] as string | undefined);

    const userId = request.user?.sub ?? 'ffffffff-0001-0001-0001-000000000001';
    const updated = await financeService.updateJournalEntry(params.id, body, userId);
    return reply.status(200).send(updated);
  });

  // POST /journal-entries/:id/post - Post entry to ledger
  fastify.post('/journal-entries/:id/post', { preHandler: [requireJournalPost] }, async (request, reply) => {
    const params = IdParamSchema.parse(request.params);

    const existing = await financeService.getJournalEntryById(params.id);
    assertTenantAccess(request.user, existing, request.headers['x-tenant-id'] as string | undefined);

    const user = {
      id: request.user?.sub ?? 'ffffffff-0001-0001-0001-000000000001',
      role: request.user?.roles?.[0] ?? 'editor',
    };
    const posted = await financeService.postJournalEntry(params.id, user);
    return reply.status(200).send(posted);
  });

  // POST /journal-entries/:id/reverse - Reverse entry
  fastify.post('/journal-entries/:id/reverse', { preHandler: [requireFinanceWrite] }, async (request, reply) => {
    const params = IdParamSchema.parse(request.params);
    const body = ReverseJournalEntryRequestSchema.parse(request.body ?? {});

    const existing = await financeService.getJournalEntryById(params.id);
    assertTenantAccess(request.user, existing, request.headers['x-tenant-id'] as string | undefined);

    const user = {
      id: request.user?.sub ?? 'ffffffff-0001-0001-0001-000000000001',
      role: request.user?.roles?.[0] ?? 'editor',
    };
    const result = await financeService.reverseJournalEntry(params.id, body, user);
    return reply.status(200).send(result);
  });

  // POST /journal-entries/:id/void - Void draft entry
  fastify.post('/journal-entries/:id/void', { preHandler: [requireFinanceWrite] }, async (request, reply) => {
    const params = IdParamSchema.parse(request.params);

    const existing = await financeService.getJournalEntryById(params.id);
    assertObjectMutationAccess(request.user, existing, request.headers['x-tenant-id'] as string | undefined);

    const user = {
      id: request.user?.sub ?? 'ffffffff-0001-0001-0001-000000000001',
      role: request.user?.roles?.[0] ?? 'editor',
    };
    const voided = await financeService.voidJournalEntry(params.id, user);
    return reply.status(200).send(voided);
  });
};

