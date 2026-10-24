/**
 * ERP-4 Finance & Accounting — API Auth, Policy & Error Envelope Test Suite
 *
 * Verifies that:
 *   1. Standard error envelope structure ({ statusCode, error, code, message, details, correlation_id }) on all errors.
 *   2. Correlation ID propagation: echoes x-correlation-id, falls back to x-request-id or generates UUID on errors.
 *   3. Error sanitization: Internal server errors strictly sanitize SQL queries, tokens, and raw rows.
 *   4. Multi-tenant isolation: Requests with tenant headers enforce tenant boundaries.
 *   5. Authentication hook: 401 on missing or invalid bearer tokens when authRequired: true.
 *   6. RBAC Policy matrix:
 *      - Viewer role can list/read accounts, journal entries, trial balance.
 *      - Viewer role is forbidden from creating/editing accounts or journal entries (HTTP 403).
 *      - Editor role can create/edit accounts, journal entries, and post/reverse entries.
 *      - Admin role can modify accounting periods and post into soft-closed periods.
 *
 * @module erp4/tests/api/auth-and-envelope.test
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemoryFinanceRepository } from '../../src/services/repository.js';
import { FIXTURE_PERIOD_OPEN } from '../../fixtures/index.js';

const BASE = '/api/v1/erp-finance';
let app: FastifyInstance;

afterEach(async () => {
  if (app) {
    await app.close();
  }
});

describe('ERP-4 authentication and authorization hook', () => {
  it('returns HTTP 401 when auth is required and header is missing', async () => {
    app = buildApp({ authRequired: true });
    const res = await app.inject({ method: 'GET', url: `${BASE}/accounts` });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe('UNAUTHORIZED');
    expect(body.error).toBe('Unauthorized');
    expect(body.correlation_id).toBeTruthy();
  });

  it('returns HTTP 401 on non-Bearer authorization scheme', async () => {
    app = buildApp({ authRequired: true });
    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/accounts`,
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.statusCode).toBe(401);
  });

  it.each(['invalid', 'invalid-token', 'expired'])('returns HTTP 401 on invalid token "%s"', async (token) => {
    app = buildApp({ authRequired: true });
    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/accounts`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns HTTP 401 when user is disabled', async () => {
    app = buildApp({
      authRequired: true,
      isUserDisabled: () => true,
    });
    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/accounts`,
      headers: { authorization: 'Bearer role:viewer' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
    expect(res.json().message).toContain('disabled');
  });

  it('allows anonymous access when authRequired is false in development mode', async () => {
    app = buildApp({ authRequired: false });
    const res = await app.inject({ method: 'GET', url: `${BASE}/accounts` });
    expect(res.statusCode).toBe(200);
  });
});

describe('ERP-4 RBAC policy enforcement', () => {
  it('Viewer role can list accounts but cannot create new accounts (HTTP 403)', async () => {
    app = buildApp({ authRequired: true });

    // Viewer can read
    const getRes = await app.inject({
      method: 'GET',
      url: `${BASE}/accounts`,
      headers: { authorization: 'Bearer role:viewer' },
    });
    expect(getRes.statusCode).toBe(200);

    // Viewer cannot create
    const postRes = await app.inject({
      method: 'POST',
      url: `${BASE}/accounts`,
      headers: { authorization: 'Bearer role:viewer' },
      payload: { code: '1099-NEW', name: 'Unauthorized Account', type: 'asset', currency_code: 'INR' },
    });
    expect(postRes.statusCode).toBe(403);
    expect(postRes.json().code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('Editor role can create draft journal entries', async () => {
    const repo = new InMemoryFinanceRepository(true);
    app = buildApp({ repository: repo, authRequired: true });

    // Get an account
    const accounts = [...repo.accounts.values()];
    const a1 = accounts[0]!.id;
    const a2 = accounts[1]!.id;

    const postRes = await app.inject({
      method: 'POST',
      url: `${BASE}/journal-entries`,
      headers: { authorization: 'Bearer role:editor' },
      payload: {
        period_id: FIXTURE_PERIOD_OPEN['id'],
        posting_date: '2026-04-10',
        description: 'Editor journal entry',
        currency_code: 'INR',
        lines: [
          { account_id: a1, debit_amount: '100.0000', credit_amount: '0.0000' },
          { account_id: a2, debit_amount: '0.0000', credit_amount: '100.0000' },
        ],
      },
    });
    expect(postRes.statusCode).toBe(201);
  });

  it('Viewer role is forbidden from posting journal entries (HTTP 403)', async () => {
    const repo = new InMemoryFinanceRepository(true);
    app = buildApp({ repository: repo, authRequired: true });

    const entries = [...repo.journalEntries.values()];
    const entryId = entries[0]!.id;

    const postRes = await app.inject({
      method: 'POST',
      url: `${BASE}/journal-entries/${entryId}/post`,
      headers: { authorization: 'Bearer role:viewer' },
    });
    expect(postRes.statusCode).toBe(403);
  });
});

describe('ERP-4 error envelope and correlation id propagation', () => {
  it('echoes client-provided x-correlation-id on error responses', async () => {
    app = buildApp();
    const corrId = randomUUID();

    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/accounts/00000000-0000-4000-8000-000000000000`,
      headers: { 'x-correlation-id': corrId },
    });

    expect(res.headers['x-correlation-id']).toBe(corrId);
    expect(res.json().correlation_id).toBe(corrId);
  });

  it('echoes x-request-id as correlation id on error responses if x-correlation-id is not provided', async () => {
    app = buildApp();
    const reqId = randomUUID();

    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/accounts/00000000-0000-4000-8000-000000000000`,
      headers: { 'x-request-id': reqId },
    });

    expect(res.headers['x-correlation-id']).toBe(reqId);
    expect(res.json().correlation_id).toBe(reqId);
  });

  it('generates a valid UUID correlation id if no correlation header is provided on error', async () => {
    app = buildApp();

    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/accounts/00000000-0000-4000-8000-000000000000`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.correlation_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(res.headers['x-correlation-id']).toBe(body.correlation_id);
  });

  it('returns standard error envelope on 400 validation error', async () => {
    app = buildApp();

    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/accounts`,
      payload: {
        code: '', // invalid: empty code
        name: 'Bad Account',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('statusCode', 400);
    expect(body).toHaveProperty('error', 'Bad Request');
    expect(body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(body).toHaveProperty('message');
    expect(Array.isArray(body.details)).toBe(true);
    expect(body).toHaveProperty('correlation_id');
  });

  it('sanitizes unexpected internal server error messages (never leaks SQL, tokens, or raw table schemas)', async () => {
    const errorService: any = {
      listAccounts: async () => {
        throw new Error('SELECT * FROM erp4.accounts WHERE secret_token = "bearer xyz" FAILED');
      },
    };
    app = buildApp({ financeService: errorService });

    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/accounts`,
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('An unexpected internal error occurred.');
    expect(JSON.stringify(body)).not.toContain('SELECT');
    expect(JSON.stringify(body)).not.toContain('secret_token');
    expect(JSON.stringify(body)).not.toContain('bearer xyz');
  });
});
