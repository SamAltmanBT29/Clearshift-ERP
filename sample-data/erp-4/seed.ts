/**
 * ERP-4 Finance & Accounting — Deterministic Seed / Reset Helper (Synthetic Data Only)
 *
 * Writes ONLY through the public API (/api/v1/erp-finance/*), never directly to private tables.
 * Deterministic: fixed batch id, fixed account codes, fixed idempotency keys.
 * Re-running is idempotent and safe (replays return HTTP 200/201 with the same IDs without duplication).
 *
 * CLI usage (against a running API):
 *   ERP4_BASE_URL=http://localhost:3000 [ERP4_AUTH_TOKEN=...] node sample-data/erp-4/seed.ts
 *
 * In-process usage (e.g. Vitest):
 *   import { runSeed } from './seed.js';
 *   await runSeed(postFn);
 *
 * @module sample-data/erp-4/seed
 */

export const SEED_BATCH_ID = 'b4000000-0000-4000-8000-000000000001';
export const SEED_PERIOD_ID = 'bbbbbbbb-0001-0001-0001-000000000001'; // 2026-04 Open period

export interface SeedAccountDef {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'income' | 'expense';
  currency_code: string;
  description: string;
  is_posting_account: boolean;
}

export const SEED_ACCOUNTS: readonly SeedAccountDef[] = [
  {
    code: '1010-CASH',
    name: 'Petty Cash Fund',
    type: 'asset',
    currency_code: 'INR',
    description: 'Operating petty cash float for minor office disbursements',
    is_posting_account: true,
  },
  {
    code: '1020-BANK',
    name: 'Main Operating Bank Account',
    type: 'asset',
    currency_code: 'INR',
    description: 'Primary corporate treasury current account at State Bank',
    is_posting_account: true,
  },
  {
    code: '1200-AR',
    name: 'Trade Accounts Receivable',
    type: 'asset',
    currency_code: 'INR',
    description: 'Customer invoices awaiting settlement',
    is_posting_account: true,
  },
  {
    code: '2010-AP',
    name: 'Trade Accounts Payable',
    type: 'liability',
    currency_code: 'INR',
    description: 'Outstanding liabilities owed to trade suppliers',
    is_posting_account: true,
  },
  {
    code: '3010-RETAINED',
    name: 'Retained Earnings',
    type: 'liability',
    currency_code: 'INR',
    description: 'Cumulative prior years undistributed net earnings',
    is_posting_account: true,
  },
  {
    code: '4010-SALES',
    name: 'Product & Service Sales Revenue',
    type: 'income',
    currency_code: 'INR',
    description: 'Gross operating revenues generated from commercial activities',
    is_posting_account: true,
  },
  {
    code: '5010-COGS',
    name: 'Cost of Goods Sold',
    type: 'expense',
    currency_code: 'INR',
    description: 'Direct procurement and production expense for delivered products',
    is_posting_account: true,
  },
  {
    code: '6010-OPERATING',
    name: 'General & Administrative Expenses',
    type: 'expense',
    currency_code: 'INR',
    description: 'General operational overheads including utilities and facilities',
    is_posting_account: true,
  },
] as const;

export interface SeedOpeningBalanceDef {
  accountCode: string;
  currency_code: string;
  balance_amount: string;
  as_of_date: string;
}

export const SEED_OPENING_BALANCES: readonly SeedOpeningBalanceDef[] = [
  {
    accountCode: '1020-BANK',
    currency_code: 'INR',
    balance_amount: '100000.0000',
    as_of_date: '2026-04-01',
  },
  {
    accountCode: '1010-CASH',
    currency_code: 'INR',
    balance_amount: '25000.0000',
    as_of_date: '2026-04-01',
  },
  {
    accountCode: '2010-AP',
    currency_code: 'INR',
    balance_amount: '-45000.0000',
    as_of_date: '2026-04-01',
  },
  {
    accountCode: '3010-RETAINED',
    currency_code: 'INR',
    balance_amount: '-80000.0000',
    as_of_date: '2026-04-01',
  },
] as const;

