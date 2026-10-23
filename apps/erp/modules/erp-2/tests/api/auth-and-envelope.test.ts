import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

const BASE = '/api/v1/erp-vendors';
let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

describe('ERP-2 authentication hook', () => {
  it('401 when auth is required and header is missing', async () => {
    app = buildApp({ authRequired: true });
    const res = await app.inject({ method: 'GET', url: `${BASE}/vendors` });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('401 on non-Bearer scheme', async () => {
    app = buildApp({ authRequired: true });
    const res = await app.inject({ method: 'GET', url: `${BASE}/vendors`, headers: { authorization: 'Basic abc' } });
    expect(res.statusCode).toBe(401);
  });

  it.each(['invalid', 'invalid-token', 'expired'])('401 on token "%s"', async (token) => {
    app = buildApp({ authRequired: true });
    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/purchase-orders`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 on empty bearer token', async () => {
    app = buildApp({ authRequired: true });
    const res = await app.inject({ method: 'GET', url: `${BASE}/vendors`, headers: { authorization: 'Bearer  ' } });
    expect(res.statusCode).toBe(401);
  });

  it('valid bearer token passes the auth hook', async () => {
    app = buildApp({ authRequired: true });
    const res = await app.inject({ method: 'GET', url: `${BASE}/vendors`, headers: { authorization: 'Bearer good-token' } });
    expect(res.statusCode).not.toBe(401);
  });

  it('anonymous requests are allowed when auth is not required', async () => {
    app = buildApp();
    const res = await app.inject({ method: 'GET', url: `${BASE}/vendors` });
    expect(res.statusCode).not.toBe(401);
  });
});

describe('ERP-2 correlation id', () => {
  it('echoes x-correlation-id', async () => {
    app = buildApp();
    const id = randomUUID();
    const res = await app.inject({ method: 'GET', url: `${BASE}/vendors`, headers: { 'x-correlation-id': id } });
    expect(res.headers['x-correlation-id']).toBe(id);
  });
  it('falls back to x-request-id', async () => {
    app = buildApp();
    const res = await app.inject({ method: 'GET', url: `${BASE}/vendors`, headers: { 'x-request-id': 'req-123' } });
    expect(res.headers['x-correlation-id']).toBe('req-123');
  });
  it('generates one when none is supplied', async () => {
    app = buildApp();
    const res = await app.inject({ method: 'GET', url: `${BASE}/vendors` });
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('ERP-2 path validation and error envelope', () => {
  it.each([
    ['GET', 'vendors'],
    ['PATCH', 'vendors'],
    ['GET', 'purchase-orders'],
    ['PATCH', 'purchase-orders'],
  ])('%s /%s/:id rejects a non-UUID id with INVALID_UUID', async (method, resource) => {
    app = buildApp();
    const res = await app.inject({
      method: method as 'GET' | 'PATCH',
      url: `${BASE}/${resource}/not-a-uuid`,
      ...(method === 'PATCH' ? { payload: {} } : {}),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('INVALID_UUID');
    expect(body.correlation_id).toBeTruthy();
  });

  it('PATCH purchase order with an invalid status body is a 400 VALIDATION_ERROR', async () => {
    app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE}/purchase-orders/${randomUUID()}`,
      payload: { status: 'Cancelled' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('POST vendor with an empty body is a 400 VALIDATION_ERROR with details', async () => {
    app = buildApp();
    const res = await app.inject({ method: 'POST', url: `${BASE}/vendors`, payload: {} });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('POST purchase order with an empty body is a 400 VALIDATION_ERROR', async () => {
    app = buildApp();
    const res = await app.inject({ method: 'POST', url: `${BASE}/purchase-orders`, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('list endpoints reject out-of-range paging', async () => {
    app = buildApp();
    const res = await app.inject({ method: 'GET', url: `${BASE}/vendors?page=0&pageSize=100000` });
    expect(res.statusCode).toBe(400);
  });
});
