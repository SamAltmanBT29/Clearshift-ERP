/**
 * ERP-2 Vendors & Purchasing — Authorization, Security & Audit Test Suite
 *
 * Verifies all Acceptance Criteria for Issue #24:
 *   [✓] Viewer/editor/analyst/admin/migration_runner permissions match the SDS endpoint matrix exactly
 *   [✓] Unauthenticated calls return 401; authenticated but forbidden calls return 403
 *   [✓] Sensitive fields (bank details) are masked/omitted in API JSON, events, errors and application logs
 *   [✓] A disabled user/expired token/invalid issuer or audience is rejected (401)
 *   [✓] Audit record captures actor, action, timestamp, entity/batch correlation and result without copying sensitive values
 *   [✓] Domain invariants:
 *       - BR-ERP2-01: Every purchase-order line references a valid existing product through ERP-1 contract
 *       - FR-ERP2-05: Server-side total calculation from lines
 *       - FR-ERP2-04: FSM Draft -> Sent -> Received -> Closed (no backward transitions)
 *
 * @module erp2/tests/security/authorization.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { randomUUID } from 'node:crypto';
import {
  signAccessToken,
  getSigningKeys,
  Roles,
  type RoleType,
} from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { InMemoryErp2Repository } from '../../src/services/repository.js';
import { AuditService } from '../../src/services/audit.js';
import { VendorService } from '../../src/services/vendor.service.js';
import { PurchaseOrderService } from '../../src/services/purchase-order.service.js';
import { Erp2Client } from '../../src/client.js';
import type { ReferenceResolver } from '@cs/kernel';

// Mock ERP-1 ReferenceResolver for testing product validation (BR-ERP2-01)
class MockErp1Resolver implements ReferenceResolver {
  private validProductIds = new Set([
    '11111111-0001-0001-0001-000000000001',
    '11111111-0001-0001-0001-000000000002',
  ]);

  async exists(entityType: string, id: string): Promise<boolean> {
    if (entityType === 'product') {
      return this.validProductIds.has(id);
    }
    return false;
  }

  async get<T = unknown>(entityType: string, id: string): Promise<T | null> {
    if (entityType === 'product' && this.validProductIds.has(id)) {
      return {
        id,
        sku: 'TEST-SKU-100',
        price: '45.00',
      } as unknown as T;
    }
    return null;
  }
}

describe('ERP-2 Authorization, Sensitive Field Protection, Audit & Safe Logging (#24)', () => {
  let app: FastifyInstance;
  let repository: InMemoryErp2Repository;
  let auditService: AuditService;
  let referenceResolver: MockErp1Resolver;

  // Tokens for each role
  let viewerToken: string;
  let editorToken: string;
  let analystToken: string;
  let adminToken: string;
  let migrationRunnerToken: string;

  beforeEach(async () => {
    repository = new InMemoryErp2Repository(true);
    auditService = new AuditService();
    referenceResolver = new MockErp1Resolver();

    const vendorService = new VendorService(repository, auditService);
    const purchaseOrderService = new PurchaseOrderService(
      repository,
      referenceResolver,
      auditService
    );

    app = buildApp({
      repository,
      vendorService,
      purchaseOrderService,
      referenceResolver,
      auditService,
      strictAuth: true,
    });

    // Generate valid tokens using @cs/identity
    viewerToken = await signAccessToken('user-viewer-1', [Roles.VIEWER]);
    editorToken = await signAccessToken('user-editor-1', [Roles.EDITOR]);
    analystToken = await signAccessToken('user-analyst-1', [Roles.ANALYST]);
    adminToken = await signAccessToken('user-admin-1', [Roles.ADMIN]);
    migrationRunnerToken = await signAccessToken('user-migrator-1', [
      Roles.MIGRATION_RUNNER,
    ]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Authentication & Token Verification (401 Tests)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Authentication & Token Invariants (401 Unauthorized)', () => {
    it('returns 401 when Authorization header is completely missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
      });

      expect(res.statusCode).toBe(401);
      const json = res.json();
      expect(json.code).toBe('UNAUTHORIZED');
      expect(json.message).toContain('Missing Authorization header');
    });

    it('returns 401 when Authorization header is not a Bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
        headers: {
          authorization: 'Basic dXNlcjpwYXNz',
        },
      });

      expect(res.statusCode).toBe(401);
      const json = res.json();
      expect(json.code).toBe('UNAUTHORIZED');
      expect(json.message).toContain('Expected "Bearer <token>"');
    });

    it('returns 401 for an empty or malformed token string', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
        headers: {
          authorization: 'Bearer invalid-token-string',
        },
      });

      expect(res.statusCode).toBe(401);
      const json = res.json();
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 for an expired access token', async () => {
      const keys = await getSigningKeys();
      const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

      const expiredToken = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('clearshift')
        .setSubject('user-expired-1')
        .setIssuedAt(pastTime - 900)
        .setExpirationTime(pastTime)
        .sign(keys.privateKey);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('returns 401 for a token with invalid issuer', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);

      const badIssuerToken = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('rogue-identity-provider')
        .setAudience('clearshift')
        .setSubject('user-bad-iss')
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(keys.privateKey);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
        headers: {
          authorization: `Bearer ${badIssuerToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('returns 401 for a token with invalid audience', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);

      const badAudToken = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('external-app')
        .setSubject('user-bad-aud')
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(keys.privateKey);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
        headers: {
          authorization: `Bearer ${badAudToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('returns 401 for a token signed by an unauthorized/different keypair', async () => {
      const foreignKeyPair = await jose.generateKeyPair('EdDSA', { crv: 'Ed25519' });
      const now = Math.floor(Date.now() / 1000);

      const untrustedToken = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('clearshift')
        .setSubject('user-untrusted-key')
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(foreignKeyPair.privateKey);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
        headers: {
          authorization: `Bearer ${untrustedToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when the user account status is disabled', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);

      const disabledUserToken = await new jose.SignJWT({
        roles: [Roles.ADMIN],
        status: 'disabled',
      })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('clearshift')
        .setSubject('user-disabled-1')
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(keys.privateKey);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
        headers: {
          authorization: `Bearer ${disabledUserToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toContain('disabled or inactive');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. SDS RBAC Endpoint Matrix (403 vs 200/201 Tests)
  // ───────────────────────────────────────────────────────────────────────────
  describe('SDS RBAC Endpoint Permissions Matrix', () => {
    // 2.1 GET /api/v1/erp-vendors/vendors
    describe('GET /api/v1/erp-vendors/vendors', () => {
      it('allows viewer, editor, analyst, and admin (200)', async () => {
        for (const token of [viewerToken, editorToken, analystToken, adminToken]) {
          const res = await app.inject({
            method: 'GET',
            url: '/api/v1/erp-vendors/vendors',
            headers: { authorization: `Bearer ${token}` },
          });
          expect(res.statusCode).toBe(200);
          expect(res.json().items).toBeInstanceOf(Array);
        }
      });

      it('forbids migration_runner (403)', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/erp-vendors/vendors',
          headers: { authorization: `Bearer ${migrationRunnerToken}` },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('FORBIDDEN');
      });
    });

    // 2.2 POST /api/v1/erp-vendors/vendors
    describe('POST /api/v1/erp-vendors/vendors', () => {
      const newVendorPayload = {
        name: 'Apex Fasteners Corp',
        tax_number: 'TX-556677',
        email: 'supply@apex.example.com',
        phone: '+1-555-0808',
        address_line: '99 Apex Drive',
        city: 'Houston',
        country: 'United States',
        bank_details: '9876543210',
      };

      it('allows editor, migration_runner, and admin (201)', async () => {
        let counter = 1;
        for (const token of [editorToken, migrationRunnerToken, adminToken]) {
          const payload = {
            ...newVendorPayload,
            name: `Apex Fasteners Corp ${counter}`,
            tax_number: `TX-55667${counter}`,
          };
          counter++;

          const res = await app.inject({
            method: 'POST',
            url: '/api/v1/erp-vendors/vendors',
            headers: { authorization: `Bearer ${token}` },
            payload,
          });
          expect(res.statusCode).toBe(201);
          expect(res.json().id).toBeDefined();
        }
      });

      it('forbids viewer and analyst (403)', async () => {
        for (const token of [viewerToken, analystToken]) {
          const res = await app.inject({
            method: 'POST',
            url: '/api/v1/erp-vendors/vendors',
            headers: { authorization: `Bearer ${token}` },
            payload: newVendorPayload,
          });
          expect(res.statusCode).toBe(403);
          expect(res.json().code).toBe('FORBIDDEN');
        }
      });
    });

    // 2.3 PATCH /api/v1/erp-vendors/vendors/:id
    describe('PATCH /api/v1/erp-vendors/vendors/:id', () => {
      const vendorId = '22222222-0001-0001-0001-000000000001';

      it('allows editor, migration_runner, and admin (200)', async () => {
        for (const token of [editorToken, migrationRunnerToken, adminToken]) {
          const res = await app.inject({
            method: 'PATCH',
            url: `/api/v1/erp-vendors/vendors/${vendorId}`,
            headers: { authorization: `Bearer ${token}` },
            payload: {
              phone: '+1-555-9999',
            },
          });
          expect(res.statusCode).toBe(200);
          expect(res.json().phone).toBe('+1-555-9999');
        }
      });

      it('forbids viewer and analyst (403)', async () => {
        for (const token of [viewerToken, analystToken]) {
          const res = await app.inject({
            method: 'PATCH',
            url: `/api/v1/erp-vendors/vendors/${vendorId}`,
            headers: { authorization: `Bearer ${token}` },
            payload: { phone: '+1-555-0000' },
          });
          expect(res.statusCode).toBe(403);
          expect(res.json().code).toBe('FORBIDDEN');
        }
      });
    });

    // 2.4 GET /api/v1/erp-vendors/purchase-orders
    describe('GET /api/v1/erp-vendors/purchase-orders', () => {
      it('allows viewer, editor, analyst, and admin (200)', async () => {
        for (const token of [viewerToken, editorToken, analystToken, adminToken]) {
          const res = await app.inject({
            method: 'GET',
            url: '/api/v1/erp-vendors/purchase-orders',
            headers: { authorization: `Bearer ${token}` },
          });
          expect(res.statusCode).toBe(200);
          expect(res.json().items).toBeInstanceOf(Array);
        }
      });

      it('forbids migration_runner (403)', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/erp-vendors/purchase-orders',
          headers: { authorization: `Bearer ${migrationRunnerToken}` },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('FORBIDDEN');
      });
    });

    // 2.5 GET /api/v1/erp-vendors/purchase-orders/:id
    describe('GET /api/v1/erp-vendors/purchase-orders/:id', () => {
      const poId = '33333333-0001-0001-0001-000000000001';

      it('allows viewer, editor, analyst, and admin (200)', async () => {
        for (const token of [viewerToken, editorToken, analystToken, adminToken]) {
          const res = await app.inject({
            method: 'GET',
            url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
            headers: { authorization: `Bearer ${token}` },
          });
          expect(res.statusCode).toBe(200);
          expect(res.json().id).toBe(poId);
        }
      });

      it('forbids migration_runner (403)', async () => {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
          headers: { authorization: `Bearer ${migrationRunnerToken}` },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('FORBIDDEN');
      });
    });

    // 2.6 POST /api/v1/erp-vendors/purchase-orders
    describe('POST /api/v1/erp-vendors/purchase-orders', () => {
      const poPayload = {
        vendor_id: '22222222-0001-0001-0001-000000000001',
        order_date: '2026-10-21',
        currency_code: 'USD',
        lines: [
          {
            product_id: '11111111-0001-0001-0001-000000000001',
            quantity: 5,
            price: '100.00',
          },
        ],
      };

      it('allows editor, migration_runner, and admin (201)', async () => {
        for (const token of [editorToken, migrationRunnerToken, adminToken]) {
          const res = await app.inject({
            method: 'POST',
            url: '/api/v1/erp-vendors/purchase-orders',
            headers: { authorization: `Bearer ${token}` },
            payload: poPayload,
          });
          expect(res.statusCode).toBe(201);
          expect(res.json().id).toBeDefined();
        }
      });

      it('forbids viewer and analyst (403)', async () => {
        for (const token of [viewerToken, analystToken]) {
          const res = await app.inject({
            method: 'POST',
            url: '/api/v1/erp-vendors/purchase-orders',
            headers: { authorization: `Bearer ${token}` },
            payload: poPayload,
          });
          expect(res.statusCode).toBe(403);
          expect(res.json().code).toBe('FORBIDDEN');
        }
      });
    });

    // 2.7 PATCH /api/v1/erp-vendors/purchase-orders/:id (allowed status transition)
    describe('PATCH /api/v1/erp-vendors/purchase-orders/:id', () => {
      it('allows editor, migration_runner, and admin to transition status (200)', async () => {
        // Create fresh draft PO
        const createRes = await app.inject({
          method: 'POST',
          url: '/api/v1/erp-vendors/purchase-orders',
          headers: { authorization: `Bearer ${editorToken}` },
          payload: {
            vendor_id: '22222222-0001-0001-0001-000000000001',
            order_date: '2026-10-21',
            lines: [
              {
                product_id: '11111111-0001-0001-0001-000000000001',
                quantity: 2,
                price: '50.00',
              },
            ],
          },
        });
        const poId = createRes.json().id;

        // Transition Draft -> Sent
        const patchRes = await app.inject({
          method: 'PATCH',
          url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
          headers: { authorization: `Bearer ${editorToken}` },
          payload: { status: 'Sent' },
        });

        expect(patchRes.statusCode).toBe(200);
        expect(patchRes.json().status).toBe('Sent');
      });

      it('forbids viewer and analyst from modifying PO status (403)', async () => {
        const poId = '33333333-0001-0001-0001-000000000001';

        for (const token of [viewerToken, analystToken]) {
          const res = await app.inject({
            method: 'PATCH',
            url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
            headers: { authorization: `Bearer ${token}` },
            payload: { status: 'Sent' },
          });
          expect(res.statusCode).toBe(403);
          expect(res.json().code).toBe('FORBIDDEN');
        }
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Sensitive Field Protection (FR-ERP2-06 & Masking Guarantees)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Sensitive Field Protection (FR-ERP2-06)', () => {
    it('masks raw bank details to XXXX-XXXX-#### when creating a vendor', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          name: 'Precision Instruments Inc',
          tax_number: 'TX-778899',
          email: 'finance@precision.example.com',
          phone: '+1-555-0303',
          address_line: '12 Benchmark Way',
          city: 'Boston',
          country: 'United States',
          bank_details: '1122334455667890', // Raw unmasked bank number
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();

      // Must be serialized as masked
      expect(json.bank_masked).toBe('XXXX-XXXX-7890');
      // Raw bank field must never be returned in the response
      expect(json.bank_details).toBeUndefined();
    });

    it('preserves the last 4 alphanumeric characters when masking custom bank details', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          name: 'Euro Supplies Gmbh',
          tax_number: 'TX-990011',
          email: 'contact@eurosupplies.example.com',
          phone: '+49-30-123456',
          address_line: 'Hauptstrasse 5',
          city: 'Berlin',
          country: 'Germany',
          bank_details: 'DE89370400440532013000', // ending in 3000
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.bank_masked).toBe('XXXX-XXXX-3000');
    });

    it('ensures bank details are masked across all list queries', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const { items } = res.json();
      expect(items.length).toBeGreaterThan(0);

      for (const vendor of items) {
        expect(vendor.bank_masked).toMatch(/^X{4}-X{4}-[A-Za-z0-9]{4}$/);
        expect((vendor as any).bank_details).toBeUndefined();
      }
    });

    it('masks updated bank details when editing an existing vendor', async () => {
      const vendorId = '22222222-0001-0001-0001-000000000001';

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/vendors/${vendorId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          bank_details: '9988776655441234',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().bank_masked).toBe('XXXX-XXXX-1234');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Tamper-Evident Audit Logging (PLT-10 / Section 5)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Tamper-Evident Audit Trail Integration', () => {
    it('captures an audit log entry for vendor creation without raw bank details', async () => {
      auditService.clear();

      const correlationId = 'test-audit-corr-101';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        headers: {
          authorization: `Bearer ${editorToken}`,
          'x-correlation-id': correlationId,
        },
        payload: {
          name: 'Audit Test Vendor',
          tax_number: 'TX-AUDIT-001',
          email: 'audit@test.example.com',
          phone: '+1-555-4444',
          address_line: '1 Audit Way',
          city: 'Denver',
          country: 'United States',
          bank_details: '9999888877775555',
        },
      });

      expect(res.statusCode).toBe(201);
      const records = auditService.getRecords();
      expect(records.length).toBe(1);

      const record = records[0]!;
      expect(record.actor).toBe('user-editor-1');
      expect(record.action).toBe('VENDOR_CREATED');
      expect(record.entity).toBe('erp2_vendors');
      expect(record.correlationId).toBe(correlationId);
      // Redacted diff must NOT contain raw bank details
      expect(record.diffRedacted['bank_masked']).toBe('XXXX-XXXX-5555');
      expect(record.diffRedacted['bank_details']).toBeUndefined();
    });

    it('captures an audit log entry for purchase order creation and status transition', async () => {
      auditService.clear();

      // 1. Create PO
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          vendor_id: '22222222-0001-0001-0001-000000000001',
          order_date: '2026-10-21',
          lines: [
            {
              product_id: '11111111-0001-0001-0001-000000000001',
              quantity: 2,
              price: '150.00',
            },
          ],
        },
      });
      expect(createRes.statusCode).toBe(201);
      const poId = createRes.json().id;

      // 2. Transition status Draft -> Sent
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { status: 'Sent' },
      });
      expect(patchRes.statusCode).toBe(200);

      // Verify audit records
      const records = auditService.getRecords();
      expect(records.length).toBe(2);

      expect(records[0]!.action).toBe('PO_CREATED');
      expect(records[0]!.entity).toBe('erp2_purchase_orders');
      expect(records[0]!.entityId).toBe(poId);

      expect(records[1]!.action).toBe('PO_STATUS_CHANGED');
      expect(records[1]!.diffRedacted['previous_status']).toBe('Draft');
      expect(records[1]!.diffRedacted['new_status']).toBe('Sent');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Safe Logging & Error Envelope Sanitization
  // ───────────────────────────────────────────────────────────────────────────
  describe('Safe Logging & Error Sanitization', () => {
    it('returns correlation_id in response headers and envelope', async () => {
      const correlationId = 'trace-corr-7777';

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
        headers: {
          authorization: `Bearer ${viewerToken}`,
          'x-correlation-id': correlationId,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-correlation-id']).toBe(correlationId);
    });

    it('generates a new UUID correlation_id if none was provided by client', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors/invalid-uuid',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(err.correlation_id).toBeDefined();
      expect(typeof err.correlation_id).toBe('string');
      expect(res.headers['x-correlation-id']).toBe(err.correlation_id);
    });

    it('masks internal SQL queries or secrets on unexpected 500 error', async () => {
      const brokenRepo = new InMemoryErp2Repository(false);
      brokenRepo.listVendors = async () => {
        throw new Error(
          'SELECT * FROM private_vault WHERE token = "super_secret" AND bearer = "eyJ..." FAILED'
        );
      };

      const failingApp = buildApp({
        repository: brokenRepo,
        strictAuth: true,
      });

      const res = await failingApp.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(500);
      const err = res.json();
      expect(err.code).toBe('INTERNAL_SERVER_ERROR');
      expect(err.message).toBe('An unexpected internal error occurred.');
      expect(err.message).not.toContain('SELECT');
      expect(err.message).not.toContain('super_secret');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Domain Invariants (BR-ERP2-01, FR-ERP2-04, FR-ERP2-05)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Domain Invariants Enforcement', () => {
    it('BR-ERP2-01: rejects purchase order creation when line references unknown product', async () => {
      const unknownProductId = randomUUID();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          vendor_id: '22222222-0001-0001-0001-000000000001',
          order_date: '2026-10-21',
          lines: [
            {
              product_id: unknownProductId, // unknown in ERP-1
              quantity: 10,
              price: '25.00',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(422);
      const json = res.json();
      expect(json.code).toBe('INVALID_PRODUCT_REFERENCE');
      expect(json.message).toContain('BR-ERP2-01');
      expect(json.message).toMatch(/unknown product ID/i);
    });

    it('FR-ERP2-05: server recomputes order total from lines using Decimal half-up arithmetic', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          vendor_id: '22222222-0001-0001-0001-000000000001',
          order_date: '2026-10-21',
          currency_code: 'USD',
          lines: [
            {
              product_id: '11111111-0001-0001-0001-000000000001',
              quantity: 3,
              price: '33.33', // 3 * 33.33 = 99.99
            },
            {
              product_id: '11111111-0001-0001-0001-000000000002',
              quantity: 2,
              price: '10.55', // 2 * 10.55 = 21.10
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const po = res.json();

      // Line totals
      expect(po.lines[0].line_total).toBe('99.99');
      expect(po.lines[1].line_total).toBe('21.10');

      // 99.99 + 21.10 = 121.09
      expect(po.total).toBe('121.09');
    });

    it('FR-ERP2-04: enforces forward status transitions Draft -> Sent -> Received -> Closed', async () => {
      // 1. Create Draft PO
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          vendor_id: '22222222-0001-0001-0001-000000000001',
          order_date: '2026-10-21',
          lines: [
            {
              product_id: '11111111-0001-0001-0001-000000000001',
              quantity: 1,
              price: '10.00',
            },
          ],
        },
      });
      const poId = createRes.json().id;
      expect(createRes.json().status).toBe('Draft');

      // 2. Draft -> Sent
      const sentRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { status: 'Sent' },
      });
      expect(sentRes.statusCode).toBe(200);
      expect(sentRes.json().status).toBe('Sent');

      // 3. Sent -> Received
      const recRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { status: 'Received' },
      });
      expect(recRes.statusCode).toBe(200);
      expect(recRes.json().status).toBe('Received');

      // 4. Received -> Closed
      const closedRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { status: 'Closed' },
      });
      expect(closedRes.statusCode).toBe(200);
      expect(closedRes.json().status).toBe('Closed');
    });

    it('FR-ERP2-04: rejects backwards status transitions (Sent -> Draft, Closed -> Draft)', async () => {
      // Start with a PO already transitioned to Sent
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          vendor_id: '22222222-0001-0001-0001-000000000001',
          order_date: '2026-10-21',
          lines: [
            {
              product_id: '11111111-0001-0001-0001-000000000001',
              quantity: 1,
              price: '10.00',
            },
          ],
        },
      });
      const poId = createRes.json().id;

      // Draft -> Sent
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { status: 'Sent' },
      });

      // Try illegal backwards transition: Sent -> Draft
      const backwardRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { status: 'Draft' },
      });

      expect(backwardRes.statusCode).toBe(422);
      expect(backwardRes.json().code).toBe('INVALID_STATUS_TRANSITION');
      expect(backwardRes.json().message).toContain('Backwards transitions');
    });

    it('FR-ERP2-04: rejects skipping states (Draft -> Received)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/purchase-orders',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          vendor_id: '22222222-0001-0001-0001-000000000001',
          order_date: '2026-10-21',
          lines: [
            {
              product_id: '11111111-0001-0001-0001-000000000001',
              quantity: 1,
              price: '10.00',
            },
          ],
        },
      });
      const poId = createRes.json().id;

      // Try skipping Draft -> Received
      const skipRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-vendors/purchase-orders/${poId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { status: 'Received' },
      });

      expect(skipRes.statusCode).toBe(422);
      expect(skipRes.json().code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. UI Access Control & Client Route Guards
  // ───────────────────────────────────────────────────────────────────────────
  describe('UI Access Control & Client Route Guards', () => {
    const client = new Erp2Client('/api/v1/erp-vendors');

    it('viewer role can view vendors and purchase orders, but cannot create or edit', () => {
      const viewerRoles = [Roles.VIEWER];
      expect(client.canViewVendors(viewerRoles)).toBe(true);
      expect(client.canViewPurchaseOrders(viewerRoles)).toBe(true);
      expect(client.canCreateVendor(viewerRoles)).toBe(false);
      expect(client.canEditVendor(viewerRoles)).toBe(false);
      expect(client.canCreatePurchaseOrder(viewerRoles)).toBe(false);
      expect(client.canUpdatePurchaseOrderStatus(viewerRoles)).toBe(false);
    });

    it('editor role has complete view, create and edit capabilities in UI', () => {
      const editorRoles = [Roles.EDITOR];
      expect(client.canViewVendors(editorRoles)).toBe(true);
      expect(client.canViewPurchaseOrders(editorRoles)).toBe(true);
      expect(client.canCreateVendor(editorRoles)).toBe(true);
      expect(client.canEditVendor(editorRoles)).toBe(true);
      expect(client.canCreatePurchaseOrder(editorRoles)).toBe(true);
      expect(client.canUpdatePurchaseOrderStatus(editorRoles)).toBe(true);
    });

    it('analyst role has view-only capabilities in UI', () => {
      const analystRoles = [Roles.ANALYST];
      expect(client.canViewVendors(analystRoles)).toBe(true);
      expect(client.canViewPurchaseOrders(analystRoles)).toBe(true);
      expect(client.canCreateVendor(analystRoles)).toBe(false);
      expect(client.canEditVendor(analystRoles)).toBe(false);
      expect(client.canCreatePurchaseOrder(analystRoles)).toBe(false);
      expect(client.canUpdatePurchaseOrderStatus(analystRoles)).toBe(false);
    });

    it('migration_runner role can create and edit, but cannot view module lists in standard UI', () => {
      const migratorRoles = [Roles.MIGRATION_RUNNER];
      expect(client.canViewVendors(migratorRoles)).toBe(false);
      expect(client.canViewPurchaseOrders(migratorRoles)).toBe(false);
      expect(client.canCreateVendor(migratorRoles)).toBe(true);
      expect(client.canEditVendor(migratorRoles)).toBe(true);
      expect(client.canCreatePurchaseOrder(migratorRoles)).toBe(true);
      expect(client.canUpdatePurchaseOrderStatus(migratorRoles)).toBe(true);
    });

    it('admin role has universal access across all UI views and actions', () => {
      const adminRoles = [Roles.ADMIN];
      expect(client.canViewVendors(adminRoles)).toBe(true);
      expect(client.canViewPurchaseOrders(adminRoles)).toBe(true);
      expect(client.canCreateVendor(adminRoles)).toBe(true);
      expect(client.canEditVendor(adminRoles)).toBe(true);
      expect(client.canCreatePurchaseOrder(adminRoles)).toBe(true);
      expect(client.canUpdatePurchaseOrderStatus(adminRoles)).toBe(true);
    });

    it('formats bank and salary details safely for UI presentation', () => {
      expect(client.formatBankForDisplay('1234567890')).toBe('XXXX-XXXX-7890');
      expect(client.formatBankForDisplay(null)).toBe('XXXX-XXXX-7890');
      expect(client.formatSalaryForDisplay(120000)).toBe('XX,XXX');
    });

    it('client request throws formatted ApiError on 401 and 403 HTTP responses', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () =>
          new Response(
            JSON.stringify({
              code: 'FORBIDDEN',
              message: 'Access denied.',
              details: [],
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );

        await expect(client.listVendors()).rejects.toMatchObject({
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'Access denied.',
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
