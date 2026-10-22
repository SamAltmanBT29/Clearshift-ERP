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
import { requireFinancePolicy, FinancePolicies } from '../policies/index.js';

export interface JournalEntriesRouteOptions {
  financeService: FinanceService;
}

function getUserContext(request: { user?: { sub: string; roles: string[] } }): { id: string; role?: string | undefined } {
  const user = request.user;
  return {
    id: user?.sub ?? 'ffffffff-0001-0001-0001-000000000001',
    role: user?.roles?.[0],
  };
}

export const journalEntriesRoutes: FastifyPluginAsync<JournalEntriesRouteOptions> = async (
  fastify,
  opts
) => {
  const { financeService } = opts;

  // GET /journal-entries - List journal entries (Viewer, Editor, Analyst, Admin)
  fastify.get(
    '/journal-entries',
    { preHandler: [requireFinancePolicy(FinancePolicies.JOURNAL_READ)] },
    async (request, reply) => {
      const query = JournalEntryListQuerySchema.parse(request.query);
      const response = await financeService.listJournalEntries(query);
      return reply.status(200).send(response);
    }
  );

  // GET /journal-entries/:id - Get journal entry by ID (Viewer, Editor, Analyst, Admin)
  fastify.get(
    '/journal-entries/:id',
    { preHandler: [requireFinancePolicy(FinancePolicies.JOURNAL_READ)] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const entry = await financeService.getJournalEntryById(params.id);
      return reply.status(200).send(entry);
    }
  );

  // POST /journal-entries - Create draft journal entry (Editor, Migration Runner, Admin)
  fastify.post(
    '/journal-entries',
    { preHandler: [requireFinancePolicy(FinancePolicies.JOURNAL_CREATE)] },
    async (request, reply) => {
      const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;
      const rawBody = (request.body && typeof request.body === 'object') ? request.body : {};
      const body = CreateJournalEntryRequestSchema.parse({
        ...rawBody,
        ...(idempotencyHeader && !(rawBody as any).idempotency_key && { idempotency_key: idempotencyHeader }),
      });
      const user = getUserContext(request);
      const { entry, created } = await financeService.createJournalEntry(body, user.id);
      return reply.status(created ? 201 : 200).send(entry);
    }
  );

  // PATCH /journal-entries/:id - Update draft journal entry (Editor, Admin)
  fastify.patch(
    '/journal-entries/:id',
    { preHandler: [requireFinancePolicy(FinancePolicies.JOURNAL_UPDATE)] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const body = UpdateJournalEntryRequestSchema.parse(request.body);
      const user = getUserContext(request);
      const updated = await financeService.updateJournalEntry(params.id, body, user.id);
      return reply.status(200).send(updated);
    }
  );

  // POST /journal-entries/:id/post - Post entry to ledger (Editor, Admin)
  fastify.post(
    '/journal-entries/:id/post',
    { preHandler: [requireFinancePolicy(FinancePolicies.JOURNAL_POST)] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const user = getUserContext(request);
      const posted = await financeService.postJournalEntry(params.id, user);
      return reply.status(200).send(posted);
    }
  );

  // POST /journal-entries/:id/reverse - Reverse entry (Editor, Admin)
  fastify.post(
    '/journal-entries/:id/reverse',
    { preHandler: [requireFinancePolicy(FinancePolicies.JOURNAL_REVERSE)] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const body = ReverseJournalEntryRequestSchema.parse(request.body ?? {});
      const user = getUserContext(request);
      const result = await financeService.reverseJournalEntry(params.id, body, user);
      return reply.status(200).send(result);
    }
  );

  // POST /journal-entries/:id/void - Void draft entry (Editor, Admin)
  fastify.post(
    '/journal-entries/:id/void',
    { preHandler: [requireFinancePolicy(FinancePolicies.JOURNAL_VOID)] },
    async (request, reply) => {
      const params = IdParamSchema.parse(request.params);
      const user = getUserContext(request);
      const voided = await financeService.voidJournalEntry(params.id, user);
      return reply.status(200).send(voided);
    }
  );
};
