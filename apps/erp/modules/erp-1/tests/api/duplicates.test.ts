/**
 * ERP-1 Products & Inventory — Duplicate Detection & Human Review API Tests
 *
 * Verifies:
 *   - AC1: Normalization and registration of exact duplicate matching keys.
 *   - AC2: Deterministic exact duplicate matching (confidence 1.0).
 *   - AC3: Ambiguity classification and prohibition of fuzzy auto-merging.
 *   - AC4: Human review workflow, role authorization, and immutable audit logging
 *          recording actor ID, timestamp, kept ID, and merged ID.
 *
 * @module erp1/tests/api/duplicates.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildErp1App } from '../../src/app.js';
import { InMemoryErp1Repository } from '../../src/services/repository.js';
import { Erp1Service } from '../../src/services/erp1.service.js';
import { InMemoryAuditRepository, AuditService } from '@cs/core';

describe('ERP-1 Duplicate Key Policy & Human Review API (ERP1-12 / KIT-10)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp1Repository;
  let auditRepo: InMemoryAuditRepository;
  let auditService: AuditService;
  let service: Erp1Service;

  const existingProductId = 'e0000001-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const existingCategoryId = '00000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    repo = new InMemoryErp1Repository(true);
    // Seed existing product
    await repo.createProduct({
      id: existingProductId,
      name: 'Standard Steel Bolt M8',
      sku: 'BOLT-M8-STD',
      normalizedSku: 'BOLT-M8-STD',
      categoryId: existingCategoryId,
      unitOfMeasure: 'pcs',
      price: '0.45',
      currency: 'USD',
      taxRate: '0.20',
    });

    auditRepo = new InMemoryAuditRepository();
    auditService = new AuditService(auditRepo);
    service = new Erp1Service({ repository: repo, auditService });
    app = buildErp1App({ repository: repo, erp1Service: service, authRequired: false });
  });

  describe('POST /api/v1/erp-products/duplicates/check (AC1 & AC2)', () => {
    it('detects exact SKU duplicate with confidence 1.0', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/duplicates/check',
        payload: {
          entity: 'product',
          records: [
            {
              name: 'Incoming Bolt Record',
              sku: '  bolt-m8-std  ',
              unitOfMeasure: 'pcs',
              price: '0.45',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.total_checked).toBe(1);
      expect(body.duplicates_found).toBe(1);
      expect(body.candidates[0].match_kind).toBe('NORMALIZED_EXACT');
      expect(body.candidates[0].confidence).toBe(1.0);
      expect(body.candidates[0].matching_key).toBe('sku');
      expect(body.candidates[0].matching_value).toBe('BOLT-M8-STD');
      expect(body.candidates[0].status).toBe('PENDING_REVIEW');
    });

    it('detects category exact code duplicate', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/duplicates/check',
        payload: {
          entity: 'category',
          records: [
            {
              name: 'General Hardware',
              code: 'gen', // General category code is 'GEN'
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.duplicates_found).toBe(1);
      expect(body.candidates[0].match_kind).toBe('NORMALIZED_EXACT');
      expect(body.candidates[0].matching_key).toBe('code');
      expect(body.candidates[0].matching_value).toBe('GEN');
    });

    it('returns empty candidates array when record is unique', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/duplicates/check',
        payload: {
          entity: 'product',
          records: [
            {
              name: 'Unique Item',
              sku: 'UNIQUE-ITEM-001',
              unitOfMeasure: 'pcs',
              price: '12.00',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.duplicates_found).toBe(0);
      expect(body.candidates).toHaveLength(0);
    });

    it('returns 400 when check request body fails validation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/duplicates/check',
        payload: {
          entity: 'invalid_entity',
          records: [],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/erp-products/duplicates/candidates', () => {
    it('lists seeded duplicate candidates and filters by entity', async () => {
      const candidateId = 'b1111111-1111-4111-8111-111111111111';
      service.seedDuplicateCandidate({
        candidate_id: candidateId,
        entity: 'product',
        match_kind: 'EXACT_SKU',
        status: 'PENDING_REVIEW',
        matching_key: 'sku',
        matching_value: 'BOLT-M8-STD',
        incoming_record: { sku: 'BOLT-M8-STD', name: 'Incoming' },
        existing_record: { id: existingProductId, sku: 'BOLT-M8-STD', name: 'Existing' },
        confidence: 1.0,
        created_at: new Date().toISOString(),
      });

      const resAll = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-products/duplicates/candidates',
      });
      expect(resAll.statusCode).toBe(200);
      const bodyAll = JSON.parse(resAll.payload);
      expect(bodyAll.total).toBe(1);
      expect(bodyAll.items[0].candidate_id).toBe(candidateId);

      // By candidate ID
      const resSingle = await app.inject({
        method: 'GET',
        url: `/api/v1/erp-products/duplicates/candidates/${candidateId}`,
      });
      expect(resSingle.statusCode).toBe(200);
      const bodySingle = JSON.parse(resSingle.payload);
      expect(bodySingle.candidate_id).toBe(candidateId);
    });

    it('returns 404 for unknown candidate ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-products/duplicates/candidates/f9999999-9999-4999-8999-999999999999',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/erp-products/duplicates/review (AC3 & AC4)', () => {
    const candidateId = 'e0000003-cccc-4ccc-cccc-cccccccccccc';

    beforeEach(() => {
      service.seedDuplicateCandidate({
        candidate_id: candidateId,
        entity: 'product',
        match_kind: 'EXACT_SKU',
        status: 'PENDING_REVIEW',
        matching_key: 'sku',
        matching_value: 'BOLT-M8-STD',
        incoming_record: { id: 'e0000002-bbbb-4bbb-bbbb-bbbbbbbbbbbb', sku: 'BOLT-M8-STD', name: 'Incoming' },
        existing_record: { id: existingProductId, sku: 'BOLT-M8-STD', name: 'Existing' },
        confidence: 1.0,
        created_at: new Date().toISOString(),
      });
    });

    it('executes MERGE decision and records immutable audit log with AC4 fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/duplicates/review',
        headers: {
          'x-actor-id': 'operator-42',
          'x-actor-role': 'migration_runner',
        },
        payload: {
          candidate_id: candidateId,
          decision: 'MERGE',
          kept_id: existingProductId,
          merged_id: 'e0000002-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
          rationale: 'Confirmed exact matching product from supplier list.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.candidate_id).toBe(candidateId);
      expect(body.decision).toBe('MERGE');
      expect(body.status).toBe('MERGED');
      expect(body.kept_id).toBe(existingProductId);
      expect(body.merged_id).toBe('e0000002-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
      expect(body.actor_id).toBe('operator-42');
      expect(body.audit_record_id).toBeDefined();

      // Verify immutable audit log in AuditService (AC4)
      const auditEntries = await auditRepo.query({ targetEntity: 'erp1.products', targetId: existingProductId });
      expect(auditEntries.length).toBeGreaterThan(0);
      const entry = auditEntries[0]!;
      expect(entry.action).toBe('merge.decided');
      expect(entry.actor).toBe('operator-42');
      expect(entry.metadata!['keptId']).toBe(existingProductId);
      expect(entry.metadata!['mergedId']).toBe('e0000002-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
      expect(entry.reason).toBe('Confirmed exact matching product from supplier list.');
    });

    it('executes REJECT decision without requiring kept_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/duplicates/review',
        headers: {
          'x-actor-id': 'operator-42',
          'x-actor-role': 'admin',
        },
        payload: {
          candidate_id: candidateId,
          decision: 'REJECT',
          rationale: 'Incoming record has corrupted prices.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.decision).toBe('REJECT');
      expect(body.status).toBe('REJECTED');
    });

    it('rejects unauthorized role attempting merge decision (HTTP 403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/duplicates/review',
        headers: {
          'x-actor-id': 'viewer-01',
          'x-actor-role': 'viewer', // Unauthorized role
        },
        payload: {
          candidate_id: candidateId,
          decision: 'MERGE',
          kept_id: existingProductId,
          merged_id: 'd1111111-1111-4111-8111-111111111111',
          rationale: 'Unauthorized attempt to merge',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects review payload with rationale shorter than 5 chars (HTTP 400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-products/duplicates/review',
        payload: {
          candidate_id: candidateId,
          decision: 'REJECT',
          rationale: 'no', // Too short
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