export interface SeedJournalLineDef {
  accountCode: string;
  debit_amount: string;
  credit_amount: string;
  line_narration: string;
}

export interface SeedJournalEntryDef {
  idempotency_key: string;
  posting_date: string;
  description: string;
  currency_code: string;
  source_reference: string;
  finalStatus: 'draft' | 'posted' | 'reversed';
  lines: SeedJournalLineDef[];
}

export const SEED_JOURNAL_ENTRIES: readonly SeedJournalEntryDef[] = [
  {
    idempotency_key: 'erp4-seed-je-001',
    posting_date: '2026-04-05',
    description: 'Cash collection from sales revenue invoice #INV-2026-001',
    currency_code: 'INR',
    source_reference: 'INV-2026-001',
    finalStatus: 'posted',
    lines: [
      {
        accountCode: '1020-BANK',
        debit_amount: '15000.0000',
        credit_amount: '0.0000',
        line_narration: 'Receipt into main bank current account',
      },
      {
        accountCode: '4010-SALES',
        debit_amount: '0.0000',
        credit_amount: '15000.0000',
        line_narration: 'Sales revenue recognition',
      },
    ],
  },
  {
    idempotency_key: 'erp4-seed-je-002',
    posting_date: '2026-04-10',
    description: 'Settlement of office electricity and internet utility invoice',
    currency_code: 'INR',
    source_reference: 'UTIL-2026-04',
    finalStatus: 'posted',
    lines: [
      {
        accountCode: '6010-OPERATING',
        debit_amount: '4500.0000',
        credit_amount: '0.0000',
        line_narration: 'Electricity and broadband expense',
      },
      {
        accountCode: '1020-BANK',
        debit_amount: '0.0000',
        credit_amount: '4500.0000',
        line_narration: 'Disbursement from main bank account',
      },
    ],
  },
  {
    idempotency_key: 'erp4-seed-je-003',
    posting_date: '2026-04-15',
    description: 'Supplier raw material delivery accrual under PO-2026-044',
    currency_code: 'INR',
    source_reference: 'PO-2026-044',
    finalStatus: 'draft',
    lines: [
      {
        accountCode: '5010-COGS',
        debit_amount: '8200.0000',
        credit_amount: '0.0000',
        line_narration: 'Direct materials cost accrual',
      },
      {
        accountCode: '2010-AP',
        debit_amount: '0.0000',
        credit_amount: '8200.0000',
        line_narration: 'Supplier liability accrual pending voucher',
      },
    ],
  },
  {
    idempotency_key: 'erp4-seed-je-004',
    posting_date: '2026-04-18',
    description: 'Duplicate petty cash courier expense (reversed via compensating entry)',
    currency_code: 'INR',
    source_reference: 'COURIER-ERR-01',
    finalStatus: 'reversed',
    lines: [
      {
        accountCode: '6010-OPERATING',
        debit_amount: '1200.0000',
        credit_amount: '0.0000',
        line_narration: 'Erroneous duplicate courier charge',
      },
      {
        accountCode: '1010-CASH',
        debit_amount: '0.0000',
        credit_amount: '1200.0000',
        line_narration: 'Petty cash disbursement',
      },
    ],
  },
] as const;

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

export type PostFn = (
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: Record<string, unknown>
) => Promise<ApiResponse>;

export interface SeedResult {
  accountIds: string[];
  openingBalanceIds: string[];
  journalEntryIds: string[];
  /** true when all entities were already present and replayed */
  replayed: boolean;
}

const BASE = '/api/v1/erp-finance';

