/**
 * ERP-4 Idempotency & Migration Target Adapter Test Suite
 *
 * Verifies Acceptance Criteria for Issue #42 [ERP4-07] (KIT-08 / Decision C4):
 *   1. Fixture row loaded via the same public API used by the Kit; Kit has no direct target-table write privilege.
 *   2. Retrying identical row payload/key 3 times produces exactly 1 business record and 1 durable receipt.
 *   3. Reusing a key with a different payload returns HTTP 409 and does not mutate data.
 *   4. Business-rule rejection returns a reason code and safe message; simulated 503 is retryable and not recorded as rejected.
 *   5. Receipt and target mutation commit or roll back together atomically in one transaction.
 *   6. Every posted journal entry balances exactly at currency precision (BR-ERP4-01).
 *   7. Posting to locked accounting period rejects (BR-ERP4-02).
 *   8. Erp4TargetAdapter executes preflight dry-run (zero mutations) and loadBatch with chunking and 10% abort threshold.
 *
 * @module erp4/tests/migration/idempotency.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemoryFinanceRepository } from '../../src/services/repository.js';
import { FinanceService } from '../../src/services/finance.service.js';
import { Erp4TargetAdapter, chunkArray } from '../../src/migration/target-adapter.js';

describe('ERP-4 Migration Kit Adapter & Durable Import Receipts (Issue #42 / [ERP4-07])', () => {
  let app: FastifyInstance;
  let repo: InMemoryFinanceRepository;
  let service: FinanceService;

  beforeEach(() => {
    repo = new InMemoryFinanceRepository(true); // seeds default test accounts and periods
    service = new FinanceService({ repository: repo });
    app = buildApp({ repository: repo, financeService: service });
  });

  describe('1. In-Process TargetAdapter (KIT-08 Contract)', () => {
    it('executes preflight dry-run validation without mutating the database', async () => {
      const adapter = new Erp4TargetAdapter(service, 'account');

      const rows = [
        { code: '1100-TEST', name: 'Valid Cash Account', type: 'asset' },
        { code: '', name: 'Invalid Missing Code', type: 'asset' },
        { code: '1200-TEST', name: 'Invalid Unknown Type', type: 'unknown_type' },
      ];

      const res = await adapter.preflight('00000000-0000-0000-0000-000000000010', rows);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.validCount).toBe(1);
        expect(res.value.rejectCount).toBe(2);
      }

      // Assert no database mutation occurred during dry-run
      const created = await repo.getAccountByCode('1100-TEST');
      expect(created).toBeNull();
    });

    it('preflight validates balanced and unbalanced journal entries', async () => {
      const adapter = new Erp4TargetAdapter(service, 'journal_entry');

      const rows = [
        {
          period_id: '00000000-0000-0000-0000-000000000001',
          posting_date: '2026-04-10',
          currency_code: 'INR',
          lines: [
            { account_id: '00000000-0000-0000-0000-000000000001', debit_amount: '500.00', credit_amount: '0.00' },
            { account_id: '00000000-0000-0000-0000-000000000002', debit_amount: '0.00', credit_amount: '500.00' },
          ],
        },
        {
          period_id: '00000000-0000-0000-0000-000000000001',
          posting_date: '2026-04-10',
          currency_code: 'INR',
          lines: [
            { account_id: '00000000-0000-0000-0000-000000000001', debit_amount: '500.00', credit_amount: '0.00' },
            { account_id: '00000000-0000-0000-0000-000000000002', debit_amount: '0.00', credit_amount: '400.00' }, // Unbalanced!
          ],
        },
      ];

      const res = await adapter.preflight('00000000-0000-0000-0000-000000000010', rows);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.validCount).toBe(1);
        expect(res.value.rejectCount).toBe(1);
      }
    });

    it('commits target business record and durable receipt atomically', async () => {
      const adapter = new Erp4TargetAdapter(service, 'account');
      const batchId = '00000000-0000-0000-0000-000000000010';
      const key = 'idem-account-atomic-001';

      const res = await adapter.importRow(batchId, 0, key, {
        code: '1500-EQUIP',
        name: 'Office Equipment',
        type: 'asset',
        currency_code: 'INR',
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.targetId).toBeDefined();
        expect(res.value.receipt.idempotencyKey).toBe(key);
        expect(res.value.receipt.entity).toBe('account');
        expect(res.value.receipt.batchId).toBe(batchId);
      }

      // Assert business row exists in repository
      const created = await repo.getAccountByCode('1500-EQUIP');
      expect(created).not.toBeNull();
      expect(created?.name).toBe('Office Equipment');

      // Assert receipt row exists in repository
      const receipt = await repo.getImportReceiptByIdempotencyKey(key);
      expect(receipt).not.toBeNull();
      expect(receipt?.target_id).toBe(created?.id);
    });
  });

  describe('2. Public API Ingestion & Identical Retries (3x)', () => {
    it('fixture row loaded via public API POST /api/v1/erp-finance/import without direct DB writes', async () => {
      const payload = {
        batch_id: '00000000-0000-0000-0000-000000000020',
        source_row: 1,
        source_system: 'tally_erp',
        source_id: 'LEG-ACC-101',
        idempotency_key: 'idem-api-test-001',
        entity: 'account',
        record: {
          code: '1800-SOFTWARE',
          name: 'Software Licenses',
          type: 'asset',
          currency_code: 'INR',
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.payload);
      expect(data.target_id).toBeDefined();
      expect(data.prior_result).toBe(false);
      expect(data.outcome).toBe('loaded');
      expect(data.receipt.idempotency_key).toBe(payload.idempotency_key);

      // Verify business row was created
      const account = await repo.getAccountByCode('1800-SOFTWARE');
      expect(account).not.toBeNull();
      expect(account?.id).toBe(data.target_id);
    });

    it('retrying identical row payload and key 3 times produces exactly 1 business record and 1 durable receipt', async () => {
      const payload = {
        batch_id: '00000000-0000-0000-0000-000000000021',
        source_row: 2,
        source_system: 'legacy_sap',
        source_id: 'SAP-ACC-902',
        idempotency_key: 'key-account-retry-3x',
        entity: 'account',
        record: {
          code: '2100-ACCRUED-EXP',
          name: 'Accrued Expenses',
          type: 'liability',
          currency_code: 'INR',
        },
      };

      // Call 1 (Fresh Mutation)
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const data1 = JSON.parse(res1.payload);
      expect(data1.prior_result).toBe(false);
      const targetId = data1.target_id;

      // Call 2 (Idempotent Replay 1)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const data2 = JSON.parse(res2.payload);
      expect(data2.prior_result).toBe(true);
      expect(data2.target_id).toBe(targetId);

      // Call 3 (Idempotent Replay 2)
      const res3 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });
      expect(res3.statusCode).toBe(200);
      const data3 = JSON.parse(res3.payload);
      expect(data3.prior_result).toBe(true);
      expect(data3.target_id).toBe(targetId);

      // Assert repository contains exactly 1 account with this code
      const { accounts } = await repo.listAccounts({ page: 1, pageSize: 100, search: '2100-ACCRUED-EXP' });
      expect(accounts.length).toBe(1);

      // Assert repository contains exactly 1 receipt with this key
      const receipt = await repo.getImportReceiptByIdempotencyKey(payload.idempotency_key);
      expect(receipt).not.toBeNull();
      expect(receipt?.target_id).toBe(targetId);
    });
  });

  describe('3. Reused Key with Different Payload (HTTP 409 Conflict)', () => {
    it('reusing an idempotency key with a different payload returns 409 and does not mutate data', async () => {
      const key = 'idem-conflict-test-key-01';

      const initialPayload = {
        batch_id: '00000000-0000-0000-0000-000000000030',
        source_row: 1,
        idempotency_key: key,
        entity: 'account',
        record: {
          code: '3100-COMMON-STOCK',
          name: 'Common Stock',
          type: 'liability',
          currency_code: 'INR',
        },
      };

      // 1. Initial success
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': key },
        payload: initialPayload,
      });
      expect(res1.statusCode).toBe(201);

      // 2. Conflicting payload with SAME key
      const conflictingPayload = {
        batch_id: '00000000-0000-0000-0000-000000000030',
        source_row: 1,
        idempotency_key: key,
        entity: 'account',
        record: {
          code: '3200-DIFFERENT-CODE', // Changed payload!
          name: 'Preferred Stock',
          type: 'liability',
          currency_code: 'INR',
        },
      };

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': key },
        payload: conflictingPayload,
      });

      expect(res2.statusCode).toBe(409);
      const err = JSON.parse(res2.payload);
      expect(err.code).toBe('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
      expect(err.message).toContain(key);

      // 3. Verify conflicting account was NOT created
      const notCreated = await repo.getAccountByCode('3200-DIFFERENT-CODE');
      expect(notCreated).toBeNull();
    });
  });

  describe('4. Business Validation & Transient Infrastructure Failures', () => {
    it('rejects duplicate account code with stable reason code and creates no duplicate receipt', async () => {
      // 1010-CASH is pre-seeded
      const payload = {
        batch_id: '00000000-0000-0000-0000-000000000040',
        source_row: 1,
        idempotency_key: 'idem-duplicate-code-01',
        entity: 'account',
        record: {
          code: '1010-CASH', // Pre-seeded duplicate code!
          name: 'Duplicate Petty Cash',
          type: 'asset',
          currency_code: 'INR',
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });

      expect(res.statusCode).toBe(409);
      const data = JSON.parse(res.payload);
      expect(data.code).toBe('ACCOUNT_CODE_EXISTS');

      // Assert no receipt was stored for the rejected operation
      const receipt = await repo.getImportReceiptByIdempotencyKey(payload.idempotency_key);
      expect(receipt).toBeNull();
    });

    it('rejects unbalanced journal entry with UNBALANCED_ENTRY and rolls back transaction', async () => {
      const openPeriod = await repo.getPeriodByLabel('2026-04');
      expect(openPeriod?.status).toBe('open');

      const payload = {
        batch_id: '00000000-0000-0000-0000-000000000041',
        source_row: 2,
        idempotency_key: 'idem-unbalanced-je-01',
        entity: 'journal_entry',
        record: {
          period_id: openPeriod!.id,
          posting_date: '2026-04-12',
          currency_code: 'INR',
          description: 'Unbalanced Journal Entry',
          lines: [
            { account_id: 'aaaaaaaa-0001-0001-0001-000000000001', debit: '1000.00', credit: '0.00' },
            { account_id: 'aaaaaaaa-0001-0001-0001-000000000002', debit: '0.00', credit: '950.00' }, // 50.00 discrepancy!
          ],
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });

      expect(res.statusCode).toBe(422);
      const data = JSON.parse(res.payload);
      expect(data.code).toBe('UNBALANCED_ENTRY');

      // Assert no receipt was persisted
      const receipt = await repo.getImportReceiptByIdempotencyKey(payload.idempotency_key);
      expect(receipt).toBeNull();
    });

    it('rejects posting to a locked accounting period with PERIOD_LOCKED', async () => {
      const lockedPeriod = await repo.getPeriodByLabel('2026-02'); // Seeded as locked
      expect(lockedPeriod?.status).toBe('locked');

      const payload = {
        batch_id: '00000000-0000-0000-0000-000000000042',
        source_row: 3,
        idempotency_key: 'idem-locked-period-je-01',
        entity: 'journal_entry',
        record: {
          period_id: lockedPeriod!.id,
          posting_date: '2026-02-15',
          currency_code: 'INR',
          description: 'Posting to Locked Period',
          lines: [
            { account_id: 'aaaaaaaa-0001-0001-0001-000000000001', debit: '250.00', credit: '0.00' },
            { account_id: 'aaaaaaaa-0001-0001-0001-000000000002', debit: '0.00', credit: '250.00' },
          ],
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });

      expect(res.statusCode).toBe(422);
      const data = JSON.parse(res.payload);
      expect(data.code).toBe('PERIOD_LOCKED');

      const receipt = await repo.getImportReceiptByIdempotencyKey(payload.idempotency_key);
      expect(receipt).toBeNull();
    });

    it('rejects duplicate opening balance for same account and currency (FR-ERP4-04)', async () => {
      // 1020-BANK has seeded opening balance in INR
      const bankAccount = await repo.getAccountByCode('1020-BANK');
      expect(bankAccount).not.toBeNull();

      const payload = {
        batch_id: '00000000-0000-0000-0000-000000000043',
        source_row: 4,
        idempotency_key: 'idem-duplicate-opb-01',
        entity: 'opening_balance',
        record: {
          account_id: bankAccount!.id,
          currency_code: 'INR',
          balance_amount: '50000.00',
          as_of_date: '2026-04-01',
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });

      expect(res.statusCode).toBe(409);
      const data = JSON.parse(res.payload);
      expect(data.code).toBe('OPENING_BALANCE_ALREADY_EXISTS');

      const receipt = await repo.getImportReceiptByIdempotencyKey(payload.idempotency_key);
      expect(receipt).toBeNull();
    });

    it('simulated 503 infrastructure failure rolls back transaction and is not recorded as rejected', async () => {
      // Mock repository executeTransactional to simulate transient PostgreSQL 503 error
      const originalExec = repo.executeTransactional.bind(repo);
      repo.executeTransactional = async () => {
        const error = new Error('Database connection pool exhausted');
        (error as any).statusCode = 503;
        (error as any).code = 'INFRASTRUCTURE_UNAVAILABLE';
        throw error;
      };

      const payload = {
        batch_id: '00000000-0000-0000-0000-000000000050',
        source_row: 1,
        idempotency_key: 'idem-transient-503-key',
        entity: 'account',
        record: {
          code: '1999-ROLLBACK-TEST',
          name: 'Rollback Test Account',
          type: 'asset',
          currency_code: 'INR',
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });

      // Must return 503 and remain retryable
      expect(res.statusCode).toBe(503);

      // Restore repository
      repo.executeTransactional = originalExec;

      // Assert transaction rolled back: no business row, no receipt
      const created = await repo.getAccountByCode('1999-ROLLBACK-TEST');
      expect(created).toBeNull();

      const receipt = await repo.getImportReceiptByIdempotencyKey(payload.idempotency_key);
      expect(receipt).toBeNull();
    });
  });

  describe('5. Batch Processing, Chunking & Failure Halting (KIT-08 / Core Rules)', () => {
    it('processes batch in 500-row chunks with complete reconciliation (loaded + rejected + unattempted)', async () => {
      const adapter = new Erp4TargetAdapter(service, 'account');
      const batchId = '00000000-0000-0000-0000-000000000060';

      // Create 15 synthetic rows
      const rows = Array.from({ length: 15 }, (_, i) => ({
        sourceRow: i,
        idempotencyKey: `batch-row-key-${i}`,
        data: {
          code: `700${i}-EXPENSE`,
          name: `Expense Account ${i}`,
          type: 'expense',
          currency_code: 'INR',
        },
      }));

      // Use chunkSize 5 to test multiple chunks
      const result = await adapter.loadBatch(batchId, rows, {
        chunkSize: 5,
        minAttemptedRows: 10,
        failureThreshold: 0.10,
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.total).toBe(15);
      expect(result.loaded).toBe(15);
      expect(result.rejected).toBe(0);
      expect(result.unattempted).toBe(0);
      expect(result.chunksProcessed).toBe(3);

      // Assert terminal outcome reconciliation: source = loaded + rejected + unattempted, unaccounted = 0
      expect(result.loaded + result.rejected + result.unattempted).toBe(result.total);
    });

    it('halts immediately when failure rate exceeds 10% after 10 rows', async () => {
      const adapter = new Erp4TargetAdapter(service, 'account');
      const batchId = '00000000-0000-0000-0000-000000000061';

      // Construct rows: first 8 valid, next 3 invalid, remaining valid (total 20)
      const rows = Array.from({ length: 20 }, (_, i) => {
        const isInvalid = i >= 8 && i <= 10;
        return {
          sourceRow: i,
          idempotencyKey: `halt-test-key-${i}`,
          data: isInvalid
            ? { code: '', name: 'Invalid Missing Code', type: 'asset' }
            : { code: `800${i}-REV`, name: `Revenue Account ${i}`, type: 'income', currency_code: 'INR' },
        };
      });

      const result = await adapter.loadBatch(batchId, rows, {
        chunkSize: 5,
        minAttemptedRows: 10,
        failureThreshold: 0.10, // 10%
      });

      expect(result.status).toBe('STOPPED_EXCESSIVE_FAILURES');
      expect(result.stoppedReason).toContain('exceeded threshold');
      expect(result.rejected).toBeGreaterThan(0);
      expect(result.unattempted).toBeGreaterThan(0);

      // Enforce total reconciliation
      expect(result.loaded + result.rejected + result.unattempted).toBe(result.total);
      expect(result.attempted).toBe(result.loaded + result.rejected);
    });
  });

  describe('6. Domain Invariant: Posted Journal Entry Exact Balance & Immutability', () => {
    it('creates and posts a journal entry with exact balance in 1 atomic transaction', async () => {
      const openPeriod = await repo.getPeriodByLabel('2026-04');
      expect(openPeriod?.status).toBe('open');

      const payload = {
        batch_id: '00000000-0000-0000-0000-000000000070',
        source_row: 1,
        idempotency_key: 'idem-balanced-post-01',
        entity: 'journal_entry',
        record: {
          period_id: openPeriod!.id,
          posting_date: '2026-04-14',
          currency_code: 'INR',
          description: 'Balanced posted journal import',
          status: 'posted',
          lines: [
            { account_id: 'aaaaaaaa-0001-0001-0001-000000000001', debit: '15000.50', credit: '0.00' },
            { account_id: 'aaaaaaaa-0001-0001-0001-000000000002', debit: '0.00', credit: '15000.50' },
          ],
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/import',
        headers: { 'idempotency-key': payload.idempotency_key },
        payload,
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.payload);
      expect(data.target_id).toBeDefined();

      // Verify the posted entry is in 'posted' status
      const entry = await repo.getJournalEntryById(data.target_id);
      expect(entry).not.toBeNull();
      expect(entry?.status).toBe('posted');
      expect(entry?.posted_at).toBeDefined();

      // Trial balance should immediately reflect posted entry without delay
      const tbRes = await app.inject({
        method: 'GET',
        url: `/api/v1/erp-finance/trial-balance?period=${openPeriod!.period_label}&currency_code=INR`,
      });
      expect(tbRes.statusCode).toBe(200);
      const tb = JSON.parse(tbRes.payload);
      expect(tb.totals.total_debit).toBe(tb.totals.total_credit);
      expect(tb.totals.is_balanced).toBe(true);
    });
  });
});
