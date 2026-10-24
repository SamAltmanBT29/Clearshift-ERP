/**
 * ERP-4 Finance & Accounting — Scripted Demo Journey E2E Test Suite
 *
 * Runs the full 5-minute V1 demo workflow in-process using Fastify injection:
 *   0:00 Seed execution & reset determinism (public API only)
 *   1:00 Chart of Accounts query and new account creation with code validation
 *   2:00 One-time opening balance load (FR-ERP4-04) & duplicate load rejection
 *   3:00 Draft journal entry creation, line validation & debit=credit balance (BR-ERP4-01)
 *   3:45 Posting journal entry & locked/closed period guard (BR-ERP4-02)
 *   4:30 Trial balance query asserting balanced books and draft exclusion
 *   5:00 Compensating reversal creation & net-zero audit trail
 *
 * @module erp4/tests/e2e/demo-journey
 */

import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { InMemoryFinanceRepository } from '../../src/services/repository.js';
import {
  FIXTURE_PERIOD_OPEN,
  FIXTURE_PERIOD_SOFT_CLOSED,
  FIXTURE_PERIOD_LOCKED,
} from '../../fixtures/index.js';
import { runSeed, type PostFn } from '../../../../../../sample-data/erp-4/seed.js';

describe('ERP-4 Scripted Demo Journey (In-Process E2E)', () => {
  it('executes full 5-minute V1 demo journey successfully', async () => {
    const repo = new InMemoryFinanceRepository(false);
    repo.periods.set(String(FIXTURE_PERIOD_OPEN.id), FIXTURE_PERIOD_OPEN as any);
    repo.periods.set(String(FIXTURE_PERIOD_SOFT_CLOSED.id), FIXTURE_PERIOD_SOFT_CLOSED as any);
    repo.periods.set(String(FIXTURE_PERIOD_LOCKED.id), FIXTURE_PERIOD_LOCKED as any);

    const app = buildApp({ repository: repo, authRequired: false });
    await app.ready();

    // ── 0:00 Seed Execution & Reset Determinism ──────────────────────────────
    const post: PostFn = async (method, path, body) => {
      const res = await app.inject({
        method,
        url: path,
        payload: body,
      });
      return {
        status: res.statusCode,
        body: res.json() as Record<string, unknown>,
      };
    };

    const seedResult = await runSeed(post);
    expect(seedResult.accountIds.length).toBe(8);
    expect(seedResult.journalEntryIds.length).toBe(4);
    expect(seedResult.replayed).toBe(false);

    // Replay seed to prove idempotency
    const replayResult = await runSeed(post);
    expect(replayResult.replayed).toBe(true);

    // ── 1:00 Chart of Accounts Query & Creation ──────────────────────────────
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/erp-finance/accounts?type=asset',
    });
    expect(listRes.statusCode).toBe(200);
    const assetAccounts = listRes.json();
    expect(assetAccounts.total).toBeGreaterThanOrEqual(2);
    const accountsList = assetAccounts.data ?? assetAccounts.accounts ?? assetAccounts.items ?? [];
    const cashAcc = accountsList.find((a: any) => a.code === '1010-CASH');
    expect(cashAcc).toBeDefined();

    // Create a new account
    const createAccRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-finance/accounts',
      payload: {
        code: '1090-PETTY-CASH',
        name: 'Petty Cash Float',
        type: 'asset',
        currency_code: 'INR',
        is_active: true,
      },
    });
    expect(createAccRes.statusCode).toBe(201);
    const newAccount = createAccRes.json();
    expect(newAccount.code).toBe('1090-PETTY-CASH');

    // Duplicate account code rejected (FR-ERP4-01)
    const dupAccRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-finance/accounts',
      payload: {
        code: '1090-PETTY-CASH',
        name: 'Duplicate Petty Cash',
        type: 'asset',
        currency_code: 'INR',
      },
    });
    expect(dupAccRes.statusCode).toBe(409);
    expect(dupAccRes.json().code).toBe('DUPLICATE_CODE');

    // ── 2:00 One-time Opening Balance Load (FR-ERP4-04) ──────────────────────
    const openBalRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-finance/opening-balances',
      payload: {
        batch_id: 'b4000000-0000-4000-8000-000000000099',
        balances: [
          {
            account_id: newAccount.id,
            currency_code: 'INR',
            balance_amount: '500.0000',
            as_of_date: '2026-04-01',
            source_reference: 'DEMO-OPENING-01',
          },
        ],
      },
    });
    expect(openBalRes.statusCode).toBe(201);

    // Duplicate opening balance for same account & currency is reported in skipped (FR-ERP4-04)
    const dupOpenBalRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-finance/opening-balances',
      payload: {
        batch_id: 'b4000000-0000-4000-8000-000000000099',
        balances: [
          {
            account_id: newAccount.id,
            currency_code: 'INR',
            balance_amount: '300.0000',
            as_of_date: '2026-04-01',
          },
        ],
      },
    });
    expect(dupOpenBalRes.statusCode).toBe(201);
    const dupOpenBalBody = dupOpenBalRes.json();
    expect(dupOpenBalBody.created).toHaveLength(0);
    expect(dupOpenBalBody.skipped).toHaveLength(1);
    expect(dupOpenBalBody.skipped[0].reason).toContain('Opening balance already loaded');

    // ── 3:00 Draft Journal Entry Creation & Line Balance (BR-ERP4-01) ────────
    // Unbalanced entry rejected
    const unbalRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-finance/journal-entries',
      payload: {
        period_id: FIXTURE_PERIOD_OPEN.id,
        posting_date: '2026-04-15',
        currency_code: 'INR',
        description: 'Unbalanced Demo Entry',
        lines: [
          { account_id: newAccount.id, debit_amount: '100.0000', credit_amount: '0.0000' },
          { account_id: cashAcc.id, debit_amount: '0.0000', credit_amount: '80.0000' },
        ],
      },
    });
    expect(unbalRes.statusCode).toBe(400);
    expect(unbalRes.json().code).toBe('VALIDATION_ERROR');
    expect(unbalRes.json().message).toContain('Journal entry is not balanced');

    // Valid balanced entry created as draft
    const jeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-finance/journal-entries',
      payload: {
        period_id: FIXTURE_PERIOD_OPEN.id,
        posting_date: '2026-04-15',
        currency_code: 'INR',
        description: 'Petty cash replenishment from main cash',
        lines: [
          { account_id: newAccount.id, debit_amount: '150.0000', credit_amount: '0.0000' },
          { account_id: cashAcc.id, debit_amount: '0.0000', credit_amount: '150.0000' },
        ],
      },
    });
    expect(jeRes.statusCode).toBe(201);
    const draftJe = jeRes.json();
    expect(draftJe.status).toBe('draft');

    // ── 3:45 Posting Journal Entry & Period Guard (BR-ERP4-02) ───────────────
    // Creating draft in locked period succeeds, but POSTING is rejected
    const lockedJeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/erp-finance/journal-entries',
      payload: {
        period_id: FIXTURE_PERIOD_LOCKED.id, // Locked period
        posting_date: '2026-03-20',
        currency_code: 'INR',
        description: 'Posting to locked period',
        lines: [
          { account_id: newAccount.id, debit_amount: '50.0000', credit_amount: '0.0000' },
          { account_id: cashAcc.id, debit_amount: '0.0000', credit_amount: '50.0000' },
        ],
      },
    });
    expect(lockedJeRes.statusCode).toBe(201);
    const lockedDraftJe = lockedJeRes.json();

    // Posting into locked period MUST be rejected with HTTP 422 PERIOD_LOCKED
    const lockedPostRes = await app.inject({
      method: 'POST',
      url: `/api/v1/erp-finance/journal-entries/${lockedDraftJe.id}/post`,
    });
    expect(lockedPostRes.statusCode).toBe(422);
    expect(lockedPostRes.json().code).toBe('PERIOD_LOCKED');

    // Post the valid draft entry
    const postRes = await app.inject({
      method: 'POST',
      url: `/api/v1/erp-finance/journal-entries/${draftJe.id}/post`,
    });
    expect(postRes.statusCode).toBe(200);
    const postedJe = postRes.json();
    expect(postedJe.status).toBe('posted');
    expect(postedJe.posted_at).toBeDefined();

    // Posted entry cannot be modified
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/erp-finance/journal-entries/${draftJe.id}`,
      payload: {
        description: 'Attempt to mutate posted entry',
      },
    });
    expect(patchRes.statusCode).toBe(422);
    expect(patchRes.json().code).toBe('ENTRY_IMMUTABLE');

    // ── 4:30 Trial Balance View ──────────────────────────────────────────────
    const tbRes = await app.inject({
      method: 'GET',
      url: '/api/v1/erp-finance/trial-balance?period=2026-04',
    });
    expect(tbRes.statusCode).toBe(200);
    const tb = tbRes.json();
    expect(tb.totals.is_balanced).toBe(true);
    expect(tb.totals.difference).toBe('0.0000');
    expect(tb.totals.total_debit).toBe(tb.totals.total_credit);

    // ── 5:00 Compensating Reversal Entry (BR-ERP4-01) ────────────────────────
    const revRes = await app.inject({
      method: 'POST',
      url: `/api/v1/erp-finance/journal-entries/${draftJe.id}/reverse`,
      payload: {
        reversal_reason: 'Correction of erroneous replenishment',
      },
    });
    expect(revRes.statusCode).toBe(200);
    const revBody = revRes.json();
    expect(revBody.original.status).toBe('reversed');
    expect(revBody.original.reversed_by_entry_id).toBe(revBody.reversal.id);
    expect(revBody.reversal.status).toBe('posted');

    // Verify trial balance remains balanced after reversal
    const postRevTbRes = await app.inject({
      method: 'GET',
      url: '/api/v1/erp-finance/trial-balance?period=2026-04',
    });
    expect(postRevTbRes.statusCode).toBe(200);
    const postRevTb = postRevTbRes.json();
    expect(postRevTb.totals.is_balanced).toBe(true);
    expect(postRevTb.totals.difference).toBe('0.0000');

    await app.close();
  });
});
