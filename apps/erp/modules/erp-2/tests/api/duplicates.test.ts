/**
 * ERP-2 Vendors & Purchasing — Duplicate Detection & Human Review API Tests
 *
 * Verifies:
 *   - AC1: Normalization and registration of exact duplicate matching keys.
 *   - AC2: Deterministic exact duplicate matching (confidence 1.0).
 *   - AC3: Ambiguity classification and prohibition of fuzzy auto-merging.
 *   - AC4: Human review workflow, role authorization, and immutable audit logging
 *          recording actor ID, timestamp, kept ID, and merged ID.
 *
 * @module erp2/tests/api/duplicates.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemoryErp2Repository } from '../../src/services/repository.js';
import { Erp2Service } from '../../src/services/erp2.service.js';
import { InMemoryAuditRepository, AuditService } from '@cs/core';

describe('ERP-2 Duplicate Key Policy & Human Review API (ERP2-12 / KIT-10)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp2Repository;
  let auditRepo: InMemoryAuditRepository;
  let auditService: AuditService;
  let service: Erp2Service;

  beforeEach(() => {
    repo = new InMemoryErp2Repository(true); // Seeds Acme Industrial Supplies (tax: TX-998877, email: sales@acme-industrial.com)
    auditRepo = new InMemoryAuditRepository();
    auditService = new AuditService(auditRepo);
    service = new Erp2Service({ repository: repo, auditService });
    app = buildApp({ repository: repo, erp2Service: service });
  });

  describe('POST /api/v1/erp-vendors/duplicates/check (AC1 & AC2)', () => {
    it('detects exact tax number duplicate with confidence 1.0', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/duplicates/check',
        payload: {
          entity: 'vendor',
          records: [
            {
              name: 'Acme Supplies Incoming',
              tax_number: '  tx-998877  ',
              email: 'sales@acme-industrial.com',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.total_checked).toBe(1);
      expect(body.duplicates_found).toBe(1);
      expect(body.candidates[0].match_kind).toBe('EXACT_TAX_NUMBER');
      expect(body.candidates[0].confidence).toBe(1.0);
      expect(body.candidates[0].status).toBe('PENDING_REVIEW');
    });

    it('detects exact email duplicate when tax number is omitted', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/duplicates/check',
        payload: {
          entity: 'vendor',
          records: [
            {
              name: 'Acme Re-import',
              email: ' Sales@Acme-Industrial.COM ',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.duplicates_found).toBe(1);
      expect(body.candidates[0].match_kind).toBe('EXACT_EMAIL');
      expect(body.candidates[0].confidence).toBe(1.0);
    });

    it('flags conflicting candidate keys as AMBIGUOUS held for human review (AC3)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/duplicates/check',
        payload: {
          entity: 'vendor',
          records: [
            {
              name: 'Conflicting Vendor',
              tax_number: 'TX-998877', // Matches Acme
              email: 'totally-different@othercorp.com', // Differs from Acme
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.duplicates_found).toBe(1);
      expect(body.candidates[0].match_kind).toBe('AMBIGUOUS');
      expect(body.candidates[0].status).toBe('PENDING_REVIEW');
    });

    it('returns zero duplicate candidates for unique records', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/duplicates/check',
        payload: {
          entity: 'vendor',
          records: [
            {
              name: 'Brand New Supplier',
              tax_number: 'TX-UNIQUE-999',
              email: 'info@newsupplier.com',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.total_checked).toBe(1);
      expect(body.duplicates_found).toBe(0);
      expect(body.candidates).toHaveLength(0);
    });

    it('rejects invalid payload with empty records array', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/duplicates/check',
        payload: {
          entity: 'vendor',
          records: [],
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/erp-vendors/duplicates/candidates', () => {
    it('lists detected candidates and retrieves single candidate by ID', async () => {
      // 1. Run check to produce candidate
      const checkRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/duplicates/check',
        payload: {
          entity: 'vendor',
          records: [
            {
              name: 'Acme Test',
              tax_number: 'TX-998877',
              email: 'sales@acme-industrial.com',
            },
          ],
        },
      });
      const candidateId = JSON.parse(checkRes.payload).candidates[0].candidate_id;

      // 2. List candidates
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/duplicates/candidates',
      });
      expect(listRes.statusCode).toBe(200);
      expect(JSON.parse(listRes.payload).items).toHaveLength(1);

      // 3. Get single candidate
      const singleRes = await app.inject({
        method: 'GET',
        url: `/api/v1/erp-vendors/duplicates/candidates/${candidateId}`,
      });
      expect(singleRes.statusCode).toBe(200);
      expect(JSON.parse(singleRes.payload).candidate_id).toBe(candidateId);
    });

    it('returns 404 for unknown candidate ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/duplicates/candidates/00000000-0000-4000-8000-000000000099',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/erp-vendors/duplicates/review (AC3 & AC4: Audited Human Review)', () => {
    let candidateId: string;
    let existingVendorId: string;

    beforeEach(async () => {
      const vendor = await repo.createVendor(
        {
          name: 'Acme Industrial Supplies LLC',
          tax_number: 'TX-998877',
          email: 'sales@acme-industrial.com',
          currency: 'USD',
        },
        'XXXX-XXXX-7890'
      );
      existingVendorId = vendor.id;

      const checkRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/duplicates/check',
        payload: {
          entity: 'vendor',
          records: [
            {
              name: 'Acme Duplicate Candidate',
              tax_number: 'TX-998877',
              email: 'sales@acme-industrial.com',
            },
          ],
        },
      });
      candidateId = JSON.parse(checkRes.payload).candidates[0].candidate_id;
    });

    it('successfully executes MERGE decision and records immutable audit log (AC4)', async () => {
      const operatorId = 'operator-migration-lead-42';
      const mergedCandidateUuid = '99999999-9999-4a99-8b99-999999999999';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/duplicates/review',
        headers: {
          'x-actor-id': operatorId,
          'x-actor-role': 'migration_runner',
        },
        payload: {
          candidate_id: candidateId,
          decision: 'MERGE',
          kept_id: existingVendorId,
          merged_id: mergedCandidateUuid,
          rationale: 'Confirmed exact vendor match after reviewing legal entity documentation.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.candidate_id).toBe(candidateId);
      expect(body.decision).toBe('MERGE');
      expect(body.status).toBe('MERGED');
      expect(body.actor_id).toBe(operatorId);
      expect(body.audit_record_id).toBeDefined();

      // Verify immutable audit log in AuditService (AC4)
      const auditRecords = await auditRepo.query({ action: 'merge.decided' });
      expect(auditRecords).toHaveLength(1);
      const record = auditRecords[0]!;
      expect(record.actor).toBe(operatorId);
      expect(record.action).toBe('merge.decided');
      expect(record.targetEntity).toBe('erp2.vendors');
      expect(record.targetId).toBe(existingVendorId);
      expect(record.metadata?.['keptId']).toBe(existingVendorId);
      expect(record.metadata?.['mergedId']).toBe(mergedCandidateUuid);
      expect(record.metadata?.['decision']).toBe('MERGE');
      expect(record.reason).toBe('Confirmed exact vendor match after reviewing legal entity documentation.');
    });

    it('rejects duplicate review attempt from unauthorized viewer role with HTTP 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/duplicates/review',
        headers: {
          'x-actor-id': 'unauthorized-viewer',
          'x-actor-role': 'viewer',
        },
        payload: {
          candidate_id: candidateId,
          decision: 'REJECT',
          rationale: 'Unauthorized attempt to review candidate.',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.payload).code).toBe('FORBIDDEN');
    });

    it('rejects self-merge where kept_id equals merged_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/duplicates/review',
        headers: {
          'x-actor-id': 'admin-user',
          'x-actor-role': 'admin',
        },
        payload: {
          candidate_id: candidateId,
          decision: 'MERGE',
          kept_id: existingVendorId,
          merged_id: existingVendorId, // Identical ID
          rationale: 'Attempting invalid self merge.',
        },
      });

      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.payload).code).toBe('MERGE_TARGET_IDENTICAL');
    });

    it('successfully executes REJECT decision with audit record', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/duplicates/review',
        headers: {
          'x-actor-id': 'lead-auditor',
          'x-actor-role': 'editor',
        },
        payload: {
          candidate_id: candidateId,
          decision: 'REJECT',
          rationale: 'Spurious candidate record from legacy dirty data dump.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('REJECTED');

      const auditRecords = await auditRepo.query({ action: 'merge.decided' });
      expect(auditRecords).toHaveLength(1);
      expect(auditRecords[0]!.metadata?.['decision']).toBe('REJECT');
    });

    it('successfully executes KEEP_BOTH decision with audit record', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/duplicates/review',
        headers: {
          'x-actor-id': 'migration-admin',
          'x-actor-role': 'admin',
        },
        payload: {
          candidate_id: candidateId,
          decision: 'KEEP_BOTH',
          rationale: 'Verified distinct corporate branch operating independently.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('KEPT_BOTH');

      const auditRecords = await auditRepo.query({ action: 'merge.decided' });
      expect(auditRecords).toHaveLength(1);
      expect(auditRecords[0]!.metadata?.['decision']).toBe('KEEP_BOTH');
    });
  });
});
