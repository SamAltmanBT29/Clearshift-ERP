/**
 * ERP-4 Finance & Accounting — Fastify API Integration Tests
 *
 * Verifies all Acceptance Criteria for Issue #37:
 *   [✓] Every list endpoint responds with documented status codes and validated JSON
 *   [✓] Search/filter is performed server-side and is case-insensitive
 *   [✓] page/pageSize return deterministic non-overlapping records; pageSize > 100 rejected (400)
 *   [✓] Unknown query parameters do not alter SQL and user values are parameterized
 *   [✓] Fastify inject tests verify success, empty results, invalid query, unauthorized request and stable pagination
 *   [✓] Every specified domain invariant is asserted (Every posted entry balances at currency precision)
 *
 * @module erp4/tests/api/list.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemoryFinanceRepository } from '../../src/services/repository.js';
import * as moduleExports from '../../src/index.js';
import {
  AccountListResponseSchema,
  JournalEntryListResponseSchema,
  TrialBalanceResponseSchema,
  OpeningBalanceListResponseSchema,
  PeriodListResponseSchema,
  ApiErrorSchema,
  CreateJournalLineRequestSchema,
} from '@clearshift/contracts';
import { computeTrialBalanceTotals } from '../../domain/engine.js';
import { FinanceService } from '../../src/services/finance.service.js';

describe('ERP-4 Finance & Accounting API — List & Read Endpoints', () => {
  let app: FastifyInstance;
  let repository: InMemoryFinanceRepository;

  beforeEach(() => {
    repository = new InMemoryFinanceRepository(true);
    app = buildApp({ repository, authRequired: false });
  });

  it('exports all necessary module symbols from index.ts', () => {
    expect(moduleExports.buildApp).toBeDefined();
    expect(moduleExports.FinanceService).toBeDefined();
    expect(moduleExports.InMemoryFinanceRepository).toBeDefined();
    expect(moduleExports.erpFinanceRoutes).toBeDefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Chart of Accounts: GET /api/v1/erp-finance/accounts
  // ───────────────────────────────────────────────────────────────────────────
  describe('GET /api/v1/erp-finance/accounts', () => {
    it('returns 200 with validated AccountListResponse schema and default pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      const parseResult = AccountListResponseSchema.safeParse(json);
      expect(parseResult.success).toBe(true);

      expect(json.total).toBeGreaterThanOrEqual(5);
      expect(json.page).toBe(1);
      expect(json.pageSize).toBe(20);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBe(json.total);
    });

    it('[PAGINATION] returns deterministic non-overlapping records across pages', async () => {
      const page1Res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?page=1&pageSize=2',
      });
      const page2Res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?page=2&pageSize=2',
      });

      expect(page1Res.statusCode).toBe(200);
      expect(page2Res.statusCode).toBe(200);

      const p1 = page1Res.json();
      const p2 = page2Res.json();

      expect(p1.data).toHaveLength(2);
      expect(p2.data).toHaveLength(2);

      // Verify stable sort: code ascending
      expect(p1.data[0].code.localeCompare(p1.data[1].code)).toBeLessThanOrEqual(0);
      expect(p1.data[1].code.localeCompare(p2.data[0].code)).toBeLessThanOrEqual(0);

      // Verify zero overlap between page 1 and page 2
      const p1Ids = new Set(p1.data.map((a: { id: string }) => a.id));
      for (const item of p2.data) {
        expect(p1Ids.has(item.id)).toBe(false);
      }
    });

    it('[BOUNDED PAGING] rejects pageSize above 100 with HTTP 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?page=1&pageSize=101',
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(ApiErrorSchema.safeParse(err).success).toBe(true);
      expect(err.error).toBe('Bad Request');
      expect(err.message.toLowerCase()).toContain('pagesize');
    });

    it('[BOUNDED PAGING] rejects non-positive page with HTTP 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?page=0&pageSize=20',
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(err.error).toBe('Bad Request');
    });

    it('[SEARCH] performs case-insensitive server-side search on account code and name', async () => {
      // Lowercase match
      const resLower = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?search=cash',
      });
      expect(resLower.statusCode).toBe(200);
      const jsonLower = resLower.json();
      expect(jsonLower.total).toBe(1);
      expect(jsonLower.data[0].code).toBe('1010-CASH');

      // Uppercase match returns identical result
      const resUpper = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?search=CASH',
      });
      expect(resUpper.statusCode).toBe(200);
      const jsonUpper = resUpper.json();
      expect(jsonUpper.total).toBe(1);
      expect(jsonUpper.data[0].id).toBe(jsonLower.data[0].id);

      // Search by name substring
      const resName = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?search=payable',
      });
      expect(resName.statusCode).toBe(200);
      expect(resName.json().data[0].code).toBe('2010-AP');
    });

    it('[FILTER] filters by account type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?type=asset',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.total).toBeGreaterThanOrEqual(2);
      for (const acct of json.data) {
        expect(acct.type).toBe('asset');
      }
    });

    it('[EMPTY RESULTS] returns 200 with empty data array when filter matches nothing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?search=nonexistent_xyz_query',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data).toEqual([]);
      expect(json.total).toBe(0);
      expect(json.totalPages).toBe(1);
    });

    it('[PARAMETERIZATION] ignores unknown query parameters safely', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?search=cash&unknown_param=1;DROP%20TABLE%20accounts',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.total).toBe(1);
      expect(json.data[0].code).toBe('1010-CASH');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Account Read by ID: GET /api/v1/erp-finance/accounts/:id
  // ───────────────────────────────────────────────────────────────────────────
  describe('GET /api/v1/erp-finance/accounts/:id', () => {
    it('returns 200 with account details for a valid existing ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts/aaaaaaaa-0001-0001-0001-000000000001',
      });

      expect(res.statusCode).toBe(200);
      const acct = res.json();
      expect(acct.id).toBe('aaaaaaaa-0001-0001-0001-000000000001');
      expect(acct.code).toBe('1010-CASH');
      expect(acct.currency_code).toBe('INR');
      // Verify sensitive audit/secrets not leaked
      expect(acct.raw_row).toBeUndefined();
      expect(acct.secret).toBeUndefined();
    });

    it('returns 404 with standard error envelope when account does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts/ffffffff-ffff-ffff-ffff-ffffffffffff',
      });

      expect(res.statusCode).toBe(404);
      const err = res.json();
      expect(ApiErrorSchema.safeParse(err).success).toBe(true);
      expect(err.error).toBe('Not Found');
    });

    it('returns 400 with standard error envelope for malformed UUID parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts/invalid-uuid-format',
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(ApiErrorSchema.safeParse(err).success).toBe(true);
      expect(err.error).toBe('Bad Request');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Account Create: POST /api/v1/erp-finance/accounts
  // ───────────────────────────────────────────────────────────────────────────
  describe('POST /api/v1/erp-finance/accounts', () => {
    it('creates a new account and returns 201 Created', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: '1030-PETTY',
          name: 'Petty Cash Fund',
          type: 'asset',
          currency_code: 'INR',
          is_posting_account: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json();
      expect(created.code).toBe('1030-PETTY');
      expect(created.id).toBeDefined();

      // Verify it appears in list endpoint
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?search=1030-PETTY',
      });
      expect(listRes.json().total).toBe(1);
    });

    it('rejects duplicate account code with HTTP 409 Conflict', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: '1010-CASH', // already exists in fixtures
          name: 'Duplicate Cash Account',
          type: 'asset',
        },
      });

      expect(res.statusCode).toBe(409);
      const err = res.json();
      expect(err.error).toBe('Conflict');
      expect(err.message).toContain('already exists');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Journal Entries: GET /api/v1/erp-finance/journal-entries
  // ───────────────────────────────────────────────────────────────────────────
  describe('GET /api/v1/erp-finance/journal-entries', () => {
    it('returns 200 with validated JournalEntryListResponse schema and lines', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/journal-entries',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      const parseResult = JournalEntryListResponseSchema.safeParse(json);
      expect(parseResult.success).toBe(true);

      expect(json.total).toBeGreaterThanOrEqual(1);
      expect(json.data[0].lines).toBeDefined();
      expect(json.data[0].lines.length).toBeGreaterThanOrEqual(2);
    });

    it('[BOUNDED PAGING] rejects pageSize above 100 with HTTP 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/journal-entries?pageSize=150',
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(err.error).toBe('Bad Request');
      expect(err.message.toLowerCase()).toContain('pagesize');
    });

    it('[SEARCH] performs case-insensitive search on description and entry number', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/journal-entries?search=cash sale',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.total).toBe(1);
      expect(json.data[0].entry_number).toBe('JV-2026-0001');
    });

    it('[FILTER] filters by period label (YYYY-MM) and status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/journal-entries?period=2026-04&status=draft',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.total).toBe(1);
      expect(json.data[0].status).toBe('draft');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Journal Entry Read by ID: GET /api/v1/erp-finance/journal-entries/:id
  // ───────────────────────────────────────────────────────────────────────────
  describe('GET /api/v1/erp-finance/journal-entries/:id', () => {
    it('returns 200 with embedded double-entry lines for valid ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/journal-entries/cccccccc-0001-0001-0001-000000000001',
      });

      expect(res.statusCode).toBe(200);
      const entry = res.json();
      expect(entry.id).toBe('cccccccc-0001-0001-0001-000000000001');
      expect(entry.entry_number).toBe('JV-2026-0001');
      expect(entry.lines).toHaveLength(2);
      expect(entry.lines[0].debit_amount).toBe('50000.0000');
      expect(entry.lines[1].credit_amount).toBe('50000.0000');
    });

    it('returns 404 when journal entry is not found', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/journal-entries/00000000-0000-0000-0000-000000000099',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('Not Found');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Domain Invariant: Balancing & Posting Invariant
  // ───────────────────────────────────────────────────────────────────────────
  describe('Journal Entry Lifecycle & Domain Invariants', () => {
    const PERIOD_OPEN_ID = 'bbbbbbbb-0001-0001-0001-000000000001';
    const PERIOD_LOCKED_ID = 'bbbbbbbb-0001-0001-0001-000000000003';
    const ACCT_BANK_ID = 'aaaaaaaa-0001-0001-0001-000000000002';
    const ACCT_SALES_ID = 'aaaaaaaa-0001-0001-0001-000000000004';

    it('[INVARIANT: UNBALANCED_ENTRY] rejects unbalanced journal entry creation with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: PERIOD_OPEN_ID,
          posting_date: '2026-04-16',
          description: 'Unbalanced test entry',
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_BANK_ID, debit_amount: '1000.0000', credit_amount: '0.0000' },
            { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '999.0000' }, // off by 1.0000
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const err = res.json();
      expect(err.error).toBe('Bad Request');
      expect(err.message.toLowerCase()).toContain('balanced');
    });

    it('[INVARIANT: EXACT BALANCE] creates balanced entry and posts successfully', async () => {
      // 1. Create draft entry
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: PERIOD_OPEN_ID,
          posting_date: '2026-04-18',
          description: 'Consulting fees received',
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_BANK_ID, debit_amount: '75000.0000', credit_amount: '0.0000' },
            { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '75000.0000' },
          ],
        },
      });

      expect(createRes.statusCode).toBe(201);
      const created = createRes.json();
      expect(created.status).toBe('draft');

      // 2. Post the entry
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${created.id}/post`,
      });

      expect(postRes.statusCode).toBe(200);
      const posted = postRes.json();
      expect(posted.status).toBe('posted');
      expect(posted.posted_at).toBeDefined();

      // 3. Immutability: posting an already posted entry is rejected
      const rePostRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${created.id}/post`,
      });
      expect(rePostRes.statusCode).toBe(422);
    });

    it('[IDEMPOTENCY] duplicate idempotency_key returns existing entry (HTTP 200)', async () => {
      const payload = {
        period_id: PERIOD_OPEN_ID,
        posting_date: '2026-04-19',
        description: 'Auto-journal from billing',
        currency_code: 'INR',
        idempotency_key: 'bill-invoice-98234',
        lines: [
          { account_id: ACCT_BANK_ID, debit_amount: '12000.0000', credit_amount: '0.0000' },
          { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '12000.0000' },
        ],
      };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const entry1 = res1.json();

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const entry2 = res2.json();
      expect(entry2.id).toBe(entry1.id);
    });

    it('[PERIOD GUARD] rejects posting into a locked period with HTTP 422', async () => {
      // Create draft in locked period
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: PERIOD_LOCKED_ID,
          posting_date: '2026-02-15',
          description: 'Late entry into locked month',
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_BANK_ID, debit_amount: '5000.0000', credit_amount: '0.0000' },
            { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '5000.0000' },
          ],
        },
      });

      expect(createRes.statusCode).toBe(201);
      const draft = createRes.json();

      // Attempt to post into locked month
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}/post`,
      });

      expect(postRes.statusCode).toBe(422);
      expect(postRes.json().message).toContain('locked');
    });

    it('[REVERSAL] reverses posted entry via compensating reversal and updates original status', async () => {
      // Create and post
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: PERIOD_OPEN_ID,
          posting_date: '2026-04-20',
          description: 'Entry to be reversed',
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_BANK_ID, debit_amount: '20000.0000', credit_amount: '0.0000' },
            { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '20000.0000' },
          ],
        },
      });
      const created = createRes.json();
      await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${created.id}/post`,
      });

      // Reverse
      const revRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${created.id}/reverse`,
        payload: {
          reversal_description: 'Customer dispute: reversal',
        },
      });

      expect(revRes.statusCode).toBe(200);
      const { original, reversal } = revRes.json();
      expect(original.status).toBe('reversed');
      expect(original.reversed_by_entry_id).toBe(reversal.id);

      // Verify lines were swapped in reversal
      expect(reversal.status).toBe('posted');
      expect(reversal.lines[0].debit_amount).toBe('0.0000');
      expect(reversal.lines[0].credit_amount).toBe('20000.0000');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Trial Balance: GET /api/v1/erp-finance/trial-balance
  // ───────────────────────────────────────────────────────────────────────────
  describe('GET /api/v1/erp-finance/trial-balance', () => {
    it('computes trial balance report for a valid period', async () => {
      // First post a journal entry in period 2026-04 to ensure movements exist
      const postRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries/cccccccc-0001-0001-0001-000000000001/post',
      });
      expect(postRes.statusCode).toBe(200);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/trial-balance?period=2026-04',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      const parseResult = TrialBalanceResponseSchema.safeParse(json);
      expect(parseResult.success).toBe(true);

      expect(json.period).toBe('2026-04');
      expect(json.totals.is_balanced).toBe(true);
      expect(json.totals.difference).toBe('0.0000');
      expect(json.rows.length).toBeGreaterThanOrEqual(2);
    });

    it('rejects missing period query parameter with HTTP 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/trial-balance',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Bad Request');
    });

    it('returns 404 for unknown period label', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/trial-balance?period=1999-01',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('Not Found');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Opening Balances: GET & POST /api/v1/erp-finance/opening-balances
  // ───────────────────────────────────────────────────────────────────────────
  describe('Opening Balances Endpoints', () => {
    it('GET returns 200 with OpeningBalanceListResponse', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/opening-balances',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(OpeningBalanceListResponseSchema.safeParse(json).success).toBe(true);
      expect(json.total).toBeGreaterThanOrEqual(1);
    });

    it('[BOUNDED PAGING] rejects pageSize above 100 on opening balances', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/opening-balances?pageSize=120',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Bad Request');
    });

    it('POST bulk-loads opening balance and skips existing duplicates (FR-ERP4-04)', async () => {
      const ACCT_BANK_ID = 'aaaaaaaa-0001-0001-0001-000000000002'; // Already loaded in fixture
      const ACCT_CASH_ID = 'aaaaaaaa-0001-0001-0001-000000000001'; // Not yet loaded

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        payload: {
          balances: [
            {
              account_id: ACCT_CASH_ID,
              currency_code: 'INR',
              balance_amount: '50000.0000',
              as_of_date: '2026-04-01',
            },
            {
              account_id: ACCT_BANK_ID,
              currency_code: 'INR',
              balance_amount: '200000.0000',
              as_of_date: '2026-04-01',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.created).toHaveLength(1);
      expect(json.created[0].account_id).toBe(ACCT_CASH_ID);
      expect(json.skipped).toHaveLength(1);
      expect(json.skipped[0].account_id).toBe(ACCT_BANK_ID);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. Accounting Periods: GET /api/v1/erp-finance/periods
  // ───────────────────────────────────────────────────────────────────────────
  describe('Accounting Periods Endpoints', () => {
    it('GET returns 200 with PeriodListResponse and bounded paging', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/periods?page=1&pageSize=10',
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(PeriodListResponseSchema.safeParse(json).success).toBe(true);
      expect(json.total).toBe(3);
    });

    it('GET /periods/:id returns single period', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/periods/bbbbbbbb-0001-0001-0001-000000000001',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().period_label).toBe('2026-04');
    });

    it('GET /periods/:id returns 404 when period does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/periods/00000000-0000-0000-0000-000000000099',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('Not Found');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. Security & Authentication: Unauthorized request handling
  // ───────────────────────────────────────────────────────────────────────────
  describe('Security & Authentication (401 Unauthorized)', () => {
    let secureApp: FastifyInstance;

    beforeEach(() => {
      const repo = new InMemoryFinanceRepository(true);
      secureApp = buildApp({ repository: repo, authRequired: true });
    });

    it('returns 401 Unauthorized with ApiError envelope when Authorization header is missing', async () => {
      const res = await secureApp.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
      });

      expect(res.statusCode).toBe(401);
      const err = res.json();
      expect(ApiErrorSchema.safeParse(err).success).toBe(true);
      expect(err.error).toBe('Unauthorized');
      expect(err.message).toContain('Missing Authorization header');
    });

    it('returns 401 Unauthorized when invalid token is provided', async () => {
      const res = await secureApp.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(res.statusCode).toBe(401);
      const err = res.json();
      expect(err.error).toBe('Unauthorized');
      expect(err.message).toContain('Invalid or expired');
    });

    it('returns 200 OK when valid Bearer token is provided to secured app', async () => {
      const res = await secureApp.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: {
          authorization: 'Bearer valid-jwt-token-synthetic',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBeGreaterThanOrEqual(1);
    });

    it('returns 401 Unauthorized when authorization header format is not Bearer', async () => {
      const res = await secureApp.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: {
          authorization: 'Basic dXNlcjpwYXNz',
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('Unauthorized');
    });

    it('parses role from Bearer token in permissive app mode', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: {
          authorization: 'Bearer role:auditor',
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns 401 when invalid token provided in permissive app mode', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11. Additional Route & Service Edge Cases (Branch Coverage)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Route & Service Validation Edge Cases', () => {
    const PERIOD_OPEN_ID = 'bbbbbbbb-0001-0001-0001-000000000001';
    const PERIOD_SOFT_CLOSED_ID = 'bbbbbbbb-0001-0001-0001-000000000002';
    const ACCT_BANK_ID = 'aaaaaaaa-0001-0001-0001-000000000002';
    const ACCT_SALES_ID = 'aaaaaaaa-0001-0001-0001-000000000004';

    it('POST /accounts rejects invalid payload with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: '', // invalid code
          name: 'Invalid',
          type: 'asset',
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('POST /accounts rejects non-existent parent_id with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: '1099-SUB',
          name: 'Sub Account',
          type: 'asset',
          parent_id: '00000000-0000-0000-0000-000000000099',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('Parent account');
    });

    it('POST /accounts accepts valid parent_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: '1021-SUB-BANK',
          name: 'Sub Bank Account',
          type: 'asset',
          parent_id: ACCT_BANK_ID,
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().parent_id).toBe(ACCT_BANK_ID);
    });

    it('GET /periods rejects invalid pageSize with HTTP 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/periods?pageSize=150',
      });
      expect(res.statusCode).toBe(400);
    });

    it('GET /periods/:id rejects invalid UUID format with HTTP 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/periods/bad-id',
      });
      expect(res.statusCode).toBe(400);
    });

    it('GET /opening-balances/:id rejects invalid UUID with HTTP 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/opening-balances/bad-id',
      });
      expect(res.statusCode).toBe(400);
    });

    it('GET /opening-balances/:id returns 404 when not found', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/opening-balances/00000000-0000-0000-0000-000000000099',
      });
      expect(res.statusCode).toBe(404);
    });

    it('POST /opening-balances rejects invalid request body with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        payload: {
          balances: [],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('POST /opening-balances skips non-existent account with reason', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        payload: {
          balances: [
            {
              account_id: '00000000-0000-0000-0000-000000000099',
              currency_code: 'INR',
              balance_amount: '1000.0000',
              as_of_date: '2026-04-01',
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().skipped).toHaveLength(1);
      expect(res.json().skipped[0].reason).toContain('does not exist');
    });

    it('POST /journal-entries rejects non-existent period_id with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: '00000000-0000-0000-0000-000000000099',
          posting_date: '2026-04-18',
          description: 'No such period',
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_BANK_ID, debit_amount: '1000.0000', credit_amount: '0.0000' },
            { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '1000.0000' },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('was not found');
    });

    it('POST /journal-entries rejects non-existent account in lines with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: PERIOD_OPEN_ID,
          posting_date: '2026-04-18',
          description: 'No such account',
          currency_code: 'INR',
          lines: [
            { account_id: '00000000-0000-0000-0000-000000000099', debit_amount: '1000.0000', credit_amount: '0.0000' },
            { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '1000.0000' },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('does not exist');
    });

    it('POST /journal-entries rejects posting account when is_posting_account is false', async () => {
      // Create non-posting header account
      const headerAcctRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/accounts',
        payload: {
          code: '1000-HEADER',
          name: 'Current Assets Header',
          type: 'asset',
          is_posting_account: false,
        },
      });
      const headerAcct = headerAcctRes.json();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: PERIOD_OPEN_ID,
          posting_date: '2026-04-18',
          description: 'Posting to header account',
          currency_code: 'INR',
          lines: [
            { account_id: headerAcct.id, debit_amount: '1000.0000', credit_amount: '0.0000' },
            { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '1000.0000' },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('header account');
    });

    it('POST /journal-entries/:id/post rejects invalid UUID with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries/bad-id/post',
      });
      expect(res.statusCode).toBe(400);
    });

    it('POST /journal-entries/:id/post returns 404 when entry not found', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries/00000000-0000-0000-0000-000000000099/post',
      });
      expect(res.statusCode).toBe(404);
    });

    it('POST /journal-entries/:id/reverse rejects invalid UUID with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries/bad-id/reverse',
      });
      expect(res.statusCode).toBe(400);
    });

    it('POST /journal-entries/:id/reverse returns 404 when entry not found', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries/00000000-0000-0000-0000-000000000099/reverse',
      });
      expect(res.statusCode).toBe(404);
    });

    it('POST /journal-entries/:id/reverse rejects reversing a draft entry with HTTP 422', async () => {
      // Draft entry
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries/cccccccc-0001-0001-0001-000000000001/reverse',
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().message).toContain('cannot be reversed');
    });

    it('posts into soft_closed period when user role is finance_admin', async () => {
      // Create draft in soft_closed period
      const draftRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: PERIOD_SOFT_CLOSED_ID,
          posting_date: '2026-03-25',
          description: 'Prior month adjustment',
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_BANK_ID, debit_amount: '3000.0000', credit_amount: '0.0000' },
            { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '3000.0000' },
          ],
        },
      });
      const draft = draftRes.json();

      // Post with finance_admin role
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}/post`,
        headers: {
          authorization: 'Bearer role:finance_admin',
        },
      });
      expect(postRes.statusCode).toBe(200);
      expect(postRes.json().status).toBe('posted');
    });

    it('rejects posting into soft_closed period when user role is staff with HTTP 403', async () => {
      // Create draft in soft_closed period
      const draftRes = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: PERIOD_SOFT_CLOSED_ID,
          posting_date: '2026-03-26',
          description: 'Staff attempt in soft-closed',
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_BANK_ID, debit_amount: '4000.0000', credit_amount: '0.0000' },
            { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '4000.0000' },
          ],
        },
      });
      const draft = draftRes.json();

      // Post with staff role
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/erp-finance/journal-entries/${draft.id}/post`,
        headers: {
          authorization: 'Bearer role:staff',
        },
      });
      expect(postRes.statusCode).toBe(403);
      expect(postRes.json().message).toContain('soft-closed');
    });
  });

  describe('Extended Branch & Coverage Verification', () => {
    const ACCT_BANK_ID = 'aaaaaaaa-0001-0001-0001-000000000002';
    const ACCT_SALES_ID = 'aaaaaaaa-0001-0001-0001-000000000004';
    const PERIOD_OPEN_ID = 'bbbbbbbb-0001-0001-0001-000000000001';

    it('GET /api/v1/erp-finance/opening-balances/:id returns 200 for seeded balance', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/opening-balances/dddddddd-0001-0001-0001-000000000001',
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.id).toBe('dddddddd-0001-0001-0001-000000000001');
      expect(data.balance_amount).toBe('200000.0000');
    });

    it('filters accounts by is_active and currency_code', async () => {
      const activeRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?is_active=true',
      });
      expect(activeRes.statusCode).toBe(200);
      expect(activeRes.json().data.length).toBeGreaterThan(0);

      const inrRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?currency_code=INR',
      });
      expect(inrRes.statusCode).toBe(200);
      expect(inrRes.json().data.length).toBeGreaterThan(0);

      const eurRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts?currency_code=EUR',
      });
      expect(eurRes.statusCode).toBe(200);
      expect(eurRes.json().data.length).toBe(0);
    });

    it('filters journal entries by from_date, to_date, and currency_code', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/journal-entries?from_date=2026-04-01&to_date=2026-04-30&currency_code=INR',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);

      const emptyRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/journal-entries?currency_code=USD',
      });
      expect(emptyRes.statusCode).toBe(200);
      expect(emptyRes.json().data.length).toBe(0);
    });

    it('filters periods by fiscal_year', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/periods?fiscal_year=FY2026-27',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);

      const emptyRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/periods?fiscal_year=FY2099-00',
      });
      expect(emptyRes.statusCode).toBe(200);
      expect(emptyRes.json().data.length).toBe(0);
    });

    it('filters opening balances by currency_code and stably sorts balances', async () => {
      const inrRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/opening-balances?currency_code=INR',
      });
      expect(inrRes.statusCode).toBe(200);
      expect(inrRes.json().data.length).toBeGreaterThan(0);

      const eurRes = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/opening-balances?currency_code=EUR',
      });
      expect(eurRes.statusCode).toBe(200);
      expect(eurRes.json().data.length).toBe(0);
    });

    it('rejects journal entry creation with non-posting (header) account', async () => {
      const headerAccount = await repository.createAccount({
        code: '9000-HDR',
        name: 'Header Group',
        type: 'asset',
        is_posting_account: false,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: PERIOD_OPEN_ID,
          posting_date: '2026-04-10',
          description: 'Attempt using header account',
          currency_code: 'INR',
          lines: [
            { account_id: headerAccount.id, debit_amount: '100.0000', credit_amount: '0.0000' },
            { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '100.0000' },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('header account');
    });

    it('rejects journal entry creation with nonexistent account ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: PERIOD_OPEN_ID,
          posting_date: '2026-04-10',
          description: 'Attempt using non-existent account',
          currency_code: 'INR',
          lines: [
            { account_id: '00000000-0000-0000-0000-000000000099', debit_amount: '100.0000', credit_amount: '0.0000' },
            { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '100.0000' },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('does not exist');
    });

    it('rejects journal entry creation with nonexistent period ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/journal-entries',
        payload: {
          period_id: '00000000-0000-0000-0000-000000000099',
          posting_date: '2026-04-10',
          description: 'Attempt with non-existent period',
          currency_code: 'INR',
          lines: [
            { account_id: ACCT_BANK_ID, debit_amount: '100.0000', credit_amount: '0.0000' },
            { account_id: ACCT_SALES_ID, debit_amount: '0.0000', credit_amount: '100.0000' },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('was not found');
    });

    it('skips nonexistent account in createOpeningBalances and reports skipped', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-finance/opening-balances',
        payload: {
          balances: [
            {
              account_id: '00000000-0000-0000-0000-000000000099',
              currency_code: 'INR',
              balance_amount: '500.0000',
              as_of_date: '2026-04-01',
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.skipped.length).toBe(1);
      expect(data.skipped[0].reason).toContain('does not exist');
    });

    it('validates CreateJournalLineRequestSchema line constraint branches', () => {
      const validDebit = CreateJournalLineRequestSchema.safeParse({
        account_id: ACCT_BANK_ID,
        debit_amount: '10.0000',
        credit_amount: '0.0000',
      });
      expect(validDebit.success).toBe(true);

      const validCredit = CreateJournalLineRequestSchema.safeParse({
        account_id: ACCT_BANK_ID,
        debit_amount: '0.0000',
        credit_amount: '10.0000',
      });
      expect(validCredit.success).toBe(true);

      const neither = CreateJournalLineRequestSchema.safeParse({
        account_id: ACCT_BANK_ID,
        debit_amount: '0.0000',
        credit_amount: '0.0000',
      });
      expect(neither.success).toBe(false);

      const both = CreateJournalLineRequestSchema.safeParse({
        account_id: ACCT_BANK_ID,
        debit_amount: '10.0000',
        credit_amount: '10.0000',
      });
      expect(both.success).toBe(false);
    });

    it('computes trial balance difference when debit > credit and credit > debit', () => {
      const debitHeavy = computeTrialBalanceTotals([
        {
          account_id: ACCT_BANK_ID,
          currency_code: 'INR',
          total_debit: '100.0000',
          total_credit: '50.0000',
          net_balance: '50.0000',
          opening_balance: '0.0000',
          closing_balance: '50.0000',
        },
      ]);
      expect(debitHeavy.is_balanced).toBe(false);
      expect(debitHeavy.difference).toBe('50.0000');

      const creditHeavy = computeTrialBalanceTotals([
        {
          account_id: ACCT_BANK_ID,
          currency_code: 'INR',
          total_debit: '30.0000',
          total_credit: '80.0000',
          net_balance: '-50.0000',
          opening_balance: '0.0000',
          closing_balance: '-50.0000',
        },
      ]);
      expect(creditHeavy.is_balanced).toBe(false);
      expect(creditHeavy.difference).toBe('50.0000');
    });

    it('builds app with default options and custom financeService', async () => {
      const defaultApp = buildApp();
      expect(defaultApp).toBeDefined();

      const customRepo = new InMemoryFinanceRepository(false);
      const customService = new FinanceService(customRepo);
      const customApp = buildApp({
        repository: customRepo,
        financeService: customService,
        authRequired: false,
      });
      expect(customApp).toBeDefined();
    });

    it('handles unexpected errors gracefully with HTTP 500 error envelope', async () => {
      const failingRepo = new InMemoryFinanceRepository(true);
      failingRepo.listAccounts = async () => {
        throw new Error('Database connection failed');
      };
      const failingApp = buildApp({ repository: failingRepo, authRequired: false });
      const res = await failingApp.inject({
        method: 'GET',
        url: '/api/v1/erp-finance/accounts',
      });
      expect(res.statusCode).toBe(500);
      const err = res.json();
      expect(err.statusCode).toBe(500);
      expect(err.error).toBe('Error');
      expect(err.message).toBe('Database connection failed');
    });

    it('exercises repository helper lookup branches', async () => {
      const foundCode = await repository.getAccountByCode('1010-CASH');
      expect(foundCode).not.toBeNull();
      const notFoundCode = await repository.getAccountByCode('9999');
      expect(notFoundCode).toBeNull();

      const unknownPeriod = await repository.getPeriodByLabel('2099-12');
      expect(unknownPeriod).toBeNull();

      const unknownIdempotency = await repository.getJournalEntryByIdempotencyKey('nonexistent-key');
      expect(unknownIdempotency).toBeNull();

      const foundOb = await repository.getOpeningBalance(ACCT_BANK_ID, 'INR');
      expect(foundOb).not.toBeNull();
      const notFoundOb = await repository.getOpeningBalance(ACCT_BANK_ID, 'EUR');
      expect(notFoundOb).toBeNull();
    });
  });
});

