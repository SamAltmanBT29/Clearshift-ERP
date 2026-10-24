/**
 * ERP-4 Finance & Accounting — Deterministic Seed Integration Test Suite
 *
 * Verifies that:
 *   1. `runSeed` populates accounts, opening balances, and journal entries via public API only.
 *   2. Idempotent replays: consecutive runs return identical IDs without duplicating rows.
 *   3. Reset determinism: clean-slate resets generate matching business states.
 *   4. Double-entry balance: every seeded entry balances exactly at currency precision.
 *   5. Trial balance integrity: posted entries + opening balances are correctly aggregated.
 *   6. Draft entries are strictly excluded from trial balance figures.
 *   7. Reversal entries maintain compensating symmetry.
 *
 * @module erp4/tests/seed/seed.test
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
import {
  runSeed,
  SEED_ACCOUNTS,
  SEED_OPENING_BALANCES,
  SEED_JOURNAL_ENTRIES,
  type PostFn,
} from '../../../../../../sample-data/erp-4/seed.js';

const BASE = '/api/v1/erp-finance';

function initCleanRepo(): InMemoryFinanceRepository {
  const repo = new InMemoryFinanceRepository(false);
  // Seed the standard fiscal periods so period checks pass cleanly
  repo.periods.set(String(FIXTURE_PERIOD_OPEN['id']), FIXTURE_PERIOD_OPEN as any);
  repo.periods.set(String(FIXTURE_PERIOD_SOFT_CLOSED['id']), FIXTURE_PERIOD_SOFT_CLOSED as any);
  repo.periods.set(String(FIXTURE_PERIOD_LOCKED['id']), FIXTURE_PERIOD_LOCKED as any);
  return repo;
}

describe('ERP-4 deterministic seed (public API only)', () => {
  let app: FastifyInstance;
  let repo: InMemoryFinanceRepository;
  let post: PostFn;

  beforeEach(() => {
    repo = initCleanRepo();
    app = buildApp({ repository: repo, authRequired: false });
    post = async (method, path, body) => {
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
  });

  it('creates the documented accounts, opening balances and journal entries', async () => {
    const result = await runSeed(post);

    expect(result.replayed).toBe(false);
    expect(result.accountIds).toHaveLength(SEED_ACCOUNTS.length);
    expect(result.openingBalanceIds.length).toBeGreaterThanOrEqual(SEED_OPENING_BALANCES.length);
    expect(result.journalEntryIds).toHaveLength(SEED_JOURNAL_ENTRIES.length);

    // Verify all account codes exist
    for (const acct of SEED_ACCOUNTS) {
      const a = await repo.getAccountByCode(acct.code);
      expect(a).not.toBeNull();
      expect(a?.name).toBe(acct.name);
      expect(a?.type).toBe(acct.type);
    }
  });

  it('is idempotent: second run replays cleanly and creates zero duplicate rows', async () => {
    const first = await runSeed(post);
    const initialAccountsCount = repo.accounts.size;
    const initialEntriesCount = repo.journalEntries.size;

    const second = await runSeed(post);

    expect(second.replayed).toBe(true);
    expect(second.accountIds).toEqual(first.accountIds);
    expect(second.journalEntryIds).toEqual(first.journalEntryIds);
    expect(repo.accounts.size).toBe(initialAccountsCount);
    expect(repo.journalEntries.size).toBe(initialEntriesCount);
  });

  it('produces identical deterministic business data on a fresh reset', async () => {
    const stripAcct = (a: { code: string; name: string; type: string; currency_code: string }) => ({
      code: a.code,
      name: a.name,
      type: a.type,
      currency_code: a.currency_code,
    });

    const normalizeDesc = (d: string) => d.replace(/JV-\d+-\d+/g, 'JV-XXXX');

    await runSeed(post);
    const accountsA = [...repo.accounts.values()].map(stripAcct).sort((x, y) => x.code.localeCompare(y.code));
    const entriesA = [...repo.journalEntries.values()]
      .map((e) => ({
        description: normalizeDesc(e.description),
        status: e.status,
        currency_code: e.currency_code,
        linesCount: e.lines.length,
      }))
      .sort((x, y) => x.description.localeCompare(y.description));

    // Reset repository and rebuild app
    repo = initCleanRepo();
    app = buildApp({ repository: repo, authRequired: false });
    post = async (method, path, body) => {
      const res = await app.inject({ method, url: path, payload: body });
      return { status: res.statusCode, body: res.json() as Record<string, unknown> };
    };

    await runSeed(post);
    const accountsB = [...repo.accounts.values()].map(stripAcct).sort((x, y) => x.code.localeCompare(y.code));
    const entriesB = [...repo.journalEntries.values()]
      .map((e) => ({
        description: normalizeDesc(e.description),
        status: e.status,
        currency_code: e.currency_code,
        linesCount: e.lines.length,
      }))
      .sort((x, y) => x.description.localeCompare(y.description));

    expect(accountsB).toEqual(accountsA);
    expect(entriesB).toEqual(entriesA);
  });

  it('every seeded posted journal entry balances exactly at currency precision (BR-ERP4-01)', async () => {
    await runSeed(post);

    for (const entry of repo.journalEntries.values()) {
      if (entry.status === 'posted' || entry.status === 'reversed') {
        const totalDebit = entry.lines.reduce(
          (sum, l) => sum + Math.round(parseFloat(l.debit_amount) * 10000),
          0
        );
        const totalCredit = entry.lines.reduce(
          (sum, l) => sum + Math.round(parseFloat(l.credit_amount) * 10000),
          0
        );
        expect(totalDebit).toBe(totalCredit);
        expect(totalDebit).toBeGreaterThan(0);
      }
    }
  });

  it('seeded journal entries finish in their documented lifecycle status', async () => {
    await runSeed(post);

    for (const def of SEED_JOURNAL_ENTRIES) {
      const entry = await repo.getJournalEntryByIdempotencyKey(def.idempotency_key);
      expect(entry).not.toBeNull();
      expect(entry?.status).toBe(def.finalStatus);
    }
  });

  it('trial balance report balances debits and credits and excludes draft entries', async () => {
    await runSeed(post);

    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/trial-balance?period=2026-04`,
    });

    expect(res.statusCode).toBe(200);
    const tb = res.json() as {
      period: string;
      totals: {
        total_debit: string;
        total_credit: string;
        difference: string;
        is_balanced: boolean;
      };
      rows: Array<{
        account_code: string;
        total_debit: string;
        total_credit: string;
      }>;
    };

    expect(tb.period).toBe('2026-04');
    expect(tb.totals.is_balanced).toBe(true);
    expect(parseFloat(tb.totals.total_debit)).toBeCloseTo(parseFloat(tb.totals.total_credit), 2);

    // Draft entry (JE-003: COGS 8200) must NOT be posted to trial balance
    const cogsAccount = tb.rows.find((a) => a.account_code === '5010-COGS');
    const cogsDebit = parseFloat(cogsAccount?.total_debit ?? '0');
    expect(cogsDebit).toBe(0);
  });

  it('reversed entry maintains compensating link and status', async () => {
    await runSeed(post);

    const reversedEntry = await repo.getJournalEntryByIdempotencyKey('erp4-seed-je-004');
    expect(reversedEntry).not.toBeNull();
    expect(reversedEntry?.status).toBe('reversed');
    expect(reversedEntry?.reversed_by_entry_id).toBeTruthy();

    const compensating = await repo.getJournalEntryById(reversedEntry!.reversed_by_entry_id!);
    expect(compensating).not.toBeNull();
    expect(compensating?.status).toBe('posted');
    expect(compensating?.description).toContain('Reversal of');
  });
});
