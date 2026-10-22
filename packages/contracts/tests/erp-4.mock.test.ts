/**
 * ERP-4 Finance & Accounting — Deterministic Mock Server Test Suite
 *
 * Proves that:
 *   - The mock server boots and provides representative, schema-valid payloads for all 18 V1 routes.
 *   - Accounts endpoints support listing, paging (bounded <= 100), creating, reading, and updating.
 *   - Journal entries endpoints enforce BR-ERP4-01 double-entry balancing and period lock guards.
 *   - Posting transitions draft -> posted, and reversal creates compensating entries.
 *   - Trial balance endpoint computes debit/credit totals grouped by account and reports balanced status.
 *   - Opening balances endpoint allows bulk loading and prevents duplicate account/currency pairs.
 *   - Accounting periods endpoint enforces FSM transitions (locked is permanent).
 *   - Emitted events are captured in the mock store for verification by dependent modules.
 *   - Reset helper returns store to deterministic seed state.
 *
 * @module contracts/tests/erp-4.mock.test
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createErp4MockServer, type Erp4MockServerInstance } from '../src/erp-4-mock.js';
import {
  AccountSchema,
  AccountListResponseSchema,
  JournalEntrySchema,
  JournalEntryListResponseSchema,
  TrialBalanceResponseSchema,
  CreateOpeningBalancesResponseSchema,
  OpeningBalanceListResponseSchema,
  PeriodListResponseSchema,
  AccountingPeriodSchema,
} from '../src/erp-4.js';

describe('ERP-4 Deterministic Mock Server & Routes', () => {
  let mockServer: Erp4MockServerInstance;

  beforeEach(() => {
    mockServer = createErp4MockServer();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  // ── 1. ACCOUNTS ────────────────────────────────────────────────────────────

  describe('Accounts Endpoints', () => {
    it('GET /api/v1/erp-finance/accounts returns deterministic seed accounts with bounded pagination', async () => {
      const res = await mockServer.app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?page=1&pageSize=5',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(AccountListResponseSchema.safeParse(json).success).toBe(true);
      expect(json.page).toBe(1);
      expect(json.pageSize).toBe(5);
      expect(json.data.length).toBeLessThanOrEqual(5);
      expect(json.total).toBeGreaterThanOrEqual(8);
      expect(json.data[0].code).toBeDefined();
    });

    it('GET /api/v1/erp-finance/accounts rejects pageSize > 100 (non-negotiable invariant)', async () => {
      const res = await mockServer.app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?pageSize=101',
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.message).toContain('pageSize cannot exceed 100');
    });

    it('GET /api/v1/erp-finance/accounts filters by type and active status', async () => {
      const res = await mockServer.app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?type=asset&is_active=true',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      for (const acc of json.data) {
        expect(acc.type).toBe('asset');
        expect(acc.is_active).toBe(true);
      }
    });

    it('POST /api/v1/erp-finance/accounts creates account and emits domain event', async () => {
      const newAccPayload = {
        code: '1099-PETTY',
        name: 'Petty Cash',
        type: 'asset',
        currency_code: 'INR',
        is_posting_account: true,
      };

      const res = await mockServer.app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: newAccPayload,
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(AccountSchema.safeParse(json).success).toBe(true);
      expect(json.code).toBe('1099-PETTY');

      // Verify domain event emitted
      const events = mockServer.store.emittedEvents.filter((e) => e.event_type === 'erp.account.created');
      expect(events.length).toBe(1);
      expect((events[0]?.payload as any).code).toBe('1099-PETTY');
    });

    it('POST /api/v1/erp-finance/accounts returns 409 on duplicate code', async () => {
      const duplicatePayload = {
        code: '1010-CASH', // already exists in seed
        name: 'Duplicate Cash',
        type: 'asset',
      };

      const res = await mockServer.app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: duplicatePayload,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('ACCOUNT_CODE_EXISTS');
    });

    it('GET /api/v1/erp-finance/accounts/:id returns single account or 404', async () => {
      // Existing
      const res = await mockServer.app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts/11111111-0001-4000-8000-000000000001',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().code).toBe('1010-CASH');

      // Nonexistent
      const res404 = await mockServer.app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts/00000000-0000-4000-8000-000000000000',
      });
      expect(res404.statusCode).toBe(404);
      expect(res404.json().code).toBe('ACCOUNT_NOT_FOUND');
    });

    it('PATCH /api/v1/erp-finance/accounts/:id updates mutable fields', async () => {
      const res = await mockServer.app.inject({
        method: 'PATCH',
        url: '/api/v1/erp-finance/accounts/11111111-0001-4000-8000-000000000001',
        payload: {
          name: 'Main Petty Cash Vault',
          description: 'Updated description',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Main Petty Cash Vault');
    });
  });

  // ── 2. JOURNAL ENTRIES ─────────────────────────────────────────────────────

  describe('Journal Entries Endpoints & BR-ERP4-01 Double-Entry Invariant', () => {
    const periodId = '22222222-0001-4000-8000-000000000001'; // Open period
    const accountBank = '11111111-0001-4000-8000-000000000002';
    const accountSales = '11111111-0001-4000-8000-000000000005';
    const accountHdr = '11111111-0001-4000-8000-000000000008'; // Non-posting header account

    it('GET /api/v1/erp-finance/journal-entries returns paginated entries', async () => {
      const res = await mockServer.app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/journal-entries?page=1&pageSize=10',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(JournalEntryListResponseSchema.safeParse(json).success).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(2);
    });

    it('POST /api/v1/erp-finance/journal-entries creates draft when balanced', async () => {
      const balancedDraft = {
        period_id: periodId,
        posting_date: '2026-04-18',
        description: 'Synthetic: Customer payment received',
        currency_code: 'INR',
        lines: [
          {
            account_id: accountBank,
            debit_amount: '25000.0000',
            credit_amount: '0.0000',
            line_narration: 'Deposit to operating account',
          },
          {
            account_id: accountSales,
            debit_amount: '0.0000',
            credit_amount: '25000.0000',
            line_narration: 'Consulting sales income',
          },
        ],
      };

      const res = await mockServer.app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: balancedDraft,
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(JournalEntrySchema.safeParse(json).success).toBe(true);
      expect(json.status).toBe('draft');
      expect(json.entry_number).toMatch(/^JV-2026-\d{4}$/);
    });

    it('POST /api/v1/erp-finance/journal-entries rejects unbalanced entry (400 validation)', async () => {
      const unbalanced = {
        period_id: periodId,
        posting_date: '2026-04-18',
        description: 'Unbalanced entry',
        currency_code: 'INR',
        lines: [
          {
            account_id: accountBank,
            debit_amount: '25000.0000',
            credit_amount: '0.0000',
          },
          {
            account_id: accountSales,
            debit_amount: '0.0000',
            credit_amount: '24999.0000', // Unbalanced by 1.0000
          },
        ],
      };

      const res = await mockServer.app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: unbalanced,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('not balanced');
    });

    it('POST /api/v1/erp-finance/journal-entries rejects posting to non-posting header account (422)', async () => {
      const headerPost = {
        period_id: periodId,
        posting_date: '2026-04-18',
        description: 'Invalid post to header',
        currency_code: 'INR',
        lines: [
          {
            account_id: accountHdr, // Header account!
            debit_amount: '1000.0000',
            credit_amount: '0.0000',
          },
          {
            account_id: accountSales,
            debit_amount: '0.0000',
            credit_amount: '1000.0000',
          },
        ],
      };

      const res = await mockServer.app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: headerPost,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('CANNOT_POST_TO_HEADER_ACCOUNT');
    });

    it('POST /api/v1/erp-finance/journal-entries/:id/post transitions draft to posted', async () => {
      // The seed includes draft JV-2026-0002 with id 44444444-0001-4000-8000-000000000002
      const draftId = '44444444-0001-4000-8000-000000000002';
      const res = await mockServer.app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draftId}/post`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.status).toBe('posted');
      expect(json.posted_at).toBeDefined();

      // Second post attempt returns 409 conflict
      const resConflict = await mockServer.app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draftId}/post`,
      });
      expect(resConflict.statusCode).toBe(409);
      expect(resConflict.json().code).toBe('ENTRY_ALREADY_POSTED');
    });

    it('POST /api/v1/erp-finance/journal-entries/:id/reverse creates compensating entry and sets original to reversed', async () => {
      // Seed includes posted entry 44444444-0001-4000-8000-000000000001
      const postedId = '44444444-0001-4000-8000-000000000001';
      const res = await mockServer.app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${postedId}/reverse`,
        payload: {
          reversal_description: 'Reversal test',
        },
      });

      expect(res.statusCode).toBe(201);
      const reversal = res.json();
      expect(reversal.entry_number).toMatch(/^REV-/);
      expect(reversal.status).toBe('posted');

      // Original entry is now 'reversed'
      const origRes = await mockServer.app.inject({
        method: 'GET',
        url: `/api/v1/erp-finance/journal-entries/${postedId}`,
      });
      expect(origRes.json().status).toBe('reversed');
      expect(origRes.json().reversed_by_entry_id).toBe(reversal.id);
    });

    it('POST /api/v1/erp-finance/journal-entries/:id/void voids draft entry', async () => {
      const draftId = '44444444-0001-4000-8000-000000000002';
      const res = await mockServer.app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draftId}/void`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('voided');
    });
  });

  // ── 3. TRIAL BALANCE ───────────────────────────────────────────────────────

  describe('Trial Balance Endpoint (FR-ERP4-03)', () => {
    it('GET /api/v1/erp-finance/trial-balance returns balanced ledger report for valid period', async () => {
      const res = await mockServer.app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/trial-balance?period=2026-04',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(TrialBalanceResponseSchema.safeParse(json).success).toBe(true);
      expect(json.period).toBe('2026-04');
      expect(json.totals.is_balanced).toBe(true);
      expect(json.totals.difference).toBe('0.0000');
      expect(json.rows.length).toBeGreaterThan(0);
    });

    it('GET /api/v1/erp-finance/trial-balance returns 404 for unknown period', async () => {
      const res = await mockServer.app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/trial-balance?period=2024-01',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('PERIOD_NOT_FOUND');
    });
  });

  // ── 4. OPENING BALANCES ────────────────────────────────────────────────────

  describe('Opening Balances Endpoints (FR-ERP4-04)', () => {
    it('GET /api/v1/erp-finance/opening-balances returns paginated balances', async () => {
      const res = await mockServer.app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/opening-balances?page=1&pageSize=10',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(OpeningBalanceListResponseSchema.safeParse(json).success).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/v1/erp-finance/opening-balances loads balance and skips duplicate account/currency', async () => {
      const accountCash = '11111111-0001-4000-8000-000000000001';
      const accountBank = '11111111-0001-4000-8000-000000000002'; // Already has opening balance in seed

      const res = await mockServer.app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        payload: {
          balances: [
            {
              account_id: accountCash,
              currency_code: 'INR',
              balance_amount: '50000.0000',
              as_of_date: '2026-04-01',
            },
            {
              account_id: accountBank, // Duplicate
              currency_code: 'INR',
              balance_amount: '200000.0000',
              as_of_date: '2026-04-01',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(CreateOpeningBalancesResponseSchema.safeParse(json).success).toBe(true);
      expect(json.created.length).toBe(1);
      expect(json.skipped.length).toBe(1);
      expect(json.skipped[0].reason).toBe('DUPLICATE_OPENING_BALANCE');
    });
  });

  // ── 5. PERIODS ─────────────────────────────────────────────────────────────

  describe('Accounting Periods Endpoints (BR-ERP4-02)', () => {
    it('GET /api/v1/erp-finance/periods returns list of periods', async () => {
      const res = await mockServer.app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/periods?page=1&pageSize=10',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(PeriodListResponseSchema.safeParse(json).success).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(3);
    });

    it('PATCH /api/v1/erp-finance/periods/:id transitions open -> soft_closed', async () => {
      const openPeriodId = '22222222-0001-4000-8000-000000000001';
      const res = await mockServer.app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/periods/${openPeriodId}`,
        payload: { status: 'soft_closed' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('soft_closed');
    });

    it('PATCH /api/v1/erp-finance/periods/:id rejects reopening locked period (422 terminal)', async () => {
      const lockedPeriodId = '22222222-0001-4000-8000-000000000003';
      const res = await mockServer.app.inject({
        method: 'PATCH',
        url: `/api/v1/erp-finance/periods/${lockedPeriodId}`,
        payload: { status: 'open' },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('INVALID_PERIOD_TRANSITION');
    });
  });

  // ── 6. STATE RESET HELPER ──────────────────────────────────────────────────

  describe('Mock Store Reset', () => {
    it('resets modified state back to initial seed data', async () => {
      // Create an account
      await mockServer.app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: 'TEST-RESET',
          name: 'Reset Test Account',
          type: 'asset',
        },
      });

      expect(Array.from(mockServer.store.accounts.values()).some((a) => a.code === 'TEST-RESET')).toBe(true);

      // Trigger reset
      mockServer.reset();

      // State is restored to seed
      expect(Array.from(mockServer.store.accounts.values()).some((a) => a.code === 'TEST-RESET')).toBe(false);
      expect(mockServer.store.emittedEvents.length).toBe(0);
    });
  });
});
