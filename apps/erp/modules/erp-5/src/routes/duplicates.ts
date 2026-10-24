/**
 * ERP-5 HR & Employees — Duplicate Review Routes
 *
 * GET    /duplicates              - List pending duplicate candidates
 * GET    /duplicates/{id}        - Inspect a single candidate
 * POST   /duplicates/{id}/decide  - Approve merge or reject candidate
 *
 * @module erp5/routes/duplicates
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { HrService } from '../services/hr.service.js';
import { duplicateReviewGuard } from './guard.js';
import type { HrRouteOptions, HrFastifyInstance } from './types.js';

const DuplicateDecisionSchema = z.object({
  decision: z.enum(['MERGED', 'REJECTED']),
  notes: z.string().optional(),
});

const DuplicateIdParamSchema = z.object({
  id: z.string(),
});

export const duplicatesRoutes: FastifyPluginAsync<HrRouteOptions> = async (fastify, opts) => {
  const { hrService } = opts;
  const app = fastify as HrFastifyInstance;

  // GET /duplicates - List pending duplicate candidates
  fastify.get(
    '/duplicates',
    { preHandler: duplicateReviewGuard },
    async (request, reply) => {
      const query = {
        status: 'PENDING_REVIEW',
        limit: 50,
        offset: 0,
      };
      const response = await hrService.listDuplicateCandidates(query);

      return reply.status(200).send(response);
    }
  );

  // GET /duplicates/:id - Inspect a single candidate
  fastify.get(
    '/duplicates/:id',
    { preHandler: duplicateReviewGuard },
    async (request, reply) => {
      const params = DuplicateIdParamSchema.parse(request.params);
      const candidate = await hrService.getDuplicateCandidateById(params.id);

      if (!candidate) {
        return reply.status(404).send({ error: 'Candidate not found' });
      }

      return reply.status(200).send(candidate);
    }
  );

  // POST /duplicates/:id/decide - Approve merge or reject candidate
  fastify.post(
    '/duplicates/:id/decide',
    { preHandler: duplicateReviewGuard },
    async (request, reply) => {
      const params = DuplicateIdParamSchema.parse(request.params);
      const body = DuplicateDecisionSchema.parse(request.body ?? {});

      const result = await hrService.resolveDuplicateCandidate(
        params.id,
        {
          decision: body.decision,
          decided_by: request.user!.sub,
          decided_at: new Date(),
          notes: body.notes,
        },
        app.resolveCorrelationId(request)
      );

      return reply.status(200).send({
        success: true,
        message: `Candidate ${params.id} has been marked as ${body.decision}`,
      });
    }
  );
};
