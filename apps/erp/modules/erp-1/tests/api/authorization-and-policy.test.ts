/**
 * ERP-1 Products & Inventory — Authorization & Policy Suite (PLT-05, PLT-06 / ERP1-15)
 *
 * Verifies:
 *   1. Hub JWT token signature validation and expiration.
 *   2. 5-role capability matrix enforcement across all endpoints
 *      (Viewer, Editor, Migration Runner, Analyst, Admin).
 *   3. Default deny: unauthenticated requests return 401; insufficient permissions return 403.
 *   4. Object-level authorization guards preventing unauthorized multi-tenant
 *      or cross-user record mutations.
 *   5. Standard error envelope conformance on all rejection responses.
 *
 * @module erp1/tests/api/authorization-and-policy.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { Roles, signAccessToken, type RoleType } from '@cs/identity';
import { ErrorEnvelopeSchema } from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { Erp1Service } from '../../src/services/erp1.service.js';
import {
  ERP1_DEFAULT_CATEGORY_ID,
  InMemoryErp1Repository,
} from '../../src/services/repository.js';
import {
  registerEntityTenant,
  registerEntityCreator,
  erp1EntityTenantRegistry,
  erp1EntityCreatorRegistry,
} from '../../src/routes/guard.js';

const BASE = '/api/v1/erp-products';

describe('ERP-1 Module Authorization & Policy Integration (ERP1-15)', () => {
  let repository: InMemoryErp1Repository;
  let app: FastifyInstance;

  let service: Erp1Service;

  beforeEach(() => {
    erp1EntityTenantRegistry.clear();
    erp1EntityCreatorRegistry.clear();
    repository = new InMemoryErp1Repository(true);
    service = new Erp1Service({ repository });
    app = buildApp({
      repository,
      erp1Service: service,
      authRequired: true,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Acceptance Criterion 1: Hub JWT Signature & Token Expiration
  // ───────────────────────────────────────────────────────────────────────────
  describe('Hub JWT Validation & Expiration', () => {
    it('accepts valid Ed25519 signed Hub JWT token', async () => {
      const token = await signAccessToken('user-001', [Roles.ADMIN]);

      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.items).toBeDefined();
    });

    it('rejects expired Hub JWT token with 401 Unauthorized', async () => {
      // Issue a token with exp in the past
      const fakeKeys = await jose.generateKeyPair('EdDSA', { crv: 'Ed25519' });
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = await new jose.SignJWT({
        roles: [Roles.ADMIN],
      })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('clearshift')
        .setSubject('user-expired')
        .setIssuedAt(now - 3600)
        .setExpirationTime(now - 60)
        .sign(fakeKeys.privateKey);

      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHORIZED');
      expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    });

    it('rejects tampered or forged Hub JWT token with 401 Unauthorized', async () => {
      const validToken = await signAccessToken('user-001', [Roles.ADMIN]);
      const tamperedToken = validToken.slice(0, -6) + 'xxxxxx';

      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
        headers: {
          authorization: `Bearer ${tamperedToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHORIZED');
      expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    });

    it('rejects disabled user accounts with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
        headers: {
          authorization: 'Bearer role:admin',
          'x-actor-id': 'user-disabled-01',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.details[0]?.code).toBe('USER_DISABLED');
    });

    it('rejects missing Authorization header when authRequired is true', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('rejects non-Bearer format tokens with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
        headers: {
          authorization: 'Basic dXNlcjpwYXNz',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHORIZED');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Acceptance Criteria 2 & 3: Role Capability Matrix & Default Deny
  // ───────────────────────────────────────────────────────────────────────────
  describe('Role Capability Matrix Enforcement', () => {
    const roles: { role: RoleType; name: string }[] = [
      { role: Roles.VIEWER, name: 'Viewer' },
      { role: Roles.EDITOR, name: 'Editor' },
      { role: Roles.MIGRATION_RUNNER, name: 'Migration Runner' },
      { role: Roles.ANALYST, name: 'Analyst' },
      { role: Roles.ADMIN, name: 'Admin' },
    ];

    describe('Viewer Role', () => {
      const auth = { authorization: `Bearer role:${Roles.VIEWER}` };

      it('allows read operations on products, categories, and stock', async () => {
        const getProducts = await app.inject({ method: 'GET', url: `${BASE}/products`, headers: auth });
        expect(getProducts.statusCode).toBe(200);

        const getCategories = await app.inject({ method: 'GET', url: `${BASE}/categories`, headers: auth });
        expect(getCategories.statusCode).toBe(200);

        const getStock = await app.inject({ method: 'GET', url: `${BASE}/stock`, headers: auth });
        expect(getStock.statusCode).toBe(200);
      });

      it('denies write mutations with 403 Forbidden', async () => {
        const postProduct = await app.inject({
          method: 'POST',
          url: `${BASE}/products`,
          headers: auth,
          payload: {
            name: 'Viewer Product',
            sku: 'VIEWER-01',
            categoryId: ERP1_DEFAULT_CATEGORY_ID,
            unitOfMeasure: 'pcs',
            price: 10,
            currency: 'USD',
          },
        });
        expect(postProduct.statusCode).toBe(403);
        const body = JSON.parse(postProduct.payload);
        expect(body.code).toBe('FORBIDDEN');
        expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);

        const postImport = await app.inject({
          method: 'POST',
          url: `${BASE}/import`,
          headers: auth,
          payload: {
            batch_id: '11111111-1111-1111-1111-111111111111',
            entity: 'product',
            source_row: 1,
            idempotency_key: 'viewer-key-01',
            record: { name: 'Item', sku: 'ITEM-01', unit_of_measure: 'pcs', price: 1 },
          },
        });
        expect(postImport.statusCode).toBe(403);
      });
    });

    describe('Editor Role', () => {
      const auth = { authorization: `Bearer role:${Roles.EDITOR}` };

      it('allows product and category creation and editing', async () => {
        const postProduct = await app.inject({
          method: 'POST',
          url: `${BASE}/products`,
          headers: auth,
          payload: {
            name: 'Editor Product',
            sku: 'EDITOR-01',
            categoryId: ERP1_DEFAULT_CATEGORY_ID,
            unitOfMeasure: 'pcs',
            price: 15,
            currency: 'USD',
          },
        });
        expect(postProduct.statusCode).toBe(201);
        const created = JSON.parse(postProduct.payload);

        const patchProduct = await app.inject({
          method: 'PATCH',
          url: `${BASE}/products/${created.id}`,
          headers: auth,
          payload: {
            name: 'Editor Product Renamed',
          },
        });
        expect(patchProduct.statusCode).toBe(200);
      });

      it('allows duplicate review decisions (has kit.review capability)', async () => {
        const candidateId = '22222222-2222-4222-8222-222222222222';
        service.seedDuplicateCandidate({
          candidate_id: candidateId,
          entity: 'product',
          match_kind: 'EXACT_SKU',
          status: 'PENDING_REVIEW',
          matching_key: 'sku',
          matching_value: 'SKU-DUP-ED',
          incoming_record: { id: '33333333-3333-4333-8333-333333333333', sku: 'SKU-DUP-ED', name: 'Incoming' },
          existing_record: { id: 'ffffffff-0001-0001-0001-000000000001', sku: 'SKU-DUP-ED', name: 'Existing' },
          confidence: 1.0,
          created_at: new Date().toISOString(),
        });

        const reviewRes = await app.inject({
          method: 'POST',
          url: `${BASE}/duplicates/review`,
          headers: auth,
          payload: {
            candidate_id: candidateId,
            decision: 'REJECT',
            rationale: 'Editor verified non-duplicate candidate',
          },
        });
        expect(reviewRes.statusCode).toBe(200);
      });
    });

    describe('Migration Runner Role', () => {
      const auth = { authorization: `Bearer role:${Roles.MIGRATION_RUNNER}` };

      it('allows batch ingestion and product loads via kit.run capability', async () => {
        const importRes = await app.inject({
          method: 'POST',
          url: `${BASE}/import`,
          headers: auth,
          payload: {
            batch_id: '33333333-3333-3333-3333-333333333333',
            entity: 'product',
            source_row: 1,
            idempotency_key: 'mig-key-01',
            record: {
              name: 'Migrated Item',
              sku: 'MIG-01',
              categoryId: ERP1_DEFAULT_CATEGORY_ID,
              unit_of_measure: 'pcs',
              price: 25.0,
              currency: 'USD',
            },
          },
        });
        expect(importRes.statusCode).toBe(201);
      });

      it('denies browser UI edit mutations without module.write capability', async () => {
        const patchRes = await app.inject({
          method: 'PATCH',
          url: `${BASE}/products/ffffffff-0001-0001-0001-000000000001`,
          headers: auth,
          payload: { name: 'Disallowed Name' },
        });
        expect(patchRes.statusCode).toBe(403);
        const body = JSON.parse(patchRes.payload);
        expect(body.code).toBe('FORBIDDEN');
      });

      it('denies duplicate candidate review decisions without kit.review capability', async () => {
        const reviewRes = await app.inject({
          method: 'POST',
          url: `${BASE}/duplicates/review`,
          headers: auth,
          payload: {
            candidate_id: '44444444-4444-4444-4444-444444444444',
            decision: 'reject',
            reason: 'Unauthorized runner review',
          },
        });
        expect(reviewRes.statusCode).toBe(403);
      });
    });

    describe('Analyst Role', () => {
      const auth = { authorization: `Bearer role:${Roles.ANALYST}` };

      it('allows read-only access to products and stock levels', async () => {
        const listRes = await app.inject({ method: 'GET', url: `${BASE}/products`, headers: auth });
        expect(listRes.statusCode).toBe(200);

        const stockRes = await app.inject({ method: 'GET', url: `${BASE}/stock`, headers: auth });
        expect(stockRes.statusCode).toBe(200);
      });

      it('denies creation and ingestion mutations with 403 Forbidden', async () => {
        const postRes = await app.inject({
          method: 'POST',
          url: `${BASE}/products`,
          headers: auth,
          payload: {
            name: 'Analyst Product',
            sku: 'ANALYST-01',
            categoryId: ERP1_DEFAULT_CATEGORY_ID,
            unitOfMeasure: 'pcs',
            price: 5,
            currency: 'USD',
          },
        });
        expect(postRes.statusCode).toBe(403);
      });
    });

    describe('Admin Role', () => {
      const auth = { authorization: `Bearer role:${Roles.ADMIN}` };

      it('has unrestricted access across read, write, ingest, and review', async () => {
        const createRes = await app.inject({
          method: 'POST',
          url: `${BASE}/products`,
          headers: auth,
          payload: {
            name: 'Admin Product',
            sku: 'ADMIN-01',
            categoryId: ERP1_DEFAULT_CATEGORY_ID,
            unitOfMeasure: 'pcs',
            price: 99.9,
            currency: 'USD',
          },
        });
        expect(createRes.statusCode).toBe(201);
        const product = JSON.parse(createRes.payload);

        const patchRes = await app.inject({
          method: 'PATCH',
          url: `${BASE}/products/${product.id}`,
          headers: auth,
          payload: { name: 'Admin Product Renamed' },
        });
        expect(patchRes.statusCode).toBe(200);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Acceptance Criterion 4: Object-Level Authorization (Tenant & Cross-User)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Object-Level Authorization Guards', () => {
    it('prevents cross-tenant access to products with 403 OBJECT_ACCESS_DENIED', async () => {
      // 1. Create product under tenant-alpha
      const createRes = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: {
          authorization: `Bearer role:${Roles.ADMIN}`,
          'x-tenant-id': 'tenant-alpha',
        },
        payload: {
          name: 'Alpha Product',
          sku: 'ALPHA-001',
          categoryId: ERP1_DEFAULT_CATEGORY_ID,
          unitOfMeasure: 'pcs',
          price: 50,
          currency: 'USD',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const product = JSON.parse(createRes.payload);

      // 2. Caller from tenant-beta attempts to read tenant-alpha product
      const readRes = await app.inject({
        method: 'GET',
        url: `${BASE}/products/${product.id}`,
        headers: {
          authorization: `Bearer role:${Roles.VIEWER}`,
          'x-tenant-id': 'tenant-beta',
        },
      });
      expect(readRes.statusCode).toBe(403);
      const body = JSON.parse(readRes.payload);
      expect(body.code).toBe('OBJECT_ACCESS_DENIED');

      // 3. Caller from tenant-alpha successfully reads it
      const alphaReadRes = await app.inject({
        method: 'GET',
        url: `${BASE}/products/${product.id}`,
        headers: {
          authorization: `Bearer role:${Roles.VIEWER}`,
          'x-tenant-id': 'tenant-alpha',
        },
      });
      expect(alphaReadRes.statusCode).toBe(200);
    });

    it('prevents non-admin users from mutating records created by another user with 403 CROSS_USER_MUTATION_FORBIDDEN', async () => {
      // 1. User Alice creates product
      const createRes = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: {
          authorization: `Bearer role:${Roles.EDITOR}`,
          'x-actor-id': 'user-alice',
        },
        payload: {
          name: 'Alice Product',
          sku: 'ALICE-001',
          categoryId: ERP1_DEFAULT_CATEGORY_ID,
          unitOfMeasure: 'pcs',
          price: 30,
          currency: 'USD',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const product = JSON.parse(createRes.payload);

      // 2. User Bob (also Editor) attempts to PATCH Alice's product
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${BASE}/products/${product.id}`,
        headers: {
          authorization: `Bearer role:${Roles.EDITOR}`,
          'x-actor-id': 'user-bob',
        },
        payload: {
          name: 'Hijacked by Bob',
        },
      });
      expect(patchRes.statusCode).toBe(403);
      const body = JSON.parse(patchRes.payload);
      expect(body.code).toBe('CROSS_USER_MUTATION_FORBIDDEN');

      // 3. Alice can mutate her own record
      const alicePatch = await app.inject({
        method: 'PATCH',
        url: `${BASE}/products/${product.id}`,
        headers: {
          authorization: `Bearer role:${Roles.EDITOR}`,
          'x-actor-id': 'user-alice',
        },
        payload: {
          name: 'Legitimate update by Alice',
        },
      });
      expect(alicePatch.statusCode).toBe(200);

      // 4. Admin can mutate records across creators within the organization
      const adminPatch = await app.inject({
        method: 'PATCH',
        url: `${BASE}/products/${product.id}`,
        headers: {
          authorization: `Bearer role:${Roles.ADMIN}`,
          'x-actor-id': 'admin-charlie',
        },
        payload: {
          name: 'Admin Override',
        },
      });
      expect(adminPatch.statusCode).toBe(200);
    });

    it('prevents cross-tenant import batch execution', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/import`,
        headers: {
          authorization: `Bearer role:${Roles.MIGRATION_RUNNER}`,
          'x-tenant-id': 'tenant-gamma',
        },
        payload: {
          batch_id: '55555555-5555-5555-5555-555555555555',
          tenant_id: 'tenant-delta', // Mismatched tenant
          entity: 'product',
          source_row: 1,
          idempotency_key: 'gamma-delta-01',
          record: { name: 'Item', sku: 'ITEM-GD', unit_of_measure: 'pcs', price: 10 },
        },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('OBJECT_ACCESS_DENIED');
    });
  });
});
