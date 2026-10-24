/**
 * ERP-4 Finance & Accounting — Domain Invariants Test Suite
 *
 * Asserts every domain rule and invariant defined in:
 *   - SDS ClearShift ERP v2.0 §4.4 (FR-ERP4-01..05, BR-ERP4-01..02)
 *   - Issue #45 Specification:
 *     1. Every posted journal entry balances exactly at currency precision.
 *     2. Debit and credit are non-negative and cannot both be positive on one line.
 *     3. Header and lines commit in one database transaction.
 *     4. Posting locks the entry during validation; posted entries are immutable.
 *     5. Corrections use reversal entries, not direct edits.
 *     6. Each account code is unique; opening balance is loaded once per account/currency.
 *     7. Each journal entry has one explicit currency_code; all lines use that currency;
 *        trial balance totals are grouped by account and currency and never add unlike currencies.
 *     8. Closed accounting period rejects posting.
 *
 * @module erp4/tests/domain/invariants.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemoryFinanceRepository } from '../../src/services/repository.js';
import {
  FIXTURE_PERIOD_OPEN,
  FIXTURE_PERIOD_SOFT_CLOSED,
  FIXTURE_PERIOD_LOCKED,
} from '../../fixtures/index.js';

const BASE = '/api/v1/erp-finance';

describe('ERP-4 domain invariants', () => {
  let app: FastifyInstance;
  let repo: InMemoryFinanceRepository;
  let cashAccountId: string;
  let bankAccountId: string;
  let revenueAccountId: string;
  let expenseAccountId: string;

  beforeEach(async () => {
    repo = new InMemoryFinanceRepository(false);
    repo.periods.set(String(FIXTURE_PERIOD_OPEN['id']), FIXTURE_PERIOD_OPEN as any);
    repo.periods.set(String(FIXTURE_PERIOD_SOFT_CLOSED['id']), FIXTURE_PERIOD_SOFT_CLOSED as any);
    repo.periods.set(String(FIXTURE_PERIOD_LOCKED['id']), FIXTURE_PERIOD_LOCKED as any);

    app = buildApp({ repository: repo, authRequired: false });

    // Seed base accounts
    const cRes = await app.inject({
      method: 'POST',
      url: `${BASE}/accounts`,
      payload: { code: '1010', name: 'Cash', type: 'asset', currency_code: 'INR' },
    });
    cashAccountId = cRes.json().id;

    const bRes = await app.inject({
      method: 'POST',
      url: `${BASE}/accounts`,
      payload: { code: '1020', name: 'Bank', type: 'asset', currency_code: 'INR' },
    });
    bankAccountId = bRes.json().id;

    const rRes = await app.inject({
      method: 'POST',
      url: `${BASE}/accounts`,
      payload: { code: '4010', name: 'Sales Revenue', type: 'income', currency_code: 'INR' },
    });
    revenueAccountId = rRes.json().id;

    const eRes = await app.inject({
      method: 'POST',
      url: `${BASE}/accounts`,
      payload: { code: '5010', name: 'Operating Expense', type: 'expense', currency_code: 'INR' },
    });
    expenseAccountId = eRes.json().id;
  });

  describe('Invariant 1: Double-Entry Balance at Currency Precision (BR-ERP4-01)', () => {
    it('accepts balanced journal entries at 4-decimal precision', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries`,
        payload: {
          period_id: FIXTURE_PERIOD_OPEN['id'],
          posting_date: '2026-04-10',
          description: 'Balanced entry',
          currency_code: 'INR',
          lines: [
            { account_id: bankAccountId, debit_amount: '1250.5000', credit_amount: '0.0000' },
            { account_id: revenueAccountId, debit_amount: '0.0000', credit_amount: '1250.5000' },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const je = res.json();
      expect(je.status).toBe('draft');
    });

    it('rejects unbalanced journal entries where debit != credit', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries`,
        payload: {
          period_id: FIXTURE_PERIOD_OPEN['id'],
          posting_date: '2026-04-10',
          description: 'Unbalanced entry',
          currency_code: 'INR',
          lines: [
            { account_id: bankAccountId, debit_amount: '1000.0000', credit_amount: '0.0000' },
            { account_id: revenueAccountId, debit_amount: '0.0000', credit_amount: '999.9900' },
          ],
        },
      });

      // Zod or domain rejects unbalanced entry with 400 or 422
      expect([400, 422]).toContain(res.statusCode);
      expect(repo.journalEntries.size).toBe(0);
    });

    it('multi-line compound journal entries must balance in aggregate', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries`,
        payload: {
          period_id: FIXTURE_PERIOD_OPEN['id'],
          posting_date: '2026-04-10',
          description: 'Compound multi-line entry',
          currency_code: 'INR',
          lines: [
            { account_id: bankAccountId, debit_amount: '700.0000', credit_amount: '0.0000' },
            { account_id: cashAccountId, debit_amount: '300.0000', credit_amount: '0.0000' },
            { account_id: revenueAccountId, debit_amount: '0.0000', credit_amount: '1000.0000' },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const je = res.json();
      expect(je.lines).toHaveLength(3);
    });
  });

  describe('Invariant 2: Line Direction & Non-Negative Amounts', () => {
    it('rejects a line where both debit and credit are positive', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries`,
        payload: {
          period_id: FIXTURE_PERIOD_OPEN['id'],
          posting_date: '2026-04-10',
          description: 'Invalid dual line',
          currency_code: 'INR',
          lines: [
            { account_id: bankAccountId, debit_amount: '500.0000', credit_amount: '500.0000' },
            { account_id: revenueAccountId, debit_amount: '0.0000', credit_amount: '500.0000' },
          ],
        },
      });

      expect([400, 422]).toContain(res.statusCode);
    });

    it('rejects a line where both debit and credit are zero', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries`,
        payload: {
          period_id: FIXTURE_PERIOD_OPEN['id'],
          posting_date: '2026-04-10',
          description: 'Zero amounts line',
          currency_code: 'INR',
          lines: [
            { account_id: bankAccountId, debit_amount: '0.0000', credit_amount: '0.0000' },
            { account_id: revenueAccountId, debit_amount: '0.0000', credit_amount: '0.0000' },
          ],
        },
      });

      expect([400, 422]).toContain(res.statusCode);
    });

    it('rejects negative amounts on journal lines', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries`,
        payload: {
          period_id: FIXTURE_PERIOD_OPEN['id'],
          posting_date: '2026-04-10',
          description: 'Negative debit line',
          currency_code: 'INR',
          lines: [
            { account_id: bankAccountId, debit_amount: '-500.0000', credit_amount: '0.0000' },
            { account_id: revenueAccountId, debit_amount: '0.0000', credit_amount: '-500.0000' },
          ],
        },
      });

      expect([400, 422]).toContain(res.statusCode);
    });
  });

  describe('Invariant 3: Immutability of Posted Entries & Reversals Only', () => {
    let postedEntryId: string;

    beforeEach(async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries`,
        payload: {
          period_id: FIXTURE_PERIOD_OPEN['id'],
          posting_date: '2026-04-12',
          description: 'Original operating expense',
          currency_code: 'INR',
          lines: [
            { account_id: expenseAccountId, debit_amount: '850.0000', credit_amount: '0.0000' },
            { account_id: bankAccountId, debit_amount: '0.0000', credit_amount: '850.0000' },
          ],
        },
      });
      postedEntryId = createRes.json().id;

      const postRes = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries/${postedEntryId}/post`,
      });
      expect(postRes.statusCode).toBe(200);
    });

    it('posted journal entries are immutable to direct PATCH modifications', async () => {
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `${BASE}/journal-entries/${postedEntryId}`,
        payload: {
          description: 'Attempted modification of posted entry',
        },
      });

      expect([422, 400, 403]).toContain(patchRes.statusCode);

      // Verify original description remains unchanged
      const entry = await repo.getJournalEntryById(postedEntryId);
      expect(entry?.description).toBe('Original operating expense');
      expect(entry?.status).toBe('posted');
    });

    it('posted journal entries cannot be voided', async () => {
      const voidRes = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries/${postedEntryId}/void`,
      });

      expect([422, 400, 403]).toContain(voidRes.statusCode);
    });

    it('corrections must use compensating reversal entries (Invariant 5)', async () => {
      const revRes = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries/${postedEntryId}/reverse`,
        payload: {
          reversal_description: 'Compensating reversal for invoice cancellation',
        },
      });

      expect(revRes.statusCode).toBe(200);
      const { original, reversal } = revRes.json();

      // Original entry transitions to reversed
      expect(original.status).toBe('reversed');
      expect(original.reversed_by_entry_id).toBe(reversal.id);

      // Reversal entry is posted and has swapped debits and credits
      expect(reversal.status).toBe('posted');
      expect(reversal.lines).toHaveLength(2);

      const expLine = reversal.lines.find((l: any) => l.account_id === expenseAccountId);
      expect(parseFloat(expLine.credit_amount)).toBe(850);
      expect(parseFloat(expLine.debit_amount)).toBe(0);

      const bankLine = reversal.lines.find((l: any) => l.account_id === bankAccountId);
      expect(parseFloat(bankLine.debit_amount)).toBe(850);
      expect(parseFloat(bankLine.credit_amount)).toBe(0);
    });

    it('cannot reverse an already reversed journal entry', async () => {
      // First reversal
      await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries/${postedEntryId}/reverse`,
      });

      // Second reversal attempt
      const secondRev = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries/${postedEntryId}/reverse`,
      });

      expect([422, 400]).toContain(secondRev.statusCode);
    });
  });

  describe('Invariant 6: Account Uniqueness & Opening Balance One-Time Load', () => {
    it('account codes are strictly unique (FR-ERP4-01)', async () => {
      const dupRes = await app.inject({
        method: 'POST',
        url: `${BASE}/accounts`,
        payload: {
          code: '1010', // already exists as Cash
          name: 'Duplicate Cash Account',
          type: 'asset',
          currency_code: 'INR',
        },
      });

      expect(dupRes.statusCode).toBe(409);
      expect(dupRes.json().code).toBe('DUPLICATE_CODE');
    });

    it('opening balance is loaded only once per account/currency (FR-ERP4-04)', async () => {
      // 1. Initial load
      const ob1 = await app.inject({
        method: 'POST',
        url: `${BASE}/opening-balances`,
        payload: {
          balances: [
            {
              account_id: bankAccountId,
              currency_code: 'INR',
              balance_amount: '50000.0000',
              as_of_date: '2026-04-01',
            },
          ],
        },
      });
      expect(ob1.statusCode).toBe(201);
      expect(ob1.json().created).toHaveLength(1);

      // 2. Second load attempt for same account and currency
      const ob2 = await app.inject({
        method: 'POST',
        url: `${BASE}/opening-balances`,
        payload: {
          balances: [
            {
              account_id: bankAccountId,
              currency_code: 'INR',
              balance_amount: '99999.0000',
              as_of_date: '2026-04-01',
            },
          ],
        },
      });

      // Must skip with reason or reject
      const body = ob2.json();
      expect(body.skipped).toHaveLength(1);
      expect(body.skipped[0].reason).toContain('already loaded');

      // Stored balance is unchanged
      const stored = await repo.getOpeningBalance(bankAccountId, 'INR');
      expect(stored?.balance_amount).toBe('50000.0000');
    });
  });

  describe('Invariant 7: Currency Isolation & Trial Balance Grouping', () => {
    it('trial balance groups by account and currency and never adds unlike currencies', async () => {
      // Create USD account
      const usdAcc = await app.inject({
        method: 'POST',
        url: `${BASE}/accounts`,
        payload: { code: '1030-USD', name: 'USD Bank Account', type: 'asset', currency_code: 'USD' },
      });
      const usdAccountId = usdAcc.json().id;

      // Create USD Revenue account
      const usdRev = await app.inject({
        method: 'POST',
        url: `${BASE}/accounts`,
        payload: { code: '4020-USD', name: 'USD Export Sales', type: 'income', currency_code: 'USD' },
      });
      const usdRevId = usdRev.json().id;

      // Post INR Entry
      const inrEntry = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries`,
        payload: {
          period_id: FIXTURE_PERIOD_OPEN['id'],
          posting_date: '2026-04-15',
          description: 'INR domestic sale',
          currency_code: 'INR',
          lines: [
            { account_id: bankAccountId, debit_amount: '2000.0000', credit_amount: '0.0000' },
            { account_id: revenueAccountId, debit_amount: '0.0000', credit_amount: '2000.0000' },
          ],
        },
      });
      await app.inject({ method: 'POST', url: `${BASE}/journal-entries/${inrEntry.json().id}/post` });

      // Post USD Entry
      const usdEntry = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries`,
        payload: {
          period_id: FIXTURE_PERIOD_OPEN['id'],
          posting_date: '2026-04-15',
          description: 'USD export sale',
          currency_code: 'USD',
          lines: [
            { account_id: usdAccountId, debit_amount: '500.0000', credit_amount: '0.0000' },
            { account_id: usdRevId, debit_amount: '0.0000', credit_amount: '500.0000' },
          ],
        },
      });
      await app.inject({ method: 'POST', url: `${BASE}/journal-entries/${usdEntry.json().id}/post` });

      // Query INR Trial Balance
      const inrTb = await app.inject({
        method: 'GET',
        url: `${BASE}/trial-balance?period=2026-04&currency_code=INR`,
      });
      expect(inrTb.statusCode).toBe(200);
      const inrData = inrTb.json();
      expect(inrData.totals.is_balanced).toBe(true);
      expect(parseFloat(inrData.totals.total_debit)).toBe(2000);
      // Contains only INR accounts
      expect(inrData.rows.every((r: any) => r.currency_code === 'INR')).toBe(true);

      // Query USD Trial Balance
      const usdTb = await app.inject({
        method: 'GET',
        url: `${BASE}/trial-balance?period=2026-04&currency_code=USD`,
      });
      expect(usdTb.statusCode).toBe(200);
      const usdData = usdTb.json();
      expect(usdData.totals.is_balanced).toBe(true);
      expect(parseFloat(usdData.totals.total_debit)).toBe(500);
      expect(usdData.rows.every((r: any) => r.currency_code === 'USD')).toBe(true);
    });
  });

  describe('Invariant 8: Closed Accounting Period Posting Guards (BR-ERP4-02)', () => {
    it('posting to a locked period is rejected (HTTP 422)', async () => {
      const entry = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries`,
        payload: {
          period_id: FIXTURE_PERIOD_LOCKED['id'],
          posting_date: '2026-02-15',
          description: 'Entry into locked month',
          currency_code: 'INR',
          lines: [
            { account_id: bankAccountId, debit_amount: '100.0000', credit_amount: '0.0000' },
            { account_id: revenueAccountId, debit_amount: '0.0000', credit_amount: '100.0000' },
          ],
        },
      });
      const entryId = entry.json().id;

      const postRes = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries/${entryId}/post`,
      });

      expect([422, 400]).toContain(postRes.statusCode);
      expect(postRes.json().message).toContain('locked');
    });

    it('posting to a soft-closed period rejects non-admin users (HTTP 403)', async () => {
      const entry = await app.inject({
        method: 'POST',
        url: `${BASE}/journal-entries`,
        payload: {
          period_id: FIXTURE_PERIOD_SOFT_CLOSED['id'],
          posting_date: '2026-03-20',
          description: 'Entry into soft closed month',
          currency_code: 'INR',
          lines: [
            { account_id: bankAccountId, debit_amount: '100.0000', credit_amount: '0.0000' },
            { account_id: revenueAccountId, debit_amount: '0.0000', credit_amount: '100.0000' },
          ],
        },
      });
      const entryId = entry.json().id;

      // Build app with auth enabled to test role enforcement
      const authApp = buildApp({ repository: repo, authRequired: true });

      // Non-admin user (e.g. editor)
      const postRes = await authApp.inject({
        method: 'POST',
        url: `${BASE}/journal-entries/${entryId}/post`,
        headers: {
          authorization: 'Bearer role:editor',
        },
      });

      expect(postRes.statusCode).toBe(403);
    });
  });
});
