/**
 * ERP-2 Vendors & Purchasing — Authorization & Policy Suite (PLT-05, PLT-06 / ERP2-15)
 *
 * Verifies:
 *   1. Hub JWT token signature validation and expiration (Ed25519 / @cs/identity).
 *   2. 5-role capability matrix enforcement across all endpoints
 *      (Viewer, Editor, Migration Runner, Analyst, Admin).
 *   3. Default deny: unauthenticated requests return 401; insufficient permissions return 403.
 *   4. Object-level authorization guards preventing unauthorized multi-tenant
 *      or cross-user record mutations.
 *   5. Standard error envelope conformance on all rejection responses.
 *
 * @module erp2/tests/api/authorization-and-policy.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { Roles, signAccessToken, type RoleType } from '@cs/identity';
import { ErrorEnvelopeSchema } from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { Erp2Service } from '../../src/services/erp2.service.js';
import { InMemoryErp2Repository } from '../../src/services/repository.js';
import {
  registerEntityTenant,
  registerEntityCreator,
  erp2EntityTenantRegistry,
  erp2EntityCreatorRegistry,
} from '../../src/routes/guard.js';

const BASE = '/api/v1/erp-vendors';

describe('ERP-2 Module Authorization & Policy Integration (ERP2-15)', () => {
  let repository: InMemoryErp2Repository;
  let app: FastifyInstance;
  let service: Erp2Service;

  beforeEach(() => {
    erp2EntityTenantRegistry.clear();
    erp2EntityCreatorRegistry.clear();
    repository = new InMemoryErp2Repository(true);
    service = new Erp2Service({ repository });
    app = buildApp({
      repository,
      erp2Service: service,
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
        url: `${BASE}/vendors`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.items).toBeDefined();
    });

    it('rejects expired Hub JWT token with 401 Unauthorized', async () => {
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
        url: `${BASE}/vendors`,
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
        url: `${BASE}/vendors`,
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
        url: `${BASE}/vendors`,
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
        url: `${BASE}/vendors`,
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('rejects non-Bearer format tokens with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/vendors`,
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
    describe('Viewer Role', () => {
      const auth = { authorization: `Bearer role:${Roles.VIEWER}` };

      it('allows read operations on vendors and purchase orders', async () => {
        const getVendors = await app.inject({ method: 'GET', url: `${BASE}/vendors`, headers: auth });
        expect(getVendors.statusCode).toBe(200);

        const getPOs = await app.inject({ method: 'GET', url: `${BASE}/purchase-orders`, headers: auth });
        expect(getPOs.statusCode).toBe(200);

        const getCandidates = await app.inject({ method: 'GET', url: `${BASE}/duplicates/candidates`, headers: auth });
        expect(getCandidates.statusCode).toBe(200);
      });

      it('denies write mutations with 403 Forbidden', async () => {
        const postVendor = await app.inject({
          method: 'POST',
          url: `${BASE}/vendors`,
          headers: auth,
          payload: {
            name: 'Viewer Vendor',
            tax_number: 'TX-VIEWER-1',
            email: 'viewer@vendor.com',
            currency: 'USD',
          },
        });
        expect(postVendor.statusCode).toBe(403);
        const body = JSON.parse(postVendor.payload);
        expect(body.code).toBe('FORBIDDEN');
        expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);

        const postImport = await app.inject({
          method: 'POST',
          url: `${BASE}/import`,
          headers: auth,
          payload: {
            batch_id: '11111111-1111-1111-1111-111111111111',
            entity: 'vendor',
            source_row: 1,
            idempotency_key: 'viewer-key-01',
            record: { name: 'Item', tax_number: 'TX-V-1', email: 'v@v.com' },
          },
        });
        expect(postImport.statusCode).toBe(403);
      });
    });

    describe('Editor Role', () => {
      const auth = { authorization: `Bearer role:${Roles.EDITOR}` };

      it('allows vendor and purchase order creation and editing', async () => {
        const postVendor = await app.inject({
          method: 'POST',
          url: `${BASE}/vendors`,
          headers: auth,
          payload: {
            name: 'Editor Vendor',
            tax_number: 'TX-EDITOR-1',
            email: 'editor@vendor.com',
            currency: 'USD',
          },
        });
        expect(postVendor.statusCode).toBe(201);
        const vendor = JSON.parse(postVendor.payload);

        const patchVendor = await app.inject({
          method: 'PATCH',
          url: `${BASE}/vendors/${vendor.id}`,
          headers: auth,
          payload: {
            email: 'editor-updated@vendor.com',
          },
        });
        expect(patchVendor.statusCode).toBe(200);

        const postPO = await app.inject({
          method: 'POST',
          url: `${BASE}/purchase-orders`,
          headers: auth,
          payload: {
            po_number: 'PO-ED-001',
            vendor_id: vendor.id,
            order_date: '2026-10-24',
            currency: 'USD',
            lines: [
              {
                product_id: '00000000-0000-0000-0000-000000000001',
                line_number: 1,
                quantity: '5',
                price: '20.00',
              },
            ],
          },
        });
        expect(postPO.statusCode).toBe(201);
        const po = JSON.parse(postPO.payload);

        const patchPO = await app.inject({
          method: 'PATCH',
          url: `${BASE}/purchase-orders/${po.id}`,
          headers: auth,
          payload: {
            status: 'Sent',
          },
        });
        expect(patchPO.statusCode).toBe(200);
      });
    });

    describe('Migration Runner Role', () => {
      const auth = { authorization: `Bearer role:${Roles.MIGRATION_RUNNER}` };

      it('allows public import and batch import', async () => {
        const postImport = await app.inject({
          method: 'POST',
          url: `${BASE}/import`,
          headers: auth,
          payload: {
            batch_id: '22222222-2222-2222-2222-222222222222',
            entity: 'vendor',
            source_row: 1,
            idempotency_key: 'runner-import-01',
            record: {
              name: 'Migrated Vendor',
              tax_number: 'TX-MIG-01',
              email: 'mig@vendor.com',
              currency: 'USD',
            },
          },
        });
        expect(postImport.statusCode).toBe(201);

        const postBatch = await app.inject({
          method: 'POST',
          url: `${BASE}/import/batch`,
          headers: auth,
          payload: {
            batch_id: '33333333-3333-3333-3333-333333333333',
            entity: 'vendor',
            rows: [
              {
                source_row: 1,
                idempotency_key: 'batch-row-01',
                record: {
                  name: 'Batch Vendor',
                  tax_number: 'TX-BATCH-01',
                  email: 'batch@vendor.com',
                  currency: 'USD',
                },
              },
            ],
          },
        });
        expect(postBatch.statusCode).toBe(200);
      });

      it('denies browser human duplicate review with 403 Forbidden', async () => {
        const reviewRes = await app.inject({
          method: 'POST',
          url: `${BASE}/duplicates/review`,
          headers: auth,
          payload: {
            candidateId: '44444444-4444-4444-4444-444444444444',
            decision: 'REJECT',
            rationale: 'Review by runner not allowed',
          },
        });
        expect(reviewRes.statusCode).toBe(403);
        const body = JSON.parse(reviewRes.payload);
        expect(body.code).toBe('FORBIDDEN');
      });
    });

    describe('Analyst Role', () => {
      const auth = { authorization: `Bearer role:${Roles.ANALYST}` };

      it('allows read operations and denies mutations', async () => {
        const getVendors = await app.inject({ method: 'GET', url: `${BASE}/vendors`, headers: auth });
        expect(getVendors.statusCode).toBe(200);

        const postVendor = await app.inject({
          method: 'POST',
          url: `${BASE}/vendors`,
          headers: auth,
          payload: {
            name: 'Analyst Vendor',
            tax_number: 'TX-ANALYST-1',
            email: 'analyst@vendor.com',
          },
        });
        expect(postVendor.statusCode).toBe(403);
      });
    });

    describe('Admin Role', () => {
      const auth = { authorization: `Bearer role:${Roles.ADMIN}` };

      it('has universal access across all operations', async () => {
        const getVendors = await app.inject({ method: 'GET', url: `${BASE}/vendors`, headers: auth });
        expect(getVendors.statusCode).toBe(200);

        const postVendor = await app.inject({
          method: 'POST',
          url: `${BASE}/vendors`,
          headers: auth,
          payload: {
            name: 'Admin Vendor',
            tax_number: 'TX-ADMIN-1',
            email: 'admin@vendor.com',
          },
        });
        expect(postVendor.statusCode).toBe(201);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Acceptance Criterion 4: Object-Level Authorization (Tenant & Cross-User)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Object-Level Authorization Guards', () => {
    it('prevents cross-tenant access to vendors with 403 OBJECT_ACCESS_DENIED', async () => {
      // 1. Create vendor under tenant-alpha
      const createRes = await app.inject({
        method: 'POST',
        url: `${BASE}/vendors`,
        headers: {
          authorization: `Bearer role:${Roles.ADMIN}`,
          'x-tenant-id': 'tenant-alpha',
        },
        payload: {
          name: 'Alpha Vendor',
          tax_number: 'TX-ALPHA-001',
          email: 'alpha@vendor.com',
          currency: 'USD',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const vendor = JSON.parse(createRes.payload);

      // 2. Caller from tenant-beta attempts to read tenant-alpha vendor
      const readRes = await app.inject({
        method: 'GET',
        url: `${BASE}/vendors/${vendor.id}`,
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
        url: `${BASE}/vendors/${vendor.id}`,
        headers: {
          authorization: `Bearer role:${Roles.VIEWER}`,
          'x-tenant-id': 'tenant-alpha',
        },
      });
      expect(alphaReadRes.statusCode).toBe(200);
    });

    it('prevents non-admin users from mutating records created by another user with 403 CROSS_USER_MUTATION_FORBIDDEN', async () => {
      // 1. User Alice creates vendor
      const createRes = await app.inject({
        method: 'POST',
        url: `${BASE}/vendors`,
        headers: {
          authorization: `Bearer role:${Roles.EDITOR}`,
          'x-actor-id': 'user-alice',
        },
        payload: {
          name: 'Alice Vendor',
          tax_number: 'TX-ALICE-001',
          email: 'alice@vendor.com',
          currency: 'USD',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const vendor = JSON.parse(createRes.payload);

      // 2. User Bob (also Editor) attempts to PATCH Alice's vendor
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${BASE}/vendors/${vendor.id}`,
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
        url: `${BASE}/vendors/${vendor.id}`,
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
        url: `${BASE}/vendors/${vendor.id}`,
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

    it('prevents cross-tenant import execution', async () => {
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
          entity: 'vendor',
          source_row: 1,
          idempotency_key: 'gamma-delta-01',
          record: { name: 'Item', tax_number: 'TX-GD-1', email: 'gd@vendor.com' },
        },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('OBJECT_ACCESS_DENIED');
    });
  });
});
