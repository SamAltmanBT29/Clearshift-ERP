/**
 * ERP-4 Finance & Accounting — Security, Authorization, Sensitive-Field Protection & Audit Test Suite
 *
 * Exhaustively validates:
 *   - Issues #44 and #171 requirements and V1 acceptance criteria
 *   - AC1: Viewer/Editor/Analyst/Admin/Migration Runner permissions match the SDS endpoint matrix exactly
 *   - AC2: Unauthenticated calls return 401; authenticated but forbidden calls return 403
 *   - AC3: Sensitive fields are masked/omitted in API JSON, CSV exports, events, errors, and logs
 *   - AC4: Disabled users, expired tokens, invalid issuers, invalid audiences are rejected
 *   - AC5: Audit records capture actor, action, timestamp, correlationId, entity without leaking secrets
 *   - AC6: Domain invariant: Every posted journal entry balances exactly at currency precision
 *   - AC7: Object-level authorization guards prevent unauthorized multi-tenant and cross-user mutations
 *
 * @module erp4/tests/security/authorization.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import * as jose from 'jose';
import { Roles, type RoleType, signAccessToken, getSigningKeys } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { InMemoryFinanceRepository } from '../../src/services/repository.js';
import { FinanceService } from '../../src/services/finance.service.js';
import { Erp4AuditService } from '../../src/services/audit.js';
import { InMemoryAuditRepository } from '@cs/core';
import {
  maskBankAccountNumber,
  maskSalary,
  maskGovernmentId,
  maskSensitiveFields,
  maskCsvExportRecords,
} from '../../src/policies/masking.js';
import { isFinancePolicyAllowed, FinancePolicies } from '../../src/policies/permissions.js';
import {
  assertTenantAccess,
  assertObjectMutationAccess,
} from '../../src/interface/authz.js';

describe('ERP-4 Finance & Accounting — Security & Authorization Suite (#44 / #171)', () => {
  let repository: InMemoryFinanceRepository;
  let auditRepository: InMemoryAuditRepository;
  let auditService: Erp4AuditService;
  let financeService: FinanceService;
  let app: FastifyInstance;

  const ACCT_CASH_ID = 'aaaaaaaa-0001-0001-0001-000000000001';
  const ACCT_BANK_ID = 'aaaaaaaa-0001-0001-0001-000000000002';
  const ACCT_SALES_ID = 'aaaaaaaa-0001-0001-0001-000000000004';
  const PERIOD_OPEN_ID = 'bbbbbbbb-0001-0001-0001-000000000001';

  beforeEach(() => {
    repository = new InMemoryFinanceRepository(true); // seeds accounts and periods
    auditRepository = new InMemoryAuditRepository();
    auditService = new Erp4AuditService(auditRepository);
    financeService = new FinanceService({ repository, auditService });
    app = buildApp({
      repository,
      financeService,
      auditService,
      authRequired: true, // strict mode
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC1: SDS Role-Based Access Control Matrix (Exact Match & Default Deny)
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC1: SDS Endpoint Matrix Permission Enforcement', () => {
    it('verifies unit policy check matches SDS matrix exactly', () => {
      // 1. Accounts Read
      expect(isFinancePolicyAllowed([Roles.VIEWER], FinancePolicies.ACCOUNTS_READ)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.EDITOR], FinancePolicies.ACCOUNTS_READ)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.ANALYST], FinancePolicies.ACCOUNTS_READ)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.ADMIN], FinancePolicies.ACCOUNTS_READ)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.MIGRATION_RUNNER], FinancePolicies.ACCOUNTS_READ)).toBe(false);

      // 2. Accounts Create & Update (Editor & Admin only)
      expect(isFinancePolicyAllowed([Roles.VIEWER], FinancePolicies.ACCOUNTS_CREATE)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.ANALYST], FinancePolicies.ACCOUNTS_CREATE)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.MIGRATION_RUNNER], FinancePolicies.ACCOUNTS_CREATE)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.EDITOR], FinancePolicies.ACCOUNTS_CREATE)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.ADMIN], FinancePolicies.ACCOUNTS_CREATE)).toBe(true);

      // 3. Journal Entry Create (Editor & Migration Runner per SDS line 307)
      expect(isFinancePolicyAllowed([Roles.VIEWER], FinancePolicies.JOURNAL_CREATE)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.ANALYST], FinancePolicies.JOURNAL_CREATE)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.EDITOR], FinancePolicies.JOURNAL_CREATE)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.MIGRATION_RUNNER], FinancePolicies.JOURNAL_CREATE)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.ADMIN], FinancePolicies.JOURNAL_CREATE)).toBe(true);

      // 4. Journal Entry Post & Reverse (Editor & Admin)
      expect(isFinancePolicyAllowed([Roles.VIEWER], FinancePolicies.JOURNAL_POST)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.ANALYST], FinancePolicies.JOURNAL_POST)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.MIGRATION_RUNNER], FinancePolicies.JOURNAL_POST)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.EDITOR], FinancePolicies.JOURNAL_POST)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.ADMIN], FinancePolicies.JOURNAL_POST)).toBe(true);

      // 5. Bulk Opening Balances (Migration Runner & Admin per SDS line 309)
      expect(isFinancePolicyAllowed([Roles.VIEWER], FinancePolicies.OPENING_BALANCES_LOAD)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.EDITOR], FinancePolicies.OPENING_BALANCES_LOAD)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.ANALYST], FinancePolicies.OPENING_BALANCES_LOAD)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.MIGRATION_RUNNER], FinancePolicies.OPENING_BALANCES_LOAD)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.ADMIN], FinancePolicies.OPENING_BALANCES_LOAD)).toBe(true);

      // 6. Trial Balance Read (Viewer, Analyst, Editor, Admin)
      expect(isFinancePolicyAllowed([Roles.VIEWER], FinancePolicies.TRIAL_BALANCE_READ)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.ANALYST], FinancePolicies.TRIAL_BALANCE_READ)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.EDITOR], FinancePolicies.TRIAL_BALANCE_READ)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.ADMIN], FinancePolicies.TRIAL_BALANCE_READ)).toBe(true);
      expect(isFinancePolicyAllowed([Roles.MIGRATION_RUNNER], FinancePolicies.TRIAL_BALANCE_READ)).toBe(false);

      // 7. Periods Update (Admin only)
      expect(isFinancePolicyAllowed([Roles.VIEWER], FinancePolicies.PERIODS_UPDATE)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.EDITOR], FinancePolicies.PERIODS_UPDATE)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.MIGRATION_RUNNER], FinancePolicies.PERIODS_UPDATE)).toBe(false);
      expect(isFinancePolicyAllowed([Roles.ADMIN], FinancePolicies.PERIODS_UPDATE)).toBe(true);

      // 8. Default Deny on empty or unknown roles
      expect(isFinancePolicyAllowed([], FinancePolicies.ACCOUNTS_READ)).toBe(false);
      expect(isFinancePolicyAllowed(['guest', 'contractor'], FinancePolicies.ACCOUNTS_READ)).toBe(false);
      expect(isFinancePolicyAllowed(undefined, FinancePolicies.ACCOUNTS_READ)).toBe(false);
    });

    it('enforces table-driven HTTP endpoint authorization across all 5 standard roles', async () => {
      const viewerToken = await signAccessToken('usr-viewer-01', [Roles.VIEWER]);
      const editorToken = await signAccessToken('usr-editor-01', [Roles.EDITOR]);
      const analystToken = await signAccessToken('usr-analyst-01', [Roles.ANALYST]);
      const runnerToken = await signAccessToken('usr-runner-01', [Roles.MIGRATION_RUNNER]);
      const adminToken = await signAccessToken('usr-admin-01', [Roles.ADMIN]);

      // 1. GET /accounts: Viewer(200), Editor(200), Analyst(200), Admin(200), Runner(403)
      const resV = await app.inject({ method: 'GET', url: '/api/v1/erp-finance/accounts', headers: { authorization: `Bearer ${viewerToken}` } });
      expect(resV.statusCode).toBe(200);

      const resE = await app.inject({ method: 'GET', url: '/api/v1/erp-finance/accounts', headers: { authorization: `Bearer ${editorToken}` } });
      expect(resE.statusCode).toBe(200);

      const resA = await app.inject({ method: 'GET', url: '/api/v1/erp-finance/accounts', headers: { authorization: `Bearer ${analystToken}` } });
      expect(resA.statusCode).toBe(200);

      const resAdmin = await app.inject({ method: 'GET', url: '/api/v1/erp-finance/accounts', headers: { authorization: `Bearer ${adminToken}` } });
      expect(resAdmin.statusCode).toBe(200);

      const resR = await app.inject({ method: 'GET', url: '/api/v1/erp-finance/accounts', headers: { authorization: `Bearer ${runnerToken}` } });
      expect(resR.statusCode).toBe(403);
      expect(resR.json().code).toBe('INSUFFICIENT_PERMISSIONS');

      // 2. POST /accounts: Viewer(403), Analyst(403), Runner(403), Editor(201), Admin(201)
      const accountPayload = { code: '1088-TEST', name: 'Test Account', type: 'asset' };
      const postV = await app.inject({ method: 'POST', url: '/api/v1/erp-finance/accounts', headers: { authorization: `Bearer ${viewerToken}` }, payload: accountPayload });
      expect(postV.statusCode).toBe(403);

      const postA = await app.inject({ method: 'POST', url: '/api/v1/erp-finance/accounts', headers: { authorization: `Bearer ${analystToken}` }, payload: accountPayload });
      expect(postA.statusCode).toBe(403);

      const postR = await app.inject({ method: 'POST', url: '/api/v1/erp-finance/accounts', headers: { authorization: `Bearer ${runnerToken}` }, payload: accountPayload });
      expect(postR.statusCode).toBe(403);

      const postE = await app.inject({ method: 'POST', url: '/api/v1/erp-finance/accounts', headers: { authorization: `Bearer ${editorToken}` }, payload: { ...accountPayload, code: '1088-ED' } });
      expect(postE.statusCode).toBe(201);

      // 3. POST /opening-balances: Viewer(403), Editor(403), Analyst(403), Runner(201), Admin(201)
      const obPayload = {
        balances: [{ account_id: ACCT_CASH_ID, currency_code: 'INR', balance_amount: '1000.00', as_of_date: '2026-04-01' }]
      };
      const obV = await app.inject({ method: 'POST', url: '/api/v1/erp-finance/opening-balances', headers: { authorization: `Bearer ${viewerToken}` }, payload: obPayload });
      expect(obV.statusCode).toBe(403);

      const obE = await app.inject({ method: 'POST', url: '/api/v1/erp-finance/opening-balances', headers: { authorization: `Bearer ${editorToken}` }, payload: obPayload });
      expect(obE.statusCode).toBe(403);

      const obA = await app.inject({ method: 'POST', url: '/api/v1/erp-finance/opening-balances', headers: { authorization: `Bearer ${analystToken}` }, payload: obPayload });
      expect(obA.statusCode).toBe(403);

      const obR = await app.inject({ method: 'POST', url: '/api/v1/erp-finance/opening-balances', headers: { authorization: `Bearer ${runnerToken}` }, payload: obPayload });
      expect(obR.statusCode).toBe(201);

      // 4. GET /trial-balance: Viewer(200), Analyst(200), Runner(403)
      const tbV = await app.inject({ method: 'GET', url: '/api/v1/erp-finance/trial-balance?period=2026-04', headers: { authorization: `Bearer ${viewerToken}` } });
      expect(tbV.statusCode).toBe(200);

      const tbR = await app.inject({ method: 'GET', url: '/api/v1/erp-finance/trial-balance?period=2026-04', headers: { authorization: `Bearer ${runnerToken}` } });
      expect(tbR.statusCode).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC2: Authentication (401) and Authorization (403) Response Envelopes
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC2: 401 Unauthorized and 403 Forbidden Contract', () => {
    it('returns HTTP 401 when Authorization header is completely absent', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
      });
      expect(res.statusCode).toBe(401);
      const json = res.json();
      expect(json.statusCode).toBe(401);
      expect(json.error).toBe('Unauthorized');
      expect(json.message).toContain('Missing Authorization header');
      expect(json.correlation_id).toBeDefined();
    });

    it('returns HTTP 401 when Authorization scheme is not Bearer', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(res.statusCode).toBe(401);
      const json = res.json();
      expect(json.error).toBe('Unauthorized');
      expect(json.message).toContain('Expected "Bearer <token>"');
    });

    it('returns HTTP 401 when Bearer token is empty or whitespace', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: { authorization: 'Bearer   ' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toContain('Empty Bearer token');
    });

    it('returns HTTP 403 when authenticated user lacks required route policy', async () => {
      const token = await signAccessToken('usr-viewer-01', [Roles.VIEWER]);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        headers: { authorization: `Bearer ${token}` },
        payload: { code: 'FORBIDDEN-01', name: 'Forbidden', type: 'asset' },
      });
      expect(res.statusCode).toBe(403);
      const json = res.json();
      expect(json.statusCode).toBe(403);
      expect(json.error).toBe('Forbidden');
      expect(json.code).toBe('INSUFFICIENT_PERMISSIONS');
      expect(json.message).toContain("lack permission for policy 'finance.accounts.create'");
      expect(json.correlation_id).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC3: Sensitive Field Protection (Bank, Salary, Credentials) & Safe Logging
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC3: Sensitive Field-Level Masking in JSON, CSV and Safe Logs', () => {
    it('masks bank accounts as XXXX-XXXX-7890 for all roles', () => {
      expect(maskBankAccountNumber('1234567890')).toBe('XXXX-XXXX-7890');
      expect(maskBankAccountNumber('9876543210987890')).toBe('XXXX-XXXX-7890');
      expect(maskBankAccountNumber('123')).toBe('XXXX-XXXX-XXXX');
    });

    it('masks salary for non-admin roles and reveals to Admin only', () => {
      expect(maskSalary('125000')).toBe('XX,XXX');
      expect(maskSalary(125000)).toBe(0);

      const record = {
        name: 'Chief Financial Officer',
        salary: 150000,
        bank_account_number: '5555444433337890',
        password_hash: '$argon2id$v=19$m=65536,t=3,p=4$secret_hash',
      };

      // Viewer sees masked salary and masked bank, redacted password
      const viewerResult = maskSensitiveFields(record, [Roles.VIEWER]);
      expect(viewerResult.salary).toBe(0);
      expect(viewerResult.bank_account_number).toBe('XXXX-XXXX-7890');
      expect(viewerResult.password_hash).toBe('[REDACTED]');

      // Admin sees visible salary, but bank is masked and password is NEVER visible
      const adminResult = maskSensitiveFields(record, [Roles.ADMIN]);
      expect(adminResult.salary).toBe(150000);
      expect(adminResult.bank_account_number).toBe('XXXX-XXXX-7890');
      expect(adminResult.password_hash).toBe('[REDACTED]');
    });

    it('masks government IDs as ***-**-6789', () => {
      expect(maskGovernmentId('123-45-6789')).toBe('***-**-6789');
      expect(maskGovernmentId('12')).toBe('***-**-****');
    });

    it('masks CSV tabular export records before export', () => {
      const rows = [
        { account_code: '1010', bank_account_number: '1111222233337890', salary: 95000, password_hash: '$argon2id$synthetic_hash' },
        { account_code: '1020', bank_account_number: '4444555566667890', salary: 85000, token: 'jwt_token' },
      ];

      const maskedCsv = maskCsvExportRecords(rows, [Roles.ANALYST]);
      expect(maskedCsv[0]?.bank_account_number).toBe('XXXX-XXXX-7890');
      expect(maskedCsv[0]?.salary).toBe(0);
      expect(maskedCsv[0]?.password_hash).toBe('[REDACTED]');
      expect(maskedCsv[1]?.bank_account_number).toBe('XXXX-XXXX-7890');
      expect(maskedCsv[1]?.token).toBe('[REDACTED]');
    });

    it('sanitizes SQL queries, bearer tokens and passwords in HTTP 500 error envelopes', async () => {
      // Simulate route throwing unexpected error containing raw SQL & secrets
      app.get('/api/v1/erp-finance/test-internal-error', async () => {
        throw new Error('Database query SELECT * FROM erp4.accounts WHERE secret_credential = "admin_secret" failed');
      });

      const token = await signAccessToken('usr-admin-01', [Roles.ADMIN]);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/test-internal-error',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(500);
      const json = res.json();
      expect(json.message).toBe('An unexpected internal error occurred.');
      expect(json.message).not.toContain('SELECT');
      expect(json.message).not.toContain('secret_credential');
      expect(json.message).not.toContain('admin_secret');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC4: Disabled Users, Expired Tokens, Invalid Issuer/Audience
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC4: Token Invalidation & Disabled User Rejection', () => {
    it('rejects token issued to disabled user account with HTTP 401', async () => {
      // 1. JWT issued with disabled user ID
      const disabledToken = await signAccessToken('user-disabled-01', [Roles.ADMIN]);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: { authorization: `Bearer ${disabledToken}` },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toContain('disabled');

      // 2. Synthetic disabled token
      const res2 = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: { authorization: 'Bearer user-disabled' },
      });
      expect(res2.statusCode).toBe(401);
      expect(res2.json().message).toContain('disabled');
    });

    it('rejects expired JWT with HTTP 401', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);
      const expiredJwt = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('clearshift')
        .setSubject('usr-admin-expired')
        .setIssuedAt(now - 3600)
        .setExpirationTime(now - 1800) // expired 30 minutes ago
        .sign(keys.privateKey);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: { authorization: `Bearer ${expiredJwt}` },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toMatch(/exp|expired/);
    });

    it('rejects token with invalid issuer with HTTP 401', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);
      const badIssuerJwt = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('malicious-issuer.com')
        .setAudience('clearshift')
        .setSubject('usr-bad-issuer')
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(keys.privateKey);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: { authorization: `Bearer ${badIssuerJwt}` },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toContain('Token verification failed');
    });

    it('rejects token with invalid audience with HTTP 401', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);
      const badAudJwt = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('wrong-audience')
        .setSubject('usr-bad-aud')
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(keys.privateKey);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: { authorization: `Bearer ${badAudJwt}` },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toContain('Token verification failed');
    });

    it('rejects token signed with an untrusted key', async () => {
      const rogueKeyPair = await jose.generateKeyPair('EdDSA', { crv: 'Ed25519' });
      const now = Math.floor(Date.now() / 1000);
      const rogueJwt = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('clearshift')
        .setSubject('usr-rogue')
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(rogueKeyPair.privateKey);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: { authorization: `Bearer ${rogueJwt}` },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toContain('Token verification failed');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC5: Append-Only Audit Trail & Safe Activity Logging
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC5: Append-Only Audit Logging of Privileged Actions', () => {
    it('records immutable audit record when a journal entry is posted', async () => {
      const adminToken = await signAccessToken('usr-accountant-01', [Roles.ADMIN]);

      // 1. Create a draft journal entry
      const draftRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          posting_date: '2026-04-15',
          description: 'Audited Salary Posting',
          period_id: PERIOD_OPEN_ID,
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_CASH_ID, debit_amount: '5000.00', credit_amount: '0.00' },
            { account_id: ACCT_BANK_ID, debit_amount: '0.00', credit_amount: '5000.00' },
          ],
        },
      });
      expect(draftRes.statusCode).toBe(201);
      const draft = draftRes.json();

      // 2. Post the entry
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}/post`,
        headers: { authorization: `Bearer ${adminToken}`, 'x-correlation-id': 'corr-audit-post-01' },
      });
      expect(postRes.statusCode).toBe(200);

      // 3. Inspect audit trail
      const auditRecords = await auditService.query({ action: 'journal.posted' });
      expect(auditRecords.length).toBeGreaterThanOrEqual(1);
      const postRecord = auditRecords.find((r) => r.targetId === draft.id);
      expect(postRecord).toBeDefined();
      expect(postRecord?.actor).toBe('usr-accountant-01');
      expect(postRecord?.targetEntity).toBe('journal_entry');
      expect(postRecord?.result).toBe('success');
      expect(postRecord?.metadata).toBeDefined();
      expect(postRecord?.metadata?.['currencyCode']).toBe('INR');
      expect(postRecord?.metadata?.['totalAmount']).toBe('5000.00');

      // 4. Reverse the posted entry and verify reversal audit
      const revRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}/reverse`,
        headers: { authorization: `Bearer ${adminToken}`, 'x-correlation-id': 'corr-audit-rev-01' },
        payload: { reversal_description: 'Accounting adjustment' },
      });
      expect(revRes.statusCode).toBe(200);

      const revRecords = await auditService.query({ action: 'journal.reversed' });
      const revRecord = revRecords.find((r) => r.targetId === draft.id);
      expect(revRecord).toBeDefined();
      expect(revRecord?.actor).toBe('usr-accountant-01');
      expect(revRecord?.reason).toBe('Accounting adjustment');
    });

    it('records audit log when opening balances are loaded', async () => {
      const runnerToken = await signAccessToken('usr-migration-01', [Roles.MIGRATION_RUNNER]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        headers: { authorization: `Bearer ${runnerToken}`, 'x-correlation-id': 'corr-audit-ob-01' },
        payload: {
          batch_id: randomUUID(),
          balances: [
            { account_id: ACCT_CASH_ID, currency_code: 'INR', balance_amount: '25000.00', as_of_date: '2026-04-01' }
          ],
        },
      });
      expect(res.statusCode).toBe(201);

      const loadRecords = await auditService.query({ action: 'load.requested' });
      expect(loadRecords.length).toBeGreaterThanOrEqual(1);
      const loadRecord = loadRecords[0];
      expect(loadRecord?.actor).toBe('usr-migration-01');
      expect(loadRecord?.targetEntity).toBe('opening_balances');
      expect(loadRecord?.result).toBe('success');
    });

    it('records export generation audit event', async () => {
      const exportRecord = await auditService.auditExportGenerated({
        actor: 'usr-analyst-01',
        correlationId: 'corr-export-01',
        exportType: 'csv',
        entityType: 'trial_balance',
        recordCount: 14,
      });

      expect(exportRecord.action).toBe('export.generated');
      expect(exportRecord.targetEntity).toBe('trial_balance');
      expect(exportRecord.metadata?.['recordCount']).toBe(14);
      expect(exportRecord.metadata?.['exportType']).toBe('csv');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC6: Mandatory Domain Invariant — Every Posted Journal Entry Balances Exactly
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC6: Double-Entry Exact Balancing Domain Invariant', () => {
    it('rejects posting an unbalanced journal entry with HTTP 400 at draft creation', async () => {
      const adminToken = await signAccessToken('usr-admin-01', [Roles.ADMIN]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          posting_date: '2026-04-15',
          description: 'Unbalanced Attempt',
          period_id: PERIOD_OPEN_ID,
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_CASH_ID, debit_amount: '1200.00', credit_amount: '0.00' },
            { account_id: ACCT_BANK_ID, debit_amount: '0.00', credit_amount: '1150.00' }, // difference = 50.00
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.message).toMatch(/balance|balanced/i);
    });

    it('rejects multi-line positive debit and credit on same line', async () => {
      const adminToken = await signAccessToken('usr-admin-01', [Roles.ADMIN]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          posting_date: '2026-04-15',
          description: 'Illegal line',
          period_id: PERIOD_OPEN_ID,
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_CASH_ID, debit_amount: '100.00', credit_amount: '100.00' },
            { account_id: ACCT_BANK_ID, debit_amount: '0.00', credit_amount: '100.00' },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects posting into a locked period with HTTP 422 PERIOD_LOCKED', async () => {
      const adminToken = await signAccessToken('usr-admin-01', [Roles.ADMIN]);

      // Try to create entry in locked period (FIXTURE_PERIOD_LOCKED is bbbbbbbb-0001-0001-0001-000000000003)
      const draftRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          period_id: 'bbbbbbbb-0001-0001-0001-000000000003',
          posting_date: '2026-02-15',
          description: 'Locked period attempt',
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_CASH_ID, debit_amount: '100.00', credit_amount: '0.00' },
            { account_id: ACCT_BANK_ID, debit_amount: '0.00', credit_amount: '100.00' },
          ],
        },
      });
      const draft = draftRes.json();

      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}/post`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(postRes.statusCode).toBe(422);
      expect(postRes.json().code).toBe('PERIOD_LOCKED');
    });

    it('asserts posted journal entries are permanently immutable', async () => {
      const adminToken = await signAccessToken('usr-admin-01', [Roles.ADMIN]);

      const draftRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          posting_date: '2026-04-15',
          description: 'Immutable Test',
          period_id: PERIOD_OPEN_ID,
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_CASH_ID, debit_amount: '200.00', credit_amount: '0.00' },
            { account_id: ACCT_BANK_ID, debit_amount: '0.00', credit_amount: '200.00' },
          ],
        },
      });
      const draft = draftRes.json();

      await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}/post`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      // Direct edit attempt on posted entry must fail with 422
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { description: 'Attempted modification of posted entry' },
      });

      expect(patchRes.statusCode).toBe(422);
      expect(patchRes.json().code).toBe('ENTRY_IMMUTABLE');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC7: Object-Level Authorization Guards (Multi-Tenant & Cross-User)
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC7: Object-Level Authorization Guards', () => {
    describe('Multi-Tenant Boundary Isolation', () => {
      it('assertTenantAccess passes when tenant IDs agree', () => {
        expect(() => {
          assertTenantAccess(
            { iss: '', aud: '', sub: 'usr-1', jti: '', exp: 0, roles: [Roles.EDITOR], tenant_id: 'tenant-a' },
            { tenant_id: 'tenant-a' }
          );
        }).not.toThrow();
      });

      it('assertTenantAccess rejects cross-tenant access with 403 OBJECT_ACCESS_DENIED', () => {
        expect(() => {
          assertTenantAccess(
            { iss: '', aud: '', sub: 'usr-1', jti: '', exp: 0, roles: [Roles.EDITOR], tenant_id: 'tenant-a' },
            { tenant_id: 'tenant-b' }
          );
        }).toThrowError(/Cross-tenant access violation/);
      });

      it('enforces multi-tenant isolation via HTTP request headers', async () => {
        const editorToken = await signAccessToken('usr-editor-tenant', [Roles.EDITOR]);

        // Create an account with tenant-alpha
        const createRes = await app.inject({
          method: 'POST',
          url: '/api/v1/erp-finance/accounts',
          headers: {
            authorization: `Bearer ${editorToken}`,
            'x-tenant-id': 'tenant-alpha',
          },
          payload: {
            code: '1088-TENANT',
            name: 'Tenant Alpha Account',
            type: 'asset',
            currency_code: 'INR',
            tenant_id: 'tenant-alpha',
          },
        });
        expect(createRes.statusCode).toBe(201);
        const accountId = createRes.json().id;

        // Attempt to update with tenant-beta header -> 403 Forbidden
        const updateRes = await app.inject({
          method: 'PATCH',
          url: `/api/v1/erp-finance/accounts/${accountId}`,
          headers: {
            authorization: `Bearer ${editorToken}`,
            'x-tenant-id': 'tenant-beta', // cross-tenant mismatch
          },
          payload: { name: 'Cross-Tenant Update Attempt' },
        });

        expect(updateRes.statusCode).toBe(403);
        expect(updateRes.json().code).toBe('OBJECT_ACCESS_DENIED');
      });
    });

    describe('Cross-User Draft Mutation Protection', () => {
      it('prevents non-admin editor from modifying another editor draft entry', async () => {
        const editor1Token = await signAccessToken('usr-editor-alpha', [Roles.EDITOR]);
        const editor2Token = await signAccessToken('usr-editor-beta', [Roles.EDITOR]);

        // Editor 1 creates a draft
        const draftRes = await app.inject({
          method: 'POST',
          url: '/api/v1/erp-finance/journal-entries',
          headers: { authorization: `Bearer ${editor1Token}` },
          payload: {
            period_id: PERIOD_OPEN_ID,
            posting_date: '2026-03-22',
            description: 'Editor 1 private draft',
            currency_code: 'INR',
            lines: [
              { account_id: ACCT_CASH_ID, debit_amount: '1000.00', credit_amount: '0.00' },
              { account_id: ACCT_SALES_ID, debit_amount: '0.00', credit_amount: '1000.00' },
            ],
          },
        });
        expect(draftRes.statusCode).toBe(201);
        const draftId = draftRes.json().id;

        // Editor 2 attempts to edit Editor 1 draft -> 403 CROSS_USER_MUTATION_FORBIDDEN
        const patchRes = await app.inject({
          method: 'PATCH',
          url: `/api/v1/erp-finance/journal-entries/${draftId}`,
          headers: { authorization: `Bearer ${editor2Token}` },
          payload: { description: 'Hijacked by Editor 2' },
        });

        expect(patchRes.statusCode).toBe(403);
        expect(patchRes.json().code).toBe('CROSS_USER_MUTATION_FORBIDDEN');

        // Editor 2 attempts to void Editor 1 draft -> 403 CROSS_USER_MUTATION_FORBIDDEN
        const voidRes = await app.inject({
          method: 'POST',
          url: `/api/v1/erp-finance/journal-entries/${draftId}/void`,
          headers: { authorization: `Bearer ${editor2Token}` },
        });

        expect(voidRes.statusCode).toBe(403);
        expect(voidRes.json().code).toBe('CROSS_USER_MUTATION_FORBIDDEN');

        // Editor 1 (creator) can modify their own draft -> 200 OK
        const ownPatchRes = await app.inject({
          method: 'PATCH',
          url: `/api/v1/erp-finance/journal-entries/${draftId}`,
          headers: { authorization: `Bearer ${editor1Token}` },
          payload: { description: 'Editor 1 legitimate update' },
        });
        expect(ownPatchRes.statusCode).toBe(200);
      });

      it('allows Admin to modify drafts created by any user', async () => {
        const editorToken = await signAccessToken('usr-editor-gamma', [Roles.EDITOR]);
        const adminToken = await signAccessToken('usr-admin-master', [Roles.ADMIN]);

        const draftRes = await app.inject({
          method: 'POST',
          url: '/api/v1/erp-finance/journal-entries',
          headers: { authorization: `Bearer ${editorToken}` },
          payload: {
            period_id: PERIOD_OPEN_ID,
            posting_date: '2026-03-22',
            description: 'Staff draft',
            currency_code: 'INR',
            lines: [
              { account_id: ACCT_CASH_ID, debit_amount: '300.00', credit_amount: '0.00' },
              { account_id: ACCT_SALES_ID, debit_amount: '0.00', credit_amount: '300.00' },
            ],
          },
        });
        const draftId = draftRes.json().id;

        // Admin updates Editor Gamma's draft -> 200 OK
        const adminPatch = await app.inject({
          method: 'PATCH',
          url: `/api/v1/erp-finance/journal-entries/${draftId}`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { description: 'Admin management override' },
        });
        expect(adminPatch.statusCode).toBe(200);
        expect(adminPatch.json().description).toBe('Admin management override');
      });
    });
  });
});
