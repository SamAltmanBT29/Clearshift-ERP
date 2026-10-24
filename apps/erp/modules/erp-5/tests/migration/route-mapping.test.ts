import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildHrApp } from '../../src/app';
import { HrService } from '../../src/services/hr.service';
import { InMemoryHrRepository } from '../../src/services/in-memory.repository';
import { AuditService, InMemoryAuditRepository } from '@cs/core';

describe('ERP-5 Import Routes HTTP Mapping', () => {
  let hrService: any;
  let app: any;

  beforeEach(async () => {
    const repository = new InMemoryHrRepository(true);
    const auditService = new AuditService(new InMemoryAuditRepository());
    hrService = new HrService(repository, auditService);

    app = buildHrApp({
      repository,
      hrService,
      authRequired: true
    });
    await app.ready();
  });

  const authHeader = { authorization: 'Bearer role:admin' };
  const tenantHeader = { 'x-tenant-id': 'tenant-1' };

  it('returns 201 for first-time import', async () => {
    vi.spyOn(hrService, 'importRow').mockResolvedValue({
      prior_result: false,
      entity: { id: 'uuid-1' },
      receipt: { idempotency_key: 'key-1' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-hr/import',
      headers: { ...authHeader, ...tenantHeader, 'idempotency-key': 'key-1' },
      payload: {
        batch_id: '550e8400-e29b-41d4-a716-446655440000',
        source_row: 1,
        entity: 'employee',
        idempotency_key: 'key-1',
        record: { employee_no: 'EMP-001' },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).prior_result).toBe(false);
  });

  it('returns 200 for same-key same-payload replay', async () => {
    vi.spyOn(hrService, 'importRow').mockResolvedValue({
      prior_result: true,
      entity: { id: 'uuid-1' },
      receipt: { idempotency_key: 'key-1' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-hr/import',
      headers: { ...authHeader, ...tenantHeader, 'idempotency-key': 'key-1' },
      payload: {
        batch_id: '550e8400-e29b-41d4-a716-446655440000',
        source_row: 1,
        entity: 'employee',
        idempotency_key: 'key-1',
        record: { employee_no: 'EMP-001' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).prior_result).toBe(true);
  });

  it('returns 409 for same-key different-payload conflict', async () => {
    const conflictError = new Error('Idempotency conflict');
    (conflictError as any).reasonCode = 'IDEMPOTENCY_CONFLICT';
    vi.spyOn(hrService, 'importRow').mockRejectedValue(conflictError);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-hr/import',
      headers: { ...authHeader, ...tenantHeader, 'idempotency-key': 'key-1' },
      payload: {
        batch_id: '550e8400-e29b-41d4-a716-446655440000',
        source_row: 1,
        entity: 'employee',
        idempotency_key: 'key-1',
        record: { employee_no: 'EMP-999' },
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('returns 401 for unauthorized request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-hr/import',
      headers: { ...tenantHeader },
      payload: {
        record: { employee_no: 'EMP-001' },
      },
    });

    expect(res.statusCode).toBe(401);
  });
});
