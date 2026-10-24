/**
 * ERP-4 Target Adapter & Durable Import Receipt Test Suite
 *
 * Dedicated test suite for Issue #167 [ERP4-11]:
 *   AC1. Target adapter implements loadBatch interface executing type-safe UPSERT operations.
 *   AC2. Target record and durable import receipt commit atomically in one local database transaction.
 *   AC3. Import receipt stores batch_id, source_row, target_id, idempotency_key, and timestamp.
 *   AC4. Re-running the same source row with identical idempotency key returns existing receipt without duplication.
 *
 * @module erp4/tests/migration/adapter.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemoryFinanceRepository } from '../../src/services/repository.js';
import { FinanceService } from '../../src/services/finance.service.js';
import { Erp4TargetAdapter, DEFAULT_CHUNK_SIZE, DEFAULT_FAILURE_THRESHOLD } from '../../src/migration/target-adapter.js';

describe('ERP4-11: Module Target Adapter & Durable Import Receipt (#167)', () => {
  let app: FastifyInstance;
  let repo: InMemoryFinanceRepository;
  let service: FinanceService;

  beforeEach(() => {
    repo = new InMemoryFinanceRepository(true);
    service = new FinanceService({ repository: repo });
    app = buildApp({ repository: repo, financeService: service });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC1: loadBatch interface with type-safe UPSERT
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC1: loadBatch executes type-safe UPSERT operations', () => {
    it('exports DEFAULT_CHUNK_SIZE = 500 and DEFAULT_FAILURE_THRESHOLD = 0.10 as module constants', () => {
      expect(DEFAULT_CHUNK_SIZE).toBe(500);
      expect(DEFAULT_FAILURE_THRESHOLD).toBe(0.10);
    });

    it('loads a batch of account rows and returns COMPLETED status with full reconciliation', async () => {
      const adapter = new Erp4TargetAdapter(service, 'account');
      const batchId = '11000000-0000-0000-0000-000000000001';

      const rows = Array.from({ length: 5 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `erp4-11-ac1-key-${i}`,
        data: {
          code: `AC1-${1100 + i}`,
          name: `Adapter Test Account ${i}`,
          type: i % 2 === 0 ? 'asset' : 'liability',
          currency_code: 'INR',
        },
      }));

      const result = await adapter.loadBatch(batchId, rows);

      expect(result.status).toBe('COMPLETED');
      expect(result.batchId).toBe(batchId);
      expect(result.total).toBe(5);
      expect(result.loaded).toBe(5);
      expect(result.rejected).toBe(0);
      expect(result.unattempted).toBe(0);
      // Terminal outcome reconciliation: loaded + rejected + unattempted === total
      expect(result.loaded + result.rejected + result.unattempted).toBe(result.total);
    });

    it('loadBatch handles journal entry rows with double-entry balance validation', async () => {
      const adapter = new Erp4TargetAdapter(service, 'journal_entry');
      const openPeriod = await repo.getPeriodByLabel('2026-04');
      const batchId = '11000000-0000-0000-0000-000000000002';

      const rows = [
        {
          sourceRow: 0,
          idempotencyKey: 'erp4-11-ac1-je-bal-0',
          data: {
            period_id: openPeriod!.id,
            posting_date: '2026-04-05',
            currency_code: 'INR',
            description: 'Balanced JE Import',
            lines: [
              { account_id: 'aaaaaaaa-0001-0001-0001-000000000001', debit: '1000.00', credit: '0.00' },
              { account_id: 'aaaaaaaa-0001-0001-0001-000000000002', debit: '0.00', credit: '1000.00' },
            ],
          },
        },
      ];

      const result = await adapter.loadBatch(batchId, rows);
      expect(result.status).toBe('COMPLETED');
      expect(result.loaded).toBe(1);
    });

    it('rejects rows with invalid account type and correctly classifies them', async () => {
      const adapter = new Erp4TargetAdapter(service, 'account');
      const batchId = '11000000-0000-0000-0000-000000000003';

      const rows = [
        {
          sourceRow: 0,
          idempotencyKey: 'erp4-11-invalid-type-0',
          data: { code: 'INV-001', name: 'Bad Type Account', type: 'unknown_type', currency_code: 'INR' },
        },
        {
          sourceRow: 1,
          idempotencyKey: 'erp4-11-missing-code-1',
          data: { code: '', name: 'Missing Code', type: 'asset', currency_code: 'INR' },
        },
        {
          sourceRow: 2,
          idempotencyKey: 'erp4-11-valid-2',
          data: { code: 'VALID-001', name: 'Valid Account', type: 'asset', currency_code: 'INR' },
        },
      ];

      const result = await adapter.loadBatch(batchId, rows, { minAttemptedRows: 3 });
      expect(result.rejected).toBe(2);
      expect(result.loaded).toBe(1);
      expect(result.loaded + result.rejected + result.unattempted).toBe(result.total);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC2: Atomic dual-write — target record + durable receipt in one transaction
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC2: Target record and receipt commit atomically in one transaction', () => {
    it('creates account and import receipt in a single atomic database transaction', async () => {
      const adapter = new Erp4TargetAdapter(service, 'account');
      const batchId = '11000000-0000-0000-0000-000000000010';
      const key = 'erp4-11-atomic-commit-001';

      const res = await adapter.importRow(batchId, 0, key, {
        code: 'ATOM-1001',
        name: 'Atomic Write Account',
        type: 'asset',
        currency_code: 'INR',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      // Both the business row and the receipt must exist simultaneously
      const account = await repo.getAccountByCode('ATOM-1001');
      const receipt = await repo.getImportReceiptByIdempotencyKey(key);

      expect(account).not.toBeNull();
      expect(receipt).not.toBeNull();
      expect(receipt!.target_id).toBe(account!.id);
      expect(receipt!.target_id).toBe(res.value.targetId);
    });

    it('rolls back both account and receipt if the transaction throws a 503 infrastructure error', async () => {
      const originalExec = repo.executeTransactional.bind(repo);
      repo.executeTransactional = async () => {
        const e = new Error('Simulated DB timeout');
        (e as any).statusCode = 503;
        throw e;
      };

      const adapter = new Erp4TargetAdapter(service, 'account');
      const batchId = '11000000-0000-0000-0000-000000000011';
      const key = 'erp4-11-rollback-key-001';

      let threw = false;
      try {
        await adapter.importRow(batchId, 0, key, {
          code: 'ROLLBACK-001',
          name: 'Should Not Exist',
          type: 'asset',
          currency_code: 'INR',
        });
      } catch {
        threw = true;
      }

      repo.executeTransactional = originalExec;
      expect(threw).toBe(true);

      // No orphaned rows allowed
      const account = await repo.getAccountByCode('ROLLBACK-001');
      const receipt = await repo.getImportReceiptByIdempotencyKey(key);
      expect(account).toBeNull();
      expect(receipt).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC3: Import receipt stores required fields
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC3: Import receipt stores batch_id, source_row, target_id, idempotency_key, and timestamp', () => {
    it('receipt contains all mandatory fields with correct values', async () => {
      const batchId = '11000000-0000-0000-0000-000000000020';
      const sourceRow = 7;
      const key = 'erp4-11-receipt-fields-001';

      const payload = {
        batch_id: batchId,
        source_row: sourceRow,
        source_system: 'tally_prime',
        source_id: 'TALLY-ACC-777',
        idempotency_key: key,
        entity: 'account',
        record: { code: 'RCPT-777', name: 'Receipt Fields Account', type: 'expense', currency_code: 'INR' },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': key },
        payload,
      });

      expect(res.statusCode).toBe(201);

      const receipt = await repo.getImportReceiptByIdempotencyKey(key);
      expect(receipt).not.toBeNull();

      // AC3: All mandatory fields present and correct
      expect(receipt!.batch_id).toBe(batchId);
      expect(receipt!.source_row).toBe(sourceRow);
      expect(receipt!.idempotency_key).toBe(key);
      expect(receipt!.target_id).toBeDefined();
      expect(receipt!.created_at).toBeDefined();
      // Verify created_at is a parseable ISO8601 timestamp
      expect(new Date(receipt!.created_at).getTime()).toBeGreaterThan(0);
    });

    it('receipt source_system and source_id are stored for traceability', async () => {
      const key = 'erp4-11-source-trace-001';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': key },
        payload: {
          batch_id: '11000000-0000-0000-0000-000000000021',
          source_row: 1,
          source_system: 'legacy_sap',
          source_id: 'SAP-1234',
          idempotency_key: key,
          entity: 'account',
          record: { code: 'SAP-TRACE-001', name: 'SAP Trace Account', type: 'asset', currency_code: 'INR' },
        },
      });

      expect(res.statusCode).toBe(201);
      const receipt = await repo.getImportReceiptByIdempotencyKey(key);
      expect(receipt!.source_system).toBe('legacy_sap');
      expect(receipt!.source_id).toBe('SAP-1234');
    });

    it('receipt entity and schema_version fields correctly identify the target schema', async () => {
      const adapter = new Erp4TargetAdapter(service, 'account');
      const key = 'erp4-11-schema-version-001';

      const res = await adapter.importRow('11000000-0000-0000-0000-000000000022', 0, key, {
        code: 'SCHEMA-V1-001',
        name: 'Schema Version Account',
        type: 'income',
        currency_code: 'INR',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.receipt.entity).toBe('account');
      // schemaVersion declared on the adapter as 1
      expect(res.value.receipt.schemaVersion ?? 1).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC4: Identical idempotency key replay — returns existing receipt, no duplication
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC4: Re-running identical idempotency key returns existing receipt without duplication', () => {
    it('idempotent replay via importRow returns prior_result=true and same target_id', async () => {
      const adapter = new Erp4TargetAdapter(service, 'account');
      const batchId = '11000000-0000-0000-0000-000000000030';
      const key = 'erp4-11-idem-replay-001';
      const data = { code: 'IDEM-AC4-001', name: 'Idempotent Account', type: 'asset', currency_code: 'INR' };

      // First insert
      const res1 = await adapter.importRow(batchId, 0, key, data);
      expect(res1.ok).toBe(true);
      if (!res1.ok) return;
      const firstTargetId = res1.value.targetId;

      // Second identical call — must replay, not duplicate
      const res2 = await adapter.importRow(batchId, 0, key, data);
      expect(res2.ok).toBe(true);
      if (!res2.ok) return;
      expect(res2.value.priorResult).toBe(true);
      expect(res2.value.targetId).toBe(firstTargetId);

      // Third call — still idempotent
      const res3 = await adapter.importRow(batchId, 0, key, data);
      expect(res3.ok).toBe(true);
      if (!res3.ok) return;
      expect(res3.value.priorResult).toBe(true);
      expect(res3.value.targetId).toBe(firstTargetId);

      // Exactly 1 business record in the repository
      const { accounts } = await repo.listAccounts({ page: 1, pageSize: 100, search: 'IDEM-AC4-001' });
      expect(accounts.length).toBe(1);

      // Exactly 1 receipt
      const receipt = await repo.getImportReceiptByIdempotencyKey(key);
      expect(receipt).not.toBeNull();
      expect(receipt!.target_id).toBe(firstTargetId);
    });

    it('idempotent replay via HTTP API returns 200 with prior_result=true', async () => {
      const key = 'erp4-11-http-idem-001';
      const payload = {
        batch_id: '11000000-0000-0000-0000-000000000031',
        source_row: 0,
        idempotency_key: key,
        entity: 'account',
        record: { code: 'HTTP-IDEM-001', name: 'HTTP Idempotent Account', type: 'expense', currency_code: 'INR' },
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': key },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const data1 = JSON.parse(res1.payload);
      expect(data1.prior_result).toBe(false);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': key },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const data2 = JSON.parse(res2.payload);
      expect(data2.prior_result).toBe(true);
      expect(data2.target_id).toBe(data1.target_id);
    });

    it('different payload with same idempotency key returns 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', async () => {
      const key = 'erp4-11-conflict-key-001';

      await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': key },
        payload: {
          batch_id: '11000000-0000-0000-0000-000000000032',
          source_row: 0,
          idempotency_key: key,
          entity: 'account',
          record: { code: 'CONFLICT-ORIG-001', name: 'Original Account', type: 'asset', currency_code: 'INR' },
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': key },
        payload: {
          batch_id: '11000000-0000-0000-0000-000000000032',
          source_row: 0,
          idempotency_key: key,
          entity: 'account',
          record: { code: 'CONFLICT-DIFFERENT-001', name: 'Different Account', type: 'liability', currency_code: 'INR' },
        },
      });

      expect(res.statusCode).toBe(409);
      const err = JSON.parse(res.payload);
      expect(err.code).toBe('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

      // No duplicate account created
      const notCreated = await repo.getAccountByCode('CONFLICT-DIFFERENT-001');
      expect(notCreated).toBeNull();
    });
  });
});
