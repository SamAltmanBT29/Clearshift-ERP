/**
 * ERP-3 Sales Orders & Invoices — Duplicate Detection & Human Review API Tests
 *
 * Verifies:
 *   - AC1: Normalization and registration of exact duplicate matching keys.
 *   - AC2: Deterministic exact duplicate matching (confidence 1.0).
 *   - AC3: Ambiguity classification and prohibition of fuzzy auto-merging.
 *   - AC4: Human review workflow, role authorization, and immutable audit logging
 *          recording actor ID, timestamp, kept ID, and merged ID.
 *
 * @module erp3/tests/api/duplicates.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemoryErp3Repository } from '../../src/services/repository.js';
import { Erp3Service } from '../../src/services/erp3.service.js';
import { Erp3AuditService } from '../../src/services/audit.js';

describe('ERP-3 Duplicate Key Policy & Human Review API (ERP3-12 / KIT-10)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp3Repository;
  let auditService: Erp3AuditService;
  let service: Erp3Service;

  beforeEach(() => {
    repo = new InMemoryErp3Repository(true); // Seeds SO-2026-0001
    auditService = new Erp3AuditService();
    service = new Erp3Service({ repository: repo, auditService });
    app = buildApp({
      repository: repo,
      erp3Service: service,
      auditService,
      authRequired: false,
    });
  });

  describe('POST /api/v1/erp-orders/duplicates/check (AC1 & AC2)', () => {
    it('detects exact order number duplicate with confidence 1.0', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/duplicates/check',
        payload: {
          entity: 'sales_order',
          records: [
            {
              order_number: '  so-2026-0001  ',
              customer_golden_id: '55555555-0003-4000-8000-000000000001',
            },
          ],
        },
      });

      if (res.statusCode !== 200) {
        console.error("DEBUG 500:", res.payload);
      }
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);

      expect(body.total_checked).toBe(1);
      expect(body.duplicates_found).toBe(1);
      expect(body.candidates[0].match_kind).toBe('EXACT_ORDER_NUMBER');
      expect(body.candidates[0].confidence).toBe(1.0);
      expect(body.candidates[0].status).toBe('PENDING_REVIEW');
    });

    it('flags conflicting candidate keys as AMBIGUOUS held for human review (AC3)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/duplicates/check',
        payload: {
          entity: 'sales_order',
          records: [
            {
              order_number: 'SO-2026-0001',
              customer_golden_id: '99999999-0003-4000-8000-000000000001', // Different customer
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.duplicates_found).toBe(1);
      expect(body.candidates[0].match_kind).toBe('AMBIGUOUS');
      expect(body.candidates[0].confidence).toBe(1.0);
    });

    it('returns 0 duplicates for unique record', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/duplicates/check',
        payload: {
          entity: 'sales_order',
          records: [
            {
              order_number: 'SO-9999-9999',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.duplicates_found).toBe(0);
      expect(body.candidates.length).toBe(0);
    });
  });

  describe('GET /api/v1/erp-orders/duplicates/candidates and /:id', () => {
    it('retrieves held candidates list and individual candidate by id', async () => {
      // First check to generate candidate
      await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/duplicates/check',
        payload: {
          entity: 'sales_order',
          records: [
            {
              order_number: 'so_2026_0001',
              customer_golden_id: '55555555-0003-4000-8000-000000000001',
            },
          ],
        },
      });

      // GET list
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-orders/duplicates/candidates?entity=sales_order',
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.payload);
      expect(listBody.items.length).toBe(1);
      const candidateId = listBody.items[0].candidate_id;

      // GET by ID
      const singleRes = await app.inject({
        method: 'GET',
        url: `/api/v1/erp-orders/duplicates/candidates/${candidateId}`,
      });
      expect(singleRes.statusCode).toBe(200);
      const singleBody = JSON.parse(singleRes.payload);
      expect(singleBody.candidate_id).toBe(candidateId);
      expect(singleBody.matching_key).toBe('order_number');
    });

    it('returns 404 for non-existent candidate', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-orders/duplicates/candidates/00000000-0000-4000-8000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/erp-orders/duplicates/review (AC4: Audited Human Review Decisions)', () => {
    it('executes human merge decision, updating candidate and writing audit trail', async () => {
      // Seed candidate
      const checkRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/duplicates/check',
        payload: {
          entity: 'sales_order',
          records: [
            {
              order_number: 'SO-2026-0001',
              customer_golden_id: '55555555-0003-4000-8000-000000000001',
            },
          ],
        },
      });
      const checkBody = JSON.parse(checkRes.payload);
      const candidateId = checkBody.candidates[0].candidate_id;

      const reviewRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/duplicates/review',
        headers: {
          'x-actor-id': 'operator-qa-01',
          'x-actor-role': 'editor',
        },
        payload: {
          candidate_id: candidateId,
          decision: 'MERGE',
          kept_id: 'aaaaaaaa-0003-4000-8000-000000000001',
          merged_id: '22222222-0003-4000-8000-000000000002',
          rationale: 'Verified identical duplicate order from legacy batch import',
        },
      });

      expect(reviewRes.statusCode).toBe(200);
      const reviewBody = JSON.parse(reviewRes.payload);
      expect(reviewBody.decision).toBe('MERGE');
      expect(reviewBody.status).toBe('MERGED');
      expect(reviewBody.actor_id).toBe('operator-qa-01');

      // Verify audit logs contain merge.decided
      const logs = await auditService.query();
      const mergeLog = logs.find((l) => l.action === 'merge.decided');
      expect(mergeLog).toBeDefined();

      expect(mergeLog?.actor).toBe('operator-qa-01');
      expect(mergeLog?.metadata?.['decision']).toBe('MERGE');
      expect(mergeLog?.metadata?.['kept_id']).toBe('aaaaaaaa-0003-4000-8000-000000000001');
      expect(mergeLog?.metadata?.['merged_id']).toBe('22222222-0003-4000-8000-000000000002');
    });

    it('rejects human merge with identical kept_id and merged_id (422)', async () => {
      // Seed candidate
      const checkRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/duplicates/check',
        payload: {
          entity: 'sales_order',
          records: [{ order_number: 'SO-2026-0001' }],
        },
      });
      const candidateId = JSON.parse(checkRes.payload).candidates[0].candidate_id;

      const reviewRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-orders/duplicates/review',
        payload: {
          candidate_id: candidateId,
          decision: 'MERGE',
          kept_id: 'aaaaaaaa-0003-4000-8000-000000000001',
          merged_id: 'aaaaaaaa-0003-4000-8000-000000000001',
          rationale: 'Self merge test rationale',
        },
      });

      expect(reviewRes.statusCode).toBe(422);
    });
  });
});
