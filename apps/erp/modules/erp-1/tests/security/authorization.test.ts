/**
 * ERP-1 Products & Inventory — Security, Authorization, Masking & Audit Suite
 *
 * Traceability:
 *   - Issue #14: [ERP1-09] Authorization, sensitive-field protection, audit and safe logging
 *   - PLT-05: Hub JWT authentication & signature verification
 *   - PLT-06: Shared RBAC matrix enforcement
 *   - PLT-10: Append-only audit logging & safe logging
 *   - PLT-12: Sensitive field masking & export protections
 *   - SDS §9.3 & §9.4: Route permission matrix & sensitive values
 *
 * @module erp1/tests/security/authorization.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { Actions, Resources, Roles, type RoleType } from '@clearshift/contracts';
import { InMemoryAuditRepository, hasPermission } from '@cs/core';
import { getSigningKeys, signAccessToken } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Erp1AuditService } from '../../src/services/audit.js';
import {
  Erp1Policies,
  isErp1PolicyAllowed,
} from '../../src/policies/authorization.js';
import { maskErp1SensitiveFields } from '../../src/policies/field-masking.js';
import {
  ERP1_DEFAULT_CATEGORY_ID,
  InMemoryErp1Repository,
} from '../../src/services/repository.js';
import { Erp1Service } from '../../src/services/erp1.service.js';

const BASE = '/api/v1/erp-products';

describe('ERP-1 Security, Authorization and Safe Logging (#14)', () => {
  let app: FastifyInstance;
  let auditRepository: InMemoryAuditRepository;
  let auditService: Erp1AuditService;
  let repository: InMemoryErp1Repository;
  let service: Erp1Service;

  beforeEach(() => {
    auditRepository = new InMemoryAuditRepository();
    auditService = new Erp1AuditService(auditRepository);
    repository = new InMemoryErp1Repository(true);
    service = new Erp1Service({ repository, auditService: auditService.auditService });
    app = buildApp({
      repository,
      erp1Service: service,
      auditService,
      authRequired: true,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function createSignedToken(role: RoleType, subject = `test-${role}`): Promise<string> {
    return signAccessToken(subject, [role]);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // AC1: SDS Role Matrix Verification
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC1: SDS Endpoint & Policy Role Matrix', () => {
    it('matches the SDS role matrix for reads, creates, updates, and migration loads', () => {
      const allRoles: RoleType[] = [
        Roles.VIEWER,
        Roles.EDITOR,
        Roles.MIGRATION_RUNNER,
        Roles.ANALYST,
        Roles.ADMIN,
      ];

      // Products Read
      const allowedProductReads = [Roles.VIEWER, Roles.EDITOR, Roles.ANALYST, Roles.ADMIN];
      for (const role of allowedProductReads) {
        expect(isErp1PolicyAllowed([role], 'PRODUCTS_READ')).toBe(true);
      }
      expect(isErp1PolicyAllowed([Roles.MIGRATION_RUNNER], 'PRODUCTS_READ')).toBe(false);

      // Products Create
      const allowedProductCreates = [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN];
      for (const role of allowedProductCreates) {
        expect(isErp1PolicyAllowed([role], 'PRODUCTS_CREATE')).toBe(true);
      }
      expect(isErp1PolicyAllowed([Roles.VIEWER], 'PRODUCTS_CREATE')).toBe(false);
      expect(isErp1PolicyAllowed([Roles.ANALYST], 'PRODUCTS_CREATE')).toBe(false);

      // Products Update
      const allowedProductUpdates = [Roles.EDITOR, Roles.ADMIN];
      for (const role of allowedProductUpdates) {
        expect(isErp1PolicyAllowed([role], 'PRODUCTS_UPDATE')).toBe(true);
      }
      expect(isErp1PolicyAllowed([Roles.VIEWER], 'PRODUCTS_UPDATE')).toBe(false);
      expect(isErp1PolicyAllowed([Roles.ANALYST], 'PRODUCTS_UPDATE')).toBe(false);
      expect(isErp1PolicyAllowed([Roles.MIGRATION_RUNNER], 'PRODUCTS_UPDATE')).toBe(false);

      // Categories Read & Create
      for (const role of allowedProductReads) {
        expect(isErp1PolicyAllowed([role], 'CATEGORIES_READ')).toBe(true);
      }
      for (const role of allowedProductCreates) {
        expect(isErp1PolicyAllowed([role], 'CATEGORIES_CREATE')).toBe(true);
      }

      // Stock Read & Opening Create
      for (const role of allowedProductReads) {
        expect(isErp1PolicyAllowed([role], 'STOCK_READ')).toBe(true);
      }
      for (const role of allowedProductCreates) {
        expect(isErp1PolicyAllowed([role], 'STOCK_CREATE')).toBe(true);
      }

      // Migration Import Execute
      expect(isErp1PolicyAllowed([Roles.MIGRATION_RUNNER], 'IMPORT_EXECUTE')).toBe(true);
      expect(isErp1PolicyAllowed([Roles.ADMIN], 'IMPORT_EXECUTE')).toBe(true);
      expect(isErp1PolicyAllowed([Roles.VIEWER], 'IMPORT_EXECUTE')).toBe(false);
      expect(isErp1PolicyAllowed([Roles.EDITOR], 'IMPORT_EXECUTE')).toBe(false);
      expect(isErp1PolicyAllowed([Roles.ANALYST], 'IMPORT_EXECUTE')).toBe(false);

      // Duplicate Human Review
      expect(isErp1PolicyAllowed([Roles.EDITOR], 'DUPLICATES_REVIEW')).toBe(true);
      expect(isErp1PolicyAllowed([Roles.ADMIN], 'DUPLICATES_REVIEW')).toBe(true);
      expect(isErp1PolicyAllowed([Roles.VIEWER], 'DUPLICATES_REVIEW')).toBe(false);
      expect(isErp1PolicyAllowed([Roles.MIGRATION_RUNNER], 'DUPLICATES_REVIEW')).toBe(false);
      expect(isErp1PolicyAllowed([Roles.ANALYST], 'DUPLICATES_REVIEW')).toBe(false);

      // Export capability
      expect(hasPermission([Roles.ADMIN], Actions.EXPORT, Resources.ERP1_PRODUCTS)).toBe(true);
      expect(hasPermission([Roles.ANALYST], Actions.EXPORT, Resources.ERP1_PRODUCTS)).toBe(true);
      expect(hasPermission([Roles.VIEWER], Actions.EXPORT, Resources.ERP1_PRODUCTS)).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC2: HTTP 401 Unauthorized & 403 Forbidden
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC2: HTTP 401 & 403 Enforcement', () => {
    it('returns 401 for unauthenticated requests and 403 for authenticated forbidden requests', async () => {
      // 1. Unauthenticated request
      const unauth = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
      });
      expect(unauth.statusCode).toBe(401);
      const unauthBody = JSON.parse(unauth.payload);
      expect(unauthBody.code).toBe('UNAUTHORIZED');

      // 2. Authenticated but forbidden request
      const viewerToken = await createSignedToken(Roles.VIEWER);
      const forbiddenWrite = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          name: 'Forbidden Item',
          sku: 'FORBIDDEN-01',
          categoryId: ERP1_DEFAULT_CATEGORY_ID,
          unitOfMeasure: 'pcs',
          price: 10,
          currency: 'USD',
        },
      });
      expect(forbiddenWrite.statusCode).toBe(403);
      const forbiddenBody = JSON.parse(forbiddenWrite.payload);
      expect(forbiddenBody.code).toBe('FORBIDDEN');
    });

    it('enforces read and edit policies at the HTTP boundary for Migration Runner', async () => {
      const runnerToken = await createSignedToken(Roles.MIGRATION_RUNNER);

      // Ingestion allowed
      const importRes = await app.inject({
        method: 'POST',
        url: `${BASE}/import`,
        headers: { authorization: `Bearer ${runnerToken}` },
        payload: {
          batch_id: '44444444-4444-4444-4444-444444444444',
          entity: 'product',
          source_row: 1,
          idempotency_key: 'runner-key-01',
          record: {
            name: 'Runner Item',
            sku: 'RUNNER-01',
            categoryId: ERP1_DEFAULT_CATEGORY_ID,
            unit_of_measure: 'pcs',
            price: 20,
            currency: 'USD',
          },
        },
      });
      expect(importRes.statusCode).toBe(201);

      // Browser UI edit forbidden
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${BASE}/products/ffffffff-0001-0001-0001-000000000001`,
        headers: { authorization: `Bearer ${runnerToken}` },
        payload: { name: 'Attempted Runner Edit' },
      });
      expect(patchRes.statusCode).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC3: Sensitive Field Masking & Log Redaction
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC3: Sensitive Field Masking & Secret Protection', () => {
    it('masks bank accounts, salaries, and redacts credentials in memory', () => {
      const sensitiveRecord = {
        product_name: 'Test Drill',
        supplier_bank_account: '9876543210',
        account_number: '1234567890',
        short_bank_account: '12',
        salary: 85000,
        supplier_tax_id: 'TAX-999',
        password: 'SuperSecretPassword',
        api_token: 'secret-token-xyz',
        nested: {
          bank_account: '5555444433332222',
          hourly_rate: 45,
        },
      };

      // 1. Viewer / non-admin masking
      const masked = maskErp1SensitiveFields(sensitiveRecord, [Roles.VIEWER]);
      expect(masked.supplier_bank_account).toBe('XXXX-XXXX-3210');
      expect(masked.account_number).toBe('XXXX-XXXX-7890');
      expect(masked.short_bank_account).toBe('XXXX-XXXX-XXXX');
      expect(masked.salary).toBe('XX,XXX');
      expect(masked.supplier_tax_id).toBe('XX,XXX');
      expect(masked.password).toBe('[REDACTED]');
      expect(masked.api_token).toBe('[REDACTED]');
      expect((masked.nested as any).bank_account).toBe('XXXX-XXXX-2222');
      expect((masked.nested as any).hourly_rate).toBe('XX,XXX');

      // 2. Admin role retains numeric salary
      const adminMasked = maskErp1SensitiveFields(sensitiveRecord, [Roles.ADMIN]);
      expect(adminMasked.salary).toBe(85000);
      expect((adminMasked.nested as any).hourly_rate).toBe(45);
      expect(adminMasked.supplier_bank_account).toBe('XXXX-XXXX-3210');
      expect(adminMasked.password).toBe('[REDACTED]');
    });

    it('masks sensitive fields in Fastify onSend hook before JSON transmission', async () => {
      const viewerToken = await createSignedToken(Roles.VIEWER);

      // Custom route returning mock payload with sensitive fields
      app.get('/test-sensitive-response', async () => ({
        product_id: 'test-01',
        supplier_bank_account: '1234567890',
        salary: 95000,
        credential_token: 'raw-secret',
      }));

      const res = await app.inject({
        method: 'GET',
        url: '/test-sensitive-response',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.supplier_bank_account).toBe('XXXX-XXXX-7890');
      expect(body.salary).toBe('XX,XXX');
      expect(body.credential_token).toBe('[REDACTED]');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC4: Disabled User, Expired Token, Invalid Issuer/Audience
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC4: Token Validation & Account Revocation', () => {
    it('rejects expired tokens with 401 Unauthorized', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('clearshift')
        .setSubject('test-expired')
        .setJti('jti-expired')
        .setIssuedAt(now - 3600)
        .setExpirationTime(now - 60)
        .sign(keys.privateKey);

      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
        headers: { authorization: `Bearer ${expiredToken}` },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('rejects tokens with invalid issuer or audience with 401', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);

      const wrongIssuer = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('malicious-issuer')
        .setAudience('clearshift')
        .setSubject('test-user')
        .setJti('jti-1')
        .setIssuedAt(now - 60)
        .setExpirationTime(now + 3600)
        .sign(keys.privateKey);

      const res1 = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
        headers: { authorization: `Bearer ${wrongIssuer}` },
      });
      expect(res1.statusCode).toBe(401);

      const wrongAudience = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('other-audience')
        .setSubject('test-user')
        .setJti('jti-2')
        .setIssuedAt(now - 60)
        .setExpirationTime(now + 3600)
        .sign(keys.privateKey);

      const res2 = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
        headers: { authorization: `Bearer ${wrongAudience}` },
      });
      expect(res2.statusCode).toBe(401);
    });

    it('rejects disabled user accounts with 401 Unauthorized', async () => {
      const token = await createSignedToken(Roles.ADMIN, 'user-disabled-01');

      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.details[0]?.code).toBe('USER_DISABLED');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC5: Audit Trail & Correlation
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC5: Audit Trail & Safe Logging', () => {
    it('captures authentication and authorization failures in append-only audit trail', async () => {
      const corrId = 'corr-sec-test-01';

      // 1. Auth failure
      await app.inject({
        method: 'GET',
        url: `${BASE}/products`,
        headers: {
          'x-correlation-id': corrId,
        },
      });

      const records = await auditService.query({ correlationId: corrId });
      expect(records.length).toBeGreaterThanOrEqual(1);
      const authFailed = records.find((r) => r.action === 'auth.failed');
      expect(authFailed).toBeDefined();
      expect(authFailed?.result).toBe('failure');
      expect(authFailed?.reason).toBe('missing_credentials');
      expect(authFailed?.targetEntity).toBe('erp1_api');
    });

    it('audit record does not store raw passwords or bearer tokens in metadata', async () => {
      const entry = await auditService.record({
        actor: 'admin-user',
        actorRole: 'admin',
        action: 'product.created',
        targetEntity: 'erp1.products',
        targetId: 'prod-001',
        correlationId: 'corr-clean-01',
        result: 'success',
        metadata: {
          sku: 'SAFE-SKU-01',
          name: 'Safe Product',
        },
      });

      expect(entry.id).toBeDefined();
      expect(entry.occurredAt).toBeDefined();
      expect(entry.metadata?.sku).toBe('SAFE-SKU-01');
      expect(JSON.stringify(entry)).not.toContain('Bearer ');
      expect(JSON.stringify(entry)).not.toContain('password');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC6: Domain Invariants Assertion
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC6: Domain Invariants', () => {
    it('asserts SKU uniqueness in repository and rejects duplicate SKU', async () => {
      const adminToken = await createSignedToken(Roles.ADMIN);

      const res1 = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Unique Product 1',
          sku: 'UNIQUE-SKU-01',
          categoryId: ERP1_DEFAULT_CATEGORY_ID,
          unitOfMeasure: 'pcs',
          price: 12.5,
          currency: 'USD',
        },
      });
      expect(res1.statusCode).toBe(201);

      // Re-posting with same SKU must fail with 409
      const res2 = await app.inject({
        method: 'POST',
        url: `${BASE}/products`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Unique Product 2',
          sku: 'UNIQUE-SKU-01',
          categoryId: ERP1_DEFAULT_CATEGORY_ID,
          unitOfMeasure: 'pcs',
          price: 15.0,
          currency: 'USD',
        },
      });
      expect(res2.statusCode).toBe(409);
    });

    it('rejects negative stock opening balance with 422 Unprocessable', async () => {
      const runnerToken = await createSignedToken(Roles.MIGRATION_RUNNER);

      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/stock/opening`,
        headers: { authorization: `Bearer ${runnerToken}` },
        payload: {
          productId: 'ffffffff-0001-0001-0001-000000000001',
          quantity: -10,
          idempotencyKey: 'neg-stock-key-01',
        },
      });
      expect(res.statusCode).toBe(422);
    });
  });
});