function expectOk(res: ApiResponse, what: string): void {
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Seed step failed (${what}): HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export async function runSeed(post: PostFn): Promise<SeedResult> {
  const accountIds: string[] = [];
  const accountIdByCode = new Map<string, string>();
  const openingBalanceIds: string[] = [];
  const journalEntryIds: string[] = [];
  let anyNewEntityCreated = false;

  // 1. Resolve active period ID (fallback to SEED_PERIOD_ID if needed)
  let periodId = SEED_PERIOD_ID;
  const periodsRes = await post('GET', `${BASE}/periods?period_label=2026-04`);
  if (periodsRes.status === 200) {
    const pBody = periodsRes.body as { data?: Array<{ id: string; period_label: string }> };
    const found = pBody.data?.find((p) => p.period_label === '2026-04');
    if (found?.id) {
      periodId = found.id;
    }
  }

  // 2. Seed Accounts
  for (let i = 0; i < SEED_ACCOUNTS.length; i++) {
    const acct = SEED_ACCOUNTS[i]!;
    const idempotencyKey = `erp4-seed-acct-${acct.code}`;

    const res = await post('POST', `${BASE}/accounts`, {
      code: acct.code,
      name: acct.name,
      type: acct.type,
      currency_code: acct.currency_code,
      description: acct.description,
      is_posting_account: acct.is_posting_account,
      batch_id: SEED_BATCH_ID,
      source_row: i + 1,
      idempotency_key: idempotencyKey,
    });

    let id = '';
    if (res.status === 201) {
      anyNewEntityCreated = true;
      id = String(res.body['id']);
    } else if (res.status === 200) {
      id = String(res.body['id']);
    } else if (res.status === 409) {
      // Pre-existing account from fixture; query by search
      const listRes = await post('GET', `${BASE}/accounts?search=${acct.code}`);
      const listBody = listRes.body as { data?: Array<{ id: string; code: string }> };
      const existing = listBody.data?.find((a) => a.code.toUpperCase() === acct.code.toUpperCase());
      if (existing?.id) {
        id = existing.id;
      } else {
        expectOk(res, `account ${acct.code}`);
      }
    } else {
      expectOk(res, `account ${acct.code}`);
    }

    accountIds.push(id);
    accountIdByCode.set(acct.code, id);
  }

  // 3. Seed Opening Balances (bulk load via POST /opening-balances)
  const balancesPayload = SEED_OPENING_BALANCES.map((ob, idx) => {
    const acctId = accountIdByCode.get(ob.accountCode);
    if (!acctId) {
      throw new Error(`Account code ${ob.accountCode} missing when seeding opening balance`);
    }
    return {
      account_id: acctId,
      currency_code: ob.currency_code,
      balance_amount: ob.balance_amount,
      as_of_date: ob.as_of_date,
      source_row: idx + 1,
      source_reference: `OPENING-BAL-SEED-${idx + 1}`,
      idempotency_key: `erp4-seed-ob-${ob.accountCode}`,
      batch_id: SEED_BATCH_ID,
    };
  });

  const obRes = await post('POST', `${BASE}/opening-balances`, {
    batch_id: SEED_BATCH_ID,
    idempotency_key: 'erp4-seed-opening-balances-batch',
    balances: balancesPayload,
  });

  if (obRes.status === 201) {
    const body = obRes.body as {
      created?: Array<{ id: string }>;
      skipped?: Array<{ reason: string }>;
    };
    if (body.created && body.created.length > 0) {
      for (const b of body.created) {
        openingBalanceIds.push(b.id);
      }
    }
    // If some were skipped because already loaded, query them
    if (body.skipped && body.skipped.length > 0) {
      const listRes = await post('GET', `${BASE}/opening-balances`);
      if (listRes.status === 200) {
        const bList = listRes.body as { data?: Array<{ id: string }> };
        if (Array.isArray(bList.data)) {
          for (const b of bList.data) {
            if (!openingBalanceIds.includes(b.id)) {
              openingBalanceIds.push(b.id);
            }
          }
        }
      }
    }
  } else if (obRes.status === 200 || obRes.status === 409 || obRes.status === 422) {
    const listRes = await post('GET', `${BASE}/opening-balances`);
    if (listRes.status === 200) {
      const bList = listRes.body as { data?: Array<{ id: string }> };
      if (Array.isArray(bList.data)) {
        for (const b of bList.data) {
          openingBalanceIds.push(b.id);
        }
      }
    }
  } else {
    expectOk(obRes, 'opening balances bulk load');
  }

  // 4. Seed Journal Entries
  for (let i = 0; i < SEED_JOURNAL_ENTRIES.length; i++) {
    const jeDef = SEED_JOURNAL_ENTRIES[i]!;

    const lines = jeDef.lines.map((l) => {
      const accountId = accountIdByCode.get(l.accountCode);
      if (!accountId) {
        throw new Error(`Account code ${l.accountCode} not found for journal line`);
      }
      return {
        account_id: accountId,
        debit_amount: l.debit_amount,
        credit_amount: l.credit_amount,
        line_narration: l.line_narration,
      };
    });

    const res = await post('POST', `${BASE}/journal-entries`, {
      period_id: periodId,
      posting_date: jeDef.posting_date,
      description: jeDef.description,
      currency_code: jeDef.currency_code,
      source_reference: jeDef.source_reference,
      idempotency_key: jeDef.idempotency_key,
      batch_id: SEED_BATCH_ID,
      source_row: i + 1,
      lines,
    });

    let entryId = '';
    let currentStatus = 'draft';

    if (res.status === 201) {
      anyNewEntityCreated = true;
      entryId = String(res.body['id']);
      currentStatus = String(res.body['status']);
    } else if (res.status === 200) {
      entryId = String(res.body['id']);
      currentStatus = String(res.body['status']);
    } else if (res.status === 409) {
      // Fetch existing entry by search
      const listRes = await post('GET', `${BASE}/journal-entries?search=${encodeURIComponent(jeDef.source_reference)}`);
      const listBody = listRes.body as { data?: Array<{ id: string; status: string; source_reference: string }> };
      const existing = listBody.data?.find((e) => e.source_reference === jeDef.source_reference);
      if (existing?.id) {
        entryId = existing.id;
        currentStatus = existing.status;
      } else {
        expectOk(res, `journal entry ${jeDef.idempotency_key}`);
      }
    } else {
      expectOk(res, `journal entry ${jeDef.idempotency_key}`);
    }

    journalEntryIds.push(entryId);

    // Transition lifecycle if required and not already in final state
    if (jeDef.finalStatus === 'posted' && currentStatus === 'draft') {
      const postRes = await post('POST', `${BASE}/journal-entries/${entryId}/post`);
      expectOk(postRes, `post entry ${entryId}`);
    } else if (jeDef.finalStatus === 'reversed') {
      if (currentStatus === 'draft') {
        const postRes = await post('POST', `${BASE}/journal-entries/${entryId}/post`);
        expectOk(postRes, `post entry for reversal ${entryId}`);
      }
      if (currentStatus !== 'reversed') {
        const revRes = await post('POST', `${BASE}/journal-entries/${entryId}/reverse`, {
          reversal_reason: 'Correction of erroneous duplicate courier entry',
        });
        expectOk(revRes, `reverse entry ${entryId}`);
      }
    }
  }

  return {
    accountIds,
    openingBalanceIds,
    journalEntryIds,
    replayed: !anyNewEntityCreated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Runner (when executed directly via node)
// ─────────────────────────────────────────────────────────────────────────────
const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('seed.ts') &&
  process.argv[1].includes('erp-4');

if (isMain) {
  const base = process.env['ERP4_BASE_URL'];
  if (!base) {
    console.error('Set ERP4_BASE_URL (e.g. http://localhost:3000). Seed writes only through the public API.');
    process.exit(1);
  }
  const token = process.env['ERP4_AUTH_TOKEN'] ?? 'role:admin';

  const post: PostFn = async (method, path, body) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    };
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const resBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: resBody };
  };

  runSeed(post)
    .then((result) => {
      console.log(`ERP-4 seed ok (${result.replayed ? 'already seeded, replayed' : 'created'}):`);
      console.log(
        `  accounts: ${result.accountIds.length}, opening balances: ${result.openingBalanceIds.length}, journal entries: ${result.journalEntryIds.length}`
      );
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
