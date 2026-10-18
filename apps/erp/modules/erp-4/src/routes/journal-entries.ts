/**
 * ERP-4 Finance — Journal Entries Routes
 *
 * GET  /journal-entries            - List journal entries with filter, search, stable sort, and bounded paging
 * GET  /journal-entries/:id        - Get a single journal entry with lines
 * POST /journal-entries            - Create a new journal entry (draft)
 * POST /journal-entries/:id/post   - Approve and post entry (locks entry, enforces double-entry & period guards)
 * POST /journal-entries/:id/reverse- Reverse a posted entry via compensating reversal
 *
 * @module erp4/routes/journal-entries
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  JournalEntryListQuerySchema,
  CreateJournalEntryRequestSchema,
  ReverseJournalEntryRequestSchema,
  IdParamSchema,
} from '@clearshift/contracts';
import type { FinanceService } from '../services/finance.service.js';

export interface JournalEntriesRouteOptions {
  financeService: FinanceService;
}

export const journalEntriesRoutes: FastifyPluginAsync<JournalEntriesRouteOptions> = async (
  fastify,
  opts
) => {
  const { financeService } = opts;

  // GET /journal-entries - List journal entries
  fastify.get('/journal-entries', async (request, reply) => {
    const query = JournalEntryListQuerySchema.parse(request.query);
    const response = await financeService.listJournalEntries(query);
    return reply.status(200).send(response);
  });

  // GET /journal-entries/:id - Get journal entry by ID
  fastify.get('/journal-entries/:id', async (request, reply) => {
    const params = IdParamSchema.parse(request.params);
    const entry = await financeService.getJournalEntryById(params.id);
    return reply.status(200).send(entry);
  });

  // POST /journal-entries - Create draft journal entry
  fastify.post('/journal-entries', async (request, reply) => {
    const body = CreateJournalEntryRequestSchema.parse(request.body);
    const user = (request as unknown as { user: { id: string; role?: string } }).user;
    const { entry, created } = await financeService.createJournalEntry(body, user.id);
    return reply.status(created ? 201 : 200).send(entry);
  });

  // POST /journal-entries/:id/post - Post entry to ledger
  fastify.post('/journal-entries/:id/post', async (request, reply) => {
    const params = IdParamSchema.parse(request.params);
    const user = (request as unknown as { user: { id: string; role?: string } }).user;
    const posted = await financeService.postJournalEntry(params.id, user);
    return reply.status(200).send(posted);
  });

  // POST /journal-entries/:id/reverse - Reverse entry
  fastify.post('/journal-entries/:id/reverse', async (request, reply) => {
    const params = IdParamSchema.parse(request.params);
    const body = ReverseJournalEntryRequestSchema.parse(request.body ?? {});
    const user = (request as unknown as { user: { id: string; role?: string } }).user;
    const result = await financeService.reverseJournalEntry(params.id, body, user);
    return reply.status(200).send(result);
  });
};
