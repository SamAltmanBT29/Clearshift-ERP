/**
 * ERP-4 Finance & Accounting — Mutation API and Domain Validation Test Suite
 *
 * Exhaustively validates:
 *  - Issue #38 requirements and V1 domain invariants
 *  - FR-ERP4-01..05 & BR-ERP4-01..02
 *  - Accounts: POST create, PATCH edit, circular hierarchy detection, protected fields, role authorization
 *  - Journal Entries: POST draft create, PATCH draft edit, POST post, POST reverse, POST void
 *  - Exact balancing at currency precision, multi-line constraints
 *  - Opening Balances: POST bulk load, one-time constraint, batch/item idempotency
 *  - Idempotency-Key header support, import receipt persistence in same atomic boundary
 *  - Error envelope with code, correlation_id, safe field details, and SQL/secret masking on 500
 *
 * @module erp4/tests/api/mutations.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app.js';
import { InMemoryFinanceRepository } from '../../src/services/repository.js';
import { FinanceService } from '../../src/services/finance.service.js';

describe('ERP-4 Finance & Accounting — Mutation API & Domain Invariants (#38)', () => {
  let repository: InMemoryFinanceRepository;
  let financeService: FinanceService;
  let app: FastifyInstance;

  beforeEach(() => {
    repository = new InMemoryFinanceRepository(true); // seed fixtures
    financeService = new FinanceService(repository);
    app = buildApp({ repository, financeService, authRequired: false });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Chart of Accounts Mutations: POST & PATCH
  // ───────────────────────────────────────────────────────────────────────────
  describe('Chart of Accounts Mutations', () => {
    it('creates an account with import receipt when idempotency and batch provenance are provided', async () => {
      const idempotencyKey = `acct-import-${Date.now()}`;
      const batchId = randomUUID();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        headers: {
          'idempotency-key': idempotencyKey,
        },
        payload: {
          code: '1040-TEST',
          name: 'Imported Test Account',
          type: 'asset',
          currency_code: 'INR',
          batch_id: batchId,
          source_row: 12,
        },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json();
      expect(created.code).toBe('1040-TEST');
      expect(created.id).toBeDefined();

      // Verify import receipt was atomically persisted
      const receipt = await repository.getImportReceiptByIdempotencyKey(idempotencyKey);
      expect(receipt).toBeDefined();
      expect(receipt?.entity).toBe('account');
      expect(receipt?.target_id).toBe(created.id);
      expect(receipt?.batch_id).toBe(batchId);
      expect(receipt?.source_row).toBe(12);
    });

    it('returns 200 OK with original account and receipt on repeated request with same idempotency key', async () => {
      const idempotencyKey = `acct-replay-${Date.now()}`;
      const payload = {
        code: '1050-REPLAY',
        name: 'Replay Account',
        type: 'asset',
        currency_code: 'INR',
        batch_id: randomUUID(),
        source_row: 1,
        idempotency_key: idempotencyKey,
      };

      const firstRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload,
      });
      expect(firstRes.statusCode).toBe(201);
      const firstAccount = firstRes.json();

      // Second identical call
      const secondRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload,
      });
      expect(secondRes.statusCode).toBe(200);
      const secondAccount = secondRes.json();
      expect(secondAccount.id).toBe(firstAccount.id);
      expect(secondAccount.code).toBe(firstAccount.code);
    });

    it('returns 409 Conflict when idempotency key conflicts with different account code', async () => {
      const idempotencyKey = `acct-conflict-${Date.now()}`;

      // First call
      await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: '1060-FIRST',
          name: 'First Account',
          type: 'asset',
          idempotency_key: idempotencyKey,
          batch_id: randomUUID(),
          source_row: 0,
        },
      });

      // Second call with same idempotency key but different code
      const conflictRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: '1061-CONFLICTING',
          name: 'Conflicting Code Account',
          type: 'asset',
          idempotency_key: idempotencyKey,
        },
      });

      expect(conflictRes.statusCode).toBe(409);
      const err = conflictRes.json();
      expect(err.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(err.details[0]?.field).toBe('idempotency_key');
    });

    it('enforces role authorization on POST /accounts: rejects viewer/staff with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        headers: {
          authorization: 'Bearer role:viewer',
        },
        payload: {
          code: '1070-VIEWER',
          name: 'Viewer Forbidden Account',
          type: 'asset',
        },
      });

      expect(res.statusCode).toBe(403);
      const err = res.json();
      expect(err.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('rejects parent account currency mismatch with HTTP 422 Unprocessable Entity', async () => {
      // Find INR parent account
      const parent = await repository.getAccountByCode('1010-CASH');
      expect(parent).not.toBeNull();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: '1080-USD-SUB',
          name: 'USD Sub under INR Parent',
          type: 'asset',
          currency_code: 'USD',
          parent_id: parent!.id,
        },
      });

      expect(res.statusCode).toBe(422);
      const err = res.json();
      expect(err.code).toBe('CURRENCY_MISMATCH');
      expect(err.message).toContain('Currency mismatch');
    });

    it('PATCH /accounts/:id updates mutable fields and returns 200 OK', async () => {
      const existing = await repository.getAccountByCode('1010-CASH');
      expect(existing).not.toBeNull();

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/accounts/${existing!.id}`,
        payload: {
          name: 'Main Cash Account - Updated',
          description: 'Updated operating cash description',
          is_active: true,
          is_posting_account: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.name).toBe('Main Cash Account - Updated');
      expect(updated.description).toBe('Updated operating cash description');
    });

    it('PATCH /accounts/:id never accepts protected system fields as authoritative from browser', async () => {
      const existing = await repository.getAccountByCode('1010-CASH');
      const originalCode = existing!.code;
      const originalCurrency = existing!.currency_code;
      const originalCreatedAt = existing!.created_at;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/accounts/${existing!.id}`,
        payload: {
          name: 'Safely Updated Name',
          code: 'ATTEMPTED-CHANGE',
          currency_code: 'EUR',
          created_at: '2020-01-01T00:00:00.000Z',
        } as any,
      });

      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.name).toBe('Safely Updated Name');
      // Immutable fields must remain unchanged
      expect(updated.code).toBe(originalCode);
      expect(updated.currency_code).toBe(originalCurrency);
      expect(updated.created_at).toBe(originalCreatedAt);
    });

    it('PATCH /accounts/:id detects self-referential cycle and returns 422 CYCLE_DETECTED', async () => {
      const existing = await repository.getAccountByCode('1010-CASH');

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/accounts/${existing!.id}`,
        payload: {
          parent_id: existing!.id,
        },
      });

      expect(res.statusCode).toBe(422);
      const err = res.json();
      expect(err.code).toBe('CYCLE_DETECTED');
      expect(err.message).toContain('itself');
    });

    it('PATCH /accounts/:id detects multi-hop circular hierarchy and returns 422 CYCLE_DETECTED', async () => {
      // Create node A
      const aRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: { code: 'CYCLE-A', name: 'Node A', type: 'asset' },
      });
      const nodeA = aRes.json();

      // Create node B with parent A
      const bRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: { code: 'CYCLE-B', name: 'Node B', type: 'asset', parent_id: nodeA.id },
      });
      const nodeB = bRes.json();

      // Now attempt to update A to have parent B -> cycle!
      const cycleRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/accounts/${nodeA.id}`,
        payload: { parent_id: nodeB.id },
      });

      expect(cycleRes.statusCode).toBe(422);
      const err = cycleRes.json();
      expect(err.code).toBe('CYCLE_DETECTED');
      expect(err.message).toContain('Circular parent hierarchy');
    });

    it('PATCH /accounts/:id returns 404 for nonexistent account and 422 for nonexistent parent_id', async () => {
      const nonExistentId = randomUUID();

      const notFoundRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/accounts/${nonExistentId}`,
        payload: { name: 'New Name' },
      });
      expect(notFoundRes.statusCode).toBe(404);

      const existing = await repository.getAccountByCode('1010-CASH');
      const badParentRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/accounts/${existing!.id}`,
        payload: { parent_id: nonExistentId },
      });
      expect(badParentRes.statusCode).toBe(422);
      expect(badParentRes.json().code).toBe('PARENT_NOT_FOUND');
    });

    it('enforces role authorization on PATCH /accounts/:id: rejects staff with 403 Forbidden', async () => {
      const existing = await repository.getAccountByCode('1010-CASH');

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/accounts/${existing!.id}`,
        headers: {
          authorization: 'Bearer role:staff',
        },
        payload: { name: 'Staff Edit' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Journal Entry Lifecycle & Invariant Validations
  // ───────────────────────────────────────────────────────────────────────────
  describe('Journal Entry Lifecycle & Domain Rules', () => {
    let openPeriodId: string;
    let cashAccountId: string;
    let expenseAccountId: string;

    beforeEach(async () => {
      const period = await repository.getPeriodByLabel('2026-04');
      openPeriodId = period!.id;

      const cash = await repository.getAccountByCode('1010-CASH');
      cashAccountId = cash!.id;

      const expense = await repository.getAccountByCode('5010-SALARY');
      expenseAccountId = expense!.id;
    });

    it('creates draft entry with Idempotency-Key header and atomic import receipt', async () => {
      const idempotencyKey = `je-import-${Date.now()}`;
      const batchId = randomUUID();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        headers: {
          'idempotency-key': idempotencyKey,
        },
        payload: {
          period_id: openPeriodId,
          posting_date: '2026-04-10',
          description: 'Office rent payment',
          currency_code: 'INR',
          batch_id: batchId,
          source_row: 42,
          lines: [
            { account_id: expenseAccountId, debit_amount: '25000.0000', credit_amount: '0.0000' },
            { account_id: cashAccountId, debit_amount: '0.0000', credit_amount: '25000.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json();
      expect(created.status).toBe('draft');

      const receipt = await repository.getImportReceiptByIdempotencyKey(idempotencyKey);
      expect(receipt).toBeDefined();
      expect(receipt?.entity).toBe('journal_entry');
      expect(receipt?.target_id).toBe(created.id);
      expect(receipt?.batch_id).toBe(batchId);
      expect(receipt?.source_row).toBe(42);
    });

    it('returns 409 Conflict when idempotency key conflicts with different entry parameters', async () => {
      const idempotencyKey = `je-conflict-${Date.now()}`;

      await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: openPeriodId,
          posting_date: '2026-04-10',
          description: 'First Entry',
          currency_code: 'INR',
          idempotency_key: idempotencyKey,
          lines: [
            { account_id: expenseAccountId, debit_amount: '1000.0000', credit_amount: '0.0000' },
            { account_id: cashAccountId, debit_amount: '0.0000', credit_amount: '1000.0000' },
          ],
        },
      });

      // Repeat with different currency code
      const conflictRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: openPeriodId,
          posting_date: '2026-04-10',
          description: 'Conflicting Currency Entry',
          currency_code: 'USD',
          idempotency_key: idempotencyKey,
          lines: [
            { account_id: expenseAccountId, debit_amount: '1000.0000', credit_amount: '0.0000' },
            { account_id: cashAccountId, debit_amount: '0.0000', credit_amount: '1000.0000' },
          ],
        },
      });

      expect(conflictRes.statusCode).toBe(409);
      expect(conflictRes.json().code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('rejects journal entry with line having both debit and credit positive with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: openPeriodId,
          posting_date: '2026-04-10',
          description: 'Both debit and credit positive',
          currency_code: 'INR',
          lines: [
            { account_id: expenseAccountId, debit_amount: '1000.0000', credit_amount: '500.0000' },
            { account_id: cashAccountId, debit_amount: '0.0000', credit_amount: '500.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects journal entry with fewer than 2 lines with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: openPeriodId,
          posting_date: '2026-04-10',
          description: 'Single line entry',
          currency_code: 'INR',
          lines: [
            { account_id: expenseAccountId, debit_amount: '1000.0000', credit_amount: '0.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('PATCH /journal-entries/:id updates draft entry and enforces double-entry balancing', async () => {
      // Create draft entry
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: openPeriodId,
          posting_date: '2026-04-10',
          description: 'Initial draft narration',
          currency_code: 'INR',
          lines: [
            { account_id: expenseAccountId, debit_amount: '5000.0000', credit_amount: '0.0000' },
            { account_id: cashAccountId, debit_amount: '0.0000', credit_amount: '5000.0000' },
          ],
        },
      });
      const draft = createRes.json();

      // Update draft with balanced modified lines
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}`,
        payload: {
          description: 'Updated draft narration with new amounts',
          lines: [
            { account_id: expenseAccountId, debit_amount: '7500.0000', credit_amount: '0.0000' },
            { account_id: cashAccountId, debit_amount: '0.0000', credit_amount: '7500.0000' },
          ],
        },
      });

      expect(patchRes.statusCode).toBe(200);
      const updated = patchRes.json();
      expect(updated.description).toBe('Updated draft narration with new amounts');
      expect(updated.lines[0]?.debit_amount).toBe('7500.0000');

      // Attempt unbalanced update -> 400 or 422
      const unbalancedRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}`,
        payload: {
          lines: [
            { account_id: expenseAccountId, debit_amount: '7500.0000', credit_amount: '0.0000' },
            { account_id: cashAccountId, debit_amount: '0.0000', credit_amount: '7000.0000' },
          ],
        },
      });
      expect([400, 422]).toContain(unbalancedRes.statusCode);
    });

    it('PATCH /journal-entries/:id rejects edits on posted entries (posted entries are immutable)', async () => {
      // Create and post an entry
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: openPeriodId,
          posting_date: '2026-04-10',
          description: 'To be posted',
          currency_code: 'INR',
          lines: [
            { account_id: expenseAccountId, debit_amount: '5000.0000', credit_amount: '0.0000' },
            { account_id: cashAccountId, debit_amount: '0.0000', credit_amount: '5000.0000' },
          ],
        },
      });
      const entry = createRes.json();

      await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${entry.id}/post`,
      });

      // Attempt to edit posted entry
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/journal-entries/${entry.id}`,
        payload: {
          description: 'Direct edit of posted entry is forbidden',
        },
      });

      expect(patchRes.statusCode).toBe(422);
      const err = patchRes.json();
      expect(err.code).toBe('ENTRY_IMMUTABLE');
    });

    it('POST /journal-entries/:id/void voids draft entry and rejects voiding posted entry', async () => {
      // 1. Void a draft entry
      const draftRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: openPeriodId,
          posting_date: '2026-04-10',
          description: 'Draft to void',
          currency_code: 'INR',
          lines: [
            { account_id: expenseAccountId, debit_amount: '1000.0000', credit_amount: '0.0000' },
            { account_id: cashAccountId, debit_amount: '0.0000', credit_amount: '1000.0000' },
          ],
        },
      });
      const draft = draftRes.json();

      const voidRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}/void`,
      });
      expect(voidRes.statusCode).toBe(200);
      expect(voidRes.json().status).toBe('voided');

      // Voiding already voided entry is idempotent
      const reVoidRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}/void`,
      });
      expect(reVoidRes.statusCode).toBe(200);

      // Attempting to edit a voided entry returns 422
      const patchVoidedRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}`,
        payload: { description: 'Edit voided' },
      });
      expect(patchVoidedRes.statusCode).toBe(422);

      // 2. Voiding a posted entry must be rejected with 422 (must use reversal)
      const postedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: openPeriodId,
          posting_date: '2026-04-10',
          description: 'Posted entry',
          currency_code: 'INR',
          lines: [
            { account_id: expenseAccountId, debit_amount: '2000.0000', credit_amount: '0.0000' },
            { account_id: cashAccountId, debit_amount: '0.0000', credit_amount: '2000.0000' },
          ],
        },
      });
      const postedEntry = postedRes.json();
      await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${postedEntry.id}/post`,
      });

      const voidPostedRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${postedEntry.id}/void`,
      });
      expect(voidPostedRes.statusCode).toBe(422);
      expect(voidPostedRes.json().code).toBe('ENTRY_IMMUTABLE');
    });

    it('POST /journal-entries/:id/reverse rejects reversing an already reversed entry', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: openPeriodId,
          posting_date: '2026-04-10',
          description: 'To be reversed',
          currency_code: 'INR',
          lines: [
            { account_id: expenseAccountId, debit_amount: '3000.0000', credit_amount: '0.0000' },
            { account_id: cashAccountId, debit_amount: '0.0000', credit_amount: '3000.0000' },
          ],
        },
      });
      const entry = createRes.json();

      await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${entry.id}/post`,
      });

      // First reversal
      const revRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${entry.id}/reverse`,
        payload: { reversal_description: 'First reversal' },
      });
      expect(revRes.statusCode).toBe(200);

      // Second reversal attempt -> 422 NOT_REVERSIBLE
      const secondRevRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${entry.id}/reverse`,
        payload: { reversal_description: 'Second reversal attempt' },
      });
      expect(secondRevRes.statusCode).toBe(422);
      expect(secondRevRes.json().code).toBe('NOT_REVERSIBLE');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Opening Balances Mutations & Idempotency
  // ───────────────────────────────────────────────────────────────────────────
  describe('Opening Balances Mutations & Idempotency', () => {
    it('creates opening balances with batch provenance and receipts', async () => {
      // Create new fresh account
      const acctRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: { code: '1090-OB-TEST', name: 'Opening Balance Test', type: 'asset', currency_code: 'INR' },
      });
      const account = acctRes.json();

      const batchId = randomUUID();
      const idempotencyKey = `ob-batch-${Date.now()}`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        headers: {
          'idempotency-key': idempotencyKey,
        },
        payload: {
          batch_id: batchId,
          balances: [
            {
              account_id: account.id,
              currency_code: 'INR',
              balance_amount: '125000.0000',
              as_of_date: '2026-04-01',
              batch_id: batchId,
              source_row: 0,
              idempotency_key: `ob-item-${Date.now()}`,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.created.length).toBe(1);
      expect(data.created[0]?.balance_amount).toBe('125000.0000');
      expect(data.receipts).toBeDefined();

      // One-time rule (FR-ERP4-04): repeated non-idempotent attempt skips with reason
      const secondRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        payload: {
          balances: [
            {
              account_id: account.id,
              currency_code: 'INR',
              balance_amount: '99999.0000',
              as_of_date: '2026-04-01',
            },
          ],
        },
      });

      expect(secondRes.statusCode).toBe(201);
      const secondData = secondRes.json();
      expect(secondData.created.length).toBe(0);
      expect(secondData.skipped.length).toBe(1);
      expect(secondData.skipped[0]?.reason).toContain('already loaded');
    });

    it('returns original balances on repeated request with identical batch idempotency key', async () => {
      const acctRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: { code: '1091-OB-REPLAY', name: 'Opening Balance Replay', type: 'asset', currency_code: 'INR' },
      });
      const account = acctRes.json();

      const batchKey = `ob-replay-${Date.now()}`;
      const payload = {
        idempotency_key: batchKey,
        balances: [
          {
            account_id: account.id,
            currency_code: 'INR',
            balance_amount: '50000.0000',
            as_of_date: '2026-04-01',
          },
        ],
      };

      const firstRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        payload,
      });
      expect(firstRes.statusCode).toBe(201);

      // Replay
      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        payload,
      });
      expect(replayRes.statusCode).toBe(201);
      const replayData = replayRes.json();
      expect(replayData.created.length).toBe(1);
      expect(replayData.created[0]?.balance_amount).toBe('50000.0000');
    });

    it('returns 409 Conflict when item idempotency key conflicts with different account', async () => {
      const acct1Res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: { code: '1092-OB-C1', name: 'Conflict 1', type: 'asset' },
      });
      const acct1 = acct1Res.json();

      const acct2Res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: { code: '1093-OB-C2', name: 'Conflict 2', type: 'asset' },
      });
      const acct2 = acct2Res.json();

      const itemKey = `item-key-${Date.now()}`;

      await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        payload: {
          balances: [
            {
              account_id: acct1.id,
              currency_code: 'INR',
              balance_amount: '1000.0000',
              as_of_date: '2026-04-01',
              idempotency_key: itemKey,
              batch_id: randomUUID(),
              source_row: 0,
            },
          ],
        },
      });

      // Conflict attempt
      const conflictRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        payload: {
          balances: [
            {
              account_id: acct2.id,
              currency_code: 'INR',
              balance_amount: '1000.0000',
              as_of_date: '2026-04-01',
              idempotency_key: itemKey,
              batch_id: randomUUID(),
              source_row: 0,
            },
          ],
        },
      });

      expect(conflictRes.statusCode).toBe(409);
      expect(conflictRes.json().code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Standard Error Format, Correlation ID, and Safe Error Masking
  // ───────────────────────────────────────────────────────────────────────────
  describe('Standard Error Envelope, Correlation Tracking & Security Masking', () => {
    it('returns correlation_id in headers and body for business validation failures', async () => {
      const correlationId = 'test-corr-id-12345';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        headers: {
          'x-correlation-id': correlationId,
        },
        payload: {
          // missing code -> schema validation failure
          name: 'Missing Code Account',
          type: 'asset',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.headers['x-correlation-id']).toBe(correlationId);
      const err = res.json();
      expect(err.correlation_id).toBe(correlationId);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details).toBeInstanceOf(Array);
    });

    it('generates a UUID correlation_id if none was provided by client', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts/invalid-uuid-id',
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(err.correlation_id).toBeDefined();
      expect(typeof err.correlation_id).toBe('string');
      expect(res.headers['x-correlation-id']).toBe(err.correlation_id);
    });

    it('masks SQL queries and secrets in unexpected 500 error envelope without leaking sensitive details', async () => {
      const failingRepo = new InMemoryFinanceRepository(true);
      failingRepo.listAccounts = async () => {
        throw new Error('SELECT * FROM private_users WHERE password_hash = "secret" FAILED');
      };

      const failingApp = buildApp({ repository: failingRepo, authRequired: false });
      const res = await failingApp.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
      });

      expect(res.statusCode).toBe(500);
      const err = res.json();
      expect(err.statusCode).toBe(500);
      expect(err.correlation_id).toBeDefined();
      // Must not leak SQL or secret
      expect(err.message).toBe('An unexpected internal error occurred.');
      expect(err.message).not.toContain('SELECT');
      expect(err.message).not.toContain('password_hash');
    });
  });
});
